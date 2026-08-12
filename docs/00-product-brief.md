# 00 — Product Brief

Read this first. Everything downstream is an implementation of the argument made here. When you face a design decision
that the other documents do not settle, resolve it by asking which option better serves this thesis.

---

## 1. The thesis

Prize-linked savings — a savings account where the interest is pooled and awarded as prizes instead of paid out as
interest — is not a speculative product category. It is a proven one, at enormous scale, off-chain.

**UK Premium Bonds**, operated by NS&I, launched in November 1956. It has over **22 million** holders, has paid out more
than **£40 billion** in prizes, and a single monthly draw distributes on the order of **6.4 million prizes worth roughly
£447 million**. At the mid-2026 prize fund rate of 3.80%, that monthly pot implies roughly **£140 billion** of principal
sitting in the product. It pays no interest. It has no token. Its entire proposition is: your principal is safe, you can
withdraw any time, and each month you might win.

**PoolTogether** is the on-chain implementation of exactly this idea. It has been live for over four years and has
distributed on the order of **$10 million** in prizes. The versions and forks tracked on DefiLlama sit in the low
single-digit millions of TVL.

Four to five orders of magnitude separate the two. The interesting question is why.

It is not yield — on-chain yield has been competitive with gilt-backed prize funds for years. It is not user experience
— PoolTogether's app is good. It is not distribution — it has had far more marketing surface than a government savings
agency.

**The difference is confidentiality, and PoolTogether sells the absence of it as a feature.** Their documentation states
that draws are transparent and that anyone can confirm who won, when, and why. Their landing page advertises being 100%
transparent.

Transparency destroys this specific product through two distinct mechanisms:

**The discouragement mechanism.** In Premium Bonds, the fact that large holders win most prizes is a statistical truth —
94% of prize winners over a five-year window held more than £10,000, and three quarters held more than £25,000 — but it
is _invisible at the individual level_. A person holding £100 never sees their odds rendered next to the odds of a
person holding £50,000. On-chain, a depositor with $50 can compute their exact probability against a $2M whale in the
same pool, live, in the UI. Transparency converts an abstract statistic into a personal insult, and they leave.

**The liability mechanism.** A publicly announced winner is a doxxed address holding a windfall: a phishing target, an
extortion target, and in many jurisdictions a tax and social problem. NS&I sends a person to the winner's door in
private. The on-chain equivalent is an event log.

**Conclusion: confidentiality is not a feature layered onto prize savings. It is the precondition that the one
successful implementation has always had, and that every on-chain implementation has lacked.** Lok is the first version
that has it, because FHE is the first technology that permits encrypted state to remain composable and publicly
verifiable at the same time.

### The local layer

Vietnam runs both halves of this product, separately, at scale and outside the banking system: the state lottery (_vé
số_) as a daily ritual, and _hụi/họ_ as informal rotating savings associations. The lottery destroys wealth; the savings
circles carry counterparty risk. The reason neither has moved on-chain is not technical. In that social context, letting
your neighbours see your balance is not a privacy preference — it is a safety and social-standing problem.

This framing belongs in the pitch and the X thread, not in the code. It is the part of the story that cannot be copied
by a competing submission.

---

## 2. What we are building

**Name:** Lok Protocol. **Tagline:** _Prize savings, sealed._

A single confidential prize-savings vault on Sepolia:

- Deposit `cUSDC` (ERC-7984 confidential USDC). Balance is encrypted; only the owner can read it.
- Principal is routed to a yield source through a swappable adapter.
- Every draw period, pooled yield is awarded as a prize to one depositor.
- Odds are proportional to each depositor's **time-weighted average balance** over the period, scaled by their private
  risk setting.
- Withdraw principal at any time, in any protocol state.

---

## 3. The three mechanisms

These are what make Lok a product rather than a demo. Each is either impossible or pointless without FHE. That test —
"would this mechanism still make sense if the data were public?" — is the standard any new feature must pass.

### M1 — The Risk Dial

Each depositor privately chooses **θ**: what fraction of _their own share of the yield_ is converted into lottery
tickets, with the remainder credited directly to their balance as ordinary yield.

θ is stored as an encrypted small integer in `{0, 1, 2, 3, 4}` over a denominator of 4, i.e. 0% / 25% / 50% / 75% /
100%.

- θ = 4 (100%) — classic prize savings. All of the user's yield share funds the prize pool; maximum odds.
- θ = 0 — a pure confidential savings account. No lottery participation, keeps its full yield share.
- In between — a blend. You buy odds with your own yield, which makes the mechanism self-funding and actuarially fair
  with no cross-subsidy.

**Why this requires FHE.** θ is a _revealed risk preference_, which is among the most sensitive financial facts about a
person. Publishing it would (a) expose risk appetite to counterparties and lenders, (b) create a targeting list for
scams aimed at gambling-inclined users, (c) turn the pool into a status leaderboard where nobody will set 100% (reads as
reckless) or 0% (reads as timid), and (d) combined with a public balance, republish the exact per-user odds — returning
us to the discouragement mechanism the whole product exists to eliminate.

**Why this is genuinely novel.** PoolTogether _cannot_ ship this. In a transparent pool, offering per-user prize/yield
splits means publishing a risk-preference leaderboard. The mechanism only becomes usable under encryption. That is the
definition of an FHE-native product feature, as opposed to "an existing product with privacy bolted on".

