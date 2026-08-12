# 02 — Architecture

This document explains _why_ the system is shaped the way it is. If you understand the reasoning here, you can make
correct decisions about cases the specification does not cover. Function-level detail lives in
`docs/05-contract-specs.md`.

---

## 1. The central engineering problem

Prize savings needs odds proportional to holdings. The textbook algorithm is: pick a random ticket number `r`, then walk
the depositors accumulating their ticket counts until the running total exceeds `r`; that depositor wins.

Under FHE this algorithm is unavailable, for three independent reasons.

**Reason 1 — the transaction-depth ceiling.** A running accumulation is inherently sequential. FHEVM enforces a
per-transaction limit on the _depth_ of chained homomorphic operations, separate from the total. At roughly 162,000 HCU
per encrypted 64-bit addition against a 5,000,000 depth budget, a sequential accumulation dies at about **30
depositors**. A submission that loops will work beautifully in a five-wallet demo and revert at a hundred.

**Reason 2 — no division by an encrypted divisor.** `FHE.div` and `FHE.rem` exist only in scalar form: the divisor must
be plaintext. So `r mod encryptedTotal` cannot be computed, and neither can a pro-rata share `balance / totalSupply`
when both operands are encrypted. Every elegant single-pass weighted sampling algorithm — weighted reservoir sampling,
the Gumbel / A-Res key trick `−ln(u)/w` — requires exactly this division or a logarithm. **They are all dead.** Knowing
_why_ they are dead, and saying so, is a strong signal of understanding.

**Reason 3 — no branching on ciphertext.** You cannot `break` out of the walk when the threshold is crossed, because the
comparison result is encrypted.

### The resolution

Three moves, in combination:

**Move 1 — accumulate at write time, not at draw time.** Maintain each depositor's time-weighted accumulator
incrementally, updated when _they_ transact. Depth per update is a small constant and never a function of the number of
depositors. The draw then reads a difference of two checkpoints rather than replaying history.

**Move 2 — publicly decrypt allowlisted aggregate results only.** The pool's _total_ ticket weight is decrypted after
the window closes, which converts the denominator into plaintext and dissolves the encrypted-division restriction.
Numeric aggregate principal, claimable liabilities and custody assets are not assumed public; solvency exposes only a
checkpoint-specific aggregate boolean.

**Move 3 — paginate, which resets depth as well as total.** This is the key insight and it is easy to miss: **the HCU
depth limit is per-transaction.** A sequential prefix sum across 1,000 depositors is therefore entirely feasible if it
is split across transactions, carrying the encrypted running total in storage between them. Pagination is not merely a
workaround for the global limit; it is what makes sequential encrypted computation possible at all.

State this reasoning in the README and the video. It is the intellectual core of the submission.

---

## 2. Component map

```
                    ┌──────────────────────────────────────────┐
   user wallet ────► │ LokVault                                 │
                    │  • confidential deposit / withdraw        │
                    │  • euint64 balance                        │
                    │  • euint128 eTWAB accumulators            │
                    │  • euint8 θ (risk dial)                   │
                    │  • _syncUser(): all per-user FHE math     │
                    └───────────┬──────────────────────┬────────┘
                                │ checkpoints          │ principal
                                ▼                      ▼
                    ┌───────────────────────┐   ┌──────────────────┐
                    │ LokDrawManager        │   │ IYieldAdapter    │
                    │  • draw state machine │   │  ├ MockYield…    │
                    │  • FHE.rand → r       │   │  └ MorphoVault…  │
                    │  • PASS A: prefix sums│   └──────────────────┘
                    │  • PASS B: award      │
                    └───────────┬───────────┘
                                │ handles, events
                                ▼
              Zama Protocol: FHEVMExecutor · ACL · Gateway · Coprocessors · KMS
                                │
                    ┌───────────┴───────────┐
                    │ crank.ts (keeper)     │  permissionless
                    │ verify-draw.ts        │  third-party verifier
                    └───────────────────────┘
```

### Division of responsibility — the governing rule

> **Ongoing per-user accrual happens in `_syncUser`, paid for by the user's own transaction. Draw-specific differencing,
> winner selection and funded crediting happen only in bounded paginated sweeps.**

Every transaction has its own 20,000,000 HCU budget. Work done lazily in a user's own transaction is effectively free.
The identical work inside a draw sweep multiplies by the participant count and becomes the scaling ceiling. This rule is
why θ changes and accumulator rolls cost the draw nothing. Direct-yield credit is the deliberate exception: it depends
on the frozen per-draw snapshot and therefore executes uniformly in PASS B. Apply this boundary to any new feature.

---

## 3. Data model

