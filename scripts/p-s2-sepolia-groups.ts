import {
  AbiCoder,
  BaseContract,
  ContractTransactionResponse,
  TransactionReceipt,
  ZeroAddress,
  getAddress,
  isHexString,
  keccak256,
} from "ethers";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { artifacts, ethers, fhevm, network } from "hardhat";

import { assertDeploymentManifest, canReuseDeployment, SepoliaDeploymentManifest } from "./deploy";

const ROOT = process.cwd();
const DEPLOYMENT_PATH = path.join(ROOT, "deployments", "sepolia.json");
export function resolvePS2EvidenceDir(root: string, override?: string): string {
  return path.resolve(root, override ?? path.join("artifacts", "sepolia", "p-s2-groups-2026-08-13"));
}

const EVIDENCE_DIR = resolvePS2EvidenceDir(ROOT, process.env.LOK_P_S2_EVIDENCE_DIR);
const LEDGER_PATH = path.join(EVIDENCE_DIR, "ledger.json");
const ABI = AbiCoder.defaultAbiCoder();
const UINT48_MAX = 2n ** 48n - 1n;
const FIXTURE_PRINCIPAL = 10_000_000n;
const SECOND_DEPOSIT = 2_000_000n;
const PARTIAL_WITHDRAW = 3_000_000n;
const FIXTURE_YIELD = 5_000_000n;

type Group = "A" | "B";
type Phase = "preflight-a" | "preflight-b" | "group-a" | "group-b-1" | "group-b-2" | "status";
type Hex = `0x${string}`;

export function drawSettleAt(tEnd: bigint, minSettleDelay: bigint): bigint {
  return tEnd + minSettleDelay;
}

export function assertSharedDeploymentMatches(
  expected: SepoliaDeploymentManifest["addresses"],
  actual: SepoliaDeploymentManifest["addresses"],
): void {
  for (const key of Object.keys(expected) as Array<keyof SepoliaDeploymentManifest["addresses"]>) {
    const expectedAddress = expected[key];
    const actualAddress = actual[key];
    if (expectedAddress === null || actualAddress === null) {
      if (expectedAddress !== actualAddress) throw new Error(`Evidence ledger sharedDeployment.${key} mismatch`);
      continue;
    }
    if (getAddress(expectedAddress) !== getAddress(actualAddress)) {
      throw new Error(`Evidence ledger sharedDeployment.${key} mismatch`);
    }
  }
}

type Budget = {
  txCap: number;
  gasCap: bigint;
  ethCapWei: bigint;
  deploymentTxCap?: number;
  deploymentGasCap?: bigint;
  deploymentEthCapWei?: bigint;
};

const BUDGETS: Record<Group, Budget> = {
  A: { txCap: 62, gasCap: 110_000_000n, ethCapWei: ethers.parseEther("0.22") },
  B: {
    txCap: 39,
    gasCap: 38_000_000n,
    ethCapWei: ethers.parseEther("0.08"),
    deploymentTxCap: 5,
    deploymentGasCap: 11_800_000n,
    deploymentEthCapWei: ethers.parseEther("0.025"),
  },
};

type StoredProof = {
  handle: Hex;
  epoch: string;
  nonce: string;
  clearValues: Record<string, boolean | string>;
  abiEncodedClearValues: Hex;
  decryptionProof: Hex;
};

type StepRecord = {
  id: string;
  group: Group;
  kind: "transaction" | "deployment";
  expected: "success" | "revert";
  target: string;
  method: string;
  transactionHash: string;
  blockNumber: number;
  status: number;
  gasUsed: string;
  gasPrice: string;
  feeWei: string;
  gasCeiling: string;
  beforeState: unknown;
  afterState: unknown;
  revertData?: string;
  revertName?: string;
  artifact: string;
  artifactSha256: string;
};

type Ledger = {
  schemaVersion: 1;
  createdAtUtc: string;
  updatedAtUtc: string;
  network: "sepolia";
  chainId: 11155111;
  operator: string;
  sourceHead: string;
  codeTestCommit: string;
  manifestPath: string;
  sharedDeployment: SepoliaDeploymentManifest["addresses"];
  authorization: {
    admissionGasPriceCeilingRemoved: true;
    groupA: { txCap: 62; gasCap: "110000000"; ethCapWei: string };
    groupB: {
      txCap: 39;
      deploymentTxCap: 5;
      gasCap: "38000000";
      ethCapWei: string;
      deploymentGasCap: "11800000";
      deploymentEthCapWei: string;
    };
  };
  preflights: Array<Record<string, unknown>>;
  steps: StepRecord[];
  proofs: Record<string, StoredProof>;
  dedicated?: {
    addresses: Partial<Record<"underlying" | "token" | "malicious" | "vault" | "honest", string>>;
    runtimeBytecodeHashes: Partial<Record<"underlying" | "token" | "malicious" | "vault" | "honest", string>>;
    activateAfter?: string;
    exitRequestId?: string;
  };
  shared?: { exitRequestId?: string };
};

function json(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item), 2) + "\n";
}

