import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { Result } from "ethers";
import { fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { NON_DUST_DEPOSIT, asHandle, deployDrawFixture, mintAndDeposit, read, write } from "./helpers";
import { forceDrawRandom } from "./forced-random";
import { findFunction, loadSourceAst, outcomeBindingShape, type AstNode, walkAst } from "../ast/solidity";

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
    await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
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
  const currentDrawId = (await read(draw, "drawId")) as bigint;
  const info = (await read(draw, "drawInfo", [currentDrawId])) as DrawInfo;
  const handles = [asHandle(info.cumRunning), asHandle(info.cumBaseRiskRunning), asHandle(info.cumYieldRunning)];
  const decrypted = await fhevm.publicDecrypt(handles);
  return {
    cleartexts: decrypted.abiEncodedClearValues,
    proof: decrypted.decryptionProof,
    totals: handles.map((handle) => decrypted.clearValues[handle] as bigint),
  };
}

async function passAResult(
  fixture: Awaited<ReturnType<typeof reachAwaitTotal>>,
  preSyncBatches: bigint[],
  crankBatches: bigint[],
) {
  for (const batch of preSyncBatches) await write(fixture.draw, "preSyncA", [batch]);
  for (const batch of crankBatches) await write(fixture.draw, "crankA", [batch]);
  const proof = await totalsProof(fixture.draw);
  await write(fixture.draw, "submitTotals", [proof.cleartexts, proof.proof]);
  const currentDrawId = (await read(fixture.draw, "drawId")) as bigint;
  const info = (await read(fixture.draw, "drawInfo", [currentDrawId])) as DrawInfo;
  const participants: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    participants.push((await read(fixture.vault, "participantAt", [BigInt(index)])) as string);
  }
  return {
    participants,
    totals: [info.totalTickets, info.totalBaseRiskWeight, info.totalYieldWeight],
    realisedYield: info.realisedYield,
    prizeAmount: info.prizeAmount,
    directRate: info.directRate,
    state: await read(fixture.draw, "state"),
  };
}