```solidity
// ── per depositor ────────────────────────────────────────────────────────────
mapping(address => euint64)  balance;       // total confidential claimable balance, principal + funded earnings
mapping(address => euint64)  principalBalance; // remaining refundable principal; always <= balance
mapping(address => euint128) accTickets;    // Σ (balance · θ · Δt)   — odds
mapping(address => euint128) accYield;      // Σ (balance · Δt)       — yield share
mapping(address => euint128) rate;          // cached balance·θ, recomputed on change
mapping(address => euint8)   theta;         // encrypted, values 0..4 over denom 4
mapping(address => euint16)  fortune;       // consecutive non-winning draws, capped (see docs/12 §1)
mapping(address => uint64)   lastUpdate;    // PLAINTEXT timestamp
mapping(address => euint128) ckptTickets;   // accTickets at the previous T_end
mapping(address => euint128) ckptYield;     // accYield at the previous T_end
mapping(address => euint128) prevCkptTickets;
mapping(address => euint128) prevCkptYield;
mapping(address => uint64)   ckptDrawId;    // which draw the checkpoint belongs to

// ── confidential solvency accounting ─────────────────────────────────────────
euint64 encryptedTotalPrincipal;             // sum of principalBalance; never publicly decrypted
euint64 encryptedTotalLiability;             // sum of balance; stronger solvency operand, never publicly decrypted
uint64  accountingVersion;                   // exact encrypted snapshot; increments on safe mutations
uint64  riskEpoch;                            // starts at 1; increments only when risk assumptions change
uint64  lastSolventRiskEpoch;                 // latest risk epoch with verified true result
uint64  pendingSolvencyRiskEpoch;             // risk epoch bound to the pending aggregate boolean
uint64  pendingSolvencyAccountingVersion;     // snapshot version used to compute the pending handle
uint64  solvencyCheckpointNonce;              // prevents replay/duplicate submission
ebool   pendingSolvencyResult;                // only this aggregate boolean may be public
bool    restricted;                           // false checkpoint: no new risk transitions
address activeAdapter;
address retiringAdapter;                      // at most one; keeps custody enumeration bounded

// ── enumeration for the paginated sweeps ─────────────────────────────────────
address[] participants;
mapping(address => uint256) participantIndex;   // 1-based; 0 means absent

// ── per draw ─────────────────────────────────────────────────────────────────
struct Draw {
    uint64  tStart;
    uint64  tEnd;
    DrawState state;
    bool    strict;           // randomness mode, fixed at openDraw
    uint64  revealDeadline;   // strict mode only
    uint256 cursor;           // sweep position, shared by both passes
    euint64 cumRunning;       // encrypted Fortune-adjusted winner prefix sum
    euint64 cumBaseRiskRunning; // encrypted theta-only risk total for yield split
    euint64 cumYieldRunning;  // encrypted total normalized yield weight
    uint64  totalTickets;     // plaintext effective winner denominator, includes Fortune
    uint64  totalBaseRiskWeight; // plaintext theta-only numerator for prize sizing
    uint64  totalYieldWeight; // plaintext normalized yield denominator
    uint64  realisedYield;    // plaintext, harvested into the vault (P-S4)
    uint64  prizeAmount;      // plaintext, <= realisedYield
    uint128 directRate;       // plaintext fixed-point rate, scaled by 2^26
    bytes32 revealAcc;        // strict: running XOR of revealed entropy (plaintext)
    euint64 r;                // encrypted randomness; handle emitted as commitment
    uint64  rRevealed;        // publicly decrypted after settlement, for verification
}

mapping(uint64 => mapping(address => euint64)) directWeight; // per-draw non-prize weight; never public

// ── strict-mode entropy commitments (plaintext; entropy is a nonce, not secret) ──
mapping(uint64 => mapping(address => bytes32)) entropyCommit;   // drawId → user → commit
mapping(uint64 => mapping(address => bool))    entropyRevealed;
```

Note carefully which fields are plaintext. `lastUpdate`, epochs, nonces and state flags are plaintext because time and
transition ordering are public. `totalTickets`, `totalBaseRiskWeight`, `totalYieldWeight`, `directRate`, realised yield
and `prizeAmount` are public draw aggregates or deterministic derivatives of them. The difference between effective
tickets and base risk leaks only bounded pool-level Fortune boost, never a per-user value. Per-user values, numeric
aggregate principal, claimable liabilities and custody assets remain encrypted. Only the checkpoint-specific aggregate
solvency boolean is publicly decrypted.

---

## 4. Numeric design and overflow derivation

**FHE does not revert on overflow. It wraps silently and returns a wrong answer.** Every encrypted expression therefore
needs a written derivation. Here is the one for the accumulators; reproduce this style for anything you add.

### Constants

```solidity
uint8 constant THETA_DENOM = 4; // θ ∈ {0,1,2,3,4}
uint8 constant TICKET_SCALE_BITS = 26; // right-shift before the draw
uint128 constant RATE_CAP = 1 << 52; // saturation ceiling for balance·θ
uint64 public immutable DRAW_PERIOD; // Sepolia demo: 120 seconds
uint64 public immutable MIN_SETTLE_DELAY; // Sepolia demo: 30 seconds
uint64 public immutable REVEAL_WINDOW; // Sepolia demo: 180 seconds
uint64 public immutable STATE_TIMEOUT; // Sepolia demo: 600 seconds
```

The four timing values are constructor parameters, fixed for the lifetime of a deployment. No owner, guardian, keeper or
user can change them. The Sepolia demonstration profile is `120 / 30 / 180 / 600` seconds. Constructor validation
enforces `60 <= DRAW_PERIOD <= 2²⁰`, `MIN_SETTLE_DELAY >= 24`, `REVEAL_WINDOW >= 120`, and `STATE_TIMEOUT >= 300`. The
upper draw-period bound is part of the accumulator proof below; the lower bounds prevent same-block or operationally
meaningless windows. A production deployment may choose a longer cadence within these reviewed bounds, but cadence is
never runtime governance.

