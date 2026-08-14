import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { BaseContract, ContractTransactionReceipt, Result } from "ethers";
import { fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { NON_DUST_DEPOSIT, asHandle, deployDrawFixture, mintAndDeposit, read, write } from "./helpers";

type DrawInfo = Result & {
  tEnd: bigint;
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
  cumPrizeCredits: bigint;
  prizeAmount: bigint;
  totalTickets: bigint;
  r: bigint;
  settled: boolean;
};

async function reachSweepB(yieldAmount = 1_000n) {
  const fixture = await deployDrawFixture();
  for (const user of fixture.users.slice(0, 5)) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
  await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), yieldAmount]);
  await write(fixture.draw, "openDraw", [false]);
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
  await write(fixture.draw, "openRandom");
  return fixture;
}

async function decryptPrizeCredit(
  draw: BaseContract,
  drawId: bigint,
  user: Awaited<ReturnType<typeof reachSweepB>>["alice"],
) {
  const handle = (await read(draw, "prizeCredit", [drawId, user.address])) as bigint;
  return fhevm.userDecryptEuint(FhevmType.euint64, asHandle(handle), await draw.getAddress(), user);
}

async function decryptFortune(vault: BaseContract, user: Awaited<ReturnType<typeof reachSweepB>>["alice"]) {
  const handle = (await read(vault, "fortuneOf", [user.address])) as bigint;
  return fhevm.userDecryptEuint(FhevmType.euint16, asHandle(handle), await vault.getAddress(), user);
}

describe("LokDrawManager PASS B", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("credits exactly one half-open interval winner and updates Fortune uniformly", async function () {
    const fixture = await reachSweepB();
    const receipts: ContractTransactionReceipt[] = [];
    for (const batch of [2n, 2n, 1n]) {
      const tx = await fixture.draw.getFunction("crankB")(batch);
      const receipt = await tx.wait();
      if (receipt !== null) receipts.push(receipt);
    }

    const info = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    const credits: bigint[] = [];
    for (const user of fixture.users.slice(0, 5)) {
      credits.push(await decryptPrizeCredit(fixture.draw, 1n, user));
    }
    expect(credits.filter((credit) => credit !== 0n)).to.deep.equal([info.prizeAmount]);

    const fortunes: bigint[] = [];
    for (const user of fixture.users.slice(0, 5)) {
      fortunes.push(await decryptFortune(fixture.vault, user));
    }
    expect(fortunes.filter((fortune) => fortune === 0n)).to.have.length(1);
    expect(fortunes.filter((fortune) => fortune === 1n)).to.have.length(4);

    const creditedEvents = receipts.flatMap((receipt) =>
      receipt.logs.filter((log) => {
        try {
          return fixture.draw.interface.parseLog(log)?.name === "PrizeCredited";
        } catch {
          return false;
        }
      }),
    );
    expect(creditedEvents).to.have.length(5);
    expect(info.settled).to.equal(true);
    expect(await read(fixture.draw, "state")).to.equal(7n);
  });

  it("publishes only the aggregate prize sum and the post-settlement random value", async function () {
    const fixture = await reachSweepB();
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [1n]);

    const info = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
    const handles = [asHandle(info.cumPrizeCredits), asHandle(info.r)];
    const decrypted = await fhevm.publicDecrypt(handles);
    expect(decrypted.clearValues[handles[0]]).to.equal(info.prizeAmount);
    expect(decrypted.clearValues[handles[1]] as bigint).to.be.lessThan(info.totalTickets);
  });

  it("rejects zero and oversized batches without moving the PASS B cursor", async function () {
    const fixture = await reachSweepB();
    await expect(fixture.draw.getFunction("crankB")(0n)).to.be.revertedWithCustomError(fixture.draw, "BatchOutOfRange");
    await expect(fixture.draw.getFunction("crankB")(3n)).to.be.revertedWithCustomError(fixture.draw, "BatchOutOfRange");
    expect(await read(fixture.draw, "cursor")).to.equal(0n);
  });

  it("rejects timeout abort after the first funded credit and requires permissionless completion", async function () {
    const fixture = await reachSweepB();
    await write(fixture.draw, "crankB", [1n]);
    const deadline = (await read(fixture.draw, "stateDeadline")) as bigint;
    await time.increaseTo(deadline);

    await expect(fixture.draw.getFunction("abortDraw")()).to.be.revertedWithCustomError(
      fixture.draw,
      "SettlementInProgress",
    );
    expect(await read(fixture.draw, "cursor")).to.equal(1n);

    await write(fixture.draw, "crankB", [2n]);
    await write(fixture.draw, "crankB", [2n]);
    expect(await read(fixture.draw, "state")).to.equal(7n);
  });
});
