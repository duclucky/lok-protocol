# P-S2 Independent Re-review Package

- **Prepared by:** Codex AI proof remediation worker (owner-delegated, same-context, non-human, non-independent)
- **Prepared:** 2026-08-13
- **Hand-proof status:** `READY_FOR_INDEPENDENT_RE-REVIEW`
- **Full P-S2 status:** `BLOCKED`
- **Code/test commit:** `65ff43262778a1c073d1d2f413a11d9c57cb98a5`
- **Invariant evidence commit:** `03726508f417ccd270afb321ea570d73274318f6`
- **Manifest commit reviewed by this package:** `8531d57db3ad4e62ff26bd53ac818a38040f74fb`
- **Sepolia state-changing evidence:** not executed; Groups A and B require separate owner authorization

This package is input to a new independent review. The remediation author cannot sign that review. Frozen section 3 is
unchanged, and this package does not change the verdict for full P-S2.

## Frozen Obligation

P-S2 requires every deposit, withdrawal, exit, emergency withdrawal, funded credit, draw, and adapter transition to
preserve aggregate assets over aggregate claimable liabilities and liabilities over aggregate principal. Accounting must
use the actual encrypted ERC-7984 `moved` value; credits must be exactly-once, normalized at `tEnd`, and bounded by
realised funded yield. Same-risk-epoch safe transitions may carry a verified base case forward. A risk-boundary
transition requires an on-chain-verified true checkpoint for the current epoch, while false, forged, stale,
wrong-handle, and duplicate results cannot authorize it. Oracle nondelivery must not block principal recovery.

Assigned evidence is the Foundry reference invariant, a reviewed hand proof, and Hardhat/Sepolia FHE integration. The
numeric relations and sum equalities must hold over at least `10^7` reference sequences; numeric assets, liabilities,
principal, and per-user values are never publicly decrypted.

## Mathematical State And Base Cases

For users `u` and supported custody sources:

```text
A  = vault cUSDC + active-adapter cUSDC + retiring-adapter cUSDC
L  = encryptedTotalLiability = sum_u balance[u]
P  = encryptedTotalPrincipal = sum_u principalBalance[u]
V  = accountingVersion
E  = riskEpoch
ES = lastSolventRiskEpoch
C  = pending checkpoint handle, epoch, accounting version, nonce, and pending flag
D  = draw id, exact tEnd, snapshot, pre-sync cursor, PASS-A cursor, and PASS-B cursor
```

Required mathematical invariant:

```text
A >= L >= P
L = sum_u balance[u]
P = sum_u principalBalance[u]
balance[u] >= principalBalance[u] for every u
```

### Mathematical base case

At deployment, `A = L = P = 0`; all user ledgers sum to zero. The mathematical invariant holds.

### Authorization base case

Production initializes `riskEpoch = 1` and `lastSolventRiskEpoch = 0`. There is no initial risk authorization. User
deposit/recovery paths remain callable, deposits stay in the vault, and draw/adapter risk transitions remain locked.
Epoch 1 is authorized only after `openSolvencyCheckpoint`, public decryption of the exact aggregate ebool, and
submission of its valid true proof.

## Transition Correspondence Map

