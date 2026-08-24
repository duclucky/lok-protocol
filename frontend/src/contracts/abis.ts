import { parseAbi } from "viem";

export const mockUsdcAbi = parseAbi([
  "function mint(address to,uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
]);

export const confidentialTokenAbi = parseAbi([
  "function confidentialBalanceOf(address user) view returns (bytes32)",
  "function isOperator(address holder,address spender) view returns (bool)",
]);

export const lokVaultAbi = parseAbi([
  "function confidentialBalanceOf(address user) view returns (bytes32)",
  "function currentDrawEnd() view returns (uint64)",
  "function currentDrawId() view returns (uint64)",
  "function deposit(bytes32 encryptedAmount, bytes inputProof)",
  "function emergencyWithdraw()",
  "function exit()",
  "function fortuneOf(address user) view returns (bytes32)",
  "function hasPendingSolvencyCheckpoint() view returns (bool)",
  "function lastActionStatus(address user) view returns (bytes32)",
  "function lastSolventRiskEpoch() view returns (uint64)",
  "function participantCount() view returns (uint256)",
  "function pendingSolvencyRiskEpoch() view returns (uint64)",
  "function principalBalanceOf(address user) view returns (bytes32)",
  "function restricted() view returns (bool)",
  "function riskEpoch() view returns (uint64)",
  "function setTheta(bytes32 encryptedTheta, bytes inputProof)",
  "function thetaOf(address user) view returns (bytes32)",
  "function withdraw(bytes32 encryptedAmount, bytes inputProof)",
  "function withdrawAll()",
]);

export const lokDrawManagerAbi = parseAbi([
  "function abortDraw()",
  "function commitEntropy(bytes32 commitment)",
  "function crankA(uint256 batch)",
  "function crankB(uint256 batch)",
  "function cursor() view returns (uint256)",
  "function drawId() view returns (uint64)",
  "function drawInfo(uint64 id) view returns ((uint64 tStart,uint64 tEnd,bool strict,bool settled,bool aborted,bool totalsSubmitted,bool noWinner,bytes32 cumRunning,bytes32 cumBaseRiskRunning,bytes32 cumYieldRunning,bytes32 cumPrizeCredits,uint64 totalTickets,uint64 totalBaseRiskWeight,uint64 totalYieldWeight,uint64 realisedYield,uint64 prizeAmount,uint128 directRate,bytes32 r))",
  "function enterReveal()",
  "function entropyCommit(uint64 id,address user) view returns (bytes32 commitment)",
  "function entropyRevealed(uint64 id,address user) view returns (bool revealed)",
  "function openDraw(bool strict)",
  "function openRandom()",
  "function participantSnapshot() view returns (uint256)",
  "function paused() view returns (bool)",
  "function preSyncA(uint256 batch)",
  "function preSyncCursor() view returns (uint256)",
  "function prizeCredit(uint64 id,address user) view returns (bytes32 credit)",
  "function remainingInSweep() view returns (uint256)",
  "function revealDeadline() view returns (uint64)",
  "function revealAcc() view returns (bytes32)",
  "function revealEntropy(bytes32 entropy,bytes32 salt)",
  "function state() view returns (uint8)",
  "function stateDeadline() view returns (uint64)",
  "function submitTotals(bytes abiEncodedCleartexts,bytes decryptionProof)",
]);

export const yieldAdapterAbi = parseAbi([
  "function fundedYieldInAdapter() view returns (uint64)",
  "function fundedYieldInVault() view returns (uint64)",
]);
