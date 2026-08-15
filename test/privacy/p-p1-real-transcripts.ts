import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { BaseContract, ContractTransactionReceipt, ContractTransactionResponse, Interface } from "ethers";
import { ethers, fhevm, network } from "hardhat";

import type { Pp1RawLog, Pp1Transcript } from "../../scripts/p-p1-re-review";
import { NON_DUST_DEPOSIT, asHandle, deployDrawFixture, mintAndDeposit, read } from "../draw/helpers";
import { createDrawRandomHandles, setDrawRandomHandle } from "../draw/forced-random";

export type FullTranscriptEntry = {
  transactionIndex: number;
  logIndex: number;
  raw: { address: string; topics: readonly string[]; data: string };
  parsed: { contract: string; name: string; args: Record<string, string> } | null;
};

export type TransactionMetadata = {
  transactionIndex: number;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
};

export type RealSeedEntry = { executionId: string; seed: number; winnerIndex: number };

export const LOCAL_FHEVM_EXECUTOR = "0xe3a9105a3a932253a70f126eb1e3b589c643dd24";
export const LOCAL_ACL = "0x50157cffd6bbfa2dece204a89ec419c23ef5755d";

const FHE_LE_INTERFACE = new Interface([
  "event FheLe(address indexed caller, bytes32 lhs, bytes32 rhs, bytes1 scalarByte, bytes32 result)",
]);

export async function transact(
  contract: BaseContract,
  name: string,
  args: readonly unknown[] = [],
): Promise<ContractTransactionReceipt> {
  const tx = (await contract.getFunction(name)(...args)) as ContractTransactionResponse;
  const receipt = await tx.wait();
  if (receipt === null) throw new Error(`missing receipt for ${name}`);
  return receipt;
}

function parseArgs(parsed: NonNullable<ReturnType<Interface["parseLog"]>>): Record<string, string> {
  const args: Record<string, string> = {};
  for (const input of parsed.fragment.inputs) {
    const value = parsed.args[input.name] as unknown;
    args[input.name] = typeof value === "bigint" ? value.toString() : String(value).toLowerCase();
  }
  return args;
}

