# P-S2 Sepolia Reconciliation

**Status: READ-ONLY. Verdict: READY_FOR_REVIEW.**

This reconciliation now records the executed Sepolia deployment evidence. No additional transaction, deployment,
signing, public-decryption request, relayer request, or Sepolia ETH spend was sent while preparing this note.

## Scope Finding

The apparent reduction from Group B `D23-D39` (`17` transactions) to the new manifest's `9` transactions is not a
replacement of evidence obligations. `D23-D39` were the second half of the already-authorized disposable Group B
execution against the 2026-08-13 `120/30/180/600` deployment. Those steps have mined evidence in
`artifacts/sepolia/p-s2-groups-2026-08-13/`. The new deployment scope is a separate minimum-timing `60/24/120/300`
stack with `9` state-changing transactions plus `1` mandatory public-decryption request between D08 and D09.
That request is now explicitly scoped and no longer a hidden dependency.

## Reconciliation Matrix: Original D23-D39

| Original step | Original purpose | Current status | Tx hash/receipt evidence | Included in new 9 tx? | Replacement/current step | Reason |
|---|---|---|---|---|---|---|
| D23 | Activate the honest replacement adapter after the 1-day timelock; retire the old adapter and move `riskEpoch` to 2. | `ALREADY_EXECUTED` | `0x4fd72e615ca7be76097ea53f20755684e75868e0ddbbf8d54ef2a821f358f82c`; status `1`; `LokVault.activateAdapter`; block `11487506`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D23.json`; SHA `10ee048a76e0e4b97f84a3a53fdab3559b3ad723c403f96db881fa4e0dffdb31`. | No | Historical Group B evidence. | The timelock opened at `1786714152`; D23 mined at timestamp `1786714368`, then `riskEpoch == 2` and active adapter became `0x5dD6E364B80d5e92b4765e8a0589B2400140b879`. |
| D24 | Submit stale epoch-1 checkpoint proof after adapter activation; must revert `WrongEpoch`. | `REMOVED_WITH_PROOF` | `0xc9635599a4b90246582897dcacdb1f6124e79c62e25afd9f84ea92fa3fa55201`; expected revert status `0`; `LokVault.submitSolvencyCheckpoint`; block `11487508`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D24.json`; SHA `1d455319333c10f15783774db29c6458011d75f5807e055117eb381bbd1dfa7b`. | No | Historical negative-case evidence. | The old obligation was a negative case, not a successful state transition. The receipt records `revertName = WrongEpoch`, proving the stale epoch-1 proof did not authorize epoch 2. |
| D25 | Mint bounded final principal for unauthorized-epoch routing check. | `ALREADY_EXECUTED` | `0xacbeea23d3c02ef7b64245c1c142b5ca6907416fe53d612a28f9038fc51d61c2`; status `1`; `YieldInjectingERC7984.mintForTest`; block `11487509`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D25.json`; SHA `e4c46ccb55ff98cf81d1cebe9b12f0eb0e6815f4a1bd24390d3f4e1ddaef3bd5`. | No | Historical Group B evidence. | Fixture mint supported D26 routing evidence and was later cleaned up by D36-D37. |
| D26 | Deposit while epoch 2 is unauthorized; principal must remain in vault and not route to the new adapter. | `ALREADY_EXECUTED` | `0x15d8aea1307ef46fc22ea39963232da32a5f322f3097628e8bd0d3c825d07353`; status `1`; `LokVault.deposit`; block `11487512`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D26.json`; SHA `49bed3724abc28e93fdb0b5d5221db831fd767b6f46a9b8af75783a591c8f0cd`. | No | Historical Group B evidence. | Executor after-state assertions bound this to the unauthorized-epoch routing case. |
| D27 | Attempt to remove retiring adapter before drain; must revert `AdapterNotDrained`. | `REMOVED_WITH_PROOF` | `0x0fa884989fda1a75fc02825864548d7cd99515fef3e15f36a2cc811401a23000`; expected revert status `0`; `LokVault.removeRetiringAdapter`; block `11487514`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D27.json`; SHA `4a86827cc9559715bc52bc14eedbd29e009f569832b5b3651fa8122bcb0c0c10`. | No | Historical negative-case evidence. | The old obligation was a negative case. The receipt records `revertName = AdapterNotDrained`, proving removal did not occur before drain. |
| D28 | Drain the retiring adapter back to vault custody. | `ALREADY_EXECUTED` | `0xec6e52398089ba572e4686cd1c2b495d365eae4b6038abfd9353f75366edd622`; status `1`; `LokVault.drainRetiringAdapter`; block `11487517`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D28.json`; SHA `066b0471d592682faa9ad4bead14943077c8f6d22a2f39e37f1714d9d5c208af`. | No | Historical Group B evidence. | Retiring-adapter custody recovery was completed before authorization/removal. |
| D29 | Open current epoch-2 solvency checkpoint after drain. | `ALREADY_EXECUTED` | `0x699056d9b06266c1f4c6dc25dfdc2f3107d9aceab549691238c9872ea555d69d`; status `1`; `LokVault.openSolvencyCheckpoint`; block `11487518`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D29.json`; SHA `234c85ed9bbbae7f8a8beb5390ad3e924b833fd807170c20c1881006ccbcde08`. | No | Historical Group B evidence. | This opened the current post-drain aggregate checkpoint for D30. |
| D30 | Submit true current epoch-2 solvency checkpoint. | `ALREADY_EXECUTED` | `0xae55cdf3edd3ad70f99880fb37ac0ae0e0a1be5d67ac8c60f4af54ecb63f59e1`; status `1`; `LokVault.submitSolvencyCheckpoint`; block `11487521`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D30.json`; SHA `1ace21f36d52ef46428bf888cd419614206b70aebfa08ef97942c08e1e8480f5`. | No | Historical Group B evidence. | Epoch 2 authorization was re-established after drain. |
| D31 | Remove drained retiring adapter and move `riskEpoch` to 3. | `ALREADY_EXECUTED` | `0xb9d6e5cac06cfc32f878be151aacf46c7437e591044074ee332966f4ee30ed25`; status `1`; `LokVault.removeRetiringAdapter`; block `11487522`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D31.json`; SHA `6dc6b4d9117fb07b2ee8226601c26a242fd4d22e4477156982503fb1faf4e248`. | No | Historical Group B evidence. | Removal completed the adapter transition and invalidated epoch-2 authorization. |
| D32 | Open current epoch-3 solvency checkpoint. | `ALREADY_EXECUTED` | `0xef00bf990e3a1df7548b43550e39e909f3bd4978c32fb1fc4de3c71648b433da`; status `1`; `LokVault.openSolvencyCheckpoint`; block `11487524`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D32.json`; SHA `271a34594657490970352dba22af32e97452f7e513ee34cc87b2e327be9d25df`. | No | Historical Group B evidence. | This opened the current post-removal aggregate checkpoint for D33. |
| D33 | Submit true current epoch-3 solvency checkpoint. | `ALREADY_EXECUTED` | `0x170b373e98364bebadd84512e4237c0e932a2800f9153ddcf059d18b0b8887c3`; status `1`; `LokVault.submitSolvencyCheckpoint`; block `11487525`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D33.json`; SHA `fc1c856d36bd17b4cac789466c8b56720a690abd2fb396478ef822d52c7cf4a2`. | No | Historical Group B evidence. | Epoch 3 authorization was established. |
| D34 | Mint final bounded routing/cleanup principal. | `ALREADY_EXECUTED` | `0x3f90d7cb8ec879a037e9784b8212d29c2faeb029840339c98db0ecbe870cfce1`; status `1`; `YieldInjectingERC7984.mintForTest`; block `11487526`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D34.json`; SHA `85fd14b219761d3e824dc8e96d8421e975fd6ba499fe9058b5794dedbf9d800e`. | No | Historical Group B evidence. | Fixture mint supported D35 and was later cleaned up by D36-D37. |
| D35 | Deposit while epoch 3 is authorized; principal routes to active honest adapter. | `ALREADY_EXECUTED` | `0x71cde9bc0c1f77c2c2d1e1c430c9c38029b784d060fe4d78b44981fc7f2c2880`; status `1`; `LokVault.deposit`; block `11487529`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D35.json`; SHA `ca693ee9a4916e82c0ab659d0277e640b634d21882e715f52036557a7de58e4c`. | No | Historical Group B evidence. | Executor after-state assertions bound this to authorized-epoch routing. |
| D36 | Exit; drain active adapter, debit owner liability/principal and create unwrap request. | `ALREADY_EXECUTED` | `0xef7a220149b3f31ddbb57fffb70c6a47843c7ac5c854f3b05ffa810c4d67f0b2`; status `1`; `LokVault.exit`; block `11487531`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D36.json`; SHA `b4240664de1fc9ef5e706e15414865e40464e62936680e34e0b9c732681491c7`. | No | Historical Group B evidence. | This began final custody recovery and produced the exit public-decryption data used by D37. |
| D37 | Finalize exit; return all test underlying assets and clear participant state. | `ALREADY_EXECUTED` | `0xebe4b9fc0828dcb8b8e3c90c70d6ee6ca24baa41a5dd419b55b40a7505b26f64`; status `1`; `LokVault.finalizeExit`; block `11487533`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D37.json`; SHA `c1376fb18a015c764f842bbdcdab409ee80dfa63a4c9bc616bf9003fa175fa7c`. | No | Historical Group B evidence. | Test custody was recovered and participant cleanup completed. |
| D38 | Open final zero-liability solvency checkpoint. | `ALREADY_EXECUTED` | `0xc9897ce55d35fe483a6a520b6b9f7b49fb768b48f2ae91e728bdb060635a607d`; status `1`; `LokVault.openSolvencyCheckpoint`; block `11487534`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D38.json`; SHA `0de9980b2829ab2c6f9441c83b7ff3c265dbc56169618ad6717edb5d659271bb`. | No | Historical Group B evidence. | This opened the final clean-state checkpoint for D39. |
| D39 | Submit final true checkpoint; require unrestricted, no pending checkpoint/exit, no retiring adapter and empty fixture custody. | `ALREADY_EXECUTED` | `0xaaae7b62be26347854b60ceb5cb8f119b93210797fcc349242c93b60032983bc`; status `1`; `LokVault.submitSolvencyCheckpoint`; block `11487536`; `artifacts/sepolia/p-s2-groups-2026-08-13/receipts/D39.json`; SHA `15a9bb3a7271c7f7c34e0a8eb5b3f3f7c57e143b975a87f9dd69933d2d0774b9`. | No | Historical Group B evidence. | Current on-chain dedicated state is clean: `participantCount == 0`, no pending checkpoint, unrestricted, `riskEpoch == lastSolventRiskEpoch == 3`, no retiring adapter. |

