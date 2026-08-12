import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MASK_64 = (1n << 64n) - 1n;
const TWO_TO_64 = 1n << 64n;
const RATE_CAP = 1n << 52n;
const TICKET_SCALE_BITS = 32n;
const FORTUNE_CAP = 52n;

export type PositionInput = {
  id: string;
  balanceMicroUnits: bigint;
  theta: bigint;
  activeSeconds: bigint;
  fortune: bigint;
};

export type ComputedPosition = {
  input: PositionInput;
  baseWeight: bigint;
  yieldWeight: bigint;
  boost: bigint;
  effectiveWeight: bigint;
};

export type WeightedParticipant = {
  id: string;
  effectiveWeight: bigint;
};

export type WeightedScenario = {
  id: string;
  proposition: "P-F1" | "P-F1'";
  draws: number;
  seed: bigint;
  participants: WeightedParticipant[];
};

export type ScenarioResult = {
  id: string;
  proposition: WeightedScenario["proposition"];
  draws: number;
  seed: bigint;
  totalWeight: bigint;
  observedCounts: number[];
  expectedCounts: number[];
  expectedProbabilities: number[];
  observedProbabilities: number[];
  confidenceIntervals99: Array<{ lower: number; upper: number; inside: boolean }>;
  confidenceZ99: number;
  chiSquare: number;
  degreesOfFreedom: number;
  pValue: number;
  passed: boolean;
};

type PositionScenario = {
  id: string;
  proposition: WeightedScenario["proposition"];
  seed: bigint;
  positions: ComputedPosition[];
};

export type FairnessParticipantReport = {
  id: string;
  balanceMicroUnits: string;
  theta: number;
  activeSeconds: number;
  fortune: number;
  baseWeight: string;
  boost: string;
  effectiveWeight: string;
  expectedCount: number;
  observedCount: number;
  expectedProbability: number;
  observedProbability: number;
  confidenceInterval99: { lower: number; upper: number; inside: boolean };
};

export type FairnessScenarioReport = {
  id: string;
  proposition: WeightedScenario["proposition"];
  status: "PASS" | "FAIL";
  draws: number;
  seed: string;
  totalWeight: string;
  chiSquare: number;
  degreesOfFreedom: number;
  pValue: number;
  confidenceZ99: number;
  moduloBias: {
    remainder: string;
    maxRelativeDeviationNumerator: string;
    denominator: string;
    frozenBoundNumerator: string;
    withinFrozenBound: boolean;
  };
  participants: FairnessParticipantReport[];
};

export type FairnessReport = {
  schemaVersion: 1;
  generatedAtUtc: string;
  status: "PASS" | "FAIL";
  methodology: {
    rng: string;
    winnerMapping: string;
    confidenceInterval: string;
    chiSquare: string;
    seedPolicy: string;
  };
  propositions: Record<"P-F1" | "P-F1'", { status: "PASS" | "FAIL"; draws: number; scenarios: number }>;
  trustBoundary: { proposition: "P-F4"; status: "DOCUMENTED"; statement: string };
  checks: {
    zeroWeightNeverWins: boolean;
    splitBoostWithinSingleAddressCap: boolean;
    splitBoost: string;
    unsplitBoost: string;
    splitRoundingMargin: string;
    allModuloBoundsPass: boolean;
  };
  scenarios: FairnessScenarioReport[];
};

export class SplitMix64 {
  private state: bigint;

  constructor(seed: bigint) {
    this.state = seed & MASK_64;
  }