| Transition                  | Preservation obligation                                                                                                                                                           | Production path                                                                                | Evidence and limitation                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Deposit                     | Actual `moved=m` adds the same `m` to custody, user balance/principal, `L`, and `P`; routing only reclassifies custody.                                                           | `LokVault.deposit`, lines 181-207                                                              | Moved/ACL Hardhat tests and accounting reference. Sepolia repeated-use path is Group A and not run.                                           |
| Withdraw / all / emergency  | Full collection preserves `A` under supported-adapter postcondition. Outgoing actual `moved=m` subtracts `m` from `A/L/balance` and `min(m,p[u])` from `P/p[u]`.                  | `LokVault`, lines 212-226 and 439-481                                                          | Withdrawal/moved/oracle-down Hardhat tests and reference selectors.                                                                           |
| Exit / finalize             | Wrapper `unwrapAmount` supplies actual encrypted moved for the same debit equations; finalization and participant removal are accounting-neutral.                                 | `LokVault`, lines 228-265                                                                      | Wrapper API verification and local exit tests; Sepolia S51-S52/D36-D37 not run.                                                               |
| Funded yield enters custody | Increases `A`, not `L/P`; adapter accounting prevents double harvest after full return.                                                                                           | `YieldInjectingERC7984.injectYield`; `MockYieldAdapter.notifyYield/withdrawAllToVault/harvest` | Yield and adapter unit tests. Supported-adapter behavior is not generalized to arbitrary interface implementations.                           |
| Normalized PASS A           | Exact-`tEnd` deltas satisfy `ticketDelta_i <= 4*yieldDelta_i`; therefore `baseRisk_i <= yieldWeight_i`, `directWeight_i >= 0`, `D=W-B`, and `0<=B<=W`.                            | `LokVault._syncUser`; `LokDrawManager._processPassA`                                           | Self-contained lemma in `P-S2-solvency.md`; tEnd boundary and differential tests. Foundry does not model these production shifts.             |
| `W=0` draw                  | Void before harvest/division; issue zero credits and preserve `A/L/P`.                                                                                                            | `LokDrawManager.submitTotals`, lines 301-312                                                   | Draw zero/dust tests plus explicit hand-proof case.                                                                                           |
| `W>0` funded allocation     | `prize + sum(direct_i) <= Y`; rounding residue stays in custody; `P` unchanged.                                                                                                   | `submitTotals`, `_processPassB`, `LokVault.creditDraw`                                         | Fixed-point proof, boundary fuzz, draw differential, and reference funding abstraction. Sepolia settlement not run.                           |
| PASS-A/PASS-B cursors       | Fixed snapshot and monotone half-open intervals cover each index once; PASS-B abort is forbidden after first credit.                                                              | `openDraw`, `preSyncA`, `crankA`, `submitTotals`, `crankB`, `abortDraw`                        | Explicit cursor proof, state/sweep tests, TLA+, and Foundry batch composition abstraction.                                                    |
| No-accounting draw actions  | Open, pause, commit/reveal, randomness, and pre-credit abort do not mutate `A/L/P`; metadata only.                                                                                | Draw state-machine functions                                                                   | Draw state/outcome tests and TLA+.                                                                                                            |
| Checkpoint open/submit      | Open binds aggregate ebool handle, epoch, version, and nonce. Submit checks pending, exact epoch/nonce, and KMS signature before applying the decoded boolean.                    | `LokVault`, lines 278-325                                                                      | Local FHE positive/negative tests and limited probes. Foundry forged selector is not cryptographic evidence. Fresh Sepolia negatives not run. |
| Same-epoch safe evolution   | Deposit, recovery, exit, funded custody, bounded credits, lossless custody movement, and metadata transitions preserve a true checkpoint fact even when `V` changes.              | All listed accounting paths                                                                    | Complete version-closure argument in `P-S2-solvency.md`; D21-D22 and Group A post-tEnd path not run.                                          |
| Adapter proposal/activation | Proposal is IDLE/current-epoch-authorized/timelocked. Activation reclassifies old active as retiring, selects future routing, and increments `E`, invalidating old authorization. | `proposeAdapter`, `activateAdapter`                                                            | TLA+, reference state machine, authorization tests; disposable D20-D26 not run.                                                               |
| Adapter drain/removal       | Preservation depends on supported adapter returning its full balance. Production trusts successful external return and a drained flag; current-epoch authorization gates removal. | `drainRetiringAdapter`, `removeRetiringAdapter`                                                | Mock adapter source/local integration and explicit external postcondition; disposable D28-D33 not run.                                        |
| Reentrant/unauthorized call | Rejected before protected accounting/custody changes, giving the identity transition.                                                                                             | `nonReentrant`, `onlyDrawManager`, `onlyOwner`, adapter `onlyVault`                            | Reentrancy and authorization suites.                                                                                                          |

## Normalized `tEnd` And Allocation Lemmas

The complete derivation is in `docs/proofs/P-S2-solvency.md`. The re-review must check these specific steps rather than
accepting a citation to architecture:

1. With `Q=2^26`, clamped theta and rate saturation imply `ticketDelta_i <= 4*yieldDelta_i`.
2. Monotone flooring gives `baseRisk_i=floor(ticketDelta_i/(4Q)) <= floor(yieldDelta_i/Q)=yieldWeight_i`.
3. Consequently `directWeight_i` cannot underflow, `D=W-B`, and `0<=B<=W`.
4. `W=0` is handled before harvest or division.
5. For `W>0`, floor monotonicity proves `rate<=YQ/W`, `direct_i<=d_iY/W`, and `prize+sum(direct_i)<=Y(B+D)/W=Y`,
   including `B=0`, `Y=0`, `D=0`, and rounding residue.
