# P-S2 Confidential Solvency Hand Proof

**Proposition:** P-S2  
**Proof tier:** A  
**Execution status:** Local reference invariant PASS  
**Independent review:** PENDING HUMAN SIGN-OFF  
**Owner-delegated AI review:** APPROVED_WITH_RESIDUAL_OBLIGATIONS (same-context, non-human, non-independent;
2026-08-10)  
**Separation note:** The owner authorized the implementation context to execute Task 10 on 2026-08-10. This document is
therefore proof-worker output by explicit exception, not an independent-context review.

## Claim

For every supported transition, aggregate confidential custody assets `A` cover aggregate claimable liabilities `L`, and
liabilities cover aggregate remaining principal `P`:

```text
A >= L >= P
L = sum(userBalance[u])
P = sum(principalBalance[u])
```

Numeric `A`, `L`, `P`, user balances and principal balances remain encrypted in production. The plaintext symbols in
this proof are mathematical witnesses in the Foundry reference model, not production disclosure paths.

## Assumptions

1. ERC-7984 returns the exact confidential amount `moved` and changes token custody by that same amount.
2. The ERC-7984 total supply is at most `2^64 - 1`; failed/clamped transfers return encrypted zero.
3. Active and retiring adapters are bound to the vault and their supported custody operations are lossless. Yield-source
   failure is outside the guarantee, as stated in the frozen trust boundary.
4. `harvest()` reports only yield already funded in cUSDC custody and transfers any adapter-held harvested amount to the
   vault before credits are written.
5. Public-decryption signatures bind the exact checkpoint handle, cleartext, `riskEpoch` and nonce as verified by the
   FHE integration tests. Real Sepolia confirmation remains a Task 14-15 obligation.
6. The encrypted arithmetic bounds in `docs/proofs/overflow-derivations.md` hold.

## Base Case

Immediately after deployment, no user claim or principal exists and supported adapters hold no vault principal:

```text
A = L = P = 0
sum(userBalance) = sum(principalBalance) = 0
```

The invariant therefore holds initially.

## Transition Preservation

### Deposit

Let ERC-7984 return `moved = m`. Token custody increases by `m`. The vault adds the same handle to user balance, user
principal, `L` and `P`:

```text
A' = A + m
L' = L + m
P' = P + m
```

Routing `m` from vault custody to the active adapter changes only the custody partition, not `A`. When a requested
transfer is clamped or fails, `m = 0`, so no claim is minted.

### Withdraw, Withdraw-All and Emergency Withdraw

Liquidity collection moves custody between the active/retiring adapters and the vault without changing `A`. Let the
outgoing ERC-7984 transfer return `m`, and let the user's principal before the transition be `p`:

```text
principalDebit = min(m, p)
A' = A - m
L' = L - m
P' = P - principalDebit
```

If `m <= p`, both the user's claim and principal fall by `m`, preserving their difference. If `m > p`, the user's
principal becomes zero while their remaining claim is non-negative. Thus each user keeps `balance >= principal`, so
`L' >= P'`. Since `A - L` is unchanged, `A' >= L'`.

### Exit and Finalize Exit

`unwrap` burns exactly the returned encrypted wrapper amount and creates the asynchronous public unwrap request. The
vault applies the same debit equations as withdrawal. `finalizeUnwrap` transfers underlying ERC-20 against the already
burned amount and does not change encrypted Lok accounting. Participant removal changes no claim, principal or custody.

### Funded Prize and Direct-Yield Credit

Let `Y` be realised funded yield and `W` total yield weight. Let `B` be total base-risk weight and
`D = sum(d_i) = W - B` be total direct weight. With `Q = 2^26`, production computes:

```text
prizeAmount = floor(Y * B / W)
directRate = floor(Y * Q / W)
directCredit_i = floor(d_i * directRate / Q)
```

For every participant:

```text
directCredit_i <= d_i * Y / W
```

Therefore:

```text
prizeAmount + sum(directCredit_i)
<= Y * B / W + Y * D / W
= Y
```

