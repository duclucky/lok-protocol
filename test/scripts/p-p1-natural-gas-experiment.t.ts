import { expect } from "chai";

import { parseNaturalGasExperimentOptions } from "../../scripts/p-p1-natural-gas-experiment";

describe("P-P1 natural gas experiment CLI", function () {
  it("accepts --runs as the execution-count alias used by review manifests", function () {
    const options = parseNaturalGasExperimentOptions([
      "--mode",
      "full",
      "--runs",
      "1000",
      "--seed",
      "20260815",
      "--out",
      "artifacts/privacy/p-p1-natural-gas-experiment",
    ]);

    expect(options.mode).to.equal("full");
    expect(options.count).to.equal(1_000);
    expect(options.seed).to.equal(20260815);
    expect(options.outputDirectory).to.match(/p-p1-natural-gas-experiment$/);
  });
});
