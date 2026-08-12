# Near-Instant Draw Timing Design

**Status:** Approved by the human on 2026-08-12.  
**Scope:** Replace Lok's fixed seven-day draw timing with an immutable, Sepolia-optimized timing profile.  
**Change control:** This document does not edit or unfreeze `docs/10-proof-strategy.md` section 3.

## 1. Objective

Remove the seven-day wait from the Lok demonstration while preserving the reviewed draw state machine, exact `tEnd`
fairness snapshot, encrypted randomness, public-decryption proof flow, pagination, withdrawal liveness and outcome
integrity.

The target is the shortest robust end-to-end draw supported by Zama FHEVM and observed Sepolia behavior. "Near instant"
means that no multi-day product timer remains. It does not mean same-block settlement or one-transaction winner
selection.

## 2. Technical Basis

Zama does not impose a minimum prize-draw period. The relevant protocol constraints are:

- `FHE.randEuint64()` mutates encrypted PRNG state and must execute in a transaction.
- Public decryption is asynchronous across the Relayer, Gateway and threshold KMS.
- Each transaction is bounded by 20,000,000 total HCU and 5,000,000 HCU depth on the reviewed deployment.
- Lok's measured 60%-of-maximum caps remain `preSync = 4`, PASS A `= 3`, and PASS B `= 2` participants per transaction.

Lok's 2026-08-12 Sepolia measurements provide the operational baseline:

| Signal                                         |                                     Observation |
| ---------------------------------------------- | ----------------------------------------------: |
| Recent Sepolia block interval, 63-block sample |             average 12.57 s; p50 12 s; max 24 s |
| Public decryption                              |                        p50 2.665 s; p95 4.064 s |
| User decryption                                |                        p50 2.759 s; p95 3.170 s |
| 30-participant pagination                      | 8 pre-sync + 10 PASS A + 15 PASS B transactions |

The transaction count, not the draw timer, becomes the main latency after this change.

## 3. Timing Profile

The new Sepolia demonstration profile is:

| Parameter          |       Value | Reason                                                                                  |
| ------------------ | ----------: | --------------------------------------------------------------------------------------- |
| `DRAW_PERIOD`      | 120 seconds | Roughly ten Sepolia blocks for a non-zero eTWAB window and strict commitments           |
| `MIN_SETTLE_DELAY` |  30 seconds | Forces settlement into a later block and covers more than two median block intervals    |
| `REVEAL_WINDOW`    | 180 seconds | Roughly fourteen blocks for strict-mode reveal transactions                             |
| `STATE_TIMEOUT`    | 600 seconds | Gives permissionless keepers time to make progress while allowing prompt abort recovery |

The default bounty path remains non-strict. Strict mode remains available and adds its reveal window after PASS A and
aggregate-total verification.

## 4. Configuration Model

The four values become public immutable constructor parameters on `LokDrawManager`. Their existing getter names remain
unchanged so keepers, tests and the frontend continue to read the active deployment rather than duplicating values.

Constructor validation rejects unsafe profiles:

| Constraint         |                                      Bound |
| ------------------ | -----------------------------------------: |
| `DRAW_PERIOD`      | 60 seconds minimum; `2^20` seconds maximum |
| `MIN_SETTLE_DELAY` |                         24 seconds minimum |
| `REVEAL_WINDOW`    |                        120 seconds minimum |
| `STATE_TIMEOUT`    |                        300 seconds minimum |

The `2^20`-second draw-period ceiling preserves the existing encrypted accumulator derivation. The lower bounds avoid
same-block or operationally meaningless windows. No owner, guardian, keeper or user can change timing after deployment.
No function can bypass `tEnd`, close a draw early or generate randomness before its mode-specific timing condition.

## 5. State-Machine Behavior

The state graph and authorization model do not change:

1. `openDraw` snapshots the participant count and records `tStart` and `tEnd = tStart + DRAW_PERIOD`.
2. User deposit, withdrawal, exit, theta and emergency-withdrawal paths remain available according to the frozen
   invariants throughout the draw.
3. At and after `tEnd`, pre-sync freezes each participant's weight at exactly `tEnd`.
4. PASS A cannot begin before `tEnd + MIN_SETTLE_DELAY`.
5. Non-strict mode generates encrypted randomness only after valid aggregate totals are submitted.
6. Strict mode enters `REVEAL`; randomness is disabled until `revealDeadline` closes and `revealAcc` is immutable.
7. PASS B credits every participant uniformly and settles only after the full participant snapshot is processed.
8. Timeout and abort paths remain permissionless and cannot block principal recovery.

