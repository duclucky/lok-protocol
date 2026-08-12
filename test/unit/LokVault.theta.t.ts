import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { BaseContract } from "ethers";
import { fhevm } from "hardhat";

import { debugDecrypt, deployVaultFixture, encrypt8, read, write } from "./helpers";

describe("LokVault theta", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("clamps encrypted theta to THETA_DENOM", async function () {
    const fixture = await deployVaultFixture();
    const encrypted = await encrypt8(fixture.vault, fixture.alice, 7n);
    await write(fixture.vault.connect(fixture.alice) as BaseContract, "setTheta", [
      encrypted.handles[0],
      encrypted.inputProof,
    ]);

    const theta = (await read(fixture.vault, "thetaOf", [fixture.alice.address])) as bigint;
    expect(await debugDecrypt(FhevmType.euint8, theta)).to.equal(4n);
  });
});