### Supported range and saturation

Declared supported balance range: up to **2⁵⁰ base units ≈ 1.1 × 10¹⁵ ≈ $1.1B** of 6-decimal USDC.

`rate = balance · θ` is capped at `RATE_CAP = 2⁵²` using `FHE.min`. A silent clamp is acceptable _here and only here_,
because it caps the **odds** of an implausibly large depositor and never touches their **principal**. Document it:
_"odds saturate above ~$1.1B of deposit; principal is unaffected."_ That is a defensible design decision, unlike a
silent overflow, which is a bug.

### Aggregate accounting bound

ERC-7984 stores confidential total supply as `euint64` and its safe mint path clamps before increasing it. Lok custody
is a disjoint partition of that one token supply across the vault, active adapter and optional retiring adapter.
Therefore:

```text
aggregateAssets <= cUSDC.totalSupply <= 2^64 - 1
encryptedTotalLiability <= aggregateAssets <= 2^64 - 1
encryptedTotalPrincipal <= encryptedTotalLiability <= 2^64 - 1
```

The second inequality is the inductive I11 obligation, not an assumption: deposits add the same `moved` amount to assets
and liabilities; withdrawals subtract the same `moved` amount; and every earnings credit is bounded by realised cUSDC
yield already added to custody. Consequently all three numeric aggregates fit `euint64`. `euint256` is not a fallback:
the verified FHEVM API exposes that type but does not support encrypted `add`/`sub` on it. Boundary tests must cover
total supply minus one, a clamped transfer, a full-supply position and a fully allocated yield reserve.

### Accumulator bound

```
rate               ≤ 2⁵²
Δt per segment     ≤ DRAW_PERIOD ≤ 2²⁰ s  (≈ 12 days)
per-segment term   ≤ 2⁷²
accumulated over 1,000 draws ≤ 2⁸²   ≪ 2¹²⁸ − 1 ≈ 2¹²⁸
```

`euint128` accumulators are safe by an enormous margin. Use them; do not attempt `euint64` accumulators.

### Scaling down for the draw

Risk and yield weights are compared and prefix-summed in `euint64` because 64-bit operations are cheaper and the prefix
sums are hot. Normalize risk by the theta denominator and scale both weights with power-of-two right shifts:

```
risk64  = FHE.asEuint64(FHE.shr(ticketDelta128, TICKET_SCALE_BITS + 2))
yield64 = FHE.asEuint64(FHE.shr(yieldDelta128, TICKET_SCALE_BITS))

sum(raw yield deltas) ≤ cUSDC.totalSupply · DRAW_PERIOD < 2⁶⁴ · 2²⁰ = 2⁸⁴
W = sum(yield64) < 2⁸⁴ / 2²⁶ = 2⁵⁸
B = sum(baseRisk64) ≤ W < 2⁵⁸
baseRisk64_i · fortune_i < 2⁵⁸ · 52 = 13 · 2⁶⁰ < 2⁶⁴
E = sum(effectiveRisk64) ≤ 1.5 · B < 2⁵⁹ ≪ 2⁶⁴
```

The Fortune multiplication is performed before division, so its separate `euint64` bound is load-bearing. The bound
above covers the maximum individual normalized position as well as the aggregate. The boost cap then gives
`effectiveRisk64_i <= 1.5 * baseRisk64_i`, and summing that relation proves P-S9 for the full prefix accumulator.

**Precision floor.** At the 120-second Sepolia profile, the smallest non-dust yield position is
`ceil(2²⁶ / 120) = 559,241` token units, about `0.559241 USDC`. At default `theta = 4`, that same position produces the
first base-risk ticket; at `theta = 1`, the first base-risk ticket requires about `2.236963 USDC`. Disclose in the UI
and README: _"positions below the active draw's normalization threshold may round to zero weight."_ This is a real
limitation; state it rather than hide it.

---

## 5. `_syncUser` — the heart of the system

Called at the top of every function that reads or mutates a user's position: deposit, withdraw, set θ, and the draw
sweep. It rolls the accumulators forward and, when required, splits the segment exactly at `tEnd` so the draw's
checkpoint is correct even for users who transact after the window closes.

```
_syncUser(u):
    t    = block.timestamp
    last = lastUpdate[u]
    if last == 0:
        if draw is open or sweeping and t >= draw.tStart:
            prevCkptTickets[u] = accTickets[u]       // new entrant baseline
            prevCkptYield[u]   = accYield[u]
        lastUpdate[u] = t
        return                                        // first touch, nothing to accrue

    // ── draw-start baseline: exclude IDLE/settlement time ─────────────────
    if (draw is open or sweeping)
       and ckptDrawId[u] != draw.id
       and last <= draw.tStart
       and t >= draw.tStart:
           prevCkptTickets[u] = accTickets[u]         // exact tStart baseline
           prevCkptYield[u]   = accYield[u]
           last = draw.tStart

    // ── segment split: checkpoint exactly at tEnd ─────────────────────────
    if (draw is open or sweeping)
       and last <  draw.tEnd
       and t    >= draw.tEnd
       and ckptDrawId[u] != draw.id:
           dt1 = draw.tEnd - last
           accTickets[u] += rate[u]      * dt1        // scalar mul
            accYield[u]   += balance[u]   * dt1        // scalar mul
            ckptTickets[u] = accTickets[u]             // the draw reads THIS
            ckptYield[u]   = accYield[u]
           ckptDrawId[u]  = draw.id
           last = draw.tEnd

    // settlement and IDLE time are outside every draw window
    if ckptDrawId[u] == draw.id and t >= draw.tEnd:
        lastUpdate[u] = t
        return

    // ── ordinary in-window roll-forward ───────────────────────────────────
    dt = t - last
    if dt > 0:
        accTickets[u] += rate[u]    * dt
        accYield[u]   += balance[u] * dt

    lastUpdate[u] = t
```