The left side is integral, so rounding cannot increase it above `Y`. Harvested cUSDC supplies an asset surplus of at
least `Y`; crediting at most `Y` increases `L` without increasing `P`, preserving `A >= L >= P`. The fuzz boundary test
`testFuzz_P_S2_FundedAllocationNeverExceedsYield` checks integer rounding combinations.

### Draw State, Checkpoint and User-Weight Transitions

Opening, pausing, pre-syncing, cranking PASS A, committing/revealing entropy, opening randomness, aborting and closing a
draw do not move custody or alter claims/principal. `setTheta`, accumulator sync, checkpoint roll and ACL grants
likewise do not change `A`, `L` or `P`.

`openSolvencyCheckpoint` computes only the encrypted predicate `A >= L`. A valid `true` proof authorizes the current
`riskEpoch`; a false, forged, wrong-handle, duplicate or risk-stale proof cannot authorize a risk transition. Safe user
and funded-credit transitions advance `accountingVersion` but preserve the proved relation inductively, so they do not
invalidate the same-epoch mathematical fact. Oracle failure blocks new risk transitions, not recovery.

### Adapter Lifecycle

- Proposal and timelock progression move no asset.
- Activation is IDLE-only and requires a verified current-epoch checkpoint. The old active adapter becomes retiring; the
  new adapter becomes active. Existing custody is only reclassified, so `A` does not decrease.
- Activation increments `riskEpoch`; deposits remain in the vault and draws/risk transitions stay disabled until a new
  checkpoint authorizes that epoch.
- Permissionless drain moves the full retiring balance to the vault without changing `A`.
- Removal is permitted only after the retiring encrypted balance is fully returned and the current epoch is authorized;
  deleting the empty pointer cannot reduce `A`.

### Reentrancy and Unauthorized Calls

Vault value legs/checkpoint submission and every state-changing draw-manager entrypoint are guarded. Malicious callback
attempts revert or no-op before protected state changes. Owner, keeper, omitted guardian and adapter-admin calls outside
their interfaces cannot change user claims/principal or move custody. These rejected transitions preserve the invariant
by identity.

## Overflow Closure

Custody, liability and principal are bounded by ERC-7984 supply (`2^64 - 1`). User/accounting additions consume actual
`moved` custody or already funded yield; subtraction is bounded by balances. The eTWAB and PASS A bounds establish
`W < 2^52`, `B <= W`, and effective prefix `< 2^53`, so draw normalization does not wrap before credits are computed.

## Machine Evidence

- Safety campaign: `10,000,004` sequences, depth `32`, `320,000,128` calls, `0` reverts.
- Fairness/funding campaign: `10,000,004` sequences, depth `32`, `320,000,128` calls, `0` reverts.
- Forge: `1.7.1`; 28 deterministic shards per campaign.
- Reports: `artifacts/invariants/safety.json`, `artifacts/invariants/fairness.json`, and
  `artifacts/invariants/summary.json`.
- FHE mock integration: full Hardhat suite passed before this proof campaign. Fresh broad regression is required after
  the proof files are finalized.

## Residual Obligations

- Human or genuinely independent proof reviewer sign-off: **pending**.
- Sepolia ERC-7984/FHE ACL, returned-amount, checkpoint proof-binding and HCU integration: **pending Task 14-15**.
- The yield venue's lossless-operation assumption cannot be proven by Lok.

## Sign-Off

AI reviewer: Codex AI proof reviewer (owner-delegated, same-context, non-human, non-independent)  
AI review date: 2026-08-10  
AI verdict: **APPROVED_WITH_RESIDUAL_OBLIGATIONS**  
Review record: `docs/proofs/P-S2-P-S3-ai-review-2026-08-10.md`

Human or independent reviewer: **PENDING**

Reviewer: **\*\*\*\***\_\_\_\_**\*\*\*\***  
Date: **\*\*\*\***\_\_\_\_**\*\*\*\***  
Verdict: PENDING
