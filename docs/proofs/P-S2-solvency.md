# P-S2 Confidential Solvency Hand Proof

**Proposition:** P-S2

**Proof tier:** A

**Hand-proof status:** APPROVED BY INDEPENDENT RE-REVIEW (2026-08-13)

**Full P-S2 status:** MATCHES after final review (2026-08-15)

**Separation:** This remediation was prepared by the implementation/proof context. It is not an independent review or
sign-off.

## Claim And Mathematical State

For users `u` and the supported custody set:

```text
A = vault cUSDC + active-adapter cUSDC + retiring-adapter cUSDC
L = encryptedTotalLiability
P = encryptedTotalPrincipal
b[u] = claimable balance[u]
p[u] = principalBalance[u]
```

The invariant is:

```text
A >= L >= P
L = sum_u b[u]
P = sum_u p[u]
b[u] >= p[u] for every u
```

Numeric `A`, `L`, `P`, `b[u]`, and `p[u]` are mathematical witnesses. Production keeps them encrypted and exposes only
the checkpoint-specific aggregate boolean `A >= L`.

## Assumptions And Enforcement Boundary

1. OpenZeppelin ERC-7984 returns the exact encrypted amount moved and changes token custody by that same amount. Its
   safe total-supply update bounds confidential total supply by `2^64 - 1`; a failed or clamped update moves encrypted
   zero.
2. For every supported and verified adapter, custody operations are lossless. In particular, the external postcondition
   required of `withdrawAllToVault()` is:

   ```text
   retiring balance after the call = 0
   vault custody increase = retiring custody removed
   aggregate A after the call = aggregate A before the call
   ```

   This is the frozen yield-source trust boundary. `MockYieldAdapter` source and local integration tests exercise it,
   but `LokVault` does not enforce it for an arbitrary `IYieldAdapter` implementation.

3. `harvest()` reports only cUSDC already funded into the supported custody set and transfers adapter-held harvested
   cUSDC to the vault before corresponding credits are written.
4. KMS signatures bind the exact ordered handle set and cleartext. This is platform behavior exercised by local FHE
   integration and limited existing Sepolia probes; the fresh state-changing Sepolia negative campaign remains blocked.
5. The supported production bounds stated below hold. An unsupported yield venue or token behavior is not silently
   included in the guarantee.

No ciphertext handle is treated as a plaintext value or compared for numeric meaning in this proof.

## Base Cases

### Mathematical base case

Immediately after deployment, the vault and supported adapters hold no Lok principal and no user claim or principal has
been created:

```text
A = L = P = 0
sum_u b[u] = sum_u p[u] = 0
```

Therefore the mathematical solvency invariant holds at deployment.

### Authorization base case

Authorization is intentionally different from mathematical solvency:

```text
riskEpoch = 1
lastSolventRiskEpoch = 0
```

Epoch 1 is not initially authorized. Deposit, withdrawal, exit, and emergency recovery remain callable, but deposits
remain in the vault and draw/adapter risk transitions are locked. Epoch 1 becomes authorized only after this exact
sequence:

```text
openSolvencyCheckpoint
-> public decryption of the exact checkpoint ebool
-> submitSolvencyCheckpoint with a valid true proof
```

That sequence changes authorization state; it is not needed to make the zero mathematical base case true.

## User And Custody Transitions

### Deposit using actual moved

Let ERC-7984 return `moved = m`. Token custody increases by exactly `m`. Production adds the same encrypted value to the
user's balance, the user's principal, `L`, and `P`:

```text
A' = A + m
b'[u] = b[u] + m
p'[u] = p[u] + m
L' = L + m
P' = P + m
```

The two sum equalities and both inequalities are preserved. A zero/clamped transfer has `m = 0`, so it cannot mint a
claim. If the current risk epoch is authorized, routing `m` from vault custody to the active adapter changes only the
custody partition; otherwise the cUSDC remains in the vault.

### Withdraw, withdraw-all, and emergency withdrawal

First, `_collectLiquidity` invokes the supported adapters' lossless full-return operation. Under the explicit adapter
postcondition, that changes only custody partitions and preserves `A`.

