import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecryptionMachine, PermitDeclinedError, createDecryptionCache } from "../../fhe/decryption-machine";

const input = {
  encryptedValue: `0x${"11".repeat(32)}` as const,
  contractAddress: "0x0000000000000000000000000000000000000001" as const,
  account: "0x0000000000000000000000000000000000000002" as const,
};

describe("DecryptionMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts sealed and never decrypts on construction", () => {
    const decrypt = vi.fn();
    const machine = new DecryptionMachine({
      input,
      ensurePermit: vi.fn(),
      decrypt,
      cache: createDecryptionCache(),
    });

    expect(machine.snapshot).toEqual({ status: "SEALED" });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("requests a permit before decrypting and reveals the value", async () => {
    const calls: string[] = [];
    const machine = new DecryptionMachine({
      input,
      ensurePermit: vi.fn(async () => {
        calls.push("permit");
      }),
      decrypt: vi.fn(async () => {
        calls.push("decrypt");
        return 42n;
      }),
      cache: createDecryptionCache(),
    });

    await machine.reveal();

    expect(calls).toEqual(["permit", "decrypt"]);
    expect(machine.snapshot).toEqual({ status: "REVEALED", value: 42n });
  });

  it("reuses a clear value cached by handle", async () => {
    const cache = createDecryptionCache<bigint>();
    const first = new DecryptionMachine({
      input,
      ensurePermit: vi.fn(),
      decrypt: vi.fn().mockResolvedValue(9n),
      cache,
    });
    await first.reveal();

    const ensurePermit = vi.fn();
    const decrypt = vi.fn();
    const machine = new DecryptionMachine({ input, ensurePermit, decrypt, cache });

    await machine.reveal();

    expect(machine.snapshot).toEqual({ status: "REVEALED", value: 9n });
    expect(ensurePermit).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("never shares a cached clear value across wallet accounts", async () => {
    const cache = createDecryptionCache<bigint>();
    const first = new DecryptionMachine({
      input,
      ensurePermit: vi.fn(),
      decrypt: vi.fn().mockResolvedValue(9n),
      cache,
    });
    await first.reveal();

    const decrypt = vi.fn().mockResolvedValue(10n);
    const second = new DecryptionMachine({
      input: { ...input, account: "0x0000000000000000000000000000000000000003" },
      ensurePermit: vi.fn(),
      decrypt,
      cache,
    });
    await second.reveal();

    expect(decrypt).toHaveBeenCalledOnce();
    expect(second.snapshot).toEqual({ status: "REVEALED", value: 10n });
  });

  it("reseals after 60 seconds without discarding the handle cache", async () => {
    const decrypt = vi.fn().mockResolvedValue(7n);
    const machine = new DecryptionMachine({
      input,
      ensurePermit: vi.fn(),
      decrypt,
      cache: createDecryptionCache(),
    });

    await machine.reveal();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(machine.snapshot.status).toBe("REVEALED");

    await vi.advanceTimersByTimeAsync(1);
    expect(machine.snapshot).toEqual({ status: "SEALED" });

    await machine.reveal();
    expect(machine.snapshot).toEqual({ status: "REVEALED", value: 7n });
    expect(decrypt).toHaveBeenCalledOnce();
  });

  it("records an explicit declined state when the permit signature is rejected", async () => {
    const machine = new DecryptionMachine({
      input,
      ensurePermit: vi.fn().mockRejectedValue(new PermitDeclinedError()),
      decrypt: vi.fn(),
      cache: createDecryptionCache(),
    });

    await machine.reveal();

    expect(machine.snapshot).toEqual({ status: "DECLINED" });
  });

  it("reports an honest read failure and retries only after exponential backoff", async () => {
    const decrypt = vi
      .fn()
      .mockRejectedValueOnce(new Error("relayer offline"))
      .mockRejectedValueOnce(new Error("still offline"))
      .mockResolvedValueOnce(5n);
    const machine = new DecryptionMachine({
      input,
      ensurePermit: vi.fn(),
      decrypt,
      cache: createDecryptionCache(),
      retryBaseMs: 1_000,
      retryMaxMs: 8_000,
    });

    await machine.reveal();
    expect(machine.snapshot).toMatchObject({
      status: "FAILED",
      retryAfterMs: 1_000,
      message: "Couldn't reach the decryption network. Your funds are safe; this read failed.",
    });
    expect(decrypt).toHaveBeenCalledOnce();

    await expect(machine.retry()).rejects.toThrow("Retry is available in 1000ms");
    expect(decrypt).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);
    await machine.retry();
    expect(machine.snapshot).toMatchObject({ status: "FAILED", retryAfterMs: 2_000 });
    expect(decrypt).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    await machine.retry();
    expect(machine.snapshot).toEqual({ status: "REVEALED", value: 5n });
    expect(decrypt).toHaveBeenCalledTimes(3);
  });

  it("coalesces repeated reveal clicks while a request is in flight", async () => {
    let resolveDecrypt!: (value: bigint) => void;
    const decrypt = vi.fn(
      () =>
        new Promise<bigint>((resolve) => {
          resolveDecrypt = resolve;
        }),
    );
    const machine = new DecryptionMachine({
      input,
      ensurePermit: vi.fn(),
      decrypt,
      cache: createDecryptionCache(),
    });

    const first = machine.reveal();
    const second = machine.reveal();
    await vi.advanceTimersByTimeAsync(0);
    resolveDecrypt(12n);
    await Promise.all([first, second]);

    expect(decrypt).toHaveBeenCalledOnce();
    expect(machine.snapshot).toEqual({ status: "REVEALED", value: 12n });
  });
});