## Proposed New Deployment Transactions

The predicted addresses below assume the current read-only owner nonce stays at `349`. They are not final binding data.
Fresh preflight must recompute them immediately before execution.

| Step | Contract/address | Function | Sender | Preconditions | Expected state transition | Expected receipt/event | Gas ceiling | Negative-case expectation |
|---|---|---|---|---|---|---|---:|---|
| D01 | `MockUSDC` / predicted `0x4a1936B6533048a319a7742211872138B509c5D7` | constructor | `0x8e7939E23a012143e5182d7173DAD42B2006c2b8` | Sepolia chain `11155111`; nonce `349`; predicted address empty; bytecode hash matches artifact. | Deploy underlying test token. | Receipt status `1`; contract address equals prediction if nonce unchanged. | 700,000 | None. |
| D02 | `YieldInjectingERC7984` / predicted `0xf199649603B36b0278BF4eFF89aab5c6EfB6e8c4` | constructor | same | D01 mined; wrapper constructor arg is D01 address; nonce `350`; predicted address empty. | Deploy confidential wrapper bound to D01. | Receipt status `1`; runtime hash matches artifact. | 3,600,000 | None. |
| D03 | `MockYieldAdapter` / predicted `0x35d0aDD9F37b2D8025881c12749315D8C85681e0` | constructor | same | D02 mined; args `(D02, owner)`; nonce `351`; predicted address empty. | Deploy unbound adapter. | Receipt status `1`; runtime hash matches artifact. | 1,350,000 | None. |
| D04 | `LokVault` / predicted `0x834933C7bFEF21B134FfB1F6c952Edc7720fD312` | constructor | same | D03 mined; args `(D02, D03, owner)`; nonce `352`; predicted address empty. | Deploy vault with active adapter pointer. | Receipt status `1`; runtime hash matches artifact. | 5,900,000 | None. |
| D05 | `LokDrawManager` / predicted `0xec9A5362a8667a37cE57B070D4f065d9798a367a` | constructor | same | D04 mined; args `(D04, owner, 60, 24, 120, 300)`; nonce `353`; predicted address empty. | Deploy draw manager with minimum-safe timing. | Receipt status `1`; getters return `60/24/120/300`. | 5,700,000 | None. |
| D06 | D03 adapter | `setVault(D04)` | same | D01-D05 mined; adapter currently unbound. | Adapter `vault` becomes D04. | Receipt status `1`; `VaultBound` or equivalent binding event. | 70,000 | None. |
| D07 | D04 vault | `setDrawManager(D05)` | same | D05 mined; vault draw manager is unset. | Vault `drawManager` becomes D05. | Receipt status `1`; `DrawManagerSet` or equivalent binding event. | 70,000 | None. |
| D08 | D04 vault | `openSolvencyCheckpoint()` | same | D06-D07 mined; empty vault; no pending checkpoint. | Pending initial aggregate solvency handle is created. | Receipt status `1`; `SolvencyCheckpointOpened`. | 400,000 | None. |
| D09 | D04 vault | `submitSolvencyCheckpoint(epoch, nonce, clearValues, proof)` | same | D08 mined and the required aggregate public-decryption response has been obtained. | Initial empty-vault checkpoint becomes authorized; no pending checkpoint. | Receipt status `1`; `SolvencyCheckpointSubmitted` or equivalent. | 500,000 | None. |

