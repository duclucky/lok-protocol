# 05 — Contract Specifications

Function-level detail. Architecture and rationale are in `docs/02-architecture.md`; do not implement from this document
without having read that one, or you will make locally reasonable choices that break the system's invariants.

Signatures marked **[VERIFY]** depend on API details that must be confirmed and recorded in `docs/API-VERIFIED.md`
first.

---

## 1. `LokVault.sol`

Confidential accounting: deposits, withdrawals, the risk dial, eTWAB accumulators, lazy yield credit. Holds no draw
logic.

### Configuration and storage

```solidity
// [VERIFY] exact config contract name/path
contract LokVault is SepoliaConfig, Ownable2Step {
  IERC7984 public immutable cToken; // confidential USDC
  address public drawManager; // set once

  uint8 public constant THETA_DENOM = 4;
  uint8 public constant TICKET_SCALE_BITS = 26;
  uint128 public constant RATE_CAP = 1 << 52;

  mapping(address => euint64) private _balance; // total claimable principal + funded earnings
  mapping(address => euint64) private _principalBalance;
  mapping(address => euint128) private _accTickets;
  mapping(address => euint128) private _accYield;
  mapping(address => euint128) private _rate;
  mapping(address => euint8) private _theta;
  mapping(address => uint64) public lastUpdate;
  mapping(address => euint128) private _ckptTickets;
  mapping(address => euint128) private _prevCkptTickets;
  mapping(address => euint128) private _ckptYield;
  mapping(address => euint128) private _prevCkptYield;
  mapping(address => uint64) public ckptDrawId;

  address[] public participants;
  mapping(address => uint256) public participantIndex; // 1-based, 0 = absent

  euint64 private _encryptedTotalPrincipal; // sum of remaining principal; never public-decrypt
  euint64 private _encryptedTotalLiability; // sum of claimable balances; never public-decrypt
  uint64 public accountingVersion;
  uint64 public riskEpoch; // initialized to 1; zero means no epoch has been verified
  uint64 public lastSolventRiskEpoch;
  uint64 public pendingSolvencyRiskEpoch;
  uint64 public pendingSolvencyAccountingVersion;
  uint64 public solvencyCheckpointNonce;
  ebool private _pendingSolvencyResult; // allowlisted aggregate boolean only
  bool public restricted;

  IYieldAdapter public activeAdapter;
  IYieldAdapter public retiringAdapter; // at most one; zero address if absent
}
```

### `deposit`

```solidity
function deposit(externalEuint64 encAmount, bytes calldata inputProof) external;
```

1. `_syncUser(msg.sender)` — **always first**, before any state changes.
2. `euint64 amount = FHE.fromExternal(encAmount, inputProof)`.
3. Pull funds: confidential transfer of `cToken` from the caller to this contract. The caller must have approved this
   contract as an operator beforehand. **[VERIFY]** the exact ERC-7984 operator and `confidentialTransferFrom` semantics
   against `@openzeppelin/confidential-contracts`.
4. Clamp the credited amount to what actually moved. The ERC-7984 transfer returns the transferred amount as `euint64`;
   credit **that** value, never the requested one. A transfer short of the request fails silently (forbidden pattern
   F1), and crediting the request would mint value from nothing. This is the most dangerous line in the contract.
5. Add the same `moved` handle to `_balance[msg.sender]`, `_principalBalance[msg.sender]`, `_encryptedTotalLiability`
   and `_encryptedTotalPrincipal`; increment `accountingVersion`. Never decrypt or duplicate the amount in plaintext.
6. `_recomputeRate(msg.sender)`.
7. `_enrol(msg.sender)` if not already a participant.
8. Route cUSDC to the active adapter only when `lastSolventRiskEpoch == riskEpoch`; otherwise retain it in the vault.
   Principal does not change and the transfer is lossless by verified ERC-7984 semantics. Increment `accountingVersion`
   if custody moved; do not increment `riskEpoch` for movement within an already-approved custody set.