Two properties make this correct and cheap:

- **The draw baseline is taken lazily at exactly `tStart`.** IDLE and prior-settlement intervals are skipped rather than
  evaluated homomorphically; after the exact `tEnd` checkpoint, settlement time is skipped the same way. A participant
  first joining after `tStart` receives the current accumulator as its baseline, so no pre-deposit time is credited.
- **Every multiplication is scalar.** `dt` is plaintext. Only `rate = balance · θ` is a non-scalar multiplication, and
  it is recomputed solely when `balance` or `θ` changes — not on every sync.
- **The checkpoint is taken on first touch after `tEnd`, by whoever touches first.** No sweep is needed to snapshot
  state, so nothing has to be frozen and withdrawals are never blocked (trap T2).

---

## 6. The draw state machine (dual-mode)

Lok runs the draw in one of two randomness modes, selected per draw by a `strict` flag. The state machine is shared;
strict mode adds a commit-reveal window before randomness is fixed. This design was chosen in branch 1 to remove the KMS
committee as a sole point of trust for the draw outcome (invariant I13); the proof obligations for it are P-F3, P-L3 and
P-L4 in `docs/10-proof-strategy.md`, and the state machine below is what the TLA+ model in `spec/LokDraw.tla` encodes
and checks **before** any Solidity is written.

```
        ┌────────┐  openDraw(strict?)         ┌────────┐
        │  IDLE  │ ─────────────────────────► │  OPEN  │  accumulating; tEnd = tStart + DRAW_PERIOD
        └────────┘                            └───┬────┘  participants may submit entropy commitments
             ▲                                    │ now >= tEnd + MIN_SETTLE_DELAY
             │                                    ▼
             │                             ┌─────────────┐  crankA() × ceil(N / BATCH_A)
             │                             │  SWEEP_A    │  weight differences + encrypted prefix sums
             │                             └──────┬──────┘
             │                                    │ cursor == N
             │                                    ▼
             │                          ┌──────────────────┐  total + yield-weight handles marked
             │                          │  AWAIT_TOTAL     │  publicly decryptable; proof submitted
             │                          └────────┬─────────┘
             │                                   │ totalTickets, prizeAmount now plaintext
             │              strict? ┌────────────┴────────────┐ not strict
             │                      ▼                         ▼
             │             ┌────────────────┐        ┌────────────────┐
             │             │  REVEAL        │        │  RANDOM_SET    │  r = rem(rand(), total)
             │             │  entropy_i     │        │                │  emit RandomnessCommitted
             │             │  revealed,     │        └───────┬────────┘
             │             │  timeout drops │                │
             │             │  non-revealers │                │
             │             └───────┬────────┘                │
             │                     │ reveal window closed     │
             │                     ▼                          │
             │             ┌────────────────┐                 │
             │             │  RANDOM_SET*   │  r = rem(rand() XOR Σreveal, total)
             │             └───────┬────────┘                 │
             │                     └──────────┬───────────────┘
             │                                ▼
             │                         ┌─────────────┐  crankB() × ceil(N / BATCH_B)
             │                         │  SWEEP_B    │  win check, encrypted credit to EVERY participant
             │                         └──────┬──────┘
             │                                │ cursor == N
             │                                ▼
             │  openDraw()             ┌─────────────┐  r publicly decrypted for verification
             └──────────────────────  │  SETTLED    │
                                       └─────────────┘

  abortDraw (permissionless after deadline; SWEEP_B only while cursor == 0) ──► IDLE
```

Rules that the model enforces and the contracts must refine:

- **`deposit()`, `withdraw()`, `setTheta()`, `exit()` and `emergencyWithdraw()` are enabled in EVERY state**, including
  `REVEAL` and both sweeps. Invariant I2; proof P-L1. Never gated for crank convenience.
- **Every state has a deadline.** On expiry, `abortDraw()` becomes permissionlessly callable before funded PASS B side
  effects begin. Once `SWEEP_B.cursor > 0`, abort is rejected and permissionless `crankB` is the progress path; allowing
  abort there would let a caller choose which participant subset receives credits. `emergencyWithdraw` remains enabled
  throughout, so principal recovery never depends on settlement progress (P-O1, P-L1, P-L4, P-L7).
- **`REVEAL` cannot be stalled by a non-revealer.** After `REVEAL_TIMEOUT`, unrevealed commitments are dropped and the
  draw proceeds with whatever entropy was revealed (proof P-L3). A single honest revealer suffices for randomness
  integrity (proof P-F3).
