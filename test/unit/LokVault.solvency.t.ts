import { expect } from "chai";
import { BaseContract } from "ethers";
import { ethers, fhevm } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
  decrypt64,
  deployVaultFixture,
  deposit,
  mintToken,
  openAndDecryptCheckpoint,
  read,
  submitCheckpoint,
  tamperLastByte,
  write,
} from "./helpers";

describe("LokVault confidential solvency checkpoints", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("credits only the ERC-7984 amount actually moved and advances accountingVersion", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 9n);
    await deposit(fixture, fixture.alice, 7n);

    const balanceHandle = (await read(fixture.vault, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.vault, fixture.alice, balanceHandle)).to.equal(7n);
    expect(await read(fixture.vault, "accountingVersion")).to.equal(1n);

    await deposit(fixture, fixture.alice, 7n);
    const unchanged = (await read(fixture.vault, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.vault, fixture.alice, unchanged)).to.equal(7n);
    expect(await read(fixture.vault, "accountingVersion")).to.equal(2n);
  });

  it("accepts true and false checkpoint proofs without exposing numeric aggregates", async function () {
    const solvent = await deployVaultFixture();
    const trueResult = await openAndDecryptCheckpoint(solvent.vault);
    expect(trueResult.clearValue).to.equal(true);
    await submitCheckpoint(solvent.vault, trueResult);
    expect(await read(solvent.vault, "lastSolventRiskEpoch")).to.equal(1n);
    expect(await read(solvent.vault, "restricted")).to.equal(false);

    const insolvent = await deployVaultFixture("MaliciousYieldAdapter");
    const first = await openAndDecryptCheckpoint(insolvent.vault);
    await submitCheckpoint(insolvent.vault, first);
    await mintToken(insolvent.token, insolvent.owner, insolvent.alice.address, 10n);
    await deposit(insolvent, insolvent.alice, 10n);

    const falseResult = await openAndDecryptCheckpoint(insolvent.vault);
    expect(falseResult.clearValue).to.equal(false);
    await submitCheckpoint(insolvent.vault, falseResult);
    expect(await read(insolvent.vault, "restricted")).to.equal(true);

    for (const forbidden of ["totalPrincipal", "totalLiability", "totalAssets"]) {
      expect(insolvent.vault.interface.hasFunction(forbidden), forbidden).to.equal(false);
    }
  });

  it("rejects forged, replaced-handle, and stale-risk-epoch checkpoint submissions", async function () {
    const fixture = await deployVaultFixture();
    const forged = await openAndDecryptCheckpoint(fixture.vault);
    await expect(
      fixture.vault.getFunction("submitSolvencyCheckpoint")(
        forged.epoch,
        forged.nonce,
        forged.abiEncodedCleartexts,
        tamperLastByte(forged.proof),
      ),
    ).to.be.reverted;

    const replaced = await openAndDecryptCheckpoint(fixture.vault);
    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1n]);
    await write(fixture.vault, "openSolvencyCheckpoint");
    const replacementNonce = (await read(fixture.vault, "solvencyCheckpointNonce")) as bigint;
    await expect(
      fixture.vault.getFunction("submitSolvencyCheckpoint")(
        replaced.epoch,
        replacementNonce,
        replaced.abiEncodedCleartexts,
        replaced.proof,
      ),
    ).to.be.reverted;

    const current = await openAndDecryptCheckpoint(fixture.vault);
    await submitCheckpoint(fixture.vault, current);
    const stale = await openAndDecryptCheckpoint(fixture.vault);

    const adapterFactory = await ethers.getContractFactory("MockYieldAdapter");
    const nextAdapter = await adapterFactory.deploy(await fixture.token.getAddress(), fixture.owner.address);
    await nextAdapter.waitForDeployment();
    await write(nextAdapter, "setVault", [await fixture.vault.getAddress()]);
    await write(fixture.vault, "proposeAdapter", [await nextAdapter.getAddress()]);
    const delay = (await read(fixture.vault, "ADAPTER_DELAY")) as bigint;
    await time.increase(delay);
    await write(fixture.vault, "activateAdapter");

    await expect(
      fixture.vault.getFunction("submitSolvencyCheckpoint")(
        stale.epoch,
        stale.nonce,
        stale.abiEncodedCleartexts,
        stale.proof,
      ),
    ).to.be.reverted;
  });

  it("cannot remove a non-drained retiring adapter", async function () {
    const fixture = await deployVaultFixture();
    const initial = await openAndDecryptCheckpoint(fixture.vault);
    await submitCheckpoint(fixture.vault, initial);
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 10n);
    await deposit(fixture, fixture.alice, 10n);

    const adapterFactory = await ethers.getContractFactory("MockYieldAdapter");
    const nextAdapter = await adapterFactory.deploy(await fixture.token.getAddress(), fixture.owner.address);
    await nextAdapter.waitForDeployment();
    await write(nextAdapter, "setVault", [await fixture.vault.getAddress()]);
    await write(fixture.vault, "proposeAdapter", [await nextAdapter.getAddress()]);
    await time.increase((await read(fixture.vault, "ADAPTER_DELAY")) as bigint);
    await write(fixture.vault, "activateAdapter");

    await expect(fixture.vault.getFunction("removeRetiringAdapter")()).to.be.reverted;
    await write(fixture.vault, "drainRetiringAdapter");
    const checkpoint = await openAndDecryptCheckpoint(fixture.vault);
    await submitCheckpoint(fixture.vault, checkpoint);
    await write(fixture.vault, "removeRetiringAdapter");
    expect(await read(fixture.vault, "retiringAdapter")).to.equal(ethers.ZeroAddress);
  });

  it("keeps emergency recovery independent of checkpoint and oracle progress", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 12n);
    await deposit(fixture, fixture.alice, 12n);
    await write(fixture.vault, "openSolvencyCheckpoint");

    await write(fixture.vault.connect(fixture.alice) as BaseContract, "emergencyWithdraw");
    const tokenHandle = (await read(fixture.token, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.token, fixture.alice, tokenHandle)).to.equal(12n);
  });
});
