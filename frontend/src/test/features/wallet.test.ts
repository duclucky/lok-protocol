import { describe, expect, it } from "vitest";

import { clearBoolean, clearBigIntValue, thetaValueToPercent } from "../../fhe/private-value-model";
import { deriveWalletPublicData, formatPublicUsdc } from "../../features/wallet/model";

describe("wallet public data", () => {
  it("formats a six-decimal public USDC balance without overstating precision", () => {
    expect(formatPublicUsdc(12_345_678n)).toBe("12.34 USDC");
  });

  it("keeps disconnected, loading, error, and ready states distinct", () => {
    expect(deriveWalletPublicData({ connected: false })).toEqual({ status: "disconnected" });
    expect(deriveWalletPublicData({ connected: true })).toEqual({ status: "loading" });
    expect(deriveWalletPublicData({ connected: true, error: new Error("rpc") })).toEqual({
      status: "error",
      message: "Could not read the connected wallet's public USDC balance.",
    });
    expect(deriveWalletPublicData({ connected: true, balance: 12_345_678n })).toEqual({
      status: "ready",
      publicUsdc: "12.34 USDC",
    });
  });
});

describe("private value decoding", () => {
  it.each([
    [0n, 0],
    [1n, 25],
    [2n, 50],
    [3n, 75],
    [4n, 100],
  ] as const)("maps encrypted theta clear value %s to %s percent", (value, percent) => {
    expect(thetaValueToPercent(value)).toBe(percent);
  });

  it("rejects a theta value outside the contract domain", () => {
    expect(() => thetaValueToPercent(5n)).toThrow("outside the supported range");
  });

  it("decodes SDK clear values without accepting ambiguous booleans", () => {
    expect(clearBigIntValue("42")).toBe(42n);
    expect(clearBoolean(true)).toBe(true);
    expect(clearBoolean(0n)).toBe(false);
    expect(() => clearBoolean(2n)).toThrow("not a boolean");
  });
});