- **The `strict` flag is fixed at `openDraw` and immutable for that draw.** Non-strict mode is the spec-exact default
  that satisfies the bounty literally; strict mode is the trust-minimised path.

---

## 7. Yield accounting

Distributing yield requires division by an aggregate denominator, but division by an encrypted value is forbidden by I8.
PASS A therefore normalizes each participant's exact `tEnd` deltas before aggregating them:

```text
baseRiskWeight_i = floor(ticketDelta_i / (4 * 2^TICKET_SCALE_BITS))
yieldWeight_i = floor(yieldDelta_i / 2^TICKET_SCALE_BITS)
directWeight_i = yieldWeight_i - baseRiskWeight_i
effectiveWeight_i = baseRiskWeight_i + boundedFortuneBoost_i
B = sum(baseRiskWeight_i)
E = sum(effectiveWeight_i)
W = sum(yieldWeight_i)
```

Fortune is proportional to saved weight: with `f_i = min(fortune_i, 52)`, the boost is
`min(floor(baseRiskWeight_i * f_i / 104), baseRiskWeight_i >> 1)`. The product is below `2^64` because each normalized
weight is below `2^58` and `f_i <= 52`, so the product is below `13 * 2^60`; 104 is a plaintext divisor. This
construction is additive under position splitting up to floor rounding and keeps aggregate boost at or below half of
aggregate base-risk weight.

Because `theta <= 4`, `ticketDelta_i <= 4 * yieldDelta_i`, so `baseRiskWeight_i <= yieldWeight_i` and the encrypted
subtraction cannot underflow. At the default `theta = 4`, those two normalized weights are exactly equal, including at
rounding boundaries. Fortune changes only `effectiveWeight_i` and therefore winner probability; it does not change the
yield split. PASS A stores `directWeight_i`, uses `effectiveWeight_i` for the winner interval, and publicly decrypts the
aggregate `E`, `B` and `W` handles allowed by I4. The public difference `E - B` reveals bounded pool-level Fortune
boost; the threat model records this residual inference and the anonymity floor mitigates attribution.

After the adapter transfers realised yield `Y` into custody, plaintext draw parameters are:

```text
prizeAmount = floor(Y * B / W)
directRate  = floor((Y * 2^26) / W)
```

PASS B computes each non-prize allocation without encrypted division:

```text
directCredit_i = floor(directWeight_i * directRate / 2^26)
prizeCredit_i  = FHE.select(win_i, prizeAmount, 0)
totalCredit_i  = directCredit_i + prizeCredit_i
```

The scalar product is evaluated as `euint128`: although its operands have wider independent type bounds, the relational
bound `directWeight_i <= W` gives `directWeight_i * directRate < Y * 2^26 < 2^90`, safely below `2^128`. With every
depositor at default θ, `B == W`, `prizeAmount == Y`, and every direct credit is zero regardless of Fortune, which makes
requirement R2 hold literally.

`W == 0` is checked before harvest or division and voids cleanly. If `W > 0` but `E == 0`, the draw has no winner:
`prizeAmount` is zero, randomness/reveal is skipped, and PASS B still runs uniformly to credit direct yield. This branch
depends only on verified public aggregates.

**Prize funding must be realised, not estimated (proposition P-S4).** `prizeAmount` is derived from `realisedYield` —
the public aggregate amount returned only after `adapter.harvest()` has completed its verified cUSDC yield transfer —
never from `confidentialAssets()` or a preview estimate. The order is fixed: harvest transfer completes → adapter
returns the settled aggregate → only then size the prize, capped at `prizeAmount <= realisedYield`. Sizing a prize from
an estimate that later falls short would credit value the vault does not hold, breaking solvency. This ordering and the
adapter-specific transfer test are the mitigation; P-S4 is its proof.

For each participant, `directCredit_i <= Y * directWeight_i / W`. Therefore `sum(directCredit) <= Y * (W - B) / W`,
while `prizeAmount <= Y * B / W`; their sum cannot exceed `Y`. Integer-rounding residue stays in the vault. Every direct
or prize credit increases `encryptedTotalLiability` but never `encryptedTotalPrincipal`, and each draw snapshot is
consumed exactly once by the monotone PASS B cursor. This funding derivation is part of P-S2/P-S4 and is boundary-tested
before the checkpoint result may be treated as stable through an `accountingVersion` advance.

---

## 8. Solvency — the invariant that makes "no-loss" real

"No-loss" is not a slogan here; it is an inductive accounting invariant plus a proof-verified aggregate checkpoint (I11,
proposition P-S2). The vault never decrypts numeric principal or numeric custody assets.

**User-flow preservation.** A deposit adds the same `euint64 moved` returned by ERC-7984 to `balance`,
`principalBalance`, `encryptedTotalLiability` and `encryptedTotalPrincipal`. A withdrawal first clamps the request to
`min(requested, balance)` so it cannot consume another user's custody. It subtracts the resulting token `moved` from
balance and total liability, while its encrypted principal debit is `min(moved, principalBalance)` and is subtracted
from both the user's principal and aggregate principal. Earnings are therefore withdrawn only after that user's
principal reaches zero; one user's earnings can never erase another user's principal. Prize/direct-yield credits
increase balance and total liability only, and are bounded by realised yield already in custody. These transitions
preserve the stronger relation `aggregateAssets >= encryptedTotalLiability >= encryptedTotalPrincipal` and remain
callable without a decryption response.

