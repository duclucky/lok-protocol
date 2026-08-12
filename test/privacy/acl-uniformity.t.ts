import { expect } from "chai";
import { BaseContract, ContractTransactionReceipt, Interface } from "ethers";
import { fhevm } from "hardhat";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  buildPrivacyReport,
  collectPrivacyEvidence,
  scanPrivacySurface,
  writePrivacyEvidence,
} from "../../scripts/privacy-scan";
import { asHandle, read } from "../draw/helpers";
import { crankPrivacyParticipants, reachPrivacySweepB } from "./helpers";

const aclInterface = new Interface(["event Allowed(address indexed caller,address indexed account,bytes32 handle)"]);

function allowedLogs(receipts: ContractTransactionReceipt[]) {
  return receipts.flatMap((receipt) =>
    receipt.logs.flatMap((log) => {
      try {
        const parsed = aclInterface.parseLog(log);
        return parsed === null ? [] : [parsed];
      } catch {
        return [];
      }
    }),
  );
}

describe("Lok static privacy surface", function () {
  const staticPrivacyIt = process.env.SOLIDITY_COVERAGE === "true" ? it.skip : it;

  staticPrivacyIt("allowlists every public-decryption call and rejects winner-only ABI or amount events", function () {
    const report = scanPrivacySurface();

    expect(report.publicDecryption.calls).to.have.length(6);
    expect(report.publicDecryption.violations).to.deep.equal([]);
    expect(report.publicDecryption.settlementGuardVerified).to.equal(true);
    expect([...new Set(report.acl.grants.map(({ classification }) => classification))]).to.have.members([
      "allow",
      "allowThis",
      "allowTransient",
    ]);
    expect(report.events.violations).to.deep.equal([]);
    expect(report.abi.winnerOnlyCandidates).to.deep.equal([]);
    expect(report.abi.hasUniformCreditCheckPath).to.equal(true);
    expect(report.redTeam.newChannels).to.deep.equal(["S9"]);
    expect(report.redTeam.fortuneResetUsesFheSelect).to.equal(true);
    expect(report.redTeam.anonymityFloor).to.deep.include({ status: "PASS", minimum: 5 });
    expect(report.redTeam.aggregateFortuneDisclosureOnly).to.equal(true);
    expect(report.redTeam.frontendTelemetry.status).to.equal("HUMAN_REVIEW_REQUIRED");
    expect(report.status).to.equal("PASS");
  });

  staticPrivacyIt("requires all three dynamic evidence fragments before reporting PASS", function () {
    const directory = mkdtempSync(path.join(tmpdir(), "lok-privacy-evidence-"));
    try {
      expect(() => collectPrivacyEvidence(directory)).to.throw("Missing privacy evidence");
      writePrivacyEvidence("acl-uniformity", { status: "PASS", grantsPerParticipant: 1 }, directory);
      writePrivacyEvidence("log-indistinguishability", { status: "PASS", logShapeEqual: true }, directory);
      writePrivacyEvidence("gas-indistinguishability", { status: "PASS", globalHcuDelta: 0 }, directory);
      const evidence = collectPrivacyEvidence(directory);
      expect(evidence.status).to.equal("PASS");
      expect(Object.keys(evidence.fragments)).to.have.members([
        "acl-uniformity",
        "log-indistinguishability",
        "gas-indistinguishability",
      ]);
      const report = buildPrivacyReport(directory, "2026-08-11T00:00:00.000Z");
      expect(report.propositions["P-P1"].status).to.equal("PASS");
      expect(report.propositions["P-P9-ABI"].status).to.equal("PASS");
      expect(report.propositions["P-P9-UX"].status).to.equal("NOT_TESTABLE");
      expect(report.status).to.equal("PASS");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("grants each participant exactly one ACL entry on their own prize-credit handle", async function () {
    if (!fhevm.isMock) this.skip();
    const fixture = await reachPrivacySweepB();
    const receipts = await crankPrivacyParticipants(fixture);
    const grants = allowedLogs(receipts);
    const grantCounts: number[] = [];

    for (const user of fixture.participants) {
      const handle = asHandle((await read(fixture.draw as BaseContract, "prizeCredit", [1n, user.address])) as bigint);
      const matching = grants.filter(
        ({ args }) =>
          (args.account as string).toLowerCase() === user.address.toLowerCase() &&
          (args.handle as string).toLowerCase() === handle.toLowerCase(),
      );
      expect(matching, `prize-credit grants for ${user.address}`).to.have.length(1);
      grantCounts.push(matching.length);
    }
    writePrivacyEvidence("acl-uniformity", {
      status: "PASS",
      proposition: "P-P2",
      participants: fixture.participants.length,
      grantCounts,
      winnerIndependent: true,
    });
  });
});
