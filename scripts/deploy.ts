import { AbiCoder, BaseContract, Interface, ZeroAddress, getAddress, isAddress, isHexString, keccak256 } from "ethers";
import type { DeployResult } from "hardhat-deploy/types";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { artifacts, deployments, ethers, fhevm, network } from "hardhat";
import { vars } from "hardhat/config";

const SEPOLIA_CHAIN_ID = 11155111;
const MANIFEST_PATH = path.join(process.cwd(), "deployments", "sepolia.json");
const ETHERSCAN_V2_URL = "https://api.etherscan.io/v2/api";
export const SEPOLIA_DRAW_TIMING = {
  drawPeriod: 60,
  minSettleDelay: 24,
  revealWindow: 120,
  stateTimeout: 300,
} as const;
export const SEPOLIA_DEPLOYMENT_NAMES = {
  underlyingToken: "LokMinimumTimingMockUSDC",
  confidentialToken: "LokMinimumTimingConfidentialToken",
  yieldAdapter: "LokMinimumTimingMockYieldAdapter",
  vault: "LokMinimumTimingVault",
  drawManager: "LokMinimumTimingDrawManager",
} as const;

type DeploymentAddress = string;

export type DeploymentAddresses = {
  underlyingToken: DeploymentAddress;
  confidentialToken: DeploymentAddress;
  wrapper: DeploymentAddress;
  yieldAdapter: DeploymentAddress;
  vault: DeploymentAddress;
  drawManager: DeploymentAddress;
  guardian: DeploymentAddress | null;
};

export type ContractDeploymentRecord = {
  name: string;
  address: DeploymentAddress;
  constructorArgs: readonly string[];
  deployTransactionHash: string;
  deployBlockNumber: number;
  runtimeBytecodeHash: string;
  etherscanUrl: string;
  verified: boolean;
};

export type SepoliaDeploymentManifest = {
  schemaVersion: 1;
  network: "sepolia";
  chainId: 11155111;
  deployedAt: string;
  commit: string;
  owner: DeploymentAddress;
  timing: typeof SEPOLIA_DRAW_TIMING;
  versions: {
    fhevm: string;
    fhevmSolidity: string;
    fhevmHardhatPlugin: string;
    openzeppelinConfidentialContracts: string;
    hardhat: string;
  };
  addresses: DeploymentAddresses;
  contracts: {
    underlyingToken: ContractDeploymentRecord;
    confidentialToken: ContractDeploymentRecord;
    yieldAdapter: ContractDeploymentRecord;
    vault: ContractDeploymentRecord;
    drawManager: ContractDeploymentRecord;
  };
  configuration: {
    adapterVaultBindingTxHash: string;
    drawManagerBindingTxHash: string;
    solvencyCheckpointOpenTxHash: string;
    solvencyCheckpointSubmitTxHash: string;
  };
  rolePolicy: {
    guardian: "omitted";
    guardianReason: string;
    ownerPowers: readonly string[];
    demoFundPower: "none";
  };
};

type EtherscanResponse = { status: string; message: string; result: string };
type EtherscanResponseState = "accepted" | "pending" | "verified" | "failed";

export function buildEtherscanV2Form(input: {
  apiKey: string;
  address: string;
  contractName: string;
  compilerVersion: string;
  constructorArguments: string;
  standardJsonInput: unknown;
}): URLSearchParams {
  return new URLSearchParams({
    apikey: input.apiKey,
    chainid: SEPOLIA_CHAIN_ID.toString(),
    module: "contract",
    action: "verifysourcecode",
    contractaddress: input.address,
    sourceCode: JSON.stringify(input.standardJsonInput),
    codeformat: "solidity-standard-json-input",
    contractname: input.contractName,
    compilerversion: input.compilerVersion.startsWith("v") ? input.compilerVersion : `v${input.compilerVersion}`,
    constructorArguments: input.constructorArguments.replace(/^0x/, ""),
  });
}

export function classifyEtherscanResponse(response: EtherscanResponse): EtherscanResponseState {
  if (/already verified|pass\s*-\s*verified/i.test(response.result)) return "verified";
  if (/pending in queue/i.test(response.result)) return "pending";
  return response.status === "1" ? "accepted" : "failed";
}

