import { useDecryptValues, useGrantPermit, useHasPermit } from "@zama-fhe/react-sdk";
import { useCallback, useMemo } from "react";
import { type Hex, zeroAddress } from "viem";
import { useAccount, useReadContract } from "wagmi";

import { confidentialTokenAbi, lokDrawManagerAbi, lokVaultAbi } from "../contracts/abis";
import { sepoliaDeploymentAddresses } from "../contracts/addresses";
import { formatUsdc, ZERO_BYTES32 } from "../features/public-data/model";
import { clearBigIntValue, clearBoolean, thetaValueToPercent } from "./private-value-model";

const { confidentialToken, drawManager, vault } = sepoliaDeploymentAddresses;

function encryptedInput(handle: Hex | undefined, contractAddress: Hex) {
  return handle === undefined || handle === ZERO_BYTES32 ? [] : [{ encryptedValue: handle, contractAddress }];
}

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
  const balanceHandle = balanceRead.data;
  const creditHandle = creditRead.data;
  const walletCusdcHandle = walletCusdcRead.data;
  const thetaHandle = thetaRead.data;
  const actionStatusHandle = actionStatusRead.data;
  const balanceInputs = useMemo(() => encryptedInput(balanceHandle, vault), [balanceHandle]);
  const creditInputs = useMemo(() => encryptedInput(creditHandle, drawManager), [creditHandle]);
  const walletCusdcInputs = useMemo(
    () => encryptedInput(walletCusdcHandle, confidentialToken),
    [walletCusdcHandle],
  );
  const thetaInputs = useMemo(() => encryptedInput(thetaHandle, vault), [thetaHandle]);
  const actionStatusInputs = useMemo(() => encryptedInput(actionStatusHandle, vault), [actionStatusHandle]);
  const balanceDecrypt = useDecryptValues(balanceInputs, { enabled: false, retry: false });
  const creditDecrypt = useDecryptValues(creditInputs, { enabled: false, retry: false });
  const walletCusdcDecrypt = useDecryptValues(walletCusdcInputs, { enabled: false, retry: false });
  const thetaDecrypt = useDecryptValues(thetaInputs, { enabled: false, retry: false });
  const actionStatusDecrypt = useDecryptValues(actionStatusInputs, { enabled: false, retry: false });

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
    if (balanceRead.error !== null) throw balanceRead.error;
    if (balanceHandle === undefined) throw new Error("The encrypted balance is not available yet.");
    if (balanceHandle === ZERO_BYTES32) return formatUsdc(0n);
    await ensureVaultPermit();
    const result = await balanceDecrypt.refetch();
    if (result.error !== null) throw result.error;
    return formatUsdc(clearBigIntValue(decryptedValue(result.data, balanceHandle)));
  }, [balanceDecrypt, balanceHandle, balanceRead.error, ensureVaultPermit]);

  const revealWalletCusdc = useCallback(async () => {
    if (walletCusdcRead.error !== null) throw walletCusdcRead.error;
    if (walletCusdcHandle === undefined) throw new Error("The encrypted cUSDC balance is not available yet.");
    if (walletCusdcHandle === ZERO_BYTES32) return formatUsdc(0n);
    await ensureTokenPermit();
    const result = await walletCusdcDecrypt.refetch();
    if (result.error !== null) throw result.error;
    return formatUsdc(clearBigIntValue(decryptedValue(result.data, walletCusdcHandle)));
  }, [ensureTokenPermit, walletCusdcDecrypt, walletCusdcHandle, walletCusdcRead.error]);

  const revealTheta = useCallback(async () => {
    if (thetaRead.error !== null) throw thetaRead.error;
    if (thetaHandle === undefined || thetaHandle === ZERO_BYTES32) {
      throw new Error("No encrypted risk setting is available for this wallet.");
    }
    await ensureVaultPermit();
    const result = await thetaDecrypt.refetch();
    if (result.error !== null) throw result.error;
    return thetaValueToPercent(decryptedValue(result.data, thetaHandle));
  }, [ensureVaultPermit, thetaDecrypt, thetaHandle, thetaRead.error]);

  const revealActionStatus = useCallback(async () => {
    if (actionStatusRead.error !== null) throw actionStatusRead.error;
    if (actionStatusHandle === undefined || actionStatusHandle === ZERO_BYTES32) {
      throw new Error("No encrypted action result is available for this wallet.");
    }
    await ensureVaultPermit();
    const result = await actionStatusDecrypt.refetch();
    if (result.error !== null) throw result.error;
    return clearBoolean(decryptedValue(result.data, actionStatusHandle));
  }, [actionStatusDecrypt, actionStatusHandle, actionStatusRead.error, ensureVaultPermit]);

  const revealCredit = useCallback(async () => {
    if (creditRead.error !== null) throw creditRead.error;
    if (creditHandle === undefined) throw new Error("This draw has no encrypted credit for the connected wallet.");
    if (creditHandle === ZERO_BYTES32) return 0n;
    await ensureDrawPermit();
    const result = await creditDecrypt.refetch();
    if (result.error !== null) throw result.error;
    return clearBigIntValue(decryptedValue(result.data, creditHandle));
  }, [creditDecrypt, creditHandle, creditRead.error, ensureDrawPermit]);

  return { revealBalance, revealWalletCusdc, revealTheta, revealActionStatus, revealCredit };
}