Let the outgoing ERC-7984 transfer return `m`, and let `p = p[u]` before debit:

```text
principalDebit = min(m, p)
A' = A - m
b'[u] = b[u] - m
p'[u] = p[u] - principalDebit
L' = L - m
P' = P - principalDebit
```

`m <= b[u]` because production requests at most the encrypted available balance and accounts from the returned amount.
If `m <= p`, claim and principal both fall by `m`. If `m > p`, the user's principal becomes zero while the remaining
claim is non-negative. Thus `b'[u] >= p'[u]`, the sum equalities are preserved, `L' >= P'`, and `A' - L' = A - L`. The
three entrypoints differ in requested amount or intent, not in these debit equations. None depends on a checkpoint or
oracle response.

### Exit and finalization

`exit()` collects liquidity, asks the wrapper to burn up to the full encrypted claim, reads the wrapper's encrypted
`unwrapAmount(requestId)` as actual `moved`, and applies the same principal-first debit equations. The asynchronous
`finalizeUnwrap` transfers underlying against that already-burned request and does not mutate Lok's `A`, `L`, `P`,
`b[u]`, or `p[u]`. Participant removal is accounting-neutral.

### Funded yield entering custody

Funding cUSDC into the vault or supported adapter increases `A` and the draw-scoped available funded yield by `Y_f`,
without changing `L` or `P`. It therefore increases the solvency surplus. A full adapter return can reclassify pending
funded yield as vault-resident, but cannot count it twice; `harvest()` consumes the draw-scoped funded counters once.

## Normalized `tEnd` Lemmas

Let `Q = 2^26`. For participant `i`, production derives exact-`tEnd` deltas and normalizes them as:

```text
yieldWeight_i  = floor(yieldDelta_i / Q)
baseRisk_i     = floor(ticketDelta_i / (4Q))
directWeight_i = yieldWeight_i - baseRisk_i
```

At every accrual segment, `theta_i <= 4`. The unsaturated ticket rate is `balance_i * theta_i`, and `RATE_CAP` can only
reduce that rate. The yield rate is `balance_i`. Summing the same non-negative time segments through exactly `tEnd`
therefore gives:

```text
ticketDelta_i <= 4 * yieldDelta_i
```

Division by the positive plaintext `4Q` is monotone, so:

```text
floor(ticketDelta_i / (4Q))
<= floor((4 * yieldDelta_i) / (4Q))
=  floor(yieldDelta_i / Q)
```

Hence:

```text
baseRisk_i <= yieldWeight_i
directWeight_i >= 0
```

The encrypted subtraction that creates `directWeight_i` therefore cannot underflow. Define:

```text
B = sum_i baseRisk_i
W = sum_i yieldWeight_i
D = sum_i directWeight_i
```

Termwise subtraction and finite summation give:

```text
D = sum_i (yieldWeight_i - baseRisk_i)
  = W - B
0 <= B <= W
```

The exact-`tEnd` premise comes from `_syncUser`: each participant is split at `currentDrawEnd`; later touches return
without adding settlement/IDLE time to the closed draw. The boundary and differential tests cover touches at `tEnd-1`,
`tEnd`, and `tEnd+1`. The Foundry settlement abstraction does not itself establish this production correspondence; its
scope is stated separately below.

## Funded Allocation Proof

### Case `W = 0`

Production handles this before harvest and before either division:

```text
realisedYield = 0 for this draw transition
prizeAmount = 0
direct credits = 0
prize credits = 0
```

The draw voids, no zero denominator is evaluated, and `A`, `L`, and `P` are unchanged. Previously funded cUSDC remains
custody surplus rather than becoming an unfunded liability.

### Case `W > 0`

Let `Y` be the realised funded yield for this draw and let `d_i = directWeight_i`. Production computes:

```text
prize   = floor(Y * B / W)
rate    = floor(Y * Q / W)
direct_i = floor(d_i * rate / Q)
```

Because floor never increases a non-negative value:

```text
rate <= YQ / W
direct_i <= d_i * rate / Q <= d_iY / W
sum_i direct_i <= DY / W
prize <= YB / W
```

