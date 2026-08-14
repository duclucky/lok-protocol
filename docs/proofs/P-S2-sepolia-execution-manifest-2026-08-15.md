# P-S2 Sepolia Execution Manifest

**Status: PROPOSED / READ-ONLY / NOT AUTHORIZED / BLOCKED_PENDING_REVIEW.**

This document does not authorize any transaction, deployment, public-decryption request, relayer request, or ETH spend.
It exists only to cap a future Sepolia deployment budget pending explicit owner approval.

## Basis And Hard Stops

- Frozen source: `docs/10-proof-strategy.md` section 3, P-S2. This manifest does not edit or reinterpret that row.
- Source commit: `c3df5b581255fa267e7feba13804f1ed4347c7a5`.
- Network: Ethereum Sepolia, chain ID `11155111`.
- Read-only snapshot: block `11488626`; operator `0x8e7939E23a012143e5182d7173DAD42B2006c2b8`; balance
  `2.702175908700773413 ETH`; observed `maxFeePerGas = 1.945328284 gwei`.
- Archived provenance manifest: `deployments/history/sepolia-2026-08-13-120-30-180-600.json`
  SHA-256 `684FEEA38BA6FE2078735D745879EFB38014763AB3DBEB82A926C9D3D69C3AE4`.
- Hard stop: do not send any transaction unless the owner approves this manifest and its ETH cap.
- Hard stop: abort on chain, signer, bytecode, constructor-arg, balance, receipt, or state mismatch.
- Reconciliation blocker: `scripts/deploy.ts` calls `fhevm.publicDecrypt([checkpointHandle])` between D08 and D09.
  Owner approval must explicitly cover this public-decryption request before deployment execution. It decrypts only the
  initial empty-vault aggregate solvency boolean, not assets, liabilities, principal, or a per-user value.

## Proposed Deployment Profile

The future deployment target is the minimum-safe timing profile already reflected in source:

- `DRAW_PERIOD = 60`
- `MIN_SETTLE_DELAY = 24`
- `REVEAL_WINDOW = 120`
- `STATE_TIMEOUT = 300`
- `ADAPTER_DELAY = 1 day` remains unchanged and is not part of routine draw timing.

## Runtime Baseline

The deployment uses the reviewed runtime bytecode already observed on Sepolia. Constructor arguments change, runtime
bytecode does not.

| Contract | Runtime bytecode hash |
| --- | --- |
| MockUSDC | `0x74424333d40782057aad7f2e8d0d880454e0be054a5174b6a3a4d1a3db665a49` |
| YieldInjectingERC7984 | `0x35bb31ebeada04c434195e5839849b6ae7b9b30a376147e831d7f4c7253c8bc8` |
| MockYieldAdapter | `0x9082a52eff1730a18b1b274d227249535e0e613a58e572e3e4bb3d7bd43f6dba` |
| LokVault | `0x2df06f88a758ddf5dab351970af2c32a6dbe6e7be2d925f067e8e6fb5fb26393` |
| LokDrawManager | `0xcc25a6a8c5ca70e353d7988e51b936faadb89b7804f6515050b0b954ebd696fc` |

## Proposed State-Changing Calls

Budget is based on the actual current Sepolia deployment receipts, with a 25-35% margin and rounded ceilings.

| ID | Contract/function | Purpose / assertion | Est. gas | Ceiling | Custody / rollback |
| --- | --- | --- | ---: | ---: | --- |
| D01 | `MockUSDC()` | Deploy underlying test token. | 505,630 | 700,000 | No custody movement; a failed deploy stops the stack. |
| D02 | `YieldInjectingERC7984(MockUSDC)` | Deploy confidential wrapper token. | 2,624,045 | 3,600,000 | No custody movement; wrapper address binds to D01. |
| D03 | `MockYieldAdapter(YieldInjectingERC7984, owner)` | Deploy yield adapter. | 984,322 | 1,350,000 | No custody movement; adapter remains idle until bound. |
| D04 | `LokVault(YieldInjectingERC7984, MockYieldAdapter, owner)` | Deploy vault. | 4,341,154 | 5,900,000 | Vault custody is inert until binding and checkpointing. |
| D05 | `LokDrawManager(LokVault, owner, 60, 24, 120, 300)` | Deploy draw manager with reviewed timing. | 4,159,276 | 5,700,000 | No custody movement; timing constructor args must match manifest. |
| D06 | `MockYieldAdapter.setVault(LokVault)` | Bind adapter to vault. | 47,363 | 70,000 | If it fails, adapter remains unbound and no custody moves. |
| D07 | `LokVault.setDrawManager(LokDrawManager)` | Bind vault to draw manager. | 47,437 | 70,000 | If it fails, draw manager stays unbound; no custody moves. |
| D08 | `LokVault.openSolvencyCheckpoint()` | Open the initial public checkpoint. | 293,181 | 400,000 | Public state only; if it fails, the deployment stays incomplete. |
| D09 | `LokVault.submitSolvencyCheckpoint(true)` | Seal the initial checkpoint as solvent. | 369,164 | 500,000 | Public state only; a failed submission leaves the manifest unsealed. |

## Budget Summary

| Item | Limit |
| --- | ---: |
| State-changing transactions | `9` |
| Total hard gas stop | `18,500,000` |
| Estimated gas from ceilings | `18,290,000` |
| Total ETH cap | `0.05 ETH` |
| Admission ceiling | `maxFeePerGas <= 2,702,702,702 wei` (`0.05 ETH / 18,500,000 gas`) |

Worst-case ETH spend is bounded by `18,500,000 * approved maxFeePerGas`. At the admission ceiling above, the worst-case
transaction gas spend is at most `0.049999999987 ETH`, excluding any relayer/Gateway cost for the required public
decryption. If fee data, bytecode, constructor args, public-decryption semantics, or any binding/checkpoint result
changes, stop and re-review this manifest.

## Recovery And Cleanup

- Failed deploys are not retried blindly; restart only from the failed step after re-validating chain, signer, and bytecode.
- Failed bindings or checkpoint calls do not move custody.
- Etherscan verification and frontend publication are non-custodial post-deployment steps and are not part of this ETH cap.
- No production asset, mainnet asset, or relayer-funded accounting action is authorized here.

## Approval Gate

Owner approval is required before any deployment transaction is sent.
Until then, the deployment state is:

`BLOCKED_PENDING_OWNER_BUDGET_APPROVAL`
