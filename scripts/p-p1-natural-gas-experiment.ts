import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Pp1RawLog } from "./p-p1-re-review";

type ExperimentMode = "smoke" | "full";
type FeatureMode = "acl-with-gas" | "acl-no-gas" | "gas-only" | `gas-receipt-${number}`;
type Conclusion =
  | "LIKELY_FORCED_HARNESS_ARTIFACT"
  | "LIKELY_PRODUCTION_VISIBLE_GAS_CONCERN"
  | "INCONCLUSIVE_IMBALANCED"
  | "INCONCLUSIVE_OTHER";

export type NaturalPp1Transcript = {
  schemaVersion: 1;
  transcriptSource: "hardhat-fhevm-natural";
  executionId: string;
  seed: number;
  winnerIndex: number;
  participantCount: 5;
  receipts: Array<{
    receiptIndex: number;
    stepLabel: string;
    transactionHash: string;
    gasUsed: string;
    logs: Pp1RawLog[];
  }>;
};

type Sample = { executionId: string; winnerIndex: number; transcript: NaturalPp1Transcript };
type Split = { seed: number; train: string[]; heldOut: string[] };
type ClassifierResult = {
  mode: FeatureMode;
  trainSamples: number;
  heldOutSamples: number;
  correct: number;
  accuracy: number;
  uniformBaselineAccuracy: number;
  majorityBaselineAccuracy: number;
  majorityBaselineCorrect: number;
  materialAdvantageOverMajority: number;
  wilsonUpper99: number | null;
  permutationPValue: number;
  confusionMatrixRowsActualColumnsPredicted: number[][];
  status: "MATERIAL_SIGNAL" | "NO_MATERIAL_SIGNAL";
  topPredictiveFeatures: unknown[];
};

const ROOT = path.resolve(__dirname, "..");
const PARTICIPANT_COUNT = 5;

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").toUpperCase();
}

