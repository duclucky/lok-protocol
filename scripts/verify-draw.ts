import {
  BaseContract,
  Log,
  TransactionDescription,
  getAddress,
  solidityPackedKeccak256,
  toBeHex,
  zeroPadValue,
} from "ethers";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ethers, fhevm, network } from "hardhat";

import { assertDeploymentManifest } from "./deploy";

type Hex = `0x${string}`;

export type DrawVerificationEvidence = {
  drawId: bigint;
  strict: boolean;
  participantSnapshot: number;
  runtimeBytecodeMatchesManifest: boolean;
  storedTotals: { tickets: bigint; baseRisk: bigint; yieldWeight: bigint };
  publicTotals: { tickets: bigint; baseRisk: bigint; yieldWeight: bigint };
  prizeAmount: bigint;
  publicPrizeCredits: bigint | null;
  publicRandom: bigint | null;
  randomHandle: Hex | null;
  finalRevealAcc: Hex;
  events: {
    opened: number;
    settled: number;
    randomness: Hex[];
    creditedParticipants: string[];
  };
  commits: Array<{ participant: string; commitment: Hex }>;
  reveals: Array<{ participant: string; entropy: Hex; salt: Hex; accepted: boolean }>;
  transcriptComplete?: boolean;
};

export type VerificationCheck = { id: string; passed: boolean; detail: string };
export type DrawVerificationResult = { passed: boolean; checks: VerificationCheck[] };

type VerifierEnvironment = Readonly<Record<string, string | undefined>>;
type ParticipantSnapshotReaders = {
  drawId: bigint;
  latestSettled: boolean;
  readHistorical: () => Promise<bigint>;
  readCurrent: () => Promise<{ drawId: bigint; state: bigint; participantSnapshot: bigint }>;
};

const DRAW_STATE_SETTLED = 7n;

function environmentFlag(value: string | undefined, label: string): boolean {
  if (value === undefined || value === "0" || value === "false") return false;
  if (value === "1" || value === "true") return true;
  throw new Error(`${label} must be 1, 0, true, or false`);
}

export function resolveVerifierOptions(
  environment: VerifierEnvironment,
  args: readonly string[] = [],
): { drawId: bigint | undefined; latestSettled: boolean; transcript: string | undefined } {
  const drawValue = environment.LOK_VERIFY_DRAW_ID ?? optionValue("--draw", args);
  const latestSettled =
    environmentFlag(environment.LOK_VERIFY_LATEST_SETTLED, "LOK_VERIFY_LATEST_SETTLED") ||
    args.includes("--latest-settled");
  if ((drawValue !== undefined) === latestSettled) {
    throw new Error("Select exactly one of LOK_VERIFY_DRAW_ID or LOK_VERIFY_LATEST_SETTLED=1");
  }
  return {
    drawId: drawValue === undefined ? undefined : BigInt(drawValue),
    latestSettled,
    transcript: environment.LOK_VERIFY_TRANSCRIPT ?? optionValue("--transcript", args),
  };
}

export async function readParticipantSnapshot(
  readers: ParticipantSnapshotReaders,
): Promise<{ participantSnapshot: number; source: "historical" | "current-settled" }> {
  try {
    return { participantSnapshot: Number(await readers.readHistorical()), source: "historical" };
  } catch (historicalError) {
    if (!readers.latestSettled) throw historicalError;
    const current = await readers.readCurrent();
    if (current.drawId !== readers.drawId || current.state !== DRAW_STATE_SETTLED) throw historicalError;
    return { participantSnapshot: Number(current.participantSnapshot), source: "current-settled" };
  }
}

function sameAddress(left: string, right: string): boolean {
  return getAddress(left) === getAddress(right);
}

function xorHex(values: readonly Hex[]): Hex {
  let accumulator = 0n;
  for (const value of values) accumulator ^= BigInt(value);
  return `0x${accumulator.toString(16).padStart(64, "0")}` as Hex;
}

