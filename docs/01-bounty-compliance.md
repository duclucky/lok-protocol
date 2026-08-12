# 01 — Bounty Compliance

The purpose of this document is to make compliance **auditable by a stranger in five minutes**. A reviewer with 150
submissions to assess will not reverse-engineer whether we met the specification. We hand them the mapping.

Consult this document before adding any feature, and before writing the README.

---

## 1. Requirement matrix

Requirements are drawn from the Season 4 announcement and the submission form. Where the two differ in wording, the
stricter reading governs.

| #   | Requirement                                                     | Implementation                                                                                | Verifying evidence                                                        |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| R1  | Users deposit assets into a **shared pool**                     | `LokVault.deposit()` and one confidential `cUSDC` pool                                        | `test_R1_SharedPool_MultipleDepositorsSingleVault`                        |
| R2  | Generated **yield is awarded as prizes through periodic draws** | `LokDrawManager`; default `theta = 100%` routes the full funded yield to the prize            | `test_R2_SpecExact_AllPoolYieldAwardedAsPrizes`                           |
| R3  | Users can withdraw **principal at any time**                    | `withdraw`, `withdrawAll`, `exit` and `emergencyWithdraw` remain enabled through draw states  | `test_R3_WithdrawPrincipal_AnyState`; `test_Deposit_DuringEveryState`     |
| R4  | Deposits, balances and winnings remain **encrypted end-to-end** | Encrypted amounts and accumulators; no plaintext amount event                                 | `test_R4_EndToEndEncrypted_NoPlaintextAmountInAnyEvent`                   |
| R5  | Per-participant **odds are not exposed**                        | Per-user weights never enter the public-decryption allowlist                                  | `test_R5_PerUserOdds_NeverPubliclyDecryptable`                            |
| R6  | **Prize distribution is not exposed**                           | Quiet Win credits every participant through a uniform encrypted path                          | `test_R6_WinnerIndistinguishableFromLoser`; privacy report P-P1/P-P2      |
| R7  | Winner selection **executes over encrypted balances**           | Encrypted half-open ranges are compared with encrypted randomness                             | `test_R7_WinnerSelection_OperatesOnEncryptedBalances`; fairness artifact  |
| R8  | **Only winners can decrypt their prizes**                       | Every participant decrypts only their own credit; only one credit is non-zero                 | `test_R8_OnlyWinnerDecryptsNonZeroPrize`                                  |
| R9  | The draw stays **publicly verifiable on-chain**                 | Aggregate proof submission, complete transcript and independent verifier                      | `test_R9_DrawPubliclyVerifiable_InvariantHolds`; `scripts/verify-draw.ts` |
| R10 | Deployment targets **Sepolia**                                  | Five source-verified contracts in `deployments/sepolia.json`                                  | `test/integration/SepoliaDeployment.t.ts`                                 |
| R11 | Smart contract **and** frontend codebase                        | `contracts/` and `frontend/`                                                                  | root and frontend compile/test/build gates                                |
| R12 | Working **demo deployed on a website**                          | Vite app deployed at `https://frontend-xi-tawny-54.vercel.app`                                | production HTTP/browser smoke evidence in `docs/DEPLOYMENT.md`            |
| R13 | **3-minute video, real person pitching**                        | Human-only recording; no AI voice/video                                                       | `docs/VIDEO-SCRIPT.md`; public URL not yet recorded                       |
| R14 | A **thread or article published on X**                          | Human-only publication                                                                        | `docs/X-THREAD-DRAFT.md`; public URL not yet recorded                     |
| R15 | Submitted before **2026-09-05, 23:59 AOE**                      | Target submission date `2026-09-03`                                                           | human submission receipt not yet recorded                                 |
| R16 | **Production-quality**, beyond a proof of concept               | Frozen proof obligations, adversarial campaigns, measured HCU, verified deployment, public UI | final acceptance record in `docs/09-delivery-checklist.md`                |

Reproduce this table, trimmed to the R-number, requirement and test name, as the **first section of the README**. It
converts the reviewer's compliance check into a glance.

---

## 2. The one judgement call: the Risk Dial versus "yield is awarded as prizes"

Be honest about this rather than hoping it goes unnoticed.

**The tension.** The specification reads as though _all_ pool yield becomes prize money. The Risk Dial lets some yield
flow directly to depositors' balances. With the default θ = 100% the specification holds literally; with a depositor at
θ = 50% it does not.

**Decision: keep the Risk Dial, default θ = 100%, present it as an opt-in extension.**

Rationale: (1) untouched defaults satisfy the specification word-for-word, so a reviewer who opens the app and runs a
draw sees exactly the requested product; (2) the bounty explicitly asks what confidential applications look like in the
real world and asks for work beyond a proof of concept — a product judgement that improves real-world viability is
responsive to that, not a deviation from it; (3) nothing in the specification prohibits direct yield, and the binding
constraint of a no-loss lottery is principal preservation, which Lok preserves absolutely.

