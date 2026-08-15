# P-P1 Natural Gas Experiment - 2026-08-15

## Objective

Separate the prior forced-winner gas signal from production-faithful local draw behavior.

The prior full P-P1 re-review used real Hardhat/FHEVM receipts, but it forced each winner by writing a
test-only random handle into `Draw.r` with `hardhat_setStorageAt`. This experiment does not force the
winner. It uses the normal local contract path:

```text
openDraw -> PASS A -> submitTotals -> openRandom -> PASS B settlement
```

Winner labels are assigned only after settlement by decrypting each participant's prize credit in the
local FHEVM test environment.

## Scope

- Production contracts changed: no
- Forced-winner harness used: no
- `hardhat_setStorageAt` used: no
- FHEVM Executor logs retained: yes
- ACL logs retained: yes
- Gas retained: yes
- Entry 301 / `FheLe` retained when present in the raw transcript: yes
- `docs/10-proof-strategy.md` changed: no
- P-P1 status at experiment time: `WEAKER-THAN-CLAIMED`

This experiment did not claim P-P1 `MATCHES` at generation time. It was later accepted as the evidence basis for the
2026-08-15 P-P1 re-freeze in `docs/proofs/P-P1-refreeze-2026-08-15.md`.

## Commands

Preflight:

```powershell
git status --short
git diff -- docs/10-proof-strategy.md
npx hardhat test test/privacy/p-p1-natural-gas-source.t.ts
npx ts-node scripts/p-p1-natural-gas-experiment.ts --mode smoke --seed 20260815 --out artifacts/privacy/p-p1-natural-gas-experiment-smoke-preflight
```

Full campaign:

```powershell
npx ts-node scripts/p-p1-natural-gas-experiment.ts --mode full --runs 1000 --seed 20260815 --out artifacts/privacy/p-p1-natural-gas-experiment
```

Full result:

```text
PASS as command execution
mode: FULL_RUN
sample count: 1000
runtime: 1416.588 seconds
conclusion: LIKELY_FORCED_HARNESS_ARTIFACT
```

The smoke preflight artifact directory was removed and is not part of this evidence package.

## Artifact Root

```text
artifacts/privacy/p-p1-natural-gas-experiment/
```

Required artifacts emitted:

- `manifest.json`
- `collector-natural-transcripts.json`
- `transcripts.json`
- `raw-transcripts/*.json`
- `transcript-index.json`
- `split.json`
- `winner-distribution.json`
- `gas-classifier-metrics.json`
- `confusion-matrices.json`
- `command-provenance.json`
- `final-status.json`
- `artifact-hashes.json`
- `.sha256` sidecars for all top-level JSON artifacts and all raw transcripts

Integrity check:

```text
mode: full
executionCount: 1000
transcriptSource: hardhat-fhevm-natural
raw transcript JSON artifacts: 1000
raw transcript source counts: hardhat-fhevm-natural = 1000
emitter classes retained: acl, application, fhevm-executor
raw transcripts containing entry 301 / FheLe: 1000
missing top-level sidecars: 0
missing raw sidecars: 0
forced-random markers in natural script/source test: none
```

Top-level hashes:

| Artifact | SHA-256 |
| --- | --- |
| `manifest.json` | `1A03D808F0F72B1B7CE8CA0BFC89D753E1931F67BA9FDB8230CBBA68AEEF68E1` |
| `collector-natural-transcripts.json` | `CD2DD38B2D6DEF901229EFDD0B445EC36BFE2802B6F33468E76BB7A171C89BA9` |
| `transcripts.json` | `714F0560BA52C442F04DE25320DF1424EE0CE9FE3ADCED0227F75A787333E580` |
| `transcript-index.json` | `35E7A0CC0DFDE2D42393FF5A1F49CBE263A6B6DCF3933B3AF1715D4DBA6E3B54` |
| `split.json` | `81F1137E9B83D52261E43925A31AECEA5CC795127389159592457172F85FDBEA` |
| `winner-distribution.json` | `CDB9A87733D86D75143C5B860230ED626C12C7196D2C86907166E62575180448` |
| `gas-classifier-metrics.json` | `546B039FBBCE0FDF8208FA2C3DB0C9D1FB105679FC3B90D1C0BDD047B05604AB` |
| `confusion-matrices.json` | `0B2A663B363F688EE54385E88161354995A6D42CFFB45D9530DCB425019BC1F7` |
| `command-provenance.json` | `DCE3281BD61907A8A46275546597CC979486794960EE1CE5076556F7E61F27F3` |
| `final-status.json` | `63518966FDBD381B6746C5468866410C3C503C8ED5E48DE0F6167D3037D2DA18` |

