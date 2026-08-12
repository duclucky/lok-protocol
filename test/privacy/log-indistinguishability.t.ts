import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ContractTransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import { opaqueLogShape, opcodeShape, writePrivacyEvidence } from "../../scripts/privacy-scan";
import { asHandle, read } from "../draw/helpers";
import { crankPrivacyParticipants, reachPrivacySweepB } from "./helpers";

type DebugTrace = { structLogs: Array<{ depth: number; op: string }> };

function creditedEventShape(
  receipt: ContractTransactionReceipt,
  draw: Awaited<ReturnType<typeof reachPrivacySweepB>>["draw"],
) {
  return receipt.logs.flatMap((log) => {
    try {
      const parsed = draw.interface.parseLog(log);
      if (parsed?.name !== "PrizeCredited") return [];
      return [{ name: parsed.name, drawId: parsed.args.drawId as bigint, argumentCount: parsed.args.length }];
    } catch {
      return [];
    }
  });
}

describe("Lok winner log indistinguishability", function () {
  beforeEach(function () {
    if (!fhevm.isMock) this.skip();
  });

  it("gives a non-final winner and loser identical event and execution shapes", async function () {
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
    const loserReceipt = receipts[comparableLoserIndex];
    expect(creditedEventShape(winnerReceipt, fixture.draw)).to.deep.equal(
      creditedEventShape(loserReceipt, fixture.draw),
    );
    expect(opaqueLogShape(winnerReceipt.logs)).to.deep.equal(opaqueLogShape(loserReceipt.logs));

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
      creditedEventShapeEqual: true,
      opaqueLogShapeEqual: true,
      applicationCallBoundaryShapeEqual: true,
      note: "Depth-3 mock-host internals are excluded; Lok call boundaries at depths 1-2 are equal.",
    });
  });
});
