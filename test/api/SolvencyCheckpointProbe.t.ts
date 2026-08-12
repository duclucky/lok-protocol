import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { BaseContract, BytesLike, ContractTransactionResponse } from "ethers";
import { ethers, fhevm } from "hardhat";

type WriteResult = Promise<ContractTransactionResponse>;

type ProbeERC7984Contract = BaseContract & {
  mint(to: string, amount: BytesLike, inputProof: BytesLike): WriteResult;
};

type ProbeAssetSourceContract = BaseContract;

type SolvencyCheckpointProbeContract = BaseContract & {
  setLiability(amount: BytesLike, inputProof: BytesLike): WriteResult;
  openCheckpoint(epoch: bigint): WriteResult;
  submitCheckpoint(epoch: bigint, nonce: bigint, abiEncodedCleartexts: BytesLike, proof: BytesLike): WriteResult;
  setRiskEpoch(epoch: bigint): WriteResult;
  riskEpoch(): Promise<bigint>;
  pendingNonce(): Promise<bigint>;
  pendingHandle(): Promise<string>;
  hasPending(): Promise<boolean>;
  lastResult(): Promise<boolean>;
  lastSubmittedEpoch(): Promise<bigint>;
};

type Fixture = {
  admin: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
  token: ProbeERC7984Contract;
  source: ProbeAssetSourceContract;
  probe: SolvencyCheckpointProbeContract;
};

const EPOCH = 1n;

async function deployToken(): Promise<ProbeERC7984Contract> {
  const factory = await ethers.getContractFactory("ProbeERC7984");
  const token = (await factory.deploy()) as ProbeERC7984Contract;
  await token.waitForDeployment();
  return token;
}

async function deploySource(tokenAddress: string, grantAccess: boolean): Promise<ProbeAssetSourceContract> {
  const factory = await ethers.getContractFactory("ProbeAssetSource");
  const source = (await factory.deploy(tokenAddress, grantAccess)) as ProbeAssetSourceContract;
  await source.waitForDeployment();
  return source;
}

async function deployProbe(sourceAddress: string): Promise<SolvencyCheckpointProbeContract> {
  const factory = await ethers.getContractFactory("SolvencyCheckpointProbe");
  const probe = (await factory.deploy(sourceAddress)) as SolvencyCheckpointProbeContract;
  await probe.waitForDeployment();
  return probe;
}

async function deployFixture(): Promise<Fixture> {
  const [admin, outsider] = await ethers.getSigners();
  const token = await deployToken();
  const source = await deploySource(await token.getAddress(), true);
  const probe = await deployProbe(await source.getAddress());

  await (await probe.setRiskEpoch(EPOCH)).wait();

  return { admin, outsider, token, source, probe };
}

async function encrypt64(contractAddress: string, signer: HardhatEthersSigner, value: bigint) {
  return fhevm.createEncryptedInput(contractAddress, signer.address).add64(value).encrypt();
}

async function mintAssets(
  token: ProbeERC7984Contract,
  recipient: string,
  signer: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const encrypted = await encrypt64(await token.getAddress(), signer, amount);
  await (await token.mint(recipient, encrypted.handles[0], encrypted.inputProof)).wait();
}

async function setLiability(
  probe: SolvencyCheckpointProbeContract,
  signer: HardhatEthersSigner,
  amount: bigint,
): Promise<void> {
  const encrypted = await encrypt64(await probe.getAddress(), signer, amount);
  await (await probe.setLiability(encrypted.handles[0], encrypted.inputProof)).wait();
}

async function openAndPublicDecrypt(probe: SolvencyCheckpointProbeContract, epoch: bigint) {
  await (await probe.openCheckpoint(epoch)).wait();

  const nonce = await probe.pendingNonce();
  const handle = (await probe.pendingHandle()) as `0x${string}`;
  expect(await probe.hasPending()).to.equal(true);
  expect(handle).to.not.equal(ethers.ZeroHash);

  // The only public-decryption request is the pending aggregate ebool handle.
  const result = await fhevm.publicDecrypt([handle]);
  expect(Object.keys(result.clearValues)).to.deep.equal([handle]);
  expect(typeof result.clearValues[handle]).to.equal("boolean");

  return {
    nonce,
    handle,
    clearValue: result.clearValues[handle] as boolean,
    abiEncodedCleartexts: result.abiEncodedClearValues,
    proof: result.decryptionProof,
  };
}

function tamperLastByte(value: string): string {
  const finalByte = value.slice(-2);
  return `${value.slice(0, -2)}${finalByte === "00" ? "01" : "00"}`;
}

