import { BaseContract, Result } from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ethers, fhevm, network } from "hardhat";

import { assertDeploymentManifest } from "./deploy";

export enum DrawState {
  IDLE,
  OPEN,
  SWEEP_A,
  AWAIT_TOTAL,
  REVEAL,
  RANDOM_SET,
  SWEEP_B,
  SETTLED,
}

const PRESYNC_CAP = 4n;
const BATCH_A_MAX = 3n;
const BATCH_B_MAX = 2n;

type Hex = `0x${string}`;

export type CrankSnapshot = {
  state: DrawState;
  now: bigint;
  drawId: bigint;
  tEnd: bigint;
  minSettleDelay: bigint;
  revealDeadline: bigint;
  stateDeadline: bigint;
  participantSnapshot: bigint;
  preSyncCursor: bigint;
  cursor: bigint;
  strict: boolean;
  totalsSubmitted: boolean;
  totalTickets: bigint;
  aggregateHandles: readonly [Hex, Hex, Hex];
  solvency?: {
    authorized: boolean;
    pending: boolean;
    epoch: bigint;
    nonce: bigint;
    handle: Hex;
  };
};

export type CrankDecision =
  | { kind: "done" }
  | { kind: "wait"; until: bigint }
  | { kind: "openCheckpoint" }
  | { kind: "submitCheckpoint" }
  | { kind: "preSyncA"; batch: bigint }
  | { kind: "crankA"; batch: bigint }
  | { kind: "submitTotals" }
  | { kind: "enterReveal" }
  | { kind: "openRandom" }
  | { kind: "crankB"; batch: bigint };

export type ExecutableCrankAction =
  | Exclude<CrankDecision, { kind: "submitTotals" } | { kind: "submitCheckpoint" }>
  | { kind: "submitTotals"; abiEncodedClearValues: string; decryptionProof: string }
  | {
      kind: "submitCheckpoint";
      epoch: bigint;
      nonce: bigint;
      abiEncodedClearValues: string;
      decryptionProof: string;
    };

type PublicDecryption = { abiEncodedClearValues: string; decryptionProof: string };

export type CrankRuntime = {
  readSnapshot(): Promise<CrankSnapshot>;
  send(action: ExecutableCrankAction): Promise<void>;
  decryptTotals(handles: readonly [Hex, Hex, Hex]): Promise<PublicDecryption>;
  decryptCheckpoint?(handle: Hex): Promise<PublicDecryption>;
  sleep(milliseconds: number): Promise<void>;
};

export type CrankCycleOptions = {
  maxSteps: number;
  maxDecryptRetries: number;
  baseBackoffMs: number;
};

export class StaleStateError extends Error {}

type KeeperEnvironment = Readonly<Record<string, string | undefined>>;