**Three cheap mitigations. Implement all three.**

1. **README framing.** Open the feature section with: _"In its default configuration, Lok is a strict implementation of
   the specification: 100% of pool yield is awarded as prizes through periodic draws. The Risk Dial is an opt-in
   extension documented in §X."_
2. **A dedicated test.** `test_SpecExact_AllPoolYieldAwardedAsPrizes()` must run a complete deposit → accrue → draw →
   settle cycle **without touching the dial**, and assert that the prize equals the full accrued yield. This is the test
   a reviewer will look for by name.
3. **Video ordering.** Demonstrate the spec-exact flow first, then introduce the dial as a labelled extension. Never let
   the reviewer's first sight of the product be a modified configuration.

**If zero interpretive risk is required**, drop the Risk Dial entirely and ship M2 + M3. Do **not** substitute a
multi-tier prize structure as a "safer" alternative — multiple prizes per draw means multiple randomness values and
multiple sweeps, which inflates the HCU budget and consumes roughly a week for no additional narrative.

---

## 3. Four traps that silently break compliance

Each of these produces code that runs correctly and _still violates the specification_. Most competing submissions will
contain at least one. Handling them explicitly, and saying so in the README, is the cheapest credibility available on
this project.

### T1 — Granting decryption only to the winner publishes the winner

The naive reading of "only winners can decrypt their prizes" produces:

```solidity
FHE.allow(prizeHandle, winner);   // WRONG
```

The ACL emits a public event whenever a contract grants an address rights over a ciphertext, and that event is relayed
to the Gateway. **Granting to a single address publishes that address on-chain.** This satisfies R8 by violating R6,
which is worse than failing either alone.

**Correct:** grant every participant rights over _their own_ credit handle. Losers decrypt an encrypted zero and learn
nothing. "Only winners can decrypt their prize" is satisfied because only the winner's credit is non-zero.

This is a subtle privacy argument and it distinguishes the submission. Give it a named section in the README and mention
it in the video.

### T2 — Blocking withdrawals during the crank violates "withdraw at any time"

The draw runs across many transactions. The reflex is `require(!drawInProgress)` on `withdraw()`. That is a direct
violation of R3.

**Correct:** freeze a **per-user eTWAB checkpoint at `T_end`** and have the draw read only checkpoints. Deposits and
withdrawals after `T_end` affect subsequent draws only. Withdrawals are never blocked, including between sweep passes.
This is precisely why time-weighted accounting exists in prize savings: it lets depositors move freely while their
contribution is still measured exactly.

Test name: `test_Withdraw_MidCrank_NotBlocked`.

### T3 — The shield step leaks the deposit amount, breaking "end-to-end"

If a user holds public USDC and shields it into `cUSDC` to deposit, **the shield transaction publishes the amount**. The
in-vault balance is encrypted, but the entrance is not. R4 says end-to-end.

**Correct:**

- The default deposit path is a **confidential transfer of already-confidential `cUSDC`** into the vault. This is
  end-to-end encrypted.
- For users starting from public USDC, the UI must state plainly: _"Shielding publishes this amount. Deposit in a later
  transaction to break the link."_
- Record the anonymity-set and timing-correlation limits in `docs/08-threat-model.md`.

The bounty's resource list points at the confidential wrapper documentation, so the reviewers know this seam exists.
Addressing it earns credit; ignoring it will be found.

### T4 — "Winnings encrypted": decide what that means, and say so

The specification is ambiguous about whether the _prize amount_ must be encrypted.

**Our interpretation: the prize amount is public; the recipient and all balances are encrypted.** Reasoning: both
Premium Bonds and PoolTogether publish prize sizes; and an encrypted prize amount removes any means of publicly
verifying the draw, which R9 requires. The sensitive fact is _who_, not _how much_.

Write a five-line "Specification interpretation" section in the README stating this choice and noting that an
encrypted-prize-amount variant is feasible by drawing the prize from the encrypted yield accumulator. A reviewer who
sees that you _considered_ it is satisfied; one who concludes you never noticed is not.

---

## 4. Human submission-form and eligibility verification

**Status as of 2026-08-12: not signed off.** These answers depend on the actual human/team and on all pages of the live
submission form. An engineering worker cannot infer or attest to them. The human submitter must open every page and
record the answer, source URL/screenshot date, and any action required:

- [ ] Project-newness and prior-publication rule.
- [ ] Required open-source license; repository currently declares `BSD-3-Clause-Clear`.
- [ ] Identity verification and geographic exclusions for the submitter and every team member.
- [ ] Team eligibility, team-size limit, and one-submission-per-person rule.
- [ ] Public-repository timing and visibility rule.
- [ ] Published scoring rubric and weights.
- [ ] Final video/X/repository URL fields and permitted post-submission edits.

Do not submit until every box above has a recorded human answer. If any answer conflicts with R1-R16 or a frozen
invariant, stop and request explicit re-review rather than changing the implementation silently.
