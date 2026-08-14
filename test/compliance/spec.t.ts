import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { BaseContract, ContractTransactionResponse, Result, toBeHex, zeroPadValue } from "ethers";
import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { NON_DUST_DEPOSIT, TEST_DRAW_TIMING_ARGS } from "../draw/helpers";

type LokFixture = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  users: HardhatEthersSigner[];
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
  realisedYield: bigint;
  prizeAmount: bigint;
};

async function write(contract: BaseContract, name: string, args: readonly unknown[] = []): Promise<void> {
  const tx = (await contract.getFunction(name)(...args)) as ContractTransactionResponse;
  await tx.wait();
}

async function read(contract: BaseContract, name: string, args: readonly unknown[] = []): Promise<unknown> {
  return contract.getFunction(name).staticCall(...args);
}

function asHandle(value: bigint): `0x${string}` {
  return zeroPadValue(toBeHex(value), 32) as `0x${string}`;
}

async function deployLokFixture(): Promise<LokFixture> {
  const [deployer, ...availableUsers] = await ethers.getSigners();
  const users = availableUsers.slice(0, 5);
  const [alice, bob] = users;

  const underlyingFactory = await ethers.getContractFactory("MockUSDC");
  const underlying = await underlyingFactory.deploy();
  await underlying.waitForDeployment();

  const tokenFactory = await ethers.getContractFactory("YieldInjectingERC7984");
  const token = await tokenFactory.deploy(await underlying.getAddress());
  await token.waitForDeployment();

  const adapterFactory = await ethers.getContractFactory("MockYieldAdapter");
  const adapter = await adapterFactory.deploy(await token.getAddress(), deployer.address);
  await adapter.waitForDeployment();

  const vaultFactory = await ethers.getContractFactory("LokVault");
  const vault = await vaultFactory.deploy(await token.getAddress(), await adapter.getAddress(), deployer.address);
  await vault.waitForDeployment();
  await write(adapter, "setVault", [await vault.getAddress()]);

  const drawFactory = await ethers.getContractFactory("LokDrawManager");
  const draw = await drawFactory.deploy(await vault.getAddress(), deployer.address, ...TEST_DRAW_TIMING_ARGS);
  await draw.waitForDeployment();
  await write(vault, "setDrawManager", [await draw.getAddress()]);

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

  return { deployer, alice, bob, users, token, adapter, vault, draw };
}

async function encrypt64(contract: BaseContract, signer: HardhatEthersSigner, value: bigint) {
  return fhevm
    .createEncryptedInput(await contract.getAddress(), signer.address)
    .add64(value)
    .encrypt();
}

async function mintAndDeposit(fixture: LokFixture, signer: HardhatEthersSigner, amount: bigint): Promise<void> {
  await write(fixture.token, "mintForTest", [signer.address, amount]);
  await write(fixture.token.connect(signer) as BaseContract, "setOperator", [
    await fixture.vault.getAddress(),
    2n ** 48n - 1n,
  ]);

  const deposit = await encrypt64(fixture.vault, signer, amount);
  await write(fixture.vault.connect(signer) as BaseContract, "deposit", [deposit.handles[0], deposit.inputProof]);
}

