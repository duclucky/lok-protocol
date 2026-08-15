import { expect } from "chai";
import { solidityPackedKeccak256 } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  assertVerifierDeploymentManifest,
  readHistoricalOrCurrent,
  readParticipantSnapshot,
  resolveVerifierOptions,
  verifyDrawEvidence,
  type DrawVerificationEvidence,
} from "../../scripts/verify-draw";
import { assertDeploymentManifest } from "../../scripts/deploy";

const entropy = `0x${"12".repeat(32)}` as `0x${string}`;
const salt = `0x${"34".repeat(32)}` as `0x${string}`;

function fixture(): DrawVerificationEvidence {
  return {
    drawId: 9n,
    strict: true,
    participantSnapshot: 3,
    runtimeBytecodeMatchesManifest: true,
    storedTotals: { tickets: 100n, baseRisk: 80n, yieldWeight: 120n },
    publicTotals: { tickets: 100n, baseRisk: 80n, yieldWeight: 120n },
    prizeAmount: 40n,
    publicPrizeCredits: 40n,
    publicRandom: 71n,
    randomHandle: `0x${"aa".repeat(32)}` as `0x${string}`,
    finalRevealAcc: entropy,
    events: {
      opened: 1,
      settled: 1,
      randomness: [`0x${"aa".repeat(32)}` as `0x${string}`],
      creditedParticipants: [
        "0x0000000000000000000000000000000000000001",
        "0x0000000000000000000000000000000000000002",
        "0x0000000000000000000000000000000000000003",
      ],
    },
    commits: [
      {
        participant: "0x0000000000000000000000000000000000000001",
        commitment: solidityPackedKeccak256(["bytes32", "bytes32"], [entropy, salt]) as `0x${string}`,
      },
    ],
    reveals: [
      {
        participant: "0x0000000000000000000000000000000000000001",
        entropy,
        salt,
        accepted: true,
      },
    ],
  };
}

function failedChecks(value: DrawVerificationEvidence): string[] {
  return verifyDrawEvidence(value)
    .checks.filter((check) => !check.passed)
    .map((check) => check.id);
}

