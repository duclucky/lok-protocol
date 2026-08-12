import { expect } from "chai";

import {
  DrawState,
  StaleStateError,
  decideCrankAction,
  normalizeHandle,
  resolveKeeperOptions,
  runCrankCycle,
  type CrankRuntime,
  type CrankSnapshot,
} from "../../scripts/crank";

const base: CrankSnapshot = {
  state: DrawState.OPEN,
  now: 1_000n,
  drawId: 7n,
  tEnd: 900n,
  minSettleDelay: 100n,
  revealDeadline: 0n,
  stateDeadline: 2_000n,
  participantSnapshot: 10n,
  preSyncCursor: 0n,
  cursor: 0n,
  strict: false,
  totalsSubmitted: false,
  totalTickets: 0n,
  aggregateHandles: [`0x${"11".repeat(32)}`, `0x${"22".repeat(32)}`, `0x${"33".repeat(32)}`],
};

describe("permissionless draw keeper", function () {
  it("normalizes both mock bigint and live bytes32 encrypted handles", function () {
    expect(normalizeHandle(1n)).to.equal(`0x${"0".repeat(63)}1`);
    const live = `0x${"ab".repeat(32)}` as const;
    expect(normalizeHandle(live)).to.equal(live);
    expect(() => normalizeHandle("0x1234")).to.throw("Invalid encrypted handle");
  });

  it("accepts Hardhat-compatible environment options", function () {
    expect(resolveKeeperOptions({ LOK_OPEN_DRAW: "1", LOK_STRICT_DRAW: "true" })).to.deep.equal({
      open: true,
      strict: true,
    });
    expect(() => resolveKeeperOptions({ LOK_OPEN_DRAW: "yes" })).to.throw("LOK_OPEN_DRAW");
  });

  it("dispatches every draw state with frozen batch caps and strict timing", function () {
    expect(decideCrankAction({ ...base, now: 899n })).to.deep.equal({ kind: "wait", until: 900n });
    expect(decideCrankAction(base)).to.deep.equal({ kind: "preSyncA", batch: 4n });
    expect(decideCrankAction({ ...base, preSyncCursor: 10n, now: 999n })).to.deep.equal({
      kind: "wait",
      until: 1_000n,
    });
    expect(decideCrankAction({ ...base, preSyncCursor: 10n, cursor: 4n, state: DrawState.SWEEP_A })).to.deep.equal({
      kind: "crankA",
      batch: 3n,
    });
    expect(decideCrankAction({ ...base, state: DrawState.AWAIT_TOTAL })).to.deep.equal({ kind: "submitTotals" });
    expect(
      decideCrankAction({
        ...base,
        state: DrawState.AWAIT_TOTAL,
        strict: true,
        totalsSubmitted: true,
        totalTickets: 10n,
      }),
    ).to.deep.equal({ kind: "enterReveal" });
    expect(decideCrankAction({ ...base, state: DrawState.REVEAL, now: 1_999n, revealDeadline: 2_000n })).to.deep.equal({
      kind: "wait",
      until: 2_000n,
    });
    expect(decideCrankAction({ ...base, state: DrawState.REVEAL, now: 2_000n, revealDeadline: 2_000n })).to.deep.equal({
      kind: "openRandom",
    });
    expect(decideCrankAction({ ...base, state: DrawState.RANDOM_SET })).to.deep.equal({ kind: "openRandom" });
    expect(decideCrankAction({ ...base, state: DrawState.SWEEP_B, cursor: 9n })).to.deep.equal({
      kind: "crankB",
      batch: 1n,
    });
    expect(decideCrankAction({ ...base, state: DrawState.IDLE })).to.deep.equal({ kind: "done" });
    expect(decideCrankAction({ ...base, state: DrawState.SETTLED })).to.deep.equal({ kind: "done" });
  });

  it("refreshes state after a stale transaction instead of replaying old cursor parameters", async function () {
    let reads = 0;
    let sends = 0;
    const runtime: CrankRuntime = {
      readSnapshot: async () => ({ ...base, state: reads++ === 0 ? DrawState.SWEEP_A : DrawState.SETTLED }),
      send: async () => {
        ++sends;
        throw new StaleStateError("another keeper advanced the cursor");
      },
      decryptTotals: async () => ({ abiEncodedClearValues: "0x", decryptionProof: "0x" }),
      sleep: async () => undefined,
    };

    const result = await runCrankCycle(runtime, { maxSteps: 3, maxDecryptRetries: 2, baseBackoffMs: 10 });
    expect(result.status).to.equal("done");
    expect(sends).to.equal(1);
    expect(reads).to.equal(2);
  });

  it("backs off boundedly for public decryption and submits only an authenticated response", async function () {
    let decryptions = 0;
    const sleeps: number[] = [];
    const sent: string[] = [];
    const runtime: CrankRuntime = {
      readSnapshot: async () => ({ ...base, state: sent.length === 0 ? DrawState.AWAIT_TOTAL : DrawState.SETTLED }),
      send: async (action) => {
        sent.push(action.kind);
      },
      decryptTotals: async () => {
        if (++decryptions < 3) throw new Error("relayer unavailable");
        return { abiEncodedClearValues: "0x1234", decryptionProof: "0xabcd" };
      },
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    };

    const result = await runCrankCycle(runtime, { maxSteps: 3, maxDecryptRetries: 3, baseBackoffMs: 25 });
    expect(result.status).to.equal("done");
    expect(decryptions).to.equal(3);
    expect(sleeps).to.deep.equal([25, 50]);
    expect(sent).to.deep.equal(["submitTotals"]);
  });
});
