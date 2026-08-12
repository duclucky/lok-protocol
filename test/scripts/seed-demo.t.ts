import { expect } from "chai";
import { BaseContract } from "ethers";
import { fhevm } from "hardhat";

import {
  actorTransactionNonces,
  buildSeedPlan,
  demoYieldTopUp,
  reclaimableActorBalance,
  remainingSeedPlan,
  resolveActorFunding,
  resolveSeedOptions,
  serializePublicSeedPlan,
} from "../../scripts/seed-demo";
import { deployVaultFixture, encrypt8, encrypt64, mintToken } from "../unit/helpers";

describe("demo participant seeder", function () {
  it("rejects actor funding below the measured Sepolia transaction envelope", function () {
    expect(resolveActorFunding({})).to.equal(5_000_000_000_000_000n);
    expect(resolveActorFunding({ LOK_ACTOR_FUNDING_WEI: "5000000000000000" })).to.equal(5_000_000_000_000_000n);
    expect(() => resolveActorFunding({ LOK_ACTOR_FUNDING_WEI: "4999999999999999" })).to.throw("at least 0.005 ETH");
  });

  it("assigns monotonically increasing actor nonces without querying a stale RPC cache", function () {
    expect(actorTransactionNonces(0, false)).to.deep.equal({ setOperator: 0, deposit: 1, sweep: 2 });
    expect(actorTransactionNonces(7, true)).to.deep.equal({ setOperator: 7, deposit: 8, theta: 9, sweep: 10 });
  });

  it("tops demo yield up to a public target without duplicating it on resume", function () {
    expect(demoYieldTopUp(0n, 5_000_000n)).to.equal(5_000_000n);
    expect(demoYieldTopUp(2_000_000n, 5_000_000n)).to.equal(3_000_000n);
    expect(demoYieldTopUp(5_000_000n, 5_000_000n)).to.equal(0n);
    expect(() => demoYieldTopUp(5_000_001n, 5_000_000n)).to.throw("exceeds target");
  });

  it("accepts Hardhat-compatible environment options", function () {
    expect(
      resolveSeedOptions(
        { LOK_SEED_COUNT: "35", LOK_DEMO_WALLET: "0x00000000000000000000000000000000000000d0" },
        "0x00000000000000000000000000000000000000d1",
      ),
    ).to.deep.equal({ count: 35, demoWallet: "0x00000000000000000000000000000000000000d0" });
  });

  it("creates 30-50 varied synthetic positions without serializing key material", function () {
    const plan = buildSeedPlan(40, "0x00000000000000000000000000000000000000d0");
    expect(plan).to.have.length(40);
    expect(new Set(plan.map((position) => position.amount.toString())).size).to.be.greaterThan(4);
    expect(new Set(plan.map((position) => position.theta.toString())).size).to.be.greaterThan(2);
    expect(plan.filter((position) => position.theta !== 4n)).to.have.length(4);

    const serialized = serializePublicSeedPlan(plan);
    expect(serialized).not.to.match(/private|mnemonic|secret/i);
    expect(serialized).not.to.include("0x00000000000000000000000000000000000000d0");
  });

  it("resumes from the current participant count and reclaims only spendable actor ETH", function () {
    const plan = buildSeedPlan(30, "0x00000000000000000000000000000000000000d0");
    expect(remainingSeedPlan(plan, 12).map((position) => position.index)).to.deep.equal(
      Array.from({ length: 18 }, (_, index) => index + 12),
    );
    expect(remainingSeedPlan(plan, 30)).to.deep.equal([]);
    expect(() => remainingSeedPlan(plan, 31)).to.throw("exceeds target");
    expect(reclaimableActorBalance(1_000_000n, 10n, 21_000n)).to.equal(790_000n);
    expect(reclaimableActorBalance(200_000n, 10n, 21_000n)).to.equal(0n);
  });

  it("rejects counts outside the reviewed demo range", function () {
    expect(() => buildSeedPlan(29, "0x00000000000000000000000000000000000000d0")).to.throw("30 and 50");
    expect(() => buildSeedPlan(51, "0x00000000000000000000000000000000000000d0")).to.throw("30 and 50");
  });

  it("measures the actor transaction gas paths used for Sepolia funding", async function () {
    if (!fhevm.isMock) this.skip();
    const fixture = await deployVaultFixture();
    await mintToken(fixture.token, fixture.owner, fixture.alice.address, 1_000_000n);
    const operatorTx = await (fixture.token.connect(fixture.alice) as BaseContract).getFunction("setOperator")(
      await fixture.vault.getAddress(),
      2n ** 48n - 1n,
    );
    const operatorReceipt = await operatorTx.wait();
    const amount = await encrypt64(fixture.vault, fixture.alice, 1_000_000n);
    const depositTx = await (fixture.vault.connect(fixture.alice) as BaseContract).getFunction("deposit")(
      amount.handles[0],
      amount.inputProof,
    );
    const depositReceipt = await depositTx.wait();
    const theta = await encrypt8(fixture.vault, fixture.alice, 2n);
    const thetaTx = await (fixture.vault.connect(fixture.alice) as BaseContract).getFunction("setTheta")(
      theta.handles[0],
      theta.inputProof,
    );
    const thetaReceipt = await thetaTx.wait();
    if (operatorReceipt === null || depositReceipt === null || thetaReceipt === null)
      throw new Error("receipt missing");

    console.log(
      JSON.stringify({
        operatorGas: operatorReceipt.gasUsed.toString(),
        depositGas: depositReceipt.gasUsed.toString(),
        thetaGas: thetaReceipt.gasUsed.toString(),
      }),
    );
    expect(operatorReceipt.gasUsed).to.be.lessThan(200_000n);
    expect(depositReceipt.gasUsed).to.be.lessThan(1_500_000n);
    expect(thetaReceipt.gasUsed).to.be.lessThan(750_000n);
  });
});