Using the normalized lemma `B + D = W`:

```text
prize + sum_i direct_i
<= YB/W + YD/W
=  Y(B + D)/W
=  Y
```

Boundary cases are included:

- `B = 0`: `prize = 0`; direct credits alone are at most `YD/W = Y`.
- `Y = 0`: `prize = rate = direct_i = 0`.
- `D = 0`: direct credits are zero and `prize <= Y`. With unsaturated default theta `4`, this is the expected case; if
  `RATE_CAP` binds, the general `D >= 0` proof applies instead.
- Integer-rounding residue `Y - prize - sum_i direct_i` remains unallocated in vault custody, increasing rather than
  decreasing `A - L`.

The inequality above contains one aggregate `prize` term. Lifting it to sequential per-user credits requires the
exactly-one-winner premise from P-F7. That premise is valid here only after the Fortune multiplication and effective
prefix accumulator are shown not to wrap. The no-wrap bridge is derived below. It establishes that the sum of all
`prizeCredit_i` is `prize` in a non-void winning draw and zero otherwise. Consequently every participant's
`totalCredit_i = prizeCredit_i + direct_i` is no greater than the aggregate allocation, which is at most `Y`. Crediting
the allocation raises `L` by at most the funded surplus and never raises `P`; therefore `A >= L >= P` is preserved.

## Overflow Closure

OpenZeppelin ERC-7984 uses a safe encrypted total-supply update, so:

```text
totalSupply <= 2^64 - 1
A <= totalSupply
L <= A
P <= L
```

Production enforces:

```text
DRAW_PERIOD <= 2^20
totalSupply <= 2^64 - 1 < 2^64
```

At every instant, the draw participants are a subset of all user ledgers. Under the inductive pre-state invariant,
`sum_i balance_i <= L <= A <= totalSupply`; accounting is constant between completed transitions. Integrating that
aggregate over one draw gives:

```text
sum_i yieldDelta_i
< 2^64 * 2^20
= 2^84
```

With `Q = 2^26`, the floor-sum inequality gives:

```text
W = sum_i floor(yieldDelta_i / Q)
  <= floor(sum_i yieldDelta_i / Q)
  < 2^58

0 <= B <= W < 2^58
0 <= d_i <= W
Y <= 2^64 - 1
```

This is an aggregate total-supply bound. It does not assume aggregate deposits, aggregate participant balance, or any
individual position is capped at `2^50`.

The plaintext prize numerator is evaluated in `uint256` and cannot overflow:

```text
Y * B < 2^64 * 2^58 = 2^122 < 2^256
```

The direct-rate numerator satisfies:

```text
Y * Q < 2^64 * 2^26 = 2^90
```

Thus `directRate = floor(YQ/W) < 2^90 < 2^128`, which fits `uint128`. Because `d_i <= W`:

```text
directWide_i = d_i * directRate
<= d_i * YQ/W
<= YQ
< 2^90
< 2^128
```

Therefore the encrypted `directWide` multiplication cannot wrap `euint128`.

For the Fortune-adjusted winner prefix, `baseRisk_i <= B < 2^58` and `fortune_i <= 52`, so the multiplication performed
before the plaintext division is bounded by:

```text
baseRisk_i * fortune_i
< 2^58 * 52
= 13 * 2^60
< 2^64
```

Production caps `boost_i <= floor(baseRisk_i / 2)`. Therefore:

```text
effective_i = baseRisk_i + boost_i
effective_i <= 1.5 * baseRisk_i

E = sum_i effective_i
  <= 1.5 * B
  < 1.5 * 2^58
  < 2^59
  < 2^64
```

Thus `baseRisk_i * fortune_i` cannot wrap `euint64`, and the PASS-A `cumRunning = E` prefix cannot wrap `euint64`. The
half-open ranges therefore form an ordinary integer partition of `[0,E)`, rather than a partition corrupted by modular
wraparound. Under frozen P-F7, when `E > 0`, every `r in [0,E)` matches exactly one non-empty interval; a zero-weight
interval is empty and cannot win. When `E = 0`, `B = 0`, so `prize = 0` and no prize credit is issued. Accordingly,
`prizeAmount` is credited exactly once in the non-void winning case and at most once in every case. This no-wrap bridge
is the required premise for using the single `prize` term in `prize + sum_i direct_i <= Y` as the total prize liability
created by PASS B.

