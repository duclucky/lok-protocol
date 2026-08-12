# 09 — Delivery Checklist

The submission is a package, not a repository. The video, the thread and the README carry roughly a third of the
outcome, and they are the parts most commonly rushed. Budget the final week for them.

**Target submission date: 2026-09-03.** The deadline is 2026-09-05, 23:59 AOE. Do not use the buffer for features.

---

## 1. Build schedule

### Days 1–2 — de-risking spike, before writing production code

Verify by transaction, not by reading. Every item produces a recorded number or a confirmed API.

- [ ] Scaffold from the FHEVM Hardhat template; install the official Zama agent skills.
- [ ] Confirm the current protocol versions on testnet and mainnet from the changelog. Record in `docs/API-VERIFIED.md`.
- [ ] Confirm `FHE.randEuint64()` and scalar `FHE.rem` work together for the reduction.
- [ ] Confirm the public-decryption call sequence and its on-chain proof verification. **This is the highest-risk
      unknown in the design** — the draw pipeline cannot be built without it.
- [ ] Confirm `FHE.sum` availability on Sepolia; note the v0.11 fallback plan either way.
- [x] **Measure per-participant HCU for the `crankA` and `crankB` sequences.** Set `BATCH_A_MAX` and `BATCH_B_MAX` to
      60% of the measured maximum. Escalate if either is more than 50% off the estimate.
- [ ] Verify the exact scalar overloads used by the revised paths, including `FHE.mul(euint128, uint128)` for
      `directWeight * directRate`, and confirm boundary vectors stay below `2^128`; overflow wrapping is never accepted
      as a control mechanism.
- [ ] Confirm a usable USDC ↔ cUSDC pair exists in the Sepolia wrappers registry.
- [x] Measure relayer decryption latency, p50 and p95. These become the frontend timeout constants.
- [ ] Read all pages of the submission form; record the answers in `docs/01-bounty-compliance.md` §4.
- [ ] Register the name, create the public repository, first commit today.

If either measured per-participant cost is more than 50% above the revised estimate, or the resulting 60% cap misses the
documented demo-latency target, stop and escalate before changing the architecture or UX.

### Week 1 — contracts

- [ ] `LokVault`: deposit, withdraw, exit, setTheta, `_syncUser`, `preSync`, `_recomputeRate`
- [ ] `IYieldAdapter` + `MockYieldAdapter`
- [ ] `LokDrawManager`: state machine, both sweeps, randomness, abort
- [ ] `emergencyWithdraw`
- [ ] Compliance tests (R1–R9) and the eTWAB unit tests
- [ ] **Deploy to Sepolia by the end of week 1.** Never leave deployment to the final week.

### Week 2 — frontend

- [x] Vault, Deposit, Risk Dial, Draw, Proof-of-win screens
- [x] The sealed-value component and the async decryption state machine
- [x] Encrypted status codes surfaced as human messages
- [ ] Deployed to a public URL. From here on there is always a working demo.

### Week 3 — production quality

- [x] Statistical fairness test plus the chart artefact
- [x] Privacy invariant tests, especially uniform-grant and log-indistinguishability
- [ ] Overflow tests and all bound derivations written
- [ ] `MorphoVaultAdapter` implemented
- [x] `scripts/crank.ts`, `scripts/verify-draw.ts`, `scripts/seed-demo.ts`, `scripts/bench-hcu.ts`
- [ ] `docs/BENCHMARK.md` with measured numbers
- [ ] Demo hardening (§3)
- [ ] Full NatSpec; contracts verified on Etherscan

### Week 4 — the package

- [ ] README (§2)
- [ ] Video (§4)
- [ ] X thread (§5)
- [ ] Post to the Zama community forum for public review **before** submitting
- [ ] Re-run the HCU benchmark — the protocol version may have moved
- [ ] Final review against `docs/01-bounty-compliance.md` §1
- [ ] Submit 2026-09-03

---

## 2. README structure

Order matters. A reviewer reads the top and skims the rest.

1. **Name, one-liner, live demo link, video link, verified Sepolia addresses.** Above the fold.
2. **Specification compliance table** — the R1–R16 matrix trimmed to requirement plus test name. Turns their compliance
   check into a glance.
3. **Specification interpretation** — five lines on the prize-amount reading (trap T4) and the default θ = 100% framing.
4. **Why confidentiality is the product, not a feature** — the thesis in three paragraphs with the Premium Bonds and
   PoolTogether numbers.
5. **The three mechanisms** — Risk Dial, eTWAB, Quiet Win. One paragraph each, each stating why it is impossible without
   FHE.
6. **Architecture** — the component diagram, the two-pass draw, and the three reasons the naive algorithm fails. Include
   why weighted reservoir sampling and the Gumbel trick are impossible under FHE.
7. **HCU benchmark** — the measured table and transactions-per-draw at N = 10 / 100 / 1,000, with the four improvement
   paths.
8. **Fairness evidence** — the Monte Carlo chart.
9. **The winner-privacy argument** — why ACL grants must be uniform (trap T1). Give it a heading.
10. **Path to production** — `IYieldAdapter` and `MorphoVaultAdapter`.
11. **Threat model** — link to `docs/08-threat-model.md`, and inline the "what we do not defend against" list.
12. **Failure paths** — `emergencyWithdraw`, `abortDraw`, and what happens when the oracle is silent.
13. **Run it locally** — commands that work from a clean clone. Test this on a clean clone.
14. **Demo components** — name every contract and function that exists only for the demonstration.

