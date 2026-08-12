import { FhevmType } from "@fhevm/hardhat-plugin";
import { BaseContract, ContractTransactionReceipt } from "ethers";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ethers, fhevm, network } from "hardhat";
import { format } from "prettier";

export type BatchCaps = {
  preSync: number;
  crankA: number;
  crankB: number;
};

export function batchCapAtSixtyPercent(measuredMaximum: number): number {
  return Math.floor(measuredMaximum * 0.6);
}

export function projectDrawTransactions(participants: number, caps: BatchCaps) {
  if (caps.preSync <= 0 || caps.crankA <= 0 || caps.crankB <= 0) {
    throw new Error("Batch caps must all be positive");
  }
  const preSync = Math.ceil(participants / caps.preSync);
  const passA = Math.ceil(participants / caps.crankA);
  const passB = Math.ceil(participants / caps.crankB);
  return { preSync, passA, passB, variable: preSync + passA + passB };
}

export function percentile(samples: number[], quantile: number): number {
  if (samples.length === 0) throw new Error("Cannot compute a percentile without samples");
  if (quantile <= 0 || quantile > 1) throw new Error(`Invalid quantile ${quantile}`);
  const ordered = [...samples].sort((a, b) => a - b);
  return ordered[Math.ceil(quantile * ordered.length) - 1];
}

type ProbePath =
  | "measureSyncUser"
  | "measureCrankA"
  | "measureCrankB"
  | "measureRandomness"
  | "measureFortune"
  | "measureSolvency";

type ReceiptMeasurement = {
  iterations: number;
  transactionHash: string;
  gasUsed: string;
  globalHCU: number;
  maxHCUDepth: number;
};

type PathMeasurement = {
  measuredMaximum: number;
  firstRejected: number | null;
  sixtyPercentCap: number;
  incrementalGlobalHCU: number;
  single: ReceiptMeasurement;
  boundary: ReceiptMeasurement;
};

const ESTIMATED_GLOBAL_HCU: Partial<Record<ProbePath, number>> = {
  measureSyncUser: 2_430_000,
  measureCrankA: 3_556_000,
  measureCrankB: 3_870_000,
  measureRandomness: 1_211_000,
  measureSolvency: 473_000,
};

const PATH_LABELS: Record<ProbePath, string> = {
  measureSyncUser: "_syncUser checkpoint",
  measureCrankA: "PASS A participant",
  measureCrankB: "PASS B participant",
  measureRandomness: "strict randomness",
  measureFortune: "Fortune update",
  measureSolvency: "solvency boolean",
};

async function waitForReceipt(tx: { wait(): Promise<ContractTransactionReceipt | null> }) {
  const receipt = await tx.wait();
  if (receipt === null) throw new Error("Benchmark transaction was not mined");
  return receipt;
}

async function canExecute(probe: BaseContract, path: ProbePath, iterations: number): Promise<boolean> {
  try {
    await probe.getFunction(path).estimateGas(BigInt(iterations));
    return true;
  } catch {
    return false;
  }
}

async function findBoundary(probe: BaseContract, path: ProbePath, maximum = 200): Promise<number> {
  if (!(await canExecute(probe, path, 1))) throw new Error(`${path}(1) exceeds the live transaction limit`);
  let low = 1;
  let high = maximum + 1;
  while (low + 1 < high) {
    const candidate = Math.floor((low + high) / 2);
    if (await canExecute(probe, path, candidate)) low = candidate;
    else high = candidate;
  }
  return low;
}

async function measureReceipt(probe: BaseContract, path: ProbePath, iterations: number) {
  const receipt = await waitForReceipt(await probe.getFunction(path)(BigInt(iterations)));
  const hcu = fhevm.computeTransactionHCU(receipt);
  return {
    iterations,
    transactionHash: receipt.hash,
    gasUsed: receipt.gasUsed.toString(),
    globalHCU: hcu.globalHCU,
    maxHCUDepth: hcu.maxHCUDepth,
  };
}

async function timedSamples(sample: () => Promise<unknown>, count: number): Promise<number[]> {
  const samples: number[] = [];
  for (let i = 0; i < count; ++i) {
    const started = performance.now();
    await sample();
    samples.push(Math.round(performance.now() - started));
  }
  return samples;
}

function differencePercent(measured: number, estimated: number): number {
  return ((measured - estimated) / estimated) * 100;
}

