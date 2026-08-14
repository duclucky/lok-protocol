import { expect } from "chai";
import { BaseContract, Result } from "ethers";
import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { asHandle, read, write } from "../unit/helpers";
import { NON_DUST_DEPOSIT, TEST_DRAW_TIMING_ARGS } from "../draw/helpers";

type Fixture = {
  owner: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  alice: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  users: Awaited<ReturnType<typeof ethers.getSigners>>;
  underlying: BaseContract;
  token: BaseContract;
  adapter: BaseContract;
  vault: BaseContract;
  draw: BaseContract;
};

type DrawInfo = Result & {
  tEnd: bigint;
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
};

async function deployFixture(): Promise<Fixture> {
  const [owner, alice, ...rest] = await ethers.getSigners();
  const underlying = await (await ethers.getContractFactory("MockUSDC")).deploy();
  await underlying.waitForDeployment();
  const token = await (
    await ethers.getContractFactory("MaliciousConfidentialToken")
  ).deploy(await underlying.getAddress());
  await token.waitForDeployment();
  const adapter = await (
    await ethers.getContractFactory("MockYieldAdapter")
  ).deploy(await token.getAddress(), owner.address);
  await adapter.waitForDeployment();
  const vault = await (
    await ethers.getContractFactory("LokVault")
  ).deploy(await token.getAddress(), await adapter.getAddress(), owner.address);
  await vault.waitForDeployment();
  await write(adapter, "setVault", [await vault.getAddress()]);
  const draw = await (
    await ethers.getContractFactory("LokDrawManager")
  ).deploy(await vault.getAddress(), owner.address, ...TEST_DRAW_TIMING_ARGS);
  await draw.waitForDeployment();
  await write(vault, "setDrawManager", [await draw.getAddress()]);
  return { owner, alice, users: [alice, ...rest], underlying, token, adapter, vault, draw };
}

async function arm(token: BaseContract, target: BaseContract, data: string): Promise<void> {
  await write(token, "armCallback", [await target.getAddress(), data]);
}

async function expectBlocked(token: BaseContract): Promise<void> {
  expect(await read(token, "callbackAttempted")).to.equal(true);
  expect(await read(token, "callbackSucceeded")).to.equal(false);
}

async function mintAndDeposit(fixture: Fixture, signer: Fixture["alice"], amount: bigint): Promise<void> {
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

async function proveSolvency(vault: BaseContract): Promise<void> {
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

describe("Lok reentrancy boundaries", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("blocks token callbacks into deposit, withdraw, and exit while preserving the outer value leg", async function () {
    const fixture = await deployFixture();
    const nestedDeposit = fixture.vault.interface.encodeFunctionData("deposit", [ethers.ZeroHash, "0x"]);
    await arm(fixture.token, fixture.vault, nestedDeposit);
    await mintAndDeposit(fixture, fixture.alice, 10n);
    await expectBlocked(fixture.token);

    await arm(fixture.token, fixture.vault, fixture.vault.interface.encodeFunctionData("withdrawAll"));
    const encrypted = await fhevm
      .createEncryptedInput(await fixture.vault.getAddress(), fixture.alice.address)
      .add64(1n)
      .encrypt();
    await write(fixture.vault.connect(fixture.alice) as BaseContract, "withdraw", [
      encrypted.handles[0],
      encrypted.inputProof,
    ]);
    await expectBlocked(fixture.token);

    await arm(fixture.token, fixture.vault, fixture.vault.interface.encodeFunctionData("exit"));
    await write(fixture.vault.connect(fixture.alice) as BaseContract, "exit");
    await expectBlocked(fixture.token);
  });

  it("blocks a proof-valid checkpoint submission during a deposit callback", async function () {
    const fixture = await deployFixture();
    await write(fixture.vault, "openSolvencyCheckpoint");
    const epoch = (await read(fixture.vault, "pendingSolvencyRiskEpoch")) as bigint;
    const nonce = (await read(fixture.vault, "solvencyCheckpointNonce")) as bigint;
    const handle = (await read(fixture.vault, "pendingSolvencyHandle")) as `0x${string}`;
    const decrypted = await fhevm.publicDecrypt([handle]);
    const submit = fixture.vault.interface.encodeFunctionData("submitSolvencyCheckpoint", [
      epoch,
      nonce,
      decrypted.abiEncodedClearValues,
      decrypted.decryptionProof,
    ]);
    await arm(fixture.token, fixture.vault, submit);
    await mintAndDeposit(fixture, fixture.alice, 1n);

    await expectBlocked(fixture.token);
    expect(await read(fixture.vault, "hasPendingSolvencyCheckpoint")).to.equal(true);
  });

  it("blocks adapter activation from a token callback during deposit", async function () {
    const fixture = await deployFixture();
    await proveSolvency(fixture.vault);
    const next = await (
      await ethers.getContractFactory("MockYieldAdapter")
    ).deploy(await fixture.token.getAddress(), fixture.owner.address);
    await next.waitForDeployment();
    await write(next, "setVault", [await fixture.vault.getAddress()]);
    await write(fixture.vault, "proposeAdapter", [await next.getAddress()]);
    await time.increase((await read(fixture.vault, "ADAPTER_DELAY")) as bigint);

    await arm(fixture.token, fixture.vault, fixture.vault.interface.encodeFunctionData("activateAdapter"));
    await mintAndDeposit(fixture, fixture.alice, 1n);

    await expectBlocked(fixture.token);
    expect(await read(fixture.vault, "activeAdapter")).to.equal(await fixture.adapter.getAddress());
  });

  it("blocks draw-state cross-entry during harvest and rejects callback crank attempts", async function () {
    const fixture = await deployFixture();
    await proveSolvency(fixture.vault);
    for (const user of fixture.users.slice(0, 5)) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1_000n]);
    await write(fixture.draw, "openDraw", [true]);
    const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    await time.increaseTo(opened.tEnd + ((await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint));
    await write(fixture.draw, "preSyncA", [4n]);
    await write(fixture.draw, "preSyncA", [1n]);
    await write(fixture.draw, "crankA", [3n]);
    await write(fixture.draw, "crankA", [2n]);

    const swept = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    const handles = [asHandle(swept.cumRunning), asHandle(swept.cumBaseRiskRunning), asHandle(swept.cumYieldRunning)];
    const decrypted = await fhevm.publicDecrypt(handles);
    await arm(fixture.token, fixture.draw, fixture.draw.interface.encodeFunctionData("enterReveal"));
    await write(fixture.draw, "submitTotals", [decrypted.abiEncodedClearValues, decrypted.decryptionProof]);
    await expectBlocked(fixture.token);
    expect(await read(fixture.draw, "state")).to.equal(3n);

    await write(fixture.draw, "enterReveal");

    await arm(fixture.token, fixture.draw, fixture.draw.interface.encodeFunctionData("crankA", [1n]));
    const request = await fhevm
      .createEncryptedInput(await fixture.vault.getAddress(), fixture.alice.address)
      .add64(1n)
      .encrypt();
    await write(fixture.vault.connect(fixture.alice) as BaseContract, "deposit", [
      request.handles[0],
      request.inputProof,
    ]);
    await expectBlocked(fixture.token);
  });
});
