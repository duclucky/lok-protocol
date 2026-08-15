import { useConfidentialSetOperator, useDecryptPublicValues, useEncrypt, useShield } from "@zama-fhe/react-sdk";
import { useMemo } from "react";
import { type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";

import { confidentialTokenAbi, lokDrawManagerAbi, lokVaultAbi, mockUsdcAbi } from "../../contracts/abis";
import { LOK_CHAIN_ID, sepoliaDeploymentAddresses } from "../../contracts/addresses";
import { parseUsdcAmount, riskPercentToTheta, type LokTransactionActions } from "./model";

const { confidentialToken, drawManager, underlyingToken, vault, wrapper } = sepoliaDeploymentAddresses;
const TEST_TOKEN_AMOUNT = 10_000_000n;

export function useLokTransactions(): LokTransactionActions {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: LOK_CHAIN_ID });
  const write = useWriteContract();
  const encrypt = useEncrypt();
  const decryptPublicValues = useDecryptPublicValues();
  const shieldMutation = useShield({ address: wrapper });
  const setOperator = useConfidentialSetOperator(confidentialToken);
  const operator = useReadContract({
    address: confidentialToken,
    abi: confidentialTokenAbi,
    functionName: "isOperator",
    args: [address ?? underlyingToken, vault],
    query: { enabled: address !== undefined && chainId === LOK_CHAIN_ID },
  });

  function requireWallet(): Address {
    if (address === undefined) throw new Error("Connect a wallet before submitting this transaction.");
    if (chainId !== LOK_CHAIN_ID) throw new Error("Switch the wallet to Ethereum Sepolia.");
    if (publicClient === undefined) throw new Error("The Sepolia RPC client is unavailable.");
    return address;
  }

  async function waitForReceipt(hash: Hex): Promise<Hex> {
    if (publicClient === undefined) throw new Error("The Sepolia RPC client is unavailable.");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction reverted on Sepolia.");
    return hash;
  }

  async function encryptForVault(value: bigint, type: "euint8" | "euint64", userAddress: Address) {
    const result = await encrypt.mutateAsync({
      values: [{ value, type }],
      contractAddress: vault,
      userAddress,
    });
    const encryptedValue = result.encryptedValues[0];
    if (encryptedValue === undefined) throw new Error("The relayer returned no encrypted input.");
    return { encryptedValue, inputProof: result.inputProof };
  }

  async function ensureVaultOperator(): Promise<void> {
    if (operator.data === true) return;
    await setOperator.mutateAsync({ operator: vault });
    await operator.refetch();
  }

  return useMemo(
    () => ({
      pending:
        write.isPending ||
        encrypt.isPending ||
        decryptPublicValues.isPending ||
        shieldMutation.isPending ||
        setOperator.isPending ||
        operator.isLoading,
      async mintTestTokens() {
        const userAddress = requireWallet();
        const hash = await write.writeContractAsync({
          address: underlyingToken,
          abi: mockUsdcAbi,
          functionName: "mint",
          args: [userAddress, TEST_TOKEN_AMOUNT],
          chainId: LOK_CHAIN_ID,
        });
        return waitForReceipt(hash);
      },
      async shield(amount) {
        requireWallet();
        const result = await shieldMutation.mutateAsync({ amount: parseUsdcAmount(amount) });
        return result.txHash;
      },
      async deposit(amount) {
        const userAddress = requireWallet();
        await ensureVaultOperator();
        const encrypted = await encryptForVault(parseUsdcAmount(amount), "euint64", userAddress);
        const hash = await write.writeContractAsync({
          address: vault,
          abi: lokVaultAbi,
          functionName: "deposit",
          args: [encrypted.encryptedValue, encrypted.inputProof],
          chainId: LOK_CHAIN_ID,
        });
        return waitForReceipt(hash);
      },
      async setRisk(percent) {
        const userAddress = requireWallet();
        const encrypted = await encryptForVault(riskPercentToTheta(percent), "euint8", userAddress);
        const hash = await write.writeContractAsync({
          address: vault,
          abi: lokVaultAbi,
          functionName: "setTheta",
          args: [encrypted.encryptedValue, encrypted.inputProof],
          chainId: LOK_CHAIN_ID,
        });
        return waitForReceipt(hash);
      },
      async withdraw(amount) {
        const userAddress = requireWallet();
        const encrypted = await encryptForVault(parseUsdcAmount(amount), "euint64", userAddress);
        const hash = await write.writeContractAsync({
          address: vault,
          abi: lokVaultAbi,
          functionName: "withdraw",
          args: [encrypted.encryptedValue, encrypted.inputProof],
          chainId: LOK_CHAIN_ID,
        });
        return waitForReceipt(hash);
      },
      async advanceDraw(action) {
        requireWallet();
        if (action.kind === "submitTotals") {
          const publicDecryption = await decryptPublicValues.mutateAsync([...action.handles]);
          const hash = await write.writeContractAsync({
            address: drawManager,
            abi: lokDrawManagerAbi,
            functionName: "submitTotals",
            args: [publicDecryption.abiEncodedClearValues, publicDecryption.decryptionProof],
            chainId: LOK_CHAIN_ID,
          });
          return waitForReceipt(hash);
        }

        const writeArgs =
          action.kind === "openDraw"
            ? ([action.strict] as const)
            : action.kind === "preSyncA" || action.kind === "crankA" || action.kind === "crankB"
              ? ([action.batch] as const)
              : ([] as const);
        const hash = await write.writeContractAsync({
          address: drawManager,
          abi: lokDrawManagerAbi,
          functionName: action.kind,
          args: writeArgs,
          chainId: LOK_CHAIN_ID,
        });
        return waitForReceipt(hash);
      },
    }),
    [address, chainId, decryptPublicValues, encrypt, operator, publicClient, setOperator, shieldMutation, write],
  );
}
