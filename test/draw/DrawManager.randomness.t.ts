import { expect } from "chai";
import { Result, solidityPackedKeccak256 } from "ethers";
import { fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { NON_DUST_DEPOSIT, asHandle, deployDrawFixture, mintAndDeposit, read, write } from "./helpers";

type DrawInfo = Result & {
  tEnd: bigint;
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
  r: bigint;
};

const ENTROPY_A = `0x${"11".repeat(32)}`;
const SALT_A = `0x${"22".repeat(32)}`;
const ENTROPY_B = `0x${"33".repeat(32)}`;
const SALT_B = `0x${"44".repeat(32)}`;

function commitment(entropy: string, salt: string): string {
  return solidityPackedKeccak256(["bytes32", "bytes32"], [entropy, salt]);
}

async function reachTotalsSubmitted(strict: boolean) {
  const fixture = await deployDrawFixture();
  for (const user of fixture.users.slice(0, 5)) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
  await write(fixture.draw, "openDraw", [strict]);

  if (strict) {
    await write(fixture.draw.connect(fixture.alice), "commitEntropy", [commitment(ENTROPY_A, SALT_A)]);
    await write(fixture.draw.connect(fixture.bob), "commitEntropy", [commitment(ENTROPY_B, SALT_B)]);
  }

  const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const settleDelay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
  await time.increaseTo(opened.tEnd + settleDelay);
  await write(fixture.draw, "preSyncA", [4n]);
  await write(fixture.draw, "preSyncA", [1n]);
  await write(fixture.draw, "crankA", [3n]);
  await write(fixture.draw, "crankA", [2n]);

  const swept = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const handles = [asHandle(swept.cumRunning), asHandle(swept.cumBaseRiskRunning), asHandle(swept.cumYieldRunning)];
  const decrypted = await fhevm.publicDecrypt(handles);
  await write(fixture.draw, "submitTotals", [decrypted.abiEncodedClearValues, decrypted.decryptionProof]);
  return fixture;
}

describe("LokDrawManager randomness sequencing", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("allows conditional sequential reveals but creates no random handle before the reveal deadline", async function () {
    const fixture = await reachTotalsSubmitted(true);
    await write(fixture.draw, "enterReveal");

    await write(fixture.draw.connect(fixture.alice), "revealEntropy", [ENTROPY_A, SALT_A]);
    expect(await read(fixture.draw, "revealAcc")).to.equal(ENTROPY_A);

    await write(fixture.draw.connect(fixture.bob), "revealEntropy", [ENTROPY_B, SALT_B]);
    const expectedAcc = `0x${(BigInt(ENTROPY_A) ^ BigInt(ENTROPY_B)).toString(16).padStart(64, "0")}`;
    expect(await read(fixture.draw, "revealAcc")).to.equal(expectedAcc);
    expect(((await read(fixture.draw, "drawInfo", [1n])) as DrawInfo).r).to.equal(0n);
    await expect(fixture.draw.getFunction("openRandom")()).to.be.revertedWithCustomError(
      fixture.draw,
      "RevealWindowActive",
    );

    const deadline = (await read(fixture.draw, "revealDeadline")) as bigint;
    await time.increaseTo(deadline);
    await expect(fixture.draw.getFunction("revealEntropy")(ENTROPY_A, SALT_A)).to.be.reverted;
    await expect(fixture.draw.getFunction("openRandom")()).to.emit(fixture.draw, "RandomnessCommitted");
    expect(await read(fixture.draw, "revealAcc")).to.equal(expectedAcc);
    expect(await read(fixture.draw, "state")).to.equal(6n);
    expect(((await read(fixture.draw, "drawInfo", [1n])) as DrawInfo).r).to.not.equal(0n);
  });

  it("rejects an invalid or duplicate strict reveal", async function () {
    const fixture = await reachTotalsSubmitted(true);
    await write(fixture.draw, "enterReveal");

    await expect(
      fixture.draw.connect(fixture.alice).getFunction("revealEntropy")(ENTROPY_B, SALT_A),
    ).to.be.revertedWithCustomError(fixture.draw, "CommitmentMismatch");
    await write(fixture.draw.connect(fixture.alice), "revealEntropy", [ENTROPY_A, SALT_A]);
    await expect(
      fixture.draw.connect(fixture.alice).getFunction("revealEntropy")(ENTROPY_A, SALT_A),
    ).to.be.revertedWithCustomError(fixture.draw, "AlreadyRevealed");
  });

  it("opens non-strict randomness without exposing a reveal path", async function () {
    const fixture = await reachTotalsSubmitted(false);
    await expect(fixture.draw.getFunction("enterReveal")()).to.be.revertedWithCustomError(fixture.draw, "InvalidState");
    await write(fixture.draw, "openRandom");
    expect(await read(fixture.draw, "state")).to.equal(6n);
  });
});
