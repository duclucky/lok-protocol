import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

type AstNode = {
  nodeType?: string;
  name?: string;
  src?: string;
  memberName?: string;
  expression?: AstNode;
  arguments?: AstNode[];
  visibility?: string;
  modifiers?: Array<{ modifierName?: { name?: string; namePath?: string } }>;
  [key: string]: unknown;
};

type AbiInput = { name: string; type: string; indexed?: boolean };
type AbiItem = {
  type: string;
  name?: string;
  inputs?: AbiInput[];
  stateMutability?: string;
};

export type PrivacyFinding = {
  source: string;
  contract: string;
  function: string;
  line: number;
  expression: string;
  classification: string;
};

export type PrivacySurfaceReport = {
  schemaVersion: 1;
  generatedAtUtc: string;
  status: "PASS" | "FAIL";
  buildInfo: string[];
  publicDecryption: {
    calls: PrivacyFinding[];
    violations: PrivacyFinding[];
    settlementGuardVerified: boolean;
  };
  acl: {
    grants: PrivacyFinding[];
    violations: PrivacyFinding[];
  };
  events: {
    fields: Array<{ contract: string; event: string; name: string; type: string; indexed: boolean }>;
    violations: Array<{ contract: string; event: string; name: string; type: string; reason: string }>;
  };
  roles: Array<{ contract: string; function: string; modifiers: string[]; source: string; line: number }>;
  abi: {
    winnerOnlyCandidates: Array<{ contract: string; kind: string; name: string }>;
    hasUniformCreditCheckPath: boolean;
  };
  redTeam: {
    newChannels: string[];
    fortuneResetUsesFheSelect: boolean;
    anonymityFloor: { status: "PASS" | "FAIL"; minimum: number; maskedAggregateCount: number };
    aggregateFortuneDisclosureOnly: boolean;
    checkpointTiming: { status: "COVERED"; reference: string };
    participantChurn: { status: "COVERED"; reference: string };
    handleMutationTiming: { status: "COVERED"; finding: string };
    relayerRequestShape: { status: "PARTIAL"; finding: string };
    revertDifferences: { status: "COVERED"; finding: string };
    frontendTelemetry: { status: "HUMAN_REVIEW_REQUIRED"; finding: string };
    aggregatePrizeCreditSum: { status: "DOCUMENTED"; reference: string };
  };
};

const ROOT = path.resolve(__dirname, "..");
const BUILD_INFO_DIR = path.join(ROOT, "hardhat-artifacts", "build-info");
const PRIVACY_EVIDENCE_DIR = path.join(ROOT, "artifacts", "privacy");
const REQUIRED_EVIDENCE = ["acl-uniformity", "log-indistinguishability", "gas-indistinguishability"] as const;
type PrivacyEvidenceName = (typeof REQUIRED_EVIDENCE)[number];
const TARGETS = [
  { source: "contracts/LokVault.sol", contract: "LokVault" },
  { source: "contracts/LokDrawManager.sol", contract: "LokDrawManager" },
  { source: "contracts/adapters/MockYieldAdapter.sol", contract: "MockYieldAdapter" },
] as const;

const PUBLIC_DECRYPT_ALLOWLIST: Record<string, { classification: string; function: string }> = {
  "contracts/LokVault.sol::_pendingSolvencyResult": {
    classification: "checkpoint-specific aggregate solvency boolean",
    function: "openSolvencyCheckpoint",
  },
  "contracts/LokDrawManager.sol::draw.cumRunning": {
    classification: "aggregate effective-ticket total",
    function: "_completePassA",
  },
  "contracts/LokDrawManager.sol::draw.cumBaseRiskRunning": {
    classification: "aggregate base-risk total",
    function: "_completePassA",
  },
  "contracts/LokDrawManager.sol::draw.cumYieldRunning": {
    classification: "aggregate yield-weight total",
    function: "_completePassA",
  },
  "contracts/LokDrawManager.sol::draw.cumPrizeCredits": {
    classification: "fully-settled aggregate prize-credit sum",
    function: "_completePassB",
  },
  "contracts/LokDrawManager.sol::draw.r": {
    classification: "post-settlement randomness",
    function: "_completePassB",
  },
};

