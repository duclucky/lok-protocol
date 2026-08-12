export const THETA_DENOM = 4n;
export const RATE_CAP = 1n << 52n;

export type SyncMutation =
  | { at: bigint; kind: "deposit"; amount: bigint }
  | { at: bigint; kind: "withdraw"; amount: bigint }
  | { at: bigint; kind: "setTheta"; theta: bigint };

export type SyncVector = {
  seed: string;
  tStart: bigint;
  tEnd: bigint;
  initialBalance: bigint;
  initialTheta: bigint;
  mutations: SyncMutation[];
  finalSyncAt: bigint;
};

export type SyncResult = {
  ticketDelta: bigint;
  yieldDelta: bigint;
  finalBalance: bigint;
  finalTheta: bigint;
};

function persistDivergence(seed: string, actual: unknown, expected: unknown): void {
  const directory = path.resolve(process.cwd(), "artifacts", "differential");
  mkdirSync(directory, { recursive: true });
  const body = JSON.stringify(
    { seed, actual, expected, recordedAtUtc: new Date().toISOString() },
    (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
  try {
    writeFileSync(path.join(directory, "sync-first-divergence.json"), `${body}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export function assertSyncEquivalent(seed: string, actual: unknown, expected: unknown): void {
  try {
    deepStrictEqual(actual, expected);
  } catch (error) {
    persistDivergence(seed, actual, expected);
    throw new Error(`sync differential divergence at seed ${seed}`, { cause: error });
  }
}

function clamp(value: bigint, maximum: bigint): bigint {
  return value > maximum ? maximum : value;
}

function assertVector(vector: SyncVector): void {
  if (vector.tEnd <= vector.tStart) throw new Error("invalid draw window");
  if (vector.initialBalance < 0n || vector.initialTheta < 0n) throw new Error("negative initial state");
  if (vector.finalSyncAt < vector.tStart) throw new Error("final sync precedes draw");

  let previous = vector.tStart;
  for (const mutation of vector.mutations) {
    if (mutation.at < previous || mutation.at > vector.finalSyncAt) throw new Error("mutations must be ordered");
    if (mutation.kind === "setTheta") {
      if (mutation.theta < 0n) throw new Error("negative theta");
    } else if (mutation.amount < 0n) {
      throw new Error("negative amount");
    }
    previous = mutation.at;
  }
}

export function evaluateSyncVector(vector: SyncVector): SyncResult {
  assertVector(vector);
  let balance = vector.initialBalance;
  let theta = clamp(vector.initialTheta, THETA_DENOM);
  let cursor = vector.tStart;
  let ticketDelta = 0n;
  let yieldDelta = 0n;

  const accrueUntil = (timestamp: bigint): void => {
    const boundary = timestamp < vector.tEnd ? timestamp : vector.tEnd;
    if (boundary <= cursor) return;
    const elapsed = boundary - cursor;
    const rate = clamp(balance * theta, RATE_CAP);
    ticketDelta += rate * elapsed;
    yieldDelta += balance * elapsed;
    cursor = boundary;
  };

  for (const mutation of vector.mutations) {
    accrueUntil(mutation.at);
    if (mutation.kind === "deposit") balance += mutation.amount;
    if (mutation.kind === "withdraw") balance -= mutation.amount < balance ? mutation.amount : balance;
    if (mutation.kind === "setTheta") theta = clamp(mutation.theta, THETA_DENOM);
  }
  accrueUntil(vector.finalSyncAt);

  return { ticketDelta, yieldDelta, finalBalance: balance, finalTheta: theta };
}

function seedState(seed: string): number {
  let state = 0x811c9dc5;
  for (const character of seed) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 0x01000193) >>> 0;
  }
  return state || 1;
}

export function deterministicSyncVectors(seed: string, count: number): SyncVector[] {
  let state = seedState(seed);
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };

  return Array.from({ length: count }, (_, index) => {
    const tStart = 10_000n + BigInt(index * 1_000);
    const period = 80n + BigInt(next() % 80);
    const tEnd = tStart + period;
    const firstAt = tStart + 1n + BigInt(next() % Number(period / 3n));
    const secondAt = firstAt + 1n + BigInt(next() % Number(period / 3n));
    const thirdAt = secondAt + 1n + BigInt(next() % Number(tEnd - secondAt - 1n));
    const finalSyncAt = tEnd + BigInt(next() % 3);

    return {
      seed: `${seed}:${index}`,
      tStart,
      tEnd,
      initialBalance: 1n + BigInt(next() % 1_000),
      initialTheta: BigInt(next() % 5),
      mutations: [
        { at: firstAt, kind: "deposit", amount: BigInt(next() % 500) },
        { at: secondAt, kind: "setTheta", theta: BigInt(next() % 7) },
        { at: thirdAt, kind: "withdraw", amount: BigInt(next() % 700) },
      ],
      finalSyncAt,
    };
  });
}
import { deepStrictEqual } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
