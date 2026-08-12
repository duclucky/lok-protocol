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