**Version separation.** `accountingVersion` increments whenever principal, claimable liability or custody location
changes and records which encrypted snapshot produced a checkpoint handle. `riskEpoch` starts at 1 and increments only
when a custody/risk assumption changes. Deposit, withdrawal, funded-credit and lossless-routing transitions preserve the
solvency relation, so they increment `accountingVersion` but do not invalidate a checkpoint in the same `riskEpoch`.
This closes the P-L6 griefing path in which post-`tEnd` deposits repeatedly stale a checkpoint and prevent settlement.

**Aggregate checkpoint.** For accounting snapshot `v` in risk epoch `e`, the vault obtains encrypted cUSDC asset handles
for itself, the active adapter and at most one retiring adapter, then computes entirely under FHE:

```text
isSolvent_(e,v) = encryptedVaultAssets_(e,v) >= encryptedTotalLiability_(e,v)
```

This stronger comparison implies principal solvency because `encryptedTotalPrincipal <= encryptedTotalLiability`. Only
`isSolvent_(e,v)` is marked publicly decryptable. A permissionless caller obtains the public-decryption proof and
submits it against the recorded handle, risk epoch and nonce. A later `accountingVersion` does not stale the result when
`riskEpoch` is unchanged, because every intervening transition preserves the boolean's truth. A verified `true` sets
`lastSolventRiskEpoch = e` and clears restricted mode; a verified `false` enters restricted mode. Forged, malformed,
wrong-handle, changed-risk-epoch, or duplicate submissions revert. Numeric principal, liability and asset operands are
never publicly decrypted or emitted.

**Risk transitions.** Draw prize sizing/settlement and adapter activation/removal require
`lastSolventRiskEpoch == riskEpoch`. A non-lossless rebalance is unsupported; a checkpoint cannot prove a lossy
post-state in advance. If the oracle is permanently unavailable, risk transitions stop while deposit, withdraw, exit and
emergency withdrawal remain available. Adapter activation affects future routing only and increments `riskEpoch`; new
deposits stay in the vault until that new epoch is verified. The old adapter becomes the single retiring adapter until
its permissionless `withdrawAllToVault()` transfers its full ERC-7984 balance back; exact-zero follows from the verified
full-balance transfer semantics, not a second public decryption.

**Evidence boundary.** Tier-A evidence is a reviewed inductive hand proof plus at least 10^7 sequences against an
independent plaintext reference model. Hardhat mock-mode and Sepolia integration establish that ACL, ERC-7984 `moved`,
handle/risk-epoch/nonce binding and public-decryption proof verification behave as the proof assumes. TLC establishes
oracle-down recovery and post-`tEnd` anti-stall liveness, not numeric solvency.

The UI surfaces `Verified solvent for risk epoch E`, `Verification pending`, or `Restricted: recovery only`. It never
displays a numeric total principal or backing ratio.

---

## 9. Randomness — two modes

Both modes reduce a full-width encrypted draw modulo the plaintext total. They differ only in what feeds the draw.

### Common core

```solidity
euint64 raw = /* mode-dependent, see below */;
draw.r      = FHE.rem(raw, draw.totalTickets);   // SCALAR remainder — divisor is plaintext
FHE.allowThis(draw.r);
emit RandomnessCommitted(drawId, FHE.toBytes32(draw.r), block.number);
```

**Why full-width then modulo, not a bounded draw.** `FHE.randEuintN(bound)` requires a power-of-two bound, so bounding
to `nextPow2(totalTickets)` leaves up to a 2× modulo bias — unacceptable for a lottery. Drawing full 64 bits and
reducing modulo a plaintext total gives a bias of at most `totalTickets / 2⁶⁴`, below 2⁻¹⁴ relative for any realistic
total. This is proposition P-F2 (tier A): the reduction itself adds no bias beyond that bound, and it is proven, not
asserted. The _uniformity of `raw`_ is P-F4 — a Zama platform guarantee we inherit and document, not one we reprove.

**Why `FHE.rem` is legal.** It is the scalar variant: the divisor `totalTickets` is plaintext, the payoff from Move 2 in
§1. Had the total stayed encrypted there would be no unbiased reduction available at all.

### Non-strict mode (default, spec-exact)

```solidity
euint64 raw = FHE.randEuint64();     // encrypted from creation; no party can read it pre-settlement
```

`r` is encrypted at creation, so no operator, builder, depositor or deployer can read it before settlement. Grinding is
blind because the caller cannot observe the outcome it is trying to bias. `MIN_SETTLE_DELAY` separates the exact `tEnd`
snapshot boundary from the first settlement crank and prevents a same-block close-and-settle path; it is not the source
of randomness security. **This mode is safe under one assumption: the KMS committee does not collude to decrypt `r`
early** (trust boundary, `docs/10` §5). It is the default because it satisfies the bounty literally and needs no reveal
phase.

### Strict mode (trust-minimised, branch 1 in core)

Strict mode removes the KMS-collusion assumption by XOR-mixing the platform randomness with entropy committed by
participants **before** `tEnd` and revealed **after**:

```
At deposit (or any time during OPEN), participant i optionally submits:
    commit_i = keccak256(entropy_i, salt_i)          // plaintext commitment, stored on-chain

During REVEAL (after tEnd + sweep A + total), participant i reveals (entropy_i, salt_i):
    require(keccak256(entropy_i, salt_i) == commit_i)  // plaintext check — entropy is NOT secret data
    revealAcc ^= entropy_i                             // running XOR of revealed entropy (plaintext)

After REVEAL_TIMEOUT (non-revealers simply dropped):
    euint64 raw = FHE.xor(FHE.randEuint64(), FHE.asEuint64(revealAcc));
    // raw is unpredictable unless the KMS colludes AND every revealer colludes — two independent sets
```

Why this is sound, and the exact obligation the proof strategy discharges:

- **One honest participant defeats all bias.** `r_final` depends on the XOR of platform randomness and every revealed
  `entropy_i`. A single honest, unpredictable `entropy_i` randomises the result regardless of what the KMS or other
  participants do. This is proposition P-F3, checked in TLA+ against an adversary that controls the KMS output and all
  but one participant.
- **The entropy commitment is plaintext, and that is fine.** `entropy_i` is not sensitive user data — it is a nonce.
  Committing and revealing it in plaintext leaks nothing about balances, θ, or odds. Do not encrypt it; that would add
  cost for no privacy gain.
- **Non-revealers cannot stall the draw.** After `REVEAL_TIMEOUT` their commitments are ignored. This is proposition
  P-L3; the timeout transition is always eventually enabled in the model.
- **Griefing is bounded.** The worst a malicious participant can do is withhold their reveal, which only removes their
  own entropy contribution — it cannot bias the result, only decline to improve it. As long as one honest party
  revealed, integrity holds.

**Trade-off, stated honestly.** Strict mode adds the `REVEAL` state, per-participant commitment storage, and the
reveal/timeout logic — more surface, more HCU, and a longer draw. It is in core (not a deferred flag) because branch 1
accepts that cost to eliminate the KMS-collusion assumption, and because the proof budget exists to verify it (TLA+ for
the state logic, red team for the adversary model). The default draw remains non-strict so the bounty's spec-exact path
is the simplest one.

**Why either mode beats a VRF.** In both, `r` is unreadable by anyone before settlement — no VRF provider to trust, no
reveal ceremony that a withholder can grief into a halt (the timeout handles that), no subscription. Strict mode
additionally survives a compromised KMS. This is the clearest example on the project of FHE plus a classical primitive
doing something no single privacy technology does cleanly, so it belongs in the video.

---

## 10. The two sweeps

### PASS A — differences and prefix sums

```
for u in participants[cursor : cursor + BATCH_A]:
    _syncUser(u)                                  // takes the tEnd checkpoint if not yet taken
    t128 = ckptTickets[u] - prevCkptTickets[u]
    y128 = ckptYield[u] - prevCkptYield[u]
    baseRisk64 = FHE.asEuint64(FHE.shr(t128, TICKET_SCALE_BITS + 2))
    yield64  = FHE.asEuint64(FHE.shr(y128, TICKET_SCALE_BITS))
    directWeight[draw.id][u] = FHE.sub(yield64, baseRisk64)
    f = min(fortune[u], FORTUNE_CAP)
    boost = min(floor(baseRisk64 * f / (2 * FORTUNE_CAP)), baseRisk64 >> 1)
    effective64 = FHE.add(baseRisk64, boost)
    rangeStart[u] = draw.cumRunning
    draw.cumRunning = FHE.add(draw.cumRunning, effective64)
    draw.cumBaseRiskRunning = FHE.add(draw.cumBaseRiskRunning, baseRisk64)
    draw.cumYieldRunning = FHE.add(draw.cumYieldRunning, yield64)
    nonDust = FHE.select(FHE.gt(yield64, 0), 1, 0)
    draw.nonDustRunning = FHE.add(draw.nonDustRunning, nonDust)
    rangeEnd[u]   = draw.cumRunning
    prevCkptTickets[u] = ckptTickets[u]
    prevCkptYield[u] = ckptYield[u]
cursor += BATCH_A
```

When PASS A completes, `enough = FHE.ge(nonDustRunning, MIN_PARTICIPANTS)` masks each of the three aggregate totals with
`FHE.select(enough, total, 0)` before public decryption. `MIN_PARTICIPANTS = 5`; the encrypted count is never published.

The encrypted effective-ticket, base-risk and yield running totals persist across transactions. Depth resets each
transaction, which is what makes arbitrarily long sequential sums possible.

### PASS B — winner determination and crediting