Complete raw transcript hashes are in `artifact-hashes.json`.

## Winner Distribution

All 1,000 natural runs:

| Winner index | Count | Share |
| ---: | ---: | ---: |
| 0 | 184 | 0.184 |
| 1 | 194 | 0.194 |
| 2 | 201 | 0.201 |
| 3 | 217 | 0.217 |
| 4 | 204 | 0.204 |

Train split:

| Winner index | Count | Share |
| ---: | ---: | ---: |
| 0 | 91 | 0.182 |
| 1 | 89 | 0.178 |
| 2 | 104 | 0.208 |
| 3 | 119 | 0.238 |
| 4 | 97 | 0.194 |

Held-out split:

| Winner index | Count | Share |
| ---: | ---: | ---: |
| 0 | 93 | 0.186 |
| 1 | 105 | 0.210 |
| 2 | 97 | 0.194 |
| 3 | 98 | 0.196 |
| 4 | 107 | 0.214 |

No winner class was missing. The held-out majority baseline is 107 / 500 = 0.214.

## Classifier Metrics

Held-out samples: 500.

| Mode | Correct | Accuracy | Majority baseline | Advantage over majority | Wilson upper 99% | Permutation p-value | Status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `gas-only` | 84 / 500 | 0.168 | 0.214 | -0.046 | 0.210 | 0.981 | `NO_MATERIAL_SIGNAL` |
| `acl-with-gas` | 98 / 500 | 0.196 | 0.214 | -0.018 | 0.240 | 1.000 | `NO_MATERIAL_SIGNAL` |
| `acl-no-gas` | 98 / 500 | 0.196 | 0.214 | -0.018 | 0.240 | 1.000 | `NO_MATERIAL_SIGNAL` |
| `gas-receipt-7` (`crankB-0`) | 93 / 500 | 0.186 | 0.214 | -0.028 | 0.230 | 1.000 | `NO_MATERIAL_SIGNAL` |
| `gas-receipt-11` (`crankB-4`) | 93 / 500 | 0.186 | 0.214 | -0.028 | 0.230 | 1.000 | `NO_MATERIAL_SIGNAL` |

All natural-gas classifiers are at or below the held-out majority baseline and have non-significant
permutation p-values. The forced campaign's strongest gas signals at `crankB-0` and `crankB-4` did not
reappear in the natural 1,000-run campaign.

## Conclusion

Full conclusion category: `LIKELY_FORCED_HARNESS_ARTIFACT`.

Interpretation:

- The natural, non-forced local path did not reproduce the prior gas-only signal in 1,000 samples.
- The winner distribution is sufficiently balanced for this experiment's majority-baseline comparison.
- Production-visible gas leak is not likely from this experiment.
- This result did not itself re-freeze P-P1 at generation time. It was later accepted by owner decision as the evidence
  basis for the 2026-08-15 non-derivability re-freeze.

## Verification Commands

Commands run for this package:

```powershell
npx hardhat test test/scripts/p-p1-natural-gas-experiment.t.ts
npx hardhat test test/privacy/p-p1-natural-gas-source.t.ts
npx ts-node scripts/p-p1-natural-gas-experiment.ts --mode smoke --seed 20260815 --out artifacts/privacy/p-p1-natural-gas-experiment-smoke-preflight
npx ts-node scripts/p-p1-natural-gas-experiment.ts --mode full --runs 1000 --seed 20260815 --out artifacts/privacy/p-p1-natural-gas-experiment
```

Required final verification for the commit:

```powershell
npx ts-node scripts/analyze-p-p1-gas-signal.ts
npx hardhat test test/privacy/gas-indistinguishability.t.ts
npx hardhat test test/privacy/p-p1-re-review-harness.t.ts
npx hardhat test test/privacy/log-indistinguishability.t.ts
npx tsc --noEmit
git diff -- docs/10-proof-strategy.md
git diff --check
```

## Status

```text
P-P1 status at experiment generation: WEAKER-THAN-CLAIMED
P-P1 forced re-review: FAILED
P-P1 natural gas full: LIKELY_FORCED_HARNESS_ARTIFACT
P-P1 2026-08-15 re-freeze: MATCHES under non-derivability criterion
Production contracts changed: no
docs/10-proof-strategy.md changed: no
```