function writeJsonWithHash(root: string, relativePath: string, value: unknown, hashes: Record<string, string>): void {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(file, text);
  const sha = hashText(text);
  writeFileSync(`${file}.sha256`, `${sha}  ${relativePath.replace(/\\/g, "/")}\n`);
  hashes[relativePath.replace(/\\/g, "/")] = sha;
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

function transcriptLogs(transcript: NaturalPp1Transcript): Pp1RawLog[] {
  return transcript.receipts.flatMap((receipt) => receipt.logs);
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

function features(transcript: NaturalPp1Transcript, mode: FeatureMode): string[] {
  if (mode === "gas-only") return transcript.receipts.map((receipt) => `gas:${receipt.receiptIndex}:${receipt.gasUsed}`);
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

function evaluate(training: Sample[], heldOut: Sample[], mode: FeatureMode): ClassifierResult {
  const { predict, topFeatures } = trainPredictor(training, mode);
  const confusion = Array.from({ length: PARTICIPANT_COUNT }, () => Array(PARTICIPANT_COUNT).fill(0) as number[]);
  const predictions = heldOut.map((sample) => {
    const prediction = predict(sample);
    confusion[sample.winnerIndex][prediction] += 1;
    return prediction;
  });
  const correct = predictions.filter((prediction, index) => prediction === heldOut[index].winnerIndex).length;
  const heldOutDistribution = distribution(heldOut.map((sample) => sample.winnerIndex));
  const majorityBaselineCorrect = Math.max(...heldOutDistribution.counts);
  const majorityBaselineAccuracy = majorityBaselineCorrect / heldOut.length;
  const materialAdvantageOverMajority = correct / heldOut.length - majorityBaselineAccuracy;
  const pValue = permutationPValue(
    heldOut.map((sample) => sample.winnerIndex),
    predictions,
    correct,
  );
  return {
    mode,
    trainSamples: training.length,
    heldOutSamples: heldOut.length,
    correct,
    accuracy: correct / heldOut.length,
    uniformBaselineAccuracy: 1 / PARTICIPANT_COUNT,
    majorityBaselineAccuracy,
    majorityBaselineCorrect,
    materialAdvantageOverMajority,
    wilsonUpper99: balancedEnough(heldOutDistribution) ? oneSidedWilsonUpper(correct, heldOut.length) : null,
    permutationPValue: pValue,
    confusionMatrixRowsActualColumnsPredicted: confusion,
    status: materialAdvantageOverMajority > 0.05 && pValue < 0.01 ? "MATERIAL_SIGNAL" : "NO_MATERIAL_SIGNAL",
    topPredictiveFeatures: topFeatures,
  };
}

function distribution(labels: number[]) {
  const counts = Array(PARTICIPANT_COUNT).fill(0) as number[];
  for (const label of labels) counts[label] += 1;
  const total = labels.length;
  return {
    counts,
    total,
    shares: counts.map((count) => count / total),
    majorityClass: counts.reduce((best, count, index) => (count > counts[best] ? index : best), 0),
    majorityShare: Math.max(...counts) / total,
    missingClasses: counts.map((count, index) => (count === 0 ? index : -1)).filter((index) => index >= 0),
  };
}

function balancedEnough(result: ReturnType<typeof distribution>): boolean {
  return result.missingClasses.length === 0 && result.majorityShare <= 0.4;
}

function buildSplit(seed: number, transcripts: NaturalPp1Transcript[]): Split {
  const ids = shuffled(
    transcripts.map((transcript) => transcript.executionId),
    seed + 404,
  );
  const midpoint = Math.floor(ids.length / 2);
  return { seed, train: ids.slice(0, midpoint), heldOut: ids.slice(midpoint) };
}

function commandProvenance(mode: ExperimentMode, count: number, seed: number, outputDirectory: string, start: string, end: string) {
  const packageJson = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const getPackageVersion = (packageName: string) => {
    const file = path.join(ROOT, "node_modules", packageName, "package.json");
    try {
      return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
    } catch {
      return packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName] ?? "unavailable";
    }
  };
  return {
    command: `npx ts-node scripts/p-p1-natural-gas-experiment.ts --mode ${mode} --runs ${count} --seed ${seed} --out ${outputDirectory}`,
    mode,
    requestedExecutions: count,
    seed,
    startUtc: start,
    endUtc: end,
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    sourceStatusBeforeRun: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "" && !line.slice(3).replaceAll("\\", "/").startsWith("artifacts/"))
      .join("\n")
      .trim(),
    nodeVersion: process.version,
    hardhatVersion: getPackageVersion("hardhat"),
    fhevmHardhatPluginVersion: getPackageVersion("@fhevm/hardhat-plugin"),
    fhevmSolidityVersion: getPackageVersion("@fhevm/solidity"),
  };
}

function collectNaturalTranscripts(input: {
  mode: ExperimentMode;
  count: number;
  seed: number;
  outputDirectory: string;
}): NaturalPp1Transcript[] {
  const collectorOutput = path.join(input.outputDirectory, ".tmp", "collector-natural-transcripts.json");
  mkdirSync(path.dirname(collectorOutput), { recursive: true });
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "cli.js"),
      "test",
      "test/privacy/p-p1-natural-gas-source.t.ts",
      "--grep",
      "collects natural draw transcripts without forced random injection",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        LOK_P_P1_NATURAL_COLLECT: "1",
        LOK_P_P1_NATURAL_MODE: input.mode,
        LOK_P_P1_NATURAL_COUNT: String(input.count),
        LOK_P_P1_NATURAL_SEED: String(input.seed),
        LOK_P_P1_NATURAL_OUTPUT: collectorOutput,
      },
      stdio: "inherit",
    },
  );
  const collected = JSON.parse(readFileSync(collectorOutput, "utf8")) as {
    schemaVersion: 1;
    transcriptSource: "hardhat-fhevm-natural";
    mode: ExperimentMode;
    seed: number;
    transcripts: NaturalPp1Transcript[];
  };
  if (collected.mode !== input.mode || collected.seed !== input.seed) throw new Error("collector output mismatch");
  if (collected.transcripts.length !== input.count) {
    throw new Error(`collector returned ${collected.transcripts.length}, expected ${input.count}`);
  }
  if (collected.transcripts.some((transcript) => transcript.transcriptSource !== "hardhat-fhevm-natural")) {
    throw new Error("collector returned non-natural transcript source");
  }
  return collected.transcripts;
}

