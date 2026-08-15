# P-P1 Protocol-Log Forensic Report

- **Current status:** `HISTORICAL_SUPERSEDED`
- **Superseded by:** `docs/proofs/P-P1-refreeze-2026-08-15.md`
- **Use:** provenance for the retired byte-identical criterion; not the current P-P1 verdict.

- **Frozen proposition:** Winner is not derivable from the full event log without a private key.
- **Frozen pass criterion:** No event field differs between winner and any loser.
- **Code/test commit:** `65ff43262778a1c073d1d2f413a11d9c57cb98a5`
- **Reviewer context:** same-context forensic worker, not an independent reviewer
- **Verdict:** `WEAKER-THAN-CLAIMED`

## Finding

The frozen byte-field criterion does not pass. All 10 forced-winner pairs first differ at global transcript entry 301.
The difference is not an application event or an ACL recipient asymmetry. It is the local FHEVM executor's first PASS-B
`FheLe` event:

```text
LokDrawManager.crankB
  -> _processPassB
  -> FHE.le(_rangeStart[drawId][user], draw.r)
```

The event's `rhs` is the opaque `draw.r` handle deliberately replaced by the forced-winner harness. Its `result` is the
corresponding opaque comparison handle. Every address, topic, length, operation and application call path remains
structurally identical. Different opaque input/output handles are nevertheless different raw event fields, so they
cannot be filtered or called byte-identical under the frozen criterion.

## Reproduction

```powershell
npx hardhat test test/privacy/log-indistinguishability.t.ts --grep "compares complete lifecycle"
$env:LOK_P_P1_FORENSIC="1"
npx hardhat test test/privacy/log-indistinguishability.t.ts --grep "forensically separates entry 301"
$env:LOK_PRIVACY_OUTPUT = Join-Path $env:TEMP "lok-privacy-report-fresh.json"
npx ts-node scripts/privacy-scan.ts
```

The first command reproduced the original entry-301 difference with `1 passing`. The forensic command ran 50 balanced
executions and passed its control assertions. The privacy scanner exited `1` because P-P1 remains `FAIL`; the static
public-decryption and ACL scans had zero violations.

The complete machine-readable record, including transaction hashes, block numbers/timestamps, all raw topics/data,
decoded arguments and exact offsets, is
[`artifacts/privacy/p-p1-forensic.json`](../../artifacts/privacy/p-p1-forensic.json).

## Entry 301

| Forced winner | Local transaction    | Block | Emitter               | Classification      | Event                                           | Cursor |
| ------------: | -------------------- | ----: | --------------------- | ------------------- | ----------------------------------------------- | -----: |
|             0 | `0x7efd4a05...a5467` |    42 | `0xe3a9105a...43dD24` | local FHEVMExecutor | `FheLe(address,bytes32,bytes32,bytes1,bytes32)` |      0 |
|             1 | `0x3be6d966...bb106` |    49 | `0xe3a9105a...43dD24` | local FHEVMExecutor | `FheLe(address,bytes32,bytes32,bytes1,bytes32)` |      0 |
|             2 | `0x3f84c818...b19bc` |    56 | `0xe3a9105a...43dD24` | local FHEVMExecutor | `FheLe(address,bytes32,bytes32,bytes1,bytes32)` |      0 |
|             3 | `0x68c2d62d...781ca` |    63 | `0xe3a9105a...43dD24` | local FHEVMExecutor | `FheLe(address,bytes32,bytes32,bytes1,bytes32)` |      0 |
|             4 | `0xd8d022a2...abe18` |    70 | `0xe3a9105a...43dD24` | local FHEVMExecutor | `FheLe(address,bytes32,bytes32,bytes1,bytes32)` |      0 |

The emitter and ABI are verified from installed `@fhevm/solidity@0.11.1` `ZamaConfig.sol` and
`@fhevm/host-contracts/contracts/FHEEvents.sol`. The event decodes as:

| Argument     | Meaning at this call                    | Pairwise result            |
| ------------ | --------------------------------------- | -------------------------- |
| `caller`     | `LokDrawManager`                        | identical                  |
| `lhs`        | `_rangeStart[drawId][participantAt(0)]` | identical                  |
| `rhs`        | forced `draw.r` ciphertext handle       | differs with forced winner |
| `scalarByte` | encrypted/encrypted mode, `0x00`        | identical                  |
| `result`     | encrypted result of `lhs <= rhs`        | differs with `rhs`         |

Raw event data has four ABI words. Relative to winner 0, the differing byte ranges are `32..52` in the `rhs` word and
`96..116` in the `result` word for winners 1, 2 and 4; winner 3 differs at `32..51` and `96..116`. Offsets are
zero-based from the first byte after `0x`. No plaintext interpretation is made from any handle byte.

## Pairwise Controls

| Pair  | First raw difference | Entry-301 ranges    |
| ----- | -------------------: | ------------------- |
| 0 / 1 |                  301 | `32..52`, `96..116` |
| 0 / 2 |                  301 | `32..52`, `96..116` |
| 0 / 3 |                  301 | `32..51`, `96..116` |
| 0 / 4 |                  301 | `32..52`, `96..116` |
| 1 / 2 |                  301 | `32..52`, `96..116` |
| 1 / 3 |                  301 | `32..52`, `96..116` |
| 1 / 4 |                  301 | `32..52`, `96..116` |
| 2 / 3 |                  301 | `32..52`, `96..116` |
| 2 / 4 |                  301 | `32..52`, `96..116` |
| 3 / 4 |                  301 | `32..52`, `96..116` |

- Each forced winner was repeated 10 times after snapshot/revert with monotone block mining. For a fixed winner, the
  local mock retained one `rhs` and one `result` handle across all repetitions. This refutes block nondeterminism as the
  cause in this installed mock.
- Forced winners covered first, interior and final cursor positions: 0, 2 and 4.
- Replacing a non-winner participant at index 4 while keeping winner 0 preserved the complete structural transcript.
- Every application log remained byte-identical across all five forced winners. The raw protocol payload was not
  normalized, filtered or ignored.

## Public Observer

The classifier used only public structural fields: emitter class, topic0, topic count, data length, transaction/log
position, parsed event name and parsed argument names. Ciphertext payload bytes, decrypted values, private harness state
and non-public participant-to-handle mappings were excluded.

| Metric              |          Result |
| ------------------- | --------------: |
| Training executions |              25 |
| Held-out executions |              25 |
| Random baseline     |             20% |
| Measured accuracy   |      20% (5/25) |
| Wilson 95% interval | 8.86% to 39.13% |

All five structural classes collapsed to one feature vector. The confusion matrix therefore predicts class 0 for each
held-out sample and contains one correct row out of five. This result does not establish the frozen criterion; it only
shows that the tested structure-only observer did not derive the winner.

## Classification

**CASE 2 - benign opaque-handle variation, frozen criterion still fails.** The forced harness makes the causal mapping
easy to locate, but the core conflict is not removed by replacing the harness: equivalent production draws naturally use
distinct encrypted random handles, and executor operation events carry those handles. Raw protocol event fields can
therefore differ without exposing the plaintext winner.

No production fix is proposed. The smallest owner decision is one of:

1. Keep the frozen byte-field criterion and accept that P-P1 cannot close on full FHEVM protocol logs.
2. Explicitly re-review and re-freeze P-P1 with a non-derivability or statistical-indistinguishability pass criterion.

Frozen `docs/10-proof-strategy.md` section 3 was not edited.
