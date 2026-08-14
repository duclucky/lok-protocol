# P-S2 Sepolia Groups A/B Evidence Handoff

- **Date:** 2026-08-14
- **Network:** Ethereum Sepolia (`11155111`)
- **Operator:** `0x8e7939E23a012143e5182d7173DAD42B2006c2b8`
- **Execution manifest:** `docs/proofs/P-S2-sepolia-execution-manifest-2026-08-13.md`
- **Code/test basis:** `65ff43262778a1c073d1d2f413a11d9c57cb98a5`
- **Group A / Group B phase-1 executor:** `51c0b014e726066cfc1c6e61346a55b14e70ea3e`
- **Group B phase-2 preflight executor:** `d46fc93b2dbb520bb3860bd4db0f1e94d45149f8`
**Group B phase-2 control HEAD:** `d5521e9719a96bb1bc27417ba516754f4022a04d` (later commits changed only
frontend/design/plan files relative to the executor source)

## Scope

This package hands the completed state-changing Sepolia evidence to the independent P-S2 reviewer. It does not change
the frozen proposition, does not claim that live infrastructure can be forced permanently offline, and does not
self-promote P-S2 to `MATCHES`.

## Execution Totals

| Group | Transactions | Deployments | Gas used | ETH spent | Approved cap |
| ----- | -----------: | ----------: | -------: | --------: | ------------ |
| A     |           62 |           0 | 67,802,448 | `0.075200005179944378` | 110,000,000 gas / `0.22 ETH` |
| B     |           39 |           5 | 23,229,318 | `0.025528556527364514` | 38,000,000 gas / `0.08 ETH` |
| B deployment subset | 5 | 5 | 9,109,958 | `0.010045039268735450` | 11,800,000 gas / `0.025 ETH` |

The admission gas-price ceiling was removed by explicit owner authorization. Transaction, gas and ETH hard caps
remained enforced by the executor.

## Artifact Integrity

- Evidence root: `artifacts/sepolia/p-s2-groups-2026-08-13/`
- Receipt artifacts: `101` (`S01-S62`, `D01-D39`)
- SHA-256 sidecars checked: `120`
- Missing or mismatched sidecars: `0`
- Duplicate step IDs: `0`
- Duplicate transaction hashes: `0`
- `ledger.json` SHA-256: `54a5118bcea684a6a9d711fbaeccce5997f1dd4d2aae7aaab00c9504507e39c6`
- `summary.json` SHA-256: `c8da561ba95e5a0c05669113323b9fd0cfca3f5d9522ef81373a8a19ff41b7ea`

Each receipt artifact includes transaction data, mined receipt, block metadata, all raw topics/data bytes, before/after
protected state, expected status and the artifact-specific SHA-256.

## Negative Cases

The following transactions mined with status `0` and unchanged protected state as required:

| ID | Case | Decoded error when available |
| -- | ---- | ---------------------------- |
| D14 | authentic false handle with forged cleartext `true` | KMS proof rejection |
| S56 | wrong checkpoint nonce | `WrongNonce` |
| S57 | wrong checkpoint epoch | `WrongEpoch` |
| S58 | tampered checkpoint proof | KMS proof rejection |
| S60 | checkpoint-A proof with checkpoint-B binding | KMS proof rejection |
| S62 | duplicate checkpoint submission | `NoPendingCheckpoint` |
| D24 | epoch-1 proof after adapter activation moved to epoch 2 | `WrongEpoch` |
| D27 | retiring-adapter removal before drain | `AdapterNotDrained` |

## Final Disposable State

D39 records:

- `participantCount == 0` and operator `participantIndex == 0`;
- `pendingExit == bytes32(0)`;
- `hasPendingSolvencyCheckpoint == false`;
- `restricted == false`;
- `riskEpoch == lastSolventRiskEpoch == 3`;
- `proposedAdapter == address(0)`;
- `retiringAdapter == address(0)`;
- `adapterActivateAfter == 0`;
- the final zero-liability checkpoint was publicly decrypted as true and submitted successfully.

The dedicated test assets were returned through D36-D37. The five disposable contracts remain deployed on Sepolia but
have no participant liability or pending lifecycle state.

## Reviewer Boundary

The independent reviewer must correlate this package with the approved hand proof, implementation and generated
transition evidence. In particular:

- Group A supplies the real shared draw/settlement integration, including S44 settlement and immediate recovery paths.
- Group B supplies true/false checkpoint, oracle-pending recovery, risk-stale proof, adapter activation/drain/removal and
  final cleanup evidence.
- Permanent live Gateway/KMS failure cannot be deliberately induced on Sepolia; D12-D13 show recovery while a response
  is pending, while the permanent-nondelivery obligation remains model/code argument territory.
- Existing documented limits on Foundry settlement abstraction and supported-adapter postconditions remain unchanged.

## Status

```text
P-S2 hand proof: APPROVED
Full P-S2: MATCHES
P-P1: WEAKER-THAN-CLAIMED
```