export function etherscanV2Url(form: URLSearchParams): string {
  const chainId = form.get("chainid");
  if (chainId === null || chainId === "") throw new Error("Etherscan V2 chainid is required");
  return `${ETHERSCAN_V2_URL}?chainid=${encodeURIComponent(chainId)}`;
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
}

function assertAddress(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !isAddress(value)) throw new Error(`${label} must be an Ethereum address`);
}

function assertHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !isHexString(value, 32)) throw new Error(`${label} must be a 32-byte hash`);
}

export function assertDeploymentManifest(value: unknown): asserts value is SepoliaDeploymentManifest {
  if (typeof value !== "object" || value === null) throw new Error("deployment manifest must be an object");
  const candidate = value as Partial<SepoliaDeploymentManifest>;
  if (candidate.schemaVersion !== 1) throw new Error("deployment schemaVersion must be 1");
  if (candidate.network !== "sepolia" || candidate.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("deployment must target Sepolia chain ID 11155111");
  }
  assertString(candidate.deployedAt, "deployedAt");
  assertString(candidate.commit, "commit");
  assertAddress(candidate.owner, "owner");
  if (candidate.timing === undefined) throw new Error("timing is required");
  for (const [key, expected] of Object.entries(SEPOLIA_DRAW_TIMING) as Array<
    [keyof typeof SEPOLIA_DRAW_TIMING, number]
  >) {
    if (candidate.timing[key] !== expected) throw new Error(`timing.${key} must be ${expected}`);
  }
  if (candidate.versions === undefined) throw new Error("versions are required");
  for (const [key, version] of Object.entries(candidate.versions)) assertString(version, `versions.${key}`);
  if (candidate.addresses === undefined) throw new Error("addresses are required");
  for (const key of [
    "underlyingToken",
    "confidentialToken",
    "wrapper",
    "yieldAdapter",
    "vault",
    "drawManager",
  ] as const) {
    assertAddress(candidate.addresses[key], `addresses.${key}`);
  }
  if (candidate.addresses.guardian !== null) assertAddress(candidate.addresses.guardian, "addresses.guardian");
  if (getAddress(candidate.addresses.wrapper) !== getAddress(candidate.addresses.confidentialToken)) {
    throw new Error("wrapper must alias the deployed confidential token");
  }
  if (candidate.contracts === undefined) throw new Error("contracts are required");
  for (const key of ["underlyingToken", "confidentialToken", "yieldAdapter", "vault", "drawManager"] as const) {
    const record = candidate.contracts[key];
    if (record === undefined) throw new Error(`contracts.${key} is required`);
    assertString(record.name, `contracts.${key}.name`);
    assertAddress(record.address, `contracts.${key}.address`);
    if (getAddress(record.address) !== getAddress(candidate.addresses[key])) {
      throw new Error(`contracts.${key}.address does not match addresses.${key}`);
    }
    if (!Array.isArray(record.constructorArgs)) throw new Error(`contracts.${key}.constructorArgs must be an array`);
    assertHash(record.deployTransactionHash, `contracts.${key}.deployTransactionHash`);
    if (!Number.isSafeInteger(record.deployBlockNumber) || record.deployBlockNumber < 0) {
      throw new Error(`contracts.${key}.deployBlockNumber must be a non-negative integer`);
    }
    assertHash(record.runtimeBytecodeHash, `contracts.${key}.runtimeBytecodeHash`);
    assertString(record.etherscanUrl, `contracts.${key}.etherscanUrl`);
    if (typeof record.verified !== "boolean") throw new Error(`contracts.${key}.verified must be boolean`);
  }
  const expectedDrawArgs = [
    candidate.addresses.vault,
    candidate.owner,
    SEPOLIA_DRAW_TIMING.drawPeriod.toString(),
    SEPOLIA_DRAW_TIMING.minSettleDelay.toString(),
    SEPOLIA_DRAW_TIMING.revealWindow.toString(),
    SEPOLIA_DRAW_TIMING.stateTimeout.toString(),
  ];
  const actualDrawArgs = candidate.contracts.drawManager.constructorArgs;
  if (
    actualDrawArgs.length !== expectedDrawArgs.length ||
    actualDrawArgs.some((value, index) => {
      const expected = expectedDrawArgs[index];
      if (index < 2) return !isAddress(value) || getAddress(value) !== getAddress(expected);
      return value !== expected;
    })
  ) {
    throw new Error("contracts.drawManager.constructorArgs do not match the reviewed timing profile");
  }
  if (candidate.configuration === undefined) throw new Error("configuration is required");
  for (const [key, hash] of Object.entries(candidate.configuration)) assertHash(hash, `configuration.${key}`);
  if (candidate.rolePolicy?.guardian !== "omitted" || candidate.rolePolicy.demoFundPower !== "none") {
    throw new Error("rolePolicy must record the reviewed no-guardian/no-demo-fund-power deployment");
  }
  assertString(candidate.rolePolicy.guardianReason, "rolePolicy.guardianReason");
  if (!Array.isArray(candidate.rolePolicy.ownerPowers)) throw new Error("rolePolicy.ownerPowers must be an array");
}

