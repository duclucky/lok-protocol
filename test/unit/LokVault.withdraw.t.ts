import { expect } from "chai";
import { BaseContract } from "ethers";
import { fhevm } from "hardhat";

import { debugDecryptBool, deployVaultFixture, deposit, encrypt64, mintToken, read, write } from "./helpers";

describe("LokVault withdrawals", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("caps an over-withdraw and returns encrypted false status", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 10n);
    await deposit(fixture, fixture.alice, 10n);

    const request = await encrypt64(fixture.vault, fixture.alice, 20n);
    await write(fixture.vault.connect(fixture.alice) as BaseContract, "withdraw", [
      request.handles[0],
      request.inputProof,
    ]);
    const status = (await read(fixture.vault, "lastActionStatus", [fixture.alice.address])) as bigint;
    expect(await debugDecryptBool(status)).to.equal(false);
  });

  it("creates an asynchronous public unwrap request on exit", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 10n);
    await deposit(fixture, fixture.alice, 10n);

    await write(fixture.vault.connect(fixture.alice) as BaseContract, "exit");
    const requestId = (await read(fixture.vault, "pendingExitRequest", [fixture.alice.address])) as `0x${string}`;
    expect(requestId).to.not.equal("0x" + "00".repeat(32));
    expect(await read(fixture.vault, "participantCount")).to.equal(1n);

    const decrypted = await fhevm.publicDecrypt([requestId]);
    const clearAmount = decrypted.clearValues[requestId] as bigint;
    await write(fixture.vault, "finalizeExit", [requestId, clearAmount, decrypted.decryptionProof]);

    expect(await read(fixture.vault, "participantCount")).to.equal(0n);
    expect(await read(fixture.underlying, "balanceOf", [fixture.alice.address])).to.equal(10n);
  });
});
