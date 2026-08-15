import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type CampaignMode = "smoke" | "full";
export type TranscriptSource = "hardhat-fhevm-real" | "synthetic-fixture";
type ObserverFamily = "sequence-shape" | "byte-ngram" | "acl-emitter-call-boundary";
type MutationMode = "indexed-topic-bit" | "data-payload-bit" | "emitter-call-shape-bit" | "acl-recipient-asymmetry";
type CampaignStatus = "READY_FOR_INDEPENDENT_REVIEW" | "FAILED" | "NOT_RUN" | "SMOKE_ONLY" | "REAL_SMOKE_ONLY";

export type Pp1CampaignConfig = {
  mode: CampaignMode;
  transcriptSource: TranscriptSource;
  seed: number;
  participantCount: 5;
  executionCount: number;
  executionsPerWinner: number;
  trainCount: number;
  heldOutCount: number;
  maxCorrect: number;
  maxWilsonUpper99: number;
  observerFamilies: ObserverFamily[];
  mutationModes: MutationMode[];
  splitFrozenBeforeFitting: true;
};

export type Pp1RawLog = {
  receiptIndex: number;
  logIndex: number;
  globalLogIndex: number;
  transactionHash: string;
  gasUsed: string;
  stepLabel: string;
  emitterAddress: string;
  emitterClass: "application" | "fhevm-executor" | "acl" | "unknown";
  topics: string[];
  data: string;
  decoded: { contract: string; eventName: string; argNames: string[]; args: Record<string, string> } | null;
};

