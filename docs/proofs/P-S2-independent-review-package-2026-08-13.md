# P-S2 Independent Review Package

- **Prepared by:** Codex AI proof worker (owner-delegated, same-context, non-human, non-independent)
- **Prepared:** 2026-08-13
- **Review status:** `PENDING-INDEPENDENT-REVIEW`
- **Code/test commit:** `65ff43262778a1c073d1d2f413a11d9c57cb98a5`
- **Existing invariant evidence commit:** `03726508f417ccd270afb321ea570d73274318f6`
- **Sepolia state-changing evidence:** `BLOCKED` pending owner authorization and gas budget

This package is input for an independent reviewer. It is not a sign-off and does not replace the separation rule.

## Frozen Obligation

**Statement:** For every deposit, withdrawal, exit, emergency-withdrawal, funded-credit, draw and adapter transition,
aggregate assets cover aggregate claimable liabilities, and aggregate liabilities cover aggregate principal. Deposits
add the same encrypted ERC-7984 `moved` value to assets, liability and principal; withdrawals subtract `moved` from
assets/liability and only `min(moved, principalBalance[user])` from principal; prize/direct-yield credits are allocated
exactly once from normalized `tEnd` weights and cannot exceed realised funded yield; lossless custody flows preserve the
aggregate asset sum. These transitions carry a verified solvency base case forward within the same `riskEpoch`,
including after `tEnd`. A custody/risk-boundary transition is authorized only by an on-chain-verified `true`
assets-versus-liabilities checkpoint for the current `riskEpoch`; false, forged, risk-stale, wrong-handle or
duplicate-nonce results cannot authorize it. Oracle unavailability blocks risk transitions but not principal recovery.

**Tier/tool:** A; Foundry reference invariant + hand proof + Hardhat/Sepolia FHE integration.

**Pass criterion:** `assets >= liabilities >= principal`, `sum(balance) = liabilities`, and
`sum(principalBalance) = principal` hold over at least `10^7` reference sequences. A reviewed hand proof must cover the
ERC-7984 supply bound, principal-first withdrawal, funded-allocation inequality at rounding boundaries, exactly-once
cursor consumption, safe accounting-version closure and prohibition of cumulative cross-harvest indexes. Integration
must establish ACL persistence, returned-amount semantics and exact handle/risk-epoch/nonce proof binding including all
negative cases. Numeric assets, liabilities and principal are never decrypted.

## Mathematical State

For users `u` and the current custody set:

```text
A  = vault cUSDC + active-adapter cUSDC + retiring-adapter cUSDC
L  = encryptedTotalLiability = sum_u balance[u]
P  = encryptedTotalPrincipal = sum_u principalBalance[u]
Y  = realised, funded but not yet allocated yield
V  = accountingVersion
E  = riskEpoch
ES = lastSolventRiskEpoch
C  = (pendingHandle, pendingRiskEpoch, pendingAccountingVersion, nonce, pending)
D  = (drawId, tEnd, preSyncCursor, passACursor, passBCursor, allocated participants)
```

Required invariant:

```text
A >= L >= P
L = sum_u balance[u]
P = sum_u principalBalance[u]
balance[u] >= principalBalance[u] for every u
```

`A`, `L`, `P` and every per-user value are proof witnesses only. Production keeps them encrypted and exposes only the
checkpoint-specific boolean `A >= L`.

## Base Case

At deployment, all custody partitions and encrypted aggregate/user accounting values are zero. Thus `A = L = P = 0`,
both sum equalities hold, and `balance[u] >= principalBalance[u]` is vacuous. The initial true checkpoint authorizes
`riskEpoch = 1`; it does not disclose any numeric aggregate.

## Transition Proof Map

