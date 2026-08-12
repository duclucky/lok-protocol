# 07 — Test Plan

Tests serve two purposes here. The ordinary one: catching bugs. The second one is specific to this submission: **the
test names are part of the pitch.** A reviewer scanning `test/` should be able to read the test list and conclude that
the author understood the problem. Name tests so that happens.

Run everything in **mock mode** unless a test specifically exercises live infrastructure. Mock mode needs no KMS or
gateway and is fast enough for a tight loop.

---

## 1. Structure

```
test/
├── unit/
│   ├── LokVault.deposit.t.ts
│   ├── LokVault.withdraw.t.ts
│   ├── LokVault.theta.t.ts
│   ├── LokVault.sync.t.ts            # eTWAB correctness — the highest-value file here
│   └── LokVault.yield.t.ts
├── draw/
│   ├── DrawManager.state.t.ts
│   ├── DrawManager.sweepA.t.ts
│   ├── DrawManager.sweepB.t.ts
│   └── DrawManager.randomness.t.ts
├── invariants/
│   ├── privacy.t.ts                  # invariants I3–I5
│   ├── liveness.t.ts                 # invariants I2, I9
│   ├── overflow.t.ts                 # invariant I10
│   └── accounting.t.ts               # invariant I1
├── statistical/
│   └── fairness.t.ts                 # Monte Carlo odds distribution
├── compliance/
│   └── spec.t.ts                     # one test per bounty requirement R1–R9
└── integration/
    └── sepolia.e2e.t.ts              # live network, run manually
```

---

## 2. Compliance tests — write these first

One test per requirement in `docs/01-bounty-compliance.md` §1, named after the requirement. These exist so a reviewer
can map specification to evidence in seconds. Writing them first also forces the design to be correct before it is
elaborate.

```
test_R1_SharedPool_MultipleDepositorsSingleVault
test_R2_SpecExact_AllPoolYieldAwardedAsPrizes        ← the one they will look for by name
test_R3_WithdrawPrincipal_AnyState
test_R4_EndToEndEncrypted_NoPlaintextAmountInAnyEvent
test_R5_PerUserOdds_NeverPubliclyDecryptable
test_R6_WinnerIndistinguishableFromLoser
test_R7_WinnerSelection_OperatesOnEncryptedBalances
test_R8_OnlyWinnerDecryptsNonZeroPrize
test_R9_DrawPubliclyVerifiable_InvariantHolds
```

`test_R2` must run a complete deposit → accrue → draw → settle cycle **without touching the Risk Dial** and assert
`prizeAmount == accruedYield` exactly. This is the test that closes the interpretive risk discussed in
`docs/01-bounty-compliance.md` §2.

---

## 3. eTWAB correctness — the most important unit tests

The time-weighted accumulator is where a subtle bug is both most likely and most damaging, because it silently
misallocates odds rather than reverting.

| Test                                             | Asserts                                                                                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `test_TWAB_ConstantBalance_LinearAccumulation`   | Balance `B` held for the full window yields weight `B · θ · period`.                                                             |
| `test_TWAB_LateDeposit_ProportionallyWeighted`   | Depositing `2B` at the halfway point yields the same weight as `B` for the full window. This is the canonical anti-sniping case. |
| `test_TWAB_LastSecondDeposit_NearZeroWeight`     | A deposit one second before `tEnd` earns approximately zero weight.                                                              |
| `test_TWAB_MultipleChangesWithinWindow`          | Three balance changes accumulate to the analytically correct integral.                                                           |
| `test_TWAB_ThetaChangeMidWindow_SplitsSegment`   | Changing θ halfway produces weight from both θ values, not the later one applied retroactively.                                  |
| `test_TWAB_CheckpointTakenOnFirstTouchAfterTEnd` | A user transacting after `tEnd` gets a checkpoint at exactly `tEnd`, not at their transaction time.                              |
| `test_TWAB_UntouchedUser_CheckpointTakenInSweep` | A user who never transacts is checkpointed correctly by the sweep.                                                               |
| `test_TWAB_WithdrawToZeroMidWindow`              | Weight accrues only for the period actually held.                                                                                |
| `test_TWAB_ConsecutiveDraws_NoDoubleCount`       | Weight from draw N is not counted again in draw N+1.                                                                             |
| `test_TWAB_SkippedDraw_NoInflation`              | A participant present across two draws where the first was voided does not receive doubled weight.                               |