  next64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK_64;
    let value = this.state;
    value = ((value ^ (value >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK_64;
    value = ((value ^ (value >> 27n)) * 0x94d049bb133111ebn) & MASK_64;
    return (value ^ (value >> 31n)) & MASK_64;
  }
}

export function computePosition(input: PositionInput): ComputedPosition {
  if (input.balanceMicroUnits < 0n || input.activeSeconds < 0n || input.fortune < 0n) {
    throw new Error("negative position input");
  }
  if (input.theta < 0n || input.theta > 4n) throw new Error("theta outside [0,4]");

  const rawRate = input.balanceMicroUnits * input.theta;
  const rate = rawRate < RATE_CAP ? rawRate : RATE_CAP;
  const ticketDelta = rate * input.activeSeconds;
  const yieldDelta = input.balanceMicroUnits * input.activeSeconds;
  const baseWeight = ticketDelta >> (TICKET_SCALE_BITS + 2n);
  const yieldWeight = yieldDelta >> TICKET_SCALE_BITS;
  const boundedFortune = input.fortune < FORTUNE_CAP ? input.fortune : FORTUNE_CAP;
  const proportional = (baseWeight * boundedFortune) / (2n * FORTUNE_CAP);
  const boostCeiling = baseWeight >> 1n;
  const boost = proportional < boostCeiling ? proportional : boostCeiling;

  return { input, baseWeight, yieldWeight, boost, effectiveWeight: baseWeight + boost };
}

export function moduloBiasBound(totalTickets: bigint): {
  totalTickets: bigint;
  remainder: bigint;
  maxRelativeDeviationNumerator: bigint;
  denominator: bigint;
  frozenBoundNumerator: bigint;
  withinFrozenBound: boolean;
} {
  if (totalTickets <= 0n || totalTickets > MASK_64) throw new Error("totalTickets outside uint64 range");
  const remainder = TWO_TO_64 % totalTickets;
  const maxRelativeDeviationNumerator =
    remainder === 0n ? 0n : remainder > totalTickets - remainder ? remainder : totalTickets - remainder;
  return {
    totalTickets,
    remainder,
    maxRelativeDeviationNumerator,
    denominator: TWO_TO_64,
    frozenBoundNumerator: totalTickets,
    withinFrozenBound: maxRelativeDeviationNumerator <= totalTickets,
  };
}

function logGamma(value: number): number {
  const coefficients = [
    676.520_368_121_885_1, -1_259.139_216_722_402_8, 771.323_428_777_653_1, -176.615_029_162_140_6,
    12.507_343_278_686_905, -0.138_571_095_265_720_12, 9.984_369_578_019_572e-6, 1.505_632_735_149_311_6e-7,
  ];
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value);

  const shifted = value - 1;
  let series = 0.999_999_999_999_809_9;
  for (let index = 0; index < coefficients.length; index += 1) {
    series += coefficients[index] / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(series);
}

function regularizedGammaQ(shape: number, value: number): number {
  if (!(shape > 0) || value < 0 || !Number.isFinite(shape) || !Number.isFinite(value)) {
    throw new Error("invalid incomplete gamma input");
  }
  if (value === 0) return 1;
  const epsilon = 1e-15;
  const tiny = 1e-300;
  const maxIterations = 10_000;

  if (value < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    let denominator = shape;
    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      denominator += 1;
      term *= value / denominator;
      sum += term;
      if (Math.abs(term) <= Math.abs(sum) * epsilon) {
        const lower = sum * Math.exp(-value + shape * Math.log(value) - logGamma(shape));
        return Math.max(0, Math.min(1, 1 - lower));
      }
    }
    throw new Error("incomplete gamma series did not converge");
  }

  let b = value + 1 - shape;
  let c = 1 / tiny;
  let d = 1 / Math.max(b, tiny);
  let fraction = d;
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const an = -iteration * (iteration - shape);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    fraction *= delta;
    if (Math.abs(delta - 1) <= epsilon) {
      return Math.max(0, Math.min(1, fraction * Math.exp(-value + shape * Math.log(value) - logGamma(shape))));
    }
  }
  throw new Error("incomplete gamma continued fraction did not converge");
}

export function chiSquarePValue(statistic: number, degreesOfFreedom: number): number {
  if (statistic < 0 || !Number.isFinite(statistic)) throw new Error("invalid chi-square statistic");
  if (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom <= 0) {
    throw new Error("degrees of freedom must be a positive integer");
  }
  return regularizedGammaQ(degreesOfFreedom / 2, statistic / 2);
}

