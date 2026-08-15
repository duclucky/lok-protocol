# P-P1 Gas Signal Diagnosis - 2026-08-15

- **Current status:** `HISTORICAL_SUPERSEDED`
- **Superseded by:** `docs/proofs/P-P1-refreeze-2026-08-15.md`
- **Use:** diagnosis of the forced-winner gas signal; not the current P-P1 verdict.

## Scope

This is a diagnostic note for the failed P-P1 forced-winner re-review campaign. It did not edit
`docs/10-proof-strategy.md` section 3 and did not claim P-P1 `MATCHES` at generation time.

P-P1 was later re-frozen under the non-derivability criterion in `docs/proofs/P-P1-refreeze-2026-08-15.md`.

## Inputs

- Campaign artifact root: `artifacts/privacy/p-p1-re-review`
- Full transcript file: `artifacts/privacy/p-p1-re-review/hardhat-transcripts.json`
- Classifier metrics: `artifacts/privacy/p-p1-re-review/classifier-metrics.json`
- Analyzer: `scripts/analyze-p-p1-gas-signal.ts`
- Contract paths inspected:
  - `contracts/LokDrawManager.sol`
  - `contracts/LokVault.sol`
- Forced-winner helper inspected:
  - `test/draw/forced-random.ts`
  - `contracts/test/ForcedEncryptedValueFactory.sol`

## Finding

The full real Hardhat/FHEVM campaign failed only in the `acl-emitter-call-boundary` observer:

| Observer | Correct / 500 | Gate | Status |
| --- | ---: | ---: | --- |
| `sequence-shape` | 100 | <= 102 | PASS |
| `byte-ngram` | 30 | <= 102 | PASS |
| `acl-emitter-call-boundary` | 126 | <= 102 | FAIL |

The added gas-signal analyzer shows that the failing signal is gas-specific:

| Observer variant | Correct / 500 | Wilson upper 99% | Permutation p-value | Status |
| --- | ---: | ---: | ---: | --- |
| `acl-with-gas` | 126 | 0.2996605140982 | 0.002 | FAIL |
| `gas-only` | 294 | 0.6379982422825891 | 0.001 | FAIL |
| `acl-no-gas` | 6 | 0.029645516497945036 | 1 | PASS |

The strongest isolated receipt signals are:

| Receipt | Step | Correct / 500 | Accuracy | Wilson upper 99% | p-value |
| ---: | --- | ---: | ---: | ---: | ---: |
| 11 | `crankB-4` | 299 | 0.598 | 0.6476973987218422 | 0.001 |
| 7 | `crankB-0` | 200 | 0.4 | 0.4517762120037369 | 0.001 |

Representative gas distributions from the analyzer:

- `crankB-0`
  - winner 0: `733682`
  - winners 1-4: `735682`
  - overall gas delta: 27 bps
- `crankB-4`
  - winner 0: `806303`
  - winners 1-3: `806609`
  - winner 4: mostly `786709`
  - overall gas delta: 246 bps

The non-gas ACL/emitter/call-boundary features pass, and log class/count/order signals are not the
source of the failure.

## Solidity Path Inspection

`LokDrawManager.crankB` has a public cursor/finalization branch:

- it loops over `cursor..end`;
- updates `cursor`;
- calls `_completePassB` only when `end == participantSnapshot`.

That branch is public-position dependent, not winner dependent.

`LokDrawManager._processPassB` computes the winner using encrypted operations and does not branch on the
encrypted winner result:

- `win = FHE.and(FHE.le(...), FHE.lt(...))`
- `userPrize = FHE.select(win, prizeAmount, 0)`
- ACL grants are executed uniformly for every processed participant.

`LokVault.creditDraw` also avoids a plaintext winner branch:

- it updates encrypted balances/liabilities;
- resets or increments Fortune through `FHE.select(win, 0, incremented)`;
- persists the same accounting path for every participant.

No production Solidity branch was found that directly depends on the encrypted winner bit, winner index,
or per-user ciphertext value.

## Forced-Winner Harness Inspection

The current counterfactual harness does not use the production `openRandom` result as-is. It creates
test-only handles with `ForcedEncryptedValueFactory.makeFor(draw, value)` and then writes a selected
handle directly into `Draw.r` through:

```text
hardhat_setStorageAt(draw, randomStorageSlot(drawId), handle)
```

This is a local Hardhat forced-outcome mechanism. Production flow sets `draw.r` only through:

```text
FHE.randEuint64() -> optional revealAcc xor -> FHE.rem(raw, totalTickets)
```

The campaign evidence therefore shows a deterministic gas signal in local forced-winner Hardhat/FHEVM
receipts, but it does not by itself prove that the same signal is production-visible on Sepolia.

## Root-Cause Classification

Classification: **E - cannot tell**.

Rationale:

- Case A, production-visible gas leak, is not proven. The inspected Solidity path has no plaintext branch
  on the winner and uses `FHE.select` for winner-dependent accounting.
- Case B, local FHEVM mock artifact, is consistent with the evidence because the signal appears only in
  gas and the no-gas transcript observer passes.
- Case C, forced-winner harness artifact, is also consistent with the evidence because the counterfactual
  source injects test-only encrypted handles through direct storage writes.
- The current evidence cannot separate B from C, and cannot establish A without additional executor-level
  or Sepolia evidence.
- Case D, classifier/feature bug, is not supported. Gas is an allowed feature under the re-review charter,
  and the classifier is exposing a real gas correlation in the generated transcripts.

## Patch Decision

No production contract patch was applied.

No harness patch was applied in this pass because the forced-winner mechanism is the current source of
counterfactual labels, and replacing it would be a campaign-design change requiring owner/reviewer
approval before another full run.

## Files Changed

- `scripts/analyze-p-p1-gas-signal.ts`
- `docs/proofs/P-P1-gas-signal-diagnosis-2026-08-15.md`

## Commands

Verification commands run for this diagnosis:

| Command | Result |
| --- | --- |
| `npx ts-node scripts/analyze-p-p1-gas-signal.ts` | PASS |
| `npx hardhat test test/privacy/gas-indistinguishability.t.ts` | PASS, 2 passing |
| `npx hardhat test test/privacy/p-p1-re-review-harness.t.ts` | PASS, 4 passing |
| `npx hardhat test test/privacy/log-indistinguishability.t.ts` | PASS, 3 passing, 1 pending |
| `npx tsc --noEmit` | PASS |
| `git diff -- docs/10-proof-strategy.md` | PASS, empty diff |
| `git diff --check` | PASS after restoring verification-regenerated privacy artifacts |

## Current Status

- P-P1 campaign status: `FAILED`
- Frozen P-P1 status: `WEAKER-THAN-CLAIMED`
- Production-visible leak: not proven
- Contract patch: not applied
- Full campaign rerun: not useful until the owner/reviewer approves a new root-cause isolation strategy

## Next Action

Owner/reviewer should choose one of:

1. Treat the current full campaign as failed evidence and keep P-P1 `WEAKER-THAN-CLAIMED`.
2. Authorize a targeted isolation campaign that distinguishes local FHEVM mock gas behavior from
   production-visible gas behavior.
3. Authorize a redesigned counterfactual harness that does not direct-write forced random handles, then
   rerun the full 1,000-execution campaign.