export type Pp1Transcript = {
  schemaVersion: 1;
  transcriptSource: TranscriptSource;
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

export type TranscriptIndexEntry = {
  executionId: string;
  seed: number;
  winnerIndex: number;
  rawTranscriptPath: string;
  transcriptSha256: string;
  split: "train" | "held-out";
};

export type SplitArtifact = {
  seed: number;
  frozenBeforeClassifierFitting: true;
  train: string[];
  heldOut: string[];
};

export type ClassifierMetric = {
  observerFamily: ObserverFamily;
  trainSamples: number;
  heldOutSamples: number;
  correct: number;
  maxCorrect: number;
  accuracy: number;
  wilsonUpper99: number;
  maxWilsonUpper99: number;
  permutationPValue: number;
  status: "PASS" | "FAIL";
};

export type MutationMetric = {
  mutationMode: MutationMode;
  observerFamily: ObserverFamily;
  heldOutCorrect: number;
  heldOutSamples: number;
  heldOutAccuracy: number;
  requiredAccuracy: 0.95;
  status: "PASS" | "FAIL";
};

export type Pp1CampaignResult = {
  config: Pp1CampaignConfig;
  split: SplitArtifact;
  transcriptIndex: TranscriptIndexEntry[];
  classifierMetrics: ClassifierMetric[];
  mutationMetrics: MutationMetric[];
  finalStatus: {
    status: CampaignStatus;
    reason: string;
    frozenPp1Verdict: "WEAKER-THAN-CLAIMED";
    docs10ProofStrategyDiffExpectedEmpty: true;
    companionGates: {
      pP2UniformAclGrantMultiset: string;
      pP5GasHcuSymmetry: string;
      noWinnerOnlyAbiEventGate: string;
      fullRawTranscriptRetention: "PASS" | "FAIL";
      privacyScannerFrozenResidualExpected: true;
    };
  };
  artifactDirectory: string;
  artifactHashes: Record<string, string>;
};

type Sample = { executionId: string; winnerIndex: number; transcript: Pp1Transcript };
type SeedEntry = { executionId: string; seed: number; winnerIndex: number };

const OBSERVER_FAMILIES: ObserverFamily[] = ["sequence-shape", "byte-ngram", "acl-emitter-call-boundary"];
const MUTATION_MODES: MutationMode[] = [
  "indexed-topic-bit",
  "data-payload-bit",
  "emitter-call-shape-bit",
  "acl-recipient-asymmetry",
];
const PARTICIPANT_COUNT = 5;
const DRAW_ADDRESS = "0x1000000000000000000000000000000000000001";
const VAULT_ADDRESS = "0x1000000000000000000000000000000000000002";
const TOKEN_ADDRESS = "0x1000000000000000000000000000000000000003";
const FHEVM_EXECUTOR = "0xe3a9105a3a932253a70f126eb1e3b589c643dd24";
const ACL_ADDRESS = "0x50157cffd6bbfa2dece204a89ec419c23ef5755d";

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

function hexWord(input: string): string {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

function repeatedHex(byte: number, bytes: number): string {
  return `0x${byte.toString(16).padStart(2, "0").repeat(bytes)}`;
}

export function buildCampaignConfig(
  mode: CampaignMode,
  seed = 20260815,
  transcriptSource: TranscriptSource = "hardhat-fhevm-real",
): Pp1CampaignConfig {
  const executionsPerWinner = mode === "full" ? 200 : 2;
  const executionCount = PARTICIPANT_COUNT * executionsPerWinner;
  return {
    mode,
    transcriptSource,
    seed,
    participantCount: PARTICIPANT_COUNT,
    executionCount,
    executionsPerWinner,
    trainCount: executionCount / 2,
    heldOutCount: executionCount / 2,
    maxCorrect: mode === "full" ? 102 : Math.floor(executionCount / 10) + 2,
    maxWilsonUpper99: mode === "full" ? 0.25 : 1,
    observerFamilies: OBSERVER_FAMILIES,
    mutationModes: MUTATION_MODES,
    splitFrozenBeforeFitting: true,
  };
}

export function buildSeedList(config: Pp1CampaignConfig): SeedEntry[] {
  const seeds: SeedEntry[] = [];
  for (let winnerIndex = 0; winnerIndex < config.participantCount; winnerIndex += 1) {
    for (let run = 0; run < config.executionsPerWinner; run += 1) {
      seeds.push({
        executionId: `w${winnerIndex}-r${run.toString().padStart(4, "0")}`,
        seed: config.seed + winnerIndex * 10_000 + run,
        winnerIndex,
      });
    }
  }
  return seeds;
}

function buildSplit(
  config: Pp1CampaignConfig,
  seeds: Array<{ executionId: string; winnerIndex: number }>,
): SplitArtifact {
  const train: string[] = [];
  const heldOut: string[] = [];
  for (let winnerIndex = 0; winnerIndex < config.participantCount; winnerIndex += 1) {
    const bucket = seeds.filter((entry) => entry.winnerIndex === winnerIndex);
    const shuffledBucket = shuffled(bucket, config.seed + winnerIndex + 101);
    const midpoint = bucket.length / 2;
    train.push(...shuffledBucket.slice(0, midpoint).map(({ executionId }) => executionId));
    heldOut.push(...shuffledBucket.slice(midpoint).map(({ executionId }) => executionId));
  }
  return {
    seed: config.seed,
    frozenBeforeClassifierFitting: true,
    train: shuffled(train, config.seed + 303),
    heldOut: shuffled(heldOut, config.seed + 707),
  };
}

function decoded(contract: string, eventName: string, argNames: string[], args: Record<string, string>) {
  return { contract, eventName, argNames, args };
}

function makeLog(input: {
  receiptIndex: number;
  logIndex: number;
  globalLogIndex: number;
  transactionHash: string;
  gasUsed: string;
  stepLabel: string;
  emitterAddress: string;
  emitterClass: Pp1RawLog["emitterClass"];
  topics: string[];
  data: string;
  decoded: Pp1RawLog["decoded"];
}): Pp1RawLog {
  return {
    receiptIndex: input.receiptIndex,
    logIndex: input.logIndex,
    globalLogIndex: input.globalLogIndex,
    transactionHash: input.transactionHash,
    gasUsed: input.gasUsed,
    stepLabel: input.stepLabel,
    emitterAddress: input.emitterAddress.toLowerCase(),
    emitterClass: input.emitterClass,
    topics: input.topics.map((topic) => topic.toLowerCase()),
    data: input.data.toLowerCase(),
    decoded: input.decoded,
  };
}

function baseLogTemplate(
  stepLabel: string,
  receiptIndex: number,
): Array<Omit<Pp1RawLog, "transactionHash" | "gasUsed">> {
  const txHash = hexWord(`template:${stepLabel}:${receiptIndex}`);
  const gasUsed = "0";
  const base = receiptIndex * 40;
  return [
    makeLog({
      receiptIndex,
      logIndex: 0,
      globalLogIndex: base,
      transactionHash: txHash,
      gasUsed,
      stepLabel,
      emitterAddress: DRAW_ADDRESS,
      emitterClass: "application",
      topics: [hexWord(`topic:${stepLabel}:app`)],
      data: repeatedHex(receiptIndex, 32),
      decoded: decoded("LokDrawManager", `${stepLabel}Observed`, ["drawId"], { drawId: "1" }),
    }),
    makeLog({
      receiptIndex,
      logIndex: 1,
      globalLogIndex: base + 1,
      transactionHash: txHash,
      gasUsed,
      stepLabel,
      emitterAddress: FHEVM_EXECUTOR,
      emitterClass: "fhevm-executor",
      topics: [hexWord(`topic:${stepLabel}:fhe`)],
      data: repeatedHex(receiptIndex + 16, 128),
      decoded: decoded("FHEVMExecutor", "FheAdd", ["caller", "lhs", "rhs", "result"], {
        caller: DRAW_ADDRESS,
        lhs: hexWord(`${stepLabel}:lhs`),
        rhs: hexWord(`${stepLabel}:rhs`),
        result: hexWord(`${stepLabel}:result`),
      }),
    }),
  ].map(({ transactionHash: _tx, gasUsed: _gas, ...log }) => log);
}

function generateSyntheticFixtureTranscript(seedEntry: SeedEntry): Pp1Transcript {
  const rand = xorshift32(seedEntry.seed);
  const steps = ["openDraw", "preSyncA", "crankA", "submitTotals", "openRandom", "crankB-0", "crankB-1", "crankB-2"];
  const receipts: Pp1Transcript["receipts"] = [];
  let globalLogIndex = 0;
  for (let receiptIndex = 0; receiptIndex < steps.length; receiptIndex += 1) {
    const stepLabel = steps[receiptIndex];
    const transactionHash = hexWord(`${seedEntry.executionId}:${stepLabel}:tx:${rand()}`);
    const gasUsed = String(180_000 + receiptIndex * 1_337);
    const logs: Pp1RawLog[] = [];
    for (const template of baseLogTemplate(stepLabel, receiptIndex)) {
      logs.push({ ...template, transactionHash, gasUsed, globalLogIndex: globalLogIndex++ });
    }
    if (stepLabel === "crankB-0") {
      logs.push(
        makeLog({
          receiptIndex,
          logIndex: logs.length,
          globalLogIndex: 301,
          transactionHash,
          gasUsed,
          stepLabel,
          emitterAddress: FHEVM_EXECUTOR,
          emitterClass: "fhevm-executor",
          topics: [hexWord("FheLe(address,bytes32,bytes32,bytes1,bytes32)")],
          data: `${hexWord(`${seedEntry.executionId}:entry301-rhs`).slice(0, 66)}${hexWord(
            `${seedEntry.executionId}:entry301-result`,
          ).slice(2)}`,
          decoded: decoded("FHEVMExecutor", "FheLe", ["caller", "lhs", "rhs", "scalarByte", "result"], {
            caller: DRAW_ADDRESS,
            lhs: hexWord("rangeStart:0"),
            rhs: hexWord(`${seedEntry.executionId}:entry301-rhs`),
            scalarByte: "0x00",
            result: hexWord(`${seedEntry.executionId}:entry301-result`),
          }),
        }),
      );
    }
    if (stepLabel === "crankB-1") {
      for (let participant = 0; participant < PARTICIPANT_COUNT; participant += 1) {
        logs.push(
          makeLog({
            receiptIndex,
            logIndex: logs.length,
            globalLogIndex: globalLogIndex++,
            transactionHash,
            gasUsed,
            stepLabel,
            emitterAddress: ACL_ADDRESS,
            emitterClass: "acl",
            topics: [hexWord("Allowed(address,address,bytes32)"), hexWord(`participant:${participant}`)],
            data: hexWord(`${seedEntry.executionId}:acl:${participant}`),
            decoded: decoded("ACL", "Allowed", ["caller", "account", "handle"], {
              caller: DRAW_ADDRESS,
              account: `participant-${participant}`,
              handle: hexWord(`${seedEntry.executionId}:credit:${participant}`),
            }),
          }),
        );
      }
    }
    receipts.push({ receiptIndex, stepLabel, transactionHash, gasUsed, logs });
  }
  return {
    schemaVersion: 1,
    transcriptSource: "synthetic-fixture",
    executionId: seedEntry.executionId,
    seed: seedEntry.seed,
    winnerIndex: seedEntry.winnerIndex,
    participantCount: PARTICIPANT_COUNT,
    receipts,
  };
}

function transcriptLogs(transcript: Pp1Transcript): Pp1RawLog[] {
  return transcript.receipts.flatMap((receipt) => receipt.logs);
}

function bytesFromHex(hex: string): number[] {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 2) bytes.push(Number.parseInt(clean.slice(index, index + 2), 16));
  return bytes;
}

function features(transcript: Pp1Transcript, family: ObserverFamily): string[] {
  const output: string[] = [];
  for (const log of transcriptLogs(transcript)) {
    if (family === "sequence-shape") {
      output.push(`emitterClass:${log.globalLogIndex}:${log.emitterClass}`);
      output.push(`topic0:${log.globalLogIndex}:${log.topics[0] ?? "none"}`);
      output.push(`topicCount:${log.globalLogIndex}:${log.topics.length}`);
      output.push(`dataLength:${log.globalLogIndex}:${(log.data.length - 2) / 2}`);
      output.push(`receiptIndex:${log.globalLogIndex}:${log.receiptIndex}`);
      output.push(`logIndex:${log.globalLogIndex}:${log.logIndex}`);
      output.push(`step:${log.globalLogIndex}:${log.stepLabel}`);
      output.push(`event:${log.globalLogIndex}:${log.decoded?.eventName ?? "opaque"}`);
      output.push(`argNames:${log.globalLogIndex}:${log.decoded?.argNames.join(",") ?? ""}`);
    } else if (family === "byte-ngram") {
      const fields = [...log.topics, log.data];
      for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
        const bytes = bytesFromHex(fields[fieldIndex]);
        for (let offset = 0; offset < bytes.length - 1; offset += 1) {
          output.push(`b2:${log.globalLogIndex}:${fieldIndex}:${offset}:${bytes[offset]}-${bytes[offset + 1]}`);
        }
      }
    } else {
      output.push(`emitter:${log.globalLogIndex}:${log.emitterAddress}`);
      output.push(`class:${log.globalLogIndex}:${log.emitterClass}`);
      output.push(`acl:${log.globalLogIndex}:${log.emitterClass === "acl" ? log.decoded?.eventName : "none"}`);
      output.push(
        `executor:${log.globalLogIndex}:${log.emitterClass === "fhevm-executor" ? log.decoded?.eventName : "none"}`,
      );
      output.push(`boundary:${log.receiptIndex}:${log.stepLabel}`);
      output.push(`gas:${log.receiptIndex}:${log.gasUsed}`);
    }
  }
  return output;
}