**Default θ = 4 (100%).** This matters for compliance: with the default untouched, Lok is a literal implementation of
the bounty specification. The dial is an opt-in extension. See `docs/01-bounty-compliance.md` §2.

### M2 — Encrypted TWAB (eTWAB)

Odds are computed from the depositor's **time-weighted average balance** over the draw window, entirely on ciphertext.

This is not decoration. It answers the first question anyone familiar with prize savings will ask: _what stops someone
depositing a large amount five minutes before the draw and withdrawing after?_ PoolTogether solved this with a TWAB
controller — a depositor who holds $200 for the final 12 hours of a 24-hour period has the same time-weighted balance as
one who held $100 for the full period. A submission that snapshots balances at draw time has the exploit and has not
read the prior art.

**Why this is elegant under FHE.** The weighting factor is elapsed time, which is _public_. So the accumulation is a
**scalar** multiplication — the encrypted balance multiplied by a plaintext duration. FHE is expensive for
data-dependent branching and comparatively cheap for scalar arithmetic, so the one mechanism the product needs most is
the one FHE handles best. Exploit this pattern everywhere.

### M3 — Quiet Win, with optional proof

By default the draw reveals nothing about the winner. Every participant receives an encrypted credit; losers receive an
encrypted zero. The on-chain footprint of a winner and a loser is byte-for-byte indistinguishable. A winner discovers
the win only by decrypting their own balance.

Optionally, a winner may publish a verifiable proof of their own prize — a single public decryption of their own credit
handle — producing a shareable proof-of-win. Social proof without coerced disclosure.

**The inversion is the pitch.** PoolTogether advertises that anyone can confirm who won. In Lok, **only the winner
decides whether anyone knows.** One sentence, and it is the whole comparison slide.

---

## 4. Scope

### Build (must ship)

- One pool, one asset (`cUSDC` on Sepolia), one prize per draw
- M1 Risk Dial, M2 eTWAB, M3 Quiet Win + proof-of-win
- **Dual-mode randomness**: non-strict (spec-exact default) and strict commit-reveal (trust-minimised), see `docs/02` §9
- **Solvency invariant** enforced by confidential accounting plus aggregate checkpoints, surfaced as the latest verified
  risk epoch without publishing numeric principal, claimable liabilities or assets (I11)
- **Guardian** (abort-only multisig) or, if no real multisig, permissionless abort + timeouts only
- **Three retention mechanisms** (`docs/12`): Fortune (per-user encrypted momentum with disclosed pool-level aggregate
  inference), the Unsealing (recurring reveal ritual), Living Pool (social proof from public aggregates)
- Two-pass paginated draw with a permissionless crank
- `IYieldAdapter` + `MockYieldAdapter` (deployed) + `MorphoVaultAdapter` (written, not deployed)
- Failure path: principal withdrawable with no dependency on the decryption oracle
- Measured HCU benchmark table and an architecture write-up
- Third-party `verify-draw.ts` script
- Vite + React frontend with correct pending states on every decryption
- Demo hardening: test-token faucet, seeded participants, manual draw trigger

### Cut (do not build, do not discuss further)

Multi-tier prize structures · permissionless vault factory · governance token · mobile app · multichain · account
abstraction or gas sponsorship · referral programme · prize expiry · NFTs · **any leaderboard** (it contradicts the
thesis) · social feed · fiat on-ramp · admin dashboards beyond the demo controls.

### Optional, only if the must-ship list is complete

- **Auditor view.** A user delegates decryption of their own position and draw history to a nominated address
  (accountant, tax authority, compliance provider) using the protocol's delegated decryption. Maps onto Zama's
  institutional and compliance positioning. Cheap: the SDK already exposes the hooks.

Note: the "no-win streak boost" that was previously listed here is now **Fortune**, promoted to core and fully specified
in `docs/12` §1. It goes through the proof pipeline (P-F1', P-F5, P-F6, P-P7) before code, and is designed as _additive
and bounded_ to remain a savings mechanism rather than gambling escalation. If its fairness proof cannot be closed
within the product's savings identity, cut it and keep it as a documented, deliberately-declined design — declining well
demonstrates product maturity.

---

## 5. How this submission is meant to win

The competitive field is large — the previous season drew 188 submissions across three tracks with 9 winners. Assume
150+ competing entries, most of which will be: one pool, one prize, a loop over depositors to pick a winner, mocked
yield, a dark gradient UI. Functional, and indistinguishable.

Three artefacts separate Lok, and they are cheap relative to their effect because almost nobody produces them:

1. **A measured HCU benchmark table** at N = 10 / 100 / 1,000 depositors, with the architectural explanation of why
   pagination is mandatory and why the elegant streaming algorithms are impossible under FHE.
2. **A written mainnet path** — `IYieldAdapter` with a real `MorphoVaultAdapter` implementation targeting a production
   confidential yield venue, so the demo is a valve waiting to be opened rather than a toy.
3. **A failure path** — funds recoverable when the oracle is silent, the crank stops, or the protocol is paused.

A reviewer who has just read 150 proofs-of-concept recognises all three within a minute.