6. Supply and production bounds prove prize/direct intermediate values fit their plaintext/encrypted widths without
   relying on FHE arithmetic to revert.

## Exactly-Once And Cross-Harvest Closure

`openDraw` fixes `participantSnapshot=N`. New participants append outside `[0,N)`, and active-draw removal is deferred,
so snapshot indices do not shift. Every valid crank processes `[cursor,min(cursor+batch,N))`, where batch is positive
and capped, then assigns cursor to that end. No caller supplies a start index. Consecutive intervals therefore have no
overlap or gap.

PASS A ends at `N`. Valid total submission resets cursor to zero, and PASS B traverses the same snapshot once. Abort
before the first PASS-B credit creates zero credits; abort after cursor becomes positive is forbidden, leaving only
permissionless completion. Per-draw ranges, direct weights, prize credits, realised yield, and direct rate are keyed by
or stored in the current draw. No cumulative cross-harvest rate/index exists.

## Accounting-Version Closure

`pendingSolvencyAccountingVersion` identifies the opened snapshot. Submit deliberately does not require equality with
current `accountingVersion`. A same-epoch true result remains valid because every possible intervening relevant
transition is covered:

- deposit using actual moved;
- withdraw, withdraw-all, emergency withdrawal, and exit using actual moved and principal-first debit;
- funded yield entering custody;
- direct/prize credits bounded by funded yield;
- supported lossless vault/active/retiring custody movement;
- accounting-neutral draw, user-weight, checkpoint, pause, ACL, and participant metadata;
- post-`tEnd` user actions after exact closure of the current draw snapshot.

Externally funded custody can strengthen `A>=L` without incrementing `V`; all version advances that affect accounting or
custody are included above. A custody/risk-boundary change increments `riskEpoch`, so old authorization no longer equals
the current epoch and cannot be used.

## Adapter Trust-Boundary Postcondition

The reviewer must not transfer the reference model's check to production:

```text
Reference removal precondition: retiringAdapterAssets == 0

Production drain:
  call retiringAdapter.withdrawAllToVault()
  after successful return, set retiringAdapterDrained = true

Production removal preconditions:
  retiringAdapterDrained
  current risk epoch authorized
```

Production does not compare returned `moved` against the pre-drain encrypted balance. The proof therefore relies on the
frozen supported-adapter postcondition:

```text
withdrawAllToVault succeeds
=> retiring balance after call is zero
=> vault custody rises by exactly the removed custody
=> aggregate A is preserved
```

Classification: externally trusted behavior of supported adapters; source/local-integration tested for
`MockYieldAdapter`; not enforced by `LokVault` for arbitrary `IYieldAdapter`; exact deployed path still requires
disposable Sepolia D28-D33. This is an explicit trust-boundary dependency, not a production-vault guarantee.

## Reference Abstraction: Exact Scope

`LokHandler.settleDraw` snapshots plaintext `LokAccountingModel.balanceOf` and handler `theta`.
`LokDrawReference.processProductionPassA` computes a balance/theta weight. It does not model production `_syncUser`,
piecewise eTWAB accumulators, exact-`tEnd` checkpoints, or the `>>26`/`>>28` shifts.

The committed safety campaign has:

```text
10,000,004 sequences
depth 32
320,000,128 calls
14,550,605 settleDraw calls
28 shards
0 reported reverts
```

It establishes generic accounting preservation, cursor composition, funded-allocation bounds, and post-snapshot action
isolation within that abstraction. It is not an exact model of production normalized settlement. Production
correspondence additionally requires the hand-proof normalized lemma, Hardhat `tEnd` boundary tests, sync/draw
differential tests, and the unexecuted Sepolia Group A lifecycle.

No campaign rerun is required for this remediation because production, reference, handler, selector, and assertion logic
did not change.

## Forged-Checkpoint Evidence Separation

Foundry `submitForgedCheckpoint` does not submit a decryption proof or invoke `FHE.checkSignatures`. It sets an abstract
flag and asserts that abstract authorization metadata did not change. Its scope is only abstract identity/no-mutation
behavior.