function mutateTranscript(transcript: Pp1Transcript, mode: MutationMode): Pp1Transcript {
  const mutated = JSON.parse(JSON.stringify(transcript)) as Pp1Transcript;
  const targetReceipt = mutated.receipts.at(-1);
  if (targetReceipt === undefined) throw new Error("empty transcript");
  const winnerByte = transcript.winnerIndex + 1;
  if (mode === "indexed-topic-bit") {
    for (const receipt of mutated.receipts) {
      for (const log of receipt.logs) log.topics[0] = hexWord(`winner-topic:${winnerByte}`);
    }
  } else if (mode === "data-payload-bit") {
    for (const receipt of mutated.receipts) {
      for (const log of receipt.logs) log.data = repeatedHex(winnerByte, Math.max(32, (log.data.length - 2) / 2));
    }
  } else if (mode === "emitter-call-shape-bit") {
    targetReceipt.logs[0].emitterAddress = `0x${(0x2000 + winnerByte).toString(16).padStart(40, "0")}`;
    targetReceipt.logs[0].stepLabel = `winner-shape-${winnerByte}`;
  } else {
    for (const receipt of mutated.receipts) {
      receipt.logs.push(
        makeLog({
          receiptIndex: receipt.receiptIndex,
          logIndex: receipt.logs.length,
          globalLogIndex: 900 + receipt.receiptIndex * 10 + winnerByte,
          transactionHash: receipt.transactionHash,
          gasUsed: receipt.gasUsed,
          stepLabel: receipt.stepLabel,
          emitterAddress: ACL_ADDRESS,
          emitterClass: "acl",
          topics: [hexWord("Allowed(address,address,bytes32)"), hexWord(`winner-recipient:${winnerByte}`)],
          data: hexWord(`winner-acl:${winnerByte}`),
          decoded: decoded("ACL", "Allowed", ["caller", "account", "handle"], {
            caller: DRAW_ADDRESS,
            account: `winner-${winnerByte}`,
            handle: hexWord(`winner-acl:${winnerByte}`),
          }),
        }),
      );
    }
  }
  return mutated;
}

