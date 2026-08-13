# Lok Encrypted Arithmetic Bounds

These bounds are the Tier-A companion to P-S2, P-S6, P-S9 and invariant I10. Tests live in
`test/invariants/overflow.t.ts` and the eTWAB boundary suite.

## User accounting

ERC-7984 total supply is at most `2^64 - 1`. Vault, active-adapter and retiring-adapter custody are disjoint portions of
that supply. Funded credits consume cUSDC already in custody, so:

```text
assets <= 2^64 - 1
liability <= assets
principal <= liability
```

Deposit and withdrawal add/subtract the same returned `moved` value. `principalDebit = min(moved, principalBalance)`.
Therefore every persisted accounting value fits `euint64`; failed transfers contribute encrypted zero.

## Rate

For each participant, `balance_i <= totalSupply <= 2^64 - 1` and clamped theta is `0 <= theta_i <= 4`. The raw product
is evaluated in `euint128`, then deliberately saturated:

```text
rawRate_i = balance_i * theta_i < 2^64 * 4 = 2^66 < 2^128
rate_i = min(rawRate_i, RATE_CAP), RATE_CAP = 2^52
```

Rate saturation changes odds only; principal remains the exact ERC-7984 moved amount. No aggregate deposit or aggregate
participant-balance cap of `2^50` is assumed or enforced.

## eTWAB accumulators

Each `_syncUser` segment uses a plaintext monotone time delta. Across all segments, deltas partition elapsed `uint64`
time, so their sum is at most `2^64 - 1`:

```text
accTickets <= 2^52 * (2^64 - 1) < 2^128
accYield   <= (2^64 - 1) * (2^64 - 1) < 2^128
```

Checkpoint deltas subtract an earlier monotone accumulator from a later one, so they cannot underflow. Exact boundary
tests cover first touch at `tEnd-1`, `tEnd`, and `tEnd+1`.

## Draw normalization dependency

Let `Q = 2^26`. Production fixes `DRAW_PERIOD <= 2^20`. At every instant, the draw participants are a subset of all user
ledgers. The inductive solvency state gives:

```text
sum_i balance_i <= liability <= assets <= totalSupply <= 2^64 - 1 < 2^64

sum_i yieldDelta_i
< 2^64 * 2^20
= 2^84
```

The floor-sum inequality after normalization gives:

```text
W = sum_i floor(yieldDelta_i / Q)
  <= floor(sum_i yieldDelta_i / Q)
  < 2^58

0 <= B <= W < 2^58
0 <= directWeight_i <= W
```

The aggregate bound comes from total supply over the draw window, not from a `2^50` cap on aggregate deposits or
participant balances.

For Fortune, `baseRisk_i <= B < 2^58` and `fortune_i <= 52`, hence:

```text
baseRisk_i * fortune_i
< 2^58 * 52
= 13 * 2^60
< 2^64

boost_i <= floor(baseRisk_i / 2)
effective_i = baseRisk_i + boost_i <= 1.5 * baseRisk_i

E = sum_i effective_i
  <= 1.5 * B
  < 1.5 * 2^58
  < 2^59
  < 2^64
```

Thus both the Fortune multiplication and `cumRunning=E` fit `euint64`. PASS-A half-open ranges retain ordinary integer
ordering without modular wrap. Frozen P-F7 then establishes that, for `E>0`, every `r in [0,E)` belongs to exactly one
non-empty interval and zero-weight intervals cannot win. This is the bridge required for P-S2 to count one aggregate
`prizeAmount`, rather than multiple prize credits, in its funded-allocation bound.

No encrypted division or remainder is used; Fortune division is by the plaintext constant `104`.