No negative-case transaction belongs in the new 9-step deployment. Shared/demo deployments are therefore not used for a
new negative case. The public-decryption dependency between D08 and D09 is the blocking discrepancy.

## Budget Derivation

- Transaction count: `9`.
- Sum of transaction ceilings:
  `700,000 + 3,600,000 + 1,350,000 + 5,900,000 + 5,700,000 + 70,000 + 70,000 + 400,000 + 500,000 = 18,290,000`.
- Hard gas stop: `18,500,000`.
- Margin to hard stop: `210,000` gas.
- ETH cap: `0.05 ETH`.
- Admission gas price ceiling: `floor(0.05 ETH / 18,500,000 gas) = 2,702,702,702 wei`.
- Worst-case transaction gas spend at that admission ceiling:
  `18,500,000 * 2,702,702,702 = 49,999,999,987,000,000 wei = 0.049999999987 ETH`.
- Current read-only balance: `2.702175908700773413 ETH`.

This budget covered host-chain transaction gas only. The mandatory public-decryption request was executed off-chain
between D08 and D09 and did not consume Sepolia gas.

## Execution Evidence

The approved minimum-timing deployment executed with the expected Sepolia addresses and receipts. The off-chain
`fhevm.publicDecrypt([checkpointHandle])` request occurred between D08 and D09; it has no Sepolia tx hash and is not
counted in the gas cap.