9. ACL: `allowThis` on every stored handle; `allow(balance, msg.sender)`.
10. `emit Deposited(msg.sender)` — **no amount, encrypted or otherwise, in the event**.

Callable in every draw state (invariant I2).

### `withdraw` and `withdrawAll`

```solidity
function withdraw(externalEuint64 encAmount, bytes calldata inputProof) external;
function withdrawAll() external;
```

Same discipline: sync first, compute `available = FHE.min(requested, _balance[msg.sender])`, request only that bounded
cUSDC liquidity from the active and retiring adapters, transfer at most `available` confidential `cToken` out, and
decrement `_balance[msg.sender]` and `_encryptedTotalLiability` by the `moved` amount ERC-7984 reports as actually
delivered. Compute `principalDebit = FHE.min(moved, _principalBalance[msg.sender])`, then subtract that encrypted value
from both `_principalBalance[msg.sender]` and `_encryptedTotalPrincipal`. This principal-first rule prevents prize/yield
withdrawals from erasing another user's principal and prevents aggregate underflow. Recompute rate, increment
`accountingVersion`, and update ACL on every persisted handle. No plaintext amount and no oracle response is required.

Requirements: no state guard of any kind; over-requesting cannot move more than the caller's encrypted claimable
balance; the user remains in `participants` because an encrypted balance cannot be tested against zero (invariant I7);
the withdrawn amount stays encrypted throughout, so this path never publishes a figure.

Return or store an **encrypted status** indicating whether the full requested amount moved, so the UI can distinguish
"withdrew everything you asked for" from "withdrew what you had".

### `setTheta`

```solidity
function setTheta(externalEuint8 encTheta, bytes calldata inputProof) external;
```

1. `_syncUser(msg.sender)` — closes the segment under the old θ before the new one applies. Omitting this misattributes
   ticket weight and is a silent correctness bug.
2. `euint8 t = FHE.fromExternal(encTheta, inputProof)`.
3. Clamp to the valid range: `t = FHE.min(t, FHE.asEuint8(THETA_DENOM))`. Never trust a client-supplied encrypted value
   to be in range; you cannot `require` on it.
4. Store, `_recomputeRate`, `allowThis`, `allow(theta, msg.sender)`.
5. `emit ThetaChanged(msg.sender)` — the value must not appear.

Note that the _event_ reveals that a user changed their dial, even though the value stays hidden. Record this in
`docs/08-threat-model.md`; with frequent changes it becomes a weak side channel.

### `exit`

```solidity
function exit() external;
```

Sync, unshield the full confidential balance back to public ERC-20, and apply the same actual-`moved` liability and
principal-first debit rules as `withdrawAll`. When the draw machine is IDLE, remove the address from `participants` by
swap-and-pop and clear `participantIndex`. During an active draw, mark removal pending and keep the array slot stable;
anyone may finalize the removal after IDLE. A later deposit or uniform draw credit cancels the pending removal. A
partial move leaves the participant enrolled. Unshielding inherently publishes the amount — that is a property of
returning to a transparent token, not a flaw here. The UI must state it before the user confirms.

Removal keeps sweeps cheap. It is the only path that removes a participant.

### `emergencyWithdraw`

```solidity
function emergencyWithdraw() external;
```

The liveness escape hatch for invariant I9. Callable when the draw machine has been stalled past its deadline or the
protocol is paused. Moves the user's confidential balance out using the same actual-`moved` liability and
principal-first debit rules, with no dependency on any decryption, oracle response, or crank progress. Requires no
privileged role.

Test this path explicitly. It is one of the three differentiators and reviewers look for it.

### `_syncUser`

```solidity
function _syncUser(address u) internal;
```

Implement exactly the pseudocode in `docs/02-architecture.md` §5. Ordering requirements:

1. First-touch initialisation returns early — nothing to accrue — but records the current accumulator as the draw
   baseline when the participant first joins during an active window.
