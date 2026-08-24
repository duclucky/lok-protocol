import { useGrantPermit, useHasPermit, useZamaSDK } from "@zama-fhe/react-sdk";
import { useCallback, useMemo } from "react";
import { type Hex, zeroAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { confidentialTokenAbi, lokDrawManagerAbi, lokVaultAbi } from "../contracts/abis";
import { sepoliaDeploymentAddresses } from "../contracts/addresses";
import { formatUsdc, ZERO_BYTES32 } from "../features/public-data/model";
import { clearBigIntValue, clearBoolean, thetaValueToPercent } from "./private-value-model";

const { confidentialToken, drawManager, vault } = sepoliaDeploymentAddresses;

function decryptedValue(values: Readonly<Record<Hex, unknown>> | undefined, handle: Hex): unknown {
  const value = values?.[handle];
  if (value === undefined) throw new Error("The decryption response did not contain the requested value.");
  return value;
}

export function useLokPrivateValues(drawId?: bigint): {
  revealBalance(): Promise<string>;
  revealWalletCusdc(): Promise<string>;
  revealTheta(): Promise<number>;
  revealActionStatus(): Promise<boolean>;
  revealCredit(): Promise<bigint>;
} {
  const sdk = useZamaSDK();
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
  const walletCusdcRead = useReadContract({
    address: confidentialToken,
    abi: confidentialTokenAbi,
    functionName: "confidentialBalanceOf",
    args: [account],
    query: { enabled: address !== undefined },
  });
  const thetaRead = useReadContract({
    address: vault,
    abi: lokVaultAbi,
    functionName: "thetaOf",
    args: [account],
    query: { enabled: address !== undefined },
  });
  const actionStatusRead = useReadContract({
    address: vault,
    abi: lokVaultAbi,
    functionName: "lastActionStatus",
    args: [account],
    query: { enabled: address !== undefined },
  });
  const vaultContracts = useMemo(() => (address === undefined ? [] : [vault]), [address]);
  const drawContracts = useMemo(() => (address === undefined ? [] : [drawManager]), [address]);
  const tokenContracts = useMemo(() => (address === undefined ? [] : [confidentialToken]), [address]);
  const vaultPermit = useHasPermit({ contractAddresses: vaultContracts });
  const drawPermit = useHasPermit({ contractAddresses: drawContracts });
  const tokenPermit = useHasPermit({ contractAddresses: tokenContracts });
  const grantPermit = useGrantPermit();

  const ensureVaultPermit = useCallback(async () => {
    if (address === undefined) throw new Error("Connect a wallet before revealing a private value.");
    if (vaultPermit.data !== true) {
      await grantPermit.mutateAsync([vault]);
      const refreshed = await vaultPermit.refetch();
      if (refreshed.data !== true) throw new Error("The Vault decryption permit is not available.");
    }
  }, [address, grantPermit, vaultPermit]);

  const ensureDrawPermit = useCallback(async () => {
    if (address === undefined) throw new Error("Connect a wallet before revealing a private value.");
    if (drawPermit.data !== true) {
      await grantPermit.mutateAsync([drawManager]);
      const refreshed = await drawPermit.refetch();
      if (refreshed.data !== true) throw new Error("The DrawManager decryption permit is not available.");
    }
  }, [address, drawPermit, grantPermit]);

  const ensureTokenPermit = useCallback(async () => {
    if (address === undefined) throw new Error("Connect a wallet before revealing a private value.");
    if (tokenPermit.data !== true) {
      await grantPermit.mutateAsync([confidentialToken]);
      const refreshed = await tokenPermit.refetch();
      if (refreshed.data !== true) throw new Error("The cUSDC decryption permit is not available.");
    }
  }, [address, grantPermit, tokenPermit]);

  const revealBalance = useCallback(async () => {
    const refreshed = await balanceRead.refetch();
    if (refreshed.error !== null) throw refreshed.error;
    const currentHandle = refreshed.data;
    if (currentHandle === undefined) throw new Error("The encrypted balance is not available yet.");
    if (currentHandle === ZERO_BYTES32) return formatUsdc(0n);
    await ensureVaultPermit();
    const result = await sdk.decryption.decryptValues([{ encryptedValue: currentHandle, contractAddress: vault }]);
    return formatUsdc(clearBigIntValue(decryptedValue(result, currentHandle)));
  }, [balanceRead, ensureVaultPermit, sdk.decryption]);

  const revealWalletCusdc = useCallback(async () => {
    const refreshed = await walletCusdcRead.refetch();
    if (refreshed.error !== null) throw refreshed.error;
    const currentHandle = refreshed.data;
    if (currentHandle === undefined) throw new Error("The encrypted cUSDC balance is not available yet.");
    if (currentHandle === ZERO_BYTES32) return formatUsdc(0n);
    await ensureTokenPermit();
    const result = await sdk.decryption.decryptValues([
      { encryptedValue: currentHandle, contractAddress: confidentialToken },
    ]);
    return formatUsdc(clearBigIntValue(decryptedValue(result, currentHandle)));
  }, [ensureTokenPermit, sdk.decryption, walletCusdcRead]);

  const revealTheta = useCallback(async () => {
    const refreshed = await thetaRead.refetch();
    if (refreshed.error !== null) throw refreshed.error;
    const currentHandle = refreshed.data;
    if (currentHandle === undefined || currentHandle === ZERO_BYTES32) {
      throw new Error("No encrypted risk setting is available for this wallet.");
    }
    await ensureVaultPermit();
    const result = await sdk.decryption.decryptValues([{ encryptedValue: currentHandle, contractAddress: vault }]);
    return thetaValueToPercent(decryptedValue(result, currentHandle));
  }, [ensureVaultPermit, sdk.decryption, thetaRead]);

  const revealActionStatus = useCallback(async () => {
    if (actionStatusRead.error !== null) throw actionStatusRead.error;
    const refreshed = await actionStatusRead.refetch();
    if (refreshed.error !== null) throw refreshed.error;
    const currentHandle = refreshed.data;
    if (currentHandle === undefined || currentHandle === ZERO_BYTES32) {
      throw new Error("No encrypted action result is available for this wallet.");
    }
    await ensureVaultPermit();
    const result = await sdk.decryption.decryptValues([{ encryptedValue: currentHandle, contractAddress: vault }]);
    return clearBoolean(decryptedValue(result, currentHandle));
  }, [actionStatusRead, ensureVaultPermit, sdk.decryption]);

  const revealCredit = useCallback(async () => {
    const refreshed = await creditRead.refetch();
    if (refreshed.error !== null) throw refreshed.error;
    const currentHandle = refreshed.data;
    if (currentHandle === undefined) throw new Error("This draw has no encrypted credit for the connected wallet.");
    if (currentHandle === ZERO_BYTES32) return 0n;
    await ensureDrawPermit();
    const result = await sdk.decryption.decryptValues([
      { encryptedValue: currentHandle, contractAddress: drawManager },
    ]);
    return clearBigIntValue(decryptedValue(result, currentHandle));
  }, [creditRead, ensureDrawPermit, sdk.decryption]);

  return { revealBalance, revealWalletCusdc, revealTheta, revealActionStatus, revealCredit };
}