function booleanOption(value: string | undefined, label: string): boolean {
  if (value === undefined || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new Error(`${label} must be 1, 0, true, or false`);
}

export function resolveKeeperOptions(
  environment: KeeperEnvironment,
  args: readonly string[] = [],
): { open: boolean; strict: boolean } {
  return {
    open: booleanOption(environment.LOK_OPEN_DRAW, "LOK_OPEN_DRAW") || args.includes("--open"),
    strict: booleanOption(environment.LOK_STRICT_DRAW, "LOK_STRICT_DRAW") || args.includes("--strict"),
  };
}

function boundedBatch(remaining: bigint, cap: bigint): bigint {
  return remaining < cap ? remaining : cap;
}

export function decideCrankAction(snapshot: CrankSnapshot): CrankDecision {
  if (snapshot.solvency?.pending === true) return { kind: "submitCheckpoint" };
  if (
    snapshot.solvency !== undefined &&
    !snapshot.solvency.authorized &&
    (snapshot.state === DrawState.IDLE || snapshot.state === DrawState.SETTLED)
  ) {
    return { kind: "openCheckpoint" };
  }
  switch (snapshot.state) {
    case DrawState.IDLE:
    case DrawState.SETTLED:
      return { kind: "done" };
    case DrawState.OPEN:
    case DrawState.SWEEP_A: {
      if (snapshot.now < snapshot.tEnd) return { kind: "wait", until: snapshot.tEnd };
      if (snapshot.preSyncCursor < snapshot.participantSnapshot) {
        return {
          kind: "preSyncA",
          batch: boundedBatch(snapshot.participantSnapshot - snapshot.preSyncCursor, PRESYNC_CAP),
        };
      }
      const settleAt = snapshot.tEnd + snapshot.minSettleDelay;
      if (snapshot.now < settleAt) return { kind: "wait", until: settleAt };
      if (snapshot.participantSnapshot === 0n) return { kind: "crankA", batch: 1n };
      return {
        kind: "crankA",
        batch: boundedBatch(snapshot.participantSnapshot - snapshot.cursor, BATCH_A_MAX),
      };
    }
    case DrawState.AWAIT_TOTAL:
      if (snapshot.totalsSubmitted && snapshot.strict && snapshot.totalTickets > 0n) return { kind: "enterReveal" };
      return { kind: "submitTotals" };
    case DrawState.REVEAL:
      return snapshot.now < snapshot.revealDeadline
        ? { kind: "wait", until: snapshot.revealDeadline }
        : { kind: "openRandom" };
    case DrawState.RANDOM_SET:
      return { kind: "openRandom" };
    case DrawState.SWEEP_B:
      return {
        kind: "crankB",
        batch: boundedBatch(snapshot.participantSnapshot - snapshot.cursor, BATCH_B_MAX),
      };
  }
}

async function decryptWithBackoff(
  operation: () => Promise<PublicDecryption>,
  runtime: CrankRuntime,
  options: CrankCycleOptions,
): Promise<PublicDecryption> {
  let lastError: unknown;
  for (let attempt = 0; attempt < options.maxDecryptRetries; ++attempt) {
    try {
      return await operation();
    } catch (error: unknown) {
      lastError = error;
      if (attempt + 1 < options.maxDecryptRetries) {
        await runtime.sleep(options.baseBackoffMs * 2 ** attempt);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("public decryption failed");
}

export async function runCrankCycle(
  runtime: CrankRuntime,
  options: CrankCycleOptions,
): Promise<{ status: "done" | "waiting" | "step-limit"; steps: number; until?: bigint }> {
  if (options.maxSteps < 1 || options.maxDecryptRetries < 1 || options.baseBackoffMs < 0) {
    throw new Error("Invalid keeper retry limits");
  }
  for (let step = 0; step < options.maxSteps; ++step) {
    const snapshot = await runtime.readSnapshot();
    const decision = decideCrankAction(snapshot);
    if (decision.kind === "done") return { status: "done", steps: step };
    if (decision.kind === "wait") return { status: "waiting", steps: step, until: decision.until };
    let action: ExecutableCrankAction;
    if (decision.kind === "submitTotals") {
      const decrypted = await decryptWithBackoff(
        () => runtime.decryptTotals(snapshot.aggregateHandles),
        runtime,
        options,
      );
      action = { kind: "submitTotals", ...decrypted };
    } else if (decision.kind === "submitCheckpoint") {
      if (snapshot.solvency === undefined || runtime.decryptCheckpoint === undefined) {
        throw new Error("Checkpoint state requires a public-decryption runtime");
      }
      const decrypted = await decryptWithBackoff(
        () => runtime.decryptCheckpoint!(snapshot.solvency!.handle),
        runtime,
        options,
      );
      action = {
        kind: "submitCheckpoint",
        epoch: snapshot.solvency.epoch,
        nonce: snapshot.solvency.nonce,
        ...decrypted,
      };
    } else {
      action = decision;
    }
    try {
      await runtime.send(action);
    } catch (error: unknown) {
      if (error instanceof StaleStateError) continue;
      throw error;
    }
  }
  return { status: "step-limit", steps: options.maxSteps };
}

export function normalizeHandle(value: bigint | string): Hex {
  if (typeof value === "bigint") return `0x${value.toString(16).padStart(64, "0")}` as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`Invalid encrypted handle ${value}`);
  return value as Hex;
}

function isStaleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /InvalidState|ParticipantsNotSynced|BatchOutOfRange|nonce has already been used|replacement transaction/i.test(
    message,
  );
}

async function waitForWrite(contract: BaseContract, method: string, args: readonly unknown[] = []): Promise<void> {
  try {
    const tx = await contract.getFunction(method)(...args);
    const receipt = await tx.wait();
    if (receipt === null) throw new Error(`${method} transaction was not mined`);
    console.log(JSON.stringify({ action: method, transactionHash: receipt.hash }));
  } catch (error: unknown) {
    if (isStaleError(error)) throw new StaleStateError(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function liveRuntime(draw: BaseContract, vault: BaseContract): Promise<CrankRuntime> {
  return {
    readSnapshot: async () => {
      const id = (await draw.getFunction("drawId").staticCall()) as bigint;
      const info = (await draw.getFunction("drawInfo").staticCall(id)) as Result;
      const block = await ethers.provider.getBlock("latest");
      if (block === null) throw new Error("Latest block is unavailable");
      const riskEpoch = (await vault.getFunction("riskEpoch").staticCall()) as bigint;
      const pending = (await vault.getFunction("hasPendingSolvencyCheckpoint").staticCall()) as boolean;
      return {
        state: Number(await draw.getFunction("state").staticCall()) as DrawState,
        now: BigInt(block.timestamp),
        drawId: id,
        tEnd: info.tEnd as bigint,
        minSettleDelay: (await draw.getFunction("MIN_SETTLE_DELAY").staticCall()) as bigint,
        revealDeadline: (await draw.getFunction("revealDeadline").staticCall()) as bigint,
        stateDeadline: (await draw.getFunction("stateDeadline").staticCall()) as bigint,
        participantSnapshot: (await draw.getFunction("participantSnapshot").staticCall()) as bigint,
        preSyncCursor: (await draw.getFunction("preSyncCursor").staticCall()) as bigint,
        cursor: (await draw.getFunction("cursor").staticCall()) as bigint,
        strict: info.strict as boolean,
        totalsSubmitted: info.totalsSubmitted as boolean,
        totalTickets: info.totalTickets as bigint,
        aggregateHandles: [
          normalizeHandle(info.cumRunning as bigint | string),
          normalizeHandle(info.cumBaseRiskRunning as bigint | string),
          normalizeHandle(info.cumYieldRunning as bigint | string),
        ],
        solvency: {
          authorized: (await vault.getFunction("lastSolventRiskEpoch").staticCall()) === riskEpoch,
          pending,
          epoch: (await vault.getFunction("pendingSolvencyRiskEpoch").staticCall()) as bigint,
          nonce: (await vault.getFunction("solvencyCheckpointNonce").staticCall()) as bigint,
          handle: (await vault.getFunction("pendingSolvencyHandle").staticCall()) as Hex,
        },
      } satisfies CrankSnapshot;
    },
    send: async (action) => {
      switch (action.kind) {
        case "openCheckpoint":
          await waitForWrite(vault, "openSolvencyCheckpoint");
          break;
        case "submitCheckpoint":
          await waitForWrite(vault, "submitSolvencyCheckpoint", [
            action.epoch,
            action.nonce,
            action.abiEncodedClearValues,
            action.decryptionProof,
          ]);
          break;
        case "preSyncA":
        case "crankA":
        case "crankB":
          await waitForWrite(draw, action.kind, [action.batch]);
          break;
        case "submitTotals":
          await waitForWrite(draw, "submitTotals", [action.abiEncodedClearValues, action.decryptionProof]);
          break;
        case "enterReveal":
        case "openRandom":
          await waitForWrite(draw, action.kind);
          break;
        case "done":
        case "wait":
          throw new Error(`${action.kind} is not an executable keeper action`);
      }
    },
    decryptTotals: async (handles) => {
      const result = await fhevm.publicDecrypt([...handles]);
      return { abiEncodedClearValues: result.abiEncodedClearValues, decryptionProof: result.decryptionProof };
    },
    decryptCheckpoint: async (handle) => {
      const result = await fhevm.publicDecrypt([handle]);
      return { abiEncodedClearValues: result.abiEncodedClearValues, decryptionProof: result.decryptionProof };
    },
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  };
}

async function main(): Promise<void> {
  if (network.name !== "sepolia") throw new Error("crank.ts only supports Ethereum Sepolia");
  await fhevm.initializeCLIApi();
  if (fhevm.isMock) throw new Error("crank.ts refuses the mock FHEVM backend");
  const raw: unknown = JSON.parse(await readFile(path.join(process.cwd(), "deployments", "sepolia.json"), "utf8"));
  assertDeploymentManifest(raw);
  const [keeper] = await ethers.getSigners();
  if (keeper === undefined) throw new Error("A funded keeper signer is required to submit permissionless transactions");
  const draw = await ethers.getContractAt("LokDrawManager", raw.addresses.drawManager, keeper);
  const vault = await ethers.getContractAt("LokVault", raw.addresses.vault, keeper);

  const keeperOptions = resolveKeeperOptions(process.env, process.argv);
  if (keeperOptions.open) {
    const state = Number(await draw.getFunction("state").staticCall()) as DrawState;
    if (state !== DrawState.IDLE && state !== DrawState.SETTLED)
      throw new Error("--open requires an idle draw machine");
    await waitForWrite(draw, "openDraw", [keeperOptions.strict]);
  }
  const result = await runCrankCycle(await liveRuntime(draw, vault), {
    maxSteps: 256,
    maxDecryptRetries: 5,
    baseBackoffMs: 2_000,
  });
  console.log(JSON.stringify({ ...result, until: result.until?.toString() ?? null }));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