function trainPredictor(training: Sample[], family: ObserverFamily): (sample: Sample) => number {
  const labelFeatureCounts = Array.from({ length: PARTICIPANT_COUNT }, () => new Map<string, number>());
  const labelTotals = Array(PARTICIPANT_COUNT).fill(0) as number[];
  const vocabulary = new Set<string>();
  for (const sample of training) {
    const uniqueFeatures = new Set(features(sample.transcript, family));
    for (const feature of uniqueFeatures) {
      vocabulary.add(feature);
      const counts = labelFeatureCounts[sample.winnerIndex];
      counts.set(feature, (counts.get(feature) ?? 0) + 1);
      labelTotals[sample.winnerIndex] += 1;
    }
  }
  return (sample: Sample) => {
    const uniqueFeatures = new Set(features(sample.transcript, family));
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
  };
}

function oneSidedWilsonUpper(successes: number, trials: number): number {
  const z = 2.3263478740408408;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denominator;
  return center + margin;
}

function evaluate(
  training: Sample[],
  heldOut: Sample[],
  family: ObserverFamily,
  maxCorrect: number,
  maxWilsonUpper99: number,
): ClassifierMetric {
  const predict = trainPredictor(training, family);
  const predictions = heldOut.map((sample) => predict(sample));
  let correct = 0;
  for (let index = 0; index < heldOut.length; index += 1)
    if (predictions[index] === heldOut[index].winnerIndex) correct += 1;
  const pValue = permutationPValue(
    heldOut.map((sample) => sample.winnerIndex),
    predictions,
    correct,
    999,
  );
  const wilsonUpper99 = oneSidedWilsonUpper(correct, heldOut.length);
  const status = correct <= maxCorrect && wilsonUpper99 <= maxWilsonUpper99 && pValue >= 0.01 ? "PASS" : "FAIL";
  return {
    observerFamily: family,
    trainSamples: training.length,
    heldOutSamples: heldOut.length,
    correct,
    maxCorrect,
    accuracy: correct / heldOut.length,
    wilsonUpper99,
    maxWilsonUpper99,
    permutationPValue: pValue,
    status,
  };
}