2. Before the `tEnd` split, anchor at `tStart` and set `_prevCkptTickets` / `_prevCkptYield` from the current
   accumulators without evaluating the preceding IDLE interval homomorphically.
3. Segment split at `tEnd`, then return without rolling settlement time forward. Only `[tStart,tEnd]` contributes.
4. At the exact `tEnd` split, checkpoint both `_accTickets[u]` and `_accYield[u]`. Direct yield is not credited here; it
   depends on the closed draw's aggregate denominator and is credited uniformly in PASS B.
5. `lastUpdate` written last.

Expose the bounded vault entry point only to the draw manager, then expose a permissionless paginated manager wrapper:

```solidity
function preSync(address[] calldata users) external; // vault: onlyDrawManager
function preSyncA(uint256 batch) external; // manager: permissionless, own cursor
```

`crankA` may not advance beyond `preSyncCursor`. This removes accumulator rolling from PASS A without bypassing the
vault's caller boundary. Final caps come only from the revised measured HCU paths in `docs/04-hcu-budget.md` §3.

### `_recomputeRate`

```solidity
euint128 raw = FHE.mul(FHE.asEuint128(_balance[u]), FHE.asEuint128(_theta[u]));
_rate[u] = FHE.min(raw, FHE.asEuint128(RATE_CAP));    // deliberate saturation
FHE.allowThis(_rate[u]);
```

Called only from `deposit`, `withdraw*` and `setTheta` — never from `_syncUser`, or it becomes the most expensive line
in the system.

### Draw-manager interface

```solidity
function drawWeightsFor(address u) external view returns (euint128 ticketDelta, euint128 yieldDelta);
function drawInputsFor(address u) external returns (euint128 ticketDelta, euint128 yieldDelta, euint16 fortune);
function rollCheckpoint(address u) external; // rolls both previous checkpoints
function creditDraw(address u, euint64 prizeCredit, euint64 directCredit, ebool win) external; // onlyDrawManager
```

`drawInputsFor` is `onlyDrawManager` and non-view because it grants transient ACL for all three handles to the manager;
the view getter alone cannot authorize cross-contract FHE operations. `creditDraw` must be `onlyDrawManager`, add
`prizeCredit + directCredit` to `_balance` and `_encryptedTotalLiability` but never to either principal ledger, and
advance `accountingVersion` uniformly for every participant. It must issue ACL grants for the updated balance, Fortune
and both credit handles to the user — uniformly for every participant (forbidden pattern F6). Fortune updates inside
this same call with `FHE.select(win, 0, min(fortune + 1, FORTUNE_CAP))`.

---

## 2. `LokDrawManager.sol`

The state machine, randomness, and both paginated sweeps.

```solidity
enum DrawState {
  IDLE,
  OPEN,
  SWEEP_A,
  AWAIT_TOTAL,
  REVEAL,
  RANDOM_SET,
  SWEEP_B,
  SETTLED
}
//                                                  ^^^^^^ strict mode only; non-strict skips it
```

### Constructor and immutable timing

```solidity
constructor(
    ILokVault vault_,
    address initialOwner,
    uint64 drawPeriod_,
    uint64 minSettleDelay_,
    uint64 revealWindow_,
    uint64 stateTimeout_
);
```

The four timing values are exposed through the existing uppercase getters `DRAW_PERIOD`, `MIN_SETTLE_DELAY`,
`REVEAL_WINDOW`, and `STATE_TIMEOUT` and cannot be changed after deployment. Construction reverts with
`InvalidAddress()` for a zero vault or owner and with `InvalidTiming()` unless all bounds hold:

```text
60 seconds <= DRAW_PERIOD <= 2^20 seconds
MIN_SETTLE_DELAY >= 24 seconds
REVEAL_WINDOW >= 120 seconds
STATE_TIMEOUT >= 300 seconds
```

