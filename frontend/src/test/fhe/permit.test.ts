import { describe, expect, it, vi } from "vitest";
import { SigningRejectedError } from "@zama-fhe/sdk";

import { PermitDeclinedError } from "../../fhe/decryption-machine";
import { createPermitGate, normalizePermitError } from "../../fhe/permit";

const contracts = ["0x0000000000000000000000000000000000000001"] as const;

describe("permit gate", () => {
  it("reuses a cached permit without prompting", async () => {
    const hasPermit = vi.fn().mockResolvedValue(true);
    const grantPermit = vi.fn();
    const gate = createPermitGate({ hasPermit, grantPermit });

    await gate.ensure(contracts);

    expect(hasPermit).toHaveBeenCalledOnce();
    expect(grantPermit).not.toHaveBeenCalled();
  });

  it("coalesces concurrent requests into one wallet prompt", async () => {
    const hasPermit = vi.fn().mockResolvedValue(false);
    const grantPermit = vi.fn().mockResolvedValue(undefined);
    const gate = createPermitGate({ hasPermit, grantPermit });

    await Promise.all([gate.ensure(contracts), gate.ensure(contracts), gate.ensure(contracts)]);

    expect(hasPermit).toHaveBeenCalledOnce();
    expect(grantPermit).toHaveBeenCalledOnce();
    expect(grantPermit).toHaveBeenCalledWith(contracts);
  });

  it("maps only an explicit wallet rejection to DECLINED", () => {
    expect(normalizePermitError(new SigningRejectedError("rejected"))).toBeInstanceOf(PermitDeclinedError);

    const networkError = new Error("network failed");
    expect(normalizePermitError(networkError)).toBe(networkError);
  });
});
