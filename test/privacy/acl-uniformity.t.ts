import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";
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
  let testEvidenceDirectory: string;

  before(function () {
    testEvidenceDirectory = mkdtempSync(path.join(tmpdir(), "lok-privacy-acl-"));
  });

  after(function () {
    rmSync(testEvidenceDirectory, { recursive: true, force: true });
  });

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
      writePrivacyEvidence(
        "acl-uniformity",
        {
          status: "PASS",
          sourceTestIdentifiers: ["acl-fixture"],
          grantMultisetExact: true,
          winnerGrantCount: 1,
          loserGrantCounts: [1, 1],
        },
        directory,
      );
      writePrivacyEvidence(
        "log-indistinguishability",
        {
          status: "PASS",
          sourceTestIdentifiers: ["log-fixture"],
          comparedFullLifecycleRawAndParsedFields: true,
          comparedEveryWinnerAgainstEveryOther: true,
          counterfactualWinnerIndices: [0, 1, 2, 3, 4],
          protocolInfrastructureLogsCompared: false,
          residual: "protocol logs pending",
        },
        directory,
      );
      writePrivacyEvidence(
        "gas-indistinguishability",
        {
          status: "PASS",
          sourceTestIdentifiers: ["gas-fixture"],
          allPositionsMeasured: true,
          sweepAndFinalizationOutcomeIndependent: true,
          positions: [{}, {}, {}],
        },
        directory,
      );
      const evidence = collectPrivacyEvidence(directory);
      expect(evidence.status).to.equal("PASS");
      expect(Object.keys(evidence.fragments)).to.have.members([
        "acl-uniformity",
        "log-indistinguishability",
        "gas-indistinguishability",
      ]);
      const report = buildPrivacyReport(directory, "2026-08-11T00:00:00.000Z");
      expect(report.propositions["P-P1"].status).to.equal("FAIL");
      expect(report.propositions["P-P9-ABI"].status).to.equal("PASS");
      expect(report.propositions["P-P9-UX"].status).to.equal("NOT_TESTABLE");
      expect(report.status).to.equal("FAIL");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  staticPrivacyIt("reports re-frozen P-P1 from natural non-derivability evidence", function () {
    const report = buildPrivacyReport(undefined, "2026-08-15T00:00:00.000Z");

    expect(report.propositions["P-P1"].status).to.equal("PASS");
    expect(report.propositions["P-P1"].evidence).to.contain("natural 1,000-run");
  });

  it("grants each participant exactly one ACL entry on their own prize-credit handle", async function () {
    if (!fhevm.isMock) this.skip();
    const fixture = await reachPrivacySweepB();
    const receipts = await crankPrivacyParticipants(fixture);
    const grants = allowedLogs(receipts);
    const participantAddresses = new Set(fixture.participants.map((user) => user.address.toLowerCase()));
    const expectedPairs: string[] = [];
    const actualPairs: string[] = [];
    const grantCountsByUser = new Map<string, number>();
    const credits: bigint[] = [];
    const prizeHandleOwners = new Map<string, string>();

    for (const user of fixture.participants) {
      const handle = asHandle((await read(fixture.draw as BaseContract, "prizeCredit", [1n, user.address])) as bigint);
      const normalizedUser = user.address.toLowerCase();
      const normalizedHandle = handle.toLowerCase();
      prizeHandleOwners.set(normalizedHandle, normalizedUser);
      expectedPairs.push(`${normalizedUser}:${normalizedHandle}`);
      credits.push(await fhevm.userDecryptEuint(FhevmType.euint64, handle, await fixture.draw.getAddress(), user));
    }

    const prizeHandleSet = new Set(prizeHandleOwners.keys());
    for (const { args } of grants) {
      const account = (args.account as string).toLowerCase();
      const handle = (args.handle as string).toLowerCase();
      if (!participantAddresses.has(account) || !prizeHandleSet.has(handle)) continue;
      actualPairs.push(`${account}:${handle}`);
      grantCountsByUser.set(account, (grantCountsByUser.get(account) ?? 0) + 1);
    }

    expectedPairs.sort();
    actualPairs.sort();
    expect(actualPairs, "participant-facing prize-credit ACL grant multiset").to.deep.equal(expectedPairs);

    const winnerIndex = credits.findIndex((credit) => credit > 0n);
    expect(winnerIndex, "one decrypted prize-credit winner").to.be.greaterThanOrEqual(0);
    expect(
      credits.filter((credit) => credit > 0n),
      "exactly one non-zero prize credit",
    ).to.have.length(1);

    const winner = fixture.participants[winnerIndex].address.toLowerCase();
    const winnerGrantCount = grantCountsByUser.get(winner) ?? 0;
    const loserGrantCounts = fixture.participants
      .filter((_, index) => index !== winnerIndex)
      .map((user) => grantCountsByUser.get(user.address.toLowerCase()) ?? 0);
    expect(loserGrantCounts.every((count) => count === winnerGrantCount)).to.equal(true);

    writePrivacyEvidence(
      "acl-uniformity",
      {
        status: "PASS",
        proposition: "P-P2",
        sourceTestIdentifiers: [
          "test/privacy/acl-uniformity.t.ts:grants each participant exactly one ACL entry on their own prize-credit handle",
        ],
        command:
          'npx hardhat test test/privacy/acl-uniformity.t.ts --grep "grants each participant exactly one ACL entry"',
        participants: fixture.participants.length,
        grantMultisetExact: true,
        expectedPairs,
        actualPairs,
        winnerIndex,
        winnerGrantCount,
        loserGrantCounts,
      },
      testEvidenceDirectory,
    );
  });
});
