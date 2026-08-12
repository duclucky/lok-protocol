# P-S3 Prize Conservation Hand Proof

**Proposition:** P-S3  
**Proof tier:** A  
**Execution status:** Local reference invariant PASS  
**Independent review:** PENDING HUMAN SIGN-OFF  
**Owner-delegated AI review:** APPROVED_WITH_RESIDUAL_OBLIGATIONS (same-context, non-human, non-independent;
2026-08-10)  
**Separation note:** The owner authorized the implementation context to execute Task 10 on 2026-08-10. This is not an
independent-context review.

## Claim

For every settled draw `d`:

```text
sum(prizeCredit[d][u] for u in participantSnapshot[d]) = prizeAmount[d]
```

Direct-yield credits are funded user yield, not prize credits, and are excluded from both sides.

## Preconditions Established Before PASS B

1. `participantSnapshot` is fixed when the draw opens. Exit removal is deferred until the draw closes, so swap-and-pop
   cannot replace an indexed participant mid-sweep.
2. PASS A consumes every snapshot index exactly once with a monotone cursor and constructs adjacent half-open ranges:
   `rangeStart_i = prefix_i`, `rangeEnd_i = prefix_i + effectiveWeight_i`.
3. For `E = totalTickets > 0`, the ranges form an exact partition of `[0, E)`. Zero-weight ranges are empty.
4. `submitTotals` accepts only the signed cleartexts for the exact ordered aggregate handles. Forged, stale or
   prior-draw proofs cannot set `E`, `B` or `W`.
5. Randomness is reduced to `r in [0, E)` only after the required reveal sequencing.

## Case Analysis

### `W = 0`, zero participants, below anonymity floor or all dust

The draw voids before division, harvesting or PASS B. No prize credit is written and `prizeAmount = 0`, so the equality
holds trivially.

### `W > 0` and `E = 0`

Fortune boost is additive to base-risk weight, so `E = 0` implies `B = 0`. Consequently:

```text
prizeAmount = floor(realisedYield * B / W) = 0
```

The direct-credit-only PASS B sets encrypted `win = false` for every participant, making every `userPrize = 0`. Their
sum equals `prizeAmount`.

### `E > 0`

For the committed `r`, exact half-open partitioning gives one and only one participant `w` satisfying:

```text
rangeStart_w <= r < rangeEnd_w
```

Every other participant's predicate is false. PASS B computes without a plaintext ciphertext branch:

```text
userPrize_i = FHE.select(win_i, prizeAmount, 0)
```

Thus `userPrize_w = prizeAmount` and every other `userPrize_i = 0`. Summing over the snapshot gives exactly
`prizeAmount`.

## Exactly-Once Preservation

The PASS B cursor is monotone and each bounded crank processes `[cursor, end)` before setting `cursor = end`. Concurrent
transactions serialize on Ethereum state; a stale transaction sees the updated cursor or reverts. Reentrancy is blocked
by the draw-manager guard.

Before the first funded credit (`cursor = 0`), timeout abort writes no prize and leaves no settled draw. After any
funded credit (`cursor > 0`), abort is forbidden; permissionless `crankB` must finish the remaining suffix. Therefore no
settled draw can contain only a credited prefix, and no participant is credited twice.

`cumPrizeCredits` starts at encrypted zero and adds each `userPrize_i` exactly once. Settlement makes only this
aggregate sum publicly decryptable; individual credits remain per-user ciphertexts with uniform ACL grants.

## Caller and Role Independence

Batch size changes only how the fixed index interval is partitioned across transactions. No caller supplies a winner,
range, prize amount or participant address. Owner, keeper, adapter admin and the omitted guardian have no function that
can write `prizeCredit`. Stale/forged totals and randomness inputs are rejected before PASS B.

## Machine Evidence

- Safety prize invariant: `totalPrizeCredited == totalPrizeSettled` and `sumPrizeCredits == totalPrizeCredited` after
  every generated sequence.
- Safety campaign: `10,000,004` sequences, depth `32`, `320,000,128` calls, `0` reverts.
- Remediated fairness campaign: `10,000,004` sequences, depth `32`, `320,000,128` calls, `63,999,795` `settleDraw`
  calls, `0` reverts, and `28/28` zero shard exit codes. Its invariant checks both aggregate counters and
  `sumPrizeCredits() == totalPrizeCredited()` after non-zero settlement transitions.
- P-F7 fuzz/boundary tests confirm one partition match and no zero-weight winner.
- Reports: `artifacts/invariants/safety.json`, `artifacts/invariants/fairness.json`, and
  `artifacts/invariants/summary.json`.

## Residual Obligations

- Human or genuinely independent proof reviewer sign-off: **pending**.
- Sepolia proof/decryption and full lifecycle confirmation: **pending Task 14-15**.

## Sign-Off

AI reviewer: Codex AI proof reviewer (owner-delegated, same-context, non-human, non-independent)  
AI review date: 2026-08-10  
AI verdict: **APPROVED_WITH_RESIDUAL_OBLIGATIONS**  
Review record: `docs/proofs/P-S2-P-S3-ai-review-2026-08-10.md`

Human or independent reviewer: **PENDING**

Reviewer: **\*\*\*\***\_\_\_\_**\*\*\*\***  
Date: **\*\*\*\***\_\_\_\_**\*\*\*\***  
Verdict: PENDING
