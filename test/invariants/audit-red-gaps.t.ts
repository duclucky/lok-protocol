import { expect } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("audit harness integrity for RED findings", function () {
  it("includes real settlement in the high-count safety selector campaign", function () {
    const invariant = source("test-foundry/invariants/LokSafetyInvariant.t.sol");
    const handler = source("test-foundry/handlers/LokHandler.sol");

    expect(handler).to.include("function settleDraw(");
    expect(invariant).to.include("handler.settleDraw.selector");
  });

  it("derives P-P2 winner independence from the complete prize-credit grant multiset", function () {
    const aclTest = source("test/privacy/acl-uniformity.t.ts");

    expect(aclTest).to.include("grantMultisetExact");
    expect(aclTest).to.include("winnerGrantCount");
    expect(aclTest).to.include("loserGrantCounts");
    expect(aclTest).to.not.include("winnerIndependent: true");
  });

  it("compares complete winner-vs-every-loser raw and parsed log fields for P-P1", function () {
    const logTest = source("test/privacy/log-indistinguishability.t.ts");

    expect(logTest).to.include("compareUserLogSlices");
    expect(logTest).to.include("topics");
    expect(logTest).to.include("data");
    expect(logTest).to.include("comparedLoserIndices");
    expect(logTest).to.not.include("opaqueLogShape(winnerReceipt.logs)");
  });
});
