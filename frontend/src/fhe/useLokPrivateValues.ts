import { useDecryptValues, useGrantPermit, useHasPermit } from "@zama-fhe/react-sdk";
import { useCallback, useMemo } from "react";
import { type Hex, zeroAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { lokDrawManagerAbi, lokVaultAbi } from "../contracts/abis";
import { sepoliaDeploymentAddresses } from "../contracts/addresses";
import { formatUsdc, ZERO_BYTES32 } from "../features/public-data/model";

const { drawManager, vault } = sepoliaDeploymentAddresses;

function clearBigInt(values: Readonly<Record<Hex, unknown>> | undefined, handle: Hex): bigint {
  const value = values?.[handle];
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  throw new Error("The decryption response did not contain the requested value.");
}

export function useLokPrivateValues(drawId?: bigint): {
  revealBalance(): Promise<string>;
  revealCredit(): Promise<bigint>;
} {
  const { address } = useAccount();
  const account = address ?? zeroAddress;
  const balanceRead = useReadContract({
    address: vault,
    abi: lokVaultAbi,
    functionName: "confidentialBalanceOf",
    args: [account],
    query: { enabled: address !== undefined },
  });
  const creditRead = useReadContract({
    address: drawManager,
    abi: lokDrawManagerAbi,
    functionName: "prizeCredit",
    args: [drawId ?? 0n, account],
    query: { enabled: address !== undefined && drawId !== undefined && drawId > 0n },
  });
  const contracts = useMemo(() => (address === undefined ? [] : [vault, drawManager]), [address]);
  const permit = useHasPermit({ contractAddresses: contracts });
  const grantPermit = useGrantPermit();
  const balanceHandle = balanceRead.data;
  const creditHandle = creditRead.data;
  const balanceInputs = useMemo(
    () =>
      balanceHandle === undefined || balanceHandle === ZERO_BYTES32
        ? []
        : [{ encryptedValue: balanceHandle, contractAddress: vault }],
    [balanceHandle],
  );
  const creditInputs = useMemo(
    () =>
      creditHandle === undefined || creditHandle === ZERO_BYTES32
        ? []
        : [{ encryptedValue: creditHandle, contractAddress: drawManager }],
    [creditHandle],
  );
  const balanceDecrypt = useDecryptValues(balanceInputs, { enabled: false, retry: false });
  const creditDecrypt = useDecryptValues(creditInputs, { enabled: false, retry: false });

  const ensurePermit = useCallback(async () => {
    if (address === undefined) throw new Error("Connect a wallet before revealing a private value.");
    if (permit.data !== true) {
      await grantPermit.mutateAsync([vault, drawManager]);
      await permit.refetch();
    }
  }, [address, grantPermit, permit]);

  const revealBalance = useCallback(async () => {
    if (balanceRead.error !== null) throw balanceRead.error;
    if (balanceHandle === undefined) throw new Error("The encrypted balance is not available yet.");
    if (balanceHandle === ZERO_BYTES32) return formatUsdc(0n);
    await ensurePermit();
    const result = await balanceDecrypt.refetch();
    if (result.error !== null) throw result.error;
    return formatUsdc(clearBigInt(result.data, balanceHandle));
  }, [balanceDecrypt, balanceHandle, balanceRead.error, ensurePermit]);

  const revealCredit = useCallback(async () => {
    if (creditRead.error !== null) throw creditRead.error;
    if (creditHandle === undefined) throw new Error("This draw has no encrypted credit for the connected wallet.");
    if (creditHandle === ZERO_BYTES32) return 0n;
    await ensurePermit();
    const result = await creditDecrypt.refetch();
    if (result.error !== null) throw result.error;
    return clearBigInt(result.data, creditHandle);
  }, [creditDecrypt, creditHandle, creditRead.error, ensurePermit]);

  return { revealBalance, revealCredit };
}
