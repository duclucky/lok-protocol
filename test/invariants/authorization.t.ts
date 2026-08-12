import { expect } from "chai";
import { BaseContract } from "ethers";
import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  decrypt64,
  deployVaultFixture,
  deposit,
  mintToken,
  openAndDecryptCheckpoint,
  read,
  submitCheckpoint,
  write,
} from "../unit/helpers";
import { deployDrawFixture, mintAndDeposit } from "../draw/helpers";

describe("Lok authorization boundaries", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("omits the guardian when no independent threshold signer configuration exists", function () {
    expect(existsSync(path.join(process.cwd(), "contracts", "LokGuardian.sol"))).to.equal(false);
    expect(existsSync(path.join(process.cwd(), "test", "unit", "LokGuardian.t.ts"))).to.equal(false);
  });

  it("keeps owner, outsider, and adapter admin outside user accounting and decryption", async function () {
    const fixture = await deployVaultFixture("MockYieldAdapter", true);
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 10n);
    await deposit(fixture, fixture.alice, 10n);
    const aliceBalance = (await read(fixture.vault, "confidentialBalanceOf", [fixture.alice.address])) as bigint;

    await expect(decrypt64(fixture.vault, fixture.outsider, aliceBalance)).to.be.rejected;
    await expect(fixture.vault.connect(fixture.outsider).getFunction("setDrawManager")(fixture.outsider.address)).to.be
      .reverted;
    await expect(
      fixture.vault.connect(fixture.outsider).getFunction("proposeAdapter")(await fixture.adapter.getAddress()),
    ).to.be.reverted;
    await expect(
      fixture.vault.connect(fixture.owner).getFunction("creditDraw")(
        fixture.alice.address,
        ethers.ZeroHash,
        ethers.ZeroHash,
        ethers.ZeroHash,
      ),
    ).to.be.reverted;
    await expect(fixture.adapter.connect(fixture.owner).getFunction("withdrawAllToVault")()).to.be.reverted;

    await write(fixture.vault.connect(fixture.owner) as BaseContract, "emergencyWithdraw");
    const unchanged = (await read(fixture.vault, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.vault, fixture.alice, unchanged)).to.equal(10n);
  });

  it("enforces checkpoint, timelock, and IDLE gates without blocking principal recovery", async function () {
    const fixture = await deployDrawFixture();
    await mintAndDeposit(fixture, fixture.alice, 10n);
    const next = await (
      await ethers.getContractFactory("MockYieldAdapter")
    ).deploy(await fixture.token.getAddress(), fixture.owner.address);
    await next.waitForDeployment();
    await write(next, "setVault", [await fixture.vault.getAddress()]);

    await expect(fixture.vault.connect(fixture.alice).getFunction("proposeAdapter")(await next.getAddress())).to.be
      .reverted;
    await write(fixture.vault, "proposeAdapter", [await next.getAddress()]);
    await expect(fixture.vault.getFunction("activateAdapter")()).to.be.reverted;

    await write(fixture.draw, "openDraw", [false]);
    await write(fixture.draw, "pauseDraws");
    await time.increase((await read(fixture.vault, "ADAPTER_DELAY")) as bigint);
    await expect(fixture.vault.getFunction("activateAdapter")()).to.be.revertedWithCustomError(
      fixture.vault,
      "DrawNotIdle",
    );
    await write(fixture.vault.connect(fixture.alice) as BaseContract, "emergencyWithdraw");
    const returned = (await read(fixture.token, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.token, fixture.alice, returned)).to.equal(10n);
  });

  it("requires a fresh authorized risk epoch after each adapter transition", async function () {
    const fixture = await deployVaultFixture();
    const initial = await openAndDecryptCheckpoint(fixture.vault);
    await submitCheckpoint(fixture.vault, initial);
    const next = await (
      await ethers.getContractFactory("MockYieldAdapter")
    ).deploy(await fixture.token.getAddress(), fixture.owner.address);
    await next.waitForDeployment();
    await write(next, "setVault", [await fixture.vault.getAddress()]);
    await write(fixture.vault, "proposeAdapter", [await next.getAddress()]);
    await time.increase((await read(fixture.vault, "ADAPTER_DELAY")) as bigint);
    await write(fixture.vault, "activateAdapter");

    expect(await read(fixture.vault, "riskEpoch")).to.equal(2n);
    expect(await read(fixture.vault, "lastSolventRiskEpoch")).to.equal(1n);
    await expect(
      fixture.vault.getFunction("proposeAdapter")(await fixture.adapter.getAddress()),
    ).to.be.revertedWithCustomError(fixture.vault, "RiskEpochNotSolvent");
  });
});
