import { expect } from "chai";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  SplitMix64,
  buildFairnessReport,
  chiSquarePValue,
  computePosition,
  moduloBiasBound,
  runWeightedScenario,
  type WeightedScenario,
} from "../../scripts/run-fairness";
import { renderFairnessPng } from "../../scripts/render-fairness";

describe("Lok statistical fairness core", function () {
  it("generates the published SplitMix64 sequence from seed zero", function () {
    const rng = new SplitMix64(0n);

    expect(rng.next64()).to.equal(0xe220a8397b1dcdafn);
    expect(rng.next64()).to.equal(0x6e789e6aa1b965f4n);
    expect(rng.next64()).to.equal(0x06c45d188009454fn);
  });

  it("mirrors normalized production weight and the capped Fortune boost", function () {
    const fullFortune = computePosition({
      id: "full-fortune",
      balanceMicroUnits: 1_000_000n,
      theta: 4n,
      activeSeconds: 604_800n,
      fortune: 52n,
    });
    const beyondCap = computePosition({
      id: "beyond-cap",
      balanceMicroUnits: 1_000_000n,
      theta: 4n,
      activeSeconds: 604_800n,
      fortune: 80n,
    });

    expect(fullFortune.baseWeight).to.equal(140n);
    expect(fullFortune.boost).to.equal(70n);
    expect(fullFortune.effectiveWeight).to.equal(210n);
    expect(beyondCap.boost).to.equal(fullFortune.boost);
    expect(computePosition({ ...fullFortune.input, id: "zero-theta", theta: 0n }).effectiveWeight).to.equal(0n);
  });

  it("computes the chi-square upper-tail probability", function () {
    expect(chiSquarePValue(5.991_464_547_107_979, 2)).to.be.closeTo(0.05, 1e-12);
    expect(chiSquarePValue(0, 7)).to.equal(1);
  });

  it("derives the exact modulo imbalance below the frozen N / 2^64 bound", function () {
    const bound = moduloBiasBound(10n);

    expect(bound.remainder).to.equal(6n);
    expect(bound.maxRelativeDeviationNumerator).to.equal(6n);
    expect(bound.denominator).to.equal(1n << 64n);
    expect(bound.withinFrozenBound).to.equal(true);
  });

  it("is deterministic and never maps a draw to a zero-weight participant", function () {
    const scenario: WeightedScenario = {
      id: "determinism",
      proposition: "P-F1",
      draws: 10_000,
      seed: 0x4c4f4bn,
      participants: [
        { id: "zero", effectiveWeight: 0n },
        { id: "one", effectiveWeight: 1n },
        { id: "three", effectiveWeight: 3n },
      ],
    };

    const first = runWeightedScenario(scenario);
    const second = runWeightedScenario(scenario);

    expect(first.observedCounts).to.deep.equal(second.observedCounts);
    expect(first.observedCounts[0]).to.equal(0);
    expect(first.observedCounts.reduce((sum, count) => sum + count, 0)).to.equal(scenario.draws);
    expect(first.observedCounts[1]).to.be.greaterThan(0);
    expect(first.observedCounts[2]).to.be.greaterThan(first.observedCounts[1]);
  });

  it("builds the complete deterministic P-F1 and P-F1' evidence report", function () {
    const generatedAtUtc = "2026-08-10T00:00:00.000Z";
    const first = buildFairnessReport(25_000, generatedAtUtc);
    const second = buildFairnessReport(25_000, generatedAtUtc);

    expect(first).to.deep.equal(second);
    expect(first.scenarios.map(({ id }) => id)).to.deep.equal([
      "base-geometric",
      "base-varied-exposure",
      "fortune-varied-histories",
      "fortune-split-principal",
    ]);
    expect(first.propositions["P-F1"].draws).to.equal(50_000);
    expect(first.propositions["P-F1'"].draws).to.equal(50_000);
    expect(first.checks.zeroWeightNeverWins).to.equal(true);
    expect(first.checks.splitBoostWithinSingleAddressCap).to.equal(true);
    expect(first.methodology.confidenceInterval).to.contain("family-wise");
    expect(() => JSON.stringify(first)).not.to.throw();
  });

  it("runs as a CLI and writes the requested evidence artifact", function () {
    this.timeout(30_000);
    const directory = mkdtempSync(path.join(tmpdir(), "lok-fairness-"));
    const output = path.join(directory, "fairness.json");
    try {
      const result = spawnSync(
        process.execPath,
        ["-r", require.resolve("ts-node/register"), path.resolve("scripts/run-fairness.ts")],
        {
          cwd: path.resolve("."),
          encoding: "utf8",
          env: { ...process.env, LOK_FAIRNESS_OUTPUT: output },
        },
      );

      expect(result.status, result.stderr).to.equal(0);
      expect(existsSync(output)).to.equal(true);
      expect(JSON.parse(readFileSync(output, "utf8")).status).to.equal("PASS");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders a stable non-empty PNG from the fairness report", function () {
    const directory = mkdtempSync(path.join(tmpdir(), "lok-fairness-chart-"));
    const output = path.join(directory, "fairness.png");
    try {
      renderFairnessPng(buildFairnessReport(25_000, "2026-08-11T00:00:00.000Z"), output);
      const png = readFileSync(output);

      expect(png.subarray(0, 8).toString("hex")).to.equal("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).to.equal(1600);
      expect(png.readUInt32BE(20)).to.equal(1200);
      expect(png.length).to.be.greaterThan(10_000);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
