import { expect } from "chai";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  canonicalPrivacyEvidenceDirectory,
  resolvePrivacyEvidenceDirectory,
  resolvePrivacyReportOutput,
  writePrivacyEvidence,
} from "../../scripts/privacy-scan";

describe("privacy evidence output isolation", function () {
  it("requires callers to provide an evidence output directory", function () {
    expect(writePrivacyEvidence.length).to.equal(3);
  });

  it("requires an explicit output directory for test-generated evidence", function () {
    expect(() => resolvePrivacyEvidenceDirectory({ NODE_ENV: "test" })).to.throw(
      "LOK_PRIVACY_EVIDENCE_DIR is required while NODE_ENV=test",
    );
  });

  it("keeps privacy validation read-only unless an output path is explicit", function () {
    expect(resolvePrivacyReportOutput({})).to.equal(undefined);
    expect(resolvePrivacyReportOutput({ LOK_PRIVACY_OUTPUT: "tmp/privacy-report.json" })).to.equal(
      path.resolve("tmp/privacy-report.json"),
    );
  });

  it("writes a test fragment only under the supplied temporary directory", function () {
    const directory = mkdtempSync(path.join(tmpdir(), "lok-privacy-isolation-"));
    const sentinel = path.join(canonicalPrivacyEvidenceDirectory(), "acl-uniformity.json");
    const before = existsSync(sentinel) ? readFileSync(sentinel, "utf8") : undefined;

    try {
      writePrivacyEvidence(
        "acl-uniformity",
        {
          status: "PASS",
          sourceTestIdentifiers: ["privacy-evidence-isolation"],
        },
        directory,
      );

      expect(existsSync(path.join(directory, "acl-uniformity.json"))).to.equal(true);
      expect(existsSync(sentinel) ? readFileSync(sentinel, "utf8") : undefined).to.equal(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
