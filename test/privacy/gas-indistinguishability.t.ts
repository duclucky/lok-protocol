import { expect } from "chai";
import { ContractTransactionReceipt } from "ethers";
import { ethers, fhevm, network } from "hardhat";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { comparePrivacyCost, opcodeShape, writePrivacyEvidence } from "../../scripts/privacy-scan";
import { read } from "../draw/helpers";
import { createDrawRandomHandles, setDrawRandomHandle } from "../draw/forced-random";
import { reachPrivacySweepB } from "./helpers";

type DebugTrace = { structLogs: Array<{ depth: number; op: string }> };
type Position = { label: "first" | "interior" | "final"; index: number };

type MeasuredOutcome = {
  receipt: ContractTransactionReceipt;
  trace: string[];
};

async function measurePositionOutcome(position: Position, outcome: "winner" | "loser"): Promise<MeasuredOutcome> {
  const fixture = await reachPrivacySweepB(7);
  const info = (await read(fixture.draw, "drawInfo", [1n])) as { totalTickets: bigint };
  expect(info.totalTickets % 7n).to.equal(0n);
  const interval = info.totalTickets / 7n;
  const handles = await createDrawRandomHandles(
    fixture.draw,
    Array.from({ length: 7 }, (_, index) => interval * BigInt(index)),
  );

  await setDrawRandomHandle(fixture.draw, 1n, handles[6]);
  for (let index = 0; index < position.index; index += 1) {
    const prefixTx = await fixture.draw.getFunction("crankB")(1n);
    await prefixTx.wait();
  }
  const loserIndex = position.index === 0 ? 1 : position.index - 1;
  const outcomeHandle = outcome === "winner" ? handles[position.index] : handles[loserIndex];
  await setDrawRandomHandle(fixture.draw, 1n, outcomeHandle);
  const tx = await fixture.draw.getFunction("crankB")(1n);
  const receipt = await tx.wait();
  if (receipt === null) throw new Error(`missing ${position.label}/${outcome} receipt`);
  const trace = (await ethers.provider.send("debug_traceTransaction", [
    receipt.hash,
    { disableMemory: true, disableStack: true, disableStorage: true },
  ])) as DebugTrace;
  return { receipt, trace: opcodeShape(trace.structLogs) };
}

describe("Lok winner gas and HCU indistinguishability", function () {
  let testEvidenceDirectory: string;

  before(function () {
    testEvidenceDirectory = mkdtempSync(path.join(tmpdir(), "lok-privacy-gas-"));
  });

  after(function () {
    rmSync(testEvidenceDirectory, { recursive: true, force: true });
  });

  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("keeps first, interior, and final winner/loser work within the frozen thresholds", async function () {
    const positions: Position[] = [
      { label: "first", index: 0 },
      { label: "interior", index: 3 },
      { label: "final", index: 6 },
    ];
    const evidence: Array<Record<string, unknown>> = [];

    for (const position of positions) {
      const winner = await measurePositionOutcome(position, "winner");
      const loser = await measurePositionOutcome(position, "loser");
      const comparison = comparePrivacyCost(
        { gasUsed: winner.receipt.gasUsed, hcu: fhevm.computeTransactionHCU(winner.receipt) },
        { gasUsed: loser.receipt.gasUsed, hcu: fhevm.computeTransactionHCU(loser.receipt) },
      );
      const diagnostic = JSON.stringify({ position, comparison });
      expect(comparison.globalHcuDelta, diagnostic).to.equal(0);
      expect(comparison.maxHcuDepthDelta, diagnostic).to.equal(0);
      expect(comparison.gasDeltaBps, diagnostic).to.be.at.most(100);
      expect(winner.trace, `${position.label} opcode/FHE operation mix`).to.deep.equal(loser.trace);
      evidence.push({ position: position.label, index: position.index, comparison, opcodeShapeEqual: true });
    }

    writePrivacyEvidence(
      "gas-indistinguishability",
      {
        status: "PASS",
        proposition: "P-P5",
        sourceTestIdentifiers: [
          "test/privacy/gas-indistinguishability.t.ts:keeps first, interior, and final winner/loser work within the frozen thresholds",
        ],
        command: 'npx hardhat test test/privacy/gas-indistinguishability.t.ts --grep "keeps first"',
        fixedGasThresholdBps: 100,
        positions: evidence,
        allPositionsMeasured: true,
        sweepAndFinalizationOutcomeIndependent: true,
      },
      testEvidenceDirectory,
    );
  });

  it("rejects winner-only gas and HCU mutations", function () {
    const baseline = { gasUsed: 100_000n, hcu: { globalHCU: 4_000, maxHCUDepth: 3_000 } };
    expect(comparePrivacyCost(baseline, { ...baseline, gasUsed: 101_000n }).status).to.equal("PASS");
    expect(comparePrivacyCost(baseline, { ...baseline, gasUsed: 101_100n }).status).to.equal("FAIL");
    expect(
      comparePrivacyCost(baseline, { gasUsed: 100_000n, hcu: { globalHCU: 4_001, maxHCUDepth: 3_000 } }).status,
    ).to.equal("FAIL");
    expect(
      comparePrivacyCost(baseline, { gasUsed: 100_000n, hcu: { globalHCU: 4_000, maxHCUDepth: 3_001 } }).status,
    ).to.equal("FAIL");
  });
});