export async function canReuseDeployment(
  manifest: SepoliaDeploymentManifest,
  getCode: (address: string) => Promise<string>,
): Promise<boolean> {
  try {
    assertDeploymentManifest(manifest);
  } catch {
    return false;
  }
  for (const record of Object.values(manifest.contracts)) {
    const code = await getCode(record.address);
    if (code === "0x" || keccak256(code) !== record.runtimeBytecodeHash) return false;
  }
  return true;
}

async function sourceRevision(): Promise<string> {
  const override = process.env.LOK_COMMIT_SHA;
  if (override !== undefined && override.trim() !== "") return override.trim();
  const files = [
    "contracts/LokVault.sol",
    "contracts/LokDrawManager.sol",
    "contracts/adapters/MockYieldAdapter.sol",
    "contracts/test/YieldInjectingERC7984.sol",
    "hardhat.config.ts",
    "package-lock.json",
  ];
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file);
    digest.update(await readFile(path.join(process.cwd(), file)));
  }
  return `source-sha256:${digest.digest("hex")}`;
}

async function readExistingManifest(): Promise<SepoliaDeploymentManifest | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    assertDeploymentManifest(parsed);
    return parsed;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function waitForTransactionHash(tx: { hash: string; wait(): Promise<unknown> }): Promise<string> {
  await tx.wait();
  return tx.hash;
}

async function deploymentRecord(
  deployment: DeployResult,
  name: string,
  constructorArgs: readonly string[],
): Promise<ContractDeploymentRecord> {
  if (deployment.transactionHash === undefined || deployment.receipt === undefined) {
    throw new Error(`${name} has incomplete hardhat-deploy evidence`);
  }
  const code = await ethers.provider.getCode(deployment.address);
  if (code === "0x") throw new Error(`${name} has no runtime bytecode`);
  return {
    name,
    address: deployment.address,
    constructorArgs,
    deployTransactionHash: deployment.transactionHash,
    deployBlockNumber: deployment.receipt.blockNumber,
    runtimeBytecodeHash: keccak256(code),
    etherscanUrl: `https://sepolia.etherscan.io/address/${deployment.address}`,
    verified: false,
  };
}

async function latestEventTransactionHash(
  contract: BaseContract,
  eventName: string,
  fromBlock: number,
): Promise<string> {
  const event = contract.interface.getEvent(eventName);
  if (event === null) throw new Error(`${eventName} is missing from ${await contract.getAddress()} ABI`);
  const logs = await ethers.provider.getLogs({
    address: await contract.getAddress(),
    topics: [event.topicHash],
    fromBlock,
    toBlock: "latest",
  });
  if (logs.length === 0) throw new Error(`No ${eventName} event exists for resumed deployment`);
  return logs[logs.length - 1].transactionHash;
}

async function ensureBinding(
  contract: BaseContract,
  getter: string,
  setter: string,
  eventName: string,
  expected: string,
  fromBlock: number,
): Promise<string> {
  const current = (await contract.getFunction(getter).staticCall()) as string;
  if (getAddress(current) === getAddress(expected)) {
    return latestEventTransactionHash(contract, eventName, fromBlock);
  }
  if (getAddress(current) !== ZeroAddress) throw new Error(`${getter} is bound to unexpected address ${current}`);
  return waitForTransactionHash(await contract.getFunction(setter)(expected));
}

