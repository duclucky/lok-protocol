# P-P1 Re-Review Evidence - 2026-08-15

- **Current status:** `HISTORICAL_SUPERSEDED`
- **Superseded by:** `docs/proofs/P-P1-refreeze-2026-08-15.md`
- **Use:** provenance for the forced-winner campaign; not the current P-P1 verdict.

## Scope

This evidence package is for the P-P1 re-review campaign harness only.

- Production contracts changed: no
- `docs/10-proof-strategy.md` changed: no
- Frozen P-P1 status after this package: `WEAKER-THAN-CLAIMED`
- Full campaign status in this run: `FAILED`
- Campaign source: `hardhat-fhevm-real`

This package did not claim P-P1 `MATCHES` at generation time. Owner later re-froze P-P1 under the non-derivability
criterion in `docs/proofs/P-P1-refreeze-2026-08-15.md`.

## Harness

Dedicated full runner:

```powershell
npx ts-node scripts/p-p1-re-review.ts --mode full --seed 20260815 --out artifacts/privacy/p-p1-re-review
```

Runtime:

```text
Start: 2026-08-15T06:35:40.6222483+07:00
End:   2026-08-15T06:58:14.8774168+07:00
Wall:  approximately 22m34s
```

The full campaign source is `hardhat-fhevm-real`: the runner shells into Hardhat, runs the actual local FHEVM mock draw
lifecycle, forces each winner position, and captures real transaction receipts/logs. The earlier smoke evidence was
synthetic infrastructure-only and was not eligible as P-P1 re-review evidence; the prior real-smoke evidence was
source/infrastructure evidence only, not a substitute for the full statistical gate.

Full-mode registration:

- 1,000 executions
- 5 winner positions
- 200 executions per winner
- 500 train / 500 held-out split
- split frozen and persisted before classifier fitting
- observer families: `sequence-shape`, `byte-ngram`, `acl-emitter-call-boundary`
- mutation modes: `indexed-topic-bit`, `data-payload-bit`, `emitter-call-shape-bit`, `acl-recipient-asymmetry`
- transcript source: `hardhat-fhevm-real`

Manifest check:

```text
mode: full
transcriptSource: hardhat-fhevm-real
executionCount: 1000
executionsPerWinner: 200
trainCount: 500
heldOutCount: 500
```

Raw transcript retention check:

```text
hardhat-transcripts.json transcripts: 1000
non-real transcriptSource entries: 0
transcripts with application/fhevm-executor/acl log classes: 1000
entry 301 present: 1000
entry 301 decoded as FheLe: 1000
raw transcript .sha256 sidecars missing: 0
top-level .sha256 sidecars missing: 0
```

## Artifact Paths

Root:

```text
artifacts/privacy/p-p1-re-review/
```

Machine-readable artifacts:

- `manifest.json`
- `seed-list.json`
- `split.json`
- `transcript-index.json`
- `raw-transcripts/*.json`
- `*.sha256` sidecars for every transcript and top-level JSON artifact
- `hardhat-transcripts.json`
- `classifier-metrics.json`
- `mutation-metrics.json`
- `permutation-tests.json`
- `command-provenance.json`
- `final-status.json`
- `artifact-hashes.json`

## Artifact Hashes

Top-level artifact hashes:

```text
classifier-metrics.json                    F90CB3F7AE1B21E83B60BFA8A1C0B4EEE715E84ED30A71B63FECB22F88911414
command-provenance.json                    BCC38ADE44BDE6F60F61427BC9D64B0D3C2614195A517E6D4CA504C8034B03C0
final-status.json                          0847F98D1094BD37DB3C71FF394342B170C30093383136D7AC1B2706FE2A2B32
hardhat-transcripts.json                   7C757680490FD47C8BD1912ED51C3A57B19DD673902A382F5047820E47B472F2
manifest.json                              6D650F4F8E26AE8A59CA6EAA8CDBB7B59DAC9B0B3039D8557C9DD91FC7A06E6B
mutation-metrics.json                      33BC4D350BBC68CC35738E3503467B6C303E75D1FA2838A484A2322025AC34B7
permutation-tests.json                     5C2BFD9313B08DFE5EEB8BE5C58139A7E34C1A99BD96552CADEBE93067C32DDA
seed-list.json                             2D6207DDA29423810628086AC6579CA08B4996D803DBE066F5C928E579CA8C45
split.json                                 A3971E66792C3A12274C5634E49E50C878F667F91254FB68D0D0DE13EC57C5A6
transcript-index.json                      465F1321F7A872F22F71FFD8F7D8D6F98186858B09519AECA5E4B127B3C021B1
```

Complete transcript hashes are in `artifacts/privacy/p-p1-re-review/artifact-hashes.json` and per-file `.sha256`
sidecars.

## Full Campaign Results

Classifier metrics:

| Observer                    | Held-out | Correct | Accuracy | Wilson upper 99%    | Permutation p-value | Status |
| --------------------------- | -------: | ------: | -------: | ------------------: | ------------------: | ------ |
| `sequence-shape`            |      500 |     100 |    0.200 | 0.24472840609832017 |               1.000 | PASS   |
| `byte-ngram`                |      500 |      30 |    0.060 | 0.08973391897333256 |               1.000 | PASS   |
| `acl-emitter-call-boundary` |      500 |     126 |    0.252 |    0.2996605140982 |               0.002 | FAIL   |

The full campaign failed because `acl-emitter-call-boundary` exceeded all registered failure gates:

- correct predictions: `126/500`, above max `102/500`
- one-sided 99% Wilson upper: `0.2996605140982`, above max `0.25`
- permutation p-value: `0.002`, below minimum `0.01`

Mutation positive controls:

| Mutation                  | Observer                    | Held-out correct | Accuracy | Required | Status |
| ------------------------- | --------------------------- | ---------------: | -------: | -------: | ------ |
| `indexed-topic-bit`       | `byte-ngram`                |        500 / 500 |     1.00 |     0.95 | PASS   |
| `data-payload-bit`        | `byte-ngram`                |        500 / 500 |     1.00 |     0.95 | PASS   |
| `emitter-call-shape-bit`  | `sequence-shape`            |        500 / 500 |     1.00 |     0.95 | PASS   |
| `acl-recipient-asymmetry` | `acl-emitter-call-boundary` |        500 / 500 |     1.00 |     0.95 | PASS   |

## Companion Gates

| Gate                                                       | Command                                                       | Result                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-P2 uniform ACL grant multiset                            | `npx hardhat test test/privacy/acl-uniformity.t.ts`           | PASS: 3 passing                                                                                                                                      |
| P-P5 gas/HCU symmetry                                      | `npx hardhat test test/privacy/gas-indistinguishability.t.ts` | PASS: 2 passing                                                                                                                                      |
| no winner-only ABI/event gate and frozen residual behavior | `npx ts-node scripts/privacy-scan.ts`                         | EXPECTED FAIL: aggregate report fails because frozen P-P1 remains FAIL; dynamic evidence PASS; P-P2/P-P5/static gates pass; P-P9-UX is NOT_TESTABLE |
| raw-transcript retention                                   | `artifacts/privacy/p-p1-re-review/final-status.json`          | PASS                                                                                                                                                 |

`scripts/privacy-scan.ts` exited 1 because frozen P-P1 remains weaker than claimed. That is expected current behavior,
not a harness infrastructure failure.

## Commands Run

| Command                                                                                                                       | Result                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `git status --short`                                                                                                          | PASS: empty before preflight                                                                                |
| `git diff -- docs/10-proof-strategy.md`                                                                                       | PASS: empty before preflight                                                                                |
| `npx hardhat test test/privacy/p-p1-re-review-harness.t.ts`                                                                   | PASS: 3 passing                                                                                             |
| `npx ts-node scripts/p-p1-re-review.ts --mode smoke --seed 20260815 --out artifacts/privacy/p-p1-re-review-smoke-preflight`   | PASS; emitted `REAL_SMOKE_ONLY`; temporary artifact directory removed with scoped `git clean`                |
| `npx ts-node scripts/p-p1-re-review.ts --mode full --seed 20260815 --out artifacts/privacy/p-p1-re-review`                    | PASS as command execution; emitted final campaign status `FAILED` with 1,000 real transcripts               |
| `npx hardhat test test/privacy/p-p1-re-review-harness.t.ts`                                                                   | PASS: 3 passing                                                                                             |
| `npx hardhat test test/privacy/log-indistinguishability.t.ts`                                                                 | PASS: 3 passing, 1 pending                                                                                  |
| `npx hardhat test test/privacy/acl-uniformity.t.ts`                                                                           | PASS: 3 passing                                                                                             |
| `npx hardhat test test/privacy/gas-indistinguishability.t.ts`                                                                 | PASS: 2 passing                                                                                             |
| `npx ts-node scripts/privacy-scan.ts`                                                                                         | EXPECTED FAIL: P-P1 remains FAIL; dynamic evidence PASS; P-P2/P-P5/static gates pass                        |
| `npx tsc --noEmit`                                                                                                            | PASS                                                                                                        |
| `git diff -- docs/10-proof-strategy.md`                                                                                       | PASS: empty diff                                                                                            |
| `git diff --check`                                                                                                            | PASS; CRLF warnings only for generated JSON artifacts, no whitespace errors                                 |

## Final Status

`FAILED`

The full 1,000-execution P-P1 re-review campaign ran against real Hardhat/FHEVM receipts and preserved entry 301
`FheLe`, but one pre-registered classifier failed the statistical gate. Frozen P-P1 remains
`WEAKER-THAN-CLAIMED` until independent reviewer/owner re-freeze.