## 6. Expected Latency

For the required 30-participant demonstration:

- Timer before settlement can begin: approximately 2 minutes 30 seconds.
- Sequential pagination and proof transactions: approximately 6 to 10 minutes under observed Sepolia conditions.
- Expected non-strict result: approximately 8 to 13 minutes after opening the draw.
- Strict mode: up to 3 additional minutes for reveals.

These are measured operational targets, not consensus guarantees. Congestion, RPC delays or Relayer/KMS availability can
increase them. The frontend must show the current phase, cursor progress and retryable pending state rather than promise
a fixed completion timestamp.

## 7. Proof And Test Impact

The frozen proposition count remains 42. No proposition statement needs editing because the relevant obligations are
parameterized by `tEnd`, deadlines and reachable transitions rather than a seven-day literal.

Before Solidity changes, the proof worker must:

1. Review P-S6/P-S9 overflow derivations under the configurable upper bound.
2. Re-run every TLA+ model configuration with the shortened relative timing constants.
3. Confirm P-L1 through P-L7, P-F3, P-F10, P-A4, P-A7, P-A8 and P-O1 remain satisfied.
4. Confirm the model cannot generate randomness before strict reveal closure or process post-`tEnd` user state into the
   active draw.

Implementation acceptance then requires:

- Constructor boundary tests for every lower and upper timing bound.
- `tEnd - 1`, `tEnd`, and `tEnd + 1` eTWAB boundary tests using the new profile.
- Non-strict and strict complete-draw tests with the new timing values.
- Oracle-down, stalled-keeper, abort, pause and withdrawal-in-every-state regressions.
- Full invariant, fairness, privacy and outcome-integrity suites.
- A fresh Sepolia HCU regression run; timing changes must not alter per-participant encrypted computation.

Any counterexample or HCU drift greater than 50% stops deployment and triggers explicit design re-review.

### Approved precision correction

The human approved changing `TICKET_SCALE_BITS` from 32 to 26 on 2026-08-12 after the 120-second tests exposed that the
old scale made deposits below approximately 35.8 USDC all-dust. With scale 26, the non-dust threshold is approximately
0.559241 USDC. The revised overflow derivation proves `W,B < 2^58`, the pre-division Fortune product is below `2^64`,
and the Fortune-adjusted prefix is below `2^59`. This correction changes normalization precision only; it does not edit
or unfreeze any proposition in `docs/10-proof-strategy.md` section 3.

## 8. Deployment Migration

The live draw cannot be shortened: its `tEnd` was fixed when draw 1 opened. `LokVault.setDrawManager` is one-time, so a
new draw manager cannot safely replace the existing binding. The new profile therefore requires a full Sepolia stack
redeployment.

Migration steps are:

1. Preserve the current deployment manifest and draw-1 evidence as historical artifacts.
2. Deploy and verify a new token, adapter, vault and draw manager with the reviewed timing profile.
3. Bind the new topology, open and submit the initial solvency checkpoint, and seed 30 participants.
4. Fund realized demo yield and run at least one complete non-strict draw through the public verifier.
5. Run one strict-mode timing acceptance path or explicitly retain strict settlement evidence from Sepolia integration
   tests if a full public strict draw is operationally unnecessary for submission.
6. Update the canonical manifest, frontend configuration, README, Etherscan links, deployment evidence and automation.
7. Retire the old Task 18 waiting automation only after the new deployment has a verified settled draw.

No funds are migrated automatically. The current deployment uses mock demonstration assets, and its principal recovery
paths remain available.

## 9. Scope Guard

This change does not add an instant-draw admin button, dynamic governance, a second pool, a relayer for Lok accounting,
multichain deployment, a production yield adapter or any winner-only action. Production cadence selection remains a
future deployment decision using the same immutable constructor surface; it is not runtime governance.

## 10. Acceptance Decision

The change is accepted only when all proof and test gates pass, a new Sepolia deployment is source-verified, a real
30-participant draw settles and `verify-draw.ts` passes. Until then, the current seven-day deployment remains the last
verified release and Task 19 remains open.
