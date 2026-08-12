# Confidential Solvency Checkpoint Design

**Status:** Design approved by the human reviewer on 2026-08-08. Authoritative proposition wording is under re-review
and is not frozen by this document.

**Decision:** Replace plaintext per-deposit principal accounting with separate encrypted principal/liability accounting
and publish only an aggregate solvency boolean at explicit accounting checkpoints.

## 1. Problem

The frozen P-S2/I11 formulation requires a plaintext `totalPrincipal` to be updated after every deposit and withdrawal.
ERC-7984 returns the amount actually moved as `euint64`. Converting that value to `uint256` would require public
decryption of a per-user transaction delta or a duplicate plaintext amount. Either path violates confidential deposit
and withdrawal semantics.

The existing adapter interface has the same mismatch: it accepts plaintext amounts even though the vault receives and
accounts for confidential cUSDC. The deployed Sepolia path must not unshield user principal or introduce plaintext
per-user deltas merely to route assets.

## 2. Chosen Model

### 2.1 Encrypted principal and liability ledgers

The vault stores a claimable `_balance` and a separate `_principalBalance` per user, plus `encryptedTotalLiability` and
`encryptedTotalPrincipal` as `euint64` aggregates:

- Deposit adds the `euint64 moved` returned by `confidentialTransferFrom` to both user ledgers and both aggregates.
- Withdraw, withdraw-all, exit, and emergency-withdraw subtract `moved` from claimable balance/liability, but subtract
  only `min(moved, principalBalance)` from user/aggregate principal.
- Prize and direct-yield credits increase claimable balance/liability only and are bounded by realised cUSDC yield.
- Every stored result receives `FHE.allowThis`; no non-vault role receives access.

This principal-first withdrawal rule prevents a user's earnings withdrawal from erasing another user's principal. The
identities `sum(balance) = encryptedTotalLiability` and `sum(principalBalance) = encryptedTotalPrincipal` are maintained
by construction. ERC-7984's encrypted total supply is itself `euint64`; because every liability is funded by conserved
cUSDC already in custody, assets, liabilities and principal all remain below `2^64`.

### 2.2 Draw-scoped funded credits

The cumulative `yieldIndex/userYieldIndex` design is rejected: if a user skips one harvest, their later larger
cumulative weight can be multiplied by an older index increment and over-credit yield. Direct yield is instead allocated
exactly once from each draw's `tEnd` snapshot.

PASS A computes normalized encrypted `baseRiskWeight_i` and `yieldWeight_i`, stores
`directWeight_i = yieldWeight_i - baseRiskWeight_i`, applies the bounded Fortune boost only to `effectiveWeight_i`, and
publicly decrypts aggregates `E = sum(effectiveWeight)`, `B = sum(baseRiskWeight)` and `W = sum(yieldWeight)`.
Normalization includes the theta denominator in base risk, so `baseRiskWeight_i <= yieldWeight_i`; at default theta 4
those two values are exactly equal. `E - B` discloses bounded pool-level Fortune movement but no per-user decomposition;
this approved residual is threat-model S8.

After realised cUSDC yield `Y` reaches custody, plaintext `prizeAmount = floor(Y*B/W)` and
`directRate = floor((Y*2^32)/W)`. PASS B uniformly computes `directCredit_i = floor(directWeight_i*directRate/2^32)` and
the encrypted winner credit. The inequalities `sum(directCredit) <= Y*(W-B)/W` and `prizeAmount <= Y*B/W` prove total
credits cannot exceed `Y`; rounding residue stays in the vault. Winner intervals and modulo use `E`, so Fortune changes
probability but never funding. `W == 0` voids before division. `W > 0 && E == 0` skips randomness but still runs PASS B
for direct credit.

### 2.3 Confidential asset custody

The deployed Sepolia adapter path keeps principal in ERC-7984 cUSDC form. The adapter interface accepts encrypted
transfer amounts and exposes an encrypted aggregate asset handle to the vault. No deployed path converts an individual
deposit or withdrawal into plaintext USDC.