The canonical Sepolia demonstration deployment uses `120 / 30 / 180 / 600` seconds. No function may close a draw before
`tEnd`, bypass the settle delay, or generate strict-mode random material before the reveal window closes.

### `openDraw`

```solidity
function openDraw(bool strict) external; // permissionless
```

Requires `IDLE` or `SETTLED`, `restricted == false`, and `vault.lastSolventRiskEpoch() == vault.riskEpoch()`. Safe
deposits/withdrawals after the checkpoint do not invalidate this condition. Sets `tStart = block.timestamp`,
`tEnd = tStart + DRAW_PERIOD`, resets `cursor`, `cumRunning`, `cumBaseRiskRunning` and `cumYieldRunning`, increments
`drawId`, records the `strict` flag immutably for this draw, moves to `OPEN`. The `strict` flag selects the randomness
mode (`docs/02-architecture.md` §9) and is fixed for the life of the draw.

### `commitEntropy` (strict mode)

```solidity
function commitEntropy(bytes32 commitment) external; // during OPEN, strict draws
```

Records `entropyCommit[drawId][msg.sender] = commitment` where `commitment = keccak256(entropy, salt)`. Callable by any
address during `OPEN` of a strict draw. The committed entropy is a **nonce, not secret user data** — it is stored and
later revealed in plaintext, and leaks nothing about balances, θ or odds. Do not encrypt it. Overwriting a prior
commitment before `tEnd` is allowed; after `tEnd` it is frozen.

### `revealEntropy` (strict mode)

```solidity
function revealEntropy(bytes32 entropy, bytes32 salt) external; // during REVEAL
```

Requires state `REVEAL`. Checks `keccak256(entropy, salt) == entropyCommit[drawId][msg.sender]`, then
`revealAcc ^= entropy` and marks the address revealed. Idempotent per address. A participant who does not reveal before
`revealDeadline` is simply dropped — their entropy does not enter `revealAcc`, and this cannot stall the draw
(proposition P-L3). This is a plaintext equality check on non-secret data, so it is an ordinary `require`, not an FHE
branch (invariant I7 is not engaged).

### `crankA`

```solidity
function crankA(uint256 batch) external; // permissionless
```

Guards: state is `OPEN` or `SWEEP_A`; `block.timestamp >= tEnd + MIN_SETTLE_DELAY`; `batch <= BATCH_A_MAX`. On first
call, transition `OPEN → SWEEP_A`.

Per participant in `[cursor, cursor + batch)`:

```
require participant index < preSyncCursor              // keeper calls preSyncA separately
(t128, y128, fortune) = vault.drawInputsFor(u)
baseRisk64 = FHE.asEuint64(FHE.shr(t128, TICKET_SCALE_BITS + 2))
yield64 = FHE.asEuint64(FHE.shr(y128, TICKET_SCALE_BITS))
directWeight[drawId][u] = FHE.sub(yield64, baseRisk64)
f = FHE.min(FHE.asEuint64(fortune), FHE.asEuint64(FORTUNE_CAP))
boost = FHE.min(FHE.div(FHE.mul(baseRisk64, f), 2 * FORTUNE_CAP), FHE.shr(baseRisk64, 1))
effective64 = FHE.add(baseRisk64, boost)
rangeStart[drawId][u] = running
running               = FHE.add(running, effective64)
baseRiskRunning       = FHE.add(baseRiskRunning, baseRisk64)
yieldRunning          = FHE.add(yieldRunning, yield64)
rangeEnd[drawId][u]   = running
vault.rollCheckpoint(u)
FHE.allowThis on range and direct-weight handles
```

PASS A also accumulates an encrypted non-dust count with `FHE.select(yield64 > 0, 1, 0)`. At completion, it masks all
three aggregate totals to encrypted zero unless the count is at least `MIN_PARTICIPANTS = 5`. The count itself is never
publicly decryptable; the existing `W == 0` transition performs the void.