The funded-allocation proof then gives `totalCredit_i <= Y <= 2^64 - 1`, so per-user `prizeCredit + directCredit` fits
`euint64`. Across sequential credits, the cumulative liability increase never exceeds funded custody surplus, hence
`L' <= A <= totalSupply`; the aggregate liability update cannot wrap. These are numeric derivations, not an appeal to
the encrypted type reverting on overflow.

## Exactly-Once Cursor Proof

Let `N = participantSnapshot`, fixed by `openDraw`.

1. A deposit after draw open may append a new participant only after index `N - 1`, so it is outside the current draw.
2. Finalized exit removal is deferred while the draw is active. A later deposit or uniform draw credit cancels pending
   removal. Consequently the addresses at snapshot indices `[0, N)` do not shift during either pass.
3. A valid crank requires `batch > 0` and `batch <= cap`. It processes exactly the half-open interval:

   ```text
   [cursor, min(cursor + batch, N))
   ```

4. The contract then assigns `cursor = end`. No caller supplies a start index. Cursor increases strictly for every
   successful non-empty crank and no transition decreases it within a pass.
5. Starting from zero, consecutive half-open intervals share only endpoints. They neither overlap nor leave a gap. PASS
   A completes exactly when `cursor = N`.
6. `submitTotals` accepts the proof-bound PASS-A aggregates and resets cursor to zero before PASS B. PASS B uses the
   same `N` and the same interval rule, so each snapshot participant is credited exactly once.
7. Before any PASS-B credit (`cursor = 0`), timeout abort creates zero credits. Once the first successful PASS-B batch
   sets `cursor > 0`, abort is forbidden; permissionless cranking must complete the remaining suffix before settlement.
8. Ranges, direct weights, prize credits, funded `Y`, and `directRate` are draw-scoped or keyed by `drawId`. There is no
   cumulative cross-harvest rate/index. Each draw consumes its own normalized weights and one harvested funded amount.

Ethereum transaction serialization and `nonReentrant` make two concurrent cranks observe a single ordered cursor state;
a stale call cannot replay an already consumed interval.

## Checkpoint And Accounting-Version Closure

`openSolvencyCheckpoint` computes the encrypted predicate over the vault, active adapter, optional retiring adapter, and
`L`. It records `pendingSolvencyHandle`, `pendingSolvencyRiskEpoch`, `pendingSolvencyAccountingVersion`, and a new
nonce. The accounting version identifies the snapshot, but submission intentionally does not require equality with the
current `accountingVersion`.

That omission is safe only because every same-`riskEpoch` transition that may occur after checkpoint open preserves a
true `A >= L` result:

- deposit adds the same actual `moved` to `A` and `L`;
- withdraw, withdraw-all, and emergency withdrawal subtract the same actual `moved` from `A` and `L`;
- exit applies the same actual-moved debit, while finalization is accounting-neutral;
- funded yield entering custody increases `A` without increasing `L`;
- bounded direct/prize credits increase `L` by no more than funded custody surplus;
- lossless vault/active/retiring custody movements preserve aggregate `A` under the supported-adapter postcondition;
- draw, theta, Fortune, accumulator, checkpoint, pause, ACL, and participant metadata changes do not change `A`, `L`, or
  `P` except for the already-covered deterministic funded credits;
- post-`tEnd` deposit or withdrawal changes future accounting only after `_syncUser` has closed the current draw at the
  exact `tEnd`; it cannot change the committed closed-draw weights or stall cursor progress.

Some safe events, such as externally funded yield entering custody, may not increment the vault's version, but they only
strengthen `A >= L`. Every version advance that can affect accounting or custody is covered above. Therefore a true
same-epoch checkpoint remains true inductively even when `accountingVersion` advances.

