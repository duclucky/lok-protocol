import { expect } from "chai";
import { solidityPackedKeccak256 } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  assertVerifierDeploymentManifest,
  collectDrawEventLogs,
  readHistoricalOrCurrent,
  readParticipantSnapshot,
  resolveVerifierOptions,
  verifyDrawEvidence,
  type DrawVerificationEvidence,
} from "../../scripts/verify-draw";
import { assertDeploymentManifest } from "../../scripts/deploy";

const entropy = `0x${"12".repeat(32)}` as `0x${string}`;
const salt = `0x${"34".repeat(32)}` as `0x${string}`;

type MockEventLog = {
  blockNumber: number;
  transactionIndex: number;
  index: number;
  transactionHash: string;
  drawId: bigint;
};

function eventLog(
  transactionHash: string,
  index: number,
  drawId: bigint,
  blockNumber: number,
  transactionIndex: number,
): MockEventLog {
  return { transactionHash, index, drawId, blockNumber, transactionIndex };
}

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
  it("falls back to decoded topic0 logs, deduplicates and orders deterministically", async function () {
    const earlier = eventLog(`0x${"11".repeat(32)}`, 2, 2n, 10, 1);
    const duplicateEarlier = { ...earlier };
    const later = eventLog(`0x${"22".repeat(32)}`, 0, 2n, 11, 0);
    const wrongDraw = eventLog(`0x${"33".repeat(32)}`, 0, 3n, 9, 0);

    const logs = await collectDrawEventLogs({
      drawId: 2n,
      queryExact: async () => [],
      queryBroad: async () => [later, duplicateEarlier, wrongDraw, earlier],
      decodeDrawId: (log) => log.drawId,
    });

    expect(logs.map((log) => `${log.transactionHash}:${log.index}`)).to.deep.equal([
      `${earlier.transactionHash}:${earlier.index}`,
      `${later.transactionHash}:${later.index}`,
    ]);
  });

  it("rejects an indexed result that decodes to a different draw without broad fallback", async function () {
    let broadQueried = false;
    await expect(
      collectDrawEventLogs({
        drawId: 2n,
        queryExact: async () => [eventLog(`0x${"44".repeat(32)}`, 0, 3n, 10, 0)],
        queryBroad: async () => {
          broadQueried = true;
          return [];
        },
        decodeDrawId: (log) => log.drawId,
      }),
    ).to.be.rejectedWith("Indexed event drawId 3 does not match requested draw 2");
    expect(broadQueried).to.equal(false);
  });

  it("retains distinct matching logs and propagates malformed broad-log failures", async function () {
    const first = eventLog(`0x${"55".repeat(32)}`, 1, 2n, 10, 0);
    const second = eventLog(first.transactionHash, 2, 2n, 10, 0);
    const logs = await collectDrawEventLogs({
      drawId: 2n,
      queryExact: async () => [second, first],
      queryBroad: async () => [],
      decodeDrawId: (log) => log.drawId,
    });
    expect(logs.map(({ index }) => index)).to.deep.equal([1, 2]);

    await expect(
      collectDrawEventLogs({
        drawId: 2n,
        queryExact: async () => [],
        queryBroad: async () => [first],
        decodeDrawId: () => {
          throw new Error("malformed broad log");
        },
      }),
    ).to.be.rejectedWith("malformed broad log");
  });

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