Load all three running totals from storage once at the top and store once at the end. When the cursor reaches
`participants.length`, store `cumRunning`, `cumBaseRiskRunning` and `cumYieldRunning`, mark all three aggregate handles
publicly decryptable **[VERIFY]**, and transition to `AWAIT_TOTAL`.

Before marking them public, apply distinct value-preserving identity operations to the three masked totals. This keeps
the proof tuple at exactly three handles when an empty/all-dust draw makes every clear value zero; otherwise the SDK may
deduplicate identical handles and return a one-word payload.

`cumRunning - cumBaseRiskRunning` exposes only the bounded pool-level Fortune boost. This disclosure is allowlisted by
I4 and documented as side channel S8; neither input is ever granted per user.

Do **not** grant any user access to `rangeStart` / `rangeEnd`. Those handles are internal; a user learning their own
range would learn their exact odds, defeating the discouragement fix that motivates the whole design (invariant I3).

### `submitTotals`

```solidity
function submitTotals(bytes calldata abiEncodedCleartexts, bytes calldata decryptionProof) external; // [VERIFY]
```

Requires `AWAIT_TOTAL`. Builds the ordered handle list
`[effectiveTicketTotalHandle, baseRiskTotalHandle, yieldTotalHandle]`, verifies `abiEncodedCleartexts` and
`decryptionProof` with `FHE.checkSignatures`, then decodes `E`, `B` and `W` only from that verified payload **[VERIFY
exact ABI types/order]**. There are no separate caller-supplied total parameters. A forged ticket total can rig the draw
and a forged yield denominator can over-allocate liabilities.

Then, in plaintext:

```
E = totalTickets
B = totalBaseRiskWeight
W = totalYieldWeight
if W == 0: void without harvesting or dividing
Y = adapter.harvest()
prizeAmount = Y * B / W
directRate  = (uint256(Y) << TICKET_SCALE_BITS) / W
```

Handle `W == 0` (empty or fully dust after normalization): do not harvest or divide; void cleanly, roll any previously
realised residue forward and return to IDLE. If `W > 0` but `E == 0`, set `prizeAmount = 0`, skip randomness/reveal and
enter PASS B in no-winner mode so direct yield is still credited. Never evaluate a zero denominator or modulo.

Transition to `RANDOM_SET` via `openRandom`, or fold that in here provided `MIN_SETTLE_DELAY` has elapsed.

### `enterReveal` (strict mode)

```solidity
function enterReveal() external; // permissionless, strict draws only
```

Requires `AWAIT_TOTAL` resolved and `strict == true`. Sets `revealDeadline = block.timestamp + REVEAL_WINDOW`,
initialises `revealAcc = 0`, transitions `AWAIT_TOTAL → REVEAL`. Non-strict draws skip this and go straight to
`openRandom`.

### `openRandom`

```solidity
function openRandom() external; // permissionless
```

For a non-strict draw, requires the total is set. For a strict draw, requires state `REVEAL` and
`block.timestamp >= revealDeadline` (so all reveals or the timeout have passed).

```solidity
euint64 base = FHE.randEuint64();
euint64 raw  = strict ? FHE.xor(base, FHE.asEuint64(uint64(uint256(revealAcc)))) : base;
r = FHE.rem(raw, totalTickets);        // scalar remainder, plaintext divisor
FHE.allowThis(r);
emit RandomnessCommitted(drawId, FHE.toBytes32(r), block.number);   // [VERIFY] handle accessor
```

Transition to `SWEEP_B`. `r` must never be granted to any user before `SETTLED`. In strict mode, a single honest
revealer makes `r` unbiasable regardless of KMS or other participants (proposition P-F3); the XOR folds the revealed
entropy into the encrypted draw before reduction.

### `crankB`

```solidity
function crankB(uint256 batch) external; // permissionless
```

Guards: state is `SWEEP_B`; `batch <= BATCH_B_MAX`.

Per participant:

