import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WalletButton } from "../../components/WalletButton";
import { LOK_CHAIN_ID } from "../../contracts/addresses";

const walletState = vi.hoisted(() => ({
  address: undefined as `0x${string}` | undefined,
  chainId: undefined as number | undefined,
  isConnected: false,
  isConnecting: false,
  isSwitching: false,
}));

vi.mock("wagmi", () => ({
  useAccount: () => ({
    address: walletState.address,
    chainId: walletState.chainId,
    isConnected: walletState.isConnected,
  }),
  useConnect: () => ({
    connectors: [{ id: "injected" }],
    connect: vi.fn(),
    isPending: walletState.isConnecting,
  }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
  useSwitchChain: () => ({ switchChain: vi.fn(), isPending: walletState.isSwitching }),
}));

describe("WalletButton", () => {
  beforeEach(() => {
    walletState.address = undefined;
    walletState.chainId = undefined;
    walletState.isConnected = false;
    walletState.isConnecting = false;
    walletState.isSwitching = false;
  });

  it("bounds the connected address beside a fixed disconnect control", () => {
    walletState.address = "0xC495123456789012345678901234567890008272";
    walletState.chainId = LOK_CHAIN_ID;
    walletState.isConnected = true;

    const { container } = render(<WalletButton />);

    const group = container.querySelector(".wallet-button-group");
    const address = container.querySelector(".wallet-button__address");
    expect(group).toHaveClass("wallet-button-group");
    expect(address).toHaveTextContent("0xC495...8272");
    expect(address).toHaveAttribute("title", walletState.address);
    expect(screen.getByRole("button", { name: "Disconnect wallet" })).toHaveClass("wallet-button__disconnect");
  });

  it("shows only the network recovery action on the wrong chain", () => {
    walletState.address = "0xC495123456789012345678901234567890008272";
    walletState.chainId = 1;
    walletState.isConnected = true;

    const { container } = render(<WalletButton />);

    expect(screen.getByRole("button", { name: "Switch to Sepolia" })).toBeVisible();
    expect(container.querySelector(".wallet-button__address")).not.toBeInTheDocument();
  });

  it("keeps stable accessible names while wallet actions are pending", () => {
    walletState.isConnecting = true;
    const { rerender } = render(<WalletButton />);
    expect(screen.getByRole("button", { name: "Connect wallet" })).toHaveTextContent("Connecting");

    walletState.address = "0xC495123456789012345678901234567890008272";
    walletState.chainId = 1;
    walletState.isConnected = true;
    walletState.isConnecting = false;
    walletState.isSwitching = true;
    rerender(<WalletButton />);

    expect(screen.getByRole("button", { name: "Switch to Sepolia" })).toHaveTextContent("Switching");
  });
});