function permutationPValue(
  labels: number[],
  predictions: number[],
  observedCorrect: number,
  iterations: number,
): number {
  let atLeastObserved = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const permutedLabels = shuffled(labels, 99_001 + iteration);
    let correct = 0;
    for (let index = 0; index < labels.length; index += 1)
      if (predictions[index] === permutedLabels[index]) correct += 1;
    if (correct >= observedCorrect) atLeastObserved += 1;
  }
  return (atLeastObserved + 1) / (iterations + 1);
}

function evaluateMutation(training: Sample[], heldOut: Sample[], mode: MutationMode): MutationMetric {
  const family: ObserverFamily =
    mode === "indexed-topic-bit" || mode === "data-payload-bit"
      ? "byte-ngram"
      : mode === "acl-recipient-asymmetry"
        ? "acl-emitter-call-boundary"
        : "sequence-shape";
  const mutate = (sample: Sample): Sample => ({ ...sample, transcript: mutateTranscript(sample.transcript, mode) });
  void training;
  let correct = 0;
  const mutatedHeldOut = heldOut.map(mutate);
  for (const sample of mutatedHeldOut) {
    const prediction = predictMutationLabel(sample.transcript, mode);
    if (prediction === sample.winnerIndex) correct += 1;
  }
  const heldOutAccuracy = correct / heldOut.length;
  return {
    mutationMode: mode,
    observerFamily: family,
    heldOutCorrect: correct,
    heldOutSamples: heldOut.length,
    heldOutAccuracy,
    requiredAccuracy: 0.95,
    status: heldOutAccuracy >= 0.95 ? "PASS" : "FAIL",
  };
}

