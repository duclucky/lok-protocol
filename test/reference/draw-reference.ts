const TICKET_SCALE_BITS = 26n;
const FORTUNE_CAP = 52n;
const MIN_PARTICIPANTS = 5;

export type DrawParticipant = {
  ticketDelta: bigint;
  yieldDelta: bigint;
  fortune: bigint;
};

export type DrawVector = {
  seed: string;
  realisedYield: bigint;
  participants: DrawParticipant[];
};

export type EvaluatedParticipant = DrawParticipant & {
  baseRiskWeight: bigint;
  yieldWeight: bigint;
  directWeight: bigint;
  boost: bigint;
  effectiveWeight: bigint;
  rangeStart: bigint;
  rangeEnd: bigint;
};

export type DrawEvaluation = {
  participants: EvaluatedParticipant[];
  nonDustParticipants: number;
  totalTickets: bigint;
  totalBaseRiskWeight: bigint;
  totalYieldWeight: bigint;
};

export type DrawSettlement = DrawEvaluation & {
  prizeAmount: bigint;
  directRate: bigint;
  prizeCredits: bigint[];
  directCredits: bigint[];
  fortunes: bigint[];
  winnerIndex: number | null;
};

function persistDivergence(seed: string, stage: string, actual: unknown, expected: unknown): void {
  const directory = path.resolve(process.cwd(), "artifacts", "differential");
  mkdirSync(directory, { recursive: true });
  const body = JSON.stringify(
    { seed, stage, actual, expected, recordedAtUtc: new Date().toISOString() },
    (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  );
  try {
    writeFileSync(path.join(directory, "draw-first-divergence.json"), `${body}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

export function assertDrawEquivalent(seed: string, stage: string, actual: unknown, expected: unknown): void {
  try {
    deepStrictEqual(actual, expected);
  } catch (error) {
    persistDivergence(seed, stage, actual, expected);
    throw new Error(`draw differential divergence at seed ${seed} (${stage})`, { cause: error });
  }
}

function cappedFortune(fortune: bigint): bigint {
  if (fortune < 0n) throw new Error("negative Fortune");
  return fortune > FORTUNE_CAP ? FORTUNE_CAP : fortune;
}

export function evaluateDraw(vector: DrawVector): DrawEvaluation {
  if (vector.realisedYield < 0n) throw new Error("negative realised yield");
  let prefix = 0n;
  let totalBaseRiskWeight = 0n;
  let totalYieldWeight = 0n;
  let nonDustParticipants = 0;

  const participants = vector.participants.map((participant): EvaluatedParticipant => {
    if (participant.ticketDelta < 0n || participant.yieldDelta < 0n) throw new Error("negative draw input");
    const baseRiskWeight = participant.ticketDelta >> (TICKET_SCALE_BITS + 2n);
    const yieldWeight = participant.yieldDelta >> TICKET_SCALE_BITS;
    if (baseRiskWeight > yieldWeight) throw new Error("risk weight exceeds yield weight");
    const directWeight = yieldWeight - baseRiskWeight;
    const proportional = (baseRiskWeight * cappedFortune(participant.fortune)) / (2n * FORTUNE_CAP);
    const boostCeiling = baseRiskWeight >> 1n;
    const boost = proportional < boostCeiling ? proportional : boostCeiling;
    const effectiveWeight = baseRiskWeight + boost;
    const rangeStart = prefix;
    prefix += effectiveWeight;
    totalBaseRiskWeight += baseRiskWeight;
    totalYieldWeight += yieldWeight;
    if (yieldWeight > 0n) nonDustParticipants += 1;

    return {
      ...participant,
      baseRiskWeight,
      yieldWeight,
      directWeight,
      boost,
      effectiveWeight,
      rangeStart,
      rangeEnd: prefix,
    };
  });

  if (nonDustParticipants < MIN_PARTICIPANTS) {
    return { participants, nonDustParticipants, totalTickets: 0n, totalBaseRiskWeight: 0n, totalYieldWeight: 0n };
  }
  return { participants, nonDustParticipants, totalTickets: prefix, totalBaseRiskWeight, totalYieldWeight };
}

export function settleDraw(vector: DrawVector, randomTicket: bigint): DrawSettlement {
  const evaluated = evaluateDraw(vector);
  const { participants, totalTickets, totalBaseRiskWeight, totalYieldWeight } = evaluated;
  if (totalYieldWeight === 0n) {
    return {
      ...evaluated,
      prizeAmount: 0n,
      directRate: 0n,
      prizeCredits: participants.map(() => 0n),
      directCredits: participants.map(() => 0n),
      fortunes: participants.map((participant) => cappedFortune(participant.fortune)),
      winnerIndex: null,
    };
  }
  if (totalTickets > 0n && (randomTicket < 0n || randomTicket >= totalTickets)) {
    throw new Error("random ticket outside partition");
  }

  const prizeAmount = (vector.realisedYield * totalBaseRiskWeight) / totalYieldWeight;
  const directRate = (vector.realisedYield << TICKET_SCALE_BITS) / totalYieldWeight;
  let winnerIndex: number | null = null;
  if (totalTickets > 0n) {
    const mappedIndex = participants.findIndex(
      ({ rangeStart, rangeEnd }) => rangeStart <= randomTicket && randomTicket < rangeEnd,
    );
    if (mappedIndex < 0) throw new Error("partition does not map random ticket");
    winnerIndex = mappedIndex;
  }

  const prizeCredits = participants.map((_, index) => (index === winnerIndex ? prizeAmount : 0n));
  const directCredits = participants.map(({ directWeight }) => (directWeight * directRate) >> TICKET_SCALE_BITS);
  const fortunes = participants.map((participant, index) => {
    return index === winnerIndex ? 0n : cappedFortune(participant.fortune + 1n);
  });

  return { ...evaluated, prizeAmount, directRate, prizeCredits, directCredits, fortunes, winnerIndex };
}
import { deepStrictEqual } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