`MockYieldAdapter` is the deployed demo adapter. It must:

- custody cUSDC through ERC-7984 transfers;
- grant the calling vault transient ACL access to its current aggregate asset handle on every read;
- have no owner, keeper, or guardian function that can transfer principal;
- model yield as additional cUSDC supplied to the adapter, separately from principal; and
- return funds synchronously so withdrawal and emergency withdrawal do not depend on the decryption oracle.

For the deployed demo fixture, yield funding is atomic: the immutable cUSDC asset contract mints the public aggregate
amount to the adapter as `FHE.asEuint64(amount)` and calls `notifyYield(amount)` in the same transaction. Only the asset
contract may notify. No owner or keeper can label existing principal as yield. If a full-balance recovery moves funded
yield into the vault before harvest, the adapter records its location and reports it exactly once without a second
transfer.

`MorphoVaultAdapter` remains written and tested only if the live Morpho target supports a compatible confidential asset
path. It is not deployed. If Morpho requires unshielded plaintext amounts, the adapter is marked incompatible rather
than weakening confidentiality.

### 2.4 Accounting version and risk epoch

Two plaintext monotonic counters have different jobs:

- `accountingVersion` increments whenever principal, claimable liability or custody location changes. It identifies the
  exact encrypted snapshot and handle used by a checkpoint, but it does not invalidate a checkpoint when only
  proven-safe user/funded-credit flows have occurred.
- `riskEpoch` starts at 1 and increments only when a custody/risk assumption changes, including adapter activation,
  adapter removal, or another approved risk-boundary configuration transition. A checkpoint authorizes exactly one
  `riskEpoch`.

Deposits, withdrawals and funded credits do not wait for a checkpoint. Deposits and withdrawals preserve solvency using
the actual ERC-7984 `moved` value and the principal-first debit rule; funded credits consume only realised yield.
Lossless ERC-7984 routing between already-approved custody locations has the same closure property. These transitions
increment `accountingVersion` but not `riskEpoch`, so actions after `tEnd` cannot invalidate draw authorization or stall
settlement. Operations that add or change a risk boundary require a successful checkpoint for the current `riskEpoch`:

- adapter activation;
- enabling an adapter for future deposits;
- removing an old adapter from the custody set;
- draw prize sizing or settlement when it relies on recoverable yield; and
- any custody/configuration change not already covered by the lossless-transfer proof. A non-lossless rebalance is not
  authorized by a checkpoint; it is unsupported.

The custody set is bounded to the active adapter and at most one retiring adapter. Adapter activation affects future
routing only. Existing assets remain attributable to the old adapter until a permissionless `withdrawAllToVault()`
transfers the adapter's full ERC-7984 balance back to the vault. Removal then requires a current `isSolvent` checkpoint.
Exact zero is established by the verified full-balance transfer semantics, not by publicly decrypting a second boolean.
This avoids an unbounded adapter loop and keeps the public-decryption allowlist unchanged.

### 2.5 Solvency checkpoint

For accounting snapshot `v` in risk epoch `e`, the vault computes encrypted aggregate assets from its cUSDC balance and
the bounded adapter custody set, then computes:

```text
isSolvent_(e,v) = encryptedVaultAssets_(e,v) >= encryptedTotalLiability_(e,v)
```

Only the resulting `ebool isSolvent_e` is marked publicly decryptable. Neither operand, either numeric total, nor any
per-user value is marked publicly decryptable.

The checkpoint flow is caller-initiated and permissionless:

1. `openSolvencyCheckpoint()` records `riskEpoch`, `accountingVersion`, the `isSolvent` handle, and a checkpoint nonce.
2. An off-chain caller requests public decryption for that exact handle.
3. `submitSolvencyCheckpoint(riskEpoch, nonce, abiEncodedCleartext, proof)` verifies the proof on-chain with the API
   recorded in `docs/API-VERIFIED.md`.
