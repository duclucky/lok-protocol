import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BaseContract, Result } from "ethers";
import { fhevm } from "hardhat";

import {
  assertSyncEquivalent,
  deterministicSyncVectors,
  evaluateSyncVector,
  type SyncVector,
} from "../reference/sync-reference";
import {
  authorizeVault,
  debugDecrypt,
  deployVaultFixture,
  deposit,
  encrypt8,
  encrypt64,
  mintToken,
  read,
  write,
} from "../unit/helpers";

async function at(timestamp: bigint, action: () => Promise<void>): Promise<void> {
  await time.setNextBlockTimestamp(timestamp);
  await action();
}

async function runProductionVector(template: SyncVector): Promise<void> {
  const fixture = await deployVaultFixture();
  const latest = BigInt(await time.latest());
  const tStart = latest + 20n;
  const offset = tStart - template.tStart;
  const vector: SyncVector = {
    ...template,
    tStart,
    tEnd: template.tEnd + offset,
    mutations: template.mutations.map((mutation) => ({ ...mutation, at: mutation.at + offset })),
    finalSyncAt: template.finalSyncAt + offset,
  };
  const deposits = vector.mutations.reduce(
    (sum, mutation) => sum + (mutation.kind === "deposit" ? mutation.amount : 0n),
    vector.initialBalance,
  );
  await mintToken(fixture.token, fixture.owner, fixture.alice.address, deposits);
  await authorizeVault(fixture, fixture.alice);

  if (vector.initialTheta !== 4n) {
    const encryptedTheta = await encrypt8(fixture.vault, fixture.alice, vector.initialTheta);
    await at(tStart - 2n, () =>
      write(fixture.vault.connect(fixture.alice) as BaseContract, "setTheta", [
        encryptedTheta.handles[0],
        encryptedTheta.inputProof,
      ]),
    );
  }
  if (vector.initialBalance > 0n) {
    await at(tStart - 1n, () => deposit(fixture, fixture.alice, vector.initialBalance));
  }
  await at(tStart, () => write(fixture.vault, "onDrawOpened", [1n, tStart, vector.tEnd]));

  for (const mutation of vector.mutations) {
    if (mutation.kind === "deposit") {
      await at(mutation.at, () => deposit(fixture, fixture.alice, mutation.amount));
    } else if (mutation.kind === "withdraw") {
      const encrypted = await encrypt64(fixture.vault, fixture.alice, mutation.amount);
      await at(mutation.at, () =>
        write(fixture.vault.connect(fixture.alice) as BaseContract, "withdraw", [
          encrypted.handles[0],
          encrypted.inputProof,
        ]),
      );
    } else {
      const encrypted = await encrypt8(fixture.vault, fixture.alice, mutation.theta);
      await at(mutation.at, () =>
        write(fixture.vault.connect(fixture.alice) as BaseContract, "setTheta", [
          encrypted.handles[0],
          encrypted.inputProof,
        ]),
      );
    }
  }
  await at(vector.finalSyncAt, () => write(fixture.vault, "preSync", [[fixture.alice.address]]));
  const encryptedWeights = (await read(fixture.vault, "drawWeightsFor", [fixture.alice.address])) as Result;
  const actual = {
    ticketDelta: await debugDecrypt(FhevmType.euint128, encryptedWeights[0] as bigint),
    yieldDelta: await debugDecrypt(FhevmType.euint128, encryptedWeights[1] as bigint),
  };
  const expected = evaluateSyncVector(vector);
  assertSyncEquivalent(vector.seed, actual, {
    ticketDelta: expected.ticketDelta,
    yieldDelta: expected.yieldDelta,
  });
}

describe("LokVault _syncUser differential reference", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("freezes the exact piecewise integral at tEnd", function () {
    const vector: SyncVector = {
      seed: "sync-boundary",
      tStart: 1_000n,
      tEnd: 1_100n,
      initialBalance: 10n,
      initialTheta: 4n,
      mutations: [
        { at: 1_025n, kind: "deposit", amount: 10n },
        { at: 1_050n, kind: "setTheta", theta: 2n },
        { at: 1_075n, kind: "withdraw", amount: 5n },
        { at: 1_101n, kind: "deposit", amount: 999n },
      ],
      finalSyncAt: 1_102n,
    };

    expect(evaluateSyncVector(vector)).to.deep.equal({
      ticketDelta: 4_750n,
      yieldDelta: 1_625n,
      finalBalance: 1_014n,
      finalTheta: 2n,
    });
  });

  it("generates replayable vectors with valid ordered boundaries", function () {
    const first = deterministicSyncVectors("lok-task11-sync", 32);
    const replay = deterministicSyncVectors("lok-task11-sync", 32);

    expect(first).to.deep.equal(replay);
    expect(first).to.have.length(32);
    for (const vector of first) {
      expect(vector.finalSyncAt).to.be.greaterThanOrEqual(vector.tEnd);
      expect(vector.mutations.map((mutation) => mutation.at)).to.deep.equal(
        [...vector.mutations].map((mutation) => mutation.at).sort((a, b) => (a < b ? -1 : 1)),
      );
    }
  });

  it("matches decrypted production outputs for every deterministic vector", async function () {
    this.timeout(180_000);
    for (const vector of deterministicSyncVectors("lok-task11-sync-production", 8)) {
      await runProductionVector(vector);
    }
  });
});