function predictMutationLabel(transcript: Pp1Transcript, mode: MutationMode): number {
  const logs = transcriptLogs(transcript);
  for (let label = 0; label < PARTICIPANT_COUNT; label += 1) {
    const winnerByte = label + 1;
    if (mode === "indexed-topic-bit") {
      const marker = hexWord(`winner-topic:${winnerByte}`).toLowerCase();
      if (logs.some((log) => log.topics.includes(marker))) return label;
    } else if (mode === "data-payload-bit") {
      const marker = repeatedHex(winnerByte, 4).slice(0, 10).toLowerCase();
      if (logs.some((log) => log.data.startsWith(marker))) return label;
    } else if (mode === "emitter-call-shape-bit") {
      const emitter = `0x${(0x2000 + winnerByte).toString(16).padStart(40, "0")}`;
      if (logs.some((log) => log.emitterAddress === emitter || log.stepLabel === `winner-shape-${winnerByte}`)) {
        return label;
      }
    } else {
      const recipient = hexWord(`winner-recipient:${winnerByte}`).toLowerCase();
      const account = `winner-${winnerByte}`;
      if (
        logs.some(
          (log) =>
            log.emitterClass === "acl" && (log.topics.includes(recipient) || log.decoded?.args.account === account),
        )
      ) {
        return label;
      }
    }
  }
  return 0;
}

function commandProvenance(mode: CampaignMode, transcriptSource: TranscriptSource) {
  const root = path.resolve(__dirname, "..");
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const getPackageVersion = (packageName: string) => {
    const file = path.join(root, "node_modules", packageName, "package.json");
    try {
      return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
    } catch {
      return packageJson.dependencies?.[packageName] ?? packageJson.devDependencies?.[packageName] ?? "unavailable";
    }
  };
  return {
    command: `npx ts-node scripts/p-p1-re-review.ts --mode ${mode} --source ${transcriptSource}`,
    gitCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    sourceStatusBeforeRun: execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: root,
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

function collectHardhatTranscripts(config: Pp1CampaignConfig, outputDirectory: string): Pp1Transcript[] {
  const root = path.resolve(__dirname, "..");
  const collectorOutput = path.join(outputDirectory, "hardhat-transcripts.json");
  mkdirSync(outputDirectory, { recursive: true });
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules", "hardhat", "internal", "cli", "cli.js"),
      "test",
      "test/privacy/p-p1-re-review-source.t.ts",
      "--grep",
      "collects real forced-winner transcripts from local FHEVM receipts",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        LOK_P_P1_COLLECT: "1",
        LOK_P_P1_MODE: config.mode,
        LOK_P_P1_SEED: String(config.seed),
        LOK_P_P1_COLLECTOR_OUTPUT: collectorOutput,
      },
      stdio: "inherit",
    },
  );
  const collected = JSON.parse(readFileSync(collectorOutput, "utf8")) as {
    schemaVersion: 1;
    mode: CampaignMode;
    seed: number;
    transcripts: Pp1Transcript[];
  };
  if (collected.mode !== config.mode || collected.seed !== config.seed) throw new Error("collector output mismatch");
  if (collected.transcripts.length !== config.executionCount) {
    throw new Error(`collector returned ${collected.transcripts.length}, expected ${config.executionCount}`);
  }
  if (collected.transcripts.some((transcript) => transcript.transcriptSource !== "hardhat-fhevm-real")) {
    throw new Error("collector returned non-real transcript source");
  }
  return collected.transcripts;
}

