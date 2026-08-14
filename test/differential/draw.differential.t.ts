import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BaseContract, Result } from "ethers";
import { fhevm } from "hardhat";

import { assertDrawEquivalent, evaluateDraw, settleDraw, type DrawVector } from "../reference/draw-reference";
import { asHandle, deployDrawFixture, mintAndDeposit, read, write, type DrawFixture } from "../draw/helpers";

type ProductionVector = {
  seed: string;
  balances: bigint[];
  thetas: bigint[];
  realisedYield: bigint;
};

type DrawInfo = Result & {
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
  prizeAmount: bigint;
  totalTickets: bigint;
  totalBaseRiskWeight: bigint;
  totalYieldWeight: bigint;
  r: bigint;
};

async function decryptUserValue(
  type: FhevmType.euint16 | FhevmType.euint64,
  contract: BaseContract,
  handle: bigint,
  user: DrawFixture["alice"],
): Promise<bigint> {
  return fhevm.userDecryptEuint(type, asHandle(handle), await contract.getAddress(), user);
}

async function setTheta(fixture: DrawFixture, user: DrawFixture["alice"], theta: bigint): Promise<void> {
  const encrypted = await fhevm
    .createEncryptedInput(await fixture.vault.getAddress(), user.address)
    .add8(theta)
    .encrypt();
  await write(fixture.vault.connect(user) as BaseContract, "setTheta", [encrypted.handles[0], encrypted.inputProof]);
}

async function runProductionDraw(vector: ProductionVector): Promise<void> {
  const fixture = await deployDrawFixture();
  const users = fixture.users.slice(0, vector.balances.length);
  for (let index = 0; index < users.length; index += 1) {
    await mintAndDeposit(fixture, users[index], vector.balances[index]);
    if (vector.thetas[index] !== 4n) await setTheta(fixture, users[index], vector.thetas[index]);
  }
  if (vector.realisedYield > 0n) {
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), vector.realisedYield]);
  }
  await write(fixture.draw, "openDraw", [false]);
  const opened = (await read(fixture.draw, "drawInfo", [1n])) as Result & { tEnd: bigint };
  const settleDelay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
  await time.increaseTo(opened.tEnd + settleDelay);
  await write(fixture.draw, "preSyncA", [4n]);
  await write(fixture.draw, "preSyncA", [BigInt(users.length - 4)]);

  const participants = [];
  for (const user of users) {
    const weights = (await read(fixture.vault, "drawWeightsFor", [user.address])) as Result;
    participants.push({
      ticketDelta: await fhevm.debugger.decryptEuint(FhevmType.euint128, weights[0] as bigint),
      yieldDelta: await fhevm.debugger.decryptEuint(FhevmType.euint128, weights[1] as bigint),
      fortune: 0n,
    });
  }
  const drawVector: DrawVector = { seed: vector.seed, realisedYield: vector.realisedYield, participants };
  const expectedPassA = evaluateDraw(drawVector);

  for (let offset = 0; offset < users.length; offset += 3) {
    await write(fixture.draw, "crankA", [BigInt(Math.min(3, users.length - offset))]);
  }
  const passAInfo = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const handles = [
    asHandle(passAInfo.cumRunning),
    asHandle(passAInfo.cumBaseRiskRunning),
    asHandle(passAInfo.cumYieldRunning),
  ];
  const totals = await fhevm.publicDecrypt(handles);
  const actualPassA = {
    totalTickets: totals.clearValues[handles[0]] as bigint,
    totalBaseRiskWeight: totals.clearValues[handles[1]] as bigint,
    totalYieldWeight: totals.clearValues[handles[2]] as bigint,
  };
  assertDrawEquivalent(vector.seed, "pass-a", actualPassA, {
    totalTickets: expectedPassA.totalTickets,
    totalBaseRiskWeight: expectedPassA.totalBaseRiskWeight,
    totalYieldWeight: expectedPassA.totalYieldWeight,
  });

  await write(fixture.draw, "submitTotals", [totals.abiEncodedClearValues, totals.decryptionProof]);
  if (expectedPassA.totalYieldWeight === 0n) return;

  let randomTicket = 0n;
  if (expectedPassA.totalTickets > 0n) {
    await write(fixture.draw, "openRandom");
    const randomized = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    randomTicket = await fhevm.debugger.decryptEuint(FhevmType.euint64, randomized.r);
  }
  const expectedSettlement = settleDraw(drawVector, randomTicket);
  for (let offset = 0; offset < users.length; offset += 2) {
    await write(fixture.draw, "crankB", [BigInt(Math.min(2, users.length - offset))]);
  }
  const settledInfo = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const prizeCredits: bigint[] = [];
  const fortunes: bigint[] = [];
  const balances: bigint[] = [];
  for (const user of users) {
    prizeCredits.push(
      await decryptUserValue(
        FhevmType.euint64,
        fixture.draw,
        (await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint,
        user,
      ),
    );
    fortunes.push(
      await decryptUserValue(
        FhevmType.euint16,
        fixture.vault,
        (await read(fixture.vault, "fortuneOf", [user.address])) as bigint,
        user,
      ),
    );
    balances.push(
      await decryptUserValue(
        FhevmType.euint64,
        fixture.vault,
        (await read(fixture.vault, "confidentialBalanceOf", [user.address])) as bigint,
        user,
      ),
    );
  }
  assertDrawEquivalent(
    vector.seed,
    "settlement",
    { prizeAmount: settledInfo.prizeAmount, prizeCredits, fortunes, balances },
    {
      prizeAmount: expectedSettlement.prizeAmount,
      prizeCredits: expectedSettlement.prizeCredits,
      fortunes: expectedSettlement.fortunes,
      balances: vector.balances.map(
        (balance, index) => balance + expectedSettlement.prizeCredits[index] + expectedSettlement.directCredits[index],
      ),
    },
  );
}