describe("independent draw verifier", function () {
  it("accepts the preserved seeded demo manifest without weakening the canonical deploy gate", async function () {
    const raw: unknown = JSON.parse(
      await readFile(path.join(process.cwd(), "deployments/history/sepolia-2026-08-13-120-30-180-600.json"), "utf8"),
    );

    expect(() => assertDeploymentManifest(raw)).to.throw("timing.drawPeriod must be 60");
    expect(() => assertVerifierDeploymentManifest(raw)).not.to.throw();
  });

  it("uses the retained current snapshot when the latest draw remains settled", async function () {
    const result = await readParticipantSnapshot({
      drawId: 9n,
      latestSettled: true,
      readHistorical: async () => {
        throw new Error("archive state unavailable");
      },
      readCurrent: async () => ({ drawId: 9n, state: 7n, participantSnapshot: 30n }),
    });

    expect(result).to.deep.equal({ participantSnapshot: 30, source: "current-settled" });
  });

  it("accepts numeric enum state from live contract runners when falling back to current snapshot", async function () {
    const result = await readParticipantSnapshot({
      drawId: 9n,
      latestSettled: true,
      readHistorical: async () => {
        throw new Error("archive state unavailable");
      },
      readCurrent: async () => ({ drawId: 9n, state: 7, participantSnapshot: 30n }),
    });

    expect(result).to.deep.equal({ participantSnapshot: 30, source: "current-settled" });
  });

  it("falls back from unavailable historical state only for the current latest settled draw", async function () {
    expect(
      await readHistoricalOrCurrent({
        latestSettledCurrent: true,
        readHistorical: async () => {
          throw new Error("historical state unavailable");
        },
        readCurrent: async () => "current",
      }),
    ).to.equal("current");

    await expect(
      readHistoricalOrCurrent({
        latestSettledCurrent: false,
        readHistorical: async () => {
          throw new Error("historical state unavailable");
        },
        readCurrent: async () => "current",
      }),
    ).to.be.rejectedWith("historical state unavailable");
  });

  it("preserves the archive requirement for a draw that is no longer current", async function () {
    const archiveError = new Error("archive state unavailable");
    await expect(
      readParticipantSnapshot({
        drawId: 8n,
        latestSettled: true,
        readHistorical: async () => {
          throw archiveError;
        },
        readCurrent: async () => ({ drawId: 9n, state: 7n, participantSnapshot: 30n }),
      }),
    ).to.be.rejectedWith("archive state unavailable");
  });

  it("accepts Hardhat-compatible environment options", function () {
    expect(resolveVerifierOptions({ LOK_VERIFY_LATEST_SETTLED: "1" })).to.deep.equal({
      drawId: undefined,
      latestSettled: true,
      transcript: undefined,
      manifest: undefined,
    });
    expect(
      resolveVerifierOptions({ LOK_VERIFY_DRAW_ID: "12", LOK_VERIFY_TRANSCRIPT: "public-txs.json" }),
    ).to.deep.equal({
      drawId: 12n,
      latestSettled: false,
      transcript: "public-txs.json",
      manifest: undefined,
    });
    expect(
      resolveVerifierOptions({ LOK_VERIFY_LATEST_SETTLED: "1" }, ["--manifest", "deployments/history/demo.json"]),
    ).to.deep.equal({
      drawId: undefined,
      latestSettled: true,
      transcript: undefined,
      manifest: "deployments/history/demo.json",
    });
    expect(
      resolveVerifierOptions({ LOK_VERIFY_DRAW_ID: "1", LOK_VERIFY_MANIFEST: "deployments/history/demo.json" }),
    ).to.deep.equal({
      drawId: 1n,
      latestSettled: false,
      transcript: undefined,
      manifest: "deployments/history/demo.json",
    });
    expect(() => resolveVerifierOptions({ LOK_VERIFY_DRAW_ID: "12", LOK_VERIFY_LATEST_SETTLED: "1" })).to.throw(
      "exactly one",
    );
  });

  it("passes a complete public transcript", function () {
    const result = verifyDrawEvidence(fixture());
    expect(result.passed).to.equal(true);
    expect(result.checks.map((check) => check.id)).to.include.members([
      "events",
      "aggregate-proof",
      "range-partition",
      "randomness-commitment",
      "reveal-transcript",
      "prize-conservation",
    ]);
  });

  it("rejects forged totals", function () {
    const value = fixture();
    value.storedTotals.tickets = 101n;
    expect(failedChecks(value)).to.include("aggregate-proof");
  });

  it("rejects a commitment that does not bind the revealed entropy and salt", function () {
    const value = fixture();
    value.commits[0].commitment = `0x${"ff".repeat(32)}` as `0x${string}`;
    expect(failedChecks(value)).to.include("reveal-transcript");
  });

  it("rejects a wrong or unaccepted reveal", function () {
    const value = fixture();
    value.reveals[0].accepted = false;
    expect(failedChecks(value)).to.include("reveal-transcript");

    const wrongAccumulator = fixture();
    wrongAccumulator.finalRevealAcc = `0x${"00".repeat(32)}` as `0x${string}`;
    expect(failedChecks(wrongAccumulator)).to.include("reveal-transcript");
  });

  it("rejects missing events and incomplete participant processing", function () {
    const value = fixture();
    value.events.settled = 0;
    value.events.creditedParticipants.pop();
    expect(failedChecks(value)).to.include.members(["events", "range-partition"]);
  });

  it("rejects a prize-conservation mismatch", function () {
    const value = fixture();
    value.publicPrizeCredits = 39n;
    expect(failedChecks(value)).to.include("prize-conservation");
  });

  it("binds range-partition evidence to the reviewed deployed bytecode", function () {
    const value = fixture();
    value.runtimeBytecodeMatchesManifest = false;
    expect(failedChecks(value)).to.include("range-partition");
  });
});