---

## 3. Demo hardening

The reviewer arrives with an empty wallet and limited patience. Each item is a likely point of failure.

- [ ] **"Get test tokens"** mints mock USDC and shields it in one guided flow.
- [ ] **Seeded pool** of 30–50 participants with varied balances and θ, so pagination visibly runs.
- [ ] **"Run draw now"**, clearly labelled as a demo control and visually separated from user actions.
- [x] **Every decryption out of band**, cached, retried with backoff, with honest failure states. The single most likely
      cause of a demo failing mid-video.
- [ ] **Contracts verified** on Sepolia Etherscan; addresses in the README _and_ the app footer.
- [ ] **Footer** shows commit hash and FHEVM version.
- [x] **"Why encrypted?"** page carrying the thesis.
- [x] **Mobile viewport works.** Reviewers open links on phones.
- [ ] **Tested in a clean browser profile** with a fresh wallet. Your cached permits hide first-run bugs.
- [ ] **A recorded fallback demo** in case the network is degraded when you record.

---

## 4. Video — 3 minutes, real person

AI-generated video or voice is disqualifying. Your face, your voice.

| Time      | Content                                                                                                                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:35 | **The contrast.** Premium Bonds: 70 years, 22 million holders, roughly £140 billion. PoolTogether: four-plus years, about $10 million in prizes. Same product. The single structural difference is that one is confidential and the other publishes who won — and advertises it as a feature.              |
| 0:35–1:20 | **Spec-exact demo.** Deposit, sealed balance, run a draw at default θ = 100%. Show the paginated sweep progressing. Show two wallets with identical on-chain footprints, then one decrypting to a prize.                                                                                                   |
| 1:20–1:50 | **The Risk Dial**, explicitly labelled as an extension. Slide 100% → 25%. Say the line: nobody can see this, and that is why the mechanism can exist at all.                                                                                                                                               |
| 1:50–2:30 | **Why only FHE.** Encrypted on-chain randomness — the number exists on-chain and nobody can read it, so no VRF, no commit–reveal, no oracle. Then the engineering insight: the HCU limits mean any naive implementation breaks around thirty participants; show the measured benchmark table at N = 1,000. |
| 2:30–2:50 | **Verification, live.** Run `verify-draw.ts` in a terminal on camera. PASS.                                                                                                                                                                                                                                |
| 2:50–3:00 | **Path to production.** `IYieldAdapter` pointing at a live confidential yield venue with roughly $26M in deposits. A valve waiting to be opened, not a toy.                                                                                                                                                |

Practical notes: script it and rehearse; 3 minutes is short and overruns get cut. Capture the screen at high resolution
with legible font sizes. Record after a successful dry run so the network is warm.

---

## 5. X thread

Teach something. A thread of screenshots is ignored; a thread with a non-obvious idea gets read and quoted.

**Opening post:**

> Premium Bonds: 70 years old, 22 million holders, roughly £140 billion. PoolTogether: the same idea on-chain, 6 years,
> about $10 million in prizes.
>
> The difference isn't yield or UX. PoolTogether's own docs say anyone can confirm who won. They ship it as a feature.
> That's the bug.
>
> 🧵 I built Lok on @zama — and hit an FHE limit that breaks every on-chain lottery at ~30 depositors.

**Then:**

2. The discouragement mechanism, with the real number: 94% of Premium Bonds prize winners held more than £10,000 — a
   statistical truth that is invisible per-person off-chain and computable per-person on-chain. Transparency turns a
   statistic into a personal insult.
3. The engineering: HCU limits of 20M global and 5M depth per transaction mean sequential accumulation dies around 30
   depositors. Why the elegant streaming algorithms (weighted reservoir sampling, the Gumbel key trick) are all
   impossible — they need division by an encrypted value, and FHE has none. Why pagination is the answer: **the depth
   limit is per-transaction, so paginating resets it.**
4. The Risk Dial — a mechanism PoolTogether cannot ship, because in a transparent pool it would publish a
   risk-preference leaderboard.
5. The privacy subtlety: granting decryption only to the winner publishes the winner, because ACL grants are public
   events. Grant uniformly to everyone; losers decrypt a zero.
6. Live demo, repository, video. Tag `@zama`, use `#ZamaDeveloperProgram`.

Post 3 is the one that gets quoted. Write it carefully.

---

## 6. Final gate

Do not submit until every line is true:

- [ ] Every requirement in `docs/01-bounty-compliance.md` §1 maps to a passing test
- [ ] `test_R2_SpecExact_AllPoolYieldAwardedAsPrizes` passes with the dial untouched
- [ ] All four traps in `docs/01-bounty-compliance.md` §3 are handled **and documented**
- [ ] Uniform ACL grants verified by test, not by inspection
- [ ] Withdrawals proven unblocked in every draw state
- [ ] `emergencyWithdraw` proven to work with decryption stubbed out
- [ ] Every encrypted expression has a bound derivation and a boundary test
- [ ] Benchmark re-run against the current protocol version
- [ ] Fairness chart produced and included
- [ ] Demo works in a clean browser with a fresh wallet
- [ ] Contracts verified; addresses correct in README and footer
- [ ] Video is a real person, under 3:00, and demonstrates the spec-exact flow first
- [ ] Thread published and tagged
- [ ] Commit history spread across the full build window
- [ ] `verify-draw.ts` passes against a real settled draw on Sepolia
