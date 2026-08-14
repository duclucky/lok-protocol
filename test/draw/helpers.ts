import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { BaseContract, ContractTransactionResponse, toBeHex, zeroPadValue } from "ethers";
import { ethers, fhevm } from "hardhat";

export type DrawFixture = {
  owner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  users: HardhatEthersSigner[];
  token: BaseContract;
  adapter: BaseContract;
  vault: BaseContract;
  draw: BaseContract;
};

export const TEST_DRAW_TIMING = {
  drawPeriod: 60n,
  minSettleDelay: 24n,
  revealWindow: 120n,
  stateTimeout: 300n,
} as const;

export const TEST_DRAW_TIMING_ARGS = [
  TEST_DRAW_TIMING.drawPeriod,
  TEST_DRAW_TIMING.minSettleDelay,
  TEST_DRAW_TIMING.revealWindow,
  TEST_DRAW_TIMING.stateTimeout,
] as const;

export async function write(contract: BaseContract, name: string, args: readonly unknown[] = []): Promise<void> {
  const tx = (await contract.getFunction(name)(...args)) as ContractTransactionResponse;
  await tx.wait();
}

export async function read(contract: BaseContract, name: string, args: readonly unknown[] = []): Promise<unknown> {
  return contract.getFunction(name).staticCall(...args);
}

export function asHandle(value: bigint): `0x${string}` {
  return zeroPadValue(toBeHex(value), 32) as `0x${string}`;
}

export async function proveCurrentSolvency(vault: BaseContract): Promise<void> {
  await write(vault, "openSolvencyCheckpoint");
  const epoch = (await read(vault, "pendingSolvencyRiskEpoch")) as bigint;
  const nonce = (await read(vault, "solvencyCheckpointNonce")) as bigint;
  const handle = (await read(vault, "pendingSolvencyHandle")) as `0x${string}`;
  const decrypted = await fhevm.publicDecrypt([handle]);
  await write(vault, "submitSolvencyCheckpoint", [
    epoch,
    nonce,
    decrypted.abiEncodedClearValues,
    decrypted.decryptionProof,
  ]);
}

export async function deployDrawFixture(proveSolvency = true, userCount = 6): Promise<DrawFixture> {
  const [owner, ...availableUsers] = await ethers.getSigners();
  const users = availableUsers.slice(0, userCount);
  const [alice, bob] = users;

  const underlyingFactory = await ethers.getContractFactory("MockUSDC");
  const underlying = await underlyingFactory.deploy();
  await underlying.waitForDeployment();

  const tokenFactory = await ethers.getContractFactory("YieldInjectingERC7984");
  const token = await tokenFactory.deploy(await underlying.getAddress());
  await token.waitForDeployment();

  const adapterFactory = await ethers.getContractFactory("MockYieldAdapter");
  const adapter = await adapterFactory.deploy(await token.getAddress(), owner.address);
  await adapter.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("LokVault");
  const vault = await vaultFactory.deploy(await token.getAddress(), await adapter.getAddress(), owner.address);
  await vault.waitForDeployment();
  await write(adapter, "setVault", [await vault.getAddress()]);

  const drawFactory = await ethers.getContractFactory("LokDrawManager");
  const draw = await drawFactory.deploy(await vault.getAddress(), owner.address, ...TEST_DRAW_TIMING_ARGS);
  await draw.waitForDeployment();
  await write(vault, "setDrawManager", [await draw.getAddress()]);

  if (proveSolvency) await proveCurrentSolvency(vault);
  return { owner, alice, bob, users, token, adapter, vault, draw };
}

export async function mintAndDeposit(fixture: DrawFixture, signer: HardhatEthersSigner, amount: bigint): Promise<void> {
  await write(fixture.token, "mintForTest", [signer.address, amount]);
  await write(fixture.token.connect(signer) as BaseContract, "setOperator", [
    await fixture.vault.getAddress(),
    2n ** 48n - 1n,
  ]);
  const encrypted = await fhevm
    .createEncryptedInput(await fixture.vault.getAddress(), signer.address)
    .add64(amount)
    .encrypt();
  await write(fixture.vault.connect(signer) as BaseContract, "deposit", [encrypted.handles[0], encrypted.inputProof]);
}