function checkRevealTranscript(evidence: DrawVerificationEvidence): VerificationCheck {
  if (!evidence.strict || evidence.storedTotals.tickets === 0n) {
    return { id: "reveal-transcript", passed: true, detail: "Strict reveal transcript is not required for this draw." };
  }
  if (evidence.transcriptComplete === false) {
    return { id: "reveal-transcript", passed: false, detail: "Strict draw transaction transcript is incomplete." };
  }
  const commitments = new Map<string, Hex>();
  for (const commit of evidence.commits) commitments.set(getAddress(commit.participant), commit.commitment);
  const revealed = new Set<string>();
  const acceptedEntropy: Hex[] = [];
  let valid = true;
  for (const reveal of evidence.reveals) {
    const participant = getAddress(reveal.participant);
    const expected = commitments.get(participant);
    const actual = solidityPackedKeccak256(["bytes32", "bytes32"], [reveal.entropy, reveal.salt]);
    if (!reveal.accepted || expected === undefined || expected !== actual || revealed.has(participant)) valid = false;
    if (reveal.accepted) acceptedEntropy.push(reveal.entropy);
    revealed.add(participant);
  }
  if (xorHex(acceptedEntropy) !== evidence.finalRevealAcc) valid = false;
  return {
    id: "reveal-transcript",
    passed: valid,
    detail: valid
      ? `${revealed.size} accepted reveal(s) bind to their latest public commitments and final XOR accumulator.`
      : "A reveal is unaccepted, duplicated, unbound to its latest commitment, or inconsistent with revealAcc.",
  };
}

export function verifyDrawEvidence(evidence: DrawVerificationEvidence): DrawVerificationResult {
  const eventPass = evidence.events.opened === 1 && evidence.events.settled === 1;
  const totalsPass =
    evidence.storedTotals.tickets === evidence.publicTotals.tickets &&
    evidence.storedTotals.baseRisk === evidence.publicTotals.baseRisk &&
    evidence.storedTotals.yieldWeight === evidence.publicTotals.yieldWeight;
  const credited = evidence.events.creditedParticipants;
  const uniqueCredited = new Set(credited.map((participant) => getAddress(participant))).size;
  const passBExpected = evidence.publicTotals.yieldWeight > 0n;
  const rangePass =
    evidence.runtimeBytecodeMatchesManifest &&
    (passBExpected
      ? credited.length === evidence.participantSnapshot && uniqueCredited === evidence.participantSnapshot
      : credited.length === 0);
  const randomnessExpected = evidence.publicTotals.tickets > 0n;
  const randomnessPass = randomnessExpected
    ? evidence.events.randomness.length === 1 &&
      evidence.randomHandle !== null &&
      evidence.events.randomness[0] === evidence.randomHandle &&
      evidence.publicRandom !== null &&
      evidence.publicRandom >= 0n &&
      evidence.publicRandom < evidence.publicTotals.tickets
    : evidence.events.randomness.length === 0 && evidence.publicRandom === null;
  const prizePass =
    evidence.publicTotals.yieldWeight === 0n
      ? evidence.prizeAmount === 0n && evidence.publicPrizeCredits === null
      : evidence.publicPrizeCredits === evidence.prizeAmount;
  const checks: VerificationCheck[] = [
    {
      id: "events",
      passed: eventPass,
      detail: eventPass
        ? "Exactly one DrawOpened and one DrawSettled event exist."
        : "Draw boundary events are missing or duplicated.",
    },
    {
      id: "aggregate-proof",
      passed: totalsPass,
      detail: totalsPass
        ? "Publicly decrypted aggregate handles equal the totals accepted by the draw."
        : "Stored totals differ from the publicly decrypted aggregate handles.",
    },
    {
      id: "range-partition",
      passed: rangePass,
      detail: rangePass
        ? "Reviewed runtime bytecode matches and PASS B processed each draw-snapshot participant exactly once."
        : "Runtime provenance or complete one-credit-event-per-snapshot-participant evidence failed.",
    },
    {
      id: "randomness-commitment",
      passed: randomnessPass,
      detail: randomnessPass
        ? randomnessExpected
          ? "Committed r handle matches draw state and decrypts inside [0,totalTickets)."
          : "Zero-ticket draw correctly omitted random material."
        : "Randomness event, handle, or public range check failed.",
    },
    checkRevealTranscript(evidence),
    {
      id: "prize-conservation",
      passed: prizePass,
      detail: prizePass
        ? "Public aggregate prize credits equal prizeAmount exactly."
        : "Public aggregate prize credits do not equal prizeAmount.",
    },
  ];
  return { passed: checks.every((check) => check.passed), checks };
}

