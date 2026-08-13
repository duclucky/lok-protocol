import { expect } from "chai";
import { ContractTransactionReceipt } from "ethers";
import { ethers, fhevm, network } from "hardhat";

import { comparePrivacyCost, opcodeShape, writePrivacyEvidence } from "../../scripts/privacy-scan";
import { read } from "../draw/helpers";
import { createDrawRandomHandles, setDrawRandomHandle } from "../draw/forced-random";
import { reachPrivacySweepB } from "./helpers";

type DebugTrace = { structLogs: Array<{ depth: number; op: string }> };
type Position = { label: "first" | "interior" | "final"; index: number };

async function restoreAfterMockCoprocessor(snapshotId: string, previousHighBlock: number): Promise<string> {
  expect(await network.provider.send("evm_revert", [snapshotId])).to.equal(true);
  const currentBlock = await ethers.provider.getBlockNumber();
  const blocksToMine = previousHighBlock - currentBlock + 2;
  if (blocksToMine > 0) await network.provider.send("hardhat_mine", [`0x${blocksToMine.toString(16)}`]);
  return (await network.provider.send("evm_snapshot")) as string;
}

describe("Lok winner gas and HCU indistinguishability", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("keeps first, interior, and final winner/loser work within the frozen thresholds", async function () {
    const fixture = await reachPrivacySweepB(7);
    const info = (await read(fixture.draw, "drawInfo", [1n])) as { totalTickets: bigint };
    expect(info.totalTickets % 7n).to.equal(0n);
    const interval = info.totalTickets / 7n;
    const handles = await createDrawRandomHandles(
      fixture.draw,
      Array.from({ length: 7 }, (_, index) => interval * BigInt(index)),
    );
    const positions: Position[] = [
      { label: "first", index: 0 },
      { label: "interior", index: 3 },
      { label: "final", index: 6 },
    ];
    let snapshotId = (await network.provider.send("evm_snapshot")) as string;
    let previousHighBlock = await ethers.provider.getBlockNumber();
    const evidence: Array<Record<string, unknown>> = [];

    for (const position of positions) {
      const receipts: Partial<Record<"winner" | "loser", ContractTransactionReceipt>> = {};
      const traces: Partial<Record<"winner" | "loser", string[]>> = {};
      for (const outcome of ["winner", "loser"] as const) {
        snapshotId = await restoreAfterMockCoprocessor(snapshotId, previousHighBlock);
        await setDrawRandomHandle(fixture.draw, 1n, handles[6]);
        for (let index = 0; index < position.index; index += 1) {
          const prefixTx = await fixture.draw.getFunction("crankB")(1n);
          await prefixTx.wait();
        }
        const outcomeHandle = outcome === "winner" ? handles[position.index] : handles[position.index === 0 ? 1 : 0];
        await setDrawRandomHandle(fixture.draw, 1n, outcomeHandle);
        const tx = await fixture.draw.getFunction("crankB")(1n);
        const receipt = await tx.wait();
        if (receipt === null) throw new Error(`missing ${position.label}/${outcome} receipt`);
        receipts[outcome] = receipt;
        const trace = (await ethers.provider.send("debug_traceTransaction", [
          receipt.hash,
          { disableMemory: true, disableStack: true, disableStorage: true },
        ])) as DebugTrace;
        traces[outcome] = opcodeShape(trace.structLogs);
        previousHighBlock = await ethers.provider.getBlockNumber();
      }

      const winnerReceipt = receipts.winner;
      const loserReceipt = receipts.loser;
      if (winnerReceipt === undefined || loserReceipt === undefined) throw new Error("paired receipt missing");
      const comparison = comparePrivacyCost(
        { gasUsed: winnerReceipt.gasUsed, hcu: fhevm.computeTransactionHCU(winnerReceipt) },
        { gasUsed: loserReceipt.gasUsed, hcu: fhevm.computeTransactionHCU(loserReceipt) },
      );
      const diagnostic = JSON.stringify({ position, comparison });
      expect(comparison.globalHcuDelta, diagnostic).to.equal(0);
      expect(comparison.maxHcuDepthDelta, diagnostic).to.equal(0);
      expect(comparison.gasDeltaBps, diagnostic).to.be.at.most(100);
      expect(traces.winner, `${position.label} opcode/FHE operation mix`).to.deep.equal(traces.loser);
      evidence.push({ position: position.label, index: position.index, comparison, opcodeShapeEqual: true });
    }

    writePrivacyEvidence("gas-indistinguishability", {
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
    });
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
