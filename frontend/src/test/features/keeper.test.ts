import { describe, expect, it } from "vitest";

import { keeperDecision } from "../../features/keeper/model";
import type { LokPublicSnapshot, PublicDrawSnapshot } from "../../features/public-data/model";

function draw(overrides: Partial<PublicDrawSnapshot> = {}): PublicDrawSnapshot {
  return {
    id: 1n,
    state: "OPEN",
    strict: false,
    settled: false,
    aborted: false,
    noWinner: false,
    tStart: 100n,
    tEnd: 200n,
    revealDeadline: 260n,
    stateDeadline: 300n,
    cursor: 0n,
    preSyncCursor: 0n,
    participantSnapshot: 5n,
    realisedYield: 1_000_000n,
    prizeAmount: 0n,
    totalTickets: 0n,
    totalBaseRiskWeight: 0n,
    totalYieldWeight: 0n,
    cumRunning: `0x${"11".repeat(32)}`,
    cumBaseRiskRunning: `0x${"22".repeat(32)}`,
    cumYieldRunning: `0x${"33".repeat(32)}`,
    randomHandle: `0x${"00".repeat(32)}`,
    revealAccumulator: `0x${"00".repeat(32)}`,
    ...overrides,
  };
}

function snapshot(drawOverride?: Partial<PublicDrawSnapshot>): LokPublicSnapshot {
  return {
    participantCount: 5n,
    riskEpoch: 1n,
    solvency: "verified",
    fundedYield: 1_000_000n,
    draw: drawOverride === undefined ? undefined : draw(drawOverride),
  };
}

describe("keeperDecision", () => {
  it("opens a non-strict draw when no draw exists", () => {
    expect(keeperDecision(snapshot()).action).toEqual({ kind: "openDraw", strict: false });
  });

  it("waits before tEnd and pre-syncs after tEnd", () => {
    expect(keeperDecision(snapshot({ state: "OPEN" }), 199_000).disabledReason).toMatch(/draw window/i);
    expect(keeperDecision(snapshot({ state: "OPEN" }), 200_000).action).toEqual({ kind: "preSyncA", batch: 4n });
  });

  it("cranks PASS A after pre-sync is complete", () => {
    expect(keeperDecision(snapshot({ state: "SWEEP_A", preSyncCursor: 5n, cursor: 1n }), 200_000).action).toEqual({
      kind: "crankA",
      batch: 3n,
    });
  });

  it("requires all aggregate handles before public decrypt submit", () => {
    expect(
      keeperDecision(snapshot({ state: "AWAIT_TOTAL", cumYieldRunning: `0x${"00".repeat(32)}` }), 250_000)
        .disabledReason,
    ).toMatch(/aggregate handles/i);
    expect(keeperDecision(snapshot({ state: "AWAIT_TOTAL" }), 250_000).action).toMatchObject({
      kind: "submitTotals",
      handles: [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`, `0x${"33".repeat(32)}`],
    });
  });

  it("waits for strict reveal close before randomness", () => {
    expect(keeperDecision(snapshot({ state: "REVEAL", revealDeadline: 260n }), 259_000).disabledReason).toMatch(
      /reveal window/i,
    );
    expect(keeperDecision(snapshot({ state: "REVEAL", revealDeadline: 260n }), 260_000).action).toEqual({
      kind: "openRandom",
    });
  });

  it("cranks PASS B in the measured small batch", () => {
    expect(keeperDecision(snapshot({ state: "SWEEP_B", cursor: 4n, participantSnapshot: 5n }), 300_000).action).toEqual(
      {
        kind: "crankB",
        batch: 1n,
      },
    );
  });
});
