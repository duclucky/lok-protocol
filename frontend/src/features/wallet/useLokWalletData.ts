import { useMemo } from "react";
import { useAccount, useReadContract } from "wagmi";

import { mockUsdcAbi } from "../../contracts/abis";
import { sepoliaDeploymentAddresses } from "../../contracts/addresses";
import { deriveWalletPublicData, type WalletPublicData } from "./model";

export function useLokWalletData(): WalletPublicData {
  const { address, isConnected } = useAccount();
  const balance = useReadContract({
    address: sepoliaDeploymentAddresses.underlyingToken,
    abi: mockUsdcAbi,
    functionName: "balanceOf",
    args: [address ?? sepoliaDeploymentAddresses.underlyingToken],
    query: { enabled: address !== undefined },
  });

  return useMemo(
    () =>
      deriveWalletPublicData({
        connected: isConnected && address !== undefined,
        balance: balance.data,
        error: balance.error,
      }),
    [address, balance.data, balance.error, isConnected],
  );
}
