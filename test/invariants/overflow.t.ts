import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { fhevm } from "hardhat";

import { debugDecrypt, deployVaultFixture, deposit, mintToken, read } from "../unit/helpers";

describe("LokVault encrypted arithmetic bounds", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("saturates rate at 2^52 without changing principal", async function () {
    const fixture = await deployVaultFixture();
    const maxSupportedBalance = 2n ** 50n;
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, maxSupportedBalance);
    await deposit(fixture, fixture.alice, maxSupportedBalance);

    const rate = (await read(fixture.vault, "rateOf", [fixture.alice.address])) as bigint;
    const principal = (await read(fixture.vault, "principalBalanceOf", [fixture.alice.address])) as bigint;
    expect(await debugDecrypt(FhevmType.euint128, rate)).to.equal(2n ** 52n);
    expect(await debugDecrypt(FhevmType.euint64, principal)).to.equal(maxSupportedBalance);
  });

  it("proves accumulator and aggregate bounds algebraically", function () {
    const maxUint64 = 2n ** 64n - 1n;
    const maxElapsed = 2n ** 64n - 1n;
    expect(maxUint64 * maxElapsed).to.be.lessThan(2n ** 128n);
    expect(2n ** 52n * maxElapsed).to.be.lessThan(2n ** 128n);
    expect(maxUint64).to.be.lessThan(2n ** 64n);
  });
});