```
ebool win = noWinner
  ? FHE.asEbool(false)
  : FHE.and(FHE.le(rangeStart[u], r), FHE.lt(r, rangeEnd[u]))
euint64 prizeCredit = FHE.select(win, FHE.asEuint64(prizeAmount), FHE.asEuint64(0))
euint128 directWide = FHE.mul(FHE.asEuint128(directWeight[drawId][u]), directRate)
euint64 directCredit = FHE.asEuint64(FHE.shr(directWide, TICKET_SCALE_BITS))
vault.creditDraw(u, prizeCredit, directCredit, win)
emit PrizeCredited(drawId, u)            // identical for winners and losers
```

The plaintext `noWinner` branch depends only on public `E == 0`, never ciphertext. Otherwise the half-open interval
gives exactly one participant for any `r` in `[0, totalTickets)`. Zero-risk participants have `rangeStart == rangeEnd`
and can never win, but still receive their uniformly processed direct credit.

When the cursor completes: publicly decrypt `r` for verification **[VERIFY]**, emit `DrawSettled`, transition to
`SETTLED`.

### `abortDraw`

```solidity
function abortDraw() external; // permissionless, after a per-state deadline
```

Returns the machine to `IDLE` without touching balances or accumulators, except that abort is rejected once
`SWEEP_B.cursor > 0`. PASS B writes funded credits to the vault per participant; aborting after a prefix would let batch
boundaries select the credited subset and cannot be rolled back atomically. From that point permissionless `crankB` must
finish settlement, while withdraw and emergency withdrawal remain enabled. This guard is checked in `spec/LokDraw.tla`
under P-O1. Emits `DrawAborted` with the state it aborted from.

### Views for the keeper and the verifier

```solidity
function state() external view returns (DrawState);
function remainingInSweep() external view returns (uint256);
function batchCaps() external view returns (uint256 a, uint256 b);
function drawInfo(uint64 id) external view returns (Draw memory);
```

---

## 3. `IYieldAdapter.sol`

```solidity
interface IYieldAdapter {
  function asset() external view returns (address);
  function confidentialAssets() external returns (euint64);
  function withdrawToVault(euint64 requested) external returns (euint64 moved);
  function withdrawAllToVault() external returns (euint64 moved);
  function harvest() external returns (uint64 realisedYield);
}
```

Principal remains cUSDC and encrypted across the adapter boundary. The vault routes deposits with
`IERC7984.confidentialTransfer`; each `confidentialAssets()` call grants the calling vault transient ACL access to the
current balance handle in that transaction, and transfer functions return encrypted moved handles with the ACL required
by the vault. The asset getter is intentionally non-view because `FHE.allowTransient` updates ACL state. `harvest()` may
report realised aggregate yield in plaintext because draw yield and prize size are public by design, but it must
represent yield actually transferred rather than an asset estimate. Every exact signature and cross-contract ACL
assumption is gated by `docs/API-VERIFIED.md`.

### `MockYieldAdapter.sol` — Sepolia

Deterministic and controllable, because a demo needs reproducibility: cUSDC custody and an exact public aggregate yield
injection during a recorded demo. The cUSDC fixture atomically mints `FHE.asEuint64(amount)` to the adapter and calls
`notifyYield(amount)` in the same transaction. The adapter accepts that notification only from its immutable asset
contract; owner, keeper and guardian cannot declare yield. This binds the public realised-yield amount to cUSDC that was
actually added without decrypting a transfer delta. `withdrawToVault` and `withdrawAllToVault` are vault-only and
synchronous, so recovery does not depend on public decryption. A full-balance return tracks any pending funded yield as
already resident in the vault, preventing a later harvest from transferring or crediting it twice.

### `MorphoVaultAdapter.sol` — mainnet target

Written and tested only if the live target exposes a confidential cUSDC path compatible with this interface; **not
deployed**. If Morpho requires an unshielded plaintext principal amount, mark the adapter incompatible and retain the
documented production path rather than weakening I3/I4 or inventing a plaintext bridge.

