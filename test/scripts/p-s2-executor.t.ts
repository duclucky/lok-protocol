import { expect } from "chai";
import path from "node:path";

import {
  assertSharedDeploymentMatches,
  drawSettleAt,
  resolvePS2EvidenceDir,
} from "../../scripts/p-s2-sepolia-groups";

const addresses = {
  underlyingToken: "0x0000000000000000000000000000000000000011",
  confidentialToken: "0x0000000000000000000000000000000000000012",
  wrapper: "0x0000000000000000000000000000000000000012",
  yieldAdapter: "0x0000000000000000000000000000000000000013",
  vault: "0x0000000000000000000000000000000000000014",
  drawManager: "0x0000000000000000000000000000000000000015",
  guardian: null,
} as const;

describe("P-S2 Sepolia executor guards", function () {
  it("uses a caller-selected evidence directory when supplied", function () {
    const root = path.resolve("D:/Lok");
    expect(resolvePS2EvidenceDir(root, "artifacts/sepolia/minimum-timing")).to.equal(
      path.resolve(root, "artifacts/sepolia/minimum-timing"),
    );
  });

  it("rejects a ledger bound to any different shared deployment address", function () {
    expect(() => assertSharedDeploymentMatches(addresses, addresses)).not.to.throw();
    expect(() =>
      assertSharedDeploymentMatches(addresses, {
        ...addresses,
        drawManager: "0x0000000000000000000000000000000000000016",
      }),
    ).to.throw("drawManager");
  });

  it("derives settlement eligibility from the deployed delay", function () {
    expect(drawSettleAt(1_000n, 24n)).to.equal(1_024n);
  });
});