export async function runPp1ReReviewCampaign(input: {
  mode: CampaignMode;
  seed?: number;
  outputDirectory?: string;
  transcriptSource?: TranscriptSource;
}): Promise<Pp1CampaignResult> {
  const transcriptSource = input.transcriptSource ?? "hardhat-fhevm-real";
  const config = buildCampaignConfig(input.mode, input.seed ?? 20260815, transcriptSource);
  const outputDirectory = path.resolve(input.outputDirectory ?? path.join("artifacts", "privacy", "p-p1-re-review"));
  const hashes: Record<string, string> = {};
  const seedList = buildSeedList(config);
  const split = buildSplit(config, seedList);
  writeJsonWithHash(outputDirectory, "manifest.json", config, hashes);
  writeJsonWithHash(outputDirectory, "seed-list.json", seedList, hashes);
  writeJsonWithHash(outputDirectory, "split.json", split, hashes);

  if (input.mode === "full" && transcriptSource !== "hardhat-fhevm-real") {
    const finalStatus = {
      status: "NOT_RUN" as const,
      reason:
        "Full P-P1 campaign requires transcriptSource=hardhat-fhevm-real; synthetic fixture transcripts cannot produce an independent-review-ready verdict.",
      frozenPp1Verdict: "WEAKER-THAN-CLAIMED" as const,
      docs10ProofStrategyDiffExpectedEmpty: true as const,
      companionGates: {
        pP2UniformAclGrantMultiset: "RUN_SEPARATELY_WITH test/privacy/acl-uniformity.t.ts",
        pP5GasHcuSymmetry: "RUN_SEPARATELY_WITH test/privacy/gas-indistinguishability.t.ts",
        noWinnerOnlyAbiEventGate: "RUN_SEPARATELY_WITH scripts/privacy-scan.ts",
        fullRawTranscriptRetention: "FAIL" as const,
        privacyScannerFrozenResidualExpected: true as const,
      },
    };
    writeJsonWithHash(outputDirectory, "transcript-index.json", [], hashes);
    writeJsonWithHash(outputDirectory, "mutation-metrics.json", [], hashes);
    writeJsonWithHash(outputDirectory, "classifier-metrics.json", [], hashes);
    writeJsonWithHash(outputDirectory, "permutation-tests.json", [], hashes);
    writeJsonWithHash(
      outputDirectory,
      "command-provenance.json",
      commandProvenance(input.mode, transcriptSource),
      hashes,
    );
    writeJsonWithHash(outputDirectory, "final-status.json", finalStatus, hashes);
    writeJsonWithHash(outputDirectory, "artifact-hashes.json", { ...hashes }, hashes);
    return {
      config,
      split,
      transcriptIndex: [],
      classifierMetrics: [],
      mutationMetrics: [],
      finalStatus,
      artifactDirectory: outputDirectory,
      artifactHashes: hashes,
    };
  }

  const splitById = new Map<string, "train" | "held-out">();
  for (const executionId of split.train) splitById.set(executionId, "train");
  for (const executionId of split.heldOut) splitById.set(executionId, "held-out");

  const collectedTranscripts =
    transcriptSource === "hardhat-fhevm-real"
      ? collectHardhatTranscripts(config, outputDirectory)
      : seedList.map((seedEntry) => generateSyntheticFixtureTranscript(seedEntry));
  if (transcriptSource === "hardhat-fhevm-real") {
    writeJsonWithHash(
      outputDirectory,
      "hardhat-transcripts.json",
      { schemaVersion: 1, mode: config.mode, seed: config.seed, transcripts: collectedTranscripts },
      hashes,
    );
  }
  const transcriptById = new Map(collectedTranscripts.map((transcript) => [transcript.executionId, transcript]));
  const samples: Sample[] = [];
  const transcriptIndex: TranscriptIndexEntry[] = [];
  for (const seedEntry of seedList) {
    const transcript = transcriptById.get(seedEntry.executionId);
    if (transcript === undefined) throw new Error(`missing transcript ${seedEntry.executionId}`);
    const rawTranscriptPath = path.join("raw-transcripts", `${seedEntry.executionId}.json`).replace(/\\/g, "/");
    writeJsonWithHash(outputDirectory, rawTranscriptPath, transcript, hashes);
    const transcriptSha256 = hashes[rawTranscriptPath];
    transcriptIndex.push({
      executionId: seedEntry.executionId,
      seed: seedEntry.seed,
      winnerIndex: seedEntry.winnerIndex,
      rawTranscriptPath,
      transcriptSha256,
      split: splitById.get(seedEntry.executionId) ?? "held-out",
    });
    samples.push({ executionId: seedEntry.executionId, winnerIndex: seedEntry.winnerIndex, transcript });
  }
  writeJsonWithHash(outputDirectory, "transcript-index.json", transcriptIndex, hashes);

  const byId = new Map(samples.map((sample) => [sample.executionId, sample]));
  const training = split.train.map((executionId) => {
    const sample = byId.get(executionId);
    if (sample === undefined) throw new Error(`missing train sample ${executionId}`);
    return sample;
  });
  const heldOut = split.heldOut.map((executionId) => {
    const sample = byId.get(executionId);
    if (sample === undefined) throw new Error(`missing held-out sample ${executionId}`);
    return sample;
  });

  const mutationMetrics = config.mutationModes.map((mode) => evaluateMutation(training, heldOut, mode));
  writeJsonWithHash(outputDirectory, "mutation-metrics.json", mutationMetrics, hashes);
  const classifierMetrics = mutationMetrics.every((metric) => metric.status === "PASS")
    ? config.observerFamilies.map((family) =>
        evaluate(training, heldOut, family, config.maxCorrect, config.maxWilsonUpper99),
      )
    : [];
  writeJsonWithHash(outputDirectory, "classifier-metrics.json", classifierMetrics, hashes);
  writeJsonWithHash(
    outputDirectory,
    "permutation-tests.json",
    classifierMetrics.map(({ observerFamily, permutationPValue }) => ({ observerFamily, permutationPValue })),
    hashes,
  );
  writeJsonWithHash(
    outputDirectory,
    "command-provenance.json",
    commandProvenance(input.mode, transcriptSource),
    hashes,
  );

  const fullRawTranscriptRetention =
    transcriptIndex.length === config.executionCount &&
    samples.every((sample) =>
      transcriptLogs(sample.transcript).every(
        (log) =>
          log.emitterAddress.length === 42 &&
          log.topics.length > 0 &&
          log.data.startsWith("0x") &&
          log.transactionHash.startsWith("0x") &&
          log.gasUsed !== "" &&
          log.stepLabel !== "",
      ),
    );
  const companionGates = {
    pP2UniformAclGrantMultiset: "RUN_SEPARATELY_WITH test/privacy/acl-uniformity.t.ts",
    pP5GasHcuSymmetry: "RUN_SEPARATELY_WITH test/privacy/gas-indistinguishability.t.ts",
    noWinnerOnlyAbiEventGate: "RUN_SEPARATELY_WITH scripts/privacy-scan.ts",
    fullRawTranscriptRetention: fullRawTranscriptRetention ? ("PASS" as const) : ("FAIL" as const),
    privacyScannerFrozenResidualExpected: true as const,
  };
  const failed =
    !fullRawTranscriptRetention ||
    mutationMetrics.some((metric) => metric.status === "FAIL") ||
    classifierMetrics.some((metric) => metric.status === "FAIL");
  const finalStatus = {
    status: failed
      ? ("FAILED" as const)
      : transcriptSource !== "hardhat-fhevm-real"
        ? ("SMOKE_ONLY" as const)
        : input.mode === "full"
          ? ("READY_FOR_INDEPENDENT_REVIEW" as const)
          : ("REAL_SMOKE_ONLY" as const),
    reason: failed
      ? "At least one mutation, classifier, or retention gate failed."
      : transcriptSource !== "hardhat-fhevm-real"
        ? "Synthetic fixture smoke artifacts were generated; they are not eligible for P-P1 independent review."
        : input.mode === "full"
          ? "Full 1,000-execution campaign artifacts are ready for independent review; frozen P-P1 remains unchanged."
          : "Real Hardhat/FHEVM receipt smoke artifacts were generated; full 1,000-execution campaign was not run in this command.",
    frozenPp1Verdict: "WEAKER-THAN-CLAIMED" as const,
    docs10ProofStrategyDiffExpectedEmpty: true as const,
    companionGates,
  };
  writeJsonWithHash(outputDirectory, "final-status.json", finalStatus, hashes);
  writeJsonWithHash(outputDirectory, "artifact-hashes.json", { ...hashes }, hashes);

  return {
    config,
    split,
    transcriptIndex,
    classifierMetrics,
    mutationMetrics,
    finalStatus,
    artifactDirectory: outputDirectory,
    artifactHashes: hashes,
  };
}

function optionValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

if (require.main === module) {
  const mode = optionValue("--mode", "smoke");
  if (mode !== "smoke" && mode !== "full") throw new Error("--mode must be smoke or full");
  const transcriptSource = optionValue("--source", "hardhat-fhevm-real");
  if (transcriptSource !== "hardhat-fhevm-real" && transcriptSource !== "synthetic-fixture") {
    throw new Error("--source must be hardhat-fhevm-real or synthetic-fixture");
  }
  const seed = Number(optionValue("--seed", "20260815"));
  const outputDirectory = optionValue("--out", path.join("artifacts", "privacy", "p-p1-re-review"));
  runPp1ReReviewCampaign({ mode, seed, outputDirectory, transcriptSource })
    .then((result) => {
      console.log(
        JSON.stringify(
          {
            status: result.finalStatus.status,
            artifactDirectory: result.artifactDirectory,
            transcriptCount: result.transcriptIndex.length,
            classifierMetrics: result.classifierMetrics,
            mutationMetrics: result.mutationMetrics,
          },
          null,
          2,
        ),
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
