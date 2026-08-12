import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { fhevm } from "hardhat";

import { debugDecrypt, debugDecryptBool, decrypt64, deployVaultFixture, deposit, mintToken, read } from "./helpers";

describe("LokVault deposits", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("defaults theta to four, records encrypted success, and enrolls once", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 20n);
    await deposit(fixture, fixture.alice, 7n);
    await deposit(fixture, fixture.alice, 3n);

    const theta = (await read(fixture.vault, "thetaOf", [fixture.alice.address])) as bigint;
    const status = (await read(fixture.vault, "lastActionStatus", [fixture.alice.address])) as bigint;
    expect(await debugDecrypt(FhevmType.euint8, theta)).to.equal(4n);
    expect(await debugDecryptBool(status)).to.equal(true);
    expect(await read(fixture.vault, "participantCount")).to.equal(1n);

    const principal = (await read(fixture.vault, "principalBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.vault, fixture.alice, principal)).to.equal(10n);

    const fortune = (await read(fixture.vault, "fortuneOf", [fixture.alice.address])) as bigint;
    expect(await debugDecrypt(FhevmType.euint16, fortune)).to.equal(0n);
  });

  it("stores encrypted false when an over-deposit moves zero", async function () {
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 5n);
    await deposit(fixture, fixture.alice, 9n);

    const status = (await read(fixture.vault, "lastActionStatus", [fixture.alice.address])) as bigint;
    expect(await debugDecryptBool(status)).to.equal(false);
  });
});
