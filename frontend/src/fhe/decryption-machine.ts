import type { Address, Hex } from "viem";

export type DecryptionInput = {
  encryptedValue: Hex;
  contractAddress: Address;
  account: Address;
};

export type DecryptionState<T> =
  | { status: "SEALED" }
  | { status: "REQUESTING_PERMIT" }
  | { status: "DECLINED" }
  | { status: "DECRYPTING" }
  | { status: "REVEALED"; value: T }
  | { status: "FAILED"; message: string; retryAfterMs: number; cause: unknown };

export type DecryptionCache<T> = Pick<Map<string, T>, "get" | "has" | "set">;

export interface DecryptionMachineOptions<T> {
  input: DecryptionInput;
  ensurePermit(): Promise<void>;
  decrypt(input: DecryptionInput): Promise<T>;
  cache?: DecryptionCache<T>;
  resealMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  now?: () => number;
}

export class PermitDeclinedError extends Error {
  constructor(message = "The decryption permit was declined.") {
    super(message);
    this.name = "PermitDeclinedError";
  }
}

const sharedCache = new Map<string, unknown>();
const DECRYPTION_FAILURE_MESSAGE = "Couldn't reach the decryption network. Your funds are safe; this read failed.";

export function createDecryptionCache<T>(): Map<string, T> {
  return new Map<string, T>();
}

export class DecryptionMachine<T> {
  private state: DecryptionState<T> = { status: "SEALED" };
  private readonly listeners = new Set<(state: DecryptionState<T>) => void>();
  private readonly cache: DecryptionCache<T>;
  private readonly resealMs: number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly now: () => number;
  private revealRequest: Promise<void> | undefined;
  private resealTimer: ReturnType<typeof setTimeout> | undefined;
  private failureCount = 0;
  private retryAvailableAt = 0;

  constructor(private readonly options: DecryptionMachineOptions<T>) {
    this.cache = options.cache ?? (sharedCache as DecryptionCache<T>);
    this.resealMs = options.resealMs ?? 60_000;
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.retryMaxMs = options.retryMaxMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get snapshot(): DecryptionState<T> {
    return this.state;
  }

  subscribe(listener: (state: DecryptionState<T>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reveal(): Promise<void> {
    if (this.revealRequest !== undefined) return this.revealRequest;

    const key = this.cacheKey();
    const cached = this.cache.get(key);
    if (this.cache.has(key)) {
      this.setRevealed(cached as T);
      return Promise.resolve();
    }

    this.revealRequest = this.runReveal().finally(() => {
      this.revealRequest = undefined;
    });
    return this.revealRequest;
  }

  async retry(): Promise<void> {
    if (this.state.status !== "FAILED") {
      throw new Error("Retry is only available after a failed decryption.");
    }

    const remaining = Math.max(0, this.retryAvailableAt - this.now());
    if (remaining > 0) throw new Error(`Retry is available in ${remaining}ms`);
    await this.reveal();
  }

  seal(): void {
    if (this.resealTimer !== undefined) clearTimeout(this.resealTimer);
    this.resealTimer = undefined;
    this.transition({ status: "SEALED" });
  }

  dispose(): void {
    if (this.resealTimer !== undefined) clearTimeout(this.resealTimer);
    this.listeners.clear();
  }

  private async runReveal(): Promise<void> {
    this.transition({ status: "REQUESTING_PERMIT" });
    try {
      await this.options.ensurePermit();
    } catch (error) {
      if (error instanceof PermitDeclinedError) {
        this.transition({ status: "DECLINED" });
        return;
      }
      this.fail(error);
      return;
    }

    this.transition({ status: "DECRYPTING" });
    try {
      const value = await this.options.decrypt(this.options.input);
      this.cache.set(this.cacheKey(), value);
      this.failureCount = 0;
      this.setRevealed(value);
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(cause: unknown): void {
    const retryAfterMs = Math.min(this.retryMaxMs, this.retryBaseMs * 2 ** this.failureCount);
    this.failureCount += 1;
    this.retryAvailableAt = this.now() + retryAfterMs;
    this.transition({
      status: "FAILED",
      message: DECRYPTION_FAILURE_MESSAGE,
      retryAfterMs,
      cause,
    });
  }

  private setRevealed(value: T): void {
    if (this.resealTimer !== undefined) clearTimeout(this.resealTimer);
    this.transition({ status: "REVEALED", value });
    this.resealTimer = setTimeout(() => this.seal(), this.resealMs);
  }

  private transition(state: DecryptionState<T>): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  private cacheKey(): string {
    const { account, contractAddress, encryptedValue } = this.options.input;
    return `${account.toLowerCase()}:${contractAddress.toLowerCase()}:${encryptedValue.toLowerCase()}`;
  }
}

export type VaultAction = "DEPOSIT" | "WITHDRAW" | "EXIT" | "SET_THETA";

export type VaultActionResult = {
  code: "OK" | "CLAMPED_OR_NO_OP";
  message: string;
};

export function decodeVaultActionStatus(action: VaultAction, succeeded: boolean): VaultActionResult {
  if (!succeeded) {
    return {
      code: "CLAMPED_OR_NO_OP",
      message: "The requested action was clamped or made no change. Your funds remain accounted for.",
    };
  }

  const successMessages: Record<VaultAction, string> = {
    DEPOSIT: "Deposited.",
    WITHDRAW: "Withdrew.",
    EXIT: "Exit completed.",
    SET_THETA: "Risk preference updated.",
  };
  return { code: "OK", message: successMessages[action] };
}
