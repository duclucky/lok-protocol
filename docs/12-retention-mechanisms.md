# 12 — Retention Mechanisms

This document specifies the three additions that close the "nothing happens between draws / the losing majority gets
nothing / looks like an empty box" gap identified in product review. They sit at three different risk tiers
deliberately:

- **Fortune (momentum)** — a real encrypted mechanism. Goes through the full proof pipeline before code.
- **The Unsealing** — a UX ritual. No new contract, no new proof, no new leakage.
- **Living Pool** — a display of already-public aggregates. No new contract, no new proof, no new leakage.

Read `docs/10-proof-strategy.md` before implementing Fortune; it is the one that adds proof obligations. The other two
are frontend work governed by `docs/06-frontend-spec.md`.

The governing test for all three: **"Could PoolTogether ship this?"** If yes, it is not a differentiator. All three fail
that test for PoolTogether — each depends on confidentiality to exist.

---

## 1. Fortune — encrypted momentum for the losing majority

### The problem it solves

Prize savings is an experience of losing. In the real product, a holder waits on average about three and a half years
for a first prize. The winner is delighted once; the losing majority — nearly everyone, nearly every draw — receives
nothing, not even a reason to stay. This is the category's primary churn driver, and no implementation, on-chain or off,
addresses it. Designing only for the winning minority is designing against 99% of the actual experience.

### The mechanism

Each participant carries an encrypted `fortune` value. Each draw they do **not** win, `fortune` increases by a fixed
step. When they win, it resets to zero. `fortune` adds a **bounded** boost to their ticket weight in the next draw, so a
long run of losses gently improves the odds, and a win returns them to baseline.

```
per user:  euint16 fortune            // number of consecutive non-winning draws, capped
effective weight this draw:
    f       = min(fortune, FORTUNE_CAP)
    boost   = min(floor(w * f / (2 * FORTUNE_CAP)), w >> 1)
    wEff    = w + boost
```

### The three design decisions that keep it a savings product, not gambling

This is where the mechanism can slip out of the product's identity, so each choice is deliberate and each maps to a
proof obligation.

