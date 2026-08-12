import { expect } from "chai";
import { ContractTransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import { batchCapAtSixtyPercent, percentile, projectDrawTransactions } from "../../scripts/bench-hcu";

describe("HCUProbe", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("exposes every production operation sequence with measurable HCU", async function () {
    const [caller] = await ethers.getSigners();
    const probe = await (await ethers.getContractFactory("HCUProbe", caller)).deploy();
    await probe.waitForDeployment();

    const paths = [
      "measureSyncUser",
      "measureCrankA",
      "measureCrankB",
      "measureRandomness",
      "measureFortune",
      "measureSolvency",
    ] as const;

    for (const path of paths) {
      const tx = await probe.getFunction(path)(1n);
      const receipt = (await tx.wait()) as ContractTransactionReceipt;
      const hcu = fhevm.computeTransactionHCU(receipt);
      expect(hcu.globalHCU, path).to.be.greaterThan(0);
      expect(hcu.maxHCUDepth, path).to.be.greaterThan(0);
    }
  });

  it("rejects empty and over-limit probe batches", async function () {
    const probe = await (await ethers.getContractFactory("HCUProbe")).deploy();
    await probe.waitForDeployment();

    await expect(probe.getFunction("measureCrankA")(0n)).to.be.revertedWithCustomError(probe, "InvalidIterations");
    await expect(probe.getFunction("measureCrankA")(201n)).to.be.revertedWithCustomError(probe, "InvalidIterations");
  });
});

describe("HCU benchmark calculations", function () {
  it("takes the exact floor of sixty percent of a measured boundary", function () {
    expect(batchCapAtSixtyPercent(10)).to.equal(6);
    expect(batchCapAtSixtyPercent(4)).to.equal(2);
    expect(batchCapAtSixtyPercent(1)).to.equal(0);
  });

  it("projects pre-sync and both sweep transaction counts", function () {
    expect(projectDrawTransactions(10, { preSync: 3, crankA: 4, crankB: 6 })).to.deep.equal({
      preSync: 4,
      passA: 3,
      passB: 2,
      variable: 9,
    });
  });

  it("refuses projections when a sixty-percent cap is unusable", function () {
    expect(() => projectDrawTransactions(10, { preSync: 1, crankA: 0, crankB: 1 })).to.throw(
      "Batch caps must all be positive",
    );
  });

  it("uses nearest-rank percentiles for observed decryption latency", function () {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(samples, 0.5)).to.equal(50);
    expect(percentile(samples, 0.95)).to.equal(100);
  });
});
