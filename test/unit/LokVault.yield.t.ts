import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { fhevm } from "hardhat";

import { debugDecrypt, deployVaultFixture, deposit, mintToken, read, write } from "./helpers";

describe("LokVault funded credits", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("credits claimable balance without increasing principal", async function () {
    const fixture = await deployVaultFixture("MockYieldAdapter", true);
    if (fixture.drawHarness === undefined) throw new Error("draw harness missing");
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 10n);
    await deposit(fixture, fixture.alice, 10n);

    await write(fixture.drawHarness, "credit", [fixture.alice.address, 3n, 2n]);
    const balance = (await read(fixture.vault, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
    const principal = (await read(fixture.vault, "principalBalanceOf", [fixture.alice.address])) as bigint;
    expect(await debugDecrypt(FhevmType.euint64, balance)).to.equal(15n);
    expect(await debugDecrypt(FhevmType.euint64, principal)).to.equal(10n);
  });
});
