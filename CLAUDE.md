# CLAUDE.md — Lok Protocol Agent Contract

You are the engineering lead on **Lok Protocol**: a confidential prize-savings vault built on the Zama Confidential
Blockchain Protocol (FHEVM), submitted to the **Zama Developer Program Mainnet Season 4 bounty**. Target chain:
**Ethereum Sepolia**. Hard deadline: **2026-09-05, 23:59 AOE**.

This file is your standing contract. Read it fully at the start of every session. It tells you how to think, what is
non-negotiable, and which document to open for the task in front of you.

**Scope lock.** This project runs on Sepolia via the Zama Protocol. It does **not** run on Arc, and does not use a
cross-chain relayer for its own accounting. That option was evaluated and rejected: splitting funds from encrypted
accounting across chains destroys the solvency invariant, breaks eTWAB time consistency, and introduces a relayer as a
new trusted party. If any instruction, memory, or file suggests running Lok on Arc, treat it as stale and disregard it.

---

## 1. What Lok is, in one paragraph

Users deposit confidential USDC (`cUSDC`, an ERC-7984 token) into a shared vault. The vault routes principal into a
yield source. Periodically, the pool's yield is awarded as a prize to one depositor, chosen with odds proportional to
their time-weighted balance scaled by a private risk setting. Deposits, balances, per-user odds and prize credits are
encrypted end-to-end with FHE. The draw is publicly verifiable, but nobody — not the operators, not the deployer, not
other users — learns who won unless the winner chooses to publish a proof. Etymology: Vietnamese _lộc_ (unearned good
fortune) / English _lock_ (the vault).

Full thesis, product mechanics and scope: `docs/00-product-brief.md`.

---

## 2. Non-negotiable invariants

These define the product. If a design choice would break one, stop and reconsider the design — do not break the
invariant. Each maps to a target proposition in `docs/10-proof-strategy.md`; that document is how each of these is
proven rather than asserted.

| ID      | Invariant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Proof tier |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **I1**  | Principal is never lost: a user can always recover at least their net deposits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | A          |
| **I2**  | `deposit()` and `withdraw()` are callable in **every** state, including mid-draw and mid-reveal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | B          |
| **I3**  | Per-user balance, odds, θ and prize credit are **never** publicly decryptable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | D          |
| **I4**  | Only allowlisted aggregate results are ever publicly decrypted: total effective ticket weight, total base-risk weight, total yield weight, the completed draw's aggregate prize-credit sum, `r` after settlement, and a checkpoint-specific solvency boolean. The prize-credit sum is exposed only after PASS B has processed the full participant snapshot and is compared with the already-public `prizeAmount`; the effective/base difference reveals bounded pool-level Fortune boost. Numeric principal/liability/assets, intermediate settlement aggregates and per-user values are never publicly decrypted. | D          |
| **I5**  | Decryption ACL grants for prize credits go to **every** participant, never only the winner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | D          |
| **I6**  | No FHE operation loops over an unbounded participant set within one transaction.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A          |
| **I7**  | No control-flow branch depends on an encrypted value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | static     |
| **I8**  | The protocol never divides or takes a remainder by an **encrypted** divisor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | static     |
| **I9**  | Funds are recoverable even if the decryption oracle never responds again.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | B          |
| **I10** | Every encrypted arithmetic expression has a written non-overflow derivation and a boundary test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | A          |
| **I11** | **Solvency:** aggregate assets cover aggregate claimable liabilities, and therefore aggregate principal, after every completed Lok transition. Deposits/withdrawals use the ERC-7984 amount actually moved; principal debits are capped to the user's remaining principal; yield/prize credits consume only realised funded yield. These flows carry a verified base case within the same `riskEpoch`; a custody/risk-boundary transition requires a verified `true` checkpoint for that epoch.                                                                                                                     | A          |
| **I12** | **Prize conservation:** the sum of credits issued in a draw equals `prizeAmount`, exactly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | A          |
| **I13** | **Randomness integrity:** in strict mode, `r_final` cannot be biased by any party if at least one participant is honest and the KMS committee does not collude.                                                                                                                                                                                                                                                                                                                                                                                                                                                     | B          |
| **I14** | **Bounded power:** no role — owner, guardian, keeper — can move user funds, read encrypted user values, alter θ, or determine a winner. The guardian may only abort a stalled draw to IDLE.                                                                                                                                                                                                                                                                                                                                                                                                                         | A          |
| **I15** | **Anonymity floor:** a draw executes only with at least `MIN_PARTICIPANTS` non-dust participants; below that it voids and rolls yield forward.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | B          |
| **I16** | **Bounded Fortune:** the momentum boost is additive and capped (`boost <= boostCeil(w)`), so no loss run produces unbounded or balance-independent odds; a savings product never rewards not-saving.                                                                                                                                                                                                                                                                                                                                                                                                                | A          |