function normalQuantile(probability: number): number {
  if (!(probability > 0 && probability < 1)) throw new Error("normal quantile probability outside (0,1)");
  const a = [
    -3.969_683_028_665_376e1, 2.209_460_984_245_205e2, -2.759_285_104_469_687e2, 1.383_577_518_672_69e2,
    -3.066_479_806_614_716e1, 2.506_628_277_459_239,
  ];
  const b = [
    -5.447_609_879_822_406e1, 1.615_858_368_580_409e2, -1.556_989_798_598_866e2, 6.680_131_188_771_972e1,
    -1.328_068_155_288_572e1,
  ];
  const c = [
    -7.784_894_002_430_293e-3, -3.223_964_580_411_365e-1, -2.400_758_277_161_838, -2.549_732_539_343_734,
    4.374_664_141_464_968, 2.938_163_982_698_783,
  ];
  const d = [7.784_695_709_041_462e-3, 3.224_671_290_700_398e-1, 2.445_134_137_142_996, 3.754_408_661_907_416];
  const lower = 0.024_25;
  const upper = 1 - lower;
  if (probability < lower) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (probability > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = probability - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

export function runWeightedScenario(scenario: WeightedScenario): ScenarioResult {
  if (!Number.isSafeInteger(scenario.draws) || scenario.draws <= 0) throw new Error("draw count must be positive");
  if (scenario.participants.length < 2) throw new Error("scenario requires at least two participants");
  if (scenario.participants.some(({ effectiveWeight }) => effectiveWeight < 0n)) throw new Error("negative weight");

  const totalWeight = scenario.participants.reduce((sum, participant) => sum + participant.effectiveWeight, 0n);
  if (totalWeight <= 0n || totalWeight > MASK_64) throw new Error("total weight outside usable uint64 range");

  const rng = new SplitMix64(scenario.seed);
  const observedCounts = scenario.participants.map(() => 0);
  const prefixEnds: bigint[] = [];
  let prefix = 0n;
  for (const participant of scenario.participants) {
    prefix += participant.effectiveWeight;
    prefixEnds.push(prefix);
  }

  for (let draw = 0; draw < scenario.draws; draw += 1) {
    const ticket = rng.next64() % totalWeight;
    const winner = prefixEnds.findIndex((end) => ticket < end);
    if (winner < 0) throw new Error("ticket did not map to the partition");
    observedCounts[winner] += 1;
  }

  const expectedProbabilities = scenario.participants.map(
    ({ effectiveWeight }) => Number(effectiveWeight) / Number(totalWeight),
  );
  const expectedCounts = expectedProbabilities.map((probability) => probability * scenario.draws);
  const observedProbabilities = observedCounts.map((count) => count / scenario.draws);
  const positiveCategories = expectedProbabilities.filter((probability) => probability > 0).length;
  const confidenceZ99 = normalQuantile(1 - 0.01 / (2 * positiveCategories));
  const confidenceIntervals99 = expectedProbabilities.map((probability, index) => {
    if (probability === 0) return { lower: 0, upper: 0, inside: observedCounts[index] === 0 };
    const radius = confidenceZ99 * Math.sqrt((probability * (1 - probability)) / scenario.draws);
    const lower = Math.max(0, probability - radius);
    const upper = Math.min(1, probability + radius);
    return { lower, upper, inside: observedProbabilities[index] >= lower && observedProbabilities[index] <= upper };
  });

  let chiSquare = 0;
  expectedCounts.forEach((expected, index) => {
    if (expected === 0) return;
    const difference = observedCounts[index] - expected;
    chiSquare += (difference * difference) / expected;
  });
  const degreesOfFreedom = positiveCategories - 1;
  if (degreesOfFreedom <= 0) throw new Error("scenario requires two positive-weight participants");
  const pValue = chiSquarePValue(chiSquare, degreesOfFreedom);
  const passed = confidenceIntervals99.every(({ inside }) => inside) && pValue > 0.01;

  return {
    id: scenario.id,
    proposition: scenario.proposition,
    draws: scenario.draws,
    seed: scenario.seed,
    totalWeight,
    observedCounts,
    expectedCounts,
    expectedProbabilities,
    observedProbabilities,
    confidenceIntervals99,
    confidenceZ99,
    chiSquare,
    degreesOfFreedom,
    pValue,
    passed,
  };
}

function makePosition(
  id: string,
  balanceTokens: number,
  theta: number,
  activeSeconds: number,
  fortune: number,
): ComputedPosition {
  return computePosition({
    id,
    balanceMicroUnits: BigInt(balanceTokens) * 1_000_000n,
    theta: BigInt(theta),
    activeSeconds: BigInt(activeSeconds),
    fortune: BigInt(fortune),
  });
}

function scenarioDefinitions(): PositionScenario[] {
  const week = 604_800;
  return [
    {
      id: "base-geometric",
      proposition: "P-F1",
      seed: 0x4c4f4b5046310001n,
      positions: [1, 2, 4, 8, 16, 32, 64, 128].map((balance) =>
        makePosition(`balance-${balance}`, balance, 4, week, 0),
      ),
    },
    {
      id: "base-varied-exposure",
      proposition: "P-F1",
      seed: 0x4c4f4b5046310002n,
      positions: [
        makePosition("zero-theta", 64, 0, week, 0),
        makePosition("steady", 8, 4, week, 0),
        makePosition("low-risk", 16, 1, week, 0),
        makePosition("mid-risk", 12, 2, (week * 3) / 4, 0),
        makePosition("late-join", 32, 4, week / 4, 0),
        makePosition("half-window", 24, 3, week / 2, 0),
        makePosition("small-positive", 1, 1, week / 4, 0),
        makePosition("high-exposure", 64, 4, week, 0),
      ],
    },
    {
      id: "fortune-varied-histories",
      proposition: "P-F1'",
      seed: 0x4c4f4b5046310003n,
      positions: [
        makePosition("fortune-0", 8, 4, week, 0),
        makePosition("fortune-1", 12, 3, (week * 3) / 4, 1),
        makePosition("fortune-5", 16, 2, week / 2, 5),
        makePosition("fortune-13", 24, 4, week / 4, 13),
        makePosition("fortune-26", 32, 1, week, 26),
        makePosition("fortune-39", 48, 3, week / 2, 39),
        makePosition("fortune-52", 64, 2, (week * 3) / 4, 52),
        makePosition("fortune-80-capped", 96, 4, week, 80),
      ],
    },
    {
      id: "fortune-split-principal",
      proposition: "P-F1'",
      seed: 0x4c4f4b5046310004n,
      positions: [
        makePosition("split-1", 16, 4, week, 52),
        makePosition("split-2", 16, 4, week, 52),
        makePosition("split-3", 16, 4, week, 52),
        makePosition("split-4", 16, 4, week, 52),
        makePosition("control-8", 8, 4, week, 0),
        makePosition("control-32", 32, 4, week, 13),
        makePosition("control-64", 64, 4, week, 26),
        makePosition("control-128", 128, 4, week, 52),
      ],
    },
  ];
}

function serializeScenario(definition: PositionScenario, draws: number): FairnessScenarioReport {
  const result = runWeightedScenario({
    id: definition.id,
    proposition: definition.proposition,
    draws,
    seed: definition.seed,
    participants: definition.positions.map(({ input, effectiveWeight }) => ({ id: input.id, effectiveWeight })),
  });
  const modulo = moduloBiasBound(result.totalWeight);
  return {
    id: result.id,
    proposition: result.proposition,
    status: result.passed ? "PASS" : "FAIL",
    draws: result.draws,
    seed: `0x${result.seed.toString(16).padStart(16, "0")}`,
    totalWeight: result.totalWeight.toString(),
    chiSquare: result.chiSquare,
    degreesOfFreedom: result.degreesOfFreedom,
    pValue: result.pValue,
    confidenceZ99: result.confidenceZ99,
    moduloBias: {
      remainder: modulo.remainder.toString(),
      maxRelativeDeviationNumerator: modulo.maxRelativeDeviationNumerator.toString(),
      denominator: modulo.denominator.toString(),
      frozenBoundNumerator: modulo.frozenBoundNumerator.toString(),
      withinFrozenBound: modulo.withinFrozenBound,
    },
    participants: definition.positions.map((position, index) => ({
      id: position.input.id,
      balanceMicroUnits: position.input.balanceMicroUnits.toString(),
      theta: Number(position.input.theta),
      activeSeconds: Number(position.input.activeSeconds),
      fortune: Number(position.input.fortune),
      baseWeight: position.baseWeight.toString(),
      boost: position.boost.toString(),
      effectiveWeight: position.effectiveWeight.toString(),
      expectedCount: result.expectedCounts[index],
      observedCount: result.observedCounts[index],
      expectedProbability: result.expectedProbabilities[index],
      observedProbability: result.observedProbabilities[index],
      confidenceInterval99: result.confidenceIntervals99[index],
    })),
  };
}

export function buildFairnessReport(
  drawsPerScenario: number = 1_000_000,
  generatedAtUtc: string = new Date().toISOString(),
): FairnessReport {
  if (!Number.isSafeInteger(drawsPerScenario) || drawsPerScenario <= 0) throw new Error("invalid draws per scenario");
  const definitions = scenarioDefinitions();
  const scenarios = definitions.map((definition) => serializeScenario(definition, drawsPerScenario));
  const propositionSummary = (proposition: WeightedScenario["proposition"]) => {
    const matching = scenarios.filter((scenario) => scenario.proposition === proposition);
    return {
      status: matching.every(({ status }) => status === "PASS") ? ("PASS" as const) : ("FAIL" as const),
      draws: matching.reduce((sum, scenario) => sum + scenario.draws, 0),
      scenarios: matching.length,
    };
  };

  const varied = scenarios.find(({ id }) => id === "base-varied-exposure");
  const splitDefinition = definitions.find(({ id }) => id === "fortune-split-principal");
  if (varied === undefined || splitDefinition === undefined) throw new Error("required fairness scenario missing");
  const zero = varied.participants.find(({ id }) => id === "zero-theta");
  const splitPositions = splitDefinition.positions.filter(({ input }) => input.id.startsWith("split-"));
  const splitBoost = splitPositions.reduce((sum, position) => sum + position.boost, 0n);
  const unsplitBoost = makePosition("unsplit", 64, 4, 604_800, 52).boost;
  const splitRoundingMargin = BigInt(splitPositions.length - 1);
  const pF1 = propositionSummary("P-F1");
  const pF1Prime = propositionSummary("P-F1'");
  const checks = {
    zeroWeightNeverWins: zero?.observedCount === 0,
    splitBoostWithinSingleAddressCap: splitBoost <= unsplitBoost + splitRoundingMargin,
    splitBoost: splitBoost.toString(),
    unsplitBoost: unsplitBoost.toString(),
    splitRoundingMargin: splitRoundingMargin.toString(),
    allModuloBoundsPass: scenarios.every(({ moduloBias }) => moduloBias.withinFrozenBound),
  };
  const passed =
    pF1.status === "PASS" &&
    pF1Prime.status === "PASS" &&
    checks.zeroWeightNeverWins &&
    checks.splitBoostWithinSingleAddressCap &&
    checks.allModuloBoundsPass;

  return {
    schemaVersion: 1,
    generatedAtUtc,
    status: passed ? "PASS" : "FAIL",
    methodology: {
      rng: "SplitMix64 deterministic full-width uint64 output",
      winnerMapping: "raw uint64 modulo total effective weight, then exact half-open prefix partition",
      confidenceInterval:
        "two-sided Bonferroni simultaneous 99% family-wise prediction intervals around theoretical probabilities",
      chiSquare: "Pearson goodness-of-fit over positive-weight categories; upper-tail p-value via regularized gamma Q",
      seedPolicy: "four fixed published seeds; failures are reported and never rerolled",
    },
    propositions: { "P-F1": pF1, "P-F1'": pF1Prime },
    trustBoundary: {
      proposition: "P-F4",
      status: "DOCUMENTED",
      statement:
        "Lok tests winner mapping under uniform 64-bit inputs; uniformity of FHE.rand is a Zama platform assumption.",
    },
    checks,
    scenarios,
  };
}

if (require.main === module) {
  const report = buildFairnessReport();
  const artifactPath = path.resolve(process.env.LOK_FAIRNESS_OUTPUT ?? path.join("artifacts", "fairness.json"));
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Fairness ${report.status}: P-F1=${report.propositions["P-F1"].draws} draws, P-F1'=${report.propositions["P-F1'"].draws} draws`,
  );
  if (report.status !== "PASS") process.exitCode = 1;
}
