import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { deployDrawFixture, read, TEST_DRAW_TIMING, TEST_DRAW_TIMING_ARGS, write } from "./helpers";

describe("LokDrawManager state machine", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("accepts the reviewed profile and rejects every unsafe timing boundary", async function () {
    const fixture = await deployDrawFixture();
    const factory = await ethers.getContractFactory("LokDrawManager");
    const vault = await fixture.vault.getAddress();
    const owner = fixture.owner.address;
    const valid = TEST_DRAW_TIMING_ARGS;

    await expect(factory.deploy(vault, owner, 59n, valid[1], valid[2], valid[3])).to.be.revertedWithCustomError(
      factory,
      "InvalidTiming",
    );
    await expect(
      factory.deploy(vault, owner, 2n ** 20n + 1n, valid[1], valid[2], valid[3]),
    ).to.be.revertedWithCustomError(factory, "InvalidTiming");
    await expect(factory.deploy(vault, owner, valid[0], 23n, valid[2], valid[3])).to.be.revertedWithCustomError(
      factory,
      "InvalidTiming",
    );
    await expect(factory.deploy(vault, owner, valid[0], valid[1], 119n, valid[3])).to.be.revertedWithCustomError(
      factory,
      "InvalidTiming",
    );
    await expect(factory.deploy(vault, owner, valid[0], valid[1], valid[2], 299n)).to.be.revertedWithCustomError(
      factory,
      "InvalidTiming",
    );

    const lowerBounds = await factory.deploy(vault, owner, 60n, 24n, 120n, 300n);
    await lowerBounds.waitForDeployment();
    expect(await lowerBounds.getFunction("DRAW_PERIOD").staticCall()).to.equal(60n);

    expect(await read(fixture.draw, "DRAW_PERIOD")).to.equal(TEST_DRAW_TIMING.drawPeriod);
    expect(await read(fixture.draw, "MIN_SETTLE_DELAY")).to.equal(TEST_DRAW_TIMING.minSettleDelay);
    expect(await read(fixture.draw, "REVEAL_WINDOW")).to.equal(TEST_DRAW_TIMING.revealWindow);
    expect(await read(fixture.draw, "STATE_TIMEOUT")).to.equal(TEST_DRAW_TIMING.stateTimeout);
  });

  it("opens only from an authorized risk epoch and records an immutable window", async function () {
    const unauthorized = await deployDrawFixture(false);
    await expect(unauthorized.draw.getFunction("openDraw")(false)).to.be.reverted;

    const fixture = await deployDrawFixture();
    await write(fixture.draw, "openDraw", [true]);
    const info = (await read(fixture.draw, "drawInfo", [1n])) as { tStart: bigint; tEnd: bigint; strict: boolean };
    expect(await read(fixture.draw, "state")).to.equal(1n);
    expect(info.strict).to.equal(true);
    expect(info.tEnd - info.tStart).to.equal(TEST_DRAW_TIMING.drawPeriod);
    expect(await read(fixture.draw, "stateDeadline")).to.equal(
      info.tEnd + TEST_DRAW_TIMING.minSettleDelay + TEST_DRAW_TIMING.stateTimeout,
    );
  });

  it("pause blocks new draws but never mutates a draw already in progress", async function () {
    const fixture = await deployDrawFixture();
    await write(fixture.draw, "pauseDraws");
    await expect(fixture.draw.getFunction("openDraw")(false)).to.be.reverted;
    await write(fixture.draw, "unpauseDraws");
    await write(fixture.draw, "openDraw", [false]);
    await write(fixture.draw, "pauseDraws");
    expect(await read(fixture.draw, "state")).to.equal(1n);
  });

  it("rejects early abort and clears every draw-local field after the deadline", async function () {
    const fixture = await deployDrawFixture();
    await write(fixture.draw, "openDraw", [true]);
    await expect(fixture.draw.getFunction("abortDraw")()).to.be.reverted;

    const deadline = (await read(fixture.draw, "stateDeadline")) as bigint;
    await time.increaseTo(deadline);
    await write(fixture.draw, "abortDraw");

    expect(await read(fixture.draw, "state")).to.equal(0n);
    expect(await read(fixture.draw, "cursor")).to.equal(0n);
    expect(await read(fixture.draw, "revealDeadline")).to.equal(0n);
    expect(await read(fixture.draw, "remainingInSweep")).to.equal(0n);
    const info = (await read(fixture.draw, "drawInfo", [1n])) as { settled: boolean; aborted: boolean };
    expect(info.aborted).to.equal(true);
    expect(info.settled).to.equal(false);
  });
});
