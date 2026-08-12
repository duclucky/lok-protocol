# 08 — Threat Model

This document answers "is this actually private?" honestly. Publish it in the repository essentially as written. A
submission that states its leakage precisely is more credible than one claiming perfect privacy, and a reviewer who
finds an unstated leak discounts everything else.

Consult this before adding any feature, event, or view function.

---

## 1. What is protected and what is not

| Fact                                                      | Protected?                            | Notes                                                                                                            |
| --------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Your balance                                              | **Yes**                               | `euint64`, decryptable only by you.                                                                              |
| Your deposit amount, via the confidential path            | **Yes**                               | Confidential ERC-7984 transfer.                                                                                  |
| Your deposit amount, via the shield path                  | **No**                                | Shielding publicly reveals the amount. Disclosed in the UI.                                                      |
| Your withdrawal amount, via `withdraw`                    | **Yes**                               | Stays in confidential form.                                                                                      |
| Your withdrawal amount, via `exit`                        | **No**                                | Unshielding publicly reveals it. Inherent to returning to a transparent token; disclosed.                        |
| Your θ (risk dial) value                                  | **Yes**                               | `euint8`, decryptable only by you.                                                                               |
| _That_ you changed θ                                      | **No**                                | The `ThetaChanged` event is public. See §3.                                                                      |
| Your ticket weight and odds                               | **Yes**                               | Never granted to anyone, including you.                                                                          |
| Whether you won                                           | **Yes**                               | Uniform credits and identical events.                                                                            |
| Your prize amount                                         | **Yes**                               | Encrypted credit; only you can decrypt it.                                                                       |
| Your Fortune value/history                                | **Yes**                               | Per-user ciphertext is owner-only; no event identifies a reset.                                                  |
| Aggregate Fortune boost                                   | **No**                                | Inferable as effective ticket total minus base-risk total; no per-user decomposition is published.               |
| **That you are in the pool**                              | **No**                                | Membership is public by construction. See §2.                                                                    |
| Numeric aggregate principal, liability and custody assets | **Yes**                               | Stored as encrypted aggregates; never publicly decrypted.                                                        |
| Solvency checkpoint result                                | **No**                                | Only the aggregate boolean and its epoch are public; no amount is revealed.                                      |
| Total ticket weight                                       | **No**                                | Publicly decrypted by design — it is the plaintext denominator that makes the draw possible.                     |
| Prize amount for the draw                                 | **No**                                | Public by design; required for verifiability.                                                                    |
| Aggregate prize-credit sum after settlement               | **No**                                | Public only after full PASS B; it must equal the already-public `prizeAmount` and has no per-user decomposition. |
| The randomness `r`                                        | **Yes until settlement**, then public | Publishing after settlement adds verifiability at zero privacy cost, because all ticket ranges remain encrypted. |
| Timing of your transactions                               | **No**                                | Standard on any public chain.                                                                                    |

---

## 2. Membership is public — the primary limitation

Lok hides **amounts**, not **participation**. Your address appears in the `participants` array and in deposit events.
Anyone can enumerate depositors; nobody can see what any of them hold.

This is deliberate and load-bearing: the paginated sweeps require an enumerable participant set, and a deposit
transaction reveals the interaction in any case.

Consequences to state plainly:

- An observer knows you use a prize-savings product. In some contexts that alone is sensitive.
- Correlation with the public token graph may narrow your balance range even without decryption — for instance, if you
  shielded a known amount shortly before depositing.
- For users needing participation privacy, the mitigation is a fresh address funded through a path that does not link to
  their identity. A genuinely shielded participant set would need a different construction — an anonymity-set design
  with encrypted membership — which is out of scope and should be named as future work rather than implied.

---

## 3. Side channels

Ranked by exploitability. Each needs either a mitigation or an explicit acceptance.

### S1 — Aggregate θ inference in a small pool — **medium**

`prizeAmount` and `totalTickets` are public, and their ratio reveals the pool's **average** θ. With a handful of
participants that constrains individual values sharply; with one participant it reveals θ exactly.

Mitigation: none available at the protocol level — the aggregate must be public for the draw to work. Handle it as
disclosure: the UI states that the pool's average risk setting is inferable and that individual settings are protected
only in proportion to pool size. Consider a minimum participant count before a draw executes (void below, say, five
participants) to establish a floor on the anonymity set.

### S2 — θ-change timing — **low to medium**

The `ThetaChanged` event reveals _when_ you changed the dial but never to what. Frequent changes combined with S1 leak
more than either alone.

