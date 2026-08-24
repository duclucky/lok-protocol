import { LogOut, WalletCards } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { LOK_CHAIN_ID } from "../contracts/addresses";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, chainId, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  if (isConnected && address !== undefined && chainId !== LOK_CHAIN_ID) {
    return (
      <button
        className="wallet-button wallet-button--network"
        type="button"
        aria-label="Switch to Sepolia"
        onClick={() => switchChain({ chainId: LOK_CHAIN_ID })}
        disabled={isSwitching}
      >
        <span className="network-dot" aria-hidden="true" />
        {isSwitching ? "Switching" : "Switch to Sepolia"}
      </button>
    );
  }

  if (isConnected && address !== undefined) {
    return (
      <div className="wallet-button-group" role="group" aria-label="Connected wallet controls">
        <div className="wallet-button wallet-button--connected" title={address}>
          <span className="network-dot" aria-hidden="true" />
          <span className="wallet-button__address mono" title={address}>
            {shortAddress(address)}
          </span>
        </div>
        <button
          className="wallet-button__disconnect"
          type="button"
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
          onClick={() => disconnect()}
        >
          <LogOut aria-hidden="true" size={17} />
        </button>
      </div>
    );
  }

  const connector = connectors[0];
  return (
    <button
      className="wallet-button"
      type="button"
      aria-label="Connect wallet"
      onClick={() => connector !== undefined && connect({ connector })}
      disabled={connector === undefined || isPending}
    >
      <WalletCards aria-hidden="true" size={18} />
      {isPending ? "Connecting" : "Connect wallet"}
    </button>
  );
}
