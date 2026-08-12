import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { BaseContract, ContractTransactionReceipt, Log, zeroPadValue } from "ethers";
import { ethers, fhevm } from "hardhat";

import { opcodeShape, writePrivacyEvidence } from "../../scripts/privacy-scan";
import { asHandle, read } from "../draw/helpers";
import { crankPrivacyParticipants, reachPrivacySweepB } from "./helpers";

type DebugTrace = { structLogs: Array<{ depth: number; op: string }> };

type ComparableLogSlice = Array<{
  raw: { address: string; topics: string[]; data: string };
  parsed: { name: string; args: Record<string, string> };
}>;

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
});