async function passBResult(fixture: Awaited<ReturnType<typeof reachAwaitTotal>>, batches: bigint[]) {
  for (const batch of batches) await write(fixture.draw, "crankB", [batch]);
  const credits: bigint[] = [];
  const directCredits: bigint[] = [];
  const fortunes: bigint[] = [];
  for (const user of fixture.users.slice(0, 5)) {
    const creditHandle = asHandle((await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint);
    const credit = await fhevm.userDecryptEuint(FhevmType.euint64, creditHandle, await fixture.draw.getAddress(), user);
    credits.push(credit);
    const balanceHandle = asHandle((await read(fixture.vault, "confidentialBalanceOf", [user.address])) as bigint);
    const balance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balanceHandle,
      await fixture.vault.getAddress(),
      user,
    );
    directCredits.push(balance - NON_DUST_DEPOSIT - credit);
    const fortuneHandle = asHandle((await read(fixture.vault, "fortuneOf", [user.address])) as bigint);
    fortunes.push(
      await fhevm.userDecryptEuint(FhevmType.euint16, fortuneHandle, await fixture.vault.getAddress(), user),
    );
  }
  const info = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  return {
    winnerIndex: credits.findIndex((credit) => credit !== 0n),
    credits,
    directCredits,
    fortunes,
    prizeAmount: info.prizeAmount,
    settled: info.settled,
    state: await read(fixture.draw, "state"),
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

  it("refines identical PASS A totals across varied valid batch partitions", async function () {
    const variants = [
      { pre: [4n, 1n], crank: [3n, 2n] },
      { pre: [1n, 4n], crank: [1n, 1n, 3n] },
      { pre: [2n, 3n], crank: [2n, 2n, 1n] },
      { pre: [3n, 2n], crank: [1n, 3n, 1n] },
    ];
    let expected: Awaited<ReturnType<typeof passAResult>> | undefined;
    for (const variant of variants) {
      const fixture = await deployDrawFixture();
      for (const user of fixture.users.slice(0, 5)) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
      await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1_003n]);
      await write(fixture.draw, "openDraw", [false]);
      const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
      await time.increaseTo(opened.tEnd + ((await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint));
      const actual = await passAResult(fixture, variant.pre, variant.crank);
      if (expected === undefined) expected = actual;
      else expect(actual).to.deep.equal(expected);
    }
  });

  it("refines identical winner, prize, direct credits, and completion across PASS B partitions", async function () {
    const variants = [
      [2n, 2n, 1n],
      [1n, 2n, 2n],
      [1n, 1n, 1n, 1n, 1n],
      [2n, 1n, 2n],
    ];
    let expected: Awaited<ReturnType<typeof passBResult>> | undefined;
    for (const variant of variants) {
      const fixture = await reachAwaitTotal(5, 1_003n);
      const proof = await totalsProof(fixture.draw);
      await write(fixture.draw, "submitTotals", [proof.cleartexts, proof.proof]);
      await write(fixture.draw, "openRandom");
      await forceDrawRandom(fixture.draw, 1n, 0n);
      const actual = await passBResult(fixture, variant);
      if (expected === undefined) expected = actual;
      else expect(actual).to.deep.equal(expected);
    }
  });

  it("submits every representable invalid input class and preserves protected state", async function () {
    const fixture = await reachAwaitTotal(5, 1_000n);
    const proof = await totalsProof(fixture.draw);
    const protectedState = async () => ({
      state: await read(fixture.draw, "state"),
      cursor: await read(fixture.draw, "cursor"),
      drawId: await read(fixture.draw, "drawId"),
      info: await read(fixture.draw, "drawInfo", [1n]),
    });
    const before = await protectedState();

    await expect(fixture.draw.getFunction("submitTotals")("0x", "0x")).to.be.reverted;
    expect(await protectedState()).to.deep.equal(before);
    await expect(fixture.draw.getFunction("submitTotals")(proof.cleartexts, tamperLastByte(proof.proof))).to.be
      .reverted;
    expect(await protectedState()).to.deep.equal(before);
    await expect(fixture.draw.getFunction("crankB")(1n)).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    expect(await protectedState()).to.deep.equal(before);
    await expect(fixture.draw.getFunction("openRandom")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    expect(await protectedState()).to.deep.equal(before);

    const crankAInputs = fixture.draw.interface.getFunction("crankA")?.inputs.map((input) => input.name);
    const crankBInputs = fixture.draw.interface.getFunction("crankB")?.inputs.map((input) => input.name);
    const randomInputs = fixture.draw.interface.getFunction("openRandom")?.inputs;
    expect(crankAInputs).to.deep.equal(["batch"]);
    expect(crankBInputs).to.deep.equal(["batch"]);
    expect(randomInputs).to.have.length(0);
    expect(fixture.draw.interface.getFunction("submitTotals")?.inputs.map((input) => input.name)).to.deep.equal([
      "abiEncodedCleartexts",
      "decryptionProof",
    ]);
  });

  it("binds decoded totals to current aggregate handles and catches a caller-steering mutation", function () {
    const submitTotals = findFunction(loadSourceAst("contracts/LokDrawManager.sol"), "submitTotals");
    expect(outcomeBindingShape(submitTotals)).to.deep.equal({
      signedCurrentAggregateHandles: ["cumBaseRiskRunning", "cumRunning", "cumYieldRunning"],
      decodedAssignments: ["totalBaseRiskWeight", "totalTickets", "totalYieldWeight"],
    });

    const mutant = structuredClone(submitTotals) as AstNode;
    let mutated = false;
    walkAst(mutant, (node) => {
      if (mutated || node.nodeType !== "Assignment") return;
      const left = node.leftHandSide as AstNode | undefined;
      const right = node.rightHandSide as AstNode | undefined;
      if (left?.nodeType === "MemberAccess" && left.memberName === "totalTickets" && right?.nodeType === "Identifier") {
        right.name = "callerTotal";
        mutated = true;
      }
    });
    expect(mutated).to.equal(true);
    expect(outcomeBindingShape(mutant).decodedAssignments).to.not.include("totalTickets");
  });
});
