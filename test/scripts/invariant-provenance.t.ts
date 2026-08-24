import { expect } from "chai";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("Invariant evidence provenance", function () {
  it("fetches complete Git history in CI before validating ancestor-bound evidence", function () {
    const workflow = readFileSync(path.resolve(".github/workflows/main.yml"), "utf8");

    expect(workflow).to.match(/actions\/checkout@[\s\S]*fetch-depth:\s*0/);
  });

  it("derives selector calls and settlement coverage from raw Forge output", function () {
    const runner = readFileSync(path.resolve("scripts/run-invariants.ps1"), "utf8");
    const collector = readFileSync(path.resolve("scripts/collect-invariants.ps1"), "utf8");

    for (const source of [runner, collector]) {
      expect(source).to.include("selectorCallCounts");
      expect(source).to.include("settleDrawCallCount");
      expect(source).to.include("rawLogSha256");
      expect(source).to.not.include("function Get-CampaignSelectorSet");
      expect(source).to.match(/settlementSelectorIncluded\s*=.*settleDrawCallCount/);
    }
  });

  it("records and validates clean commit, commands, versions, shard identity, and raw hashes", function () {
    const runner = readFileSync(path.resolve("scripts/run-invariants.ps1"), "utf8");
    const collector = readFileSync(path.resolve("scripts/collect-invariants.ps1"), "utf8");

    for (const required of [
      "sourceStatusBeforeRun",
      "exactCommand",
      "nodeVersion",
      "solcVersion",
      "startedAtUtc",
      "endedAtUtc",
      "rawStdoutSha256",
      "rawStderrSha256",
      "launchMetadataSha256",
    ]) {
      expect(runner, required).to.include(required);
      expect(collector, required).to.include(required);
    }
    for (const rejection of [
      "mixed code commits",
      "dirty-source",
      "hash mismatch",
      "duplicate shard",
      "missing shard",
    ]) {
      expect(collector.toLowerCase(), rejection).to.include(rejection);
    }
    expect(runner).to.include("Shard process failed to start after 5 attempts");
    expect(runner).to.include("launchArtifactPath");
    expect(runner).to.include("EndedAtPath");
    expect(collector).to.include("merge-base");
    expect(collector).to.include("--is-ancestor");
  });

  it("parses a versioned raw Forge selector-table fixture instead of trusting summary metadata", function () {
    const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
    const output = execFileSync(
      powershell,
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        ". .\\scripts\\invariant-evidence.ps1; $raw=Get-Content -Raw -Encoding UTF8 test\\fixtures\\forge-invariant-output.txt; Read-ForgeInvariantOutput $raw | ConvertTo-Json -Depth 5 -Compress",
      ],
      { cwd: path.resolve("."), encoding: "utf8" },
    );
    const parsed = JSON.parse(output) as {
      sequences: number;
      calls: number;
      selectorCallCounts: Record<string, number>;
      settleDrawCallCount: number;
    };
    expect(parsed.sequences).to.be.greaterThan(0);
    expect(parsed.calls).to.be.greaterThan(parsed.sequences);
    expect(parsed.settleDrawCallCount).to.equal(parsed.selectorCallCounts.settleDraw);
    expect(parsed.settleDrawCallCount).to.be.greaterThan(0);
  });
});