| Transition                       | Preservation argument                                                                                                                                                                                                                | Contract path                                                                      | Primary evidence                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Deposit                          | ERC-7984 returns `moved=m`; custody, user balance, user principal, `L` and `P` each increase by the same `m`. A zero/clamped transfer mints no claim. Routing vault-to-adapter only changes custody partition.                       | `LokVault.deposit`, lines 181-207                                                  | `LokVault.moved.t.ts`; safety handler `deposit`                     |
| Withdraw / all / emergency       | Collecting liquidity preserves `A`. Outgoing ERC-7984 returns `m`; `A` and `L` decrease by `m`; `P` decreases by `min(m, principalBalance[u])`. Therefore `A-L` is unchanged and `L-P` cannot decrease below zero.                   | `LokVault.sol`, lines 212-226 and 439-481                                          | `LokVault.withdraw.t.ts`; `LokVault.solvency.t.ts`; safety handler  |
| Exit / finalize                  | Wrapper burns the actually moved confidential amount and applies the same debit equations. Finalization transfers underlying against the already-burned request and does not mutate Lok accounting.                                  | `LokVault.sol`, lines 228-258                                                      | wrapper/API verification; exit unit tests                           |
| Fund realised yield              | Yield is counted only after funded cUSDC enters the custody set. This increases `A` and available funded yield, not `L` or `P`.                                                                                                      | `MockYieldAdapter.harvest`; `LokVault.harvestRealisedYield`                        | yield unit tests; adapter tests                                     |
| Prize/direct credit              | Let `W=B+D`, `Q=2^26`, `prize=floor(YB/W)`, `rate=floor(YQ/W)`, and `direct_i=floor(d_i*rate/Q)`. Then `sum(direct_i)+prize <= Y(D+B)/W = Y`. Credits increase `L` by at most the funded surplus and do not increase `P`.            | `LokDrawManager._processPassB`; `LokVault.creditDraw`, lines 410-425               | draw reference, rounding fuzz, settlement safety assertions         |
| PASS A/B cursors                 | Monotone cursor consumes each snapshot index once. Post-`tEnd` user actions change future accounting only; the current draw uses exact `tEnd` checkpoints.                                                                           | `LokDrawManager.preSyncA`, `crankA`, `crankB`; `LokVault._syncUser`, lines 521-569 | TLA+ P-L5/P-L6; boundary/differential tests; safety `settleDraw`    |
| No-accounting draw actions       | Open, commit/reveal, aggregate proof submission, randomness, abort and close do not directly mutate `A`, `L` or `P`.                                                                                                                 | draw state-machine functions                                                       | draw state/outcome-integrity tests                                  |
| Safe same-epoch custody movement | Vault/active/retiring transfers conserve the sum `A`. They advance `V` but not `E`; the verified base case remains inductively valid.                                                                                                | deposit routing; `_collectLiquidity`; `drainRetiringAdapter`                       | adapter and checkpoint tests; reference custody partition assertion |
| Checkpoint open/submit           | Open computes only encrypted `A >= L` and binds its handle to `E`, `V` and a new nonce. Submit checks pending state, exact epoch/nonce and KMS signatures before decoding the boolean. Invalid inputs cannot change authorization.   | `LokVault.sol`, lines 278-325                                                      | checkpoint positive/negative Hardhat tests; prior Sepolia probe     |
| Adapter activation               | Proposal is IDLE-only, current-epoch-authorized and timelocked. Activation reclassifies the old adapter as retiring, changes future routing and increments `E`; deposits then remain in the vault until the new epoch is authorized. | `LokVault.proposeAdapter/activateAdapter`, lines 327-354                           | TLA+ P-A8; Foundry reference; Hardhat authorization tests           |
| Adapter drain/removal            | Drain returns full retiring custody to vault. Removal requires drained state and a current-epoch true checkpoint before deleting the empty pointer, then increments `E`.                                                             | `LokVault.sol`, lines 357-373                                                      | adapter lifecycle tests; safety reference                           |
| Theta/Fortune/eTWAB metadata     | These change odds state but not custody, claimable balance or principal, except deterministic funded credits covered above.                                                                                                          | `_syncUser`, `_recomputeRate`, `setTheta`                                          | differential/overflow/Fortune tests                                 |
| Reentrant/unauthorized attempt   | Guards or role checks reject the call before protected accounting changes; the identity transition preserves the invariant.                                                                                                          | `nonReentrant`, `onlyDrawManager`, `onlyOwner`                                     | malicious-token and authorization suites                            |

## Accounting-Version Closure

`accountingVersion` identifies encrypted snapshots and advances on safe accounting/custody changes. It is not itself a
risk boundary. The proof carries a verified `A >= L` base case through deposits, withdrawals, funded credits and
lossless custody movements within the same `riskEpoch`; those transitions have the preservation arguments above.
Changing the custody/risk assumption increments `riskEpoch` and invalidates authorization until a fresh true checkpoint.
This avoids stalling settlement after `tEnd` while preventing stale authorization of new risk.