function asHandle(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function normalizeHandle(value: bigint | string): Hex {
  if (typeof value === "bigint") return asHandle(value);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`Invalid encrypted handle ${value}`);
  return value as Hex;
}

function asBigInt(value: unknown, label: string): bigint {
  if (typeof value !== "bigint") throw new Error(`${label} did not decrypt to bigint`);
  return value;
}

type TranscriptFile = { commitTxHashes?: string[]; revealTxHashes?: string[] };

function argumentValue(parsed: TransactionDescription, name: string, index: number): unknown {
  return parsed.args[name] ?? parsed.args[index];
}

async function transactionCall(
  draw: BaseContract,
  hash: string,
): Promise<{
  sender: string;
  parsed: TransactionDescription;
  accepted: boolean;
}> {
  const transaction = await ethers.provider.getTransaction(hash);
  if (transaction === null || transaction.to === null || !sameAddress(transaction.to, await draw.getAddress())) {
    throw new Error(`Transcript transaction ${hash} does not target LokDrawManager`);
  }
  const parsed = draw.interface.parseTransaction({ data: transaction.data, value: transaction.value });
  if (parsed === null) throw new Error(`Transcript transaction ${hash} has unknown calldata`);
  const receipt = await ethers.provider.getTransactionReceipt(hash);
  if (receipt === null) throw new Error(`Transcript transaction ${hash} has no receipt`);
  return { sender: transaction.from, parsed, accepted: receipt.status === 1 };
}

async function loadTranscript(draw: BaseContract, file: string | undefined) {
  if (file === undefined) return { commits: [], reveals: [], complete: false };
  const parsed = JSON.parse(await readFile(path.resolve(file), "utf8")) as TranscriptFile;
  const commits: DrawVerificationEvidence["commits"] = [];
  const reveals: DrawVerificationEvidence["reveals"] = [];
  for (const hash of parsed.commitTxHashes ?? []) {
    const call = await transactionCall(draw, hash);
    if (call.parsed.name !== "commitEntropy" || !call.accepted)
      throw new Error(`${hash} is not an accepted commitEntropy call`);
    commits.push({ participant: call.sender, commitment: argumentValue(call.parsed, "commitment", 0) as Hex });
  }
  for (const hash of parsed.revealTxHashes ?? []) {
    const call = await transactionCall(draw, hash);
    if (call.parsed.name !== "revealEntropy") throw new Error(`${hash} is not a revealEntropy call`);
    reveals.push({
      participant: call.sender,
      entropy: argumentValue(call.parsed, "entropy", 0) as Hex,
      salt: argumentValue(call.parsed, "salt", 1) as Hex,
      accepted: call.accepted,
    });
  }
  return { commits, reveals, complete: true };
}

function optionValue(name: string, args: readonly string[]): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function eventBlock(logs: readonly { blockNumber: number }[], label: string): Promise<number> {
  if (logs.length !== 1) throw new Error(`Expected exactly one ${label} event`);
  return logs[0].blockNumber;
}