| Step | Address / target | Tx hash | Status | Block | Gas used |
|---|---|---|---|---:|---:|
| D01 | `0x4a1936B6533048a319a7742211872138B509c5D7` | `0xd550f2ef09b8caffea6d841fe67489146693e4e00fe469f4b427f2c53f66faf3` | `1` | `11488910` | `505630` |
| D02 | `0xf199649603B36b0278BF4eFF89aab5c6EfB6e8c4` | `0x1a4e9d4b2604092fd63e9883e3d73c39927efaae2317cf50775f32b306185771` | `1` | `11488911` | `2624045` |
| D03 | `0x35d0aDD9F37b2D8025881c12749315D8C85681e0` | `0xe4b6f2d56b91f9f5d5a7642a7d6f23af1e656f9259154e86d6791fb16b007ac4` | `1` | `11488912` | `984334` |
| D04 | `0x834933C7bFEF21B134FfB1F6c952Edc7720fD312` | `0xbb7cf80a03a6d5d3af6264be3993df5636a08956b07bd9a68879264ce9f12a4e` | `1` | `11488913` | `4341166` |
| D05 | `0xec9A5362a8667a37cE57B070D4f065d9798a367a` | `0x159cb433a8a17e499ff4f583f6353def2499b6f296b48f5fa0659aea4a26811e` | `1` | `11488914` | `4159276` |
| D06 | `MockYieldAdapter.setVault(0x834933C7bFEF21B134FfB1F6c952Edc7720fD312)` | `0xcbce063e6c8ec23b9636bdf2669827616ebe1a0f03d1fb1465d69de2d27d518c` | `1` | `11488915` | `47363` |
| D07 | `LokVault.setDrawManager(0xec9A5362a8667a37cE57B070D4f065d9798a367a)` | `0x61ad82c8f636667792109e13f594fc0f0e22f8078d4dda55eeff363ca2628712` | `1` | `11488916` | `47437` |
| D08 | `LokVault.openSolvencyCheckpoint()` | `0xc91143f8d0542c6c364df5a05fd97050ebb3f40cfc5bda28a5a32bbf6b36a9bc` | `1` | `11488917` | `293181` |
| D09 | `LokVault.submitSolvencyCheckpoint(...)` | `0x11ec4dc96722fbd5f9763a48cbc096734da93b31ef53a3a379b0d136a8ef6846` | `1` | `11488918` | `369140` |