function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function writeHashed(relativePath: string, value: unknown): Promise<{ path: string; sha256: string }> {
  const absolute = path.join(EVIDENCE_DIR, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  const body = json(value);
  const digest = sha256(body);
  await writeFile(absolute, body, "utf8");
  await writeFile(`${absolute}.sha256`, `${digest}  ${path.basename(absolute)}\n`, "utf8");
  return { path: path.relative(ROOT, absolute).replaceAll("\\", "/"), sha256: digest };
}

async function readLedger(manifest: SepoliaDeploymentManifest, operator: string): Promise<Ledger> {
  try {
    const ledger = JSON.parse(await readFile(LEDGER_PATH, "utf8")) as Ledger;
    if (getAddress(ledger.operator) !== getAddress(operator)) throw new Error("Evidence ledger operator mismatch");
    assertSharedDeploymentMatches(manifest.addresses, ledger.sharedDeployment);
    return ledger;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const head = (await runGit(["rev-parse", "HEAD"])).trim();
    return {
      schemaVersion: 1,
      createdAtUtc: new Date().toISOString(),
      updatedAtUtc: new Date().toISOString(),
      network: "sepolia",
      chainId: 11155111,
      operator,
      sourceHead: head,
      codeTestCommit: "65ff43262778a1c073d1d2f413a11d9c57cb98a5",
      manifestPath: "docs/proofs/P-S2-sepolia-execution-manifest-2026-08-13.md",
      sharedDeployment: manifest.addresses,
      authorization: {
        admissionGasPriceCeilingRemoved: true,
        groupA: { txCap: 62, gasCap: "110000000", ethCapWei: ethers.parseEther("0.22").toString() },
        groupB: {
          txCap: 39,
          deploymentTxCap: 5,
          gasCap: "38000000",
          ethCapWei: ethers.parseEther("0.08").toString(),
          deploymentGasCap: "11800000",
          deploymentEthCapWei: ethers.parseEther("0.025").toString(),
        },
      },
      preflights: [],
      steps: [],
      proofs: {},
    };
  }
}

async function saveLedger(ledger: Ledger): Promise<void> {
  ledger.updatedAtUtc = new Date().toISOString();
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const body = json(ledger);
  await writeFile(LEDGER_PATH, body, "utf8");
  await writeFile(`${LEDGER_PATH}.sha256`, `${sha256(body)}  ledger.json\n`, "utf8");
}

async function runGit(args: string[]): Promise<string> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd: ROOT, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

function normalizeHandle(value: bigint | string): Hex {
  if (typeof value === "bigint") return `0x${value.toString(16).padStart(64, "0")}` as Hex;
  if (!isHexString(value, 32)) throw new Error(`Invalid encrypted handle ${value}`);
  return value as Hex;
}

function asNumber(value: bigint | number): number {
  return typeof value === "number" ? value : Number(value);
}

function hasStep(ledger: Ledger, id: string): boolean {
  return ledger.steps.some((step) => step.id === id);
}

async function proofOrDecrypt(
  ledger: Ledger,
  label: string,
  decrypt: () => Promise<StoredProof>,
): Promise<StoredProof> {
  return ledger.proofs[label] ?? decrypt();
}

function groupTotals(
  ledger: Ledger,
  group: Group,
): { count: number; gas: bigint; fee: bigint; deployments: number; deploymentGas: bigint; deploymentFee: bigint } {
  const rows = ledger.steps.filter((step) => step.group === group);
  const deployments = rows.filter((step) => step.kind === "deployment");
  return {
    count: rows.length,
    gas: rows.reduce((sum, step) => sum + BigInt(step.gasUsed), 0n),
    fee: rows.reduce((sum, step) => sum + BigInt(step.feeWei), 0n),
    deployments: deployments.length,
    deploymentGas: deployments.reduce((sum, step) => sum + BigInt(step.gasUsed), 0n),
    deploymentFee: deployments.reduce((sum, step) => sum + BigInt(step.feeWei), 0n),
  };
}

async function assertBudgetBefore(
  ledger: Ledger,
  group: Group,
  gasCeiling: bigint,
  deployment: boolean,
): Promise<void> {
  const budget = BUDGETS[group];
  const totals = groupTotals(ledger, group);
  if (totals.count >= budget.txCap) throw new Error(`${group} transaction cap reached`);
  if (totals.gas + gasCeiling > budget.gasCap) throw new Error(`${group} hard gas stop would be exceeded`);
  if (deployment) {
    if (budget.deploymentTxCap === undefined || totals.deployments >= budget.deploymentTxCap) {
      throw new Error(`${group} deployment transaction cap reached`);
    }
    if (budget.deploymentGasCap === undefined || totals.deploymentGas + gasCeiling > budget.deploymentGasCap) {
      throw new Error(`${group} deployment gas sub-cap would be exceeded`);
    }
  }
  const [signer] = await ethers.getSigners();
  if (signer === undefined) throw new Error("Sepolia signer unavailable");
  const balance = await ethers.provider.getBalance(signer.address);
  const remainingCurrent = budget.ethCapWei - totals.fee;
  const other: Group = group === "A" ? "B" : "A";
  const otherTotals = groupTotals(ledger, other);
  const otherStarted = otherTotals.count > 0 && otherTotals.count < BUDGETS[other].txCap;
  const remainingOther = otherStarted ? BUDGETS[other].ethCapWei - otherTotals.fee : 0n;
  if (balance < remainingCurrent + remainingOther) {
    throw new Error(
      `Insufficient Sepolia ETH to preserve remaining approved group budgets: balance=${balance}, required=${remainingCurrent + remainingOther}`,
    );
  }
}

function assertBudgetAfter(ledger: Ledger, group: Group): void {
  const budget = BUDGETS[group];
  const totals = groupTotals(ledger, group);
  if (totals.count > budget.txCap || totals.gas > budget.gasCap || totals.fee > budget.ethCapWei) {
    throw new Error(`${group} hard budget exceeded after mined receipt`);
  }
  if (
    totals.deployments > (budget.deploymentTxCap ?? Number.MAX_SAFE_INTEGER) ||
    totals.deploymentGas > (budget.deploymentGasCap ?? 2n ** 255n) ||
    totals.deploymentFee > (budget.deploymentEthCapWei ?? 2n ** 255n)
  ) {
    throw new Error(`${group} deployment sub-cap exceeded after mined receipt`);
  }
}

async function sharedState(manifest: SepoliaDeploymentManifest, operator: string): Promise<Record<string, unknown>> {
  const token = await ethers.getContractAt("YieldInjectingERC7984", manifest.addresses.confidentialToken);
  const adapter = await ethers.getContractAt("MockYieldAdapter", manifest.addresses.yieldAdapter);
  const vault = await ethers.getContractAt("LokVault", manifest.addresses.vault);
  const draw = await ethers.getContractAt("LokDrawManager", manifest.addresses.drawManager);
  const id = (await draw.getFunction("drawId").staticCall()) as bigint;
  const info = await draw.getFunction("drawInfo").staticCall(id);
  return {
    participantCount: (await vault.getFunction("participantCount").staticCall()).toString(),
    participantIndex: (await vault.getFunction("participantIndex").staticCall(operator)).toString(),
    accountingVersion: (await vault.getFunction("accountingVersion").staticCall()).toString(),
    riskEpoch: (await vault.getFunction("riskEpoch").staticCall()).toString(),
    lastSolventRiskEpoch: (await vault.getFunction("lastSolventRiskEpoch").staticCall()).toString(),
    restricted: await vault.getFunction("restricted").staticCall(),
    pendingCheckpoint: await vault.getFunction("hasPendingSolvencyCheckpoint").staticCall(),
    pendingEpoch: (await vault.getFunction("pendingSolvencyRiskEpoch").staticCall()).toString(),
    pendingAccountingVersion: (await vault.getFunction("pendingSolvencyAccountingVersion").staticCall()).toString(),
    checkpointNonce: (await vault.getFunction("solvencyCheckpointNonce").staticCall()).toString(),
    checkpointHandle: await vault.getFunction("pendingSolvencyHandle").staticCall(),
    activeAdapter: await vault.getFunction("activeAdapter").staticCall(),
    retiringAdapter: await vault.getFunction("retiringAdapter").staticCall(),
    retiringAdapterDrained: await vault.getFunction("retiringAdapterDrained").staticCall(),
    operatorIsTokenOperator: await token.getFunction("isOperator").staticCall(operator, manifest.addresses.vault),
    fundedYieldInAdapter: (await adapter.getFunction("fundedYieldInAdapter").staticCall()).toString(),
    fundedYieldInVault: (await adapter.getFunction("fundedYieldInVault").staticCall()).toString(),
    drawState: (await draw.getFunction("state").staticCall()).toString(),
    drawId: id.toString(),
    drawCursor: (await draw.getFunction("cursor").staticCall()).toString(),
    preSyncCursor: (await draw.getFunction("preSyncCursor").staticCall()).toString(),
    participantSnapshot: (await draw.getFunction("participantSnapshot").staticCall()).toString(),
    drawTEnd: info.tEnd.toString(),
    drawSettled: info.settled,
    pendingExit: await vault.getFunction("pendingExitRequest").staticCall(operator),
  };
}

async function dedicatedState(ledger: Ledger, operator: string): Promise<Record<string, unknown>> {
  const addresses = ledger.dedicated?.addresses;
  if (addresses?.vault === undefined) return { deployed: false, addresses: addresses ?? {} };
  const vault = await ethers.getContractAt("LokVault", addresses.vault);
  const token =
    addresses.token === undefined ? undefined : await ethers.getContractAt("YieldInjectingERC7984", addresses.token);
  return {
    deployed: true,
    addresses,
    participantCount: (await vault.getFunction("participantCount").staticCall()).toString(),
    participantIndex: (await vault.getFunction("participantIndex").staticCall(operator)).toString(),
    accountingVersion: (await vault.getFunction("accountingVersion").staticCall()).toString(),
    riskEpoch: (await vault.getFunction("riskEpoch").staticCall()).toString(),
    lastSolventRiskEpoch: (await vault.getFunction("lastSolventRiskEpoch").staticCall()).toString(),
    restricted: await vault.getFunction("restricted").staticCall(),
    pendingCheckpoint: await vault.getFunction("hasPendingSolvencyCheckpoint").staticCall(),
    pendingEpoch: (await vault.getFunction("pendingSolvencyRiskEpoch").staticCall()).toString(),
    pendingAccountingVersion: (await vault.getFunction("pendingSolvencyAccountingVersion").staticCall()).toString(),
    checkpointNonce: (await vault.getFunction("solvencyCheckpointNonce").staticCall()).toString(),
    checkpointHandle: await vault.getFunction("pendingSolvencyHandle").staticCall(),
    activeAdapter: await vault.getFunction("activeAdapter").staticCall(),
    proposedAdapter: await vault.getFunction("proposedAdapter").staticCall(),
    activateAfter: (await vault.getFunction("adapterActivateAfter").staticCall()).toString(),
    retiringAdapter: await vault.getFunction("retiringAdapter").staticCall(),
    retiringAdapterDrained: await vault.getFunction("retiringAdapterDrained").staticCall(),
    operatorIsTokenOperator:
      token === undefined ? false : await token.getFunction("isOperator").staticCall(operator, addresses.vault),
    pendingExit: await vault.getFunction("pendingExitRequest").staticCall(operator),
  };
}

function comparableState(value: Record<string, unknown>): string {
  return JSON.stringify(value);
}

async function captureRevertData(
  tx: ContractTransactionResponse,
  blockNumber: number,
): Promise<{ data?: string; name?: string }> {
  try {
    await ethers.provider.call({
      from: tx.from,
      to: tx.to ?? undefined,
      data: tx.data,
      value: tx.value,
      blockTag: blockNumber,
    });
    return {};
  } catch (error: unknown) {
    const candidate = error as { data?: string; error?: { data?: string } };
    const data = candidate.data ?? candidate.error?.data;
    return typeof data === "string" ? { data } : {};
  }
}

async function minedReceipt(tx: ContractTransactionResponse): Promise<TransactionReceipt> {
  try {
    const receipt = await tx.wait();
    if (receipt === null) throw new Error(`Transaction ${tx.hash} was not mined`);
    return receipt;
  } catch (error: unknown) {
    const candidate = error as { receipt?: TransactionReceipt };
    const receipt = candidate.receipt ?? (await ethers.provider.getTransactionReceipt(tx.hash));
    if (receipt === null || receipt === undefined) throw error;
    return receipt;
  }
}

async function recordReceipt(input: {
  ledger: Ledger;
  id: string;
  group: Group;
  kind: "transaction" | "deployment";
  expected: "success" | "revert";
  target: string;
  method: string;
  gasCeiling: bigint;
  tx: ContractTransactionResponse;
  receipt: TransactionReceipt;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  revertName?: string;
  revertData?: string;
}): Promise<void> {
  const fee = input.receipt.gasUsed * input.receipt.gasPrice;
  const block = await ethers.provider.getBlock(input.receipt.blockNumber);
  const raw = {
    schemaVersion: 1,
    id: input.id,
    group: input.group,
    expected: input.expected,
    target: input.target,
    method: input.method,
    transaction: input.tx.toJSON(),
    receipt: input.receipt.toJSON(),
    block: block?.toJSON() ?? null,
    rawLogs: input.receipt.logs.map((log) => ({
      address: log.address,
      topics: [...log.topics],
      data: log.data,
      index: log.index,
      transactionHash: log.transactionHash,
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
    })),
    beforeState: input.beforeState,
    afterState: input.afterState,
    revertName: input.revertName,
    revertData: input.revertData,
  };
  const artifact = await writeHashed(path.join("receipts", `${input.id}.json`), raw);
  input.ledger.steps.push({
    id: input.id,
    group: input.group,
    kind: input.kind,
    expected: input.expected,
    target: input.target,
    method: input.method,
    transactionHash: input.receipt.hash,
    blockNumber: input.receipt.blockNumber,
    status: input.receipt.status ?? -1,
    gasUsed: input.receipt.gasUsed.toString(),
    gasPrice: input.receipt.gasPrice.toString(),
    feeWei: fee.toString(),
    gasCeiling: input.gasCeiling.toString(),
    beforeState: input.beforeState,
    afterState: input.afterState,
    revertData: input.revertData,
    revertName: input.revertName,
    artifact: artifact.path,
    artifactSha256: artifact.sha256,
  });
  assertBudgetAfter(input.ledger, input.group);
  await saveLedger(input.ledger);
  console.log(json({ status: "RECORDED", id: input.id, hash: input.receipt.hash, gasUsed: input.receipt.gasUsed }));
}

async function sendStep(input: {
  ledger: Ledger;
  id: string;
  group: Group;
  contract: BaseContract;
  method: string;
  args?: readonly unknown[];
  gasCeiling: bigint;
  expected?: "success" | "revert";
  expectedError?: string;
  state: () => Promise<Record<string, unknown>>;
  assertAfter?: (
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    receipt: TransactionReceipt,
  ) => Promise<void> | void;
}): Promise<TransactionReceipt | undefined> {
  if (input.ledger.steps.some((step) => step.id === input.id)) return undefined;
  const expected = input.expected ?? "success";
  await assertBudgetBefore(input.ledger, input.group, input.gasCeiling, false);
  const before = await input.state();
  const args = [...(input.args ?? [])];
  if (expected === "success") {
    const estimate = (await input.contract.getFunction(input.method).estimateGas(...args)) as bigint;
    if (estimate > input.gasCeiling)
      throw new Error(`${input.id} estimate ${estimate} exceeds ceiling ${input.gasCeiling}`);
  }
  const tx = (await input.contract.getFunction(input.method)(...args, {
    gasLimit: input.gasCeiling,
  })) as ContractTransactionResponse;
  const receipt = await minedReceipt(tx);
  const expectedStatus = expected === "success" ? 1 : 0;
  if (receipt.status !== expectedStatus)
    throw new Error(`${input.id} receipt status ${receipt.status}, expected ${expectedStatus}`);
  if (receipt.gasUsed > input.gasCeiling) throw new Error(`${input.id} used gas above ceiling`);
  const after = await input.state();
  let revertData: string | undefined;
  let revertName: string | undefined;
  if (expected === "revert") {
    if (comparableState(before) !== comparableState(after))
      throw new Error(`${input.id} expected revert mutated protected state`);
    const captured = await captureRevertData(tx, receipt.blockNumber);
    revertData = captured.data;
    if (revertData !== undefined) {
      try {
        revertName = input.contract.interface.parseError(revertData)?.name;
      } catch {
        revertName = undefined;
      }
    }
    if (input.expectedError !== undefined && revertName !== input.expectedError) {
      throw new Error(
        `${input.id} expected ${input.expectedError}, got ${revertName ?? revertData ?? "unknown revert"}`,
      );
    }
  }
  await input.assertAfter?.(before, after, receipt);
  await recordReceipt({
    ledger: input.ledger,
    id: input.id,
    group: input.group,
    kind: "transaction",
    expected,
    target: await input.contract.getAddress(),
    method: input.method,
    gasCeiling: input.gasCeiling,
    tx,
    receipt,
    beforeState: before,
    afterState: after,
    revertName,
    revertData,
  });
  return receipt;
}

async function deployStep(input: {
  ledger: Ledger;
  id: string;
  name: string;
  args: readonly unknown[];
  gasCeiling: bigint;
  key: "underlying" | "token" | "malicious" | "vault" | "honest";
}): Promise<string> {
  const existing = input.ledger.dedicated?.addresses[input.key];
  if (input.ledger.steps.some((step) => step.id === input.id)) {
    if (existing === undefined) throw new Error(`${input.id} recorded without address`);
    return existing;
  }
  await assertBudgetBefore(input.ledger, "B", input.gasCeiling, true);
  const before = await dedicatedState(input.ledger, input.ledger.operator);
  const factory = await ethers.getContractFactory(input.name);
  const deployTx = await factory.getDeployTransaction(...input.args);
  const [operator] = await ethers.getSigners();
  if (operator === undefined) throw new Error("Sepolia signer unavailable");
  const estimate = await operator.estimateGas(deployTx);
  if (estimate > input.gasCeiling) throw new Error(`${input.id} deployment estimate ${estimate} exceeds ceiling`);
  const contract = await factory.deploy(...input.args, { gasLimit: input.gasCeiling });
  const tx = contract.deploymentTransaction();
  if (tx === null) throw new Error(`${input.id} missing deployment transaction`);
  const receipt = await minedReceipt(tx);
  if (receipt.status !== 1) throw new Error(`${input.id} deployment failed`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${input.id} deployed no runtime bytecode`);
  input.ledger.dedicated ??= { addresses: {}, runtimeBytecodeHashes: {} };
  input.ledger.dedicated.addresses[input.key] = address;
  input.ledger.dedicated.runtimeBytecodeHashes[input.key] = keccak256(code);
  const after = await dedicatedState(input.ledger, input.ledger.operator);
  await recordReceipt({
    ledger: input.ledger,
    id: input.id,
    group: "B",
    kind: "deployment",
    expected: "success",
    target: address,
    method: `deploy ${input.name}`,
    gasCeiling: input.gasCeiling,
    tx,
    receipt,
    beforeState: before,
    afterState: after,
  });
  return address;
}

async function decryptPublic(label: string, handles: Hex[], ledger: Ledger): Promise<StoredProof> {
  const result = await fhevm.publicDecrypt(handles);
  const clearValues = Object.fromEntries(
    Object.entries(result.clearValues).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  );
  const proof: StoredProof = {
    handle: handles[0],
    epoch: "0",
    nonce: "0",
    clearValues,
    abiEncodedClearValues: result.abiEncodedClearValues as Hex,
    decryptionProof: result.decryptionProof as Hex,
  };
  ledger.proofs[label] = proof;
  await writeHashed(path.join("decryptions", `${label}.json`), { label, handles, ...proof });
  await saveLedger(ledger);
  return proof;
}

async function decryptCheckpoint(label: string, vault: BaseContract, ledger: Ledger): Promise<StoredProof> {
  const handle = normalizeHandle((await vault.getFunction("pendingSolvencyHandle").staticCall()) as string);
  const proof = await decryptPublic(label, [handle], ledger);
  proof.epoch = ((await vault.getFunction("pendingSolvencyRiskEpoch").staticCall()) as bigint).toString();
  proof.nonce = ((await vault.getFunction("solvencyCheckpointNonce").staticCall()) as bigint).toString();
  ledger.proofs[label] = proof;
  await writeHashed(path.join("decryptions", `${label}.json`), { label, handles: [handle], ...proof });
  await saveLedger(ledger);
  return proof;
}

function boolFromProof(proof: StoredProof): boolean {
  const value = proof.clearValues[proof.handle];
  if (typeof value !== "boolean") throw new Error(`Expected boolean decryption for ${proof.handle}`);
  return value;
}

function tamperProof(proof: string): string {
  if (!isHexString(proof) || proof.length < 4) throw new Error("Cannot tamper malformed proof");
  const last = Number.parseInt(proof.slice(-2), 16) ^ 1;
  return `${proof.slice(0, -2)}${last.toString(16).padStart(2, "0")}`;
}

async function assertActionTrue(
  vault: BaseContract,
  operator: Awaited<ReturnType<typeof ethers.getSigners>>[number],
): Promise<void> {
  const handle = normalizeHandle((await vault.getFunction("lastActionStatus").staticCall(operator.address)) as string);
  const value = await fhevm.userDecryptEbool(handle, await vault.getAddress(), operator);
  if (!value) throw new Error("Encrypted action status is false");
}

async function extractExitRequest(vault: BaseContract, receipt: TransactionReceipt): Promise<Hex> {
  for (const log of receipt.logs) {
    try {
      const parsed = vault.interface.parseLog(log);
      if (parsed?.name === "ExitRequested") return parsed.args.requestId as Hex;
    } catch {
      // Protocol logs outside the vault ABI are retained in the raw receipt artifact.
    }
  }
  throw new Error("ExitRequested event missing");
}

async function waitUntil(timestamp: bigint): Promise<void> {
  for (;;) {
    const block = await ethers.provider.getBlock("latest");
    if (block === null) throw new Error("Latest block unavailable");
    if (BigInt(block.timestamp) >= timestamp) return;
    const waitMs = Number((timestamp - BigInt(block.timestamp)) * 1000n);
    console.log(json({ status: "WAITING", until: timestamp, seconds: Math.ceil(waitMs / 1000) }));
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 15_000)));
  }
}

async function preflight(manifest: SepoliaDeploymentManifest, ledger: Ledger, label: "A" | "B"): Promise<void> {
  const networkInfo = await ethers.provider.getNetwork();
  if (networkInfo.chainId !== 11155111n) throw new Error("Hard stop: network is not Ethereum Sepolia");
  if (!(await canReuseDeployment(manifest, (address) => ethers.provider.getCode(address)))) {
    throw new Error("Hard stop: shared runtime bytecode differs from deployment manifest");
  }
  const [operator] = await ethers.getSigners();
  if (operator === undefined || getAddress(operator.address) !== getAddress(manifest.owner)) {
    throw new Error("Hard stop: operator does not match deployment manifest");
  }
  const adapter = await ethers.getContractAt("MockYieldAdapter", manifest.addresses.yieldAdapter);
  const vault = await ethers.getContractAt("LokVault", manifest.addresses.vault);
  const draw = await ethers.getContractAt("LokDrawManager", manifest.addresses.drawManager);
  const token = await ethers.getContractAt("YieldInjectingERC7984", manifest.addresses.confidentialToken);
  const topology = {
    adapterVault: await adapter.getFunction("vault").staticCall(),
    vaultDrawManager: await vault.getFunction("drawManager").staticCall(),
    vaultToken: await vault.getFunction("cToken").staticCall(),
    vaultActiveAdapter: await vault.getFunction("activeAdapter").staticCall(),
    drawVault: await draw.getFunction("vault").staticCall(),
    tokenUnderlying: await token.getFunction("underlying").staticCall(),
  };
  const expected = {
    adapterVault: manifest.addresses.vault,
    vaultDrawManager: manifest.addresses.drawManager,
    vaultToken: manifest.addresses.confidentialToken,
    vaultActiveAdapter: manifest.addresses.yieldAdapter,
    drawVault: manifest.addresses.vault,
    tokenUnderlying: manifest.addresses.underlyingToken,
  };
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (getAddress(topology[key] as string) !== getAddress(expected[key]))
      throw new Error(`Hard stop: ${key} mismatch`);
  }
  const state = await sharedState(manifest, operator.address);
  if (label === "A") {
    if (
      state.drawState !== "7" ||
      state.participantCount !== "30" ||
      state.pendingCheckpoint !== false ||
      state.restricted !== false ||
      state.riskEpoch !== state.lastSolventRiskEpoch ||
      getAddress(state.retiringAdapter as string) !== ZeroAddress ||
      state.participantIndex !== "0"
    ) {
      throw new Error(`Hard stop: shared state differs from Group A manifest: ${JSON.stringify(state)}`);
    }
  }
  const feeData = await ethers.provider.getFeeData();
  const block = await ethers.provider.getBlock("latest");
  const entry = {
    label,
    generatedAtUtc: new Date().toISOString(),
    blockNumber: block?.number,
    blockTimestamp: block?.timestamp,
    operator: operator.address,
    balanceWei: (await ethers.provider.getBalance(operator.address)).toString(),
    feeData: {
      gasPrice: feeData.gasPrice?.toString(),
      maxFeePerGas: feeData.maxFeePerGas?.toString(),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas?.toString(),
      admissionCeilingRemoved: true,
    },
    topology,
    sharedState: state,
    frozenSectionDiffEmpty: (await runGit(["diff", "--", "docs/10-proof-strategy.md"])).trim() === "",
    executableDiffFromCodeCommit: (
      await runGit([
        "diff",
        "--name-only",
        "65ff43262778a1c073d1d2f413a11d9c57cb98a5..HEAD",
        "--",
        "contracts",
        "test",
        "test-foundry",
        "spec",
      ])
    ).trim(),
  };
  if (!entry.frozenSectionDiffEmpty || entry.executableDiffFromCodeCommit !== "") {
    throw new Error("Hard stop: frozen section or executable source differs from manifest basis");
  }
  ledger.preflights.push(entry);
  await writeHashed(`preflight-${label.toLowerCase()}-${ledger.preflights.length}.json`, entry);
  await saveLedger(ledger);
  console.log(json({ status: "PREFLIGHT_PASS", label, block: block?.number, balanceWei: entry.balanceWei }));
}

async function preflightDedicatedPhase2(
  manifest: SepoliaDeploymentManifest,
  ledger: Ledger,
  operatorAddress: string,
): Promise<void> {
  await preflight(manifest, ledger, "B");
  const addresses = ledger.dedicated?.addresses;
  const hashes = ledger.dedicated?.runtimeBytecodeHashes;
  if (
    addresses?.underlying === undefined ||
    addresses.token === undefined ||
    addresses.malicious === undefined ||
    addresses.vault === undefined ||
    addresses.honest === undefined
  ) {
    throw new Error("Hard stop: dedicated deployment addresses incomplete");
  }
  for (const key of ["underlying", "token", "malicious", "vault", "honest"] as const) {
    const code = await ethers.provider.getCode(addresses[key]!);
    if (code === "0x" || hashes?.[key] === undefined || keccak256(code) !== hashes[key]) {
      throw new Error(`Hard stop: dedicated ${key} runtime bytecode mismatch`);
    }
  }
  const totals = groupTotals(ledger, "B");
  if (totals.count !== 22 || totals.deployments !== 5 || !hasStep(ledger, "D22")) {
    throw new Error("Hard stop: Group B phase 1 ledger is not exactly D01-D22 with five deployments");
  }
  const state = await dedicatedState(ledger, operatorAddress);
  if (
    state.participantCount !== "1" ||
    state.pendingCheckpoint !== true ||
    state.restricted !== false ||
    state.riskEpoch !== "1" ||
    state.riskEpoch !== state.lastSolventRiskEpoch ||
    getAddress(state.activeAdapter as string) !== getAddress(addresses.malicious) ||
    getAddress(state.proposedAdapter as string) !== getAddress(addresses.honest) ||
    getAddress(state.retiringAdapter as string) !== ZeroAddress ||
    state.retiringAdapterDrained !== false
  ) {
    throw new Error(`Hard stop: dedicated state differs from pre-D23 manifest: ${JSON.stringify(state)}`);
  }
  const latest = await ethers.provider.getBlock("latest");
  const activateAfter = BigInt(state.activateAfter as string);
  if (latest === null || BigInt(latest.timestamp) < activateAfter) {
    throw new Error("Hard stop: adapter activation timelock has not elapsed");
  }
  await assertBudgetBefore(ledger, "B", 150_000n, false);
  const entry = {
    label: "B-PHASE-2-DEDICATED",
    generatedAtUtc: new Date().toISOString(),
    blockNumber: latest.number,
    blockTimestamp: latest.timestamp,
    activateAfter: activateAfter.toString(),
    operator: operatorAddress,
    dedicatedState: state,
    runtimeBytecodeHashes: hashes,
    groupTotals: totals,
    executorHead: (await runGit(["rev-parse", "HEAD"])).trim(),
  };
  ledger.preflights.push(entry);
  await writeHashed(`preflight-b-phase-2-${ledger.preflights.length}.json`, entry);
  await saveLedger(ledger);
  console.log(json({ status: "PREFLIGHT_PASS", label: entry.label, block: latest.number }));
}

async function runGroupA(manifest: SepoliaDeploymentManifest, ledger: Ledger): Promise<void> {
  const groupStarted = ledger.steps.some((step) => step.group === "A");
  if (!groupStarted) await preflight(manifest, ledger, "A");
  const [operator] = await ethers.getSigners();
  const token = await ethers.getContractAt("YieldInjectingERC7984", manifest.addresses.confidentialToken, operator);
  const adapter = await ethers.getContractAt("MockYieldAdapter", manifest.addresses.yieldAdapter, operator);
  const vault = await ethers.getContractAt("LokVault", manifest.addresses.vault, operator);
  const draw = await ethers.getContractAt("LokDrawManager", manifest.addresses.drawManager, operator);
  const state = () => sharedState(manifest, operator.address);

  const supplyBefore = (await token.getFunction("inferredTotalSupply").staticCall()) as bigint;
  await sendStep({
    ledger,
    id: "S01",
    group: "A",
    contract: token,
    method: "mintForTest",
    args: [operator.address, FIXTURE_PRINCIPAL],
    gasCeiling: 450_000n,
    state,
    assertAfter: async () => {
      const after = (await token.getFunction("inferredTotalSupply").staticCall()) as bigint;
      if (after - supplyBefore !== FIXTURE_PRINCIPAL) throw new Error("S01 supply delta mismatch");
    },
  });
  await sendStep({
    ledger,
    id: "S02",
    group: "A",
    contract: token,
    method: "setOperator",
    args: [manifest.addresses.vault, UINT48_MAX],
    gasCeiling: 70_000n,
    state,
    assertAfter: async () => {
      if (!(await token.getFunction("isOperator").staticCall(operator.address, manifest.addresses.vault)))
        throw new Error("S02 operator not set");
    },
  });
  const firstDeposit = await fhevm
    .createEncryptedInput(manifest.addresses.vault, operator.address)
    .add64(FIXTURE_PRINCIPAL)
    .encrypt();
  await sendStep({
    ledger,
    id: "S03",
    group: "A",
    contract: vault,
    method: "deposit",
    args: [firstDeposit.handles[0], firstDeposit.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async (_before, after) => {
      if (after.participantCount !== "31") throw new Error("S03 participant count mismatch");
      await assertActionTrue(vault, operator);
    },
  });
  await sendStep({
    ledger,
    id: "S04",
    group: "A",
    contract: token,
    method: "injectYield",
    args: [manifest.addresses.yieldAdapter, FIXTURE_YIELD],
    gasCeiling: 450_000n,
    state,
    assertAfter: async () => {
      if ((await adapter.getFunction("fundedYieldInAdapter").staticCall()) !== FIXTURE_YIELD)
        throw new Error("S04 funded yield mismatch");
    },
  });
  await sendStep({
    ledger,
    id: "S05",
    group: "A",
    contract: draw,
    method: "openDraw",
    args: [false],
    gasCeiling: 550_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.drawState !== "1" || after.participantSnapshot !== "31") throw new Error("S05 draw snapshot mismatch");
    },
  });
  const drawId = (await draw.getFunction("drawId").staticCall()) as bigint;
  const info = await draw.getFunction("drawInfo").staticCall(drawId);
  const minSettleDelay = (await draw.getFunction("MIN_SETTLE_DELAY").staticCall()) as bigint;
  await waitUntil(info.tEnd as bigint);
  for (let index = 0; index < 8; ++index) {
    const batch = index === 7 ? 3n : 4n;
    const id = `S${String(6 + index).padStart(2, "0")}`;
    await sendStep({
      ledger,
      id,
      group: "A",
      contract: draw,
      method: "preSyncA",
      args: [batch],
      gasCeiling: index === 7 ? 1_500_000n : 2_200_000n,
      state,
    });
  }
  const secondDeposit = await fhevm
    .createEncryptedInput(manifest.addresses.vault, operator.address)
    .add64(SECOND_DEPOSIT)
    .encrypt();
  await sendStep({
    ledger,
    id: "S14",
    group: "A",
    contract: vault,
    method: "deposit",
    args: [secondDeposit.handles[0], secondDeposit.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async (before, after) => {
      if (before.drawCursor !== after.drawCursor || before.participantSnapshot !== after.participantSnapshot)
        throw new Error("S14 changed draw cursor/snapshot");
      await assertActionTrue(vault, operator);
    },
  });
  const withdrawal = await fhevm
    .createEncryptedInput(manifest.addresses.vault, operator.address)
    .add64(PARTIAL_WITHDRAW)
    .encrypt();
  await sendStep({
    ledger,
    id: "S15",
    group: "A",
    contract: vault,
    method: "withdraw",
    args: [withdrawal.handles[0], withdrawal.inputProof],
    gasCeiling: 2_500_000n,
    state,
    assertAfter: async (before, after) => {
      if (before.drawCursor !== after.drawCursor || before.participantSnapshot !== after.participantSnapshot)
        throw new Error("S15 changed draw cursor/snapshot");
      await assertActionTrue(vault, operator);
    },
  });
  await waitUntil(drawSettleAt(info.tEnd as bigint, minSettleDelay));
  for (let index = 0; index < 11; ++index) {
    const batch = index === 10 ? 1n : 3n;
    const id = `S${String(16 + index).padStart(2, "0")}`;
    await sendStep({
      ledger,
      id,
      group: "A",
      contract: draw,
      method: "crankA",
      args: [batch],
      gasCeiling: index === 10 ? 1_500_000n : 2_500_000n,
      state,
    });
  }
  const passA = await draw.getFunction("drawInfo").staticCall(drawId);
  const handles: Hex[] = [
    normalizeHandle(passA.cumRunning),
    normalizeHandle(passA.cumBaseRiskRunning),
    normalizeHandle(passA.cumYieldRunning),
  ];
  const totals = await proofOrDecrypt(ledger, "S27-pass-a-totals", () =>
    decryptPublic("S27-pass-a-totals", handles, ledger),
  );
  const decoded = ABI.decode(["uint64", "uint64", "uint64"], totals.abiEncodedClearValues);
  if ((decoded[2] as bigint) === 0n || (decoded[1] as bigint) > (decoded[2] as bigint))
    throw new Error("S27 aggregate relation invalid");
  await sendStep({
    ledger,
    id: "S27",
    group: "A",
    contract: draw,
    method: "submitTotals",
    args: [totals.abiEncodedClearValues, totals.decryptionProof],
    gasCeiling: 1_000_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.fundedYieldInAdapter !== "0" || after.fundedYieldInVault !== "0")
        throw new Error("S27 yield not fully harvested");
    },
  });
  await sendStep({
    ledger,
    id: "S28",
    group: "A",
    contract: draw,
    method: "openRandom",
    gasCeiling: 250_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.drawState !== "6") throw new Error("S28 did not enter SWEEP_B");
    },
  });
  for (let index = 0; index < 16; ++index) {
    const batch = index === 15 ? 1n : 2n;
    const id = `S${String(29 + index).padStart(2, "0")}`;
    await sendStep({
      ledger,
      id,
      group: "A",
      contract: draw,
      method: "crankB",
      args: [batch],
      gasCeiling: 2_000_000n,
      state,
      assertAfter:
        index === 15
          ? (_before, after) => {
              if (after.drawState !== "7" || after.drawCursor !== "31")
                throw new Error("S44 settlement state mismatch");
            }
          : undefined,
    });
  }
  await sendStep({
    ledger,
    id: "S45",
    group: "A",
    contract: vault,
    method: "withdrawAll",
    gasCeiling: 2_500_000n,
    state,
    assertAfter: async () => assertActionTrue(vault, operator),
  });
  await sendStep({
    ledger,
    id: "S46",
    group: "A",
    contract: token,
    method: "mintForTest",
    args: [operator.address, FIXTURE_PRINCIPAL],
    gasCeiling: 450_000n,
    state,
  });
  const emergencyDeposit = await fhevm
    .createEncryptedInput(manifest.addresses.vault, operator.address)
    .add64(FIXTURE_PRINCIPAL)
    .encrypt();
  await sendStep({
    ledger,
    id: "S47",
    group: "A",
    contract: vault,
    method: "deposit",
    args: [emergencyDeposit.handles[0], emergencyDeposit.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async () => assertActionTrue(vault, operator),
  });
  await sendStep({
    ledger,
    id: "S48",
    group: "A",
    contract: vault,
    method: "emergencyWithdraw",
    gasCeiling: 2_500_000n,
    state,
    assertAfter: async () => assertActionTrue(vault, operator),
  });
  await sendStep({
    ledger,
    id: "S49",
    group: "A",
    contract: token,
    method: "mintForTest",
    args: [operator.address, FIXTURE_PRINCIPAL],
    gasCeiling: 450_000n,
    state,
  });
  const exitDeposit = await fhevm
    .createEncryptedInput(manifest.addresses.vault, operator.address)
    .add64(FIXTURE_PRINCIPAL)
    .encrypt();
  await sendStep({
    ledger,
    id: "S50",
    group: "A",
    contract: vault,
    method: "deposit",
    args: [exitDeposit.handles[0], exitDeposit.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async () => assertActionTrue(vault, operator),
  });
  const exitReceipt = await sendStep({
    ledger,
    id: "S51",
    group: "A",
    contract: vault,
    method: "exit",
    gasCeiling: 2_800_000n,
    state,
  });
  const requestId =
    exitReceipt === undefined
      ? (ledger.shared?.exitRequestId as Hex | undefined)
      : await extractExitRequest(vault, exitReceipt);
  if (requestId === undefined) throw new Error("S51 receipt/request ID missing from resume ledger");
  ledger.shared = { exitRequestId: requestId };
  await saveLedger(ledger);
  const exitProof = await proofOrDecrypt(ledger, "S52-exit", () => decryptPublic("S52-exit", [requestId], ledger));
  const clearAmount = ABI.decode(["uint64"], exitProof.abiEncodedClearValues)[0] as bigint;
  await sendStep({
    ledger,
    id: "S52",
    group: "A",
    contract: vault,
    method: "finalizeExit",
    args: [requestId, clearAmount, exitProof.decryptionProof],
    gasCeiling: 600_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.participantCount !== "30" || after.pendingExit !== "0x" + "00".repeat(32))
        throw new Error("S52 cleanup mismatch");
    },
  });
  await sendStep({
    ledger,
    id: "S53",
    group: "A",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const s53 = await proofOrDecrypt(ledger, "S53-checkpoint", () => decryptCheckpoint("S53-checkpoint", vault, ledger));
  if (!boolFromProof(s53)) throw new Error("S53 checkpoint false");
  await sendStep({
    ledger,
    id: "S54",
    group: "A",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(s53.epoch), BigInt(s53.nonce), s53.abiEncodedClearValues, s53.decryptionProof],
    gasCeiling: 500_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "S55",
    group: "A",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const checkpointA = await proofOrDecrypt(ledger, "S55-checkpoint-a", () =>
    decryptCheckpoint("S55-checkpoint-a", vault, ledger),
  );
  if (!boolFromProof(checkpointA)) throw new Error("S55 checkpoint false");
  await sendStep({
    ledger,
    id: "S56",
    group: "A",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [
      BigInt(checkpointA.epoch),
      BigInt(checkpointA.nonce) + 1n,
      checkpointA.abiEncodedClearValues,
      checkpointA.decryptionProof,
    ],
    gasCeiling: 120_000n,
    expected: "revert",
    expectedError: "WrongNonce",
    state,
  });
  await sendStep({
    ledger,
    id: "S57",
    group: "A",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [
      BigInt(checkpointA.epoch) + 1n,
      BigInt(checkpointA.nonce),
      checkpointA.abiEncodedClearValues,
      checkpointA.decryptionProof,
    ],
    gasCeiling: 120_000n,
    expected: "revert",
    expectedError: "WrongEpoch",
    state,
  });
  await sendStep({
    ledger,
    id: "S58",
    group: "A",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [
      BigInt(checkpointA.epoch),
      BigInt(checkpointA.nonce),
      checkpointA.abiEncodedClearValues,
      tamperProof(checkpointA.decryptionProof),
    ],
    gasCeiling: 450_000n,
    expected: "revert",
    state,
  });
  await sendStep({
    ledger,
    id: "S59",
    group: "A",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const checkpointB = await proofOrDecrypt(ledger, "S59-checkpoint-b", () =>
    decryptCheckpoint("S59-checkpoint-b", vault, ledger),
  );
  if (!boolFromProof(checkpointB)) throw new Error("S59 checkpoint false");
  await sendStep({
    ledger,
    id: "S60",
    group: "A",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [
      BigInt(checkpointB.epoch),
      BigInt(checkpointB.nonce),
      checkpointA.abiEncodedClearValues,
      checkpointA.decryptionProof,
    ],
    gasCeiling: 450_000n,
    expected: "revert",
    state,
  });
  await sendStep({
    ledger,
    id: "S61",
    group: "A",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [
      BigInt(checkpointB.epoch),
      BigInt(checkpointB.nonce),
      checkpointB.abiEncodedClearValues,
      checkpointB.decryptionProof,
    ],
    gasCeiling: 500_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "S62",
    group: "A",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [
      BigInt(checkpointB.epoch),
      BigInt(checkpointB.nonce),
      checkpointB.abiEncodedClearValues,
      checkpointB.decryptionProof,
    ],
    gasCeiling: 120_000n,
    expected: "revert",
    expectedError: "NoPendingCheckpoint",
    state,
  });
  if (groupTotals(ledger, "A").count !== 62) throw new Error("Group A did not record exactly 62 transactions");
}

async function runGroupB1(manifest: SepoliaDeploymentManifest, ledger: Ledger): Promise<void> {
  const groupStarted = ledger.steps.some((step) => step.group === "B");
  if (!groupStarted) await preflight(manifest, ledger, "B");
  const [operator] = await ethers.getSigners();
  ledger.dedicated ??= { addresses: {}, runtimeBytecodeHashes: {} };
  await saveLedger(ledger);
  const underlying = await deployStep({
    ledger,
    id: "D01",
    name: "MockUSDC",
    args: [],
    gasCeiling: 650_000n,
    key: "underlying",
  });
  const tokenAddress = await deployStep({
    ledger,
    id: "D02",
    name: "YieldInjectingERC7984",
    args: [underlying],
    gasCeiling: 3_300_000n,
    key: "token",
  });
  const maliciousAddress = await deployStep({
    ledger,
    id: "D03",
    name: "MaliciousYieldAdapter",
    args: [tokenAddress, operator.address],
    gasCeiling: 1_100_000n,
    key: "malicious",
  });
  const vaultAddress = await deployStep({
    ledger,
    id: "D04",
    name: "LokVault",
    args: [tokenAddress, maliciousAddress, operator.address],
    gasCeiling: 5_500_000n,
    key: "vault",
  });
  const token = await ethers.getContractAt("YieldInjectingERC7984", tokenAddress, operator);
  const malicious = await ethers.getContractAt("MaliciousYieldAdapter", maliciousAddress, operator);
  const vault = await ethers.getContractAt("LokVault", vaultAddress, operator);
  const state = () => dedicatedState(ledger, operator.address);
  await sendStep({
    ledger,
    id: "D05",
    group: "B",
    contract: malicious,
    method: "setVault",
    args: [vaultAddress],
    gasCeiling: 70_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D06",
    group: "B",
    contract: vault,
    method: "setDrawManager",
    args: [operator.address],
    gasCeiling: 70_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D07",
    group: "B",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const d07 = await proofOrDecrypt(ledger, "D07-checkpoint", () => decryptCheckpoint("D07-checkpoint", vault, ledger));
  if (!boolFromProof(d07)) throw new Error("D07 base checkpoint false");
  await sendStep({
    ledger,
    id: "D08",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d07.epoch), BigInt(d07.nonce), d07.abiEncodedClearValues, d07.decryptionProof],
    gasCeiling: 500_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D09",
    group: "B",
    contract: token,
    method: "mintForTest",
    args: [operator.address, FIXTURE_PRINCIPAL],
    gasCeiling: 450_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D10",
    group: "B",
    contract: token,
    method: "setOperator",
    args: [vaultAddress, UINT48_MAX],
    gasCeiling: 70_000n,
    state,
  });
  const deposit = await fhevm.createEncryptedInput(vaultAddress, operator.address).add64(FIXTURE_PRINCIPAL).encrypt();
  await sendStep({
    ledger,
    id: "D11",
    group: "B",
    contract: vault,
    method: "deposit",
    args: [deposit.handles[0], deposit.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async () => assertActionTrue(vault, operator),
  });
  await sendStep({
    ledger,
    id: "D12",
    group: "B",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D13",
    group: "B",
    contract: vault,
    method: "emergencyWithdraw",
    gasCeiling: 2_500_000n,
    state,
    assertAfter: async (_before, after) => {
      if (after.pendingCheckpoint !== true) throw new Error("D13 cleared pending oracle request");
      await assertActionTrue(vault, operator);
    },
  });
  const d12 = await proofOrDecrypt(ledger, "D12-checkpoint-after-recovery", () =>
    decryptCheckpoint("D12-checkpoint-after-recovery", vault, ledger),
  );
  if (boolFromProof(d12)) throw new Error("D12 false checkpoint unexpectedly true");
  const forgedTrue = ABI.encode(["bool"], [true]);
  await sendStep({
    ledger,
    id: "D14",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d12.epoch), BigInt(d12.nonce), forgedTrue, d12.decryptionProof],
    gasCeiling: 450_000n,
    expected: "revert",
    state,
  });
  await sendStep({
    ledger,
    id: "D15",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d12.epoch), BigInt(d12.nonce), d12.abiEncodedClearValues, d12.decryptionProof],
    gasCeiling: 500_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.restricted !== true) throw new Error("D15 did not restrict false checkpoint");
    },
  });
  await sendStep({
    ledger,
    id: "D16",
    group: "B",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const d16 = await proofOrDecrypt(ledger, "D16-checkpoint", () => decryptCheckpoint("D16-checkpoint", vault, ledger));
  if (!boolFromProof(d16)) throw new Error("D16 recovery checkpoint false");
  await sendStep({
    ledger,
    id: "D17",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d16.epoch), BigInt(d16.nonce), d16.abiEncodedClearValues, d16.decryptionProof],
    gasCeiling: 500_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.restricted !== false || after.riskEpoch !== after.lastSolventRiskEpoch)
        throw new Error("D17 did not restore authorization");
    },
  });
  const honestAddress = await deployStep({
    ledger,
    id: "D18",
    name: "MockYieldAdapter",
    args: [tokenAddress, operator.address],
    gasCeiling: 1_250_000n,
    key: "honest",
  });
  const honest = await ethers.getContractAt("MockYieldAdapter", honestAddress, operator);
  await sendStep({
    ledger,
    id: "D19",
    group: "B",
    contract: honest,
    method: "setVault",
    args: [vaultAddress],
    gasCeiling: 70_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D20",
    group: "B",
    contract: vault,
    method: "proposeAdapter",
    args: [honestAddress],
    gasCeiling: 100_000n,
    state,
    assertAfter: (_before, after) => {
      ledger.dedicated!.activateAfter = after.activateAfter as string;
    },
  });
  await sendStep({
    ledger,
    id: "D21",
    group: "B",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const d21 = await proofOrDecrypt(ledger, "D21-stale-checkpoint", () =>
    decryptCheckpoint("D21-stale-checkpoint", vault, ledger),
  );
  if (!boolFromProof(d21)) throw new Error("D21 checkpoint false");
  const recycled = await fhevm.createEncryptedInput(vaultAddress, operator.address).add64(FIXTURE_PRINCIPAL).encrypt();
  await sendStep({
    ledger,
    id: "D22",
    group: "B",
    contract: vault,
    method: "deposit",
    args: [recycled.handles[0], recycled.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async (_before, after) => {
      if (after.pendingCheckpoint !== true) throw new Error("D22 lost stale checkpoint");
      await assertActionTrue(vault, operator);
    },
  });
  await saveLedger(ledger);
}

async function runGroupB2(manifest: SepoliaDeploymentManifest, ledger: Ledger): Promise<void> {
  if (!hasStep(ledger, "D22")) throw new Error("Group B phase 2 requires completed D22");
  if (hasStep(ledger, "D39")) return;
  const [operator] = await ethers.getSigners();
  const addresses = ledger.dedicated?.addresses;
  if (addresses?.token === undefined || addresses.vault === undefined || addresses.honest === undefined)
    throw new Error("Dedicated addresses incomplete");
  const token = await ethers.getContractAt("YieldInjectingERC7984", addresses.token, operator);
  const vault = await ethers.getContractAt("LokVault", addresses.vault, operator);
  const state = () => dedicatedState(ledger, operator.address);
  const activateAfter = (await vault.getFunction("adapterActivateAfter").staticCall()) as bigint;
  await waitUntil(activateAfter);
  if (!hasStep(ledger, "D23")) await preflightDedicatedPhase2(manifest, ledger, operator.address);
  await sendStep({
    ledger,
    id: "D23",
    group: "B",
    contract: vault,
    method: "activateAdapter",
    gasCeiling: 150_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.riskEpoch !== "2" || getAddress(after.activeAdapter as string) !== getAddress(addresses.honest!))
        throw new Error("D23 activation mismatch");
    },
  });
  const d21 = ledger.proofs["D21-stale-checkpoint"];
  if (d21 === undefined) throw new Error("D21 proof missing");
  await sendStep({
    ledger,
    id: "D24",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d21.epoch), BigInt(d21.nonce), d21.abiEncodedClearValues, d21.decryptionProof],
    gasCeiling: 120_000n,
    expected: "revert",
    expectedError: "WrongEpoch",
    state,
  });
  await sendStep({
    ledger,
    id: "D25",
    group: "B",
    contract: token,
    method: "mintForTest",
    args: [operator.address, FIXTURE_PRINCIPAL],
    gasCeiling: 450_000n,
    state,
  });
  const unauthorizedDeposit = await fhevm
    .createEncryptedInput(addresses.vault, operator.address)
    .add64(FIXTURE_PRINCIPAL)
    .encrypt();
  await sendStep({
    ledger,
    id: "D26",
    group: "B",
    contract: vault,
    method: "deposit",
    args: [unauthorizedDeposit.handles[0], unauthorizedDeposit.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async () => assertActionTrue(vault, operator),
  });
  await sendStep({
    ledger,
    id: "D27",
    group: "B",
    contract: vault,
    method: "removeRetiringAdapter",
    gasCeiling: 120_000n,
    expected: "revert",
    expectedError: "AdapterNotDrained",
    state,
  });
  await sendStep({
    ledger,
    id: "D28",
    group: "B",
    contract: vault,
    method: "drainRetiringAdapter",
    gasCeiling: 1_200_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.retiringAdapterDrained !== true) throw new Error("D28 did not mark drained");
    },
  });
  await sendStep({
    ledger,
    id: "D29",
    group: "B",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const d29 = await proofOrDecrypt(ledger, "D29-checkpoint", () => decryptCheckpoint("D29-checkpoint", vault, ledger));
  if (!boolFromProof(d29)) throw new Error("D29 checkpoint false");
  await sendStep({
    ledger,
    id: "D30",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d29.epoch), BigInt(d29.nonce), d29.abiEncodedClearValues, d29.decryptionProof],
    gasCeiling: 500_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D31",
    group: "B",
    contract: vault,
    method: "removeRetiringAdapter",
    gasCeiling: 150_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.riskEpoch !== "3" || getAddress(after.retiringAdapter as string) !== ZeroAddress)
        throw new Error("D31 removal mismatch");
    },
  });
  await sendStep({
    ledger,
    id: "D32",
    group: "B",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const d32 = await proofOrDecrypt(ledger, "D32-checkpoint", () => decryptCheckpoint("D32-checkpoint", vault, ledger));
  if (!boolFromProof(d32)) throw new Error("D32 checkpoint false");
  await sendStep({
    ledger,
    id: "D33",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d32.epoch), BigInt(d32.nonce), d32.abiEncodedClearValues, d32.decryptionProof],
    gasCeiling: 500_000n,
    state,
  });
  await sendStep({
    ledger,
    id: "D34",
    group: "B",
    contract: token,
    method: "mintForTest",
    args: [operator.address, FIXTURE_PRINCIPAL],
    gasCeiling: 450_000n,
    state,
  });
  const routedDeposit = await fhevm
    .createEncryptedInput(addresses.vault, operator.address)
    .add64(FIXTURE_PRINCIPAL)
    .encrypt();
  await sendStep({
    ledger,
    id: "D35",
    group: "B",
    contract: vault,
    method: "deposit",
    args: [routedDeposit.handles[0], routedDeposit.inputProof],
    gasCeiling: 2_200_000n,
    state,
    assertAfter: async () => assertActionTrue(vault, operator),
  });
  const exitReceipt = await sendStep({
    ledger,
    id: "D36",
    group: "B",
    contract: vault,
    method: "exit",
    gasCeiling: 2_800_000n,
    state,
  });
  const requestId =
    exitReceipt === undefined
      ? (ledger.dedicated?.exitRequestId as Hex | undefined)
      : await extractExitRequest(vault, exitReceipt);
  if (requestId === undefined) throw new Error("D36 receipt/request ID missing from resume ledger");
  ledger.dedicated!.exitRequestId = requestId;
  await saveLedger(ledger);
  const exitProof = await proofOrDecrypt(ledger, "D36-exit", () => decryptPublic("D36-exit", [requestId], ledger));
  const clearAmount = ABI.decode(["uint64"], exitProof.abiEncodedClearValues)[0] as bigint;
  await sendStep({
    ledger,
    id: "D37",
    group: "B",
    contract: vault,
    method: "finalizeExit",
    args: [requestId, clearAmount, exitProof.decryptionProof],
    gasCeiling: 600_000n,
    state,
    assertAfter: (_before, after) => {
      if (after.participantCount !== "0" || after.pendingExit !== "0x" + "00".repeat(32))
        throw new Error("D37 cleanup mismatch");
    },
  });
  await sendStep({
    ledger,
    id: "D38",
    group: "B",
    contract: vault,
    method: "openSolvencyCheckpoint",
    gasCeiling: 400_000n,
    state,
  });
  const d38 = await proofOrDecrypt(ledger, "D38-checkpoint", () => decryptCheckpoint("D38-checkpoint", vault, ledger));
  if (!boolFromProof(d38)) throw new Error("D38 final checkpoint false");
  await sendStep({
    ledger,
    id: "D39",
    group: "B",
    contract: vault,
    method: "submitSolvencyCheckpoint",
    args: [BigInt(d38.epoch), BigInt(d38.nonce), d38.abiEncodedClearValues, d38.decryptionProof],
    gasCeiling: 500_000n,
    state,
    assertAfter: (_before, after) => {
      if (
        after.restricted !== false ||
        after.pendingCheckpoint !== false ||
        after.participantCount !== "0" ||
        getAddress(after.retiringAdapter as string) !== ZeroAddress
      )
        throw new Error("D39 final clean state mismatch");
    },
  });
  if (groupTotals(ledger, "B").count !== 39 || groupTotals(ledger, "B").deployments !== 5)
    throw new Error("Group B final transaction/deployment count mismatch");
}

async function writeSummary(ledger: Ledger): Promise<void> {
  const summary = {
    generatedAtUtc: new Date().toISOString(),
    sourceHead: ledger.sourceHead,
    codeTestCommit: ledger.codeTestCommit,
    operator: ledger.operator,
    groupA: groupTotals(ledger, "A"),
    groupB: groupTotals(ledger, "B"),
    groupAComplete: groupTotals(ledger, "A").count === 62,
    groupBComplete: groupTotals(ledger, "B").count === 39 && groupTotals(ledger, "B").deployments === 5,
    handProofStatus: "APPROVED",
    fullPS2Status: "BLOCKED_PENDING_INDEPENDENT_EVIDENCE_REVIEW",
    pP1Status: "WEAKER-THAN-CLAIMED",
    receipts: ledger.steps.map((step) => ({
      id: step.id,
      hash: step.transactionHash,
      artifact: step.artifact,
      sha256: step.artifactSha256,
    })),
  };
  await writeHashed("summary.json", summary);
}

async function main(): Promise<void> {
  const phase = (process.env.LOK_P_S2_PHASE ??
    process.argv.find((arg) => arg.startsWith("--phase="))?.slice("--phase=".length) ??
    "status") as Phase;
  if (!["preflight-a", "preflight-b", "group-a", "group-b-1", "group-b-2", "status"].includes(phase))
    throw new Error(`Unknown phase ${phase}`);
  if (network.name !== "sepolia") throw new Error("P-S2 executor only supports Ethereum Sepolia");
  await fhevm.initializeCLIApi();
  if (fhevm.isMock) throw new Error("P-S2 executor refuses mock FHEVM");
  const manifest = JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as unknown;
  assertDeploymentManifest(manifest);
  const [operator] = await ethers.getSigners();
  if (operator === undefined) throw new Error("Funded Sepolia operator required");
  const ledger = await readLedger(manifest, operator.address);
  if (phase === "preflight-a") await preflight(manifest, ledger, "A");
  if (phase === "preflight-b") await preflight(manifest, ledger, "B");
  if (phase === "group-a") await runGroupA(manifest, ledger);
  if (phase === "group-b-1") await runGroupB1(manifest, ledger);
  if (phase === "group-b-2") await runGroupB2(manifest, ledger);
  await writeSummary(ledger);
  console.log(
    json({ status: "PHASE_COMPLETE", phase, groupA: groupTotals(ledger, "A"), groupB: groupTotals(ledger, "B") }),
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