4. A result is stale only if its handle/nonce is wrong or `riskEpoch` changed. A later `accountingVersion` caused solely
   by proven-safe user/custody flows does not invalidate it, because those transitions preserve the boolean's truth.
5. A valid `true` result records `lastSolventRiskEpoch = riskEpoch` and clears restricted mode.
6. A valid `false` result enters restricted mode; new draws, rebalances, and adapter changes stop, while deposit,
   withdraw, exit, and emergency-withdraw remain callable in accordance with I2.
7. A forged proof, wrong handle, stale risk epoch, duplicate nonce, or malformed cleartext reverts.

If the decryption oracle is permanently unavailable, no new risk-increasing transition can execute. Principal-recovery
functions remain available because they do not depend on checkpoint completion.

## 3. Adapter and Withdrawal Safety

The vault never assumes the requested confidential transfer amount moved. Every credit and debit uses the returned
`moved` handle. Effects are committed only after the transfer result is available, and all external entry points are
protected against reentrancy.

Withdrawals first clamp the request to `min(requested, balance[user])`, then use vault liquidity and request cUSDC from
the active and retiring adapters in a fixed bounded sequence. Claimable balance and total liability decrease by the
amount actually delivered; principal decreases only by the encrypted `min(moved, principalBalance)`. There is no
encrypted-value branch; selection and clamping use FHE operations.

The safety claim retains the documented platform and venue trust boundary: ERC-7984 conserves the token amount it
reports, and an enabled adapter does not lose or seize principal outside Lok transitions. An adapter that cannot satisfy
this boundary is not eligible for deployment.

## 4. Required Re-review

The following text is proposed for human review. It is not applied to the frozen proposition table by this design
document.

### I11 candidate

After every completed Lok transition, aggregate assets cover aggregate claimable liabilities, which cover aggregate
principal. Deposits and withdrawals use the ERC-7984 amount actually moved, principal debits are capped to the user's
remaining principal, and yield/prize credits consume only realised funded yield. These flows carry a verified solvency
base case forward within the same `riskEpoch`. A transition that adds or changes a custody/risk boundary requires a
valid `true` public-decryption proof for the current `riskEpoch`; invalid, false, forged, or risk-stale proofs cannot
authorize it.

### P-S2 candidate

For every deposit, withdrawal, exit, emergency-withdrawal, funded-credit, draw, and adapter transition,
`aggregateAssets >= aggregateLiabilities >= aggregatePrincipal` is preserved. Deposits add the same `moved` value to all
three; withdrawals subtract `moved` from assets/liability and only `min(moved, principalBalance)` from principal;
realised-yield credits increase liability only within their funded budget. These proven-safe flows do not invalidate a
checkpoint in the same `riskEpoch`, including after `tEnd`. Risk-boundary transitions are enabled only for the current
`riskEpoch` with an on-chain-verified `true` aggregate solvency result; false, forged, risk-stale, or wrong-handle
results cannot authorize them. Oracle unavailability blocks risk transitions but not principal recovery.

Suggested evidence remains hybrid:

- Tier A: hand proof plus Foundry invariant campaign over a plaintext reference model of the encrypted accounting
  relation, including malicious-token and adapter handlers.
- FHE integration: Hardhat mock-mode and Sepolia tests confirm handle ACL, exact handle/risk-epoch/nonce proof binding,
  false/forged/risk-stale rejection, and ERC-7984 returned-amount semantics.
- Tier B dependency: the existing TLA+ liveness properties confirm oracle failure cannot block recovery; TLC is not used
  to claim numeric solvency.

### I4 candidate addition

The public-decryption allowlist contains effective-ticket, base-risk and yield-weight aggregate handles, the completed
draw's aggregate prize-credit sum, post-settlement randomness, and the aggregate solvency boolean only. The prize-credit
sum is exposed only after PASS B processes the full participant snapshot. Effective minus base reveals the accepted
bounded pool-level Fortune boost. Numeric aggregate principal, liability, assets, per-user values, intermediate
settlement aggregates, and transaction deltas are never publicly decryptable.

