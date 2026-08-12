import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { TEST_DRAW_TIMING_ARGS } from "./draw/helpers";

describe("Lok Stage 2 skeleton", function () {
  beforeEach(function () {
    if (!fhevm.isMock) {
      this.skip();
    }
  });

  it("deploys the vault, draw manager, and demo adapter with the frozen state-machine ABI", async function () {
    const [deployer] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const underlying = await MockUSDC.deploy();
    const YieldInjectingERC7984 = await ethers.getContractFactory("YieldInjectingERC7984");
    const cToken = await YieldInjectingERC7984.deploy(await underlying.getAddress());

    const MockYieldAdapter = await ethers.getContractFactory("MockYieldAdapter");
    const adapter = await MockYieldAdapter.deploy(await cToken.getAddress(), deployer.address);

    const LokVault = await ethers.getContractFactory("LokVault");
    const vault = await LokVault.deploy(await cToken.getAddress(), await adapter.getAddress(), deployer.address);
    await adapter.getFunction("setVault")(await vault.getAddress());

    const LokDrawManager = await ethers.getContractFactory("LokDrawManager");
    const draw = await LokDrawManager.deploy(await vault.getAddress(), deployer.address, ...TEST_DRAW_TIMING_ARGS);

    await vault.getFunction("setDrawManager")(await draw.getAddress());

    expect(await draw.getFunction("state").staticCall()).to.equal(0);
    expect(await vault.getFunction("drawManager").staticCall()).to.equal(await draw.getAddress());

    for (const name of [
      "deposit",
      "withdraw",
      "withdrawAll",
      "exit",
      "emergencyWithdraw",
      "setTheta",
      "preSync",
      "setDrawManager",
    ]) {
      expect(vault.interface.hasFunction(name), name).to.equal(true);
    }

    for (const name of [
      "openDraw",
      "commitEntropy",
      "revealEntropy",
      "enterReveal",
      "crankA",
      "submitTotals",
      "openRandom",
      "crankB",
      "abortDraw",
      "pauseDraws",
      "unpauseDraws",
    ]) {
      expect(draw.interface.hasFunction(name), name).to.equal(true);
    }
  });
});
