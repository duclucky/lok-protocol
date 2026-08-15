import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ContractTransactionReceipt } from "ethers";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fhevm } from "hardhat";

import type { NaturalPp1Transcript } from "../../scripts/p-p1-natural-gas-experiment";
import { NON_DUST_DEPOSIT, asHandle, deployDrawFixture, mintAndDeposit, read } from "../draw/helpers";
import { rawReceipts, transact } from "./p-p1-real-transcripts";

type CollectorOutput = {
  schemaVersion: 1;
  transcriptSource: "hardhat-fhevm-natural";
  mode: "smoke" | "full";
  seed: number;
  transcripts: NaturalPp1Transcript[];
};

async function naturalTranscript(executionId: string, seed: number): Promise<NaturalPp1Transcript> {
  const participantCount = 5;
  const fixture = await deployDrawFixture(true, participantCount);
  const participants = fixture.users.slice(0, participantCount);
  for (const user of participants) await mintAndDeposit(fixture, user, NON_DUST_DEPOSIT);
  await transact(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1_003n]);

  const receipts: ContractTransactionReceipt[] = [];
  const stepLabels: string[] = [];
  receipts.push(await transact(fixture.draw, "openDraw", [false]));
  stepLabels.push("openDraw");
  const opened = (await read(fixture.draw, "drawInfo", [1n])) as { tEnd: bigint };
  await time.increaseTo(opened.tEnd + ((await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint));
  receipts.push(await transact(fixture.draw, "preSyncA", [4n]));
  stepLabels.push("preSyncA-0");
  receipts.push(await transact(fixture.draw, "preSyncA", [1n]));
  stepLabels.push("preSyncA-1");
  receipts.push(await transact(fixture.draw, "crankA", [3n]));
  stepLabels.push("crankA-0");
  receipts.push(await transact(fixture.draw, "crankA", [2n]));
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
  for (let index = 0; index < participantCount; index += 1) {
    receipts.push(await transact(fixture.draw, "crankB", [1n]));
    stepLabels.push(`crankB-${index}`);
  }

  const credits: bigint[] = [];
  for (const user of participants) {
    const handle = asHandle((await read(fixture.draw, "prizeCredit", [1n, user.address])) as bigint);
    credits.push(await fhevm.userDecryptEuint(FhevmType.euint64, handle, await fixture.draw.getAddress(), user));
  }
  const winningCredits = credits.filter((credit) => credit > 0n);
  if (winningCredits.length !== 1) throw new Error(`expected exactly one natural winner, got ${winningCredits.length}`);
  const winnerIndex = credits.findIndex((credit) => credit > 0n);

  const contracts = [
    { name: "LokDrawManager", contract: fixture.draw },
    { name: "LokVault", contract: fixture.vault },
    { name: "YieldInjectingERC7984", contract: fixture.token },
    { name: "MockYieldAdapter", contract: fixture.adapter },
  ];
  return {
    schemaVersion: 1,
    transcriptSource: "hardhat-fhevm-natural",
    executionId,
    seed,
    winnerIndex,
    participantCount,
    receipts: rawReceipts(receipts, stepLabels, contracts),
  };
}

describe("P-P1 natural gas transcript source", function () {
  it("keeps the natural collector disabled unless explicitly requested", function () {
    expect(process.env.LOK_P_P1_NATURAL_COLLECT === "1").to.equal(false);
  });

  it("collects natural draw transcripts without forced random injection", async function () {
    if (process.env.LOK_P_P1_NATURAL_COLLECT !== "1") this.skip();
    if (!fhevm.isMock) throw new Error("P-P1 natural transcript collection requires local FHEVM mock mode");
    this.timeout(7_200_000);

    const mode = (process.env.LOK_P_P1_NATURAL_MODE ?? "smoke") as "smoke" | "full";
    if (mode !== "smoke" && mode !== "full") throw new Error(`invalid LOK_P_P1_NATURAL_MODE ${mode}`);
    const count = Number(process.env.LOK_P_P1_NATURAL_COUNT ?? "50");
    const seed = Number(process.env.LOK_P_P1_NATURAL_SEED ?? "20260815");
    const outputPath = process.env.LOK_P_P1_NATURAL_OUTPUT;
    if (outputPath === undefined || outputPath === "") throw new Error("missing LOK_P_P1_NATURAL_OUTPUT");
    const transcripts: NaturalPp1Transcript[] = [];
    for (let index = 0; index < count; index += 1) {
      transcripts.push(await naturalTranscript(`natural-r${index.toString().padStart(4, "0")}`, seed + index));
    }
    const output: CollectorOutput = {
      schemaVersion: 1,
      transcriptSource: "hardhat-fhevm-natural",
      mode,
      seed,
      transcripts,
    };
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  });
});
