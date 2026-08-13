import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { fhevm } from "hardhat";

import { findFunction, fortuneResetShape, loadSourceAst, type AstNode, walkAst } from "../ast/solidity";
import { debugDecrypt, deployVaultFixture, deposit, mintToken, read, write } from "./helpers";

describe("P-F6 exact Fortune reset", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("resets iff win across stateful multi-user draw sequences and the Fortune cap", async function () {
    const fixture = await deployVaultFixture("MockYieldAdapter", true);
    if (fixture.drawHarness === undefined) throw new Error("draw harness missing");
    const users = [fixture.alice, fixture.outsider];
    for (const user of users) {
      await mintToken(fixture.token, fixture.owner, user.address, 10n);
      await deposit(fixture, user, 10n);
    }

    const sequences = [
      [false, false, true, false, true, true, false],
      [...Array.from({ length: 55 }, () => false), true, false],
    ];
    for (let userIndex = 0; userIndex < users.length; userIndex += 1) {
      let expectedFortune = 0n;
      for (const won of sequences[userIndex]) {
        await write(fixture.drawHarness, "credit", [users[userIndex].address, won ? 1n : 0n, 0n]);
        expectedFortune = won ? 0n : expectedFortune + 1n > 52n ? 52n : expectedFortune + 1n;
        const handle = (await read(fixture.vault, "fortuneOf", [users[userIndex].address])) as bigint;
        expect(await debugDecrypt(FhevmType.euint16, handle), `user ${userIndex} after ${String(won)}`).to.equal(
          expectedFortune,
        );
      }
    }
  });

  it("requires the exact encrypted select shape and rejects structural mutants", function () {
    const ast = loadSourceAst("contracts/LokVault.sol");
    const creditDraw = findFunction(ast, "creditDraw");
    expect(fortuneResetShape(creditDraw)).to.deep.equal({ validSelectAssignments: 1, plaintextBranches: 0 });

    const swappedArms = structuredClone(creditDraw) as AstNode;
    walkAst(swappedArms, (node) => {
      if (node.nodeType !== "Assignment") return;
      const rhs = node.rightHandSide as AstNode | undefined;
      const expression = rhs?.expression as AstNode | undefined;
      if (expression?.memberName !== "select") return;
      const args = rhs?.arguments as AstNode[];
      [args[1], args[2]] = [args[2], args[1]];
    });
    expect(fortuneResetShape(swappedArms).validSelectAssignments).to.equal(0);

    const wrongCondition = structuredClone(creditDraw) as AstNode;
    walkAst(wrongCondition, (node) => {
      if (node.nodeType !== "Assignment") return;
      const rhs = node.rightHandSide as AstNode | undefined;
      const expression = rhs?.expression as AstNode | undefined;
      if (expression?.memberName === "select") (rhs?.arguments as AstNode[])[0].name = "requested";
    });
    expect(fortuneResetShape(wrongCondition).validSelectAssignments).to.equal(0);

    const removedSelect = structuredClone(creditDraw) as AstNode;
    walkAst(removedSelect, (node) => {
      if (node.nodeType !== "Assignment") return;
      const rhs = node.rightHandSide as AstNode | undefined;
      const expression = rhs?.expression as AstNode | undefined;
      if (expression?.memberName === "select") expression.memberName = "add";
    });
    expect(fortuneResetShape(removedSelect).validSelectAssignments).to.equal(0);
  });

  it("matches an independent oracle over a generated 96-draw outcome sequence", async function () {
    const fixture = await deployVaultFixture("MockYieldAdapter", true);
    if (fixture.drawHarness === undefined) throw new Error("draw harness missing");
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 10n);
    await deposit(fixture, fixture.alice, 10n);
    let seed = 0xf06en;
    let expected = 0n;
    for (let draw = 0; draw < 96; draw += 1) {
      seed = (seed * 1_664_525n + 1_013_904_223n) & 0xffff_ffffn;
      const won = seed % 11n === 0n;
      await write(fixture.drawHarness, "credit", [fixture.alice.address, won ? 1n : 0n, 0n]);
      expected = won ? 0n : expected < 52n ? expected + 1n : 52n;
      const handle = (await read(fixture.vault, "fortuneOf", [fixture.alice.address])) as bigint;
      expect(await debugDecrypt(FhevmType.euint16, handle), `draw ${draw}`).to.equal(expected);
    }
  });
});