---

## 4. Events

Design events as though an adversary indexes all of them, because one will.

```solidity
event Deposited(address indexed user); // no amount
event EntropyCommitted(uint64 indexed drawId, address indexed user); // strict; no value
event EntropyRevealed(uint64 indexed drawId, address indexed user); // strict; entropy is public post-reveal but carries no user financial data
event RevealWindowOpened(uint64 indexed drawId, uint64 deadline); // strict
event Withdrawn(address indexed user); // no amount
event ThetaChanged(address indexed user); // no value
event Exited(address indexed user, uint256 publicAmount); // unshield publishes it anyway
event DrawOpened(uint64 indexed drawId, uint64 tStart, uint64 tEnd);
event SweepProgress(uint64 indexed drawId, uint8 pass, uint256 cursor, uint256 total);
event TotalCommitted(uint64 indexed drawId, uint64 totalTickets, uint64 prizeAmount);
event RandomnessCommitted(uint64 indexed drawId, bytes32 rHandle, uint256 blockNumber);
event PrizeCredited(uint64 indexed drawId, address indexed user); // identical for all
event DrawSettled(uint64 indexed drawId, uint64 rRevealed);
event DrawVoided(uint64 indexed drawId, string reason);
event DrawAborted(uint64 indexed drawId, DrawState fromState);
event SolvencyCheckpointOpened(uint64 indexed riskEpoch, uint64 indexed accountingVersion, uint64 indexed nonce);
event SolvencyCheckpointSubmitted(uint64 indexed riskEpoch, uint64 indexed nonce, bool solvent);
event RestrictedModeEntered(uint64 indexed riskEpoch);
```

`PrizeCredited` firing for every participant with no differentiating field is what makes the winner indistinguishable.
Never add an amount or a boolean to it, however convenient it seems for the frontend.

---

## 5. `LokGuardian.sol`

A minimal multisig whose only power is to abort a stalled draw. It exists so liveness does not depend on a
permissionless-abort race alone, while keeping the guardian incapable of harm (invariant I14, proposition P-A3).

**Deployment decision (2026-08-10): omitted.** No configuration with at least two independent signer addresses and a
threshold of at least two exists for this deployment. Therefore `LokGuardian.sol` is not part of the current contract
set. Lok relies on permissionless deadline abort before funded PASS B starts and permissionless `crankB` after the first
funded credit. Adding a guardian later requires an explicit re-review and a real threshold signer configuration.

```solidity
contract LokGuardian {
  address[] public signers;
  uint256 public threshold;

  function abortStalledDraw(uint64 drawId) external; // requires `threshold` signatures
}
```

Hard constraints, each backed by a test:

- The guardian may call **only** `LokDrawManager.abortDraw` on a draw that is **already past its state deadline** and
  still abortable. It cannot abort a healthy draw, shorten a deadline, or bypass the `SWEEP_B.cursor > 0` guard.
- The guardian has **no** function that touches balances, accumulators, θ, the adapter, or decryption. It physically
  lacks the interface. `test_Guardian_CannotTouchFunds` and `test_Guardian_CannotAbortHealthyDraw` assert this.
- The guardian must be a genuine multisig (`threshold >= 2`, distinct signers). A single-key guardian is a
  centralisation point; if a real multisig cannot be assembled for the submission, **drop the guardian entirely and rely
  on permissionless `abortDraw` plus timeouts** — less power is safer than concentrated power.
  `docs/10-proof-strategy.md` P-A3 covers whichever choice is made.

The guardian is a convenience for liveness, never a requirement for it: `emergencyWithdraw`, permissionless abort before
funded settlement starts, and permissionless `crankB` thereafter guarantee funds and progress.

---

## 6. Solvency enforcement

Invariant I11 / proposition P-S2. The vault stores `_principalBalance`, `_encryptedTotalPrincipal` and
`_encryptedTotalLiability`. It never publicly decrypts those numeric values or a numeric asset total.

