import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ContractTransactionReceipt } from "ethers";
import { fhevm } from "hardhat";

import { comparePrivacyCost, writePrivacyEvidence } from "../../scripts/privacy-scan";
import { asHandle, read } from "../draw/helpers";
import { crankPrivacyParticipants, reachPrivacySweepB } from "./helpers";

describe("Lok winner gas and HCU indistinguishability", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("keeps winner and loser HCU equal and gas within the fixed one-percent threshold", async function () {
    let winnerReceipt: ContractTransactionReceipt | undefined;
    let loserReceipt: ContractTransactionReceipt | undefined;
    let sample: Array<{ index: number; outcome: "winner" | "loser"; gasUsed: string }> = [];
    for (let attempt = 0; attempt < 4 && winnerReceipt === undefined; attempt += 1) {
      const fixture = await reachPrivacySweepB(7, { boundaryDust: true });
      const receipts = await crankPrivacyParticipants(fixture);
      const credits: bigint[] = [];
      for (const user of fixture.participants) {
        const handle = asHandle((await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint);
        credits.push(await fhevm.userDecryptEuint(FhevmType.euint64, handle, await fixture.draw.getAddress(), user));
      }
      const winnerIndex = credits.findIndex((credit) => credit > 0n);
      const loserIndex = credits.findIndex(
        (credit, index) => credit === 0n && index > 0 && index < receipts.length - 1,
      );
      if (winnerIndex > 0 && winnerIndex < receipts.length - 1 && loserIndex >= 0) {
        winnerReceipt = receipts[winnerIndex];
        loserReceipt = receipts[loserIndex];
        sample = credits.slice(0, -1).map((credit, index) => ({
          index,
          outcome: credit > 0n ? "winner" : "loser",
          gasUsed: receipts[index].gasUsed.toString(),
        }));
      }
    }
    expect(winnerReceipt, "four draws produced no comparable non-final winner").to.not.equal(undefined);
    expect(loserReceipt).to.not.equal(undefined);
    if (winnerReceipt === undefined || loserReceipt === undefined) throw new Error("missing comparable receipts");

    const comparison = comparePrivacyCost(
      { gasUsed: winnerReceipt.gasUsed, hcu: fhevm.computeTransactionHCU(winnerReceipt) },
      { gasUsed: loserReceipt.gasUsed, hcu: fhevm.computeTransactionHCU(loserReceipt) },
    );

    const diagnostic = JSON.stringify({ comparison, sample });
    expect(comparison.globalHcuDelta, diagnostic).to.equal(0);
    expect(comparison.maxHcuDepthDelta, diagnostic).to.equal(0);
    expect(comparison.gasDeltaBps, diagnostic).to.be.at.most(100);
    expect(comparison.status).to.equal("PASS");
    writePrivacyEvidence("gas-indistinguishability", {
      status: "PASS",
      proposition: "P-P5",
      comparison,
      sample,
      positionalControl: "winner and loser are both non-first and non-final crankB(1) transactions",
      firstCrankGasVarianceIsPublicPositionDependent: true,
    });
  });
});