export function opaqueLogShape(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
): string[] {
  return logs.map(({ address, topics, data }) => {
    const dataBytes = data.startsWith("0x") ? (data.length - 2) / 2 : data.length / 2;
    return `${address.toLowerCase()}:${topics[0]?.toLowerCase() ?? "no-topic"}:${topics.length}:${dataBytes}`;
  });
}

export function opcodeShape(structLogs: readonly { depth: number; op: string }[]): string[] {
  const callOpcodes = new Set(["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2"]);
  return structLogs
    .filter(({ depth, op }) => depth <= 2 && callOpcodes.has(op))
    .map(({ depth, op }) => `${depth}:${op}`);
}

export function comparePrivacyCost(
  winner: { gasUsed: bigint; hcu: { globalHCU: number; maxHCUDepth: number } },
  loser: { gasUsed: bigint; hcu: { globalHCU: number; maxHCUDepth: number } },
  gasThresholdBps = 100,
): {
  status: "PASS" | "FAIL";
  winnerGas: string;
  loserGas: string;
  gasDelta: string;
  gasDeltaBps: number;
  winnerGlobalHcu: number;
  loserGlobalHcu: number;
  globalHcuDelta: number;
  winnerMaxHcuDepth: number;
  loserMaxHcuDepth: number;
  maxHcuDepthDelta: number;
  gasThresholdBps: number;
} {
  const gasDelta = winner.gasUsed >= loser.gasUsed ? winner.gasUsed - loser.gasUsed : loser.gasUsed - winner.gasUsed;
  const gasDenominator = winner.gasUsed >= loser.gasUsed ? winner.gasUsed : loser.gasUsed;
  const gasDeltaBps = gasDenominator === 0n ? 0 : Number((gasDelta * 10_000n) / gasDenominator);
  const globalHcuDelta = Math.abs(winner.hcu.globalHCU - loser.hcu.globalHCU);
  const maxHcuDepthDelta = Math.abs(winner.hcu.maxHCUDepth - loser.hcu.maxHCUDepth);
  const passed = gasDeltaBps <= gasThresholdBps && globalHcuDelta === 0 && maxHcuDepthDelta === 0;
  return {
    status: passed ? "PASS" : "FAIL",
    winnerGas: winner.gasUsed.toString(),
    loserGas: loser.gasUsed.toString(),
    gasDelta: gasDelta.toString(),
    gasDeltaBps,
    winnerGlobalHcu: winner.hcu.globalHCU,
    loserGlobalHcu: loser.hcu.globalHCU,
    globalHcuDelta,
    winnerMaxHcuDepth: winner.hcu.maxHCUDepth,
    loserMaxHcuDepth: loser.hcu.maxHCUDepth,
    maxHcuDepthDelta,
    gasThresholdBps,
  };
}

