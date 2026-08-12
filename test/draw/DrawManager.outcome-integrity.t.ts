import { expect } from "chai";
import { Result } from "ethers";
import { fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { asHandle, deployDrawFixture, mintAndDeposit, read, write } from "./helpers";

type DrawInfo = Result & {
  tEnd: bigint;
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
  totalTickets: bigint;
  totalBaseRiskWeight: bigint;
  totalYieldWeight: bigint;
  realisedYield: bigint;
  prizeAmount: bigint;
  directRate: bigint;
  settled: boolean;
};

type TotalsProof = {
  cleartexts: string;
  proof: string;
  totals: bigint[];
};

function tamperLastByte(value: string): string {
  const finalByte = value.slice(-2);
  return `${value.slice(0, -2)}${finalByte === "00" ? "01" : "00"}`;
}

async function reachAwaitTotal(participantCount: number, yieldAmount = 0n, zeroTheta = false) {
  const fixture = await deployDrawFixture();
  for (const user of fixture.users.slice(0, participantCount)) {
    await mintAndDeposit(fixture, user, 1_000_000n);
    if (zeroTheta) {
      const encrypted = await fhevm
        .createEncryptedInput(await fixture.vault.getAddress(), user.address)
        .add8(0n)
        .encrypt();
      await write(fixture.vault.connect(user), "setTheta", [encrypted.handles[0], encrypted.inputProof]);
    }
  }
  if (yieldAmount !== 0n) {
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), yieldAmount]);
  }

  await write(fixture.draw, "openDraw", [false]);
  const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const settleDelay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
  await time.increaseTo(opened.tEnd + settleDelay);
  for (let remaining = participantCount; remaining > 0; remaining -= 4) {
    await write(fixture.draw, "preSyncA", [BigInt(Math.min(remaining, 4))]);
  }
  for (let remaining = participantCount; remaining > 0; remaining -= 3) {
    await write(fixture.draw, "crankA", [BigInt(Math.min(remaining, 3))]);
  }
  return fixture;
}

async function totalsProof(draw: Awaited<ReturnType<typeof reachAwaitTotal>>["draw"]): Promise<TotalsProof> {
  const info = (await read(draw, "drawInfo", [1n])) as DrawInfo;
  const handles = [asHandle(info.cumRunning), asHandle(info.cumBaseRiskRunning), asHandle(info.cumYieldRunning)];
  const decrypted = await fhevm.publicDecrypt(handles);
  return {
    cleartexts: decrypted.abiEncodedClearValues,
    proof: decrypted.decryptionProof,
    totals: handles.map((handle) => decrypted.clearValues[handle] as bigint),
  };
}

describe("LokDrawManager outcome integrity", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("accepts only the proof-bound aggregate totals and sizes the funded credits", async function () {
    const fixture = await reachAwaitTotal(5, 1_000n);
    const decrypted = await totalsProof(fixture.draw);

    await write(fixture.draw, "submitTotals", [decrypted.cleartexts, decrypted.proof]);

    const info = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    expect([info.totalTickets, info.totalBaseRiskWeight, info.totalYieldWeight]).to.deep.equal(decrypted.totals);
    expect(info.realisedYield).to.equal(1_000n);
    expect(info.prizeAmount).to.equal((1_000n * decrypted.totals[1]) / decrypted.totals[2]);
    const scale = (await read(fixture.draw, "TICKET_SCALE_BITS")) as bigint;
    expect(info.directRate).to.equal((1_000n << scale) / decrypted.totals[2]);
    expect(await read(fixture.draw, "state")).to.equal(5n);
  });

  it("rejects a forged proof and does not consume the pending totals", async function () {
    const fixture = await reachAwaitTotal(5);
    const decrypted = await totalsProof(fixture.draw);

    await expect(fixture.draw.getFunction("submitTotals")(decrypted.cleartexts, tamperLastByte(decrypted.proof))).to.be
      .reverted;
    expect(await read(fixture.draw, "state")).to.equal(3n);
  });

  it("rejects duplicate total submission after an authentic proof is consumed", async function () {
    const fixture = await reachAwaitTotal(5);
    const decrypted = await totalsProof(fixture.draw);
    await write(fixture.draw, "submitTotals", [decrypted.cleartexts, decrypted.proof]);

    await expect(
      fixture.draw.getFunction("submitTotals")(decrypted.cleartexts, decrypted.proof),
    ).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
  });

  it("voids a masked W=0 draw without harvesting or evaluating a denominator", async function () {
    const fixture = await reachAwaitTotal(2, 500n);
    const decrypted = await totalsProof(fixture.draw);
    expect(decrypted.totals).to.deep.equal([0n, 0n, 0n]);

    await write(fixture.draw, "submitTotals", [decrypted.cleartexts, decrypted.proof]);

    const info = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    expect(info.realisedYield).to.equal(0n);
    expect(info.settled).to.equal(true);
    expect(await read(fixture.adapter, "fundedYieldInAdapter")).to.equal(500n);
    expect(await read(fixture.draw, "state")).to.equal(0n);
  });

  it("voids a zero-participant draw instead of leaving the machine stuck in OPEN", async function () {
    const fixture = await deployDrawFixture();
    await write(fixture.draw, "openDraw", [false]);
    const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    const settleDelay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
    await time.increaseTo(opened.tEnd + settleDelay);

    await write(fixture.draw, "crankA", [1n]);
    const decrypted = await totalsProof(fixture.draw);
    expect(decrypted.totals).to.deep.equal([0n, 0n, 0n]);
    await write(fixture.draw, "submitTotals", [decrypted.cleartexts, decrypted.proof]);
    expect(await read(fixture.draw, "state")).to.equal(0n);
  });

  it("settles W>0 and E=0 through direct credits without generating randomness", async function () {
    const fixture = await reachAwaitTotal(5, 1_000n, true);
    const decrypted = await totalsProof(fixture.draw);
    expect(decrypted.totals[0]).to.equal(0n);
    expect(decrypted.totals[2]).to.be.greaterThan(0n);

    await write(fixture.draw, "submitTotals", [decrypted.cleartexts, decrypted.proof]);
    expect(await read(fixture.draw, "state")).to.equal(6n);
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [1n]);

    const settled = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    expect(settled.prizeAmount).to.equal(0n);
    expect(settled.settled).to.equal(true);
    expect(await read(fixture.draw, "state")).to.equal(7n);
  });

  it("rejects a proof bound to aggregate handles from an aborted prior draw", async function () {
    const fixture = await reachAwaitTotal(5);
    const stale = await totalsProof(fixture.draw);
    const deadline = (await read(fixture.draw, "stateDeadline")) as bigint;
    await time.increaseTo(deadline);
    await write(fixture.draw, "abortDraw");

    await write(fixture.draw, "openDraw", [false]);
    const opened = (await read(fixture.draw, "drawInfo", [2n])) as DrawInfo;
    const settleDelay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
    await time.increaseTo(opened.tEnd + settleDelay);
    await write(fixture.draw, "preSyncA", [4n]);
    await write(fixture.draw, "preSyncA", [1n]);
    await write(fixture.draw, "crankA", [3n]);
    await write(fixture.draw, "crankA", [2n]);

    await expect(fixture.draw.getFunction("submitTotals")(stale.cleartexts, stale.proof)).to.be.reverted;
    expect(await read(fixture.draw, "state")).to.equal(3n);
  });
});