Actual state-changing gas used: `13,371,572`.

Evidence file SHA-256:

| File | SHA-256 |
|---|---|
| `deployments/sepolia.json` | `05A366CCC207D75AB21CDBB69F836B4607DDEB23595775E3833468FABD2542D0` |
| `deployments/sepolia/LokMinimumTimingAdapterVaultBinding.json` | `EBE36619919948A9F376EE8C648A76F2DA5803CF2EB83E8E4A45D2BEBF929418` |
| `deployments/sepolia/LokMinimumTimingDrawManagerBinding.json` | `BC71EA65F72ED79C6FC05F391D35AB5CEB97DF5769F2BE8B4C148A36842C65FB` |
| `deployments/sepolia/LokMinimumTimingSolvencyCheckpointOpen.json` | `DE7E27675C2CC0A66D7620CCD154D0D582740CEECC186309808918AB1A6CB88A` |
| `deployments/sepolia/LokMinimumTimingSolvencyCheckpointSubmit.json` | `F525278848A58FB2FB97973F576B6251394004E01C5A01F129C51D6D558E3A4D` |
| `deployments/sepolia/LokMinimumTimingMockUSDC.json` | `B30A104D9EF5F606041BBC2630F0B6ADFB6F0AF71E00F1C3042CF22D0D125168` |
| `deployments/sepolia/LokMinimumTimingConfidentialToken.json` | `6E0ED6B2ECA1A5F7B9C72E5CD647827BEBEBB248E50AC86E7C47EB5A66C33C08` |
| `deployments/sepolia/LokMinimumTimingMockYieldAdapter.json` | `105E3A68816B99B646C52A705319DBC121E6E17AD8D07B7BFB2D800C6EF61435` |
| `deployments/sepolia/LokMinimumTimingVault.json` | `9F89C213B80BF3100B7EA897AD15904CE99CD1FDD926A2F7EF3B72012F67F6DF` |
| `deployments/sepolia/LokMinimumTimingDrawManager.json` | `C9D5E6D395F534249C4656615BF4E3945660E460C125EC592ECEE2F370CA9B8C` |

