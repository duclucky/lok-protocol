import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { fhevm } from "hardhat";

import { depositMovedTargets, findFunction, loadSourceAst, type AstNode, walkAst } from "../ast/solidity";
import {
  debugDecrypt,
  decrypt64,
  deployVaultFixture,
  deposit,
  mintToken,
  openAndDecryptCheckpoint,
  read,
} from "./helpers";

async function debugTokenBalance(token: Awaited<ReturnType<typeof deployVaultFixture>>["token"], owner: string) {
  const handle = BigInt((await read(token, "confidentialBalanceOf", [owner])) as bigint | string);
  if (handle === 0n) return 0n;
  return debugDecrypt(FhevmType.euint64, handle);
}

describe("P-S5 ERC-7984 moved accounting", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  const deployMovedFixture = () => deployVaultFixture("MockYieldAdapter", false, "MovedObservingERC7984");

  for (const testCase of [
    { name: "zero", minted: 0n, requested: 0n, moved: 0n },
    { name: "less-than-available", minted: 9n, requested: 7n, moved: 7n },
    { name: "equal-to-available", minted: 9n, requested: 9n, moved: 9n },
    { name: "silent-zero-over-request", minted: 9n, requested: 10n, moved: 0n },
    { name: "supported-euint64-boundary", minted: 1n << 50n, requested: 1n << 50n, moved: 1n << 50n },
  ] as const) {
    it(`credits every accounting witness from returned moved: ${testCase.name}`, async function () {
      const fixture = await deployMovedFixture();
      await mintToken(fixture.token, fixture.owner, fixture.alice.address, testCase.minted);
      const senderBefore = await debugTokenBalance(fixture.token, fixture.alice.address);
      const vaultBefore = await debugTokenBalance(fixture.token, await fixture.vault.getAddress());

      await deposit(fixture, fixture.alice, testCase.requested);

      const movedHandle = (await read(fixture.token, "lastMovedForTest")) as bigint;
      const returnedMoved = await debugDecrypt(FhevmType.euint64, movedHandle);
      const senderAfter = await debugTokenBalance(fixture.token, fixture.alice.address);
      const vaultAfter = await debugTokenBalance(fixture.token, await fixture.vault.getAddress());
      const balanceHandle = (await read(fixture.vault, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
      const principalHandle = (await read(fixture.vault, "principalBalanceOf", [fixture.alice.address])) as bigint;
      const userBalance = await decrypt64(fixture.vault, fixture.alice, balanceHandle);
      const userPrincipal = await decrypt64(fixture.vault, fixture.alice, principalHandle);
      const checkpoint = await openAndDecryptCheckpoint(fixture.vault);

      expect(returnedMoved).to.equal(testCase.moved);
      expect(senderBefore - senderAfter).to.equal(returnedMoved);
      expect(vaultAfter - vaultBefore).to.equal(returnedMoved);
      expect(userBalance).to.equal(returnedMoved);
      expect(userPrincipal).to.equal(returnedMoved);
      expect(checkpoint.clearValue, "aggregate asset/liability witness").to.equal(true);
    });
  }

  it("keeps returned-moved ACL and deltas correct across repeated deposits", async function () {
    const fixture = await deployMovedFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 9n);
    for (const expectedMoved of [7n, 0n]) {
      const senderBefore = await debugTokenBalance(fixture.token, fixture.alice.address);
      const vaultBefore = await debugTokenBalance(fixture.token, await fixture.vault.getAddress());
      await deposit(fixture, fixture.alice, 7n);
      const movedHandle = (await read(fixture.token, "lastMovedForTest")) as bigint;
      const returnedMoved = await debugDecrypt(FhevmType.euint64, movedHandle);
      expect(returnedMoved).to.equal(expectedMoved);
      expect(senderBefore - (await debugTokenBalance(fixture.token, fixture.alice.address))).to.equal(returnedMoved);
      expect((await debugTokenBalance(fixture.token, await fixture.vault.getAddress())) - vaultBefore).to.equal(
        returnedMoved,
      );
    }
    const principalHandle = (await read(fixture.vault, "principalBalanceOf", [fixture.alice.address])) as bigint;
    expect(await decrypt64(fixture.vault, fixture.alice, principalHandle)).to.equal(7n);
  });

  it("property-checks requested, available, and silent-zero clamping combinations", async function () {
    let seed = 0x5a17n;
    for (let index = 0; index < 16; index += 1) {
      seed = (seed * 1_103_515_245n + 12_345n) & ((1n << 31n) - 1n);
      const available = seed % 10_001n;
      seed = (seed * 1_103_515_245n + 12_345n) & ((1n << 31n) - 1n);
      const requested = seed % 12_001n;
      const expectedMoved = requested <= available ? requested : 0n;
      const fixture = await deployMovedFixture();
      await mintToken(fixture.token, fixture.owner, fixture.alice.address, available);
      await deposit(fixture, fixture.alice, requested);
      const movedHandle = (await read(fixture.token, "lastMovedForTest")) as bigint;
      const returnedMoved = await debugDecrypt(FhevmType.euint64, movedHandle);
      const balanceHandle = (await read(fixture.vault, "confidentialBalanceOf", [fixture.alice.address])) as bigint;
      const principalHandle = (await read(fixture.vault, "principalBalanceOf", [fixture.alice.address])) as bigint;
      expect(returnedMoved, `case ${index}`).to.equal(expectedMoved);
      expect(await decrypt64(fixture.vault, fixture.alice, balanceHandle)).to.equal(returnedMoved);
      expect(await decrypt64(fixture.vault, fixture.alice, principalHandle)).to.equal(returnedMoved);
    }
  });

  it("binds all four deposit accounting additions to moved and catches a requested-amount mutation", function () {
    const ast = loadSourceAst("contracts/LokVault.sol");
    const depositAst = findFunction(ast, "deposit");
    expect(depositMovedTargets(depositAst)).to.deep.equal([
      "_balance",
      "_encryptedTotalLiability",
      "_encryptedTotalPrincipal",
      "_principalBalance",
    ]);

    const mutant = structuredClone(depositAst) as AstNode;
    let mutated = false;
    walkAst(mutant, (node) => {
      if (mutated || node.nodeType !== "FunctionCall") return;
      const args = node.arguments as AstNode[] | undefined;
      if (args?.[1]?.nodeType === "Identifier" && args[1].name === "moved") {
        args[1].name = "requested";
        mutated = true;
      }
    });
    expect(mutated).to.equal(true);
    expect(depositMovedTargets(mutant)).to.have.length(3);
  });
});