async function ensureInitialSolvency(
  vault: BaseContract,
  fromBlock: number,
): Promise<{ open: string; submit: string }> {
  const riskEpoch = (await vault.getFunction("riskEpoch").staticCall()) as bigint;
  const authorizedEpoch = (await vault.getFunction("lastSolventRiskEpoch").staticCall()) as bigint;
  if (authorizedEpoch === riskEpoch) {
    return {
      open: await latestEventTransactionHash(vault, "SolvencyCheckpointOpened", fromBlock),
      submit: await latestEventTransactionHash(vault, "SolvencyCheckpointSubmitted", fromBlock),
    };
  }
  const pending = (await vault.getFunction("hasPendingSolvencyCheckpoint").staticCall()) as boolean;
  const open = pending
    ? await latestEventTransactionHash(vault, "SolvencyCheckpointOpened", fromBlock)
    : await waitForTransactionHash(await vault.getFunction("openSolvencyCheckpoint")());
  const checkpointHandle = (await vault.getFunction("pendingSolvencyHandle").staticCall()) as `0x${string}`;
  const checkpoint = await fhevm.publicDecrypt([checkpointHandle]);
  if (checkpoint.clearValues[checkpointHandle] !== true)
    throw new Error("Initial empty-vault solvency checkpoint is false");
  const epoch = (await vault.getFunction("pendingSolvencyRiskEpoch").staticCall()) as bigint;
  const nonce = (await vault.getFunction("solvencyCheckpointNonce").staticCall()) as bigint;
  const submit = await waitForTransactionHash(
    await vault.getFunction("submitSolvencyCheckpoint")(
      epoch,
      nonce,
      checkpoint.abiEncodedClearValues,
      checkpoint.decryptionProof,
    ),
  );
  return { open, submit };
}

async function assertLiveConfiguration(manifest: SepoliaDeploymentManifest): Promise<void> {
  const adapter = await ethers.getContractAt("MockYieldAdapter", manifest.addresses.yieldAdapter);
  const vault = await ethers.getContractAt("LokVault", manifest.addresses.vault);
  const draw = await ethers.getContractAt("LokDrawManager", manifest.addresses.drawManager);
  const token = await ethers.getContractAt("YieldInjectingERC7984", manifest.addresses.confidentialToken);
  const checks: Array<[string, string, string]> = [
    ["adapter.vault", (await adapter.getFunction("vault").staticCall()) as string, manifest.addresses.vault],
    [
      "vault.drawManager",
      (await vault.getFunction("drawManager").staticCall()) as string,
      manifest.addresses.drawManager,
    ],
    ["vault.cToken", (await vault.getFunction("cToken").staticCall()) as string, manifest.addresses.confidentialToken],
    [
      "vault.activeAdapter",
      (await vault.getFunction("activeAdapter").staticCall()) as string,
      manifest.addresses.yieldAdapter,
    ],
    ["draw.vault", (await draw.getFunction("vault").staticCall()) as string, manifest.addresses.vault],
    [
      "token.underlying",
      (await token.getFunction("underlying").staticCall()) as string,
      manifest.addresses.underlyingToken,
    ],
    ["adapter.owner", (await adapter.getFunction("owner").staticCall()) as string, manifest.owner],
    ["vault.owner", (await vault.getFunction("owner").staticCall()) as string, manifest.owner],
    ["draw.owner", (await draw.getFunction("owner").staticCall()) as string, manifest.owner],
  ];
  for (const [label, actual, expected] of checks) {
    if (getAddress(actual) !== getAddress(expected)) throw new Error(`${label} is ${actual}, expected ${expected}`);
  }
  const riskEpoch = (await vault.getFunction("riskEpoch").staticCall()) as bigint;
  const authorizedEpoch = (await vault.getFunction("lastSolventRiskEpoch").staticCall()) as bigint;
  if (riskEpoch !== authorizedEpoch) throw new Error(`risk epoch ${riskEpoch} is not checkpoint-authorized`);
  for (const [getter, expected] of [
    ["DRAW_PERIOD", manifest.timing.drawPeriod],
    ["MIN_SETTLE_DELAY", manifest.timing.minSettleDelay],
    ["REVEAL_WINDOW", manifest.timing.revealWindow],
    ["STATE_TIMEOUT", manifest.timing.stateTimeout],
  ] as const) {
    const actual = (await draw.getFunction(getter).staticCall()) as bigint;
    if (actual !== BigInt(expected)) throw new Error(`draw.${getter} is ${actual}, expected ${expected}`);
  }
}