async function queryEventLogs(
  contract: BaseContract,
  eventName: string,
  fromBlock: number,
  drawId?: bigint,
): Promise<Log[]> {
  const event = contract.interface.getEvent(eventName);
  if (event === null) throw new Error(`${eventName} is missing from the verifier ABI`);
  const latest = await ethers.provider.getBlockNumber();
  const logs: Log[] = [];
  const topics = drawId === undefined ? [event.topicHash] : [event.topicHash, zeroPadValue(toBeHex(drawId), 32)];
  for (let start = fromBlock; start <= latest; start += 5_000) {
    logs.push(
      ...(await ethers.provider.getLogs({
        address: await contract.getAddress(),
        topics,
        fromBlock: start,
        toBlock: Math.min(start + 4_999, latest),
      })),
    );
  }
  return logs;
}

async function main(): Promise<void> {
  if (network.name !== "sepolia") throw new Error("verify-draw.ts only supports Ethereum Sepolia");
  await fhevm.initializeCLIApi();
  if (fhevm.isMock) throw new Error("verify-draw.ts refuses the mock FHEVM backend");
  const raw: unknown = JSON.parse(await readFile(path.join(process.cwd(), "deployments", "sepolia.json"), "utf8"));
  assertDeploymentManifest(raw);
  const draw = await ethers.getContractAt("LokDrawManager", raw.addresses.drawManager);
  const vault = await ethers.getContractAt("LokVault", raw.addresses.vault);
  const fromBlock = raw.contracts.drawManager.deployBlockNumber;
  let drawId: bigint;
  const verifierOptions = resolveVerifierOptions(process.env, process.argv);
  if (verifierOptions.drawId !== undefined) drawId = verifierOptions.drawId;
  else if (verifierOptions.latestSettled) {
    const allSettled = await queryEventLogs(draw, "DrawSettled", fromBlock);
    if (allSettled.length === 0) throw new Error("No settled draw exists");
    const parsed = draw.interface.parseLog(allSettled[allSettled.length - 1]);
    if (parsed === null) throw new Error("Latest DrawSettled log is undecodable");
    drawId = parsed.args.drawId as bigint;
  } else {
    throw new Error("Use --draw <id> or --latest-settled");
  }

  const opened = await queryEventLogs(draw, "DrawOpened", fromBlock, drawId);
  const settled = await queryEventLogs(draw, "DrawSettled", fromBlock, drawId);
  const randomness = await queryEventLogs(draw, "RandomnessCommitted", fromBlock, drawId);
  const credited = await queryEventLogs(draw, "PrizeCredited", fromBlock, drawId);
  const openBlock = await eventBlock(opened, "DrawOpened");
  const settlementBlock = await eventBlock(settled, "DrawSettled");
  const info = await draw.getFunction("drawInfo").staticCall(drawId, { blockTag: settlementBlock });
  if (!(info.settled as boolean)) throw new Error(`Draw ${drawId} is not settled at its DrawSettled block`);

  const aggregateHandles = [
    normalizeHandle(info.cumRunning),
    normalizeHandle(info.cumBaseRiskRunning),
    normalizeHandle(info.cumYieldRunning),
  ];
  const publicHandles: Hex[] = [...aggregateHandles];
  const publicTotalsResult = await fhevm.publicDecrypt(aggregateHandles);
  const publicTotals = {
    tickets: asBigInt(publicTotalsResult.clearValues[aggregateHandles[0]], "cumRunning"),
    baseRisk: asBigInt(publicTotalsResult.clearValues[aggregateHandles[1]], "cumBaseRiskRunning"),
    yieldWeight: asBigInt(publicTotalsResult.clearValues[aggregateHandles[2]], "cumYieldRunning"),
  };
  let publicPrizeCredits: bigint | null = null;
  if (publicTotals.yieldWeight > 0n) {
    const handle = normalizeHandle(info.cumPrizeCredits);
    publicHandles.push(handle);
    const decrypted = await fhevm.publicDecrypt([handle]);
    publicPrizeCredits = asBigInt(decrypted.clearValues[handle], "cumPrizeCredits");
  }
  let publicRandom: bigint | null = null;
  let randomHandle: Hex | null = null;
  if (publicTotals.tickets > 0n) {
    randomHandle = normalizeHandle(info.r);
    publicHandles.push(randomHandle);
    const decrypted = await fhevm.publicDecrypt([randomHandle]);
    publicRandom = asBigInt(decrypted.clearValues[randomHandle], "r");
  }

  const snapshot = await readParticipantSnapshot({
    drawId,
    latestSettled: verifierOptions.latestSettled,
    readHistorical: async () => {
      const countCall = await ethers.provider.call({
        to: await vault.getAddress(),
        data: vault.interface.encodeFunctionData("participantCount"),
        blockTag: openBlock,
      });
      return vault.interface.decodeFunctionResult("participantCount", countCall)[0] as bigint;
    },
    readCurrent: async () => ({
      drawId: (await draw.getFunction("drawId").staticCall()) as bigint,
      state: (await draw.getFunction("state").staticCall()) as bigint,
      participantSnapshot: (await draw.getFunction("participantSnapshot").staticCall()) as bigint,
    }),
  });
  const participantSnapshot = snapshot.participantSnapshot;
  const drawCode = await ethers.provider.getCode(raw.addresses.drawManager, settlementBlock);
  const vaultCode = await ethers.provider.getCode(raw.addresses.vault, settlementBlock);
  const runtimeBytecodeMatchesManifest =
    raw.contracts.drawManager.verified &&
    raw.contracts.vault.verified &&
    ethers.keccak256(drawCode) === raw.contracts.drawManager.runtimeBytecodeHash &&
    ethers.keccak256(vaultCode) === raw.contracts.vault.runtimeBytecodeHash;
  const transcript = await loadTranscript(draw, verifierOptions.transcript);
  let finalRevealAcc = `0x${"00".repeat(32)}` as Hex;
  if ((info.strict as boolean) && randomness.length === 1) {
    finalRevealAcc = (await draw.getFunction("revealAcc").staticCall({ blockTag: randomness[0].blockNumber })) as Hex;
  }
  const creditedParticipants = credited.map((log) => {
    const parsed = draw.interface.parseLog(log);
    if (parsed === null) throw new Error("PrizeCredited log is undecodable");
    return parsed.args.user as string;
  });
  const randomHandles = randomness.map((log) => {
    const parsed = draw.interface.parseLog(log);
    if (parsed === null) throw new Error("RandomnessCommitted log is undecodable");
    return parsed.args.handle as Hex;
  });
  const evidence: DrawVerificationEvidence = {
    drawId,
    strict: info.strict as boolean,
    participantSnapshot,
    runtimeBytecodeMatchesManifest,
    storedTotals: {
      tickets: info.totalTickets as bigint,
      baseRisk: info.totalBaseRiskWeight as bigint,
      yieldWeight: info.totalYieldWeight as bigint,
    },
    publicTotals,
    prizeAmount: info.prizeAmount as bigint,
    publicPrizeCredits,
    publicRandom,
    randomHandle,
    finalRevealAcc,
    events: { opened: opened.length, settled: settled.length, randomness: randomHandles, creditedParticipants },
    commits: transcript.commits,
    reveals: transcript.reveals,
    transcriptComplete: !(info.strict as boolean) || transcript.complete,
  };
  const result = verifyDrawEvidence(evidence);
  for (const check of result.checks) console.log(`${check.passed ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
  console.log(
    JSON.stringify({
      status: result.passed ? "PASS" : "FAIL",
      drawId: drawId.toString(),
      publicHandles,
      settlementBlock,
      participantSnapshotSource: snapshot.source,
    }),
  );
  if (!result.passed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`FAIL verifier: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