The last three are where checkpoint-rolling bugs hide. Write them before the implementation feels finished.

---

## 4. Statistical fairness

Correctness of the weighting cannot be established by unit tests alone. Odds must be verified empirically, and the
resulting chart belongs in the submission.

`test_WeightedOdds_MonteCarlo`:

1. Construct a pool with known weights, e.g. balances of 1, 2, 4, 8, 16, 32, 64, 128 units all at θ = 4.
2. Run 2,000 draws in mock mode, recording the winner each time.
3. Assert each depositor's empirical win frequency lies within a 99% confidence interval of their theoretical share
   `w_i / Σw`.
4. Run a chi-squared goodness-of-fit test against the expected multinomial distribution; assert _p_ > 0.01.
5. Emit `artifacts/fairness.json` and render a chart of expected versus observed. **Put this chart in the README and
   show it in the video.** It is direct evidence the draw is fair, which is exactly what a confidential lottery has to
   prove and cannot prove by inspection.

Additional statistical checks:

| Test                                        | Asserts                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `test_Odds_ZeroWeight_NeverWins`            | A dust participant with `rangeStart == rangeEnd` never wins across 2,000 draws.            |
| `test_Odds_ThetaZero_NeverWins`             | θ = 0 yields zero weight and therefore zero wins.                                          |
| `test_Odds_ThetaProportional`               | At equal balances, θ = 4 wins approximately four times as often as θ = 1.                  |
| `test_Randomness_ModuloBiasBounded`         | Over many draws, the distribution of `r` shows no detectable bias across the ticket space. |
| `test_Randomness_UnpredictableAcrossBlocks` | `r` handles from consecutive draws are uncorrelated.                                       |

### Fortune (momentum) — see `docs/12` §1

| Test                                          | Asserts                                                                                                                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_Fortune_ResetsOnWin`                    | A win sets fortune to exactly zero; mandatory, high-value (a missed reset is silent unfairness). Maps to P-F6.                                                                                          |
| `test_Fortune_GrowsOnLoss_CapsAtMax`          | Each loss increments fortune by one until `FORTUNE_CAP`, then stops.                                                                                                                                    |
| `test_Fortune_BoostBounded`                   | The boost never exceeds `FORTUNE_CAP * FORTUNE_STEP` nor `boostCeil(w)`, at fortune 0, cap, and beyond. Maps to P-F5, I16.                                                                              |
| `test_Fortune_DustDepositorStaysNearZeroOdds` | A near-zero-balance depositor with maximal fortune still has near-zero effective weight — Fortune never rewards not-saving.                                                                             |
| `test_Fortune_WeightedOdds_MonteCarlo`        | With varied fortune histories, empirical win frequency matches `wEff_i / Σ wEff` within the 99% CI; chi-squared p > 0.01. Replaces the base Monte Carlo. Maps to P-F1'.                                 |
| `test_Fortune_ResetIsBranchFree`              | The fortune update path is identical (same ops, same gas) for a winner and a loser. Maps to P-P7, P-P5.                                                                                                 |
| `test_Fortune_NotGrantedToOthers`             | No ACL grant on any user's fortune to a non-owner address. Maps to P-P7.                                                                                                                                |
| `test_Fortune_AggregateDisclosureBounded`     | Public effective minus base-risk total equals only the reference model's bounded aggregate boost; no per-user Fortune handle/decomposition is public and the anonymity floor is enforced. Maps to P-P7. |
| `test_Fortune_PrizeConservationUnaffected`    | Prize sizing uses base-risk/yield totals, never Fortune-adjusted tickets; Fortune changes winner odds but not funded prize/direct allocation. Maps to P-S2, P-S3.                                       |

---

## 5. Privacy invariants

These enforce invariants I3–I5. Failures here are worse than functional bugs — they defeat the product.

| Test                                                   | Method                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_Privacy_NoEventCarriesAnAmount`                  | Parse every event ABI in the deployed contracts; assert none has a field that is a plaintext amount, and that only `Exited` carries a public figure. Make this a static check so it fails when a future event adds one.                   |
| `test_Privacy_BalanceNotPubliclyDecryptable`           | Attempt public decryption of a balance handle; expect failure.                                                                                                                                                                            |
| `test_Privacy_TicketRangeNotGrantedToUser`             | Assert no ACL grant exists on `rangeStart`/`rangeEnd` for any user address.                                                                                                                                                               |
| `test_Privacy_ThetaNotReadableByOthers`                | Attempt decryption of another user's θ; expect failure.                                                                                                                                                                                   |
| `test_Privacy_PrizeCreditGrantedUniformly`             | After a draw, assert **every** participant has exactly one grant on their own credit handle, and the number of grants is independent of who won. This is the automated defence against trap T1.                                           |
| `test_Privacy_WinnerNotDerivableFromLogs`              | Given the full event log and no private keys, assert no field differs between the winner and any loser. Implement as a diff over per-user log slices.                                                                                     |
| `test_Privacy_OwnerCannotDecryptUserValues`            | The deployer attempts decryption of a user balance; expect failure.                                                                                                                                                                       |
| `test_Privacy_NumericAccountingNotPubliclyDecryptable` | Attempt public decryption of numeric aggregate principal, liability and custody-asset handles; expect failure. The allowlist contains only effective-ticket, base-risk, yield-weight, settled-randomness and checkpoint-solvency handles. |

