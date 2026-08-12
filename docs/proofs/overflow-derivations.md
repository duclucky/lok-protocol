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

Supported balance is `B <= 2^50` and clamped theta is `0 <= theta <= 4`:

```text
rawRate = B * theta <= 2^50 * 4 = 2^52
rate = min(rawRate, RATE_CAP), RATE_CAP = 2^52
```

Rate saturation changes odds only; principal remains the exact ERC-7984 moved amount.

## eTWAB accumulators

Each `_syncUser` segment uses a plaintext monotone time delta. Across all segments, deltas partition elapsed `uint64`
time, so their sum is at most `2^64 - 1`:

```text
accTickets <= 2^52 * (2^64 - 1) < 2^116
accYield   <= (2^64 - 1) * (2^64 - 1) < 2^128
```

Checkpoint deltas subtract an earlier monotone accumulator from a later one, so they cannot underflow. Exact boundary
tests cover first touch at `tEnd-1`, `tEnd`, and `tEnd+1`.

## Draw normalization dependency

Task 8 must preserve the frozen architecture bounds after shifting draw deltas:

```text
W < 2^52
B <= W
E < 2^53
wEff <= 1.5 * w
```

No Task 7 code performs encrypted division or remainder.
