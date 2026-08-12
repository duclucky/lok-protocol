import { describe, expect, it } from "vitest";

import { lokDrawManagerAbi, lokVaultAbi } from "../../contracts/abis";
import { parseContractAddresses } from "../../contracts/addresses";

const validEnvironment = {
  VITE_LOK_VAULT_ADDRESS: "0x0000000000000000000000000000000000000001",
  VITE_LOK_DRAW_MANAGER_ADDRESS: "0x0000000000000000000000000000000000000002",
  VITE_CUSDC_ADDRESS: "0x0000000000000000000000000000000000000003",
  VITE_USDC_ADDRESS: "0x0000000000000000000000000000000000000004",
  VITE_WRAPPER_ADDRESS: "0x0000000000000000000000000000000000000005",
  VITE_YIELD_ADAPTER_ADDRESS: "0x0000000000000000000000000000000000000006",
};

describe("Sepolia contract surface", () => {
  it("rejects a missing or malformed address", () => {
    expect(() => parseContractAddresses({})).toThrow("VITE_LOK_VAULT_ADDRESS is missing");
    expect(() => parseContractAddresses({ ...validEnvironment, VITE_LOK_VAULT_ADDRESS: "not-an-address" })).toThrow(
      "VITE_LOK_VAULT_ADDRESS is not an Ethereum address",
    );
  });

  it("parses the complete immutable address schema", () => {
    expect(parseContractAddresses(validEnvironment)).toEqual({
      vault: validEnvironment.VITE_LOK_VAULT_ADDRESS,
      drawManager: validEnvironment.VITE_LOK_DRAW_MANAGER_ADDRESS,
      confidentialToken: validEnvironment.VITE_CUSDC_ADDRESS,
      underlyingToken: validEnvironment.VITE_USDC_ADDRESS,
      wrapper: validEnvironment.VITE_WRAPPER_ADDRESS,
      yieldAdapter: validEnvironment.VITE_YIELD_ADAPTER_ADDRESS,
    });
  });

  it("ships the encrypted input, status, and result ABI entries", () => {
    const vaultNames = lokVaultAbi.map((entry) => ("name" in entry ? entry.name : undefined));
    const drawNames = lokDrawManagerAbi.map((entry) => ("name" in entry ? entry.name : undefined));

    expect(vaultNames).toEqual(
      expect.arrayContaining(["deposit", "withdraw", "setTheta", "lastActionStatus", "principalBalanceOf"]),
    );
    expect(drawNames).toEqual(
      expect.arrayContaining(["state", "drawInfo", "prizeCredit", "commitEntropy", "revealEntropy"]),
    );
  });
});