`test_Privacy_PrizeCreditGrantedUniformly` and `test_Privacy_WinnerNotDerivableFromLogs` are the two highest-value tests
in the entire suite. They mechanise the argument the submission is making.

---

## 6. Liveness and accounting invariants

| Test                                                      | Asserts                                                                                                                                                                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_Withdraw_MidCrank_NotBlocked`                       | Withdrawal succeeds during `SWEEP_A` and during `SWEEP_B`. Trap T2.                                                                                                                                                                                 |
| `test_Withdraw_OracleDown`                                | With the decryption path stubbed to fail, `emergencyWithdraw` still returns principal. Invariant I9.                                                                                                                                                |
| `test_Withdraw_AfterAbort`                                | Following `abortDraw`, all principal is recoverable and accumulators are consistent.                                                                                                                                                                |
| `test_Deposit_DuringEveryState`                           | Loop over every draw state; deposit succeeds in each.                                                                                                                                                                                               |
| `test_Accounting_NeverLosesPrincipal`                     | Fuzz sequences of deposit/withdraw/θ/draw; assert every user can always recover at least their net deposits. Invariant I1.                                                                                                                          |
| `test_Accounting_DepositUsesTransferredHandle`            | User balance/principal and encrypted aggregate liability/principal all increase by the same ERC-7984 `moved` handle across full, clamped, zero and reentrant transfers.                                                                             |
| `test_Accounting_WithdrawalCapsPrincipalDebit`            | The transfer is capped to `min(requested, balance)`; claimable balance/liability decrease by `moved`; user/aggregate principal decrease only by `min(moved, principalBalance)`, including over-request, earnings-only and full-balance withdrawals. |
| `test_Accounting_LiabilityConservation`                   | `sum(balance) == totalLiability`, `sum(principalBalance) == totalPrincipal`, and `assets >= liabilities >= principal` across deposits, funded credits, withdrawals and adapter moves.                                                               |
| `test_Accounting_PrizeConservation`                       | Sum of encrypted winner credits equals `prizeAmount`; prize plus draw-scoped direct credits never exceed realised yield after every fixed-point rounding boundary.                                                                                  |
| `test_Accounting_DirectYieldUsesExactDrawSnapshot`        | Two or more harvests with inactive users cannot apply an earlier draw's rate to later weight; each `(drawId, participant)` direct weight is consumed at most once.                                                                                  |
| `test_Accounting_DefaultThetaAllocatesAllYieldToPrize`    | At theta 4, normalized risk/yield weights are exactly equal, direct credits are zero and `prizeAmount == realisedYield`, including scale-boundary values.                                                                                           |
| `test_Accounting_ZeroRiskStillCreditsDirectYield`         | With `W > 0` and `T == 0`, no randomness/modulo path executes, no prize is issued, and PASS B credits only the bounded direct-yield shares.                                                                                                         |
| `test_SolvencyCheckpoint_RejectsForgedOrRiskStaleProof`   | False-as-true, forged, malformed, wrong-handle, changed-risk-epoch and duplicate-nonce submissions cannot set `lastSolventRiskEpoch` or authorize a risk transition.                                                                                |
| `test_SolvencyCheckpoint_SafeVersionAdvanceDoesNotStale`  | Deposit/withdraw/funded-credit/lossless-custody changes after checkpoint opening advance `accountingVersion` but not `riskEpoch`; the exact-handle proof remains valid and post-`tEnd` actions cannot stall settlement.                             |
| `test_SolvencyCheckpoint_OracleDownBlocksRiskNotRecovery` | With public decryption permanently unavailable, draw/adapter risk transitions remain blocked while deposit, withdraw, exit and emergency withdrawal remain callable.                                                                                |
| `test_AdapterSwap_RequiresCurrentSolventRiskEpoch`        | Activation is IDLE-only, timelocked and requires `lastSolventRiskEpoch == riskEpoch`; activation increments `riskEpoch`, retains new deposits in the vault until reverified, and full-balance return precedes retiring-adapter removal.             |
| `test_Accounting_ZeroParticipants_DrawVoids`              | An empty pool voids cleanly with no division by zero.                                                                                                                                                                                               |
| `test_Accounting_AllDustWeights_DrawVoids`                | `totalTickets == 0` voids cleanly and rolls yield forward.                                                                                                                                                                                          |
| `test_Accounting_SingleParticipant_AlwaysWins`            | With one participant, they win every draw.                                                                                                                                                                                                          |
| `test_Crank_OversizedBatchReverts`                        | `batch > BATCH_MAX` reverts with a clear error rather than an opaque HCU failure.                                                                                                                                                                   |
| `test_Crank_IdempotentAtCursor`                           | Calling a crank twice in the same block does not double-credit or skip.                                                                                                                                                                             |
| `test_Crank_Permissionless`                               | An arbitrary address can advance every stage.                                                                                                                                                                                                       |

---

## 7. Overflow tests

Invariant I10. FHE does not revert on overflow, so these tests must assert on _values_, never on reverts.

| Test                                             | Asserts                                                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_Overflow_RateSaturatesAtCap`               | A balance above the supported range saturates `rate` at `RATE_CAP` and leaves principal untouched.                                                       |
| `test_Overflow_AccumulatorMaxBalanceMaxPeriod`   | Maximum supported balance held for the full window produces an accumulator matching the derivation in `docs/02-architecture.md` §4, not a wrapped value. |
| `test_Overflow_AccumulatorAcross1000Draws`       | Simulated long-run accumulation stays within `euint128`.                                                                                                 |
| `test_Overflow_TicketScaleDownPreservesOrdering` | After the right shift, the ordering of weights is preserved for representative magnitudes.                                                               |
| `test_Precision_DustFloor`                       | A position of one dollar-hour yields exactly one ticket unit; smaller yields zero. This documents the disclosed precision floor as behaviour.            |
| `test_Overflow_PrefixSumTenThousandParticipants` | The `euint64` prefix sum accommodates 10,000 participants at maximum weight.                                                                             |