function decideConclusion(distributionResult: ReturnType<typeof distribution>, metrics: ClassifierResult[]): Conclusion {
  if (!balancedEnough(distributionResult)) return "INCONCLUSIVE_IMBALANCED";
  const gasMetrics = metrics.filter(
    (metric) => metric.mode === "gas-only" || metric.mode === "acl-with-gas" || metric.mode.startsWith("gas-receipt-"),
  );
  if (gasMetrics.some((metric) => metric.status === "MATERIAL_SIGNAL")) return "LIKELY_PRODUCTION_VISIBLE_GAS_CONCERN";
  return "LIKELY_FORCED_HARNESS_ARTIFACT";
}

export function parseNaturalGasExperimentOptions(argv: string[]) {
  const optionValue = (name: string, fallback: string) => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
  };
  const mode = optionValue("--mode", "smoke") as ExperimentMode;
  if (mode !== "smoke" && mode !== "full") throw new Error("--mode must be smoke or full");
  const seed = Number(optionValue("--seed", "20260815"));
  const defaultCount = mode === "smoke" ? 50 : 500;
  const count = Number(optionValue("--runs", optionValue("--count", String(defaultCount))));
  if (!Number.isInteger(count) || count < 1) throw new Error("--runs/--count must be a positive integer");
  const outputDirectory = path.resolve(optionValue("--out", path.join("artifacts", "privacy", "p-p1-natural-gas-experiment")));
  return { mode, seed, count, outputDirectory };
}

