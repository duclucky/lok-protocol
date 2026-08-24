import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const crossOriginHeaders = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const frontendPackage = JSON.parse(readFileSync(resolve(import.meta.dirname, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const sourceCommit = process.env.VITE_SOURCE_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "unbound-local-build";
const fhevmSdkVersion = frontendPackage.dependencies["@zama-fhe/react-sdk"] ?? "unbound";

const fhevmAssets = [
  ["@fhevm/sdk/wasm/tfhe/v1.5.3/tfhe_bg.wasm", "tfhe_bg.v1.5.3.wasm"],
  ["@fhevm/sdk/wasm/tfhe/v1.5.3/tfhe-worker.mjs", "tfhe-worker.v1.5.3.mjs"],
  ["@fhevm/sdk/wasm/tfhe/v1.6.2/tfhe_bg.wasm", "tfhe_bg.v1.6.2.wasm"],
  ["@fhevm/sdk/wasm/tfhe/v1.6.2/tfhe-worker.mjs", "tfhe-worker.v1.6.2.mjs"],
  ["@fhevm/sdk/wasm/tkms/v0.13.10/kms_lib_bg.wasm", "kms_lib_bg.v0.13.10.wasm"],
  ["@fhevm/sdk/wasm/tkms/v0.13.20-0/kms_lib_bg.wasm", "kms_lib_bg.v0.13.20-0.wasm"],
] as const;

function emitFhevmAssets(): Plugin {
  return {
    name: "emit-fhevm-assets",
    generateBundle() {
      for (const [source, fileName] of fhevmAssets) {
        this.emitFile({
          type: "asset",
          fileName: `fhevm/${fileName}`,
          source: readFileSync(resolve(import.meta.dirname, "node_modules", source)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), emitFhevmAssets()],
  define: {
    "import.meta.env.VITE_FHEVM_SDK_VERSION": JSON.stringify(fhevmSdkVersion),
    "import.meta.env.VITE_SOURCE_COMMIT": JSON.stringify(sourceCommit),
  },
  server: { headers: crossOriginHeaders },
  preview: { headers: crossOriginHeaders },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
