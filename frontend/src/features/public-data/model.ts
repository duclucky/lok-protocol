import type { Hex } from "viem";

import { DRAW_STATES, type DrawState } from "../draw/model";
import type { SolvencyState } from "../vault/model";

export const ZERO_BYTES32 = `0x${"00".repeat(32)}` as Hex;

export type PublicDrawSnapshot = Readonly<{
  id: bigint;
  state: DrawState;
  strict: boolean;
  settled: boolean;
  aborted: boolean;
  noWinner: boolean;
  tStart: bigint;
  tEnd: bigint;
  revealDeadline: bigint;
  stateDeadline: bigint;
  cursor: bigint;
  preSyncCursor: bigint;
  participantSnapshot: bigint;
  realisedYield: bigint;
  prizeAmount: bigint;
  totalTickets: bigint;
  totalBaseRiskWeight: bigint;
  totalYieldWeight: bigint;
  cumRunning: Hex;
  cumBaseRiskRunning: Hex;
  cumYieldRunning: Hex;
  randomHandle: Hex;
  revealAccumulator: Hex;
}>;

export type LokPublicSnapshot = Readonly<{
  participantCount: bigint;
  riskEpoch: bigint;
  solvency: SolvencyState;
  fundedYield: bigint;
  draw?: PublicDrawSnapshot;
}>;

export type LokPublicData =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; snapshot: LokPublicSnapshot }>;

export function drawStateFromChain(value: number): DrawState {
  const state = DRAW_STATES[value];
  if (state === undefined) throw new Error(`Unknown draw state ${value}`);
  return state;
}

export function deriveSolvencyState(input: {
  restricted: boolean;
  pending: boolean;
  riskEpoch: bigint;
  lastSolventRiskEpoch: bigint;
}): SolvencyState {
  if (input.restricted) return "restricted";
  if (input.pending) return "pending";
  return input.riskEpoch === input.lastSolventRiskEpoch ? "verified" : "restricted";
}

export function formatUsdc(amount: bigint): string {
  const scale = 1_000_000n;
  const whole = amount / scale;
  const cents = ((amount % scale) / 10_000n).toString().padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${cents} cUSDC`;
}

export function formatCountdown(deadlineSeconds: bigint, nowMs = Date.now()): string {
  const remaining = Number(deadlineSeconds * 1_000n - BigInt(nowMs));
  if (remaining <= 0) return "Ready to crank";
  const minutes = Math.floor(remaining / 60_000);
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const restMinutes = minutes % 60;
  if (days > 0) return `${days}d ${hours}h ${restMinutes}m`;
  return `${hours}h ${restMinutes}m`;
}

export function formatUtc(timestampSeconds: bigint): string {
  if (timestampSeconds === 0n) return "Not scheduled";
  return `${new Date(Number(timestampSeconds) * 1_000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export function currentPrizeLabel(snapshot: LokPublicSnapshot): string {
  const settledPrize = snapshot.draw?.prizeAmount ?? 0n;
  if (settledPrize > 0n) return formatUsdc(settledPrize);
  if (snapshot.fundedYield > 0n) return `${formatUsdc(snapshot.fundedYield)} funded`;
  return "Yield pending";
}