No cumulative cross-harvest rate/index is used. Each draw snapshots normalized `tEnd` weights, harvests its funded
yield, derives one draw-scoped direct rate, and consumes each participant once.

## Machine Evidence

| Evidence                  | Result                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| Safety campaign           | 10,000,004 sequences; 320,000,128 calls; 14,550,605 `settleDraw` calls; 28 shards; 0 reverts             |
| Fairness/funding campaign | 10,000,004 sequences; 320,000,128 calls; 63,999,795 `settleDraw` calls; 28 shards; 0 reverts             |
| Raw campaign hashes       | `artifacts/invariants/raw-log-hashes.json`                                                               |
| Local FHE tests           | ACL persistence, actual `moved`, principal-first debit, checkpoint binding and oracle-down recovery      |
| Existing Sepolia          | returned-transfer/checkpoint probes and read-only deployment validation only; not a fresh P-S2 lifecycle |

The reference campaign was not rerun for this package because no production/reference invariant or selector changed.

## Assumption Register

| Assumption                                                        | Classification                               | Evidence / residual                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- |
| ERC-7984 returned handle equals custody amount moved              | Code dependency + tested                     | Installed OZ source, local FHE tests and prior Sepolia probe                            |
| ERC-7984 total supply fits `euint64`                              | External standard bound                      | Hand-proof premise; boundary tests                                                      |
| Supported adapter custody operations are lossless                 | Externally trusted venue assumption          | Mock adapter tests; real venue loss remains out of guarantee                            |
| Harvest reports only cUSDC already funded into custody            | Enforced by adapter interface/implementation | Adapter and yield tests                                                                 |
| KMS signatures bind exact handle and cleartext                    | Platform trust + integration tested          | Installed API, local negatives, prior Sepolia probe; fresh production negatives pending |
| Coprocessor and KMS threshold assumptions hold                    | External trust boundary                      | Frozen proof strategy section 5                                                         |
| Every accounting transition is represented in the reference model | Reviewer obligation                          | Mapping above; independent hostile review pending                                       |
| Post-`tEnd` checkpoint values are exact                           | Enforced + tested                            | `_syncUser` exact boundary; P-L6 boundary tests                                         |
| Adapter transition on shared demo is safe to exercise             | Unresolved/false operationally               | Must use a dedicated deployment                                                         |

## Fresh Sepolia Plan

Read-only preflight is recorded in `artifacts/sepolia/p-s2-preflight.json`. The existing shared deployment is bytecode-
matched, solvent-authorized, settled and funded with `0.320904470408082305 ETH` at the operator wallet. The bounded plan
has at most 54 transactions and a `0.16 ETH` stop budget:

1. Mint test cUSDC, set operator, submit two encrypted deposits to exercise ACL persistence.
2. Fund yield and settle a 31-participant draw with caps `4/3/2`.
3. Withdraw all of the fresh user's confidential claim.
4. Open/decrypt/submit a fresh true solvency checkpoint.
5. Mine actual rejected submissions for wrong nonce, wrong epoch field, tampered proof, replaced handle and duplicate
   nonce, recording receipt status, revert data and raw receipt SHA-256.

The following are `NOT_RUN` on the shared deployment: false solvency result, changed-risk-epoch stale proof, adapter
activation/drain/removal and emergency recovery from a deliberately unsafe adapter. Each requires a dedicated deployment
because manufacturing insolvency or changing live custody routing would alter submission state.

## Independent Reviewer Checklist

- Re-derive every transition above without relying on contract comments or the existing hand proof.
- Confirm the reference model does not share a material accounting bug with production.
- Inspect all 22 safety selectors and verify settlement assertions run after each PASS-B credit and final settlement.
- Recompute campaign totals/hashes from durable shard artifacts.
- Review the fixed-point inequality at `W=0`, `B=0`, scale boundaries and maximum supported values.
- Verify no production path mutates `A`, `L`, `P`, `E`, checkpoint state or custody outside the mapping.
- Review fresh Sepolia receipts only after the authorized lifecycle exists.

```text
Independent reviewer: PENDING
Date: PENDING
Verdict: PENDING-INDEPENDENT-REVIEW
```
