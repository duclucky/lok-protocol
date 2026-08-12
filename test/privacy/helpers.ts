import { time } from "@nomicfoundation/hardhat-network-helpers";
import { ContractTransactionReceipt, Result } from "ethers";
import { fhevm } from "hardhat";

import { asHandle, deployDrawFixture, mintAndDeposit, read, write } from "../draw/helpers";

type DrawInfo = Result & {
  tEnd: bigint;
  cumRunning: bigint;
  cumBaseRiskRunning: bigint;
  cumYieldRunning: bigint;
};

export async function reachPrivacySweepB(participantCount = 5, options: { boundaryDust?: boolean } = {}) {
  if (options.boundaryDust === true && participantCount < 7) {
    throw new Error("Boundary-dust privacy fixture requires at least seven participants");
  }
  const fixture = await deployDrawFixture(true, participantCount);
  const participants = fixture.users.slice(0, participantCount);
  for (let index = 0; index < participants.length; index += 1) {
    const isBoundary = index === 0 || index === participants.length - 1;
    const amount = options.boundaryDust === true && isBoundary ? 1n : 1_000_000n;
    await mintAndDeposit(fixture, participants[index], amount);
  }
  await write(fixture.token, "injectYield", [await fixture.adapter.getAddress(), 1_000n]);
  await write(fixture.draw, "openDraw", [false]);
  const opened = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const settleDelay = (await read(fixture.draw, "MIN_SETTLE_DELAY")) as bigint;
  await time.increaseTo(opened.tEnd + settleDelay);

  let remaining = participants.length;
  while (remaining > 0) {
    const batch = BigInt(Math.min(4, remaining));
    await write(fixture.draw, "preSyncA", [batch]);
    remaining -= Number(batch);
  }
  remaining = participants.length;
  while (remaining > 0) {
    const batch = BigInt(Math.min(3, remaining));
    await write(fixture.draw, "crankA", [batch]);
    remaining -= Number(batch);
  }

  const swept = (await read(fixture.draw, "drawInfo", [1n])) as DrawInfo;
  const handles = [asHandle(swept.cumRunning), asHandle(swept.cumBaseRiskRunning), asHandle(swept.cumYieldRunning)];
  const decrypted = await fhevm.publicDecrypt(handles);
  await write(fixture.draw, "submitTotals", [decrypted.abiEncodedClearValues, decrypted.decryptionProof]);
  await write(fixture.draw, "openRandom");
  return { ...fixture, participants };
}

export async function crankPrivacyParticipants(
  fixture: Awaited<ReturnType<typeof reachPrivacySweepB>>,
): Promise<ContractTransactionReceipt[]> {
  const receipts: ContractTransactionReceipt[] = [];
  for (let index = 0; index < fixture.participants.length; index += 1) {
    const tx = await fixture.draw.getFunction("crankB")(1n);
    const receipt = await tx.wait();
    if (receipt === null) throw new Error("missing crankB receipt");
    receipts.push(receipt);
  }
  return receipts;
}