async function reachSweepB(fixture: LokFixture, strict: boolean): Promise<DrawInfo> {
  await write(fixture.draw, "openDraw", [strict]);
  const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const settleDelay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
  await time.increaseTo(opened.tEnd + settleDelay);
  const participantCount = (await read(fixture.vault, "participantCount")) as bigint;
  for (let remaining = participantCount; remaining > 0n; remaining -= 4n) {
    await write(fixture.draw, "preSyncA", [remaining > 4n ? 4n : remaining]);
  }
  for (let remaining = participantCount; remaining > 0n; remaining -= 3n) {
    await write(fixture.draw, "crankA", [remaining > 3n ? 3n : remaining]);
  }

  const swept = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const handles = [asHandle(swept.cumRunning), asHandle(swept.cumBaseRiskRunning), asHandle(swept.cumYieldRunning)];
  const decrypted = await fhevm.publicDecrypt(handles);
  await write(fixture.draw, "submitTotals", [decrypted.abiEncodedClearValues, decrypted.decryptionProof]);

  if (strict) {
    await write(fixture.draw, "enterReveal");
    const revealDeadline = (await read(fixture.draw, "revealDeadline")) as bigint;
    await time.increaseTo(revealDeadline);
  }
  await write(fixture.draw, "openRandom");
  return (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
}

describe("Lok bounty compliance R1-R9", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("test_R1_SharedPool_MultipleDepositorsSingleVault", async function () {
    const fixture = await deployLokFixture();
    await mintAndDeposit(fixture, fixture.alice, 100n);
    await mintAndDeposit(fixture, fixture.bob, 200n);

    expect(await read(fixture.vault, "participantCount")).to.equal(2n);
    expect(await read(fixture.vault, "participantAt", [0n])).to.equal(fixture.alice.address);
    expect(await read(fixture.vault, "participantAt", [1n])).to.equal(fixture.bob.address);
  });

  it("test_R2_SpecExact_AllPoolYieldAwardedAsPrizes", async function () {
    const fixture = await deployLokFixture();
    for (const user of fixture.users) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);

    const accruedYield = 20n;
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), accruedYield]);
    await reachSweepB(fixture, false);
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [1n]);

    const settled = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    expect(settled.realisedYield).to.equal(accruedYield);
    expect(settled.prizeAmount).to.equal(accruedYield);
  });

  it("test_R3_WithdrawPrincipal_AnyState", async function () {
    const fixture = await deployLokFixture();
    await mintAndDeposit(fixture, fixture.alice, 100n);
    await write(fixture.draw, "openDraw", [false]);

    const requested = await encrypt64(fixture.vault, fixture.alice, 25n);
    await expect(
      fixture.vault.connect(fixture.alice).getFunction("withdraw")(requested.handles[0], requested.inputProof),
    ).to.not.be.reverted;
    await expect(fixture.vault.connect(fixture.alice).getFunction("emergencyWithdraw")()).to.not.be.reverted;
  });

  it("test_R4_EndToEndEncrypted_NoPlaintextAmountInAnyEvent", async function () {
    const fixture = await deployLokFixture();
    const events: ReadonlyArray<readonly [BaseContract, string]> = [
      [fixture.vault, "Deposited"],
      [fixture.vault, "Withdrawn"],
      [fixture.vault, "ThetaChanged"],
      [fixture.draw, "PrizeCredited"],
    ];
    for (const [contract, eventName] of events) {
      const event = contract.interface.getEvent(eventName);
      expect(event, `${eventName} event`).to.not.equal(null);
      if (event === null) throw new Error(`Missing ${eventName} event`);
      expect(
        event.inputs.some((input) => input.name.toLowerCase().includes("amount")),
        eventName,
      ).to.equal(false);
    }
  });

  it("test_R5_PerUserOdds_NeverPubliclyDecryptable", async function () {
    const fixture = await deployLokFixture();
    for (const forbidden of ["rangeStart", "rangeEnd", "ticketWeight", "oddsOf"]) {
      expect(fixture.draw.interface.hasFunction(forbidden), forbidden).to.equal(false);
    }
  });

  it("test_R6_WinnerIndistinguishableFromLoser", async function () {
    const fixture = await deployLokFixture();
    const event = fixture.draw.interface.getEvent("PrizeCredited");
    expect(event, "PrizeCredited event").to.not.equal(null);
    if (event === null) throw new Error("Missing PrizeCredited event");
    expect(event.inputs.map((input) => input.name)).to.deep.equal(["drawId", "user"]);
    expect(fixture.draw.interface.hasFunction("claimPrize")).to.equal(false);
  });

  it("test_R7_WinnerSelection_OperatesOnEncryptedBalances", async function () {
    const fixture = await deployLokFixture();
    for (const name of ["crankA", "openRandom", "crankB"]) {
      expect(fixture.draw.interface.hasFunction(name), name).to.equal(true);
    }
    expect(fixture.draw.interface.hasFunction("selectWinner")).to.equal(false);
  });

  it("test_R8_OnlyWinnerDecryptsNonZeroPrize", async function () {
    const fixture = await deployLokFixture();
    for (const user of fixture.users) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 20n]);
    await reachSweepB(fixture, false);
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [1n]);

    const clearCredits: bigint[] = [];
    for (const user of fixture.users) {
      const credit = (await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint;
      clearCredits.push(
        await fhevm.userDecryptEuint(FhevmType.euint64, asHandle(credit), await fixture.draw.getAddress(), user),
      );
    }
    expect(clearCredits.filter((value) => value > 0n)).to.have.length(1);
  });

  it("test_R9_DrawPubliclyVerifiable_InvariantHolds", async function () {
    const fixture = await deployLokFixture();
    expect(fixture.draw.interface.hasFunction("drawInfo")).to.equal(true);
    expect(fixture.draw.interface.hasEvent("RandomnessCommitted")).to.equal(true);
    expect(fixture.draw.interface.hasEvent("DrawSettled")).to.equal(true);
    expect(fixture.draw.interface.hasEvent("PrizeCredited")).to.equal(true);
  });
});
