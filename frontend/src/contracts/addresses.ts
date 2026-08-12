import { getAddress, isAddress, type Address } from "viem";

export const LOK_CHAIN_ID = 11155111 as const;

export type LokContractAddresses = Readonly<{
  vault: Address;
  drawManager: Address;
  confidentialToken: Address;
  underlyingToken: Address;
  wrapper: Address;
  yieldAdapter: Address;
}>;

type AddressEnvironment = Readonly<Record<string, string | undefined>>;

const addressVariables = {
  vault: "VITE_LOK_VAULT_ADDRESS",
  drawManager: "VITE_LOK_DRAW_MANAGER_ADDRESS",
  confidentialToken: "VITE_CUSDC_ADDRESS",
  underlyingToken: "VITE_USDC_ADDRESS",
  wrapper: "VITE_WRAPPER_ADDRESS",
  yieldAdapter: "VITE_YIELD_ADAPTER_ADDRESS",
} as const;

export function parseContractAddresses(environment: AddressEnvironment): LokContractAddresses {
  return Object.fromEntries(
    Object.entries(addressVariables).map(([key, variable]) => {
      const value = environment[variable];
      if (value === undefined || value === "") throw new Error(`${variable} is missing`);
      if (!isAddress(value)) throw new Error(`${variable} is not an Ethereum address`);
      return [key, getAddress(value)];
    }),
  ) as LokContractAddresses;
}

// DEPLOYMENT-GENERATED:START
export const sepoliaDeploymentAddresses: LokContractAddresses = {
  vault: "0xAA7B956c551B7f5336c2d9e786CB9024aB1657e1",
  drawManager: "0x5592dB13624EB5C20B6Bb5841317148c79DFFAa5",
  confidentialToken: "0x00eB52CF8f64eA64588BB0d427EE93A907Dbe107",
  underlyingToken: "0x68e13782C114A885f754109EF99Cea269eb401b2",
  wrapper: "0x00eB52CF8f64eA64588BB0d427EE93A907Dbe107",
  yieldAdapter: "0xB0FDA68126fC09DED8A7114ad436f2B638D89dfA",
};
// DEPLOYMENT-GENERATED:END