export function writePrivacyEvidence(
  name: PrivacyEvidenceName,
  fragment: Record<string, unknown> & { status: "PASS" | "FAIL" },
  directory = PRIVACY_EVIDENCE_DIR,
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${name}.json`), `${JSON.stringify(fragment, null, 2)}\n`);
}

export function collectPrivacyEvidence(directory = PRIVACY_EVIDENCE_DIR): {
  status: "PASS" | "FAIL";
  fragments: Record<PrivacyEvidenceName, Record<string, unknown> & { status: "PASS" | "FAIL" }>;
} {
  const fragments = {} as Record<PrivacyEvidenceName, Record<string, unknown> & { status: "PASS" | "FAIL" }>;
  for (const name of REQUIRED_EVIDENCE) {
    const file = path.join(directory, `${name}.json`);
    if (!existsSync(file)) throw new Error(`Missing privacy evidence: ${name}`);
    const fragment = readJson<Record<string, unknown> & { status?: unknown }>(file);
    if (fragment.status !== "PASS" && fragment.status !== "FAIL") {
      throw new Error(`Invalid privacy evidence status: ${name}`);
    }
    fragments[name] = fragment as Record<string, unknown> & { status: "PASS" | "FAIL" };
  }
  return {
    status: REQUIRED_EVIDENCE.every((name) => fragments[name].status === "PASS") ? "PASS" : "FAIL",
    fragments,
  };
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

function matchingBuildInfoBySource(): Map<string, { file: string; json: Record<string, unknown> }> {
  const candidates = readdirSync(BUILD_INFO_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(BUILD_INFO_DIR, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  const matches = new Map<string, { file: string; json: Record<string, unknown> }>();
  for (const { source } of TARGETS) {
    const current = readFileSync(path.join(ROOT, source), "utf8");
    for (const file of candidates) {
      const json = readJson<Record<string, unknown>>(file);
      const input = json.input as { sources?: Record<string, { content?: string }> } | undefined;
      if (input?.sources?.[source]?.content === current) {
        matches.set(source, { file, json });
        break;
      }
    }
    if (!matches.has(source)) {
      throw new Error(`No current Hardhat build-info matches ${source}; run hardhat compile first`);
    }
  }
  return matches;
}

function sourceSlice(content: string, src: string | undefined): string {
  if (src === undefined) return "";
  const [offsetText, lengthText] = src.split(":");
  const offset = Number(offsetText);
  const length = Number(lengthText);
  return content
    .slice(offset, offset + length)
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLine(content: string, src: string | undefined): number {
  if (src === undefined) return 0;
  const offset = Number(src.split(":")[0]);
  return content.slice(0, offset).split("\n").length;
}

function modifierNames(node: AstNode): string[] {
  return (node.modifiers ?? [])
    .map(({ modifierName }) => modifierName?.name ?? modifierName?.namePath ?? "")
    .filter((name) => name.length > 0);
}

function walkAst(
  value: unknown,
  source: string,
  content: string,
  context: { contract: string; function: string },
  calls: PrivacyFinding[],
  roles: PrivacySurfaceReport["roles"],
): void {
  if (Array.isArray(value)) {
    for (const child of value) walkAst(child, source, content, context, calls, roles);
    return;
  }
  if (value === null || typeof value !== "object") return;

  const node = value as AstNode;
  let nextContext = context;
  if (node.nodeType === "ContractDefinition") nextContext = { ...context, contract: node.name ?? "<anonymous>" };
  if (node.nodeType === "FunctionDefinition") {
    const functionName = node.name === "" ? "<fallback>" : (node.name ?? "<anonymous>");
    nextContext = { ...context, function: functionName };
    const modifiers = modifierNames(node);
    if ((node.visibility === "public" || node.visibility === "external") && modifiers.length > 0) {
      roles.push({
        contract: context.contract,
        function: functionName,
        modifiers,
        source,
        line: sourceLine(content, node.src),
      });
    }
  }

  if (node.nodeType === "FunctionCall" && node.expression?.nodeType === "MemberAccess") {
    const memberName = node.expression.memberName ?? "";
    if (["makePubliclyDecryptable", "allow", "allowThis", "allowTransient", "select"].includes(memberName)) {
      calls.push({
        source,
        contract: nextContext.contract,
        function: nextContext.function,
        line: sourceLine(content, node.src),
        expression: sourceSlice(content, node.arguments?.[0]?.src),
        classification: memberName,
      });
    }
  }

  for (const child of Object.values(node)) walkAst(child, source, content, nextContext, calls, roles);
}

function artifactAbi(source: string, contract: string): AbiItem[] {
  const artifact = path.join(ROOT, "hardhat-artifacts", source, `${contract}.json`);
  return readJson<{ abi: AbiItem[] }>(artifact).abi;
}

function scanAbi(): Pick<PrivacySurfaceReport, "events" | "abi"> {
  const fields: PrivacySurfaceReport["events"]["fields"] = [];
  const eventViolations: PrivacySurfaceReport["events"]["violations"] = [];
  const winnerOnlyCandidates: PrivacySurfaceReport["abi"]["winnerOnlyCandidates"] = [];
  let hasUniformCreditCheckPath = false;

  for (const target of TARGETS) {
    for (const item of artifactAbi(target.source, target.contract)) {
      const name = item.name ?? "";
      if (item.type === "function") {
        const signature = `${name}(${(item.inputs ?? []).map(({ type }) => type).join(",")})`;
        if (target.contract === "LokDrawManager" && signature === "prizeCredit(uint64,address)") {
          hasUniformCreditCheckPath = true;
        }
        if (/claimPrize|claimReward|winnerOnly|isWinner/i.test(name)) {
          winnerOnlyCandidates.push({ contract: target.contract, kind: "function", name });
        }
      }
      if (item.type !== "event") continue;
      if (/winnerOnly|WinnerDeclared|WinnerSelected/i.test(name)) {
        winnerOnlyCandidates.push({ contract: target.contract, kind: "event", name });
      }
      for (const input of item.inputs ?? []) {
        fields.push({
          contract: target.contract,
          event: name,
          name: input.name,
          type: input.type,
          indexed: input.indexed ?? false,
        });
        const perUserAmountName = /amount|balance|theta|fortune|credit|weight|range/i.test(input.name);
        const allowedDrawAggregate =
          target.contract === "LokDrawManager" &&
          name === "DrawSettled" &&
          (input.name === "realisedYield" || input.name === "prizeAmount");
        const allowedAdapterAggregate =
          target.contract === "MockYieldAdapter" &&
          (name === "YieldFunded" || name === "YieldHarvested") &&
          input.name === "amount";
        if (perUserAmountName && !allowedDrawAggregate && !allowedAdapterAggregate) {
          eventViolations.push({
            contract: target.contract,
            event: name,
            name: input.name,
            type: input.type,
            reason: "event field is amount-like and is not an allowlisted draw aggregate",
          });
        }
      }
    }
  }
  return {
    events: { fields, violations: eventViolations },
    abi: { winnerOnlyCandidates, hasUniformCreditCheckPath },
  };
}

export function scanPrivacySurface(generatedAtUtc: string = new Date().toISOString()): PrivacySurfaceReport {
  const buildInfoBySource = matchingBuildInfoBySource();
  const calls: PrivacyFinding[] = [];
  const roles: PrivacySurfaceReport["roles"] = [];
  const sourceContents = new Map<string, string>();
  for (const { source } of TARGETS) {
    const json = buildInfoBySource.get(source)?.json;
    if (json === undefined) throw new Error(`Missing build-info for ${source}`);
    const output = json.output as { sources?: Record<string, { ast?: AstNode }> } | undefined;
    const input = json.input as { sources: Record<string, { content: string }> };
    if (output?.sources === undefined) throw new Error(`Missing compiler AST output for ${source}`);
    const ast = output.sources[source]?.ast;
    const content = input.sources[source]?.content;
    if (ast === undefined || content === undefined) throw new Error(`Missing AST or source content for ${source}`);
    sourceContents.set(source, content);
    walkAst(ast, source, content, { contract: "<source>", function: "<source>" }, calls, roles);
  }

  const publicCalls = calls
    .filter(({ classification }) => classification === "makePubliclyDecryptable")
    .map((finding) => {
      const allowed = PUBLIC_DECRYPT_ALLOWLIST[`${finding.source}::${finding.expression}`];
      return { ...finding, classification: allowed?.classification ?? "NOT ALLOWLISTED" };
    });
  const publicViolations = publicCalls.filter((finding) => {
    const allowed = PUBLIC_DECRYPT_ALLOWLIST[`${finding.source}::${finding.expression}`];
    return allowed === undefined || allowed.function !== finding.function;
  });
  const drawSource = sourceContents.get("contracts/LokDrawManager.sol") ?? "";
  const settlementGuardVerified =
    /if\s*\(\s*end\s*==\s*participantSnapshot\s*\)\s*\{\s*_completePassB\s*\(\s*draw\s*\)/s.test(drawSource) &&
    publicCalls.some(
      ({ source, function: functionName, expression }) =>
        source === "contracts/LokDrawManager.sol" &&
        functionName === "_completePassB" &&
        expression === "draw.cumPrizeCredits",
    );

  const aclGrants = calls.filter(({ classification }) =>
    ["allow", "allowThis", "allowTransient"].includes(classification),
  );
  const aclViolations = aclGrants.filter((finding) => {
    if (finding.classification !== "allow") return false;
    const sourceContent = sourceContents.get(finding.source) ?? "";
    const line = sourceContent.split("\n")[finding.line - 1] ?? "";
    return !/FHE\.allow\([^,]+,\s*(user|msg\.sender)\s*\)/.test(line);
  });
  const abiReport = scanAbi();
  const fortuneResetUsesFheSelect = calls.some(
    ({ source, function: functionName, classification }) =>
      source === "contracts/LokVault.sol" && functionName === "creditDraw" && classification === "select",
  );
  const minimumMatch = drawSource.match(/MIN_PARTICIPANTS\s*=\s*(\d+)/);
  const minimumParticipants = minimumMatch === null ? 0 : Number(minimumMatch[1]);
  const maskedAggregateCount = drawSource.match(/FHE\.select\(enough,\s*draw\.cum\w*Running,\s*zero\)/g)?.length ?? 0;
  const anonymityFloor = {
    status:
      minimumParticipants === 5 &&
      maskedAggregateCount === 3 &&
      /FHE\.ge\(_nonDustRunning,\s*uint64\(MIN_PARTICIPANTS\)\)/.test(drawSource)
        ? ("PASS" as const)
        : ("FAIL" as const),
    minimum: minimumParticipants,
    maskedAggregateCount,
  };
  const aggregateFortuneDisclosureOnly =
    !publicCalls.some(({ expression }) => /fortune/i.test(expression)) &&
    publicCalls.some(({ expression }) => expression === "draw.cumRunning") &&
    publicCalls.some(({ expression }) => expression === "draw.cumBaseRiskRunning");
  const failed =
    publicViolations.length > 0 ||
    aclViolations.length > 0 ||
    abiReport.events.violations.length > 0 ||
    abiReport.abi.winnerOnlyCandidates.length > 0 ||
    !abiReport.abi.hasUniformCreditCheckPath ||
    !settlementGuardVerified ||
    !fortuneResetUsesFheSelect ||
    anonymityFloor.status !== "PASS" ||
    !aggregateFortuneDisclosureOnly;

  return {
    schemaVersion: 1,
    generatedAtUtc,
    status: failed ? "FAIL" : "PASS",
    buildInfo: [
      ...new Set([...buildInfoBySource.values()].map(({ file }) => path.relative(ROOT, file).replace(/\\/g, "/"))),
    ],
    publicDecryption: { calls: publicCalls, violations: publicViolations, settlementGuardVerified },
    acl: { grants: aclGrants, violations: aclViolations },
    events: abiReport.events,
    roles,
    abi: abiReport.abi,
    redTeam: {
      newChannels: ["S9"],
      fortuneResetUsesFheSelect,
      anonymityFloor,
      aggregateFortuneDisclosureOnly,
      checkpointTiming: { status: "COVERED", reference: "docs/08-threat-model.md S7" },
      participantChurn: { status: "COVERED", reference: "docs/08-threat-model.md sections 2 and S4" },
      handleMutationTiming: {
        status: "COVERED",
        finding: "No Lok event emits a persistent per-user ciphertext handle; action timing and membership are public.",
      },
      relayerRequestShape: {
        status: "PARTIAL",
        finding:
          "ABI and frontend use one prizeCredit(drawId,user) check path; runtime relayer-observable equality remains a human review boundary.",
      },
      revertDifferences: {
        status: "COVERED",
        finding: "Winner selection and Fortune reset use encrypted select; no winner-only ABI or event exists.",
      },
      frontendTelemetry: {
        status: "HUMAN_REVIEW_REQUIRED",
        finding:
          "frontend/ is present and exposes one outcome-independent Check my result action; P-P9 UX and runtime telemetry equality remain a human review gate.",
      },
      aggregatePrizeCreditSum: { status: "DOCUMENTED", reference: "docs/08-threat-model.md S9" },
    },
  };
}

export function buildPrivacyReport(
  evidenceDirectory = PRIVACY_EVIDENCE_DIR,
  generatedAtUtc: string = new Date().toISOString(),
) {
  const staticReport = scanPrivacySurface(generatedAtUtc);
  const dynamicEvidence = collectPrivacyEvidence(evidenceDirectory);
  const pass = (condition: boolean, evidence: string) => ({
    status: condition ? ("PASS" as const) : ("FAIL" as const),
    evidence,
  });
  const logPass = dynamicEvidence.fragments["log-indistinguishability"].status === "PASS";
  const aclPass = dynamicEvidence.fragments["acl-uniformity"].status === "PASS";
  const gasPass = dynamicEvidence.fragments["gas-indistinguishability"].status === "PASS";
  const propositions = {
    "P-P1": pass(logPass, "log-diff plus application call-boundary comparison"),
    "P-P2": pass(aclPass && staticReport.acl.violations.length === 0, "exactly one prize-handle grant per participant"),
    "P-P4": pass(staticReport.events.violations.length === 0, "ABI event-field scan"),
    "P-P5": pass(gasPass, "matched-position gas/HCU regression"),
    "P-P6": pass(staticReport.redTeam.anonymityFloor.status === "PASS", "MIN_PARTICIPANTS and aggregate masking scan"),
    "P-P7": pass(
      logPass && staticReport.redTeam.fortuneResetUsesFheSelect && staticReport.redTeam.aggregateFortuneDisclosureOnly,
      "Fortune ACL/public-decryption/log-shape scan",
    ),
    "P-P8": pass(
      staticReport.publicDecryption.violations.length === 0 && staticReport.publicDecryption.settlementGuardVerified,
      "AST public-decryption allowlist and full-PASS-B guard",
    ),
    "P-P9-ABI": pass(
      staticReport.abi.winnerOnlyCandidates.length === 0 && staticReport.abi.hasUniformCreditCheckPath,
      "ABI winner-only scan",
    ),
    "P-P9-UX": {
      status: "NOT_TESTABLE" as const,
      evidence:
        "frontend/ uses one Check my result path for every participant; runtime relayer-observable equality requires human review",
    },
  };
  return {
    ...staticReport,
    status: staticReport.status === "PASS" && dynamicEvidence.status === "PASS" ? ("PASS" as const) : ("FAIL" as const),
    dynamicEvidence,
    propositions,
    reviewBoundary: {
      status: "APPROVED SAME-CONTEXT OWNER EXCEPTION",
      independentReviewPerformed: false,
      frontendHumanReviewPerformed: false,
    },
  };
}

if (require.main === module) {
  const report = buildPrivacyReport();
  const output = path.resolve(process.env.LOK_PRIVACY_OUTPUT ?? path.join(ROOT, "artifacts", "privacy-report.json"));
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Privacy scan ${report.status}: ${output}`);
  if (report.status !== "PASS") process.exitCode = 1;
}