Adapter activation and retiring-adapter removal change the custody/risk assumption and increment `riskEpoch`. Existing
authorization then fails `lastSolventRiskEpoch == riskEpoch`, making the old authorization unusable. New deposits stay
in the vault and new draw/config risk transitions remain locked until a fresh current-epoch true checkpoint is
submitted.

## Adapter Lifecycle Postcondition

The reference model and production enforce different facts:

- Reference removal succeeds only when `retiringAdapterAssets == 0`.
- Production `drainRetiringAdapter()` calls external `withdrawAllToVault()` and, after successful return, sets
  `retiringAdapterDrained = true`.
- Production does not compare returned `moved` with the encrypted pre-drain balance. Removal relies on the flag and
  current-epoch authorization.

Accordingly, preservation across production drain/removal is conditional on the frozen supported-adapter postcondition
stated in the assumptions. It is externally trusted supported-adapter behavior, source/local-integration tested for
`MockYieldAdapter`, and not vault-enforced for arbitrary `IYieldAdapter`. The disposable Sepolia lifecycle D28-D33 must
still confirm the exact deployed adapter path. This is a disclosed trust-boundary dependency, not a claim that the vault
independently verifies arbitrary adapters.

## Evidence Separation And Reference Abstraction

### Foundry reference invariant

`LokHandler.settleDraw` snapshots plaintext `LokAccountingModel.balanceOf` and handler `theta` values.
`LokDrawReference.processProductionPassA` derives weights from that balance/theta snapshot. It does not directly model
production `_syncUser`, piecewise eTWAB accumulators, exact `tEnd` checkpoints, or the `>> 26` / `>> 28` normalization
shifts.

The committed campaign consists of `10,000,004` sequences at depth `32`, `320,000,128` calls, `14,550,605` `settleDraw`
calls, `28` shards, and `0` reported reverts. It supports generic accounting preservation, batch/cursor composition,
post-snapshot action isolation in its abstraction, and the funded-allocation bound. It is not described as an exact
production settlement model.

Production normalized-`tEnd` correspondence instead depends jointly on the normalized lemmas in this proof, Hardhat
`tEnd` boundary tests, draw/sync differential tests, and the executed Sepolia Group A lifecycle. The campaign is not
rerun because no production, reference, handler, selector, or assertion logic changed in this remediation.

### Forged-checkpoint evidence

Foundry `submitForgedCheckpoint` does not submit a cryptographic proof. It sets an abstract rejection flag and asserts
that abstract authorization metadata did not mutate. It is evidence only for identity/no-mutation behavior in the
reference state machine; it is not evidence that `FHE.checkSignatures` rejects a forged proof.

Semantic cryptographic evidence is separated as follows:

- local Hardhat FHE tests submit forged/tampered, replaced-handle, wrong-epoch, wrong-nonce, and duplicate cases;
- existing Sepolia probes provide limited prior integration evidence;
- executed Group A/B state-changing negative submissions provide the final Sepolia integration evidence.

### Oracle-down recovery

No withdrawal, withdraw-all, emergency withdrawal, exit request, or liquidity collection path calls public decryption or
requires checkpoint completion. Oracle nondelivery can leave a checkpoint pending and keep risk transitions locked, but
it cannot block principal recovery. The live permanent-outage condition cannot be deliberately induced; the executable
state-machine/local evidence and planned pending-oracle D12-D13 sequence remain distinct evidence classes.

## Residual Obligations And Status

- Independent hand-proof re-review is complete and approved; see
  `docs/proofs/P-S2-independent-re-review-record-2026-08-13.md`.
- Sepolia Group A and Group B state-changing evidence is complete; see
  `docs/proofs/P-S2-sepolia-groups-evidence-handoff-2026-08-14.md`.
- The supported yield venue's lossless full-return behavior remains the explicit frozen external trust boundary.
- P-P1 remains WEAKER-THAN-CLAIMED and is not affected by this remediation.
- Frozen section 3 is unchanged.

```text
P-S2 hand proof: APPROVED
Full P-S2: MATCHES
Independent reviewer: Codex independent audit context (not the remediation author)
Independent verdict: APPROVED
```