export function fullTranscript(
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
            if (event !== null) parsed = { contract: parser.name, name: event.name, args: parseArgs(event) };
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

function emitterClass(address: string, applicationAddresses: Set<string>): Pp1RawLog["emitterClass"] {
  const normalized = address.toLowerCase();
  if (applicationAddresses.has(normalized)) return "application";
  if (normalized === LOCAL_FHEVM_EXECUTOR) return "fhevm-executor";
  if (normalized === LOCAL_ACL) return "acl";
  return "unknown";
}

function decodeProtocolLog(rawLog: ContractTransactionReceipt["logs"][number]): Pp1RawLog["decoded"] {
  if (rawLog.address.toLowerCase() !== LOCAL_FHEVM_EXECUTOR) return null;
  try {
    const event = FHE_LE_INTERFACE.parseLog(rawLog);
    if (event === null) return null;
    return {
      contract: "FHEVMExecutor",
      eventName: event.name,
      argNames: event.fragment.inputs.map((input) => input.name),
      args: parseArgs(event),
    };
  } catch {
    return null;
  }
}

export function rawReceipts(
  receipts: ContractTransactionReceipt[],
  stepLabels: string[],
  contracts: Array<{ name: string; contract: BaseContract }>,
): Pp1Transcript["receipts"] {
  const byAddress = new Map(
    contracts.map(({ name, contract }) => [(contract.target as string).toLowerCase(), { name, contract }]),
  );
  const applicationAddresses = new Set(byAddress.keys());
  let globalLogIndex = 0;
  return receipts.map((receipt, receiptIndex) => {
    const stepLabel = stepLabels[receiptIndex] ?? `tx-${receiptIndex}`;
    const logs = receipt.logs.map((rawLog, logIndex): Pp1RawLog => {
      const address = rawLog.address.toLowerCase();
      const parser = byAddress.get(address);
      let decoded: Pp1RawLog["decoded"] = null;
      if (parser !== undefined) {
        try {
          const event = parser.contract.interface.parseLog(rawLog);
          if (event !== null) {
            decoded = {
              contract: parser.name,
              eventName: event.name,
              argNames: event.fragment.inputs.map((input) => input.name),
              args: parseArgs(event),
            };
          }
        } catch {
          decoded = null;
        }
      } else {
        decoded = decodeProtocolLog(rawLog);
      }
      return {
        receiptIndex,
        logIndex,
        globalLogIndex: globalLogIndex++,
        transactionHash: receipt.hash,
        gasUsed: receipt.gasUsed.toString(),
        stepLabel,
        emitterAddress: address,
        emitterClass: emitterClass(address, applicationAddresses),
        topics: [...rawLog.topics].map((topic) => topic.toLowerCase()),
        data: rawLog.data.toLowerCase(),
        decoded,
      };
    });
    return { receiptIndex, stepLabel, transactionHash: receipt.hash, gasUsed: receipt.gasUsed.toString(), logs };
  });
}

export async function reachCounterfactualBase(participantCount: number, participantIndices?: number[]) {
  const selectedIndices = participantIndices ?? Array.from({ length: participantCount }, (_, index) => index);
  if (selectedIndices.length !== participantCount) throw new Error("participant index count mismatch");
  const fixture = await deployDrawFixture(true, Math.max(...selectedIndices) + 1);
  const participants = selectedIndices.map((index) => fixture.users[index]);
  for (const user of participants) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
  await transact(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1_003n]);

  const receipts: ContractTransactionReceipt[] = [];
  const stepLabels: string[] = [];
  receipts.push(await transact(fixture.draw, "openDraw", [false]));
  stepLabels.push("openDraw");
  const info = (await read(fixture.draw, "drawInfo", [1n])) as { tEnd: bigint };
  await time.increaseTo(info.tEnd + ((await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint));
  receipts.push(await transact(fixture.draw, "preSyncA", [4n]));
  stepLabels.push("preSyncA-0");
  receipts.push(await transact(fixture.draw, "preSyncA", [BigInt(participantCount - 4)]));
  stepLabels.push("preSyncA-1");
  receipts.push(await transact(fixture.draw, "crankA", [3n]));
  stepLabels.push("crankA-0");
  receipts.push(await transact(fixture.draw, "crankA", [BigInt(participantCount - 3)]));
  stepLabels.push("crankA-1");

  const swept = (await read(fixture.draw, "drawInfo", [1n])) as {
    cumRunning: bigint;
    cumBaseRiskRunning: bigint;
    cumYieldRunning: bigint;
  };
  const handles = [asHandle(swept.cumRunning), asHandle(swept.cumBaseRiskRunning), asHandle(swept.cumYieldRunning)];
  const totals = await fhevm.publicDecrypt(handles);
  receipts.push(await transact(fixture.draw, "submitTotals", [totals.abiEncodedClearValues, totals.decryptionProof]));
  stepLabels.push("submitTotals");
  receipts.push(await transact(fixture.draw, "openRandom"));
  stepLabels.push("openRandom");
  const totalTickets = totals.clearValues[handles[0]] as bigint;
  if (totalTickets % BigInt(participantCount) !== 0n) throw new Error("total tickets are not evenly splittable");
  const perParticipant = totalTickets / BigInt(participantCount);
  const randomHandles = await createDrawRandomHandles(
    fixture.draw,
    Array.from({ length: participantCount }, (_, index) => perParticipant * BigInt(index)),
  );
  return { fixture, participants, prefixReceipts: receipts, prefixStepLabels: stepLabels, randomHandles };
}

export async function counterfactualTranscript(
  base: Awaited<ReturnType<typeof reachCounterfactualBase>>,
  winnerIndex: number,
) {
  const { fixture } = base;
  await setDrawRandomHandle(fixture.draw, 1n, base.randomHandles[winnerIndex]);
  const receipts = [...base.prefixReceipts];
  const stepLabels = [...base.prefixStepLabels];
  const participantCount = base.participants.length;
  for (let index = 0; index < participantCount; index += 1) {
    receipts.push(await transact(fixture.draw, "crankB", [1n]));
    stepLabels.push(`crankB-${index}`);
  }

  const credits: bigint[] = [];
  for (const user of base.participants) {
    const handle = asHandle((await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint);
    credits.push(await fhevm.userDecryptEuint(FhevmType.euint64, handle, await fixture.draw.getAddress(), user));
  }
  if (credits.findIndex((credit) => credit > 0n) !== winnerIndex) throw new Error("forced winner mismatch");
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
    rawReceipts: rawReceipts(receipts, stepLabels, contracts),
  };
}

export async function counterfactualPp1Transcript(
  base: Awaited<ReturnType<typeof reachCounterfactualBase>>,
  seedEntry: RealSeedEntry,
): Promise<Pp1Transcript> {
  const transcript = await counterfactualTranscript(base, seedEntry.winnerIndex);
  return {
    schemaVersion: 1,
    transcriptSource: "hardhat-fhevm-real",
    executionId: seedEntry.executionId,
    seed: seedEntry.seed,
    winnerIndex: seedEntry.winnerIndex,
    participantCount: 5,
    receipts: transcript.rawReceipts,
  };
}

export async function restoreAfterMockCoprocessor(snapshotId: string, previousHighBlock: number): Promise<string> {
  if ((await network.provider.send("evm_revert", [snapshotId])) !== true) throw new Error("snapshot revert failed");
  const currentBlock = await ethers.provider.getBlockNumber();
  const blocksToMine = previousHighBlock - currentBlock + 2;
  if (blocksToMine > 0) await network.provider.send("hardhat_mine", [`0x${blocksToMine.toString(16)}`]);
  return (await network.provider.send("evm_snapshot")) as string;
}
