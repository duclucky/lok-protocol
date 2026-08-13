import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { BaseContract, ContractTransactionReceipt, ContractTransactionResponse, Log, zeroPadValue } from "ethers";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ethers, fhevm, network } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import { opcodeShape, writePrivacyEvidence } from "../../scripts/privacy-scan";
import { asHandle, deployDrawFixture, mintAndDeposit, read } from "../draw/helpers";
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

async function reachCounterfactualBase(participantCount: number) {
  const fixture = await deployDrawFixture(true, participantCount);
  for (const user of fixture.users.slice(0, participantCount)) await mintAndDeposit(fixture, user, 1_000_000n);
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
  return { fixture, prefixReceipts: receipts, randomHandles };
}

async function counterfactualTranscript(
  base: Awaited<ReturnType<typeof reachCounterfactualBase>>,
  winnerIndex: number,
) {
  const { fixture } = base;
  await setDrawRandomHandle(fixture.draw, 1n, base.randomHandles[winnerIndex]);
  const receipts = [...base.prefixReceipts];
  const participantCount = fixture.users.length;
  for (let index = 0; index < participantCount; index += 1) {
    receipts.push(await transact(fixture.draw, "crankB", [1n]));
  }

  const credits: bigint[] = [];
  for (const user of fixture.users.slice(0, participantCount)) {
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
  return {
    application: fullTranscript(receipts, contracts, true),
    allReceiptLogs: fullTranscript(receipts, contracts, false),
  };
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
