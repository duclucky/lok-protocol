import { BaseContract, Wallet, isAddress } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ethers, fhevm, network } from "hardhat";

import { assertDeploymentManifest } from "./deploy";

export type PublicSeedPosition = {
  index: number;
  amount: bigint;
  theta: bigint;
};

type SeedEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveSeedOptions(
  environment: SeedEnvironment,
  defaultDemoWallet: string,
  args: readonly string[] = [],
): { count: number; demoWallet: string } {
  const count = Number(environment.LOK_SEED_COUNT ?? optionValue("--count", args) ?? "40");
  const demoWallet =
    environment.LOK_DEMO_WALLET ??
    environment.DEMO_WALLET_ADDRESS ??
    optionValue("--demo-wallet", args) ??
    defaultDemoWallet;
  return { count, demoWallet };
}

export function resolveActorFunding(environment: SeedEnvironment): bigint {
  const minimum = 5_000_000_000_000_000n;
  const funding = BigInt(environment.LOK_ACTOR_FUNDING_WEI ?? minimum.toString());
  if (funding < minimum) throw new Error("Actor funding must be at least 0.005 ETH");
  return funding;
}

export function buildSeedPlan(count: number, demoWallet: string): PublicSeedPosition[] {
  if (!Number.isInteger(count) || count < 30 || count > 50) {
    throw new Error("Synthetic participant count must be between 30 and 50");
  }
  if (!isAddress(demoWallet)) throw new Error("Demo wallet must be an Ethereum address");
  return Array.from({ length: count }, (_, index) => ({
    index,
    amount: 500_000n + BigInt((index * 7) % 19) * 250_000n,
    theta: index < 4 ? BigInt(index) : 4n,
  }));
}

export function remainingSeedPlan(
  plan: readonly PublicSeedPosition[],
  existingParticipantCount: number,
): PublicSeedPosition[] {
  if (!Number.isSafeInteger(existingParticipantCount) || existingParticipantCount < 0) {
    throw new Error("Existing participant count must be a non-negative integer");
  }
  if (existingParticipantCount > plan.length) throw new Error("Existing participant count exceeds target seed count");
  return plan.slice(existingParticipantCount);
}

export function reclaimableActorBalance(balance: bigint, feePerGas: bigint, gasLimit: bigint): bigint {
  const reserve = feePerGas * gasLimit;
  return balance > reserve ? balance - reserve : 0n;
}

export function actorTransactionNonces(
  startingNonce: number,
  includeTheta: boolean,
): { setOperator: number; deposit: number; theta?: number; sweep: number } {
  if (!Number.isSafeInteger(startingNonce) || startingNonce < 0) {
    throw new Error("Actor nonce must be a non-negative safe integer");
  }
  const setOperator = startingNonce;
  const deposit = setOperator + 1;
  const theta = includeTheta ? deposit + 1 : undefined;
  const sweep = theta === undefined ? deposit + 1 : theta + 1;
  return theta === undefined ? { setOperator, deposit, sweep } : { setOperator, deposit, theta, sweep };
}

export function demoYieldTopUp(current: bigint, target: bigint): bigint {
  const maxUint64 = 2n ** 64n - 1n;
  if (current < 0n || target < 0n || target > maxUint64) throw new Error("Demo yield must fit uint64");
  if (current > target) throw new Error("Current demo yield exceeds target");
  return target - current;
}

export function serializePublicSeedPlan(plan: readonly PublicSeedPosition[]): string {
  return JSON.stringify(
    plan.map((position) => ({
      index: position.index,
      amount: position.amount.toString(),
      theta: position.theta.toString(),
    })),
    null,
    2,
  );
}

async function waitForWrite(contract: BaseContract, method: string, args: readonly unknown[] = []): Promise<string> {
  const transaction = await contract.getFunction(method)(...args);
  const receipt = await transaction.wait();
  if (receipt === null) throw new Error(`${method} transaction was not mined`);
  return receipt.hash;
}

