import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZamaProvider } from "@zama-fhe/react-sdk";
import { createConfig as createZamaConfig } from "@zama-fhe/react-sdk/wagmi";
import { IndexedDBStorage } from "@zama-fhe/sdk";
import { sepolia as fheSepolia } from "@zama-fhe/sdk/chains";
import { web } from "@zama-fhe/sdk/web";
import { type PropsWithChildren, useMemo } from "react";
import { createConfig as createWagmiConfig, http, WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";

export const FHEVM_ASSET_BASE = "fhevm/";

export function resolveFhevmAssetUrl(file: string, origin: string, basePath: string): string {
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const relativeBase = normalizedBase.startsWith("/") ? normalizedBase.slice(1) : normalizedBase;
  return new URL(`${relativeBase}${FHEVM_ASSET_BASE}${file}`, `${origin}/`).toString();
}

export function LokProviders({ children }: PropsWithChildren) {
  const configs = useMemo(() => {
    const rpcUrl = import.meta.env.VITE_SEPOLIA_RPC_URL || sepolia.rpcUrls.default.http[0];
    const wagmiConfig = createWagmiConfig({
      chains: [sepolia],
      connectors: [injected()],
      transports: { [sepolia.id]: http(rpcUrl) },
    });
    const zamaConfig = createZamaConfig({
      chains: [fheSepolia],
      relayers: { [fheSepolia.id]: web({ timeout: 30_000, batchRpcCalls: true }) },
      wagmiConfig,
      storage: new IndexedDBStorage("lok-fhe-credentials", 1, "credentials"),
      permitStorage: new IndexedDBStorage("lok-fhe-permits", 1, "permits"),
      runtime: {
        locateFile: (file) => new URL(resolveFhevmAssetUrl(file, globalThis.location.origin, import.meta.env.BASE_URL)),
        wasmAssetLoadMode: "precheck-direct-url",
      },
    });
    return { queryClient: new QueryClient(), wagmiConfig, zamaConfig };
  }, []);

  return (
    <WagmiProvider config={configs.wagmiConfig}>
      <QueryClientProvider client={configs.queryClient}>
        <ZamaProvider config={configs.zamaConfig}>{children}</ZamaProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
