import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import {
  BaseContract,
  ContractTransactionReceipt,
  ContractTransactionResponse,
  Interface,
  Log,
  zeroPadValue,
} from "ethers";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ethers, fhevm, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { opcodeShape, writePrivacyEvidence } from "../../scripts/privacy-scan";
import { NON_DUST_DEPOSIT, asHandle, deployDrawFixture, mintAndDeposit, read } from "../draw/helpers";
import { createDrawRandomHandles, setDrawRandomHandle } from "../draw/forced-random";
import { crankPrivacyParticipants, reachPrivacySweepB } from "./helpers";

type DebugTrace = { structLogs: Array<{ depth: number; op: string }> };

type ComparableLogSlice = Array<{
  raw: { address: string; topics: string[]; data: string };
  parsed: { name: string; args: Record<string, string> };
}>;

type FullTranscriptEntry = {
  transactionIndex: number;
  logIndex: number;
  raw: { address: string; topics: readonly string[]; data: string };
  parsed: { contract: string; name: string; args: Record<string, string> } | null;
};

type TransactionMetadata = {
  transactionIndex: number;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
};

const LOCAL_FHEVM_EXECUTOR = "0xe3a9105a3a932253a70f126eb1e3b589c643dd24";
const LOCAL_ACL = "0x50157cffd6bbfa2dece204a89ec419c23ef5755d";
const FHE_LE_INTERFACE = new Interface([
  "event FheLe(address indexed caller, bytes32 lhs, bytes32 rhs, bytes1 scalarByte, bytes32 result)",
]);

function normalizeSubjectHex(value: string, subject: string): string {
  const normalized = value.toLowerCase();
  const topicAddress = zeroPadValue(subject, 32).toLowerCase();
  const unpaddedAddress = subject.toLowerCase();
  return normalized.replaceAll(topicAddress, "<participant>").replaceAll(unpaddedAddress.slice(2), "<participant>");
}

function stringifyParsedValue(value: unknown, subject: string): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") {
    return value.toLowerCase() === subject.toLowerCase() ? "<participant>" : value.toLowerCase();
  }
  if (typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function compareUserLogSlices(
  receipt: ContractTransactionReceipt,
  draw: BaseContract,
  subject: string,
): ComparableLogSlice {
  const drawAddress = (draw.target as string).toLowerCase();
  return receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== drawAddress) return [];
    try {
      const parsed = draw.interface.parseLog(log);
      if (parsed?.name !== "PrizeCredited") return [];
      const rawLog = log as Log;
      const parsedArgs: Record<string, string> = {};
      for (const input of parsed.fragment.inputs) {
        parsedArgs[input.name] = stringifyParsedValue(parsed.args[input.name], subject);
      }
      return [
        {
          raw: {
            address: log.address.toLowerCase(),
            topics: rawLog.topics.map((topic) => normalizeSubjectHex(topic, subject)),
            data: normalizeSubjectHex(rawLog.data, subject),
          },
          parsed: { name: parsed.name, args: parsedArgs },
        },
      ];
    } catch {
      return [];
    }
  });
}

async function transact(
  contract: BaseContract,
  name: string,
  args: readonly unknown[] = [],
): Promise<ContractTransactionReceipt> {
  const tx = (await contract.getFunction(name)(...args)) as ContractTransactionResponse;
  const receipt = await tx.wait();
  if (receipt === null) throw new Error(`missing receipt for ${name}`);
  return receipt;
}

function fullTranscript(
  receipts: ContractTransactionReceipt[],
  contracts: Array<{ name: string; contract: BaseContract }>,
  applicationOnly: boolean,
): FullTranscriptEntry[] {
  const byAddress = new Map(
    contracts.map(({ name, contract }) => [(contract.target as string).toLowerCase(), { name, contract }]),
  );
  return receipts.flatMap((receipt, transactionIndex) =>
    receipt.logs
      .filter((rawLog) => !applicationOnly || byAddress.has(rawLog.address.toLowerCase()))
      .map((rawLog, logIndex) => {
        const parser = byAddress.get(rawLog.address.toLowerCase());
        let parsed: FullTranscriptEntry["parsed"] = null;
        if (parser !== undefined) {
          try {
            const event = parser.contract.interface.parseLog(rawLog);
            if (event !== null) {
              const args: Record<string, string> = {};
              for (const input of event.fragment.inputs) {
                const value = event.args[input.name] as unknown;
                args[input.name] = typeof value === "bigint" ? value.toString() : String(value).toLowerCase();
              }
              parsed = { contract: parser.name, name: event.name, args };
            }
          } catch {
            parsed = null;
          }
        }
        return {
          transactionIndex,
          logIndex,
          raw: { address: rawLog.address.toLowerCase(), topics: [...rawLog.topics], data: rawLog.data.toLowerCase() },
          parsed,
        };
      }),
  );
}

