import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";

import { lokDrawManagerAbi, lokVaultAbi, yieldAdapterAbi } from "../../contracts/abis";
import { sepoliaDeploymentAddresses } from "../../contracts/addresses";
import { deriveSolvencyState, drawStateFromChain, type LokPublicData, type PublicDrawSnapshot } from "./model";

const { vault, drawManager, yieldAdapter } = sepoliaDeploymentAddresses;

const publicReads = [
  { address: vault, abi: lokVaultAbi, functionName: "participantCount" },
  { address: vault, abi: lokVaultAbi, functionName: "riskEpoch" },
  { address: vault, abi: lokVaultAbi, functionName: "lastSolventRiskEpoch" },
  { address: vault, abi: lokVaultAbi, functionName: "hasPendingSolvencyCheckpoint" },
  { address: vault, abi: lokVaultAbi, functionName: "restricted" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "drawId" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "state" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "cursor" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "preSyncCursor" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "participantSnapshot" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "revealDeadline" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "stateDeadline" },
  { address: drawManager, abi: lokDrawManagerAbi, functionName: "revealAcc" },
  { address: yieldAdapter, abi: yieldAdapterAbi, functionName: "fundedYieldInAdapter" },
  { address: yieldAdapter, abi: yieldAdapterAbi, functionName: "fundedYieldInVault" },
] as const;

export function useLokPublicData(): LokPublicData {
  const base = useReadContracts({
    contracts: publicReads,
    allowFailure: false,
    query: { refetchInterval: 30_000 },
  });
  const drawId = base.data?.[5];
  const drawInfo = useReadContract({
    address: drawManager,
    abi: lokDrawManagerAbi,
    functionName: "drawInfo",
    args: [drawId ?? 0n],
    query: { enabled: drawId !== undefined && drawId > 0n, refetchInterval: 30_000 },
  });

  return useMemo(() => {
    if (base.error !== null || drawInfo.error !== null) {
      return { status: "error", message: "Could not read the Lok contracts on Ethereum Sepolia." };
    }
    if (base.data === undefined) return { status: "loading" };

    const [
      participantCount,
      riskEpoch,
      lastSolventRiskEpoch,
      pending,
      restricted,
      currentDrawId,
      stateValue,
      cursor,
      preSyncCursor,
      participantSnapshot,
      revealDeadline,
      stateDeadline,
      revealAccumulator,
      fundedYieldInAdapter,
      fundedYieldInVault,
    ] = base.data;

    let draw: PublicDrawSnapshot | undefined;
    if (currentDrawId > 0n) {
      if (drawInfo.data === undefined) return { status: "loading" };
      const info = drawInfo.data;
      draw = {
        id: currentDrawId,
        state: drawStateFromChain(stateValue),
        strict: info.strict,
        settled: info.settled,
        aborted: info.aborted,
        noWinner: info.noWinner,
        tStart: info.tStart,
        tEnd: info.tEnd,
        revealDeadline,
        stateDeadline,
        cursor,
        preSyncCursor,
        participantSnapshot,
        realisedYield: info.realisedYield,
        prizeAmount: info.prizeAmount,
        totalTickets: info.totalTickets,
        totalBaseRiskWeight: info.totalBaseRiskWeight,
        totalYieldWeight: info.totalYieldWeight,
        cumRunning: info.cumRunning,
        cumBaseRiskRunning: info.cumBaseRiskRunning,
        cumYieldRunning: info.cumYieldRunning,
        randomHandle: info.r,
        revealAccumulator,
      };
    }

    return {
      status: "ready",
      snapshot: {
        participantCount,
        riskEpoch,
        solvency: deriveSolvencyState({ restricted, pending, riskEpoch, lastSolventRiskEpoch }),
        fundedYield: fundedYieldInAdapter + fundedYieldInVault,
        draw,
      },
    };
  }, [base.data, base.error, drawInfo.data, drawInfo.error]);
}
