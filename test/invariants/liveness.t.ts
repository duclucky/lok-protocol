import { expect } from "chai";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BaseContract, Result, ZeroAddress } from "ethers";
import { ethers, fhevm } from "hardhat";

import {
  asHandle,
  deployDrawFixture,
  mintAndDeposit,
  NON_DUST_DEPOSIT,
  read,
  TEST_DRAW_TIMING_ARGS,
  write,
  type DrawFixture,
} from "../draw/helpers";

type DrawInfo = Result & {
  tEnd: bigint;
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
};

async function depositOne(fixture: DrawFixture): Promise<void> {
  const encrypted = await fhevm
    .createEncryptedInput(await fixture.vault.getAddress(), fixture.alice.address)
    .add64(1n)
    .encrypt();
  await write(fixture.vault.connect(fixture.alice) as BaseContract, "deposit", [
    encrypted.handles[0],
    encrypted.inputProof,
  ]);
}

async function completePassA(fixture: DrawFixture): Promise<DrawInfo> {
  const opened = (await read(fixture.draw, "drawInfo", [await read(fixture.draw, "drawId")])) as DrawInfo;
  const delay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
  await time.increaseTo(opened.tEnd + delay);
  await write(fixture.draw, "preSyncA", [4n]);
  await write(fixture.draw, "preSyncA", [1n]);
  await write(fixture.draw, "crankA", [3n]);
  await write(fixture.draw, "crankA", [2n]);
  return (await read(fixture.draw, "drawInfo", [await read(fixture.draw, "drawId")])) as DrawInfo;
}

async function submitCurrentTotals(fixture: DrawFixture, info: DrawInfo): Promise<void> {
  const handles = [asHandle(info.cumRunning), asHandle(info.cumBaseRiskRunning), asHandle(info.cumYieldRunning)];
  const totals = await fhevm.publicDecrypt(handles);
  await write(fixture.draw, "submitTotals", [totals.abiEncodedClearValues, totals.decryptionProof]);
}

describe("Lok liveness boundaries", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("test_Deposit_DuringEveryState", async function () {
    this.timeout(120_000);
    const fixture = await deployDrawFixture();
    for (const user of fixture.users.slice(0, 5)) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
    await write(fixture.token, "mintForTest", [fixture.alice.address, 20n]);

    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(0n);

    await write(fixture.draw, "openDraw", [false]);
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(1n);

    const first = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    const delay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
    await time.increaseTo(first.tEnd + delay);
    await expect(fixture.draw.getFunction("preSyncA")(0n)).to.be.revertedWithCustomError(
      fixture.draw,
      "BatchOutOfRange",
    );
    await expect(fixture.draw.getFunction("preSyncA")(5n)).to.be.revertedWithCustomError(
      fixture.draw,
      "BatchOutOfRange",
    );
    await write(fixture.draw, "preSyncA", [4n]);
    await write(fixture.draw, "preSyncA", [1n]);
    await write(fixture.draw, "crankA", [3n]);
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(2n);

    await write(fixture.draw, "crankA", [2n]);
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(3n);

    const passA = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    await submitCurrentTotals(fixture, passA);
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(5n);

    await write(fixture.draw, "openRandom");
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(6n);

    await write(fixture.draw, "crankB", [2n]);
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(6n);
    await write(fixture.draw, "crankB", [2n]);
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(6n);
    await write(fixture.draw, "crankB", [1n]);
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(7n);

    await write(fixture.draw, "openDraw", [true]);
    const second = (await read(fixture.draw, "drawInfo", [2n])) as DrawInfo;
    await time.increaseTo(second.tEnd);
    await expect(fixture.draw.getFunction("commitEntropy")("0x" + "00".repeat(32))).to.be.revertedWithCustomError(
      fixture.draw,
      "TooEarly",
    );
    const secondPassA = await completePassA(fixture);
    await submitCurrentTotals(fixture, secondPassA);
    await expect(fixture.draw.getFunction("openRandom")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await write(fixture.draw, "enterReveal");
    await depositOne(fixture);
    expect(await read(fixture.draw, "state")).to.equal(4n);
  });

  it("rejects invalid state, deadline, and batch transitions without moving funds", async function () {
    const fixture = await deployDrawFixture();
    const outsiderDraw = fixture.draw.connect(fixture.bob) as BaseContract;
    const drawFactory = await ethers.getContractFactory("LokDrawManager");
    await expect(
      drawFactory.deploy(ZeroAddress, fixture.owner.address, ...TEST_DRAW_TIMING_ARGS),
    ).to.be.revertedWithCustomError(drawFactory, "InvalidAddress");

    await expect(fixture.draw.getFunction("abortDraw")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("preSyncA")(1n)).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("crankA")(1n)).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("submitTotals")("0x", "0x")).to.be.revertedWithCustomError(
      fixture.draw,
      "InvalidState",
    );
    await expect(fixture.draw.getFunction("enterReveal")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("openRandom")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("crankB")(1n)).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(outsiderDraw.getFunction("pauseDraws")()).to.be.reverted;
    await write(fixture.draw, "pauseDraws");
    await expect(fixture.draw.getFunction("openDraw")(false)).to.be.revertedWithCustomError(
      fixture.draw,
      "DrawsPaused",
    );
    await expect(outsiderDraw.getFunction("unpauseDraws")()).to.be.reverted;
    await write(fixture.draw, "unpauseDraws");

    await write(fixture.draw, "openDraw", [false]);
    await expect(fixture.draw.getFunction("openDraw")(false)).to.be.revertedWithCustomError(
      fixture.draw,
      "InvalidState",
    );
    await expect(fixture.draw.getFunction("commitEntropy")("0x" + "00".repeat(32))).to.be.revertedWithCustomError(
      fixture.draw,
      "InvalidState",
    );
    const zeroBytes = "0x" + "00".repeat(32);
    await expect(fixture.draw.getFunction("revealEntropy")(zeroBytes, zeroBytes)).to.be.revertedWithCustomError(
      fixture.draw,
      "InvalidState",
    );
    await expect(fixture.draw.getFunction("preSyncA")(1n)).to.be.revertedWithCustomError(fixture.draw, "TooEarly");
    await expect(fixture.draw.getFunction("crankA")(1n)).to.be.revertedWithCustomError(fixture.draw, "TooEarly");

    const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    const delay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
    await time.increaseTo(opened.tEnd + delay);
    await expect(fixture.draw.getFunction("preSyncA")(1n)).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("crankA")(0n)).to.be.revertedWithCustomError(fixture.draw, "BatchOutOfRange");
    await expect(fixture.draw.getFunction("crankA")(4n)).to.be.revertedWithCustomError(fixture.draw, "BatchOutOfRange");
    await write(fixture.draw, "crankA", [1n]);
    await expect(fixture.draw.getFunction("crankA")(1n)).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("submitTotals")("0x", "0x")).to.be.revertedWithCustomError(
      fixture.draw,
      "InvalidCleartextLength",
    );
    await expect(fixture.draw.getFunction("enterReveal")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("openRandom")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await expect(fixture.draw.getFunction("abortDraw")()).to.be.revertedWithCustomError(
      fixture.draw,
      "StateDeadlineActive",
    );
    await time.increaseTo((await read(fixture.draw, "stateDeadline")) as bigint);
    await write(fixture.draw, "abortDraw");
    expect(await read(fixture.draw, "state")).to.equal(0n);
  });
});