async function reachCounterfactualBase(participantCount: number, participantIndices?: number[]) {
  const selectedIndices = participantIndices ?? Array.from({ length: participantCount }, (_, index) => index);
  if (selectedIndices.length !== participantCount) throw new Error("participant index count mismatch");
  const fixture = await deployDrawFixture(true, Math.max(...selectedIndices) + 1);
  const participants = selectedIndices.map((index) => fixture.users[index]);
  for (const user of participants) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
  await transact(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1_003n]);

  const receipts: ContractTransactionReceipt[] = [];
  receipts.push(await transact(fixture.draw, "openDraw", [false]));
  const info = (await read(fixture.draw, "drawInfo", [1n])) as { tEnd: bigint };
  await time.increaseTo(info.tEnd + ((await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint));
  receipts.push(await transact(fixture.draw, "preSyncA", [4n]));
  receipts.push(await transact(fixture.draw, "preSyncA", [BigInt(participantCount - 4)]));
  receipts.push(await transact(fixture.draw, "crankA", [3n]));
  receipts.push(await transact(fixture.draw, "crankA", [BigInt(participantCount - 3)]));

  const swept = (await read(fixture.draw, "drawInfo", [1n])) as {
    cumRunning: bigint;
    cumBaseRiskRunning: bigint;
    cumYieldRunning: bigint;
  };
  const handles = [asHandle(swept.cumRunning), asHandle(swept.cumBaseRiskRunning), asHandle(swept.cumYieldRunning)];
  const totals = await fhevm.publicDecrypt(handles);
  receipts.push(await transact(fixture.draw, "submitTotals", [totals.abiEncodedClearValues, totals.decryptionProof]));
  receipts.push(await transact(fixture.draw, "openRandom"));
  const totalTickets = totals.clearValues[handles[0]] as bigint;
  expect(totalTickets % BigInt(participantCount)).to.equal(0n);
  const perParticipant = totalTickets / BigInt(participantCount);
  const randomHandles = await createDrawRandomHandles(
    fixture.draw,
    Array.from({ length: participantCount }, (_, index) => perParticipant * BigInt(index)),
  );
  return { fixture, participants, prefixReceipts: receipts, randomHandles };
}

