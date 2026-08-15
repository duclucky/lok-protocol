# P-P1 Re-freeze Decision - 2026-08-15

## Decision

Owner approval in the audit thread re-froze P-P1 on 2026-08-15.

The prior byte-identical pass criterion is no longer the active criterion. It remains preserved as historical evidence
in:

- `docs/proofs/P-P1-forensic-2026-08-13.md`
- `docs/proofs/P-P1-re-review-evidence-2026-08-15.md`
- `docs/proofs/P-P1-gas-signal-diagnosis-2026-08-15.md`

The new active criterion matches the Zama FHEVM trust boundary: encrypted handles are opaque protocol artifacts, so raw
handle bytes may differ across executions. The privacy obligation is non-derivability from the complete public
transcript, not byte identity of every opaque protocol field.

## Active P-P1 Statement

> Winner is not derivable from the complete public transcript, including application logs, FHEVM Executor/ACL logs, gas
> and public call-boundary data, without a private key. Opaque FHEVM handle bytes may differ across executions, but they
> must not give a pre-registered public observer material advantage over baseline winner guessing.

## Active Pass Criterion

P-P1 passes when all of the following hold:

1. Complete raw transcripts are retained without normalizing, dropping or filtering FHEVM Executor logs, ACL logs,
   topics, data, gas, call boundaries or entry 301 / `FheLe`.
2. Static privacy surface checks find no winner-only application event, ABI path or public-decryption path.
3. P-P2 passes: participant-facing prize-credit ACL grants are uniform across all participants.
4. P-P5 passes: per-participant gas/HCU regression is outcome-independent for the registered crank positions.
5. A natural, non-forced Hardhat/FHEVM campaign of at least 1,000 runs labels the winner only after settlement and shows
   no pre-registered gas/log/call-boundary observer beating the held-out majority baseline with significant permutation
   evidence.

## Evidence Accepted For This Re-freeze

The accepted evidence is the full natural gas campaign:

- Artifact root: `artifacts/privacy/p-p1-natural-gas-experiment/`
- Commit: `524b38b0bd0d78be8766d6b9a9f03b2b6484f56b`
- Runs: 1,000
- Transcript source: `hardhat-fhevm-natural`
- Forced-winner harness: no
- `hardhat_setStorageAt`: no
- Entry 301 / `FheLe`: retained in 1,000 / 1,000 transcripts

Held-out results:

| Observer | Correct | Majority baseline | Status |
| --- | ---: | ---: | --- |
| `gas-only` | 84 / 500 | 107 / 500 | `NO_MATERIAL_SIGNAL` |
| `acl-with-gas` | 98 / 500 | 107 / 500 | `NO_MATERIAL_SIGNAL` |
| `acl-no-gas` | 98 / 500 | 107 / 500 | `NO_MATERIAL_SIGNAL` |
| `gas-receipt-7` (`crankB-0`) | 93 / 500 | 107 / 500 | `NO_MATERIAL_SIGNAL` |
| `gas-receipt-11` (`crankB-4`) | 93 / 500 | 107 / 500 | `NO_MATERIAL_SIGNAL` |

Conclusion accepted for the prior forced-winner failure:

```text
LIKELY_FORCED_HARNESS_ARTIFACT
```

## Current Verdict

```text
P-P1: MATCHES under the 2026-08-15 re-frozen non-derivability criterion.
Prior byte-identical criterion: superseded, preserved as historical failed evidence.
Production-visible gas leak: not indicated by the accepted 1,000-run natural campaign.
```

This decision does not alter P-S2, P-P2, P-P5 or any production contract.

