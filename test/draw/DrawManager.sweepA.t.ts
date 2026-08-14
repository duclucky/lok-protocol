import { expect } from "chai";
import { BaseContract, Result } from "ethers";
import { fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { NON_DUST_DEPOSIT, asHandle, deployDrawFixture, mintAndDeposit, read, write } from "./helpers";

type DrawInfo = Result & {
  tEnd: bigint;
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
};

async function moveToSweepTime(draw: BaseContract): Promise<DrawInfo> {
  const info = (await read(draw, "drawInfo", [1n])) as DrawInfo;
  const delay = (await read(draw, "MIN_SETTLE_DELAY")) as bigint;
  await time.increaseTo(info.tEnd + delay);
  return info;
}

async function decryptTotals(draw: BaseContract): Promise<bigint[]> {
  const info = (await read(draw, "drawInfo", [1n])) as DrawInfo;
  const handles = [asHandle(info.cumRunning), asHandle(info.cumBaseRiskRunning), asHandle(info.cumYieldRunning)];
  const result = await fhevm.publicDecrypt(handles);
  return handles.map((handle) => result.clearValues[handle] as bigint);
}

async function preSyncSnapshot(fixture: Awaited<ReturnType<typeof deployDrawFixture>>): Promise<void> {
  await write(fixture.draw, "preSyncA", [4n]);
  await write(fixture.draw, "preSyncA", [4n]);
}

async function finalizeExitDuringDraw(
  fixture: Awaited<ReturnType<typeof deployDrawFixture>>,
  user: (typeof fixture)["alice"],
): Promise<void> {
  await write(fixture.vault.connect(user) as BaseContract, "exit");
  const requestId = (await read(fixture.vault, "pendingExitRequest", [user.address])) as `0x${string}`;
  const decrypted = await fhevm.publicDecrypt([requestId]);
  await write(fixture.vault, "finalizeExit", [
    requestId,
    decrypted.clearValues[requestId] as bigint,
    decrypted.decryptionProof,
  ]);
}

describe("LokDrawManager PASS A", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("exposes the frozen Sepolia 60% batch caps", async function () {
    const fixture = await deployDrawFixture();
    expect(await read(fixture.draw, "batchCaps")).to.deep.equal([3n, 2n]);
  });

  it("rejects early, zero, and oversized crank requests without moving the cursor", async function () {
    const fixture = await deployDrawFixture();
    await mintAndDeposit(fixture, fixture.alice, NON_DUST_DEPOSIT);
    await write(fixture.draw, "openDraw", [false]);

    await expect(fixture.draw.getFunction("crankA")(1n)).to.be.revertedWithCustomError(fixture.draw, "TooEarly");
    await moveToSweepTime(fixture.draw);
    await expect(fixture.draw.getFunction("crankA")(0n)).to.be.revertedWithCustomError(fixture.draw, "BatchOutOfRange");
    await expect(fixture.draw.getFunction("crankA")(4n)).to.be.revertedWithCustomError(fixture.draw, "BatchOutOfRange");
    expect(await read(fixture.draw, "cursor")).to.equal(0n);
  });

  it("processes each snapshotted participant exactly once across bounded batches", async function () {
    const fixture = await deployDrawFixture();
    for (const user of fixture.users.slice(0, 5)) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
    await write(fixture.draw, "openDraw", [false]);
    await moveToSweepTime(fixture.draw);
    await preSyncSnapshot(fixture);

    await write(fixture.draw, "crankA", [3n]);
    expect(await read(fixture.draw, "state")).to.equal(2n);
    expect(await read(fixture.draw, "cursor")).to.equal(3n);
    expect(await read(fixture.draw, "remainingInSweep")).to.equal(2n);
    await write(fixture.draw, "crankA", [3n]);

    expect(await read(fixture.draw, "state")).to.equal(3n);
    expect(await read(fixture.draw, "cursor")).to.equal(5n);
    const [effective, baseRisk, yieldWeight] = await decryptTotals(fixture.draw);
    expect(effective).to.equal(baseRisk);
    expect(baseRisk).to.equal(yieldWeight);
    expect(yieldWeight).to.be.greaterThan(0n);
  });

  it("masks all approved totals to zero below the five-non-dust anonymity floor", async function () {
    const fixture = await deployDrawFixture();
    await mintAndDeposit(fixture, fixture.alice, 1_000_000n);
    await mintAndDeposit(fixture, fixture.bob, 1_000_000n);
    await write(fixture.draw, "openDraw", [false]);
    await moveToSweepTime(fixture.draw);
    await write(fixture.draw, "preSyncA", [2n]);
    await write(fixture.draw, "crankA", [2n]);

    expect(await decryptTotals(fixture.draw)).to.deep.equal([0n, 0n, 0n]);
  });

  it("does not let PASS A overtake the independently pre-synced cursor", async function () {
    const fixture = await deployDrawFixture();
    await mintAndDeposit(fixture, fixture.alice, 1_000_000n);
    await mintAndDeposit(fixture, fixture.bob, 1_000_000n);
    await write(fixture.draw, "openDraw", [false]);
    await moveToSweepTime(fixture.draw);

    await write(fixture.draw, "preSyncA", [1n]);
    await expect(fixture.draw.getFunction("crankA")(2n)).to.be.revertedWithCustomError(
      fixture.draw,
      "ParticipantsNotSynced",
    );
    expect(await read(fixture.draw, "cursor")).to.equal(0n);
  });

  it("keeps the open-draw participant snapshot stable when an exit finalizes", async function () {
    const fixture = await deployDrawFixture();
    for (const user of fixture.users.slice(0, 5)) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
    await write(fixture.draw, "openDraw", [false]);

    await finalizeExitDuringDraw(fixture, fixture.alice);
    expect(await read(fixture.vault, "participantCount")).to.equal(5n);
    expect(await read(fixture.vault, "participantAt", [0n])).to.equal(fixture.alice.address);

    const deadline = (await read(fixture.draw, "stateDeadline")) as bigint;
    await time.increaseTo(deadline);
    await write(fixture.draw, "abortDraw");
    await write(fixture.vault, "finalizeParticipantRemoval", [fixture.alice.address]);
    expect(await read(fixture.vault, "participantCount")).to.equal(4n);
  });
});