describe("SolvencyCheckpointProbe public-decryption API", function () {
  let fixture: Fixture;

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }

    fixture = await deployFixture();
  });

  it("accepts a valid true aggregate-solvency result", async function () {
    const { admin, token, source, probe } = fixture;
    await mintAssets(token, await source.getAddress(), admin, 100n);
    await setLiability(probe, admin, 80n);

    const result = await openAndPublicDecrypt(probe, EPOCH);
    expect(result.clearValue).to.equal(true);

    await (await probe.submitCheckpoint(EPOCH, result.nonce, result.abiEncodedCleartexts, result.proof)).wait();

    expect(await probe.lastResult()).to.equal(true);
    expect(await probe.lastSubmittedEpoch()).to.equal(EPOCH);
    expect(await probe.hasPending()).to.equal(false);
  });

  it("accepts a valid false aggregate-solvency result without treating it as solvent", async function () {
    const { admin, token, source, probe } = fixture;
    await mintAssets(token, await source.getAddress(), admin, 80n);
    await setLiability(probe, admin, 100n);

    const result = await openAndPublicDecrypt(probe, EPOCH);
    expect(result.clearValue).to.equal(false);

    await (await probe.submitCheckpoint(EPOCH, result.nonce, result.abiEncodedCleartexts, result.proof)).wait();

    expect(await probe.lastResult()).to.equal(false);
    expect(await probe.lastSubmittedEpoch()).to.equal(EPOCH);
    expect(await probe.hasPending()).to.equal(false);
  });

  it("rejects a forged decryption proof", async function () {
    const { admin, token, source, probe } = fixture;
    await mintAssets(token, await source.getAddress(), admin, 100n);
    await setLiability(probe, admin, 80n);
    const result = await openAndPublicDecrypt(probe, EPOCH);

    await expect(probe.submitCheckpoint(EPOCH, result.nonce, result.abiEncodedCleartexts, tamperLastByte(result.proof)))
      .to.be.reverted;

    expect(await probe.hasPending()).to.equal(true);
    expect(await probe.lastSubmittedEpoch()).to.equal(0n);
  });

  it("rejects malformed ABI-encoded cleartext", async function () {
    const { admin, token, source, probe } = fixture;
    await mintAssets(token, await source.getAddress(), admin, 100n);
    await setLiability(probe, admin, 80n);
    const result = await openAndPublicDecrypt(probe, EPOCH);

    await expect(probe.submitCheckpoint(EPOCH, result.nonce, "0x01", result.proof)).to.be.reverted;

    expect(await probe.hasPending()).to.equal(true);
    expect(await probe.lastSubmittedEpoch()).to.equal(0n);
  });

  it("rejects an old handle proof after the pending checkpoint is replaced", async function () {
    const { admin, token, source, probe } = fixture;
    await mintAssets(token, await source.getAddress(), admin, 100n);
    await setLiability(probe, admin, 80n);
    const oldResult = await openAndPublicDecrypt(probe, EPOCH);

    await setLiability(probe, admin, 120n);
    await (await probe.openCheckpoint(EPOCH)).wait();
    const replacementNonce = await probe.pendingNonce();
    const replacementHandle = await probe.pendingHandle();

    expect(replacementNonce).to.be.greaterThan(oldResult.nonce);
    expect(replacementHandle).to.not.equal(oldResult.handle);
    await expect(probe.submitCheckpoint(EPOCH, replacementNonce, oldResult.abiEncodedCleartexts, oldResult.proof)).to.be
      .reverted;

    expect(await probe.hasPending()).to.equal(true);
    expect(await probe.pendingHandle()).to.equal(replacementHandle);
  });

  it("rejects a proof from a stale risk epoch", async function () {
    const { admin, token, source, probe } = fixture;
    await mintAssets(token, await source.getAddress(), admin, 100n);
    await setLiability(probe, admin, 80n);
    const result = await openAndPublicDecrypt(probe, EPOCH);

    await (await probe.setRiskEpoch(EPOCH + 1n)).wait();
    await expect(probe.submitCheckpoint(EPOCH, result.nonce, result.abiEncodedCleartexts, result.proof)).to.be.reverted;

    expect(await probe.riskEpoch()).to.equal(EPOCH + 1n);
    expect(await probe.lastSubmittedEpoch()).to.equal(0n);
  });

  it("rejects duplicate submission of an already-consumed checkpoint", async function () {
    const { admin, token, source, probe } = fixture;
    await mintAssets(token, await source.getAddress(), admin, 100n);
    await setLiability(probe, admin, 80n);
    const result = await openAndPublicDecrypt(probe, EPOCH);

    await (await probe.submitCheckpoint(EPOCH, result.nonce, result.abiEncodedCleartexts, result.proof)).wait();
    await expect(probe.submitCheckpoint(EPOCH, result.nonce, result.abiEncodedCleartexts, result.proof)).to.be.reverted;

    expect(await probe.lastSubmittedEpoch()).to.equal(EPOCH);
    expect(await probe.hasPending()).to.equal(false);
  });

  it("rejects checkpoint creation when the asset source omits the transient ACL grant", async function () {
    const { admin, token } = fixture;
    const sourceWithoutAcl = await deploySource(await token.getAddress(), false);
    const probeWithoutAcl = await deployProbe(await sourceWithoutAcl.getAddress());
    await (await probeWithoutAcl.setRiskEpoch(EPOCH)).wait();
    await mintAssets(token, await sourceWithoutAcl.getAddress(), admin, 100n);
    await setLiability(probeWithoutAcl, admin, 80n);

    await expect(probeWithoutAcl.openCheckpoint(EPOCH)).to.be.reverted;
    expect(await probeWithoutAcl.hasPending()).to.equal(false);
  });

  it("allows only the admin to change the risk epoch", async function () {
    const { outsider, probe } = fixture;
    const outsiderProbe = probe.connect(outsider) as unknown as SolvencyCheckpointProbeContract;

    await expect(outsiderProbe.setRiskEpoch(EPOCH + 1n)).to.be.reverted;
    expect(await probe.riskEpoch()).to.equal(EPOCH);
  });
});
