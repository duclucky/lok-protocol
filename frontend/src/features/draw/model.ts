export const DRAW_STATES = [
  "IDLE",
  "OPEN",
  "SWEEP_A",
  "AWAIT_TOTAL",
  "REVEAL",
  "RANDOM_SET",
  "SWEEP_B",
  "SETTLED",
] as const;

export type DrawState = (typeof DRAW_STATES)[number];

export type UserDrawDetail = Readonly<{
  title: string;
  summary: string;
  nextStep: string;
  actionRequired: boolean;
}>;

export const drawStateDetails: Record<DrawState, { label: string; detail: string; progress: number }> = {
  IDLE: {
    label: "Waiting for the next draw",
    detail: "Deposits, withdrawals, and exits remain available.",
    progress: 0,
  },
  OPEN: {
    label: "Draw window open",
    detail: "Participant weights accumulate until the fixed end boundary.",
    progress: 10,
  },
  SWEEP_A: {
    label: "Counting sealed tickets",
    detail: "Pass A processes the frozen participant snapshot in small batches.",
    progress: 32,
  },
  AWAIT_TOTAL: {
    label: "Checking the aggregate",
    detail: "Only the completed total ticket weight is eligible for public decryption.",
    progress: 48,
  },
  REVEAL: {
    label: "Reveal window active",
    detail: "Committed entropy can be revealed until the deadline. User funds remain available.",
    progress: 58,
  },
  RANDOM_SET: {
    label: "Random material fixed",
    detail: "The reveal window is closed and the final random value cannot be changed.",
    progress: 70,
  },
  SWEEP_B: {
    label: "Settling sealed credits",
    detail: "Pass B assigns encrypted credits uniformly without exposing the winner.",
    progress: 86,
  },
  SETTLED: {
    label: "Draw settled",
    detail: "Public aggregates are ready for independent verification.",
    progress: 100,
  },
};

export const userDrawDetails: Record<DrawState, UserDrawDetail> = {
  IDLE: {
    title: "Waiting for the next draw",
    summary: "Your principal remains available while the next draw is prepared.",
    nextStep: "Keeper automation opens the next draw.",
    actionRequired: false,
  },
  OPEN: {
    title: "This draw is open",
    summary: "You can deposit or withdraw while sealed weights accumulate.",
    nextStep: "After the draw closes, keeper automation counts sealed entries.",
    actionRequired: false,
  },
  SWEEP_A: {
    title: "Encrypted entries are being counted",
    summary: "The draw is advancing in bounded onchain batches.",
    nextStep: "Keeper automation completes the aggregate count.",
    actionRequired: false,
  },
  AWAIT_TOTAL: {
    title: "The aggregate is being checked",
    summary: "Only draw totals are requested for public decryption.",
    nextStep: "Keeper automation submits the verified aggregate totals.",
    actionRequired: false,
  },
  REVEAL: {
    title: "The reveal window is open",
    summary: "Committed entropy can be revealed without exposing participant balances.",
    nextStep: "Randomness is generated only after the reveal window closes.",
    actionRequired: false,
  },
  RANDOM_SET: {
    title: "Randomness is fixed",
    summary: "The encrypted random material cannot be changed before assignment.",
    nextStep: "Keeper automation begins encrypted winner assignment.",
    actionRequired: false,
  },
  SWEEP_B: {
    title: "Encrypted prizes are being assigned",
    summary: "Every participant receives the same encrypted-credit update pattern.",
    nextStep: "Keeper automation completes settlement.",
    actionRequired: false,
  },
  SETTLED: {
    title: "This draw is settled",
    summary: "Your private result is ready to check with your connected wallet.",
    nextStep: "Check your private result on the Proof page.",
    actionRequired: true,
  },
};

export const demoDraw = {
  id: 14,
  participants: 38,
  cursorA: 12,
  cursorB: 8,
  commitment: "0x4e8b2f6d3c991af09bb9ea99c7fef991a81718abf7127dc94f748e4085e1b7c2",
  commitmentBlock: 9_127_604,
  revealDeadline: "18:42 UTC",
  random: "0x17c2...91af",
  ticketSpace: "48,291,774",
} as const;
