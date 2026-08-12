import { describe, expect, it } from "vitest";

import { parseUsdcAmount, riskPercentToTheta } from "../../features/transactions/model";

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
});
