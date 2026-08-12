import { expect } from "chai";
import { impersonateAccount, setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { BaseContract, ZeroAddress } from "ethers";
import { ethers, fhevm } from "hardhat";

import {
  asHandle,
  deployVaultFixture,
  deposit,
  mintToken,
  openAndDecryptCheckpoint,
  read,
  submitCheckpoint,
  write,
} from "../unit/helpers";

describe("Lok accounting and configuration boundaries", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("rejects invalid constructor and draw-manager configurations", async function () {
    const fixture = await deployVaultFixture();
    const vaultFactory = await ethers.getContractFactory("LokVault");
    await expect(vaultFactory.deploy(ZeroAddress, ZeroAddress, fixture.owner.address)).to.be.revertedWithCustomError(
      vaultFactory,
      "InvalidAddress",
    );

    const otherUnderlying = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const otherToken = await (
      await ethers.getContractFactory("YieldInjectingERC7984")
    ).deploy(await otherUnderlying.getAddress());
    await expect(
      vaultFactory.deploy(await otherToken.getAddress(), await fixture.adapter.getAddress(), fixture.owner.address),
    ).to.be.revertedWithCustomError(vaultFactory, "AdapterAssetMismatch");

    await expect(fixture.vault.getFunction("setDrawManager")(fixture.outsider.address)).to.be.revertedWithCustomError(
      fixture.vault,
      "DrawManagerAlreadySet",
    );
    const freshVault = await vaultFactory.deploy(await fixture.token.getAddress(), ZeroAddress, fixture.owner.address);
    await freshVault.waitForDeployment();
    await expect(freshVault.getFunction("setDrawManager")(ZeroAddress)).to.be.revertedWithCustomError(
      freshVault,
      "InvalidAddress",
    );
  });

  it("rejects stale checkpoint fields before signature verification", async function () {
    const fixture = await deployVaultFixture();
    await expect(
      fixture.vault.getFunction("submitSolvencyCheckpoint")(0n, 0n, "0x", "0x"),
    ).to.be.revertedWithCustomError(fixture.vault, "NoPendingCheckpoint");
    const checkpoint = await openAndDecryptCheckpoint(fixture.vault);
    await expect(
      fixture.vault.getFunction("submitSolvencyCheckpoint")(
        checkpoint.epoch + 1n,
        checkpoint.nonce,
        checkpoint.abiEncodedCleartexts,
        checkpoint.proof,
      ),
    ).to.be.revertedWithCustomError(fixture.vault, "WrongEpoch");
    await expect(
      fixture.vault.getFunction("submitSolvencyCheckpoint")(
        checkpoint.epoch,
        checkpoint.nonce + 1n,
        checkpoint.abiEncodedCleartexts,
        checkpoint.proof,
      ),
    ).to.be.revertedWithCustomError(fixture.vault, "WrongNonce");
    await expect(
      fixture.vault.getFunction("submitSolvencyCheckpoint")(checkpoint.epoch, checkpoint.nonce, "0x", checkpoint.proof),
    ).to.be.revertedWithCustomError(fixture.vault, "InvalidCleartextLength");
  });

  it("enforces adapter proposal, binding, and vault-only boundaries", async function () {
    const fixture = await deployVaultFixture();
    await submitCheckpoint(fixture.vault, await openAndDecryptCheckpoint(fixture.vault));
    await expect(fixture.vault.getFunction("proposeAdapter")(ZeroAddress)).to.be.revertedWithCustomError(
      fixture.vault,
      "InvalidAddress",
    );
    await expect(fixture.vault.getFunction("activateAdapter")()).to.be.revertedWithCustomError(
      fixture.vault,
      "AdapterProposalMissing",
    );
    await expect(fixture.vault.getFunction("drainRetiringAdapter")()).to.be.revertedWithCustomError(
      fixture.vault,
      "NoRetiringAdapter",
    );

    const adapterFactory = await ethers.getContractFactory("MockYieldAdapter");
    const unbound = await adapterFactory.deploy(await fixture.token.getAddress(), fixture.owner.address);
    await unbound.waitForDeployment();
    await expect(fixture.vault.getFunction("proposeAdapter")(await unbound.getAddress())).to.be.revertedWithCustomError(
      fixture.vault,
      "AdapterNotBound",
    );
    await expect(unbound.connect(fixture.outsider).getFunction("setVault")(fixture.vault)).to.be.reverted;
    await expect(unbound.getFunction("setVault")(ZeroAddress)).to.be.revertedWithCustomError(unbound, "InvalidVault");
    await write(unbound, "setVault", [await fixture.vault.getAddress()]);
    await expect(unbound.getFunction("setVault")(await fixture.vault.getAddress())).to.be.revertedWithCustomError(
      unbound,
      "AlreadyBound",
    );

    const otherUnderlying = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const otherToken = await (
      await ethers.getContractFactory("YieldInjectingERC7984")
    ).deploy(await otherUnderlying.getAddress());
    const mismatched = await adapterFactory.deploy(await otherToken.getAddress(), fixture.owner.address);
    await mismatched.waitForDeployment();
    await expect(
      fixture.vault.getFunction("proposeAdapter")(await mismatched.getAddress()),
    ).to.be.revertedWithCustomError(fixture.vault, "AdapterAssetMismatch");

    await write(fixture.vault, "onDrawOpened", [1n, 100n, 101n]);
    await expect(fixture.vault.getFunction("proposeAdapter")(ZeroAddress)).to.be.revertedWithCustomError(
      fixture.vault,
      "DrawNotIdle",
    );
    await write(fixture.vault, "onDrawClosed", [1n]);
    await expect(unbound.connect(fixture.outsider).getFunction("confidentialAssets")()).to.be.revertedWithCustomError(
      unbound,
      "OnlyVault",
    );
    await expect(unbound.connect(fixture.outsider).getFunction("withdrawAllToVault")()).to.be.revertedWithCustomError(
      unbound,
      "OnlyVault",
    );
    await expect(unbound.connect(fixture.outsider).getFunction("harvest")()).to.be.revertedWithCustomError(
      unbound,
      "OnlyVault",
    );

    await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1n]);
    const vaultAddress = await fixture.vault.getAddress();
    await impersonateAccount(vaultAddress);
    await setBalance(vaultAddress, 10n ** 18n);
    const vaultSigner = await ethers.getSigner(vaultAddress);
    await expect(
      fixture.adapter.connect(vaultSigner).getFunction("withdrawToVault")(asHandle(0n)),
    ).to.be.revertedWithCustomError(fixture.adapter, "PendingYieldRequiresFullReturn");
  });

  it("guards draw-only accounting hooks and supports the no-adapter recovery branch", async function () {
    const fixture = await deployVaultFixture();
    await expect(fixture.vault.connect(fixture.outsider).getFunction("preSync")([])).to.be.revertedWithCustomError(
      fixture.vault,
      "OnlyDrawManager",
    );
    await expect(
      fixture.vault.getFunction("preSync")(Array(5).fill(fixture.alice.address)),
    ).to.be.revertedWithCustomError(fixture.vault, "SyncBatchTooLarge");
    await expect(fixture.vault.getFunction("onDrawOpened")(1n, 100n, 100n)).to.be.revertedWithCustomError(
      fixture.vault,
      "InvalidDrawWindow",
    );
    await write(fixture.vault, "onDrawOpened", [1n, 100n, 101n]);
    await expect(
      fixture.vault.getFunction("finalizeParticipantRemoval")(fixture.alice.address),
    ).to.be.revertedWithCustomError(fixture.vault, "DrawNotIdle");
    await write(fixture.vault, "onDrawClosed", [1n]);
    await expect(
      fixture.vault.getFunction("finalizeParticipantRemoval")(fixture.alice.address),
    ).to.be.revertedWithCustomError(fixture.vault, "ParticipantRemovalNotPending");

    const vaultFactory = await ethers.getContractFactory("LokVault");
    const noAdapter = await vaultFactory.deploy(await fixture.token.getAddress(), ZeroAddress, fixture.owner.address);
    await noAdapter.waitForDeployment();
    await write(noAdapter, "setDrawManager", [fixture.owner.address]);
    expect(await read(noAdapter, "harvestRealisedYield")).to.equal(0n);
    await write(noAdapter, "openSolvencyCheckpoint");
    expect(await read(noAdapter, "hasPendingSolvencyCheckpoint")).to.equal(true);
  });

  it("rejects duplicate and unknown exit finalization requests", async function () {
    const fixture = await deployVaultFixture();
    await expect(
      fixture.vault.getFunction("finalizeExit")("0x" + "11".repeat(32), 0n, "0x"),
    ).to.be.revertedWithCustomError(fixture.vault, "ExitRequestMissing");

    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 100n);
    await deposit(fixture, fixture.alice, 100n);
    await write(fixture.vault.connect(fixture.alice) as BaseContract, "exit");
    await expect(fixture.vault.connect(fixture.alice).getFunction("exit")()).to.be.revertedWithCustomError(
      fixture.vault,
      "ExitAlreadyPending",
    );
  });
});
