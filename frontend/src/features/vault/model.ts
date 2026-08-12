export type SolvencyState = "verified" | "pending" | "restricted";

export type RiskSetting = 0 | 25 | 50 | 75 | 100;

export const riskSettings = [
  {
    value: 100,
    label: "All in prizes",
    detail: "Your full yield share funds the prize pool. Highest chance of winning.",
  },
  { value: 75, label: "Mostly prizes", detail: "Most of your yield funds prizes; a little accrues to your balance." },
  { value: 50, label: "Half and half", detail: "Half your yield accrues steadily; half buys chances." },
  { value: 25, label: "Mostly savings", detail: "Your yield mostly accrues; a small share buys chances." },
  { value: 0, label: "Savings only", detail: "Your yield accrues to your balance. You do not enter draws." },
] as const satisfies ReadonlyArray<{ value: RiskSetting; label: string; detail: string }>;