**Decision 1 — additive, not a weight multiplier.** Fortune computes a bounded amount from weight and history, then adds
that amount to ticket weight. A multiplier compounds and produces escalation dynamics ("the longer I lose, the more the
system pushes me"). Addition with a ceiling produces a gentle floor under long-time losers without ever making a large
loss "chase" itself. **Proof obligation P-F5:** effective odds are monotone but the boost is bounded by
`FORTUNE_CAP * FORTUNE_STEP`, independent of balance beyond `boostCeil`.

**Decision 2 — the boost is capped relative to the user's own weight.** `boost` cannot exceed `boostCeil(w)`, a fixed
fraction of the user's real ticket weight. This prevents a dust depositor from accumulating unbounded odds by never
winning, and keeps odds fundamentally tied to actual savings. Someone with $0 deposited and infinite fortune still has
near-zero weight. **This is what stops Fortune from becoming a way to win without saving** — the entire point of a
_savings_ product.

**Decision 3 — fortune is not a subsidy transfer.** Fortune redistributes _probability_, not _money_. The prize is
unchanged; no one's principal or yield funds anyone else's boost. Expected value shifts slightly from never-losers
toward long-time losers, but total expected payout is conserved. **Proof obligation P-S3 still holds** (prize
conservation): exactly one prize, exactly `prizeAmount`.

### Why this must be encrypted (the PoolTogether test)

A public "has not won in 40 draws" flag is simultaneously a stigma and an exploitable signal — it marks a user as due,
desperate, or a long-term holder, all of which are targeting information. Lok keeps each user's Fortune ciphertext and
reset private. The necessary effective-ticket and base-risk aggregates reveal only bounded pool-level Fortune movement,
never a per-user decomposition; this residual inference is disclosed as threat-model S8 and mitigated by the anonymity
floor. In a transparent pool the mechanism would become a public leaderboard of losers. **PoolTogether cannot ship it.**
It is the second mechanism, after the Risk Dial, that exists _only_ under encryption — which is exactly what makes it a
genuine differentiator rather than a feature.

### The cost, stated honestly

- **HCU:** PASS A computes the bounded boost, effective ticket weight and a separate base-risk aggregate; PASS B resets
  Fortune uniformly. Prior per-participant estimates are invalid after the three-aggregate correction. Re-measure and
  re-set batch caps (`docs/04-hcu-budget.md` §5).
- **Fairness proof rewritten.** Odds now depend on history, so proposition P-F1 no longer holds as written. It is
  replaced by P-F1' below. This is the expensive part, and it is why Fortune goes through the proof pipeline before
  code.
- **Reset must be exact.** A win resets fortune to zero. A bug that fails to reset lets a past winner keep accumulating
  — a slow, silent unfairness. `test_Fortune_ResetsOnWin` is mandatory and high-value.

### Constants

```solidity
uint16 constant FORTUNE_CAP = 52; // 52 settled draws; calendar duration follows deployment cadence
uint64 constant FORTUNE_STEP = 43_303_842_570_871; // proof ceiling for w < 2^52
// boostCeil(w) = w >> 1; runtime boost grows linearly from 0 to this ceiling
```

`FORTUNE_CAP` is draw-count based, not calendar based. On the near-instant Sepolia demonstration it is reached after 52
eligible losses; a longer-cadence production deployment reaches the same bound over a longer wall-clock period. This
timing change does not alter the Fortune formula, its per-position cap, or any frozen proposition.

For `w < 2^52`, `w * min(fortune, 52) < 2^58`, so the proportional product fits `euint64`; division is by the plaintext
scalar 104. `FORTUNE_STEP = ceil((2^52 - 1) / 104)` is a proof-bound constant retained for frozen P-F5, not an absolute
per-address award. The proportional construction makes a split position additive up to floor-rounding and closes P-F9.

### Proof obligations (added to `docs/10-proof-strategy.md` §3)

| ID    | Proposition                                                                                                                                                           | Tier | Tool                                                 | Pass criterion                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P-F1' | With Fortune active, each participant's empirical win frequency matches `wEff_i / Σ wEff` within a 99% CI.                                                            | C    | Monte Carlo ≥10⁶ draws with varied fortune histories | Inside CI; chi-squared p > 0.01.                                                                                   |
| P-F5  | The Fortune boost is bounded: `boost <= FORTUNE_CAP * FORTUNE_STEP` and `boost <= boostCeil(w)`, so no run of losses produces unbounded or balance-independent odds.  | A    | Hand proof + boundary tests                          | Bounds hold at `fortune = 0`, `FORTUNE_CAP`, and beyond; dust-depositor case verified.                             |
| P-F6  | Fortune resets to zero exactly on a win and never on a loss.                                                                                                          | A    | Unit + invariant                                     | Reset fires iff the credit is non-zero, across fuzzed draw sequences.                                              |
| P-P7  | Per-user Fortune is never public or granted to a non-owner; only bounded pool-level boost is inferable from approved aggregates, and no event reveals a winner/reset. | D    | Static + log-diff + inference review                 | No per-user path; uniform events/grants; aggregate residual documented as S8 and protected by the anonymity floor. |

P-P7 has a subtlety worth flagging to the implementer: the fortune **reset** happens inside the same uniform
`creditDraw` path for everyone — losers reset-by-adding-zero-then-not-resetting, winners reset — and this branch is done
with `FHE.select`, never a plaintext `if`. If reset were a visible conditional, it would leak the winner. The reset is
`fortune = FHE.select(win, 0, fortune + step)` — one select, no branch, indistinguishable on-chain. This is the same
discipline as the prize credit itself.

### Scope guard

Fortune is the **only** new encrypted mechanism admitted in this round. If implementing it reveals that the fairness
proof cannot be closed within the product's savings identity — for instance if the only way to make it feel meaningful
is to raise the boost into escalation territory — **cut it and keep it as a documented, deliberately-declined design in
the pitch.** A mechanism you analysed and correctly declined, with the reason, demonstrates product maturity that 149
other submissions will lack. Declining well is a winning move, not a failure.

---

## 2. The Unsealing — the recurring ritual

### What it is

Not a mechanism. A reframing of an action that already exists: decrypting your own prize credit after a draw. Instead of
a technical "decrypt" button yielding a line of text, it is a deliberate, once-per-draw **moment**: the seal on your
ledger entry cracks, and your result is revealed underneath — whether it is a prize or not.

### Why it is the missing rhythm

Premium Bonds survived seventy years on a ritual: each month you check. The mechanism is unremarkable; the recurring
small moment of anticipation is what creates the habit. Lok has no such rhythm — a user deposits and forgets. The
Unsealing gives every draw a reason to return, for winners and losers alike, because the anticipation is in the
_unsealing_, not the _outcome_. Even a loss is a moment when it is a ritual rather than a silent zero.

### Why only confidentiality makes it real (the PoolTogether test)

PoolTogether can animate anything, but it has nothing to unseal — results are public from the moment of the draw. An
unsealing ritual is only meaningful when something was genuinely sealed. Privacy converts a UX flourish into a real
mechanic. **PoolTogether cannot ship a meaningful version of this.**

### Implementation

Governed by `docs/06-frontend-spec.md`. No contract change. Build it as the primary treatment of the draw-result reveal:

- A single **"Unseal my result"** action per draw — the same button whether the user won or lost, so pressing it leaks
  nothing (side channel S6 in the threat model). Never a "Claim prize" button that only winners would rationally press.
- The reveal is the one place to spend animation boldness: the sealed-value guilloche treatment (`docs/06` §7) cracking
  open. One orchestrated moment, `prefers-reduced-motion` respected.
- On a loss: not "You didn't win" but a dignified framing that acknowledges the ritual and, if Fortune is built, hints
  that fortune grew — _"No prize this time. Your fortune deepens."_ — without showing a number (which would leak
  history).
- On a win: the celebratory reveal, with the optional **"Publish proof"** path.

### Cost

Near zero risk. Frontend only. It doubles as the recurring form of the video's signature moment: the side-by-side
identical wallets, one unsealing to a prize.

---

## 3. Living Pool — social proof without leakage

### What it is

A display on the vault home screen built from public counters, prize aggregates and the allowlisted solvency checkpoint
result. It never exposes numeric aggregate principal/liability/assets; it answers "is this real, is anyone here, and
when was solvency last verified?"

### Why it is the missing trust signal

An empty or silent pool looks like a trap. The single strongest converter of a hesitant depositor is evidence that
others already trust the thing. The challenge is showing liveness **without** showing who or how much — which is exactly
the constraint Lok is built to satisfy, and exactly what no transparent competitor has had to solve.

### What it shows (all public by the approved allowlist)

| Signal                     | Source                                           | Leakage                                                                                                 |
| -------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Participant count          | length of `participants`                         | None — membership is already public (`docs/08` §2).                                                     |
| Draws settled to date      | draw counter                                     | None.                                                                                                   |
| Total prizes distributed   | sum of public `prizeAmount` per draw             | None — prize amounts are public by design (trap T4).                                                    |
| Current prize estimate     | plaintext yield projection                       | None.                                                                                                   |
| Solvency checkpoint status | `lastSolventRiskEpoch`, pending/restricted state | Reveals only the aggregate boolean and risk epoch; numeric principal/liability/assets remain encrypted. |

### Why only confidentiality makes it a differentiator (the PoolTogether test)

PoolTogether shows all of this too — _by making everything public_. Living Pool shows liveness while every per-user
figure stays sealed. Same reassurance, opposite privacy posture. The differentiator is not the dashboard; it is that the
dashboard coexists with total per-user confidentiality. **PoolTogether achieves this only by giving up the thing Lok
protects.**

### Implementation

Governed by `docs/06-frontend-spec.md`. Read-only aggregates, updated per block, rendered instantly with no decryption
in the path (so it fills the screen while sealed per-user values load). It is the public, instant layer described in
`docs/06` §3's Vault screen — this document just names it and gives it the social-proof job.

### Cost

Near zero risk. Reads existing public state. The only discipline required: **never** add a per-user figure to this view,
however tempting for "richness". Every field here must be an aggregate. A single per-user number turns social proof into
a privacy breach.

---

## 4. How the three land together

The pitch order matters, because these must reinforce the thesis, not clutter it:

1. **Living Pool** answers "is this real?" on arrival — instant, public, reassuring.
2. **The Unsealing** gives the recurring reason to return — the ritual, every draw.
3. **Fortune** gives the losing majority a sense of progress — invisible, bounded, savings-preserving.

All three are downstream of the same one-sentence thesis: _confidentiality is the product_. Living Pool proves liveness
without exposure; the Unsealing makes privacy a felt experience; Fortune designs for the losing majority precisely
because their losses are private. None is a bolt-on. Each is the thesis applied to a different moment in the user's
life.

If any of the three starts to read as a feature rather than an expression of the thesis — cut it. The submission wins on
one sharp idea expressed completely, not on the count of mechanisms.
