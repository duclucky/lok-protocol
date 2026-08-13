# Minimum Safe Draw Timing Design

**Status:** Approved in principle by the human on 2026-08-13; written-spec review pending.  
**Supersedes:** The Sepolia timing profile in `2026-08-12-near-instant-draw-timing-design.md`.  
**Change control:** This design does not edit or unfreeze `docs/10-proof-strategy.md` section 3.

## 1. Objective

Reduce every routine draw timer to the minimum already accepted by the production constructor while preserving Lok's
FHEVM sequencing, fairness snapshot, strict-mode randomness, permissionless recovery and principal-withdrawal
guarantees. No user withdrawal lock, winner claim delay or new runtime governance is introduced.

## 2. Final Timing Profile

The final Ethereum Sepolia deployment uses:

| Parameter          | Old value | Final value | Decision basis                                                               |
| ------------------ | --------: | ----------: | ---------------------------------------------------------------------------- |
| `DRAW_PERIOD`      |      120 s |        60 s | Existing constructor floor; retains a non-zero eTWAB and commitment window.  |
| `MIN_SETTLE_DELAY` |       30 s |        24 s | Existing constructor floor; retains a later-block settlement boundary.       |
| `REVEAL_WINDOW`    |      180 s |       120 s | Existing strict-mode floor; normal mode does not enter the reveal phase.     |
| `STATE_TIMEOUT`    |      600 s |       300 s | Existing recovery floor; affects stalled paths, not successful draw latency. |

`ADAPTER_DELAY` remains 24 hours. It applies only to an owner adapter replacement, not to draws, deposits,
withdrawals, emergency withdrawals or exits. It remains unchanged because it provides a user reaction window against
a compromised owner key or malicious replacement adapter and is required by frozen P-A4/P-A8.

## 3. Preserved Behavior

- The default bounty path remains non-strict and therefore incurs no reveal-window wait.
- `tEnd` remains exact and immutable for a draw; post-`tEnd` actions cannot alter its participant snapshot or weights.
- PASS A remains disabled until `tEnd + MIN_SETTLE_DELAY`.
- Strict-mode randomness remains disabled until the reveal deadline closes and `revealAcc` is immutable.
- `STATE_TIMEOUT` remains a failure-recovery deadline. It does not delay a healthy state transition.
- Deposit, withdraw, exit, set-theta and emergency-withdrawal behavior is unchanged.
- Public decryption remains asynchronous through the Zama Gateway/KMS; Lok adds no fixed wait after a valid proof is
  available.

## 4. Implementation Scope

No Solidity algorithm changes are required. `LokDrawManager` already accepts all four values as immutable constructor
arguments and enforces the selected floors.

Implementation changes are limited to:

1. Change the reviewed Sepolia timing constants in `scripts/deploy.ts`.
2. Update draw fixtures and deployment-manifest tests to the final profile.
3. Replace the P-S2 Group A executor's hard-coded 30-second settle wait with the deployed
   `MIN_SETTLE_DELAY` getter.
4. Update non-frozen architecture, contract-spec, README and deployment documentation that states the old profile.
5. Generate a new Sepolia deployment manifest and update frontend contract addresses after deployment.

The old deployment and its evidence remain immutable historical artifacts. The new profile requires a clean stack
because draw timing is immutable, `LokVault.drawManager` is one-time-bound and each adapter is one-time-bound to its
vault.

## 5. Verification Scope

Before deployment:

- TypeScript compile, lint and formatting checks pass.
- Constructor-floor rejection tests and accepted-profile assertions pass.
- Draw state, `tEnd - 1`/`tEnd`/`tEnd + 1`, strict reveal, timeout/abort and withdrawal-in-every-state tests pass.
- The full local regression suite passes.
- Frozen `docs/10-proof-strategy.md` section 3 has zero diff.

After deployment:

- Runtime bytecode, constructor arguments, topology, owner and timing getters match the new manifest.
- Etherscan source verification succeeds.
- Initial aggregate solvency checkpoint succeeds.
- A fresh non-strict Sepolia draw settles and its public verification artifact passes.
- P-S2 Group A is rerun against the final shared deployment because it covers the timing-sensitive draw integration.
- Existing Group B evidence remains reusable only if independent review confirms that neither `LokVault` nor adapter
  executable logic changed.

## 6. Execution Order

1. Complete the already-started P-S2 Group B disposable lifecycle through D39 using its committed evidence basis.
2. Commit the timing-profile implementation and local verification evidence.
3. Deploy and verify the new Sepolia stack.
4. Run final-deployment integration and P-S2 Group A evidence.
5. Update the frontend deployment configuration and publish the verified build.
6. Hand the final artifacts to the independent reviewer; do not self-promote P-S2 to `MATCHES`.

This order prevents the in-progress Group B preflight from being invalidated by changes under `test/**` and ensures its
test custody is recovered before the repository advances to the final deployment profile.

## 7. Scope Guard

This change does not remove the adapter timelock, weaken P-F10, add an instant-draw owner control, change batch caps,
alter confidential accounting, introduce a winner claim, add a relayer for Lok accounting or change the Sepolia-only
scope. Any request to remove `ADAPTER_DELAY` requires a separate explicit P-A4/P-A8 re-review.

