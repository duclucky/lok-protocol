import { expect } from "chai";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildCampaignConfig, runPp1ReReviewCampaign, type Pp1Transcript } from "../../scripts/p-p1-re-review";

describe("P-P1 re-review campaign harness", function () {
  it("pre-registers the full balanced campaign and freezes a 500/500 split", function () {
    const config = buildCampaignConfig("full", 20260815);

    expect(config.executionCount).to.equal(1_000);
    expect(config.transcriptSource).to.equal("hardhat-fhevm-real");
    expect(config.participantCount).to.equal(5);
    expect(config.executionsPerWinner).to.equal(200);
    expect(config.trainCount).to.equal(500);
    expect(config.heldOutCount).to.equal(500);
    expect(config.observerFamilies).to.deep.equal(["sequence-shape", "byte-ngram", "acl-emitter-call-boundary"]);
    expect(config.mutationModes).to.deep.equal([
      "indexed-topic-bit",
      "data-payload-bit",
      "emitter-call-shape-bit",
      "acl-recipient-asymmetry",
    ]);
  });

  it("writes complete raw transcripts, hashes, split, metrics, and smoke status", async function () {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "lok-p-p1-rr-"));
    try {
      const result = await runPp1ReReviewCampaign({ mode: "smoke", seed: 20260815, outputDirectory });

      expect(result.finalStatus.status).to.equal("REAL_SMOKE_ONLY");
      expect(result.config.transcriptSource).to.equal("hardhat-fhevm-real");
      expect(result.split.train).to.have.length(5);
      expect(result.split.heldOut).to.have.length(5);
      expect(result.transcriptIndex).to.have.length(10);
      expect(result.mutationMetrics.every((metric) => metric.heldOutAccuracy >= 0.95)).to.equal(true);
      expect(result.classifierMetrics.every((metric) => metric.correct <= metric.maxCorrect)).to.equal(true);
      expect(result.classifierMetrics.every((metric) => metric.wilsonUpper99 <= metric.maxWilsonUpper99)).to.equal(
        true,
      );
      expect(result.classifierMetrics.every((metric) => metric.permutationPValue >= 0.01)).to.equal(true);

      const first = result.transcriptIndex[0];
      expect(existsSync(path.join(outputDirectory, first.rawTranscriptPath))).to.equal(true);
      expect(existsSync(path.join(outputDirectory, `${first.rawTranscriptPath}.sha256`))).to.equal(true);
      const transcript = JSON.parse(
        readFileSync(path.join(outputDirectory, first.rawTranscriptPath), "utf8"),
      ) as Pp1Transcript;
      expect(transcript.transcriptSource).to.equal("hardhat-fhevm-real");
      const entry = transcript.receipts[0].logs[0];
      expect(entry).to.include.keys([
        "emitterAddress",
        "topics",
        "data",
        "receiptIndex",
        "logIndex",
        "transactionHash",
        "gasUsed",
        "stepLabel",
        "decoded",
      ]);
      expect(entry.topics).to.have.length.greaterThan(0);
      expect(entry.data).to.match(/^0x[0-9a-f]+$/);

      for (const file of [
        "manifest.json",
        "seed-list.json",
        "split.json",
        "transcript-index.json",
        "classifier-metrics.json",
        "mutation-metrics.json",
        "permutation-tests.json",
        "command-provenance.json",
        "final-status.json",
      ]) {
        expect(existsSync(path.join(outputDirectory, file)), file).to.equal(true);
        expect(existsSync(path.join(outputDirectory, `${file}.sha256`)), `${file}.sha256`).to.equal(true);
      }
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it("never allows synthetic fixture transcripts to produce a full-campaign ready verdict", async function () {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), "lok-p-p1-rr-synth-"));
    try {
      const result = await runPp1ReReviewCampaign({
        mode: "full",
        seed: 20260815,
        outputDirectory,
        transcriptSource: "synthetic-fixture",
      });

      expect(result.config.transcriptSource).to.equal("synthetic-fixture");
      expect(result.finalStatus.status).to.not.equal("READY_FOR_INDEPENDENT_REVIEW");
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
