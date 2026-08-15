import { expect } from "chai";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fhevm, network } from "hardhat";

import {
  buildCampaignConfig,
  buildSeedList,
  type CampaignMode,
  type Pp1Transcript,
} from "../../scripts/p-p1-re-review";
import {
  counterfactualPp1Transcript,
  reachCounterfactualBase,
  restoreAfterMockCoprocessor,
} from "./p-p1-real-transcripts";

describe("P-P1 re-review real transcript source", function () {
  it("collects real forced-winner transcripts from local FHEVM receipts", async function () {
    if (process.env.LOK_P_P1_COLLECT !== "1") this.skip();
    if (!fhevm.isMock) throw new Error("P-P1 transcript collection requires local FHEVM mock mode");
    this.timeout(process.env.LOK_P_P1_MODE === "full" ? 7_200_000 : 240_000);

    const mode = (process.env.LOK_P_P1_MODE ?? "smoke") as CampaignMode;
    if (mode !== "smoke" && mode !== "full") throw new Error(`invalid LOK_P_P1_MODE ${mode}`);
    const outputPath = process.env.LOK_P_P1_COLLECTOR_OUTPUT;
    if (outputPath === undefined || outputPath === "") throw new Error("missing LOK_P_P1_COLLECTOR_OUTPUT");
    const seed = Number(process.env.LOK_P_P1_SEED ?? "20260815");
    const config = buildCampaignConfig(mode, seed, "hardhat-fhevm-real");
    const seedList = buildSeedList(config);
    const transcripts: Pp1Transcript[] = [];

    for (let run = 0; run < config.executionsPerWinner; run += 1) {
      const base = await reachCounterfactualBase(config.participantCount);
      let snapshotId = (await network.provider.send("evm_snapshot")) as string;
      let previousHighBlock = await network.provider.send("eth_blockNumber");
      for (let winnerIndex = 0; winnerIndex < config.participantCount; winnerIndex += 1) {
        if (winnerIndex !== 0) {
          snapshotId = await restoreAfterMockCoprocessor(snapshotId, Number(previousHighBlock));
        }
        const seedEntry = seedList.find(
          (entry) =>
            entry.winnerIndex === winnerIndex &&
            entry.executionId === `w${winnerIndex}-r${run.toString().padStart(4, "0")}`,
        );
        if (seedEntry === undefined) throw new Error(`missing seed entry for winner ${winnerIndex} run ${run}`);
        transcripts.push(await counterfactualPp1Transcript(base, seedEntry));
        previousHighBlock = await network.provider.send("eth_blockNumber");
      }
    }

    expect(transcripts).to.have.length(config.executionCount);
    expect(new Set(transcripts.map((transcript) => transcript.transcriptSource))).to.deep.equal(
      new Set(["hardhat-fhevm-real"]),
    );
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify({ schemaVersion: 1, mode, seed, transcripts }, null, 2)}\n`);
  });
});