function benchmarkMarkdown(output: {
  measuredAt: string;
  network: string;
  chainId: string;
  deployer: string;
  probe: string;
  packageVersions: Record<string, string>;
  measurements: Record<ProbePath, PathMeasurement>;
  comparisons: Partial<Record<ProbePath, { estimated: number; measured: number; differencePercent: number }>>;
  caps: BatchCaps;
  projections: Record<string, ReturnType<typeof projectDrawTransactions> | null>;
  latencyMs: {
    public: { samples: number[]; p50: number; p95: number };
    user: { samples: number[]; p50: number; p95: number };
  };
  gate3: { passed: boolean; reasons: string[] };
}): string {
  const rows = (Object.keys(output.measurements) as ProbePath[])
    .map((key) => {
      const value = output.measurements[key];
      const comparison = output.comparisons[key];
      const estimate = comparison === undefined ? "[MEASURE]" : comparison.estimated.toLocaleString("en-US");
      const difference =
        comparison === undefined
          ? "n/a"
          : `${comparison.differencePercent >= 0 ? "+" : ""}${comparison.differencePercent.toFixed(1)}%`;
      return `| ${PATH_LABELS[key]} | ${estimate} | ${value.incrementalGlobalHCU.toLocaleString("en-US")} | ${difference} | ${value.measuredMaximum} | ${value.sixtyPercentCap} | \`${value.boundary.transactionHash}\` |`;
    })
    .join("\n");
  const projectionRows = Object.entries(output.projections)
    .map(([participants, projection]) => {
      if (projection === null) return `| ${participants} | blocked | blocked | blocked | blocked |`;
      return `| ${participants} | ${projection.preSync} | ${projection.passA} | ${projection.passB} | ${projection.variable} |`;
    })
    .join("\n");
  const gateReasons =
    output.gate3.reasons.length === 0
      ? "- No measured PASS A/B divergence exceeds 50%.\n- No numeric demo-latency target is defined in the architecture; transaction projections are reported without inventing an SLA."
      : output.gate3.reasons.map((x) => `- ${x}`).join("\n");

  return `# Sepolia HCU Benchmark

Measured ${output.measuredAt} on Ethereum Sepolia (chain ${output.chainId}) with probe \`${output.probe}\`.

**GATE 3: ${output.gate3.passed ? "PASS" : "STOP / ESCALATE"}.**

${gateReasons}

## Versions

| Component | Version |
| --- | --- |
${Object.entries(output.packageVersions)
  .map(([name, version]) => `| ${name} | \`${version}\` |`)
  .join("\n")}

## HCU Results

The measured per-iteration value is the incremental global HCU slope between the one-iteration transaction and the
largest successful transaction. PASS A includes its final anonymity-mask/public-decryption overhead at both points.

| Path | Revised estimate | Measured / iteration | Difference | Max success | 60% cap | Boundary transaction |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
${rows}

Configured pre-sync remains the reviewed production constant 4. The measured safe ceilings for PASS A and PASS B are
${output.caps.crankA} and ${output.caps.crankB}; constants are frozen only when GATE 3 passes.

## Draw Projections

Fixed open, total submission, randomness/reveal, and settlement transactions are excluded.

| Participants | preSync | PASS A | PASS B | Variable total |
| ---: | ---: | ---: | ---: | ---: |
${projectionRows}

## Decryption Latency

| Flow | Samples | p50 | p95 |
| --- | ---: | ---: | ---: |
| Public aggregate boolean | ${output.latencyMs.public.samples.length} | ${output.latencyMs.public.p50} ms | ${output.latencyMs.public.p95} ms |
| User Fortune handle | ${output.latencyMs.user.samples.length} | ${output.latencyMs.user.p50} ms | ${output.latencyMs.user.p95} ms |

Raw observations, gas, HCU depth, and every transaction hash are in \`artifacts/hcu-benchmark.json\`. The deployer
address was \`${output.deployer}\`; no secret material is stored in either artifact.
`;
}

async function writeEvidence(output: Parameters<typeof benchmarkMarkdown>[0], markdown: string): Promise<void> {
  await mkdir(path.join(process.cwd(), "artifacts"), { recursive: true });
  await writeFile(path.join(process.cwd(), "artifacts", "hcu-benchmark.json"), `${JSON.stringify(output, null, 2)}\n`);
  await writeFile(path.join(process.cwd(), "docs", "BENCHMARK.md"), await format(markdown, { parser: "markdown" }));

  const budgetPath = path.join(process.cwd(), "docs", "04-hcu-budget.md");
  const budget = await readFile(budgetPath, "utf8");
  const start = "<!-- BENCH-HCU:START -->";
  const end = "<!-- BENCH-HCU:END -->";
  const generated = `${start}\n## 5.1 Latest Sepolia measurement\n\n${markdown
    .split("## HCU Results\n\n")[1]
    .split("## Draw Projections")[0]
    .trim()}\n\n${end}`;
  let updated: string;
  if (budget.includes(start) && budget.includes(end)) {
    updated = `${budget.split(start)[0]}${generated}${budget.split(end)[1]}`;
  } else {
    updated = budget.replace("\n## 6. Escalation triggers", `\n${generated}\n\n---\n\n## 6. Escalation triggers`);
  }
  await writeFile(budgetPath, await format(updated, { parser: "markdown" }));
}