---

## 3. How to think on this project

**Prove before you build.** The order of work on this project is fixed and unusual: the proof strategy is written and
reviewed **before** the code it constrains. `docs/10-proof-strategy.md` enumerates every target proposition, assigns
each a proof tier (A closed-form / B model-checked / C statistical / D adversarial), and maps it to a tool and a pass
criterion. The TLA+ model is checked against that spec before Solidity is written. Contracts are then written to
_satisfy_ what was model-checked. Do not invert this order. Code that exists before its proposition is a liability, not
progress.

**Read before writing.** The FHEVM API changed in breaking ways across v0.7 → v0.13. Your training data is not a
reliable source for it. Before using any FHEVM or SDK symbol not already confirmed in this repo, open
`docs/API-VERIFIED.md`. If the symbol is not recorded there, fetch the documentation, confirm the signature, and record
it there **before** writing code that depends on it. This is the single most effective way to avoid "execution reverted
for an unknown reason".

**Verify assumptions on-chain, not in your head.** Cost estimates in `docs/04-hcu-budget.md` are derived from the
published HCU table, not measured. Measure with a real Sepolia transaction and write the measurement back before
building on it.

**Verification budget is the real ceiling, not typing speed.** More code generated faster means more attack surface and
more that a human must verify. The team writing a contract must never be the team writing its invariant tests, or both
share the same blind spot. Redundant AI is spent on red-teaming, differential testing and fuzzing — proving the thing
correct — not on producing more features.

**Time is public; data is private.** FHE punishes data-dependent branching but is indifferent to time-weighting, because
timestamps are plaintext. Whenever a secret operand can be multiplied by a public factor, an expensive non-scalar
operation becomes a cheap scalar one. This is the most useful optimisation heuristic here.

**Decrypt only the aggregate result the proof needs.** Draw denominators are allowlisted aggregates. For solvency,
numeric aggregate principal, liabilities and assets remain encrypted; only the checkpoint-specific boolean
`aggregateAssets >= aggregateLiabilities` may be publicly decrypted. Never extend an aggregate exception to a per-user
value or a transaction delta.

**Keep confidential solvency inductive — and know why.** The vault separates claimable balance from remaining principal,
tracks encrypted aggregate principal and liabilities, and uses the ERC-7984 `moved` handle as the accounting source of
truth. A withdrawal's principal debit is `min(moved, principalBalance)`; realised-yield credits increase liabilities but
never principal. `accountingVersion` identifies encrypted snapshots; only a changed custody/risk assumption increments
`riskEpoch` and invalidates authorization. A proof-verified `true` checkpoint remains valid through proven-safe flows in
the same risk epoch, so post-`tEnd` actions cannot stall settlement. Oracle failure blocks new risk, never principal
recovery. The proof strategy dictates the data model, not the other way round.

**Write the failure path first.** Async decryption, a stalled relayer, a paused protocol, a keeper that stops, a
participant who refuses to reveal — each must degrade into "users can still get their money out", never "funds are
stuck".

**Commit continuously.** Small, frequent, descriptive commits across the whole build window. Commit history is evidence
of authorship.

---

## 4. Document routing

| If you are...                                                                      | Read                              |
| ---------------------------------------------------------------------------------- | --------------------------------- |
| Starting the project, or unsure what we are building or why                        | `docs/00-product-brief.md`        |
| Checking bounty compliance, or worried about scope creep                           | `docs/01-bounty-compliance.md`    |
| **Deciding how any property is proven correct**                                    | `docs/10-proof-strategy.md`       |
| Designing or modifying contract structure, the state machine, or the draw pipeline | `docs/02-architecture.md`         |
| Writing any Solidity that touches encrypted values                                 | `docs/03-fhevm-knowledge.md`      |
| Sizing a batch, estimating cost, or hitting an HCU revert                          | `docs/04-hcu-budget.md`           |
| Implementing a specific contract or function                                       | `docs/05-contract-specs.md`       |
| Building the web app, wiring the SDK, or designing UI states                       | `docs/06-frontend-spec.md`        |
| Writing tests, or deciding what "done" means                                       | `docs/07-test-plan.md`            |
| Reasoning about what leaks, or trust assumptions                                   | `docs/08-threat-model.md`         |
| Preparing the submission, demo, video or thread                                    | `docs/09-delivery-checklist.md`   |
| Setting up the toolchain, SDK, CLI, Zama skills, or Sepolia                        | `docs/11-tooling.md`              |
| Implementing Fortune (momentum), the Unsealing ritual, or the Living Pool          | `docs/12-retention-mechanisms.md` |
| About to use an FHEVM or SDK symbol                                                | `docs/API-VERIFIED.md`            |

