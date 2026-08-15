import type { Hex } from "viem";

import type { KeeperExecutableAction } from "../keeper/model";

export type LokTransactionActions = Readonly<{
  pending: boolean;
  mintTestTokens(): Promise<Hex>;
  shield(amount: string): Promise<Hex>;
  deposit(amount: string): Promise<Hex>;
  setRisk(percent: number): Promise<Hex>;
  withdraw(amount: string): Promise<Hex>;
  advanceDraw(action: KeeperExecutableAction): Promise<Hex>;
}>;

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
  if (error instanceof Error && error.message !== "") return error.message;
  return "The wallet transaction failed before confirmation.";
}
