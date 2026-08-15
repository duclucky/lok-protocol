import type { Hex } from "viem";

import type { LokPublicSnapshot } from "../public-data/model";
import { ZERO_BYTES32 } from "../public-data/model";

const PRE_SYNC_CAP = 4n;
const BATCH_A_CAP = 3n;
const BATCH_B_CAP = 2n;

export type KeeperExecutableAction =
  | Readonly<{ kind: "openDraw"; strict: boolean }>
  | Readonly<{ kind: "preSyncA"; batch: bigint }>
  | Readonly<{ kind: "crankA"; batch: bigint }>
  | Readonly<{ kind: "submitTotals"; handles: readonly [Hex, Hex, Hex] }>
  | Readonly<{ kind: "openRandom" }>
  | Readonly<{ kind: "crankB"; batch: bigint }>;

export type KeeperDecision = Readonly<{
  label: string;
  detail: string;
  action?: KeeperExecutableAction;
  disabledReason?: string;
}>;

function batch(remaining: bigint, cap: bigint): bigint {
  if (remaining <= 0n) return 1n;
  return remaining < cap ? remaining : cap;
}

function isReadyHandle(handle: Hex): boolean {
  return handle !== ZERO_BYTES32;
}

export function keeperDecision(snapshot: LokPublicSnapshot, nowMs = Date.now()): KeeperDecision {
  const draw = snapshot.draw;
  if (draw === undefined) {
    return {
      label: "Open demo draw",
      detail: "Start the first non-strict Sepolia draw for this deployment.",
      action: { kind: "openDraw", strict: false },
    };
  }

  switch (draw.state) {
    case "IDLE":
    case "SETTLED":
      return {
        label: "Open next draw",
        detail: "Start a new non-strict draw. This does not choose a winner.",
        action: { kind: "openDraw", strict: false },
      };
    case "OPEN":
    case "SWEEP_A": {
      const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
      if (nowSeconds < draw.tEnd) {
        return {
          label: "Waiting for draw close",
          detail: "PASS A is enabled only after the draw end timestamp.",
          disabledReason: "Draw window is still open.",
        };
      }
      if (draw.preSyncCursor < draw.participantSnapshot) {
        const nextBatch = batch(draw.participantSnapshot - draw.preSyncCursor, PRE_SYNC_CAP);
        return {
          label: `Pre-sync ${nextBatch.toString()}`,
          detail: "Refresh encrypted user accounting before PASS A consumes the snapshot.",
          action: { kind: "preSyncA", batch: nextBatch },
        };
      }
      const nextBatch = draw.participantSnapshot === 0n ? 1n : batch(draw.participantSnapshot - draw.cursor, BATCH_A_CAP);
      return {
        label: `Crank PASS A ${nextBatch.toString()}`,
        detail: "Build encrypted aggregate weights in a bounded batch.",
        action: { kind: "crankA", batch: nextBatch },
      };
    }
    case "AWAIT_TOTAL": {
      const handles = [draw.cumRunning, draw.cumBaseRiskRunning, draw.cumYieldRunning] as const;
      if (!handles.every(isReadyHandle)) {
        return {
          label: "Await aggregate handles",
          detail: "The three public-decryptable aggregate handles are not all available yet.",
          disabledReason: "Aggregate handles are missing.",
        };
      }
      return {
        label: "Decrypt totals and submit",
        detail: "Request public decryption for aggregate draw totals, then submit the signed proof onchain.",
        action: { kind: "submitTotals", handles },
      };
    }
    case "REVEAL": {
      const nowSeconds = BigInt(Math.floor(nowMs / 1_000));
      if (nowSeconds < draw.revealDeadline) {
        return {
          label: "Waiting for reveal close",
          detail: "Strict-mode randomness is enabled only after the reveal window closes.",
          disabledReason: "Reveal window is still open.",
        };
      }
      return {
        label: "Generate randomness",
        detail: "Close the reveal window and request encrypted FHE randomness.",
        action: { kind: "openRandom" },
      };
    }
    case "RANDOM_SET":
      return {
        label: "Enter PASS B",
        detail: "Move from fixed randomness into encrypted winner assignment.",
        action: { kind: "openRandom" },
      };
    case "SWEEP_B": {
      const nextBatch = batch(draw.participantSnapshot - draw.cursor, BATCH_B_CAP);
      return {
        label: `Crank PASS B ${nextBatch.toString()}`,
        detail: "Assign encrypted prize credits in a bounded batch.",
        action: { kind: "crankB", batch: nextBatch },
      };
    }
  }
}