describe("LokDrawManager differential reference", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("builds one exact half-open interval partition and funded allocation", function () {
    const vector: DrawVector = {
      seed: "draw-partition",
      realisedYield: 1_000n,
      participants: [
        { ticketDelta: 10n << 28n, yieldDelta: 10n << 26n, fortune: 0n },
        { ticketDelta: 20n << 28n, yieldDelta: 20n << 26n, fortune: 26n },
        { ticketDelta: 30n << 28n, yieldDelta: 30n << 26n, fortune: 52n },
        { ticketDelta: 40n << 28n, yieldDelta: 40n << 26n, fortune: 99n },
        { ticketDelta: 50n << 28n, yieldDelta: 50n << 26n, fortune: 1n },
      ],
    };

    const passA = evaluateDraw(vector);
    expect(passA.participants[0].rangeStart).to.equal(0n);
    expect(passA.participants.at(-1)?.rangeEnd).to.equal(passA.totalTickets);
    expect(
      passA.participants.every((participant, index) => {
        return index === 0 || participant.rangeStart === passA.participants[index - 1].rangeEnd;
      }),
    ).to.equal(true);

    const settled = settleDraw(vector, passA.totalTickets - 1n);
    expect(settled.prizeCredits.filter((credit) => credit !== 0n)).to.deep.equal([settled.prizeAmount]);
    expect(settled.prizeAmount + settled.directCredits.reduce((sum, value) => sum + value, 0n)).to.be.at.most(
      vector.realisedYield,
    );
  });

  it("masks all totals when fewer than five participants are non-dust", function () {
    const vector: DrawVector = {
      seed: "draw-dust",
      realisedYield: 500n,
      participants: Array.from({ length: 5 }, () => ({
        ticketDelta: 4n << 20n,
        yieldDelta: 1n << 20n,
        fortune: 52n,
      })),
    };

    expect(evaluateDraw(vector)).to.include({ totalTickets: 0n, totalBaseRiskWeight: 0n, totalYieldWeight: 0n });
  });

  it("normalizes the reviewed 60-second precision floor to one weight unit", function () {
    const minimumUnits = 1_118_482n;
    const yieldDelta = minimumUnits * 60n;
    const evaluated = evaluateDraw({
      seed: "draw-scale-26-floor",
      realisedYield: 0n,
      participants: Array.from({ length: 5 }, () => ({
        ticketDelta: yieldDelta * 4n,
        yieldDelta,
        fortune: 0n,
      })),
    });

    expect(evaluated.nonDustParticipants).to.equal(5);
    expect(evaluated.totalYieldWeight).to.equal(5n);
    expect(evaluated.totalBaseRiskWeight).to.equal(5n);
    expect(evaluated.totalTickets).to.equal(5n);
  });

  it("keeps the maximum Fortune product and adjusted prefix inside euint64", function () {
    const maxSupply = (1n << 64n) - 1n;
    const maxPeriod = 1n << 20n;
    const position = maxSupply / 5n;
    const balances = [position, position, position, position, maxSupply - position * 4n];
    const evaluated = evaluateDraw({
      seed: "draw-scale-26-overflow",
      realisedYield: 0n,
      participants: balances.map((balance) => ({
        ticketDelta: balance * maxPeriod * 4n,
        yieldDelta: balance * maxPeriod,
        fortune: 52n,
      })),
    });

    expect(evaluated.participants.every(({ baseRiskWeight }) => baseRiskWeight * 52n < 1n << 64n)).to.equal(true);
    expect(evaluated.totalBaseRiskWeight).to.be.lessThan(1n << 58n);
    expect(evaluated.totalYieldWeight).to.be.lessThan(1n << 58n);
    expect(evaluated.totalTickets).to.be.lessThan(1n << 59n);
  });

  it("caps Fortune and preserves the defined split rounding margin", function () {
    const unsplit = evaluateDraw({
      seed: "fortune-unsplit",
      realisedYield: 0n,
      participants: [
        { ticketDelta: 100n << 28n, yieldDelta: 100n << 26n, fortune: 52n },
        ...Array.from({ length: 4 }, () => ({ ticketDelta: 1n << 28n, yieldDelta: 1n << 26n, fortune: 0n })),
      ],
    }).participants[0].boost;
    const split = evaluateDraw({
      seed: "fortune-split",
      realisedYield: 0n,
      participants: Array.from({ length: 5 }, () => ({
        ticketDelta: 20n << 28n,
        yieldDelta: 20n << 26n,
        fortune: 99n,
      })),
    }).participants.reduce((sum, participant) => sum + participant.boost, 0n);

    expect(split).to.be.at.most(unsplit + 4n);
  });

  it("matches decrypted production totals and settlement for every deterministic vector", async function () {
    this.timeout(180_000);
    const vectors: ProductionVector[] = [
      {
        seed: "draw-default-risk",
        balances: [1_000_000n, 2_000_000n, 3_000_000n, 4_000_000n, 5_000_000n],
        thetas: [4n, 4n, 4n, 4n, 4n],
        realisedYield: 1_000n,
      },
      {
        seed: "draw-varied-risk",
        balances: [5_000_000n, 4_000_000n, 3_000_000n, 2_000_000n, 1_000_000n],
        thetas: [0n, 1n, 2n, 3n, 4n],
        realisedYield: 12_345n,
      },
      {
        seed: "draw-zero-risk",
        balances: [1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n, 1_000_000n],
        thetas: [0n, 0n, 0n, 0n, 0n],
        realisedYield: 777n,
      },
      {
        seed: "draw-all-dust",
        balances: [1n, 1n, 1n, 1n, 1n],
        thetas: [4n, 4n, 4n, 4n, 4n],
        realisedYield: 500n,
      },
    ];
    for (const vector of vectors) await runProductionDraw(vector);
  });
});