async function main() {
  const options = parseNaturalGasExperimentOptions(process.argv);
  const startMs = Date.now();
  const startUtc = new Date(startMs).toISOString();
  const hashes: Record<string, string> = {};
  const manifest = {
    schemaVersion: 1,
    mode: options.mode,
    transcriptSource: "hardhat-fhevm-natural",
    forcedWinnerHarness: false,
    usesHardhatSetStorageAt: false,
    participantCount: PARTICIPANT_COUNT,
    executionCount: options.count,
    seed: options.seed,
    fullModeDefaultCount: 500,
    previousForcedCampaignArtifactRoot: "artifacts/privacy/p-p1-re-review",
  };
  writeJsonWithHash(options.outputDirectory, "manifest.json", manifest, hashes);
  const transcripts = collectNaturalTranscripts(options);
  writeJsonWithHash(
    options.outputDirectory,
    "collector-natural-transcripts.json",
    {
      schemaVersion: 1,
      transcriptSource: "hardhat-fhevm-natural",
      mode: options.mode,
      seed: options.seed,
      transcripts,
    },
    hashes,
  );
  const split = buildSplit(options.seed, transcripts);
  const byId = new Map(transcripts.map((transcript) => [transcript.executionId, transcript]));
  const samples = transcripts.map((transcript) => ({
    executionId: transcript.executionId,
    winnerIndex: transcript.winnerIndex,
    transcript,
  }));
  const train = split.train.map((executionId) => {
    const transcript = byId.get(executionId);
    if (transcript === undefined) throw new Error(`missing train transcript ${executionId}`);
    return { executionId, winnerIndex: transcript.winnerIndex, transcript };
  });
  const heldOut = split.heldOut.map((executionId) => {
    const transcript = byId.get(executionId);
    if (transcript === undefined) throw new Error(`missing held-out transcript ${executionId}`);
    return { executionId, winnerIndex: transcript.winnerIndex, transcript };
  });
  const transcriptIndex = transcripts.map((transcript) => {
    const rawTranscriptPath = path.join("raw-transcripts", `${transcript.executionId}.json`).replace(/\\/g, "/");
    writeJsonWithHash(options.outputDirectory, rawTranscriptPath, transcript, hashes);
    return {
      executionId: transcript.executionId,
      seed: transcript.seed,
      winnerIndex: transcript.winnerIndex,
      rawTranscriptPath,
      transcriptSha256: hashes[rawTranscriptPath],
      split: split.train.includes(transcript.executionId) ? "train" : "held-out",
    };
  });
  writeJsonWithHash(options.outputDirectory, "transcripts.json", { schemaVersion: 1, transcripts }, hashes);
  writeJsonWithHash(options.outputDirectory, "transcript-index.json", transcriptIndex, hashes);
  writeJsonWithHash(options.outputDirectory, "split.json", split, hashes);

  const winnerDistribution = {
    all: distribution(samples.map((sample) => sample.winnerIndex)),
    train: distribution(train.map((sample) => sample.winnerIndex)),
    heldOut: distribution(heldOut.map((sample) => sample.winnerIndex)),
  };
  writeJsonWithHash(options.outputDirectory, "winner-distribution.json", winnerDistribution, hashes);

  const lastReceipt = transcripts[0].receipts.at(-1);
  if (lastReceipt === undefined) throw new Error("empty transcript receipts");
  const classifierModes: FeatureMode[] = [
    "gas-only",
    "acl-with-gas",
    "acl-no-gas",
    "gas-receipt-7",
    `gas-receipt-${lastReceipt.receiptIndex}`,
  ];
  const classifierMetrics = classifierModes.map((mode) => evaluate(train, heldOut, mode));
  writeJsonWithHash(options.outputDirectory, "gas-classifier-metrics.json", classifierMetrics, hashes);
  writeJsonWithHash(
    options.outputDirectory,
    "confusion-matrices.json",
    classifierMetrics.map(({ mode, confusionMatrixRowsActualColumnsPredicted }) => ({
      mode,
      confusionMatrixRowsActualColumnsPredicted,
    })),
    hashes,
  );

  const endMs = Date.now();
  const endUtc = new Date(endMs).toISOString();
  const provenance = commandProvenance(options.mode, options.count, options.seed, options.outputDirectory, startUtc, endUtc);
  writeJsonWithHash(options.outputDirectory, "command-provenance.json", provenance, hashes);
  const runtimeSeconds = (endMs - startMs) / 1_000;
  const conclusion = decideConclusion(winnerDistribution.all, classifierMetrics);
  const finalStatus = {
    schemaVersion: 1,
    status: options.mode === "smoke" ? "SMOKE_ONLY" : "FULL_RUN",
    conclusion,
    runtimeSeconds,
    sampleCount: transcripts.length,
    runtimeEstimateSeconds: {
      fiveHundred: (runtimeSeconds / transcripts.length) * 500,
      oneThousand: (runtimeSeconds / transcripts.length) * 1_000,
    },
    productionContractsChanged: false,
    docs10ProofStrategyChanged: false,
    frozenPp1Verdict: "WEAKER-THAN-CLAIMED",
    note:
      "This experiment uses natural local Hardhat/FHEVM randomness and labels the winner only after settlement. It does not claim P-P1 MATCHES.",
  };
  writeJsonWithHash(options.outputDirectory, "final-status.json", finalStatus, hashes);
  writeJsonWithHash(options.outputDirectory, "artifact-hashes.json", { ...hashes }, hashes);
  console.log(
    JSON.stringify(
      {
        artifactDirectory: options.outputDirectory,
        sampleCount: transcripts.length,
        winnerDistribution: winnerDistribution.all,
        classifierMetrics,
        finalStatus,
      },
      null,
      2,
    ),
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  });
}