```
for u in participants[cursor : cursor + BATCH_B]:
    ebool win   = FHE.and( FHE.le(rangeStart[u], draw.r),
                           FHE.lt(draw.r,        rangeEnd[u]) )
    euint64 prizeCredit = FHE.select(win, FHE.asEuint64(draw.prizeAmount), FHE.asEuint64(0))
    euint128 directWide = FHE.mul(FHE.asEuint128(directWeight[draw.id][u]), draw.directRate)
    euint64 directCredit = FHE.asEuint64(FHE.shr(directWide, TICKET_SCALE_BITS))
    euint64 totalCredit = FHE.add(prizeCredit, directCredit)
    vault.creditDraw(u, prizeCredit, directCredit, win)
    // Fortune: reset to 0 on a win, else grow by 1 (capped). Branch-free — a win and a loss
    // are indistinguishable on-chain (proof P-F6, P-P7). NEVER a plaintext `if`.
    fortune[u] = FHE.select(win, FHE.asEuint16(0),
                            FHE.min(FHE.add(fortune[u], FHE.asEuint16(1)),
                                    FHE.asEuint16(FORTUNE_CAP)))
    FHE.allowThis(balance[u]); FHE.allowThis(fortune[u]);
    FHE.allow(balance[u], u);
    FHE.allow(prizeCredit, u);      // EVERY participant, never only the winner — trap T1
    FHE.allow(directCredit, u);     // uniform draw-credit pattern
    FHE.allow(fortune[u], u);       // owner may read their own fortune; never granted to others
    emit PrizeCredited(drawId, u);  // identical event for winners and losers
cursor += BATCH_B
accountingVersion += 1                         // once for the non-empty funded-credit batch
```

The Fortune update is the same discipline as the credit: one `FHE.select`, no branch. If the reset were a visible
conditional it would leak the winner, so a win (`fortune → 0`) and a loss (`fortune → min(f+1, cap)`) are computed
identically for everyone and are indistinguishable on-chain. The boost that consumes `fortune` is applied when computing
`wEff` in PASS A, not here; see `docs/12` §1 for the bounded-boost derivation (P-F5) that keeps this a savings mechanism
rather than escalation.

Half-open interval `[rangeStart, rangeEnd)` guarantees exactly one winner for any `r` in `[0, totalTickets)`. A
depositor whose weight rounded to zero has `rangeStart == rangeEnd` and can never win — consistent with the disclosed
precision floor.

The event carries no distinguishing information. Winners and losers are indistinguishable on-chain, which is requirement
R6.

---

## 11. Public verifiability

Four independent mechanisms, all of which a third party can check without any private information:

1. **Committed randomness.** `RandomnessCommitted` publishes the handle of `r` before any award is computed. After
   settlement `r` is publicly decrypted; anyone can confirm the decrypted value corresponds to the committed handle and
   lies in `[0, totalTickets)`.
2. **Recomputable homomorphic operations.** Every FHE operation on the Zama Protocol is publicly verifiable, with
   independent coprocessors committing results under majority consensus. The computation graph is reconstructible from
   event logs.
3. **Aggregate invariant.** The sum of credits issued in a draw is publicly decryptable and must equal `prizeAmount`
   exactly — proving one prize was awarded, no inflation occurred, and no depositor was skipped, all without revealing
   the recipient.
4. **`scripts/verify-draw.ts`.** A standalone script an outsider runs: replays the event log, rebuilds the handle graph,
   checks the invariant and the commitment, prints PASS or FAIL. Run it on camera in the video. It converts "verifiable"
   from an adjective into a command.

Publicly decrypting `r` after settlement costs nothing in privacy: `r` alone reveals nothing, because every `rangeStart`
and `rangeEnd` remains encrypted and only its owner can decrypt them.

---

## 12. Participant enumeration and the exit path

Pool **membership is public**; only **amounts** are private. The address list must be enumerable for the sweeps, and in
any case a deposit transaction reveals that an address interacted with the vault. Record this plainly in
`docs/08-threat-model.md`. Users wanting membership privacy should deposit from a fresh address; a fully shielded
participant set would require a different construction and is out of scope.

You cannot remove a depositor when their balance reaches zero, because testing an encrypted balance against zero
requires a branch on ciphertext (invariant I7). Two withdrawal paths resolve this:

- **`withdraw(amount)`** — transfers confidential `cUSDC` out. The amount stays encrypted, the user stays in the
  participant array with whatever weight remains. Costs a little HCU on future sweeps; that is the price of
  confidentiality.
- **`exit()`** — unshields the full balance back to public ERC-20. If a draw is active, participant-array removal is
  deferred until IDLE so the open-draw index snapshot cannot be reordered by swap-and-pop. A later deposit or uniform
  draw credit cancels the pending removal; otherwise anyone may finalize it in IDLE. Unshielding inherently publishes
  the amount, which is a property of returning to a transparent token. The UI must say so explicitly.

---

## 13. Known scaling limits — disclose, do not hide

The direct-credit correction invalidated the old 25/25 batch projection. Transaction counts are
`ceil(N/BATCH_A_MAX) + ceil(N/BATCH_B_MAX)` plus pre-sync and fixed state transitions; publish concrete N =
10/100/1,000/10,000 figures only after the revised paths are measured and caps are set to 60% of measured maxima.

Do not pretend this is free. Present it as the honest consequence of the HCU budget, and name the four paths that
improve it, all of which are real:

1. `FHE.sum` (FHEVM v0.13+) collapses the prefix-sum accumulation into a single homomorphic operation.
2. GPU coprocessors raise throughput substantially — the published benchmark reached about 1,040 confidential ERC-7984
   transfers per second on a single eight-GPU node.
3. The per-transaction and per-block HCU caps are governance-configurable and expected to rise.
4. Batches are trivially parallel across independent transactions; only PASS A's prefix sum is ordered, and even that
   only within a transaction.

A submission that states its scaling ceiling with numbers is more credible than one that claims none.