## Deployment And Archive Provenance

- Archive file: `deployments/history/sepolia-2026-08-13-120-30-180-600.json`.
- Archive SHA-256: `684FEEA38BA6FE2078735D745879EFB38014763AB3DBEB82A926C9D3D69C3AE4`.
- Archive content matches the current canonical `deployments/sepolia.json` at reconciliation time.
- Archive network and timing: Sepolia `11155111`, `120/30/180/600`.
- Archive owner: `0x8e7939E23a012143e5182d7173DAD42B2006c2b8`.
- Archive source provenance: `source-sha256:6ea1f1481efb587d6201531de69f72df07b901329a0934c6e05f5e4bd8af29ed`.
- Current source commit for the minimum-timing manifest: `c3df5b581255fa267e7feba13804f1ed4347c7a5`.
- Executor commits checked: `51c0b014e726066cfc1c6e61346a55b14e70ea3e` and
  `d46fc93b2dbb520bb3860bd4db0f1e94d45149f8`.

All five archive contract addresses still have bytecode and their runtime hashes match the archive. All five deployment
receipts and four configuration receipts exist on Sepolia with receipt status `1`.

## Read-Only Preflight Result

- Chain ID: `11155111`.
- Latest block: `11488722`.
- Latest block timestamp: `1786729440`.
- Operator nonce: latest `349`, pending `349`; no pending nonce collision observed.
- Operator balance: `2.702175908700773413 ETH`.
- Fee data: `maxFeePerGas = 2,098,340,402 wei`, below the derived transaction-gas admission ceiling.
- Predicted CREATE addresses for nonce `349-353` are currently empty.
- Group B timelock: `activateAfter = 1786714152`; current timestamp `1786729440`; timelock elapsed.
- Evidence sidecars checked: `120`; mismatches `0`.
- Frozen `docs/10-proof-strategy.md` section 3: zero diff.

## Resolved Findings

1. Fresh preflight was rerun immediately before D01 and the deployed addresses matched the nonce-derived predictions for
   D01-D05.
2. The mandatory public-decryption request was executed between D08 and D09 and did not consume Sepolia gas.

## Owner Authorization Conditions

The later owner message explicitly authorized all of the following:

- The 9 state-changing transactions listed above.
- Hard gas stop `18,500,000`.
- Transaction-gas ETH cap `0.05 ETH`.
- Admission ceiling `maxFeePerGas <= 2,702,702,702 wei`.
- The single aggregate public-decryption request required between D08 and D09.
- Fresh preflight immediately before D01.

## Execution Stop Conditions

Stop before or during execution if any condition below occurs:

- Chain ID is not Sepolia `11155111`.
- Signer is not `0x8e7939E23a012143e5182d7173DAD42B2006c2b8`.
- Latest/pending nonce changes without recomputing the manifest assumptions.
- Predicted deploy address is non-empty before its deployment.
- Bytecode artifact hash, constructor argument, runtime hash, binding, timing getter, or checkpoint state differs from
  this report and manifest.
- `maxFeePerGas` exceeds `2,702,702,702 wei` unless the owner approves a revised cap.
- Any receipt has unexpected status, gas exceeds per-step ceiling, projected spend exceeds cap, or public-decryption API
  behavior differs from `docs/API-VERIFIED.md`.

## Verdict

`READY_FOR_REVIEW`
