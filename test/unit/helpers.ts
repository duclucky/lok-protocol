import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType, FhevmTypeEuint } from "@fhevm/hardhat-plugin";
import { BaseContract, ContractTransactionResponse, toBeHex, zeroPadValue } from "ethers";
import { ethers, fhevm } from "hardhat";

export type VaultFixture = {
  owner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
  underlying: BaseContract;
  token: BaseContract;
  adapter: BaseContract;
  vault: BaseContract;
  drawHarness?: BaseContract;
};

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

export async function decrypt64(contract: BaseContract, signer: HardhatEthersSigner, value: bigint): Promise<bigint> {
  return fhevm.userDecryptEuint(FhevmType.euint64, asHandle(value), await contract.getAddress(), signer);
}

export async function encrypt64(contract: BaseContract, signer: HardhatEthersSigner, value: bigint) {
  return fhevm
    .createEncryptedInput(await contract.getAddress(), signer.address)
    .add64(value)
    .encrypt();
}

export async function deployVaultFixture(
  adapterName = "MockYieldAdapter",
  useDrawHarness = false,
  tokenName = "YieldInjectingERC7984",
): Promise<VaultFixture> {
  const [owner, alice, outsider] = await ethers.getSigners();

  const underlyingFactory = await ethers.getContractFactory("MockUSDC");
  const underlying = await underlyingFactory.deploy();
  await underlying.waitForDeployment();

  const tokenFactory = await ethers.getContractFactory(tokenName);
  const token = await tokenFactory.deploy(await underlying.getAddress());
  await token.waitForDeployment();

  const adapterFactory = await ethers.getContractFactory(adapterName);
  const adapter = await adapterFactory.deploy(await token.getAddress(), owner.address);
  await adapter.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("LokVault");
  const vault = await vaultFactory.deploy(await token.getAddress(), await adapter.getAddress(), owner.address);
  await vault.waitForDeployment();
  await write(adapter, "setVault", [await vault.getAddress()]);
  let drawHarness: BaseContract | undefined;
  if (useDrawHarness) {
    const harnessFactory = await ethers.getContractFactory("VaultDrawHarness");
    drawHarness = await harnessFactory.deploy(await vault.getAddress());
    await drawHarness.waitForDeployment();
    await write(vault, "setDrawManager", [await drawHarness.getAddress()]);
  } else {
    await write(vault, "setDrawManager", [owner.address]);
  }

  return { owner, alice, outsider, underlying, token, adapter, vault, drawHarness };
}

export async function mintToken(
  token: BaseContract,
  minter: HardhatEthersSigner,
  recipient: string,
  amount: bigint,
): Promise<void> {
  void minter;
  await write(token, "mintForTest", [recipient, amount]);
}

export async function deposit(fixture: VaultFixture, signer: HardhatEthersSigner, amount: bigint): Promise<void> {
  await authorizeVault(fixture, signer);
  const encrypted = await encrypt64(fixture.vault, signer, amount);
  await write(fixture.vault.connect(signer) as BaseContract, "deposit", [encrypted.handles[0], encrypted.inputProof]);
}

export async function authorizeVault(fixture: VaultFixture, signer: HardhatEthersSigner): Promise<void> {
  const vaultAddress = await fixture.vault.getAddress();
  const isOperator = (await read(fixture.token, "isOperator", [signer.address, vaultAddress])) as boolean;
  if (!isOperator) {
    await write(fixture.token.connect(signer) as BaseContract, "setOperator", [vaultAddress, 2n ** 48n - 1n]);
  }
}

export async function openAndDecryptCheckpoint(vault: BaseContract) {
  await write(vault, "openSolvencyCheckpoint");
  const epoch = (await read(vault, "pendingSolvencyRiskEpoch")) as bigint;
  const nonce = (await read(vault, "solvencyCheckpointNonce")) as bigint;
  const handle = (await read(vault, "pendingSolvencyHandle")) as `0x${string}`;
  const result = await fhevm.publicDecrypt([handle]);
  return {
    epoch,
    nonce,
    handle,
    clearValue: result.clearValues[handle] as boolean,
    abiEncodedCleartexts: result.abiEncodedClearValues,
    proof: result.decryptionProof,
  };
}

export async function submitCheckpoint(
  vault: BaseContract,
  result: Awaited<ReturnType<typeof openAndDecryptCheckpoint>>,
): Promise<void> {
  await write(vault, "submitSolvencyCheckpoint", [
    result.epoch,
    result.nonce,
    result.abiEncodedCleartexts,
    result.proof,
  ]);
}

export function tamperLastByte(value: string): string {
  const finalByte = value.slice(-2);
  return `${value.slice(0, -2)}${finalByte === "00" ? "01" : "00"}`;
}

export async function encrypt8(contract: BaseContract, signer: HardhatEthersSigner, value: bigint) {
  return fhevm
    .createEncryptedInput(await contract.getAddress(), signer.address)
    .add8(value)
    .encrypt();
}

export async function debugDecrypt(type: FhevmTypeEuint, value: bigint): Promise<bigint> {
  return fhevm.debugger.decryptEuint(type, value);
}

export async function debugDecryptBool(value: bigint): Promise<boolean> {
  return fhevm.debugger.decryptEbool(value);
}
