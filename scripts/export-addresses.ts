import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertDeploymentManifest, type DeploymentAddresses } from "./deploy";

type AddressExportInput = { chainId: number; addresses: DeploymentAddresses };

const GENERATED_START = "// DEPLOYMENT-GENERATED:START";
const GENERATED_END = "// DEPLOYMENT-GENERATED:END";

export function renderAddressExport(input: AddressExportInput): string {
  if (input.chainId !== 11155111) throw new Error("Address export only supports Sepolia chain ID 11155111");
  return [
    `VITE_LOK_VAULT_ADDRESS=${input.addresses.vault}`,
    `VITE_LOK_DRAW_MANAGER_ADDRESS=${input.addresses.drawManager}`,
    `VITE_CUSDC_ADDRESS=${input.addresses.confidentialToken}`,
    `VITE_USDC_ADDRESS=${input.addresses.underlyingToken}`,
    `VITE_WRAPPER_ADDRESS=${input.addresses.wrapper}`,
    `VITE_YIELD_ADAPTER_ADDRESS=${input.addresses.yieldAdapter}`,
    "",
  ].join("\n");
}

export function renderGeneratedAddressBlock(addresses: DeploymentAddresses): string {
  return `${GENERATED_START}
export const sepoliaDeploymentAddresses: LokContractAddresses = {
  vault: "${addresses.vault}",
  drawManager: "${addresses.drawManager}",
  confidentialToken: "${addresses.confidentialToken}",
  underlyingToken: "${addresses.underlyingToken}",
  wrapper: "${addresses.wrapper}",
  yieldAdapter: "${addresses.yieldAdapter}",
};
${GENERATED_END}`;
}

function updateGeneratedBlock(source: string, generated: string): string {
  const start = source.indexOf(GENERATED_START);
  const end = source.indexOf(GENERATED_END);
  if (start === -1 && end === -1) return `${source.trimEnd()}\n\n${generated}\n`;
  if (start === -1 || end === -1 || end < start) throw new Error("addresses.ts has a malformed deployment block");
  return `${source.slice(0, start)}${generated}${source.slice(end + GENERATED_END.length)}`;
}

async function main(): Promise<void> {
  const manifestPath = path.join(process.cwd(), "deployments", "sepolia.json");
  const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  assertDeploymentManifest(raw);
  const frontendRoot = path.join(process.cwd(), "frontend");
  await writeFile(path.join(frontendRoot, ".env.production"), renderAddressExport(raw));
  const addressesPath = path.join(frontendRoot, "src", "contracts", "addresses.ts");
  const source = await readFile(addressesPath, "utf8");
  await writeFile(addressesPath, updateGeneratedBlock(source, renderGeneratedAddressBlock(raw.addresses)));
  console.log(JSON.stringify({ status: "PASS", chainId: raw.chainId, addresses: raw.addresses }));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
