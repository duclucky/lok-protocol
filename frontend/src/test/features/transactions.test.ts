import { describe, expect, it } from "vitest";

import {
  awaitingWallet,
  confirmed,
  failedAction,
  parseUsdcAmount,
  processing,
  riskPercentToTheta,
} from "../../features/transactions/model";

const transactionHash = `0x${"12".repeat(32)}` as const;

describe("Lok transaction inputs", () => {
  it("parses exact six-decimal USDC values without floating point", () => {
    expect(parseUsdcAmount("1.234567")).toBe(1_234_567n);
    expect(parseUsdcAmount("10")).toBe(10_000_000n);
  });

  it.each(["", "0", "-1", "1.2345678", "1e3", "abc"])("rejects unsafe amount %s", (value) => {
    expect(() => parseUsdcAmount(value)).toThrow();
  });

  it("maps the reviewed risk percentages to encrypted theta quarters", () => {
    expect([0, 25, 50, 75, 100].map(riskPercentToTheta)).toEqual([0n, 1n, 2n, 3n, 4n]);
    expect(() => riskPercentToTheta(30)).toThrow();
  });

  it("creates serializable lifecycle states with a required confirmed hash", () => {
    const states = [
      awaitingWallet("Confirm in your wallet."),
      processing("Encrypting the amount."),
      confirmed(transactionHash, "Deposit confirmed."),
    ];

    expect(JSON.parse(JSON.stringify(states))).toEqual(states);
    expect(() => confirmed("0x" as `0x${string}`, "Invalid confirmation.")).toThrow(/transaction hash/i);
  });

  it("keeps raw RPC errors out of the primary recovery message", () => {
    const failure = failedAction(new Error("execution reverted: raw provider detail 0xdeadbeef"));

    expect(failure.phase).toBe("failed");
    expect(failure.message).toMatch(/try again/i);
    expect(failure.message).not.toContain("0xdeadbeef");
    expect(failure.technicalDetail).toContain("0xdeadbeef");
    expect(failure.retryable).toBe(true);
  });

  it("explains wallet rejection without suggesting a blind retry", () => {
    const failure = failedAction(new Error("User rejected the request"));

    expect(failure.message).toMatch(/declined/i);
    expect(failure.retryable).toBe(false);
  });
});