Deposit adds the same ERC-7984 `moved` handle to user/aggregate claimable liability and principal. Withdraw, exit and
emergency withdrawal subtract `moved` from claimable liability and subtract `min(moved, _principalBalance[user])` from
user/aggregate principal. Prize and direct-yield credits increase liability, never principal, and their total is bounded
by realised cUSDC yield already transferred into custody. These transitions preserve
`aggregateAssets >= encryptedTotalLiability >= encryptedTotalPrincipal` by construction and do not use a solvency
modifier or decryption response.

`openSolvencyCheckpoint()` computes encrypted aggregate custody assets from the vault, active adapter and optional
retiring adapter, compares them to `_encryptedTotalLiability`, and records the resulting `ebool`, `riskEpoch`,
`accountingVersion` and nonce. It marks only that boolean publicly decryptable. It exposes the handle through a
dedicated aggregate-checkpoint view; it does not emit numeric or per-user encrypted handles.

`submitSolvencyCheckpoint(uint64 checkpointRiskEpoch, uint64 nonce, bytes abiEncodedCleartext, bytes proof)` verifies
the proof against the exact recorded handle. A result remains valid if `accountingVersion` advanced only through
proven-safe user, funded-credit or lossless-custody flows; it is stale if `riskEpoch` changed. A valid `true` records
`lastSolventRiskEpoch = checkpointRiskEpoch` and clears restricted mode; a valid `false` enters restricted mode. Forged,
false-as-true, malformed, wrong-handle, changed-risk-epoch or duplicate submissions cannot authorize a risk transition.

Adapter activation/removal and draw prize sizing/settlement require `lastSolventRiskEpoch == riskEpoch`. Adapter
activation/removal increments `riskEpoch` after the transition and therefore requires a new checkpoint before routing
principal or authorizing another risk transition. Deposits remain callable and retain cUSDC in the vault while the new
epoch is unverified. Non-lossless rebalances are unsupported. Oracle failure cannot block deposit, withdraw, exit or
emergency withdrawal. A retiring adapter is removable only after its permissionless `withdrawAllToVault()` full-balance
transfer completes and the current risk epoch is authorized; no second public-decryption class is introduced.

`prizeAmount` is bounded at `submitTotals` by `require(prizeAmount <= realisedYield)`. `realisedYield` is the public
aggregate amount that `activeAdapter.harvest()` actually transfers under its verified adapter contract, not
`confidentialAssets()` or another asset estimate (proposition P-S4). The independent accounting model additionally
proves that prize plus direct-yield credits allocated from a harvest do not exceed that harvest after rounding;
otherwise an `accountingVersion` advance could not preserve the checkpoint truth.

---

## 7. Access control and upgradeability

- Core accounting is **immutable**. No proxy on `LokVault`.
- `activeAdapter` is replaceable through a **timelock whose delay is at least one full withdrawal window**, so a user
  can always exit during the delay if they distrust the incoming adapter (proposition P-A4). Emit the proposal and the
  execution; the UI warns on a pending swap. Activation is IDLE-only, affects future routing, and requires a verified
  `true` checkpoint for the current `riskEpoch`. Activation increments `riskEpoch`, so funds remain in the vault until
  the new epoch is verified. At most one retiring adapter exists.
- `drawManager` is settable exactly once, at deployment. The current deployment has no guardian; a future guardian is
  permitted only after an explicit re-review supplies at least two independent signers and `threshold >= 2`.
- No role — owner, guardian, keeper — may move user funds, read encrypted values, alter θ, or influence a draw outcome
  (invariant I14). Write a test per role (P-A1, P-A2, P-A3).
- Demo-only functions (`MockYieldAdapter.setYield`, a manual draw trigger) live behind an explicit `DemoControls` module
  so the auditable core stays clean. State plainly in the README which components exist only for the demonstration.