async function main(): Promise<void> {
  if (network.name !== "sepolia") throw new Error("HCU benchmark must run on Ethereum Sepolia");
  await fhevm.initializeCLIApi();
  if (fhevm.isMock) throw new Error("HCU benchmark refuses the mock FHEVM backend");

  const [deployer] = await ethers.getSigners();
  if (deployer === undefined) throw new Error("No Sepolia deployer; configure DEPLOYER_PRIVATE_KEY in Hardhat vars");

  const probe = await (await ethers.getContractFactory("HCUProbe", deployer)).deploy();
  await probe.waitForDeployment();
  const probeAddress = await probe.getAddress();

  const paths: ProbePath[] = [
    "measureSyncUser",
    "measureCrankA",
    "measureCrankB",
    "measureRandomness",
    "measureFortune",
    "measureSolvency",
  ];
  const measurements = {} as Record<ProbePath, PathMeasurement>;

  for (const path of paths) {
    const maximum = await findBoundary(probe, path);
    const single = await measureReceipt(probe, path, 1);
    const boundary = maximum === 1 ? single : await measureReceipt(probe, path, maximum);
    const incrementalGlobalHCU =
      maximum === 1 ? single.globalHCU : Math.round((boundary.globalHCU - single.globalHCU) / (maximum - 1));
    measurements[path] = {
      measuredMaximum: maximum,
      firstRejected: maximum < 200 ? maximum + 1 : null,
      sixtyPercentCap: batchCapAtSixtyPercent(maximum),
      incrementalGlobalHCU,
      single,
      boundary,
    };
  }

  await waitForReceipt(await probe.getFunction("measureSolvency")(1n));
  await waitForReceipt(await probe.getFunction("measureFortune")(1n));
  const publicHandle = (await probe.getFunction("publicSolvencyHandle").staticCall()) as `0x${string}`;
  const userHandle = (await probe.getFunction("userFortuneHandle").staticCall()) as `0x${string}`;
  const publicSamples = await timedSamples(() => fhevm.publicDecrypt([publicHandle]), 10);
  const userSamples = await timedSamples(
    () => fhevm.userDecryptEuint(FhevmType.euint16, userHandle, probeAddress, deployer),
    10,
  );

  const comparisons: Partial<Record<ProbePath, { estimated: number; measured: number; differencePercent: number }>> =
    {};
  for (const path of paths) {
    const estimated = ESTIMATED_GLOBAL_HCU[path];
    if (estimated !== undefined) {
      comparisons[path] = {
        estimated,
        measured: measurements[path].incrementalGlobalHCU,
        differencePercent: differencePercent(measurements[path].incrementalGlobalHCU, estimated),
      };
    }
  }

  const caps: BatchCaps = {
    preSync: 4,
    crankA: measurements.measureCrankA.sixtyPercentCap,
    crankB: measurements.measureCrankB.sixtyPercentCap,
  };
  const reasons: string[] = [];
  for (const path of ["measureCrankA", "measureCrankB"] as const) {
    const comparison = comparisons[path];
    if (comparison !== undefined && Math.abs(comparison.differencePercent) > 50) {
      reasons.push(
        `${PATH_LABELS[path]} differs from its revised estimate by ${comparison.differencePercent.toFixed(1)}%.`,
      );
    }
  }
  if (caps.crankA < 1 || caps.crankB < 1) {
    reasons.push(`The exact 60% rule produced an unusable cap (PASS A ${caps.crankA}, PASS B ${caps.crankB}).`);
  }
  const projections: Record<string, ReturnType<typeof projectDrawTransactions> | null> = {};
  for (const participants of [10, 100, 1_000]) {
    projections[String(participants)] =
      caps.crankA > 0 && caps.crankB > 0 ? projectDrawTransactions(participants, caps) : null;
  }

  const output = {
    measuredAt: new Date().toISOString(),
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    probe: probeAddress,
    packageVersions: {
      fhevmSolidity: "0.11.1",
      fhevmHardhatPlugin: "0.4.2",
      relayerSdk: "0.4.1",
      hardhat: "2.28.6",
    },
    measurements,
    comparisons,
    caps,
    projections,
    latencyMs: {
      public: { samples: publicSamples, p50: percentile(publicSamples, 0.5), p95: percentile(publicSamples, 0.95) },
      user: { samples: userSamples, p50: percentile(userSamples, 0.5), p95: percentile(userSamples, 0.95) },
    },
    gate3: { passed: reasons.length === 0, reasons },
  };

  await writeEvidence(output, benchmarkMarkdown(output));
  console.log(JSON.stringify(output, null, 2));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