async function counterfactualTranscript(
  base: Awaited<ReturnType<typeof reachCounterfactualBase>>,
  winnerIndex: number,
) {
  const { fixture } = base;
  await setDrawRandomHandle(fixture.draw, 1n, base.randomHandles[winnerIndex]);
  const receipts = [...base.prefixReceipts];
  const participantCount = base.participants.length;
  for (let index = 0; index < participantCount; index += 1) {
    receipts.push(await transact(fixture.draw, "crankB", [1n]));
  }

  const credits: bigint[] = [];
  for (const user of base.participants) {
    const handle = asHandle((await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint);
    credits.push(await fhevm.userDecryptEuint(FhevmType.euint64, handle, await fixture.draw.getAddress(), user));
  }
  expect(credits.findIndex((credit) => credit > 0n)).to.equal(winnerIndex);
  const contracts = [
    { name: "LokDrawManager", contract: fixture.draw },
    { name: "LokVault", contract: fixture.vault },
    { name: "YieldInjectingERC7984", contract: fixture.token },
    { name: "MockYieldAdapter", contract: fixture.adapter },
  ];
  const transactions = await Promise.all(
    receipts.map(async (receipt, transactionIndex): Promise<TransactionMetadata> => {
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      if (block === null) throw new Error(`missing block ${receipt.blockNumber}`);
      return {
        transactionIndex,
        transactionHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        timestamp: block.timestamp,
      };
    }),
  );
  return {
    application: fullTranscript(receipts, contracts, true),
    allReceiptLogs: fullTranscript(receipts, contracts, false),
    transactions,
  };
}

function byteDifferenceRanges(left: string, right: string): Array<[number, number]> {
  const leftBytes = Buffer.from(left.slice(2), "hex");
  const rightBytes = Buffer.from(right.slice(2), "hex");
  if (leftBytes.length !== rightBytes.length) throw new Error("cannot compare differently sized event data");
  const ranges: Array<[number, number]> = [];
  for (let offset = 0; offset < leftBytes.length; offset += 1) {
    if (leftBytes[offset] === rightBytes[offset]) continue;
    const last = ranges.at(-1);
    if (last !== undefined && offset === last[1] + 1) last[1] = offset;
    else ranges.push([offset, offset]);
  }
  return ranges;
}

function structuralTranscriptSignature(
  transcript: FullTranscriptEntry[],
  contracts: Array<{ name: string; contract: BaseContract }>,
): string {
  const classes = new Map(
    contracts.map(({ name, contract }) => [(contract.target as string).toLowerCase(), `APP:${name}`]),
  );
  classes.set(LOCAL_FHEVM_EXECUTOR, "FHEVMExecutor");
  classes.set(LOCAL_ACL, "ACL");
  return JSON.stringify(
    transcript.map((entry) => ({
      transactionIndex: entry.transactionIndex,
      logIndex: entry.logIndex,
      emitterClass: classes.get(entry.raw.address) ?? "UNKNOWN",
      topic0: entry.raw.topics[0] ?? null,
      topicCount: entry.raw.topics.length,
      dataBytes: (entry.raw.data.length - 2) / 2,
      parsedContract: entry.parsed?.contract ?? null,
      parsedEvent: entry.parsed?.name ?? null,
      parsedArgNames: entry.parsed === null ? [] : Object.keys(entry.parsed.args).sort(),
    })),
  );
}

function wilson95(successes: number, trials: number): [number, number] {
  const z = 1.959963984540054;
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / denominator;
  return [center - margin, center + margin];
}

async function restoreAfterMockCoprocessor(snapshotId: string, previousHighBlock: number): Promise<string> {
  expect(await network.provider.send("evm_revert", [snapshotId])).to.equal(true);
  const currentBlock = await ethers.provider.getBlockNumber();
  const blocksToMine = previousHighBlock - currentBlock + 2;
  if (blocksToMine > 0) await network.provider.send("hardhat_mine", [`0x${blocksToMine.toString(16)}`]);
  return (await network.provider.send("evm_snapshot")) as string;
}

describe("Lok winner log indistinguishability", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("gives a winner and every loser identical participant log fields and matched execution shape", async function () {
    const fixture = await reachPrivacySweepB(7, { boundaryDust: true });
    const receipts = await crankPrivacyParticipants(fixture);
    const credits: bigint[] = [];
    for (const user of fixture.participants) {
      const handle = asHandle((await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint);
      credits.push(await fhevm.userDecryptEuint(FhevmType.euint64, handle, await fixture.draw.getAddress(), user));
    }

    const winnerIndex = credits.findIndex((credit) => credit > 0n);
    const comparableLoserIndex = credits.findIndex(
      (credit, index) => credit === 0n && index > 0 && index < receipts.length - 1,
    );
    expect(winnerIndex, "deterministic winner must be outside the settlement-only final transaction").to.be.lessThan(
      receipts.length - 1,
    );
    expect(comparableLoserIndex).to.be.greaterThanOrEqual(0);

    const winnerReceipt = receipts[winnerIndex];
    const winnerSlice = compareUserLogSlices(winnerReceipt, fixture.draw, fixture.participants[winnerIndex].address);
    const comparedLoserIndices: number[] = [];
    for (let index = 0; index < credits.length; index += 1) {
      if (index === winnerIndex) continue;
      const loserSlice = compareUserLogSlices(receipts[index], fixture.draw, fixture.participants[index].address);
      expect(loserSlice, `raw and parsed PrizeCredited fields for loser ${index}`).to.deep.equal(winnerSlice);
      comparedLoserIndices.push(index);
    }

    const loserReceipt = receipts[comparableLoserIndex];

    const winnerTrace = (await ethers.provider.send("debug_traceTransaction", [
      winnerReceipt.hash,
      { disableMemory: true, disableStack: true, disableStorage: true },
    ])) as DebugTrace;
    const loserTrace = (await ethers.provider.send("debug_traceTransaction", [
      loserReceipt.hash,
      { disableMemory: true, disableStack: true, disableStorage: true },
    ])) as DebugTrace;
    const winnerOpcodes = opcodeShape(winnerTrace.structLogs);
    const loserOpcodes = opcodeShape(loserTrace.structLogs);
    const firstDifference = winnerOpcodes.findIndex((entry, index) => entry !== loserOpcodes[index]);
    expect(
      {
        length: winnerOpcodes.length,
        firstDifference,
        window:
          firstDifference === -1 ? [] : winnerOpcodes.slice(Math.max(0, firstDifference - 8), firstDifference + 8),
      },
      "winner opcode trace",
    ).to.deep.equal({
      length: loserOpcodes.length,
      firstDifference: -1,
      window: [],
    });
    writePrivacyEvidence("log-indistinguishability", {
      status: "PASS",
      propositions: ["P-P1", "P-P7", "P-P9-ABI"],
      participants: fixture.participants.length,
      winnerIndex,
      comparedLoserIndex: comparableLoserIndex,
      comparedLoserIndices,
      comparedRawAndParsedPrizeCreditedFields: true,
      applicationCallBoundaryShapeEqual: true,
      note: "Depth-3 mock-host internals are excluded; Lok call boundaries at depths 1-2 are equal.",
    });
  });

  it("compares complete lifecycle transcripts for every forced winner without payload normalization", async function () {
    const participantCount = 5;
    const evidenceDirectory = path.resolve("artifacts/privacy/counterfactual-p-p1");
    mkdirSync(evidenceDirectory, { recursive: true });
    const base = await reachCounterfactualBase(participantCount);
    let snapshotId = (await network.provider.send("evm_snapshot")) as string;
    let previousHighBlock = await ethers.provider.getBlockNumber();
    const transcripts: FullTranscriptEntry[][] = [];
    const allReceiptTranscripts: FullTranscriptEntry[][] = [];
    for (let winnerIndex = 0; winnerIndex < participantCount; winnerIndex += 1) {
      if (winnerIndex !== 0) snapshotId = await restoreAfterMockCoprocessor(snapshotId, previousHighBlock);
      const outputPath = path.join(evidenceDirectory, `winner-${winnerIndex}.json`);
      const transcript = await counterfactualTranscript(base, winnerIndex);
      writeFileSync(outputPath, `${JSON.stringify(transcript, null, 2)}\n`);
      transcripts.push(transcript.application);
      allReceiptTranscripts.push(transcript.allReceiptLogs);
      previousHighBlock = await ethers.provider.getBlockNumber();
    }
    const pairwiseComparisons: Array<{ winnerIndex: number; comparedWinnerIndex: number }> = [];
    for (let winnerIndex = 0; winnerIndex < transcripts.length; winnerIndex += 1) {
      for (let comparedWinnerIndex = 0; comparedWinnerIndex < transcripts.length; comparedWinnerIndex += 1) {
        if (winnerIndex === comparedWinnerIndex) continue;
        expect(
          transcripts[winnerIndex],
          `full raw/parsed transcript for forced winners ${winnerIndex} and ${comparedWinnerIndex}`,
        ).to.deep.equal(transcripts[comparedWinnerIndex]);
        pairwiseComparisons.push({ winnerIndex, comparedWinnerIndex });
      }
    }
    const protocolDifferences = allReceiptTranscripts.slice(1).map((transcript, offset) => {
      const firstDifference = transcript.findIndex(
        (entry, index) => JSON.stringify(entry) !== JSON.stringify(allReceiptTranscripts[0][index]),
      );
      return { winnerIndex: offset + 1, firstDifference };
    });
    expect(protocolDifferences.every(({ firstDifference }) => firstDifference >= 0)).to.equal(true);
    writePrivacyEvidence("log-indistinguishability", {
      status: "PASS",
      propositions: ["P-P1", "P-P7", "P-P9-ABI"],
      sourceTestIdentifiers: [
        "test/privacy/log-indistinguishability.t.ts:compares complete lifecycle transcripts for every forced winner without payload normalization",
      ],
      command: 'npx hardhat test test/privacy/log-indistinguishability.t.ts --grep "compares complete lifecycle"',
      participants: participantCount,
      counterfactualWinnerIndices: [0, 1, 2, 3, 4],
      comparedEveryWinnerAgainstEveryOther: true,
      pairwiseComparisons,
      comparedFullLifecycleRawAndParsedFields: true,
      normalizationAllowlist: [],
      eventTransactionsIncluded: ["openDraw", "preSyncA", "crankA", "submitTotals", "openRandom", "crankB"],
      transcriptEntries: transcripts[0].length,
      protocolInfrastructureLogsCompared: true,
      protocolDifferences,
      residual:
        "FHEVM executor/ACL raw log bytes differ across forced winners even though every application log is byte-identical; frozen P-P1 full-log criterion is not met.",
    });
  });

  it("forensically separates entry 301 handle bytes from public transcript structure", async function () {
    if (process.env.LOK_P_P1_FORENSIC !== "1") this.skip();
    this.timeout(180_000);

    const participantCount = 5;
    const repetitions = 10;
    const sourceStatusBeforeRun = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim();
    const gitCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const base = await reachCounterfactualBase(participantCount);
    const contracts = [
      { name: "LokDrawManager", contract: base.fixture.draw },
      { name: "LokVault", contract: base.fixture.vault },
      { name: "YieldInjectingERC7984", contract: base.fixture.token },
      { name: "MockYieldAdapter", contract: base.fixture.adapter },
    ];
    let snapshotId = (await network.provider.send("evm_snapshot")) as string;
    let previousHighBlock = await ethers.provider.getBlockNumber();
    const samples: Array<{
      repetition: number;
      winnerIndex: number;
      transcript: Awaited<ReturnType<typeof counterfactualTranscript>>;
      structuralSignature: string;
    }> = [];

    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      for (let winnerIndex = 0; winnerIndex < participantCount; winnerIndex += 1) {
        if (samples.length !== 0) snapshotId = await restoreAfterMockCoprocessor(snapshotId, previousHighBlock);
        const transcript = await counterfactualTranscript(base, winnerIndex);
        samples.push({
          repetition,
          winnerIndex,
          transcript,
          structuralSignature: structuralTranscriptSignature(transcript.allReceiptLogs, contracts),
        });
        previousHighBlock = await ethers.provider.getBlockNumber();
      }
    }

    const representative = samples.filter(({ repetition }) => repetition === 0);
    const forensicRows = representative.map(({ winnerIndex, transcript }) => {
      const entry = transcript.allReceiptLogs[301];
      expect(entry.transactionIndex).to.equal(7);
      expect(entry.raw.address).to.equal(LOCAL_FHEVM_EXECUTOR);
      const decoded = FHE_LE_INTERFACE.parseLog({ topics: [...entry.raw.topics], data: entry.raw.data });
      if (decoded === null) throw new Error("entry 301 is not FheLe");
      const transaction = transcript.transactions[entry.transactionIndex];
      return {
        winnerIndex,
        globalTranscriptIndex: 301,
        localExecutionIdentifier: `winner-${winnerIndex}:tx-${entry.transactionIndex}`,
        transactionHash: transaction.transactionHash,
        blockNumber: transaction.blockNumber,
        timestamp: transaction.timestamp,
        emittingContract: entry.raw.address,
        contractClassification: "FHEVMExecutor",
        eventSignature: "FheLe(address,bytes32,bytes32,bytes1,bytes32)",
        topic0: entry.raw.topics[0],
        rawTopics: [...entry.raw.topics],
        rawData: entry.raw.data,
        decodedArgs: {
          caller: String(decoded.args.caller).toLowerCase(),
          lhs: String(decoded.args.lhs).toLowerCase(),
          rhs: String(decoded.args.rhs).toLowerCase(),
          scalarByte: String(decoded.args.scalarByte).toLowerCase(),
          result: String(decoded.args.result).toLowerCase(),
        },
        applicationCallPath: "LokDrawManager.crankB -> _processPassB -> FHE.le(rangeStart[user], draw.r)",
        participantCursorPosition: 0,
        participant: base.participants[0].address.toLowerCase(),
      };
    });

    const pairwiseDiffs: Array<{
      leftWinnerIndex: number;
      rightWinnerIndex: number;
      firstRawDifference: number;
      entry301DataDifferenceRanges: Array<[number, number]>;
    }> = [];
    for (let left = 0; left < representative.length; left += 1) {
      for (let right = left + 1; right < representative.length; right += 1) {
        const leftLogs = representative[left].transcript.allReceiptLogs;
        const rightLogs = representative[right].transcript.allReceiptLogs;
        const firstRawDifference = leftLogs.findIndex((entry, index) => {
          const other = rightLogs[index];
          return JSON.stringify(entry.raw) !== JSON.stringify(other.raw);
        });
        pairwiseDiffs.push({
          leftWinnerIndex: representative[left].winnerIndex,
          rightWinnerIndex: representative[right].winnerIndex,
          firstRawDifference,
          entry301DataDifferenceRanges: byteDifferenceRanges(leftLogs[301].raw.data, rightLogs[301].raw.data),
        });
      }
    }
    expect(pairwiseDiffs.every(({ firstRawDifference }) => firstRawDifference === 301)).to.equal(true);

    const repeatedWinnerControls = Array.from({ length: participantCount }, (_, winnerIndex) => {
      const matching = samples.filter((sample) => sample.winnerIndex === winnerIndex);
      const decoded = matching.map((sample) => {
        const entry = sample.transcript.allReceiptLogs[301];
        const event = FHE_LE_INTERFACE.parseLog({ topics: [...entry.raw.topics], data: entry.raw.data });
        if (event === null) throw new Error("entry 301 is not FheLe");
        return {
          rhs: String(event.args.rhs).toLowerCase(),
          result: String(event.args.result).toLowerCase(),
          blockNumber: sample.transcript.transactions[7].blockNumber,
        };
      });
      const rhsValues = new Set(decoded.map(({ rhs }) => rhs));
      const resultValues = new Set(decoded.map(({ result }) => result));
      expect(rhsValues.size, `forced-random input handle for winner ${winnerIndex}`).to.equal(1);
      expect(resultValues.size, `deterministic local-mock FheLe outputs for winner ${winnerIndex}`).to.equal(1);
      return {
        winnerIndex,
        repetitions: matching.length,
        distinctRhsHandles: rhsValues.size,
        distinctResultHandles: resultValues.size,
        blockNumbers: decoded.map(({ blockNumber }) => blockNumber),
      };
    });

    const training = samples.filter(({ repetition }) => repetition < repetitions / 2);
    const testing = samples.filter(({ repetition }) => repetition >= repetitions / 2);
    const labelsBySignature = new Map<string, number[]>();
    for (const sample of training) {
      const labels = labelsBySignature.get(sample.structuralSignature) ?? [];
      labels.push(sample.winnerIndex);
      labelsBySignature.set(sample.structuralSignature, labels);
    }
    const confusionMatrix = Array.from({ length: participantCount }, () => Array(participantCount).fill(0) as number[]);
    let correct = 0;
    for (const sample of testing) {
      const labels = labelsBySignature.get(sample.structuralSignature) ?? [];
      const counts = Array(participantCount).fill(0) as number[];
      for (const label of labels) counts[label] += 1;
      const prediction = counts.reduce((best, count, index) => (count > counts[best] ? index : best), 0);
      confusionMatrix[sample.winnerIndex][prediction] += 1;
      if (prediction === sample.winnerIndex) correct += 1;
    }
    const accuracy = correct / testing.length;
    expect(new Set(samples.map(({ structuralSignature }) => structuralSignature)).size).to.equal(1);
    expect(accuracy).to.equal(1 / participantCount);

    const variantBase = await reachCounterfactualBase(participantCount, [0, 1, 2, 3, 5]);
    const variantTranscript = await counterfactualTranscript(variantBase, 0);
    const variantContracts = [
      { name: "LokDrawManager", contract: variantBase.fixture.draw },
      { name: "LokVault", contract: variantBase.fixture.vault },
      { name: "YieldInjectingERC7984", contract: variantBase.fixture.token },
      { name: "MockYieldAdapter", contract: variantBase.fixture.adapter },
    ];
    const nonWinnerControlEqual =
      structuralTranscriptSignature(representative[0].transcript.allReceiptLogs, contracts) ===
      structuralTranscriptSignature(variantTranscript.allReceiptLogs, variantContracts);
    expect(nonWinnerControlEqual).to.equal(true);

    const output = {
      schemaVersion: 1,
      generatedAtUtc: new Date().toISOString(),
      gitCommit,
      sourceStatusBeforeRun,
      proposition: "P-P1",
      frozenCriterion: "No event field differs between winner and any loser.",
      reproductionCommand:
        '$env:LOK_P_P1_FORENSIC="1"; npx hardhat test test/privacy/log-indistinguishability.t.ts --grep "forensically separates entry 301"',
      verifiedLocalProtocolAddresses: {
        FHEVMExecutor: LOCAL_FHEVM_EXECUTOR,
        ACL: LOCAL_ACL,
        source: "installed @fhevm/solidity@0.11.1 config/ZamaConfig.sol",
      },
      entry301: forensicRows,
      pairwiseDiffs,
      controls: {
        sameForcedWinnerAcrossBlocks: repeatedWinnerControls,
        differentForcedWinnerPositions: ["first:0", "interior:2", "final:4"],
        snapshotRevertWithMonotoneBlockMining: true,
        changedNonWinnerParticipant: {
          baselineIndices: [0, 1, 2, 3, 4],
          variantIndices: [0, 1, 2, 3, 5],
          forcedWinnerIndex: 0,
          structuralTranscriptEqual: nonWinnerControlEqual,
        },
      },
      classifier: {
        featurePolicy:
          "Public emitter class, topic0, topic count, data length, transaction/log position, parsed event name and argument names only; ciphertext payload bytes and private harness state excluded.",
        trainingExecutions: training.length,
        heldOutExecutions: testing.length,
        baselineRandomAccuracy: 1 / participantCount,
        measuredAccuracy: accuracy,
        wilson95: wilson95(correct, testing.length),
        confusionMatrix,
      },
      causalExplanation:
        "Entry 301 is the first PASS-B FheLe. Its rhs is draw.r, deliberately replaced by the forced-winner harness; its result is the corresponding opaque FHE comparison handle. Repeated same-winner controls keep both handles stable in the installed local mock across mined blocks, while changing the forced winner changes rhs and result. The event/address/topic/length/call shape is invariant. Equivalent production draws naturally use distinct opaque random handles, so those raw protocol fields need not be byte-identical even when they reveal no winner. The frozen byte-field criterion therefore fails although the structure-only public observer does not beat baseline.",
      classification: "CASE 2 - BENIGN NONDETERMINISM, FROZEN CRITERION STILL FAILS",
      verdict: "WEAKER-THAN-CLAIMED",
      ownerDecisionRequired: [
        "Keep the frozen byte-field criterion and accept that P-P1 cannot close on FHEVM protocol events.",
        "Explicitly re-review and re-freeze P-P1 around non-derivability/statistical indistinguishability.",
      ],
    };
    const outputPath = path.resolve("artifacts/privacy/p-p1-forensic.json");
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  });

  it("detects a winner-only topic or data mutation in any application event", function () {
    const baseline: FullTranscriptEntry[] = [
      {
        transactionIndex: 0,
        logIndex: 0,
        raw: { address: "0x0000000000000000000000000000000000000001", topics: ["0x01"], data: "0x00" },
        parsed: { contract: "LokDrawManager", name: "PrizeCredited", args: { user: "0x01" } },
      },
    ];
    const topicMutant = structuredClone(baseline);
    topicMutant[0].raw.topics = ["0x02"];
    expect(topicMutant).to.not.deep.equal(baseline);
    const dataMutant = structuredClone(baseline);
    dataMutant[0].raw.data = "0x01";
    expect(dataMutant).to.not.deep.equal(baseline);
    const parsedMutant = structuredClone(baseline);
    if (parsedMutant[0].parsed !== null) parsedMutant[0].parsed.args.winner = "true";
    expect(parsedMutant).to.not.deep.equal(baseline);
  });
});
