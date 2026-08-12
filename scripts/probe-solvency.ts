import { FhevmType } from "@fhevm/hardhat-plugin";
import type { ContractTransactionReceipt } from "ethers";
import { ethers, fhevm, network } from "hardhat";

import { ProbeAssetSource, ProbeERC7984, SolvencyCheckpointProbe } from "../types";

const RISK_EPOCH = 1n;
const SEEDED_USER_BALANCE = 9n;
const REQUESTED_TRANSFER = 7n;

function tamperLastByte(value: string): string {
  const finalByte = value.slice(-2);
  return `${value.slice(0, -2)}${finalByte === "00" ? "01" : "00"}`;
}

function confidentialTransferHandle(receipt: ContractTransactionReceipt, token: ProbeERC7984): string {
  for (const log of receipt.logs) {
    try {
      const parsed = token.interface.parseLog(log);
      if (parsed?.name === "ConfidentialTransfer") {
        return parsed.args.amount as string;
      }
    } catch {
      // The receipt also contains protocol logs outside the ERC-7984 ABI.
    }
  }
  throw new Error("ConfidentialTransfer event was not found in the transfer receipt");
}

async function expectStaticRejection(label: string, action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch {
    return label;
  }
  throw new Error(`${label} was unexpectedly accepted`);
}

async function main(): Promise<void> {
  await fhevm.initializeCLIApi();

  const [deployer] = await ethers.getSigners();
  if (deployer === undefined) {
    throw new Error(
      "No Sepolia deployer configured. Set a funded throwaway key with `npx hardhat vars set DEPLOYER_PRIVATE_KEY`.",
    );
  }

  const token = (await (await ethers.getContractFactory("ProbeERC7984", deployer)).deploy()) as ProbeERC7984;
  await token.waitForDeployment();

  const source = (await (
    await ethers.getContractFactory("ProbeAssetSource", deployer)
  ).deploy(await token.getAddress(), true)) as ProbeAssetSource;
  await source.waitForDeployment();

  const probe = (await (
    await ethers.getContractFactory("SolvencyCheckpointProbe", deployer)
  ).deploy(await source.getAddress())) as SolvencyCheckpointProbe;
  await probe.waitForDeployment();

  await (await probe.setRiskEpoch(RISK_EPOCH)).wait();

  const userSeed = await fhevm
    .createEncryptedInput(await token.getAddress(), deployer.address)
    .add64(SEEDED_USER_BALANCE)
    .encrypt();
  await (await token.mint(deployer.address, userSeed.handles[0], userSeed.inputProof)).wait();

  const requestedTransfer = await fhevm
    .createEncryptedInput(await token.getAddress(), deployer.address)
    .add64(REQUESTED_TRANSFER)
    .encrypt();
  const transferTx = await token["confidentialTransferFrom(address,address,bytes32,bytes)"](
    deployer.address,
    await source.getAddress(),
    requestedTransfer.handles[0],
    requestedTransfer.inputProof,
  );
  const transferReceipt = await transferTx.wait();
  if (transferReceipt === null) throw new Error("ERC-7984 transfer transaction was not mined");

  const transferredHandle = confidentialTransferHandle(transferReceipt, token);
  const transferred = await fhevm.userDecryptEuint(
    FhevmType.euint64,
    transferredHandle,
    await token.getAddress(),
    deployer,
  );
  if (transferred !== REQUESTED_TRANSFER) {
    throw new Error(`Expected ERC-7984 moved amount ${REQUESTED_TRANSFER}, got ${transferred}`);
  }

  const assets = await fhevm
    .createEncryptedInput(await token.getAddress(), deployer.address)
    .add64(100n)
    .encrypt();
  await (await token.mint(await source.getAddress(), assets.handles[0], assets.inputProof)).wait();

  const liabilities = await fhevm
    .createEncryptedInput(await probe.getAddress(), deployer.address)
    .add64(80n)
    .encrypt();
  await (await probe.setLiability(liabilities.handles[0], liabilities.inputProof)).wait();

  const openTx = await probe.openCheckpoint(RISK_EPOCH);
  const openReceipt = await openTx.wait();
  if (openReceipt === null) throw new Error("Checkpoint-open transaction was not mined");

  const nonce = await probe.pendingNonce();
  const handle = (await probe.pendingHandle()) as `0x${string}`;
  const decryptStartedAt = Date.now();
  const decrypted = await fhevm.publicDecrypt([handle]);
  const decryptionLatencyMs = Date.now() - decryptStartedAt;
  const clearResult = decrypted.clearValues[handle];
  if (clearResult !== true) throw new Error(`Expected true aggregate checkpoint, got ${String(clearResult)}`);

  const submitTx = await probe.submitCheckpoint(
    RISK_EPOCH,
    nonce,
    decrypted.abiEncodedClearValues,
    decrypted.decryptionProof,
  );
  const submitReceipt = await submitTx.wait();
  if (submitReceipt === null) throw new Error("Checkpoint-submit transaction was not mined");

  await (await probe.openCheckpoint(RISK_EPOCH)).wait();
  const rejectionNonce = await probe.pendingNonce();
  const rejectionHandle = await probe.pendingHandle();
  const rejectionProof = await fhevm.publicDecrypt([rejectionHandle]);

  const forged = await expectStaticRejection("forged-proof", () =>
    probe.submitCheckpoint.staticCall(
      RISK_EPOCH,
      rejectionNonce,
      rejectionProof.abiEncodedClearValues,
      tamperLastByte(rejectionProof.decryptionProof),
    ),
  );

  await (await probe.setRiskEpoch(RISK_EPOCH + 1n)).wait();
  const stale = await expectStaticRejection("stale-epoch", () =>
    probe.submitCheckpoint.staticCall(
      RISK_EPOCH,
      rejectionNonce,
      rejectionProof.abiEncodedClearValues,
      rejectionProof.decryptionProof,
    ),
  );

  const hcu = fhevm.computeTransactionHCU(openReceipt);
  console.log(
    JSON.stringify(
      {
        network: network.name,
        deployer: deployer.address,
        contracts: {
          token: await token.getAddress(),
          assetSource: await source.getAddress(),
          checkpointProbe: await probe.getAddress(),
        },
        transactions: {
          transfer: transferReceipt.hash,
          open: openReceipt.hash,
          submit: submitReceipt.hash,
        },
        erc7984Transfer: {
          seededBalance: SEEDED_USER_BALANCE.toString(),
          requested: REQUESTED_TRANSFER.toString(),
          moved: transferred.toString(),
          handle: transferredHandle,
          gasUsed: transferReceipt.gasUsed.toString(),
          feeWei: (transferReceipt.gasUsed * transferReceipt.gasPrice).toString(),
          hcu: fhevm.computeTransactionHCU(transferReceipt),
        },
        checkpoint: {
          epoch: RISK_EPOCH.toString(),
          nonce: nonce.toString(),
          handle,
          result: clearResult,
        },
        decryptionLatencyMs,
        hcu: {
          global: hcu.globalHCU,
          maxDepth: hcu.maxHCUDepth,
        },
        rejected: [forged, stale],
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