async function etherscanRequest(form: URLSearchParams): Promise<EtherscanResponse> {
  const body = new URLSearchParams(form);
  const url = etherscanV2Url(body);
  body.delete("chainid");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Etherscan HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Partial<EtherscanResponse>).status !== "string" ||
    typeof (value as Partial<EtherscanResponse>).message !== "string" ||
    typeof (value as Partial<EtherscanResponse>).result !== "string"
  ) {
    throw new Error("Etherscan returned a malformed response");
  }
  return value as EtherscanResponse;
}

async function waitForEtherscanVerification(guid: string, apiKey: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const response = await etherscanRequest(
      new URLSearchParams({
        apikey: apiKey,
        chainid: SEPOLIA_CHAIN_ID.toString(),
        module: "contract",
        action: "checkverifystatus",
        guid,
      }),
    );
    const state = classifyEtherscanResponse(response);
    if (state === "verified") return;
    if (state === "failed") throw new Error(response.result);
  }
  throw new Error("Etherscan verification polling timed out");
}

async function verifyContractV2(record: ContractDeploymentRecord, apiKey: string): Promise<void> {
  const names = await artifacts.getAllFullyQualifiedNames();
  const matches = names.filter((name) => name.endsWith(`:${record.name}`));
  if (matches.length !== 1) throw new Error(`Expected one fully-qualified artifact for ${record.name}`);
  const fullyQualifiedName = matches[0];
  const [artifact, buildInfo] = await Promise.all([
    artifacts.readArtifact(fullyQualifiedName),
    artifacts.getBuildInfo(fullyQualifiedName),
  ]);
  if (buildInfo === undefined) throw new Error(`Build info is missing for ${fullyQualifiedName}`);
  const constructorTypes = new Interface(artifact.abi).deploy.inputs.map((input) => input.format());
  const constructorArguments = AbiCoder.defaultAbiCoder().encode(constructorTypes, record.constructorArgs);
  const response = await etherscanRequest(
    buildEtherscanV2Form({
      apiKey,
      address: record.address,
      contractName: fullyQualifiedName,
      compilerVersion: buildInfo.solcLongVersion,
      constructorArguments,
      standardJsonInput: buildInfo.input,
    }),
  );
  const state = classifyEtherscanResponse(response);
  if (state === "verified") return;
  if (state === "failed") throw new Error(response.result);
  await waitForEtherscanVerification(response.result, apiKey);
}

