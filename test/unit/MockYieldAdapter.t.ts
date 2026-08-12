import { expect } from "chai";
import { BaseContract } from "ethers";
import { fhevm } from "hardhat";

import {
  decrypt64,
  deployVaultFixture,
  deposit,
  mintToken,
  openAndDecryptCheckpoint,
  read,
  submitCheckpoint,
  write,
} from "./helpers";

describe("MockYieldAdapter confidential custody", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("binds exactly one vault and exposes no privileged principal-transfer function", async function () {
    const { owner, outsider, adapter } = await deployVaultFixture();

    expect(await read(adapter, "vault")).to.not.equal(owner.address);
    await expect(adapter.connect(owner).getFunction("setVault")(outsider.address)).to.be.reverted;
    for (const forbidden of ["adminWithdraw", "sweep", "rescueTokens", "transferPrincipal"]) {
      expect(adapter.interface.hasFunction(forbidden), forbidden).to.equal(false);
    }
  });

  it("hands its current encrypted asset handle to the vault with transient ACL", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, await fixture.adapter.getAddress(), 25n);

    const checkpoint = await openAndDecryptCheckpoint(fixture.vault);
    expect(checkpoint.clearValue).to.equal(true);
    await submitCheckpoint(fixture.vault, checkpoint);
    expect(await read(fixture.vault, "lastSolventRiskEpoch")).to.equal(1n);
  });

  it("returns custody synchronously and vault accounting uses the amount actually moved", async function () {
    const fixture = await deployVaultFixture();
    const initial = await openAndDecryptCheckpoint(fixture.vault);
    await submitCheckpoint(fixture.vault, initial);

    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 9n);
    await deposit(fixture, fixture.alice, 7n);
    expect(
      await decrypt64(
        fixture.token,
        fixture.alice,
        (await read(fixture.token, "confidentialBalanceOf", [fixture.alice.address])) as bigint,
      ),
    ).to.equal(2n);

    await write(fixture.vault.connect(fixture.alice) as BaseContract, "emergencyWithdraw");
    const restored = (await read(fixture.token, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.token, fixture.alice, restored)).to.equal(9n);
  });

  it("accepts funded-yield notification only from the asset and harvests it exactly once", async function () {
    const fixture = await deployVaultFixture();

    await expect(fixture.adapter.connect(fixture.owner).getFunction("notifyYield")(13n)).to.be.reverted;
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 13n]);
    expect(await read(fixture.adapter, "fundedYieldInAdapter")).to.equal(13n);

    await write(fixture.vault, "harvestRealisedYield");
    expect(await read(fixture.adapter, "fundedYieldInAdapter")).to.equal(0n);
    expect(await read(fixture.adapter, "fundedYieldInVault")).to.equal(0n);

    await write(fixture.vault, "harvestRealisedYield");
    expect(await read(fixture.adapter, "fundedYieldInAdapter")).to.equal(0n);
  });

  it("preserves pending funded yield when full-balance recovery moves custody first", async function () {
    const fixture = await deployVaultFixture();
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 5n]);

    await write(fixture.vault.connect(fixture.alice) as BaseContract, "emergencyWithdraw");
    expect(await read(fixture.adapter, "fundedYieldInAdapter")).to.equal(0n);
    expect(await read(fixture.adapter, "fundedYieldInVault")).to.equal(5n);

    await write(fixture.vault, "harvestRealisedYield");
    expect(await read(fixture.adapter, "fundedYieldInVault")).to.equal(0n);
  });
});
