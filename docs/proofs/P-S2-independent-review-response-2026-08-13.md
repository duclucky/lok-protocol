# P-S2 Independent Review Remediation Response

**Purpose:** document-only response to the five proof gaps reported against baseline
`8531d57db3ad4e62ff26bd53ac818a38040f74fb`. This is not a review verdict or signature.

| Reviewer finding                                                                        | Remediation                                                                                                                                                                                                                                                                                                                                                                                                              | File/line                                                                                                                                                         | Status                                               |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Missing `W=0` and normalized-weight lemmas                                              | Added the exact `Q=2^26` derivation from `ticketDelta_i <= 4*yieldDelta_i` through `baseRisk_i <= yieldWeight_i`, non-underflow, `D=W-B`, and `0<=B<=W`. Split allocation into `W=0` before harvest/division and `W>0` with stepwise fixed-point inequalities, zero subcases, rounding residue, per-user allocation, and exact overflow bounds.                                                                          | `docs/proofs/P-S2-solvency.md`, lines 153-310; reviewer checklist summary in `docs/proofs/P-S2-independent-review-package-2026-08-13.md`, lines 82-94 and 195-205 | REMEDIATED; independent re-review required           |
| Foundry settlement model is weaker than production normalized-`tEnd` path               | Recorded that `LokHandler` snapshots plaintext model balance/theta and `LokDrawReference` omits `_syncUser`, eTWAB, exact-`tEnd`, and production shifts. Limited the campaign claim to generic accounting, cursor composition, funded allocation, and abstraction-level post-snapshot isolation. Mapped production correspondence to the new lemma, Hardhat boundary/differential evidence, and pending Sepolia Group A. | `docs/proofs/P-S2-solvency.md`, lines 385-401; `docs/proofs/P-S2-independent-review-package-2026-08-13.md`, lines 156-179 and 207-215                             | REMEDIATED; abstraction gap remains explicit         |
| Adapter full return was presented as vault-enforced                                     | Distinguished the reference `retiringAdapterAssets==0` removal check from production's external call plus drained flag. Stated the exact lossless full-return postcondition, classified it as the frozen externally trusted supported-adapter behavior, limited local evidence to `MockYieldAdapter`, and retained disposable D28-D33 as pending.                                                                        | `docs/proofs/P-S2-solvency.md`, lines 38-62 and 369-383; `docs/proofs/P-S2-independent-review-package-2026-08-13.md`, lines 126-154 and 217-228                   | REMEDIATED; external postcondition remains disclosed |
| Initial checkpoint/authorization was described incorrectly                              | Split mathematical and authorization base cases. Deployment has `A=L=P=0`, `riskEpoch=1`, and `lastSolventRiskEpoch=0`; risk is initially unauthorized. Listed the exact open/decrypt/submit-true sequence required to authorize epoch 1 while recovery remains callable.                                                                                                                                                | `docs/proofs/P-S2-solvency.md`, lines 64-97; `docs/proofs/P-S2-independent-review-package-2026-08-13.md`, lines 28-61                                             | REMEDIATED; independent re-review required           |
| Foundry forged-checkpoint selector is tautological metadata, not cryptographic evidence | Stated that `submitForgedCheckpoint` submits no proof and establishes only abstract identity/no-mutation behavior. Assigned cryptographic semantics to Hardhat FHE negatives, limited prior Sepolia probes, and still-blocked Group A/B submissions, keeping all three evidence layers separate.                                                                                                                         | `docs/proofs/P-S2-solvency.md`, lines 403-413; `docs/proofs/P-S2-independent-review-package-2026-08-13.md`, lines 181-193                                         | REMEDIATED; fresh Sepolia negatives remain blocked   |

## Cross-Cutting Strengthening

- The cursor proof now derives gap-free, non-overlapping PASS-A and PASS-B coverage from a fixed snapshot, deferred
  removal, positive capped batches, half-open intervals, cursor reset, abort constraints, and draw-scoped storage.
- Accounting-version closure now enumerates every same-risk-epoch transition and explains why snapshot-version equality
  is not required at submit, while risk-boundary changes invalidate old authorization through `riskEpoch`.
- Overflow closure now derives bounds for ERC-7984 supply, `Y*B`, `Y*Q`, `directRate`, `directWide`, per-user total
  credit, and aggregate liability.
- No production contract, test, reference model, TLA+ specification, invariant artifact, execution manifest, or frozen
  proposition was changed.

## Handoff Status

```text
P-S2 hand proof: READY_FOR_INDEPENDENT_RE-REVIEW
Full P-S2: BLOCKED
P-P1: WEAKER-THAN-CLAIMED
```
