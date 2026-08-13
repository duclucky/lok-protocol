export type WalletPublicData =
  | Readonly<{ status: "disconnected" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "error"; message: string }>
  | Readonly<{ status: "ready"; publicUsdc: string }>;

export function formatPublicUsdc(amount: bigint): string {
  const scale = 1_000_000n;
  const whole = amount / scale;
  const cents = ((amount % scale) / 10_000n).toString().padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${cents} USDC`;
}

export function deriveWalletPublicData(input: {
  connected: boolean;
  balance?: bigint;
  error?: Error | null;
}): WalletPublicData {
  if (!input.connected) return { status: "disconnected" };
  if (input.error !== undefined && input.error !== null) {
    return { status: "error", message: "Could not read the connected wallet's public USDC balance." };
  }
  if (input.balance === undefined) return { status: "loading" };
  return { status: "ready", publicUsdc: formatPublicUsdc(input.balance) };
}