function optionValue(name: string, args: readonly string[]): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  if (network.name !== "sepolia") throw new Error("seed-demo.ts only supports Ethereum Sepolia");
  await fhevm.initializeCLIApi();
  if (fhevm.isMock) throw new Error("seed-demo.ts refuses the mock FHEVM backend");
  const raw: unknown = JSON.parse(await readFile(path.join(process.cwd(), "deployments", "sepolia.json"), "utf8"));
  assertDeploymentManifest(raw);
  const [operator] = await ethers.getSigners();
  if (operator === undefined) throw new Error("A funded Sepolia operator signer is required");
  const { count, demoWallet } = resolveSeedOptions(process.env, operator.address, process.argv);
  const targetPlan = buildSeedPlan(count, demoWallet);
  const token = await ethers.getContractAt("YieldInjectingERC7984", raw.addresses.confidentialToken, operator);
  const adapter = await ethers.getContractAt("MockYieldAdapter", raw.addresses.yieldAdapter, operator);
  const vault = await ethers.getContractAt("LokVault", raw.addresses.vault, operator);
  const existingParticipantCount = Number(await vault.getFunction("participantCount").staticCall());
  const plan = remainingSeedPlan(targetPlan, existingParticipantCount);
  const feeData = await ethers.provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (feePerGas === null) throw new Error("Sepolia fee data is unavailable");
  const actorFunding = resolveActorFunding(process.env);
  const operatorReserve = ethers.parseEther("0.005");
  const balance = await ethers.provider.getBalance(operator.address);
  if (plan.length > 0 && balance <= actorFunding + operatorReserve) {
    throw new Error(`Seeder needs more test ETH: one actor buffer is ${ethers.formatEther(actorFunding)} ETH`);
  }

  const transactions: Array<{ index: number; actor: string; hashes: string[] }> = [];
  for (const position of plan) {
    const currentOperatorBalance = await ethers.provider.getBalance(operator.address);
    if (currentOperatorBalance <= actorFunding + operatorReserve) {
      throw new Error(`Seeder stopped safely before actor ${position.index}: deployer reserve would be breached`);
    }
    const actor = Wallet.createRandom().connect(ethers.provider);
    if (actor.address.toLowerCase() === demoWallet.toLowerCase()) {
      throw new Error("Synthetic actor unexpectedly equals the human-controlled demo wallet");
    }
    const funding = await operator.sendTransaction({ to: actor.address, value: actorFunding });
    const fundingReceipt = await funding.wait();
    if (fundingReceipt === null) throw new Error(`Funding actor ${position.index} was not mined`);
    const hashes = [fundingReceipt.hash];
    hashes.push(await waitForWrite(token, "mintForTest", [actor.address, position.amount]));
    const actorNonces = actorTransactionNonces(
      await ethers.provider.getTransactionCount(actor.address, "pending"),
      position.theta !== 4n,
    );
    hashes.push(
      await waitForWrite(token.connect(actor) as BaseContract, "setOperator", [
        raw.addresses.vault,
        2n ** 48n - 1n,
        { nonce: actorNonces.setOperator },
      ]),
    );
    const encryptedAmount = await fhevm
      .createEncryptedInput(raw.addresses.vault, actor.address)
      .add64(position.amount)
      .encrypt();
    hashes.push(
      await waitForWrite(vault.connect(actor) as BaseContract, "deposit", [
        encryptedAmount.handles[0],
        encryptedAmount.inputProof,
        { nonce: actorNonces.deposit },
      ]),
    );
    if (position.theta !== 4n) {
      const encryptedTheta = await fhevm
        .createEncryptedInput(raw.addresses.vault, actor.address)
        .add8(position.theta)
        .encrypt();
      hashes.push(
        await waitForWrite(vault.connect(actor) as BaseContract, "setTheta", [
          encryptedTheta.handles[0],
          encryptedTheta.inputProof,
          { nonce: actorNonces.theta },
        ]),
      );
    }
    const actorBalance = await ethers.provider.getBalance(actor.address);
    const reclaimable = reclaimableActorBalance(actorBalance, feePerGas, 21_000n);
    if (reclaimable > 0n) {
      const sweep = await actor.sendTransaction({
        to: operator.address,
        value: reclaimable,
        gasLimit: 21_000n,
        maxFeePerGas: feePerGas,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas ?? 1_000_000n,
        nonce: actorNonces.sweep,
      });
      const sweepReceipt = await sweep.wait();
      if (sweepReceipt === null) throw new Error(`Actor ${position.index} gas return was not mined`);
      hashes.push(sweepReceipt.hash);
    }
    transactions.push({ index: position.index, actor: actor.address, hashes });
    console.log(JSON.stringify({ status: "seeded", index: position.index, actor: actor.address }));
  }

  const demoMintHash = await waitForWrite(token, "mintForTest", [demoWallet, 10_000_000n]);
  const demoYieldTarget = BigInt(process.env.LOK_DEMO_YIELD ?? "5000000");
  const currentDemoYield = BigInt(await adapter.getFunction("fundedYieldInAdapter").staticCall());
  const demoYieldAmount = demoYieldTopUp(currentDemoYield, demoYieldTarget);
  const demoYieldHash =
    demoYieldAmount === 0n
      ? null
      : await waitForWrite(token, "injectYield", [raw.addresses.yieldAdapter, demoYieldAmount]);
  console.log(
    JSON.stringify({
      status: "PASS",
      participantCount: Number(await vault.getFunction("participantCount").staticCall()),
      resumedFrom: existingParticipantCount,
      demoWallet,
      demoMintHash,
      demoYieldTarget: demoYieldTarget.toString(),
      demoYieldAmount: demoYieldAmount.toString(),
      demoYieldHash,
      actors: transactions,
      keyMaterialPersisted: false,
    }),
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