Mitigation: the UI discourages frequent changes with copy ("your setting applies from now on; changing often is not
useful"). Accept and document.

### S3 — Transaction-graph correlation on shield → deposit — **medium**

Shielding publishes an amount. Depositing shortly afterwards links that public amount to your position with high
confidence.

Mitigation: the confidential path is the default; the UI explicitly recommends separating shield and deposit in time and
warns before the shield transaction (trap T3).

### S4 — Sweep position — **negligible**

Your index in `participants` is public and stable, so an observer knows which crank transaction processed you. No value
leaks: every participant is processed identically and the emitted event carries no distinguishing field.

### S5 — Gas and HCU variation — **low**

A crank transaction's HCU consumption could in principle vary with the data being processed. The operations in `crankB`
are fixed-cost and data-independent by construction — the same comparisons, selects, and adds execute for every
participant regardless of whether they won.

**Requirement:** keep it that way. Never introduce a data-dependent operation into a sweep, and never attempt to "skip"
zero-weight participants as an optimisation — a skip is a branch, and a branch on encrypted data is both impossible and
a leak. Add a regression test asserting that per-participant crank gas is constant across a winning and a losing
participant.

The fixed regression threshold is 1% gas delta after controlling for the public cursor class, with exact equality
required for global HCU and maximum HCU depth. The 2026-08-11 mock measurement for matched non-first/non-final
`crankB(1)` calls was 722,888 gas, 4,025,320 global HCU and 3,032,096 maximum HCU depth for both winner and loser. The
first crank used 735,682 gas because of a public initial-storage transition; later winner and loser calls were
identical, so this position effect is not an outcome channel.

### S6 — Reveal timing — **low**

Requesting decryption of your own credit is observable at the relayer. Someone monitoring relayer traffic could infer
that you checked, though not the result.

Mitigation: the UI encourages checking regardless of outcome ("check my result" is a single button for everyone, not a
"claim prize" button that only winners would press). **This is a design requirement, not a nicety:** a button labelled
"Claim prize" that only winners rationally press would reintroduce the leak the whole architecture removes.

Verification boundary: the on-chain ABI half passes - one `prizeCredit(drawId,user)` path serves everyone and no
winner-only function/event exists. The web application is not present yet, so identical frontend telemetry and
relayer-request discipline remain a human/frontend gate and are not claimed by Task 13.

### S7 — Solvency checkpoint status and timing — **low**

The public sees when a checkpoint is opened, which risk epoch and accounting snapshot it covers, and whether the
aggregate result is solvent. Numeric principal, claimable liabilities, numeric assets and transaction deltas remain
encrypted, but a `false` result reveals that the aggregate safety relation failed for that risk epoch.

Mitigation: checkpoints are permissionless and follow a uniform ABI; only the boolean is public. Safe user flows advance
`accountingVersion` without invalidating the result, while a changed `riskEpoch` does. Deposit and principal recovery
remain available. The frontend reports `false` as restricted/recovery mode and never invents or displays a backing
ratio.

### S8 — Aggregate Fortune movement — **low to medium**

Winner selection needs the public Fortune-adjusted ticket denominator, while solvent yield allocation needs the public
theta-only base-risk total. Their difference reveals the pool's bounded aggregate Fortune boost. Comparing draws exposes
pool-level momentum changes and may support statistical inference when membership or balances are highly concentrated;
it does not directly identify which participant reset or their Fortune value.

Mitigation: draws below `MIN_PARTICIPANTS` do not settle; neither contract nor UI publishes a per-user decomposition,
leaderboard, winner-only event or raw Fortune history. The residual aggregate inference is accepted and covered by P-P7.

### S9 - Aggregate prize-credit consistency signal - **negligible**

After PASS B processes the full participant snapshot, Lok makes the draw-scoped `cumPrizeCredits` handle publicly
decryptable. In a correct draw this value equals the already-public `prizeAmount`, so it adds verification without
revealing a new amount. A mismatch would reveal an aggregate safety failure, not a winner or per-user credit.

Mitigation: no intermediate sum is public; the call exists only in `_completePassB`; individual prize/direct-credit
handles remain private with uniform grants. The static allowlist and P-S3 equality proof cover this boundary.

---

## 4. Trust assumptions inherited from the Zama Protocol

State these; they are not Lok's design choices, but they bound Lok's guarantees.

| Assumption                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threshold MPC key management | The decryption key is split across a KMS committee — 13 nodes with a two-thirds majority rule, robust against up to one third malicious. No single party can decrypt. **In strict-mode draws, Lok does not rely on this for randomness integrity**: the XOR of participant entropy means one honest revealer defeats even a fully colluding KMS (proposition P-F3). In non-strict draws, the assumption stands and is documented as the default's trust boundary. |
| Hardware attestation         | KMS nodes run the MPC software inside AWS Nitro Enclaves. Integrity therefore depends partly on enclave security. Zama documents this as suboptimal and is working towards ZK-MPC.                                                                                                                                                                                                                                                                                |
| Coprocessor consensus        | FHE computation is performed off-chain by multiple coprocessors under majority consensus, and every operation is publicly recomputable. Optimistic-style security plus consensus.                                                                                                                                                                                                                                                                                 |
| Operator pause capability    | Any protocol operator can pause the protocol or blacklist addresses in an emergency; unpausing requires several. So Lok inherits a liveness dependency it does not control.                                                                                                                                                                                                                                                                                       |
| Post-quantum posture         | The FHE and MPC layers are post-quantum. The zero-knowledge proof of correct encryption and the host chain's signature scheme are not.                                                                                                                                                                                                                                                                                                                            |
| Gateway centralisation       | The Gateway runs as a dedicated rollup operated for the protocol.                                                                                                                                                                                                                                                                                                                                                                                                 |

**Lok's own response to these** is invariant I9: `emergencyWithdraw` and `abortDraw` must function with no dependence on
decryption, oracle liveness, or crank progress. Users can always exit. This is the only part of the inherited risk Lok
can actually mitigate, and it is why those functions exist.

---

## 5. Contract-level attack surface

| Vector                                                          | Mitigation                                                                                                                                                                                                                                        | Test                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Forged effective/base/yield totals to `submitTotals`            | Accept only signed ABI cleartexts verified against the ordered triple of committed aggregate handles, then decode; no independent plaintext-total parameters exist.                                                                               | `test_SubmitTotals_RejectsForgedProof`                  |
| Forged, risk-stale or wrong-handle solvency proof               | Bind the proof to the recorded aggregate boolean handle, risk epoch, accounting snapshot and nonce. Safe accounting-version advances preserve the proven truth; a changed risk epoch invalidates it.                                              | `test_SolvencyCheckpoint_RejectsForgedOrRiskStaleProof` |
| Crediting a requested rather than transferred amount on deposit | Credit only the amount the ERC-7984 transfer reports as moved. Crediting the request mints value from nothing when the transfer clamps.                                                                                                           | `test_Deposit_CreditsOnlyTransferredAmount`             |
| Prize/direct-yield credit exceeds realised funding              | Increase encrypted liability for every credit; prove prize plus direct allocations stay within realised cUSDC after rounding, and fuzz the independent funding model.                                                                             | `test_Accounting_PrizeConservation`                     |
| Reentrancy through a confidential-token or adapter value leg    | Vault value-moving/checkpoint entrypoints and all draw-manager state-changing entrypoints use contract-local reentrancy guards; malicious callbacks attempt deposit, withdraw, exit, checkpoint submission, adapter activation, reveal and crank. | `test/invariants/reentrancy.t.ts`                       |
| Owner rug via adapter swap                                      | Adapter changes are IDLE-only, timelocked, future-routing-only and require a current `true` solvency checkpoint; the owner can never move user funds.                                                                                             | `test_Owner_CannotMoveUserFunds`                        |
| Griefing by inflating `participants`                            | Deposits enrol an address, so cheap deposits lengthen sweeps. Mitigate with a minimum deposit for enrolment and by making `exit()` attractive. Document the residual cost.                                                                        | `test_Enrol_MinimumDeposit`                             |
| Cursor corruption by concurrent cranks                          | Cursor advances monotonically within a transaction; idempotent at boundaries.                                                                                                                                                                     | `test_Crank_IdempotentAtCursor`, `e2e_ConcurrentCranks` |
| Stuck funds on a stalled draw                                   | Permissionless deadline abort is available until `SWEEP_B.cursor > 0`; after the first funded credit, abort is forbidden and permissionless `crankB` must finish. `emergencyWithdraw` remains available throughout.                               | `test_Withdraw_AfterAbort`, `DrawManager.sweepB.t.ts`   |
| Silent overflow producing wrong odds                            | Written bound derivations, `FHE.min` saturation, boundary tests.                                                                                                                                                                                  | `test/invariants/overflow.t.ts`                         |
| Modulo bias in `r`                                              | Full-width draw reduced modulo a plaintext total; bias at most `totalTickets / 2⁶⁴`. Stated numerically rather than claimed absent.                                                                                                               | `test_Randomness_ModuloBiasBounded`                     |
| Zero-participant or all-dust draw                               | Void cleanly; never divide by zero.                                                                                                                                                                                                               | `test_Accounting_ZeroParticipants_DrawVoids`            |

---

## 6. What Lok explicitly does not defend against

Say this out loud in the README. It is a credibility asset, and every item is genuinely out of scope.

- **A compromised user wallet.** Decryption rights follow the key.
- **Network-level surveillance** linking an IP address to a decryption request.
- **Voluntary disclosure**, including the proof-of-win feature. It is opt-in and irreversible by design.
- **Statistical inference from a very small pool** (see S1).
- **Failure of the underlying yield source.** Adapter risk is the depositor's risk; "no-loss" holds under normal
  operation of the yield venue, exactly as it does for comparable prize-savings protocols. Say this plainly rather than
  implying principal is unconditionally guaranteed.
- **Regulatory action against confidential financial applications.**
- **Correlation with off-chain data** the protocol cannot observe.

---

## 7. Positioning and legal framing

Lok is a **prize-linked savings** product. Use that term consistently.

- Never use "lottery", "gambling", "casino", "bet" or "wager" anywhere in the product, the repository, the video or the
  thread. Prize-linked savings is an established regulated category in multiple jurisdictions; the framing is accurate,
  not evasive.
- Lead with principal preservation. It is the feature that distinguishes the category.
- The Risk Dial supports this framing: the depositor explicitly chooses how much variance they want, and the
  conservative option is available.
- This is not legal advice. Anyone deploying Lok commercially needs jurisdiction-specific counsel, and the README should
  say so.
