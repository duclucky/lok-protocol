import { describe, expect, it } from "vitest";

import { decodeVaultActionStatus } from "../../fhe/decryption-machine";

describe("encrypted vault action status", () => {
  it("maps true to an operation-specific success message", () => {
    expect(decodeVaultActionStatus("DEPOSIT", true)).toEqual({
      code: "OK",
      message: "Deposited.",
    });
    expect(decodeVaultActionStatus("WITHDRAW", true)).toEqual({
      code: "OK",
      message: "Withdrew.",
    });
  });

  it("does not invent a precise clamp reason from the contract's ebool", () => {
    expect(decodeVaultActionStatus("WITHDRAW", false)).toEqual({
      code: "CLAMPED_OR_NO_OP",
      message: "The requested action was clamped or made no change. Your funds remain accounted for.",
    });
  });
});