---

## 8. Integration tests on Sepolia

Run manually, not in CI — they consume real relayer quota and are slow.

| Test                     | Purpose                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e_FullLifecycle`      | Shield → deposit → set θ → advance → full draw → decrypt credit → withdraw.                                                                   |
| `e2e_HCUBenchmark`       | Feeds `docs/BENCHMARK.md`; see `docs/04-hcu-budget.md` §5.                                                                                    |
| `e2e_DecryptionLatency`  | Records p50 and p95 relayer latency. Feeds the frontend timeout constants — do not guess them.                                                |
| `e2e_VerifyDrawScript`   | Runs `scripts/verify-draw.ts` against a real settled draw and asserts PASS.                                                                   |
| `e2e_ConcurrentCranks`   | Two keepers cranking simultaneously do not corrupt the cursor.                                                                                |
| `e2e_SolvencyCheckpoint` | Opens a real aggregate boolean checkpoint, publicly decrypts it, verifies the proof on-chain, and rejects forged/stale/wrong-handle variants. |

---

## 9. Adversarial cases — assume a reviewer tries these

| Attack                                                         | Expected behaviour                                                                                                                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deposit immediately before `tEnd`, withdraw immediately after  | Near-zero ticket weight. eTWAB defeats it.                                                                                                                                           |
| Split one large balance across many addresses                  | No advantage: weight is linear in balance, so `N` addresses of `B/N` equal one of `B`. State this in the README — reviewers ask about Sybil resistance, and linearity is the answer. |
| Set θ = 4 in the final second of the window                    | θ applies only from the moment of change; the segment split ensures earlier time is weighted at the old θ.                                                                           |
| Grind the transaction that generates randomness                | Blind. `r` is encrypted at creation and unreadable by anyone, so there is no observable outcome to bias toward. `MIN_SETTLE_DELAY` removes the theoretical residue.                  |
| Call `crankB` before `crankA` completes                        | State machine rejects it.                                                                                                                                                            |
| Submit forged effective/base/yield totals to `submitTotals`    | On-chain proof verification rejects any mismatch against the ordered committed handles; accepting one could rig the winner or over-credit liabilities.                               |
| Re-enter through the ERC-7984 operator callback during deposit | Sync-first ordering plus a reentrancy guard. Test with a malicious token mock.                                                                                                       |
| Front-run another user's reveal to learn their balance         | Impossible: decryption is re-encrypted to the requester's ephemeral key.                                                                                                             |
| Deposit, then abandon the position forever                     | The address stays in `participants` with residual weight; sweeps still cost HCU. Documented as a scaling cost, mitigated by `exit()`.                                                |
| Spam `openDraw` / `abortDraw`                                  | Guarded by state and deadlines; assert no funds are affected.                                                                                                                        |

---

## 10. Definition of done

A feature ships when:

1. Unit tests pass in mock mode, including the adversarial case for that feature.
2. Its relevant invariant test exists and passes.
3. Any new encrypted arithmetic has a written bound derivation and a boundary test.
4. Any new event has been checked against `test_Privacy_NoEventCarriesAnAmount`.
5. Any new user-visible path that can partially apply returns an encrypted status handled per `docs/06-frontend-spec.md`
   §5.
6. Coverage on `contracts/` is above 90% for lines and above 80% for branches. Coverage is a floor, not a goal — the
   invariant and statistical tests carry the real assurance.

### Task 11 execution record (2026-08-10)

- `test/reference/sync-reference.ts` and `test/reference/draw-reference.ts` are pure TypeScript mathematical oracles;
  neither imports a contract implementation.
- Differential mock tests replay 8 deterministic `_syncUser` vectors and 4 deterministic draw vectors against decrypted
  production outputs. The vectors cover exact `tEnd`, balance/theta mutations, dust, zero risk/tickets, varied risk,
  Fortune cap/split rounding, interval construction, prize allocation and direct credits.
- A mismatch records the first seed and actual/expected values under `artifacts/differential/` before throwing. No
  divergence was observed in this run.
- Full mock result: 96 passing, one Sepolia-only test pending. Coverage: 98.62% lines and 81.50% branches; no critical
  accounting or draw contract is excluded.
- Evidence: `artifacts/differential/summary.json` and `artifacts/differential/coverage-summary.json`.
- Closure status: `APPROVED SAME-CONTEXT OWNER EXCEPTION` on 2026-08-10. The required two independent verification
  contexts were waived, not performed, so this evidence must not be described as independently reviewed. Sepolia
  execution remains in Tasks 14-15.

### Task 12 execution record (2026-08-11)

- `scripts/run-fairness.ts` ran four fixed-seed scenarios of 1,000,000 draws each: two P-F1 scenarios without Fortune
  and two P-F1' scenarios with varied Fortune histories. Inputs cover geometric balances, varied theta and active
  windows, a zero-weight position, and a split-principal Fortune case.
- Every positive-weight participant is inside a two-sided Bonferroni simultaneous 99% family-wise prediction interval.
  Pearson chi-squared p-values are `0.7339558786`, `0.4152087983`, `0.0796319075`, and `0.5405492683`, all above the
  frozen `0.01` threshold. P-F1 and P-F1' each have 2,000,000 draws.
- The initial individual-interval interpretation placed one participant outside its interval while the global
  chi-squared test passed. The failure was investigated without changing any seed. The test was corrected to make the
  stated 99% guarantee simultaneous across all participants; the same seeds and draw counts then passed.
- The zero-weight participant never wins. Aggregate Fortune boost for four split positions is `4504`, versus `4506` for
  the equivalent unsplit position and a permitted rounding margin of `3`.
- `artifacts/fairness.json` records complete inputs, seeds, expected and observed counts, intervals, chi-squared values,
  and exact modulo-bound terms. `artifacts/fairness.png` is the rendered 1600x1200 evidence chart.
- `docs/proofs/modulo-bound.md` proves P-F2. Raw `FHE.rand` uniformity is documented, not re-proven, as the P-F4 Zama
  platform trust boundary.
- Closure status: `APPROVED SAME-CONTEXT OWNER EXCEPTION` on 2026-08-11. The required independent statistical review was
  waived, not performed, so this evidence must not be described as independently reviewed.

### Task 13 execution record (2026-08-11)

- The owner explicitly approved a P-P8 re-review adding the fully-settled draw-scoped `cumPrizeCredits` aggregate to the
  public-decryption allowlist. I4 and P-P8 were updated, proposition count remains 42, and section 3 was re-frozen.
- `scripts/privacy-scan.ts` composes current per-source Hardhat AST build-info and deployed ABI candidates. The final
  report records 6 allowlisted public-decryption calls, 59 ACL call sites across `allow`, `allowThis` and
  `allowTransient`, 54 event fields and 41 role-gated functions, with zero violations and zero winner-only ABI/event
  candidates. The full-PASS-B settlement guard and all three anonymity-floor masks are checked explicitly.
- The initial ACL test reproduced two persistent grants on every prize-credit handle. The duplicate grant in
  `LokVault.creditDraw` was removed; each participant now receives exactly one grant on their own prize handle.
- Winner and loser `crankB(1)` transactions have identical credited-event, opaque-log and application call-boundary
  shapes after normalizing public participant identity and opaque ciphertext handles. Depth-3 mock-host internals are
  excluded from the application trace comparison and documented in the evidence.
- Matched non-first/non-final winner and loser calls both measured 722,888 gas, 4,025,320 global HCU and 3,032,096
  maximum HCU depth. The fixed gas threshold is 1%; observed outcome-controlled delta is zero. The first crank's
  public-position storage transition measured 735,682 gas and is not treated as an outcome channel.
- Red-team channels for checkpoint timing, participant churn, handle mutation timing, relayer request shape, Fortune
  reset, revert differences and frontend telemetry were reviewed. New S9 documents the post-settlement aggregate
  prize-credit consistency signal. P-P9's ABI half passes; its UX/telemetry half is `NOT_TESTABLE` because `web/` does
  not yet exist.
- Evidence: `artifacts/privacy-report.json` plus the three fragments under `artifacts/privacy/`. Full regression: 109
  Hardhat tests passing, one Sepolia-only pending; 21 Foundry tests passing.
- Closure status: `APPROVED SAME-CONTEXT OWNER EXCEPTION` on 2026-08-11. Independent privacy review was waived, not
  performed, and P-P9 frontend human review remains pending.