async function verifyManifestContracts(manifest: SepoliaDeploymentManifest): Promise<void> {
  const apiKey = vars.get("ETHERSCAN_API_KEY", "");
  if (apiKey === "") throw new Error("ETHERSCAN_API_KEY is required for Etherscan V2 verification");
  for (const record of Object.values(manifest.contracts)) {
    if (record.verified) continue;
    try {
      await verifyContractV2(record, apiKey);
      record.verified = true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Etherscan verification failed for ${record.name}: ${message}`);
    }
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

async function deployFresh(): Promise<SepoliaDeploymentManifest> {
  await fhevm.initializeCLIApi();
  if (fhevm.isMock) throw new Error("Sepolia deployment refuses the mock FHEVM backend");
  const [owner] = await ethers.getSigners();
  if (owner === undefined) throw new Error("No deployer configured in Hardhat vars");

  const underlyingRecord = await deploymentRecord(
    await deployments.deploy(SEPOLIA_DEPLOYMENT_NAMES.underlyingToken, {
      from: owner.address,
      contract: "MockUSDC",
      args: [],
      log: true,
    }),
    "MockUSDC",
    [],
  );
  const confidentialTokenRecord = await deploymentRecord(
    await deployments.deploy(SEPOLIA_DEPLOYMENT_NAMES.confidentialToken, {
      from: owner.address,
      contract: "YieldInjectingERC7984",
      args: [underlyingRecord.address],
      log: true,
    }),
    "YieldInjectingERC7984",
    [underlyingRecord.address],
  );
  const adapterRecord = await deploymentRecord(
    await deployments.deploy(SEPOLIA_DEPLOYMENT_NAMES.yieldAdapter, {
      from: owner.address,
      contract: "MockYieldAdapter",
      args: [confidentialTokenRecord.address, owner.address],
      log: true,
    }),
    "MockYieldAdapter",
    [confidentialTokenRecord.address, owner.address],
  );
  const vaultRecord = await deploymentRecord(
    await deployments.deploy(SEPOLIA_DEPLOYMENT_NAMES.vault, {
      from: owner.address,
      contract: "LokVault",
      args: [confidentialTokenRecord.address, adapterRecord.address, owner.address],
      log: true,
    }),
    "LokVault",
    [confidentialTokenRecord.address, adapterRecord.address, owner.address],
  );
  const drawManagerRecord = await deploymentRecord(
    await deployments.deploy(SEPOLIA_DEPLOYMENT_NAMES.drawManager, {
      from: owner.address,
      contract: "LokDrawManager",
      args: [
        vaultRecord.address,
        owner.address,
        SEPOLIA_DRAW_TIMING.drawPeriod,
        SEPOLIA_DRAW_TIMING.minSettleDelay,
        SEPOLIA_DRAW_TIMING.revealWindow,
        SEPOLIA_DRAW_TIMING.stateTimeout,
      ],
      log: true,
    }),
    "LokDrawManager",
    [
      vaultRecord.address,
      owner.address,
      SEPOLIA_DRAW_TIMING.drawPeriod.toString(),
      SEPOLIA_DRAW_TIMING.minSettleDelay.toString(),
      SEPOLIA_DRAW_TIMING.revealWindow.toString(),
      SEPOLIA_DRAW_TIMING.stateTimeout.toString(),
    ],
  );
  const adapter = await ethers.getContractAt("MockYieldAdapter", adapterRecord.address, owner);
  const vault = await ethers.getContractAt("LokVault", vaultRecord.address, owner);
  const adapterVaultBindingTxHash = await ensureBinding(
    adapter,
    "vault",
    "setVault",
    "VaultBound",
    vaultRecord.address,
    adapterRecord.deployBlockNumber,
  );
  const drawManagerBindingTxHash = await ensureBinding(
    vault,
    "drawManager",
    "setDrawManager",
    "DrawManagerSet",
    drawManagerRecord.address,
    vaultRecord.deployBlockNumber,
  );
  const checkpoint = await ensureInitialSolvency(vault, vaultRecord.deployBlockNumber);

  const addresses: DeploymentAddresses = {
    underlyingToken: underlyingRecord.address,
    confidentialToken: confidentialTokenRecord.address,
    wrapper: confidentialTokenRecord.address,
    yieldAdapter: adapterRecord.address,
    vault: vaultRecord.address,
    drawManager: drawManagerRecord.address,
    guardian: null,
  };
  return {
    schemaVersion: 1,
    network: "sepolia",
    chainId: SEPOLIA_CHAIN_ID,
    deployedAt: new Date().toISOString(),
    commit: await sourceRevision(),
    owner: owner.address,
    timing: SEPOLIA_DRAW_TIMING,
    versions: {
      fhevm: "0.13",
      fhevmSolidity: "0.11.1",
      fhevmHardhatPlugin: "0.4.2",
      openzeppelinConfidentialContracts: "0.5.2",
      hardhat: "2.28.6",
    },
    addresses,
    contracts: {
      underlyingToken: underlyingRecord,
      confidentialToken: confidentialTokenRecord,
      yieldAdapter: adapterRecord,
      vault: vaultRecord,
      drawManager: drawManagerRecord,
    },
    configuration: {
      adapterVaultBindingTxHash,
      drawManagerBindingTxHash,
      solvencyCheckpointOpenTxHash: checkpoint.open,
      solvencyCheckpointSubmitTxHash: checkpoint.submit,
    },
    rolePolicy: {
      guardian: "omitted",
      guardianReason: "No threshold configuration with two independent signers was supplied.",
      ownerPowers: ["pause future draws", "timelocked adapter configuration"],
      demoFundPower: "none",
    },
  };
}

async function main(): Promise<void> {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (network.name !== "sepolia" || chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("deploy.ts only supports Ethereum Sepolia chain ID 11155111");
  }
  let manifest = await readExistingManifest();
  if (manifest !== null) {
    if (!(await canReuseDeployment(manifest, (address) => ethers.provider.getCode(address)))) {
      throw new Error("Existing Sepolia manifest is stale or bytecode-mismatched; refusing an ambiguous redeploy");
    }
    console.log(`REUSE ${manifest.addresses.vault}`);
  } else {
    manifest = await deployFresh();
    assertDeploymentManifest(manifest);
    await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  await assertLiveConfiguration(manifest);
  if (process.env.LOK_SKIP_VERIFY !== "1") await verifyManifestContracts(manifest);
  console.log(JSON.stringify({ status: "PASS", manifest: MANIFEST_PATH, addresses: manifest.addresses }, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
