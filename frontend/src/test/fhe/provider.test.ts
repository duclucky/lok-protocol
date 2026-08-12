import { describe, expect, it } from "vitest";

import { FHEVM_ASSET_BASE, resolveFhevmAssetUrl } from "../../fhe/provider";

describe("FHE provider assets", () => {
  it("resolves versioned WASM and worker files under the app base path", () => {
    expect(resolveFhevmAssetUrl("tfhe_bg.v1.6.2.wasm", "https://lok.example", "/demo/")).toBe(
      "https://lok.example/demo/fhevm/tfhe_bg.v1.6.2.wasm",
    );
    expect(FHEVM_ASSET_BASE).toBe("fhevm/");
  });
});
