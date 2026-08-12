import { describe, expect, it } from "vitest";

import { deriveSolvencyState, drawStateFromChain, formatCountdown, formatUsdc } from "../../features/public-data/model";

describe("public Sepolia data model", () => {
  it("maps every contract enum value and rejects values outside the reviewed state machine", () => {
    expect(Array.from({ length: 8 }, (_, state) => drawStateFromChain(state))).toEqual([
      "IDLE",
      "OPEN",
      "SWEEP_A",
      "AWAIT_TOTAL",
      "REVEAL",
      "RANDOM_SET",
      "SWEEP_B",
      "SETTLED",
    ]);
    expect(() => drawStateFromChain(8)).toThrow(/unknown draw state/i);
  });

  it("derives the three public solvency labels from the current risk epoch", () => {
    expect(deriveSolvencyState({ restricted: false, pending: false, riskEpoch: 2n, lastSolventRiskEpoch: 2n })).toBe(
      "verified",
    );
    expect(deriveSolvencyState({ restricted: false, pending: true, riskEpoch: 2n, lastSolventRiskEpoch: 1n })).toBe(
      "pending",
    );
    expect(deriveSolvencyState({ restricted: false, pending: false, riskEpoch: 2n, lastSolventRiskEpoch: 1n })).toBe(
      "restricted",
    );
    expect(deriveSolvencyState({ restricted: true, pending: true, riskEpoch: 2n, lastSolventRiskEpoch: 2n })).toBe(
      "restricted",
    );
  });

  it("formats six-decimal USDC and a fixed draw deadline without fake precision", () => {
    expect(formatUsdc(5_000_000n)).toBe("5.00 cUSDC");
    expect(formatCountdown(1_787_080_224n, 1_787_000_000_000)).toBe("22h 17m");
    expect(formatCountdown(1_787_080_224n, 1_787_080_224_000)).toBe("Ready to crank");
  });
});