### P-P7 candidate adjustment

Per-user Fortune is never publicly decryptable or granted to a non-owner, and winner/loser execution remains uniform.
The only Fortune-derived public information is the bounded aggregate difference between effective tickets and base risk;
there is no per-user decomposition, draws enforce `MIN_PARTICIPANTS`, and residual statistical inference is documented
as threat-model S8.

### P-P8 candidate addition

No persistent per-user ciphertext class or numeric principal/liability/asset aggregate is passed to
`makePubliclyDecryptable`. The static allowlist contains only the three named draw-weight aggregates, the fully-settled
aggregate prize-credit sum, post-settlement randomness, and the checkpoint-specific aggregate `isSolvent` boolean.

### P-A8 dependency clarification

Adapter activation still requires IDLE and the timelock. It additionally requires `lastSolventRiskEpoch == riskEpoch`;
activation changes future routing only, increments `riskEpoch`, and cannot route new deposits out of the vault until the
new epoch has a verified `true` checkpoint. A retiring adapter cannot be removed until its full-balance return has
completed and the current risk epoch is authorized.

## 5. API De-risking Gate

Before contract implementation, a minimal Hardhat and Sepolia spike must verify and record in `docs/API-VERIFIED.md`:

- whether the vault can use the `euint64` returned by `IERC7984.confidentialBalanceOf(vault)` in FHE arithmetic and
  which ACL grants are required;
- how an adapter grants the calling vault transient access to its encrypted aggregate asset handle in the same
  transaction;
- exact `ebool` support for `FHE.makePubliclyDecryptable`, handle extraction, public decryption, and on-chain proof
  verification at the installed package versions;
- exact ABI encoding of the decrypted boolean and rejection behavior for false, forged, malformed, stale, and
  wrong-handle submissions; and
- whether a lossless cross-contract ERC-7984 transfer preserves usable ACL on the returned `moved` handle; and
- whether an adapter can pass its full confidential balance to `confidentialTransfer`, receive the exact `moved` result,
  and thereby establish a zero remaining balance by ERC-7984 conservation without a separate public decryption.

A documented API mismatch is GATE 3. Failure to establish a confidential adapter asset path is GATE 2, because falling
back to plaintext amounts would violate the approved confidentiality model.

## 6. Verification Matrix

| Claim                                              | Primary evidence                                | Required failure cases                                             |
| -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| Principal/liability ledgers follow token movement  | Unit, fuzz, invariant                           | Clamp, zero/partial move, earnings-only withdrawal, reentrancy     |
| Solvency relation is transition-preserved          | Hand proof and >=10^7 reference-model sequences | Every entry point, rounding boundary and malicious adapter action  |
| Checkpoint proof is exact and current              | Hardhat FHE integration and Sepolia transaction | False, forged, stale epoch, wrong handle, duplicate, malformed ABI |
| Oracle failure does not trap principal             | TLA+ plus integration test                      | Oracle permanently down in every draw state                        |
| Public decryption leaks no numeric accounting data | Static allowlist and log/ABI scan               | Direct and indirect `makePubliclyDecryptable` call sites           |
| Adapter swap preserves custody                     | TLA+ plus Foundry/Hardhat tests                 | Non-IDLE, before timelock, stale checkpoint, non-empty removal     |

## 7. Consequences

- The UI replaces the continuously computed plaintext backing ratio with a truthful checkpoint status:
  `Verified solvent for risk epoch E`, `Verification pending`, or `Recovery only`. It must not display a numeric total
  principal.
- Draw and adapter automation must understand the checkpoint lifecycle and cannot treat delayed public decryption as an
  error that blocks withdrawals.
- The deployed Sepolia system uses `MockYieldAdapter`; Morpho compatibility is evidence-only and cannot delay the
  confidential demo path.
- The frozen proposition count remains unchanged unless the human reviewer explicitly approves edits. This redesign
  changes wording and evidence boundaries; it does not silently add product scope.