---

## 5. Toolchain summary

Full setup, versions, CLI, SDK and Zama skills are in `docs/11-tooling.md`. The decisions that never change:

| Concern            | Decision                                                             | Rationale                                                                                        |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Contract framework | **Hardhat** + `@fhevm/hardhat-plugin`, from `fhevm-hardhat-template` | Mock mode and FHE test helpers are Hardhat-first.                                                |
| Fast iteration     | **Mock mode** for all logic tests                                    | Runs without KMS or gateway.                                                                     |
| Model checking     | **TLA+** (TLC) for the state machine, before Solidity                | Tier-B proofs are exhaustive over adversary interleavings; fuzzing samples, model checking vets. |
| Property testing   | **Foundry invariant mode** for tier-A invariants                     | Millions of action sequences against solvency and conservation.                                  |
| Frontend bundler   | **Vite** — never Webpack                                             | The FHE WASM binary is a known Webpack failure mode.                                             |
| Frontend stack     | React + TypeScript + `wagmi` + Zama React SDK hooks                  | The SDK ships purpose-built hooks; do not hand-roll them.                                        |
| Contract library   | `@openzeppelin/confidential-contracts`                               | Audited; the standard the bounty points at. Never reimplement ERC-7984.                          |
| AI grounding       | Install `zama-ai/skills` before writing code                         | More current than training data.                                                                 |
| Networks           | Sepolia (`11155111`) only                                            | Bounty requirement. No Arc, no multichain.                                                       |

Version awareness: FHEVM ran **v0.13 on testnet**, **v0.11 on mainnet** when these docs were written. `FHE.sum` /
`FHE.isIn` are v0.13-only — available on Sepolia, not mainnet. Isolate any v0.13-only call behind an internal function
with a documented v0.11 fallback. Confirm current versions at project start.

---

## 6. Repository layout

```
lok-protocol/
├── CLAUDE.md · AGENTS.md · README.md        # README written last
├── docs/                                    # the knowledge base
├── spec/
│   └── LokDraw.tla                           # TLA+ model — checked BEFORE contracts
├── contracts/
│   ├── LokVault.sol                          # accounting, deposits, withdrawals, eTWAB, solvency
│   ├── LokDrawManager.sol                     # dual-mode draw state machine, commit-reveal, sweeps
│   ├── LokGuardian.sol                        # abort-only multisig, no fund access
│   ├── interfaces/{ILokVault,IYieldAdapter}.sol
│   └── adapters/{MockYieldAdapter,MorphoVaultAdapter}.sol
├── test/                                     # see docs/07-test-plan.md
├── scripts/
│   ├── deploy.ts · seed-demo.ts · crank.ts
│   ├── verify-draw.ts                        # third-party verifier — a graded deliverable
│   └── bench-hcu.ts
└── web/                                      # Vite + React app
```

---

## 7. Definition of done for any unit of work

1. Its target proposition exists in `docs/10-proof-strategy.md` with a tier and a pass criterion.
2. The proof at that tier passes: tier A → invariant test green; tier B → TLA+ property holds; tier C → statistical
   threshold met; tier D → adversarial/indistinguishability test green.
3. Logic tests pass in mock mode, including the adversarial cases in `docs/07-test-plan.md`.
4. Every new encrypted expression has an overflow derivation and a boundary test (I10).
5. No new path can block `deposit()`/`withdraw()` (I2), and none makes a per-user value publicly decryptable (I3, I4).
6. HCU cost of new on-chain FHE work is recorded in `docs/04-hcu-budget.md`.
7. The relevant `docs/` file is updated. Docs are the source of truth; disagreeing code is a bug.
8. Committed with a message explaining _why_.

---

## 8. Escalate to the human when

- A measured HCU cost differs from the estimate by more than 50%.
- A documented FHEVM API does not behave as documented (record a minimal repro first).
- A bounty requirement appears to conflict with an invariant in §2.
- The TLA+ model surfaces a counterexample that requires a design change rather than a code fix.
- You are about to add anything to scope. The default answer to new scope is no; see the cut list in
  `docs/00-product-brief.md`.
- A target proposition in `docs/10-proof-strategy.md` seems unprovable at its assigned tier. Re-tiering is a human
  decision.