Cryptographic semantics come from a different evidence layer:

- Hardhat FHE tests for tampered proof, replaced handle, wrong epoch, wrong nonce, and duplicate submission;
- limited existing Sepolia checkpoint probes;
- planned state-changing Group A/B negative submissions, still BLOCKED and unauthorized.

Reference invariant, local FHE integration, and Sepolia integration must remain separate in any re-review verdict.

## Overflow Checklist

The independent reviewer must confirm:

- ERC-7984 safe update gives `totalSupply<=2^64-1`, and `A<=totalSupply`, `L<=A`, `P<=L`;
- supported `W<2^52`, `B<=W`, `d_i<=W`, and `Y<=2^64-1`;
- `Y*B<2^116` fits `uint256`;
- `Y*Q<2^90`, so `directRate` fits `uint128`;
- `d_i*directRate<=YQ<2^90<2^128`, so `directWide` cannot wrap;
- each participant total credit is no greater than total allocation `<=Y`, fitting `euint64`;
- cumulative liability credit remains at most funded custody surplus, so aggregate liability cannot wrap.

## Machine Evidence And Limitations

| Evidence class             | Current result                                                                                                                        | What it does not establish                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Foundry safety reference   | `10,000,004` sequences; `320,000,128` calls; `14,550,605` settlement calls; 28 shards; 0 reported reverts                             | Production eTWAB/normalization or cryptographic proof rejection |
| Hardhat local FHE          | Actual moved, ACL persistence, principal-first debit, checkpoint binding, oracle-pending recovery, tEnd boundaries, draw differential | Sepolia state-changing behavior                                 |
| Existing Sepolia           | Read-only deployment validation and limited earlier probes                                                                            | Fresh complete P-S2 lifecycle and all negative cases            |
| Planned Sepolia Groups A/B | Manifest only                                                                                                                         | No on-chain result until separately authorized and executed     |
| Hand proof                 | Remediated and ready for a new independent review                                                                                     | No independent verdict yet                                      |

## Assumption Register

| Assumption                                                       | Classification                              | Evidence / residual                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ERC-7984 returned handle equals custody moved                    | Library dependency and local FHE tested     | Installed OpenZeppelin source, moved tests, limited prior probe; fresh lifecycle pending      |
| ERC-7984 total supply is bounded by `euint64` safe update        | Library-enforced bound                      | Installed `ERC7984._update` uses safe increase                                                |
| Supported adapter full return is lossless and complete           | Frozen external yield-source trust boundary | Mock source/local tests; arbitrary interface implementations are not covered; D28-D33 pending |
| Harvest reports only already funded custody                      | Supported-adapter implementation obligation | Mock source/yield tests; fresh S04/S27 pending                                                |
| KMS signatures bind exact handles and cleartexts                 | Platform trust plus integration             | Local FHE negatives and limited probe; fresh Group A/B negatives pending                      |
| Coprocessor/KMS threshold assumptions hold                       | Frozen platform trust boundary              | Not re-proven by Lok                                                                          |
| Foundry draw abstraction corresponds to production normalization | Not assumed                                 | Requires the explicit lemma, boundary/differential tests, and Sepolia Group A                 |
| Permanent oracle nondelivery does not block recovery             | Code/state-machine property                 | Recovery paths contain no decryption; local/TLA+ evidence; live permanent outage not induced  |

## Re-review Checklist

- Re-derive both base cases and confirm no initial authorization is assumed.
- Check every algebraic step in the normalized and fixed-point lemmas, including all zero cases.
- Verify all stated integer-width bounds against production types and supported limits.
- Map every `A/L/P`, custody, epoch, checkpoint, and cursor mutation to one transition row.
- Confirm participant churn cannot shift `[0,N)` during either pass.
- Inspect all 22 safety selectors and independently recompute committed campaign totals and hashes.
- Keep Foundry forged metadata separate from cryptographic KMS evidence.
- Treat adapter full return as an external supported-adapter postcondition, not vault enforcement.
- Do not review Sepolia receipts until separately authorized state-changing evidence exists.

## Status For Handoff

```text
P-S2 hand proof: READY_FOR_INDEPENDENT_RE-REVIEW
Full P-S2: BLOCKED
P-P1: WEAKER-THAN-CLAIMED
Independent reviewer identity: not assigned in this package
Independent verdict: not supplied by this package
```
