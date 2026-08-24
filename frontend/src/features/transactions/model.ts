import type { Hex } from "viem";

import type { KeeperExecutableAction } from "../keeper/model";

export type LokTransactionActions = Readonly<{
  pending: boolean;
  mintTestTokens(): Promise<Hex>;
  shield(amount: string): Promise<Hex>;
  deposit(amount: string): Promise<Hex>;
  setRisk(percent: number): Promise<Hex>;
  withdraw(amount: string): Promise<Hex>;
  withdrawAll(): Promise<Hex>;
  emergencyWithdraw(): Promise<Hex>;
  advanceDraw(action: KeeperExecutableAction): Promise<Hex>;
}>;

export type AsyncActionState =
  | { phase: "idle" }
  | { phase: "validating"; message: string }
  | { phase: "awaiting-wallet"; message: string }
  | { phase: "processing"; message: string }
  | { phase: "submitted"; hash: Hex; message: string }
  | { phase: "confirming"; hash: Hex; message: string }
  | { phase: "confirmed"; hash: Hex; message: string }
  | { phase: "failed"; message: string; technicalDetail?: string; retryable: boolean };

const TRANSACTION_HASH_PATTERN = /^0x[\da-fA-F]{64}$/;

function withHash(
  phase: "submitted" | "confirming" | "confirmed",
  hash: Hex,
  message: string,
): Extract<AsyncActionState, { hash: Hex }> {
  if (!TRANSACTION_HASH_PATTERN.test(hash)) throw new Error("A complete transaction hash is required.");
  return { phase, hash, message };
}

export function validating(message: string): AsyncActionState {
  return { phase: "validating", message };
}

export function awaitingWallet(message: string): AsyncActionState {
  return { phase: "awaiting-wallet", message };
}

export function processing(message: string): AsyncActionState {
  return { phase: "processing", message };
}

export function submitted(hash: Hex, message: string): AsyncActionState {
  return withHash("submitted", hash, message);
}

export function confirming(hash: Hex, message: string): AsyncActionState {
  return withHash("confirming", hash, message);
}

export function confirmed(hash: Hex, message: string): AsyncActionState {
  return withHash("confirmed", hash, message);
}

function errorDetail(error: unknown): string | undefined {
  if (error instanceof Error && error.message.trim() !== "") return error.message;
  if (typeof error === "string" && error.trim() !== "") return error;
  return undefined;
}

export function failedAction(error: unknown): Extract<AsyncActionState, { phase: "failed" }> {
  const technicalDetail = errorDetail(error);
  const normalized = technicalDetail?.toLowerCase() ?? "";

  if (/(user rejected|user denied|rejected the request|request rejected)/.test(normalized)) {
    return {
      phase: "failed",
      message: "You declined the wallet request. No transaction was sent.",
      technicalDetail,
      retryable: false,
    };
  }

  if (/(insufficient funds|funds for gas)/.test(normalized)) {
    return {
      phase: "failed",
      message: "This wallet does not have enough Sepolia ETH for network fees. Add test ETH and try again.",
      technicalDetail,
      retryable: true,
    };
  }

  if (/(switch.*sepolia|wrong network|chain mismatch)/.test(normalized)) {
    return {
      phase: "failed",
      message: "Switch your wallet to Ethereum Sepolia, then try again.",
      technicalDetail,
      retryable: true,
    };
  }

  if (/(insufficient token|insufficient balance|amount exceeds balance)/.test(normalized)) {
    return {
      phase: "failed",
      message: "There is not enough token balance for this amount. Lower the amount or fund the wallet.",
      technicalDetail,
      retryable: true,
    };
  }

  if (/(encrypt|relayer|encrypted input|input proof)/.test(normalized)) {
    return {
      phase: "failed",
      message: "Encryption did not complete. Check the FHEVM SDK connection and try again.",
      technicalDetail,
      retryable: true,
    };
  }

  return {
    phase: "failed",
    message: "The action did not complete. Check your connection and try again; no confirmed change was recorded.",
    technicalDetail,
    retryable: true,
  };
}

export function parseUsdcAmount(value: string): bigint {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (match === null) throw new Error("Enter a positive amount with at most six decimals.");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0"));
  const amount = whole * 1_000_000n + fraction;
  if (amount <= 0n) throw new Error("Amount must be greater than zero.");
  return amount;
}

export function riskPercentToTheta(percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100 || percent % 25 !== 0) {
    throw new Error("Risk must be one of 0, 25, 50, 75, or 100 percent.");
  }
  return BigInt(percent / 25);
}

export function transactionMessage(error: unknown): string {
  return failedAction(error).message;
}
