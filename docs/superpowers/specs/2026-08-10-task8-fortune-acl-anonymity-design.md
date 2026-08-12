# Task 8 Fortune, ACL, and Anonymity Design

**Approved:** 2026-08-10  
**Scope:** Three corrections required before implementing `LokDrawManager.sol`. Frozen proposition section 3 remains
unchanged.

## Proportional Fortune

The prior absolute per-address boost lets an entity multiply the absolute ceiling by splitting a large position across
addresses. Fortune is therefore proportional to the participant's normalized base-risk weight:

```text
f = min(fortune, FORTUNE_CAP)
proportional = floor(baseRiskWeight * f / (2 * FORTUNE_CAP))
boost = min(proportional, baseRiskWeight >> 1)
effectiveWeight = baseRiskWeight + boost
```

`FORTUNE_CAP = 52`. At cap, boost is at most 50% of saved weight. With fixed total principal and equal history,
splitting can only lose floor-rounding units; at arbitrary histories the aggregate remains bounded by half of aggregate
base-risk weight. This discharges P-F9 without an entity registry or Sybil assumption.

For the conservative `baseRiskWeight < 2^52` bound, `baseRiskWeight * f < 2^58`, so the product fits `euint64`. Division
is by the plaintext scalar `104`; no encrypted divisor is used. Define `FORTUNE_STEP` as the proof ceiling
`ceil((2^52 - 1) / 104) = 43,303,842,570,871`, giving `boost <= FORTUNE_CAP * FORTUNE_STEP` as required by frozen P-F5.
It is a bound constant, not an absolute per-address runtime award.

## Draw-input ACL

Returning encrypted handles from a `view` function does not grant the caller permission to compute on them. The vault
keeps `drawWeightsFor` as a read-only inspection surface and adds:

```solidity
function drawInputsFor(address user) external returns (euint128 ticketDelta, euint128 yieldDelta, euint16 fortune);
```

Only the draw manager may call it. The vault grants all three returned handles transiently to the draw manager in the
same transaction. Numeric user state is never made public or persistently granted to another role.

Settlement passes the encrypted `win` predicate into the vault's uniform `creditDraw` path. The vault updates Fortune
with `FHE.select(win, 0, min(fortune + 1, FORTUNE_CAP))`, then grants the new Fortune handle only to itself and its
owner. Winners and losers execute the same call and emit the same event.

## Encrypted Anonymity Floor

`MIN_PARTICIPANTS = 5` counts participants whose normalized yield weight is nonzero. PASS A accumulates an encrypted
non-dust count using `FHE.select(yieldWeight > 0, 1, 0)`. The count is never publicly decryptable.

At PASS A completion, the manager computes encrypted `enough = nonDustCount >= MIN_PARTICIPANTS` and uses `FHE.select`
to mask each of the three approved aggregate totals to encrypted zero when the floor is not met. Only the masked
effective, base-risk, and yield totals become publicly decryptable. A failed floor therefore follows the existing
verified `W == 0` void transition without exposing a fourth aggregate or branching on ciphertext.

## Verification

- Boundary tests cover Fortune 0, 1, 52, above-cap input, dust, maximum normalized weight, and position splitting.
- Cross-contract tests fail without transient ACL and pass through `drawInputsFor`.
- Draw tests cover 0-4 non-dust participants voiding and five non-dust participants proceeding.
- Static analysis allows public decryption only for the three masked totals, post-settlement randomness, and solvency
  boolean.
