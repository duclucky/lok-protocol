import { LogOut, WalletCards } from "lucide-react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address !== undefined) {
    return (
      <button className="wallet-button wallet-button--connected" type="button" onClick={() => disconnect()}>
        <span className="network-dot" aria-hidden="true" />
        <span className="mono">{shortAddress(address)}</span>
        <LogOut aria-hidden="true" size={16} />
      </button>
    );
  }

  const connector = connectors[0];
  return (
    <button
      className="wallet-button"
      type="button"
      onClick={() => connector !== undefined && connect({ connector })}
      disabled={connector === undefined || isPending}
    >
      <WalletCards aria-hidden="true" size={18} />
      {isPending ? "Connecting" : "Connect wallet"}
    </button>
  );
}
