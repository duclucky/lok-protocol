# P-S2 / P-S3 Owner-Delegated AI Proof Review

**Review protocol:** `docs/proofs/PROOF-REVIEWER-MASTER-PROMPT.md`  
**Reviewer:** Codex AI proof reviewer (owner-delegated, same-context, non-human, non-independent)  
**Date:** 2026-08-10

## Findings And Remediation

### Remediated - P-S3 invariant evidence could pass after prize-credit conservation was broken

`LokFairnessInvariantTest` exercises `settleDraw`, but its P-S3 assertion compares `totalPrizeCredited` with
`totalPrizeSettled`. `LokDrawReference.settle` increments those two counters from the same `prize` value on adjacent
lines, so this assertion does not independently establish the frozen claim about the sum of per-user credits.

`LokSafetyInvariantTest` does assert `sumPrizeCredits() == totalPrizeCredited()`, but its target selector set omits
`settleDraw`. Both sides therefore remain zero in that campaign. A concrete mutation counterexample is to remove the
write to `prizeCredit[winner]` while retaining the two aggregate-counter increments: the current safety and fairness
campaign assertions can still pass even though P-S3 is false.

Remediation completed after owner approval:

1. Added `sumPrizeCredits() == totalPrizeCredited()` to `LokFairnessInvariantTest` so the assertion runs after non-zero
   settlement transitions.
2. Reran the required >=10^7-sequence fairness campaign and replaced its durable report: 10,000,004 sequences,
   320,000,128 calls, 63,999,795 `settleDraw` calls, 0 reverts and 28/28 zero exit codes.
3. Independently recomputed sequence/call totals and unique seeds from the generated JSON and shard logs.

This is a proof-evidence correction, not a change to frozen section 3.

## P-S2 Pass-Criterion Matrix

| Obligation                                                 | Evidence                                                         | Review result |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------- |
| `assets >= liabilities >= principal`                       | Safety reference invariant, 10,000,004 recorded sequences        | PASS          |
| User sums equal encrypted aggregate witnesses              | Safety reference invariant                                       | PASS          |
| Deposit/withdraw use actual `moved` semantics              | Hardhat mock tests and recorded Sepolia ERC-7984 probe           | PASS          |
| Funded allocation cannot exceed realised yield             | General hand inequality plus Foundry rounding-boundary fuzz test | PASS          |
| Safe same-epoch transitions preserve checkpoint truth      | Hand transition proof plus checkpoint negative tests             | PASS          |
| Risk transitions require valid current-epoch authorization | Reference invariant and Hardhat authorization tests              | PASS          |
| Full Lok lifecycle on Sepolia                              | Deferred to Tasks 14-15 by the approved delivery plan            | RESIDUAL      |

The safety campaign models draw funding compositionally: `directCredit` ranges over an arbitrary amount bounded by
available funded yield, while the separate closed-form/fuzz obligation proves that production prize plus direct credits
meet that precondition. This abstraction should be stated explicitly in the hand proof, but it does not falsify the
inductive argument.

## P-S3 Pass-Criterion Matrix

| Obligation                                                                | Evidence                                                                              | Review result |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------- |
| Exact half-open partition selects one winner                              | Hand proof, P-F7 fuzz/boundary and production tests                                   | PASS          |
| PASS B processes each snapshot index exactly once                         | Hand proof and bounded production tests                                               | PASS          |
| Sum of per-user prize credits equals `prizeAmount` for every settled draw | Fairness invariant now checks the per-user sum after settlement; 10,000,004 sequences | PASS          |
| Production differential vectors                                           | Four deterministic vectors, no divergence                                             | SUPPORTING    |

## Fresh Verification

- Relevant Hardhat suites: 18 passing, 0 failing.
- Pre-campaign regression: 10,000 sequences, 320,000 calls, including 63,512 `settleDraw` calls, 0 reverts.
- Fresh Foundry safety run: 10,000 sequences, 320,000 calls, 0 reverts; selector table confirms `settleDraw` is absent.
- Remediated fairness campaign: 10,000,004 sequences, 320,000,128 calls, 63,999,795 `settleDraw` calls, 0 reverts, 28
  deterministic unique seeds and 28/28 zero exit codes.
- Preserved safety campaign: 10,000,004 sequences, 320,000,128 calls and 0 reverts.

## Assumptions And Residual Obligations

- The proof assumes standard ERC-7984 returned-amount semantics and lossless supported adapter custody operations.
- Yield-venue loss is outside the frozen guarantee and must remain disclosed.
- Full Sepolia Lok lifecycle and HCU evidence remain Tasks 14-15; mock evidence is not Sepolia evidence.
- This review is same-context and cannot satisfy the repository's independent-team rule without the owner's recorded
  exception. It is not a human sign-off.

## Verdicts

```text
P-S2: APPROVED_WITH_RESIDUAL_OBLIGATIONS
P-S3: APPROVED_WITH_RESIDUAL_OBLIGATIONS
```

The owner-delegated same-context AI proof review accepts both local Tier-A arguments. Full Sepolia lifecycle evidence
and human or genuinely independent review remain residual obligations.
