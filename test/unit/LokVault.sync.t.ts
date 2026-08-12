import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { BaseContract, Result } from "ethers";
import { fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

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
} from "./helpers";

async function at(timestamp: bigint, action: () => Promise<void>): Promise<void> {
  await time.setNextBlockTimestamp(timestamp);
  await action();
}

async function openDraw(vault: BaseContract, id: bigint, start: bigint, end: bigint): Promise<void> {
  const latest = BigInt(await time.latest());
  const activation = latest < start ? start : latest + 1n;
  await at(activation, () => write(vault, "onDrawOpened", [id, start, end]));
}

async function syncAt(vault: BaseContract, user: string, timestamp: bigint): Promise<void> {
  await at(timestamp, () => write(vault, "preSync", [[user]]));
}

async function weights(vault: BaseContract, user: string): Promise<[bigint, bigint]> {
  const result = (await read(vault, "drawWeightsFor", [user])) as Result;
  return [
    await debugDecrypt(FhevmType.euint128, result[0] as bigint),
    await debugDecrypt(FhevmType.euint128, result[1] as bigint),
  ];
}

async function seededPosition(balance: bigint) {
  const fixture = await deployVaultFixture();
  await mintToken(fixture.token, fixture.owner, fixture.alice.address, balance * 4n);
  await authorizeVault(fixture, fixture.alice);
  const start = BigInt(await time.latest()) + 10n;
  await at(start, () => deposit(fixture, fixture.alice, balance));
  return { fixture, start };
}

describe("LokVault eTWAB", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("test_TWAB_ConstantBalance_LinearAccumulation", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });

  it("excludes pre-draw IDLE time from the draw weight", async function () {
    const { fixture, start: depositTime } = await seededPosition(10n);
    const drawStart = depositTime + 50n;
    const drawEnd = drawStart + 100n;
    await openDraw(fixture.vault, 1n, drawStart, drawEnd);
    await syncAt(fixture.vault, fixture.alice.address, drawEnd);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });

  it("test_TWAB_LateDeposit_ProportionallyWeighted", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 20n);
    await authorizeVault(fixture, fixture.alice);
    const start = BigInt(await time.latest()) + 10n;
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await at(start + 50n, () => deposit(fixture, fixture.alice, 20n));
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });

  it("test_TWAB_LastSecondDeposit_NearZeroWeight", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 100n);
    await authorizeVault(fixture, fixture.alice);
    const start = BigInt(await time.latest()) + 10n;
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await at(start + 99n, () => deposit(fixture, fixture.alice, 100n));
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([400n, 100n]);
  });

  it("test_TWAB_MultipleChangesWithinWindow", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await at(start + 25n, () => deposit(fixture, fixture.alice, 10n));
    const request = await encrypt64(fixture.vault, fixture.alice, 5n);
    await at(start + 60n, () =>
      write(fixture.vault.connect(fixture.alice) as BaseContract, "withdraw", [request.handles[0], request.inputProof]),
    );
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([6200n, 1550n]);
  });

  it("test_TWAB_ThetaChangeMidWindow_SplitsSegment", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    const theta = await encrypt8(fixture.vault, fixture.alice, 2n);
    await at(start + 50n, () =>
      write(fixture.vault.connect(fixture.alice) as BaseContract, "setTheta", [theta.handles[0], theta.inputProof]),
    );
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([3000n, 1000n]);
  });

  it("test_TWAB_CheckpointTakenOnFirstTouchAfterTEnd", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await syncAt(fixture.vault, fixture.alice.address, start + 120n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });

  it("test_TWAB_UntouchedUser_CheckpointTakenInSweep", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });

  it("test_TWAB_WithdrawToZeroMidWindow", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await at(start + 50n, () => write(fixture.vault.connect(fixture.alice) as BaseContract, "withdrawAll"));
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([2000n, 500n]);
  });

  it("test_TWAB_ConsecutiveDraws_NoDoubleCount", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    await write(fixture.vault, "rollCheckpoint", [fixture.alice.address]);
    await write(fixture.vault, "onDrawClosed", [1n]);
    await openDraw(fixture.vault, 2n, start + 100n, start + 200n);
    await syncAt(fixture.vault, fixture.alice.address, start + 200n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });

  it("test_TWAB_SkippedDraw_NoInflation", async function () {
    const { fixture, start } = await seededPosition(10n);
    await openDraw(fixture.vault, 1n, start, start + 100n);
    await syncAt(fixture.vault, fixture.alice.address, start + 100n);
    await write(fixture.vault, "rollCheckpoint", [fixture.alice.address]);
    await write(fixture.vault, "onDrawClosed", [1n]);
    await openDraw(fixture.vault, 2n, start + 100n, start + 200n);
    await syncAt(fixture.vault, fixture.alice.address, start + 200n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });

  it("freezes the fairness snapshot at tEnd across tEnd-1, tEnd, and tEnd+1", async function () {
    const { fixture, start } = await seededPosition(10n);
    const end = start + 100n;
    await openDraw(fixture.vault, 1n, start, end);
    await syncAt(fixture.vault, fixture.alice.address, end - 1n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([0n, 0n]);
    await syncAt(fixture.vault, fixture.alice.address, end);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
    await syncAt(fixture.vault, fixture.alice.address, end + 1n);
    expect(await weights(fixture.vault, fixture.alice.address)).to.deep.equal([4000n, 1000n]);
  });
});
