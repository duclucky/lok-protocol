import { readFileSync } from "node:fs";
import path from "node:path";

import type { Pp1RawLog, Pp1Transcript, SplitArtifact } from "./p-p1-re-review";

type Sample = { executionId: string; winnerIndex: number; transcript: Pp1Transcript };
type FeatureMode = "acl-with-gas" | "acl-no-gas" | "gas-only" | `gas-receipt-${number}`;

const ROOT = path.resolve(__dirname, "..");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts", "privacy", "p-p1-re-review");
const PARTICIPANT_COUNT = 5;
const MAX_CORRECT = 102;
const MAX_WILSON_UPPER_99 = 0.25;

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(ARTIFACT_ROOT, relativePath), "utf8")) as T;
}

function transcriptLogs(transcript: Pp1Transcript): Pp1RawLog[] {
  return transcript.receipts.flatMap((receipt) => receipt.logs);
}

function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function shuffled<T>(values: readonly T[], seed: number): T[] {
  const output = [...values];
  const rand = xorshift32(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = rand() % (index + 1);
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

function oneSidedWilsonUpper(successes: number, trials: number): number {
  const z = 2.3263478740408408;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denominator;
  return center + margin;
}

function permutationPValue(labels: number[], predictions: number[], observedCorrect: number): number {
  let atLeastObserved = 0;
  for (let iteration = 0; iteration < 999; iteration += 1) {
    const permutedLabels = shuffled(labels, 99_001 + iteration);
    let correct = 0;
    for (let index = 0; index < labels.length; index += 1) {
      if (predictions[index] === permutedLabels[index]) correct += 1;
    }
    if (correct >= observedCorrect) atLeastObserved += 1;
  }
  return (atLeastObserved + 1) / 1_000;
}

function aclFeature(log: Pp1RawLog, includeGas: boolean): string[] {
  const output = [
    `emitter:${log.globalLogIndex}:${log.emitterAddress}`,
    `class:${log.globalLogIndex}:${log.emitterClass}`,
    `acl:${log.globalLogIndex}:${log.emitterClass === "acl" ? log.decoded?.eventName : "none"}`,
    `executor:${log.globalLogIndex}:${log.emitterClass === "fhevm-executor" ? log.decoded?.eventName : "none"}`,
    `boundary:${log.receiptIndex}:${log.stepLabel}`,
  ];
  if (includeGas) output.push(`gas:${log.receiptIndex}:${log.gasUsed}`);
  return output;
}

function features(transcript: Pp1Transcript, mode: FeatureMode): string[] {
  if (mode === "gas-only") {
    return transcript.receipts.map((receipt) => `gas:${receipt.receiptIndex}:${receipt.gasUsed}`);
  }
  if (mode.startsWith("gas-receipt-")) {
    const receiptIndex = Number(mode.slice("gas-receipt-".length));
    const receipt = transcript.receipts.find((candidate) => candidate.receiptIndex === receiptIndex);
    return receipt === undefined ? [] : [`gas:${receipt.receiptIndex}:${receipt.gasUsed}`];
  }
  return transcriptLogs(transcript).flatMap((log) => aclFeature(log, mode === "acl-with-gas"));
}

function trainPredictor(training: Sample[], mode: FeatureMode): { predict: (sample: Sample) => number; topFeatures: unknown[] } {
  const labelFeatureCounts = Array.from({ length: PARTICIPANT_COUNT }, () => new Map<string, number>());
  const labelTotals = Array(PARTICIPANT_COUNT).fill(0) as number[];
  const vocabulary = new Set<string>();
  for (const sample of training) {
    const uniqueFeatures = new Set(features(sample.transcript, mode));
    for (const feature of uniqueFeatures) {
      vocabulary.add(feature);
      const counts = labelFeatureCounts[sample.winnerIndex];
      counts.set(feature, (counts.get(feature) ?? 0) + 1);
      labelTotals[sample.winnerIndex] += 1;
    }
  }

  const topFeatures = Array.from({ length: PARTICIPANT_COUNT }, (_, label) => {
    const featuresForLabel = [...labelFeatureCounts[label].entries()]
      .map(([feature, count]) => {
        const otherMax = labelFeatureCounts.reduce(
          (max, counts, otherLabel) => (otherLabel === label ? max : Math.max(max, counts.get(feature) ?? 0)),
          0,
        );
        return { feature, count, otherMax, margin: count - otherMax };
      })
      .sort((a, b) => b.margin - a.margin || b.count - a.count || a.feature.localeCompare(b.feature))
      .slice(0, 8);
    return { label, features: featuresForLabel };
  });

  return {
    predict: (sample: Sample) => {
      const uniqueFeatures = new Set(features(sample.transcript, mode));
      const vocabularySize = Math.max(vocabulary.size, 1);
      const scores = Array(PARTICIPANT_COUNT).fill(0) as number[];
      for (let label = 0; label < PARTICIPANT_COUNT; label += 1) {
        let score = Math.log(1 / PARTICIPANT_COUNT);
        for (const feature of uniqueFeatures) {
          const count = labelFeatureCounts[label].get(feature) ?? 0;
          score += Math.log((count + 1) / (labelTotals[label] + vocabularySize));
        }
        scores[label] = score;
      }
      return scores.reduce((best, score, index) => (score > scores[best] ? index : best), 0);
    },
    topFeatures,
  };
}

function evaluate(training: Sample[], heldOut: Sample[], mode: FeatureMode) {
  const { predict, topFeatures } = trainPredictor(training, mode);
  const confusion = Array.from({ length: PARTICIPANT_COUNT }, () => Array(PARTICIPANT_COUNT).fill(0) as number[]);
  const predictions = heldOut.map((sample) => {
    const prediction = predict(sample);
    confusion[sample.winnerIndex][prediction] += 1;
    return prediction;
  });
  const correct = predictions.filter((prediction, index) => prediction === heldOut[index].winnerIndex).length;
  const wilsonUpper99 = oneSidedWilsonUpper(correct, heldOut.length);
  const permutationPValueResult = permutationPValue(
    heldOut.map((sample) => sample.winnerIndex),
    predictions,
    correct,
  );
  return {
    mode,
    heldOutSamples: heldOut.length,
    correct,
    accuracy: correct / heldOut.length,
    maxCorrect: MAX_CORRECT,
    wilsonUpper99,
    maxWilsonUpper99: MAX_WILSON_UPPER_99,
    permutationPValue: permutationPValueResult,
    status:
      correct <= MAX_CORRECT && wilsonUpper99 <= MAX_WILSON_UPPER_99 && permutationPValueResult >= 0.01
        ? "PASS"
        : "FAIL",
    confusionMatrixRowsActualColumnsPredicted: confusion,
    topPredictiveFeatures: topFeatures,
  };
}

function stats(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const gasDeltaBps = max === 0 ? 0 : Math.floor(((max - min) * 10_000) / max);
  return { count: values.length, min, max, mean, stddev: Math.sqrt(variance), gasDeltaBps };
}

function gasStats(samples: Sample[]) {
  const byReceipt = new Map<string, Array<{ winnerIndex: number; gasUsed: number }>>();
  for (const sample of samples) {
    for (const receipt of sample.transcript.receipts) {
      const key = `${receipt.receiptIndex}:${receipt.stepLabel}`;
      const bucket = byReceipt.get(key) ?? [];
      bucket.push({ winnerIndex: sample.winnerIndex, gasUsed: Number(receipt.gasUsed) });
      byReceipt.set(key, bucket);
    }
  }

  return [...byReceipt.entries()].map(([key, rows]) => {
    const [receiptIndex, stepLabel] = key.split(":");
    const byWinner = Array.from({ length: PARTICIPANT_COUNT }, (_, winnerIndex) => {
      const gas = rows.filter((row) => row.winnerIndex === winnerIndex).map((row) => row.gasUsed);
      return { winnerIndex, ...stats(gas) };
    });
    const all = rows.map((row) => row.gasUsed);
    return { receiptIndex: Number(receiptIndex), stepLabel, overall: stats(all), byWinner };
  });
}

function main() {
  const full = loadJson<{ transcripts: Pp1Transcript[] }>("hardhat-transcripts.json");
  const split = loadJson<SplitArtifact>("split.json");
  const byId = new Map(full.transcripts.map((transcript) => [transcript.executionId, transcript]));
  const sampleFor = (executionId: string): Sample => {
    const transcript = byId.get(executionId);
    if (transcript === undefined) throw new Error(`missing transcript ${executionId}`);
    return { executionId, winnerIndex: transcript.winnerIndex, transcript };
  };
  const training = split.train.map(sampleFor);
  const heldOut = split.heldOut.map(sampleFor);
  const allSamples = full.transcripts.map((transcript) => ({
    executionId: transcript.executionId,
    winnerIndex: transcript.winnerIndex,
    transcript,
  }));

  const receiptModes = full.transcripts[0].receipts.map((receipt) => `gas-receipt-${receipt.receiptIndex}` as const);
  const receiptEvaluations = receiptModes.map((mode) => ({
    ...evaluate(training, heldOut, mode),
    stepLabel: full.transcripts[0].receipts[Number(mode.slice("gas-receipt-".length))].stepLabel,
  }));
  const output = {
    artifactRoot: ARTIFACT_ROOT,
    transcriptCount: full.transcripts.length,
    split: { train: training.length, heldOut: heldOut.length },
    gasByWinnerReceipt: gasStats(allSamples),
    classifiers: {
      aclEmitterCallBoundaryWithGas: evaluate(training, heldOut, "acl-with-gas"),
      gasOnly: evaluate(training, heldOut, "gas-only"),
      aclEmitterCallBoundaryNoGas: evaluate(training, heldOut, "acl-no-gas"),
      gasBySingleReceipt: receiptEvaluations,
    },
    signalIsolation: {
      failingSingleReceiptModes: receiptEvaluations
        .filter((result) => result.status === "FAIL")
        .map(({ mode, stepLabel, correct, accuracy, wilsonUpper99, permutationPValue }) => ({
          mode,
          stepLabel,
          correct,
          accuracy,
          wilsonUpper99,
          permutationPValue,
        })),
      strongestSingleReceiptModes: [...receiptEvaluations]
        .sort((a, b) => b.correct - a.correct)
        .slice(0, 5)
        .map(({ mode, stepLabel, correct, accuracy, status }) => ({ mode, stepLabel, correct, accuracy, status })),
    },
  };
  console.log(JSON.stringify(output, null, 2));
}

main();
