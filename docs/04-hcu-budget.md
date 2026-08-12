# 04 — HCU Budget

Homomorphic Complexity Units are the binding constraint on this project. This document holds the cost model, the derived
batch sizes, and the protocol for replacing derivations with measurements.

Derived estimates are retained beside the Sepolia measurements so protocol-version drift remains visible. The latest
authoritative run is dated 2026-08-11 (Asia/Bangkok); see §5.1 and `docs/BENCHMARK.md`.

---

## 1. The limits

| Limit                                | Value                               | Effect when exceeded |
| ------------------------------------ | ----------------------------------- | -------------------- |
| Global HCU per transaction           | **20,000,000**                      | transaction reverts  |
| Sequential depth HCU per transaction | **5,000,000**                       | transaction reverts  |
| Per-block HCU cap                    | configurable by protocol governance | transaction reverts  |

The distinction is essential and frequently missed. **Global** covers all homomorphic work in the transaction, whether
or not the operations depend on one another. **Depth** covers only the longest chain of _dependent_ operations.
Independent work is limited by the global budget; a running accumulation is limited by the depth budget, which is four
times smaller.

**Both limits reset at transaction boundaries.** That is what makes pagination a solution rather than a mitigation: a
sequential prefix sum of unbounded length is achievable if it is split across transactions with the encrypted
accumulator persisted in storage.

An independent research prototype measured a working budget of roughly **60–74 FHE operations per transaction** in its
configuration. Treat that as the conservative planning figure. Design batches for about half of the theoretical maximum
so a protocol parameter change does not break the deployed system.

---

## 2. Operation costs

Selected entries from the published table for the widths this project uses. `scalar` means one operand is plaintext.

### `euint64` — balances, ticket weights, randomness

| Op               | scalar    | non-scalar |     | Op            | scalar  | non-scalar |
| ---------------- | --------- | ---------- | --- | ------------- | ------- | ---------- |
| `add`            | 133,000   | 162,000    |     | `eq`          | 83,000  | 120,000    |
| `sub`            | 133,000   | 162,000    |     | `ne`          | 84,000  | 118,000    |
| `mul`            | 365,000   | 596,000    |     | `lt`          | 118,000 | 146,000    |
| `div`            | 715,000   | —          |     | `le`          | 119,000 | 149,000    |
| `rem`            | 1,153,000 | —          |     | `gt`          | 117,000 | 152,000    |
| `and`/`or`/`xor` | 34,000    | 34,000     |     | `ge`          | 116,000 | 152,000    |
| `shr`/`shl`      | 34,000    | 209,000    |     | `min`         | 150,000 | 219,000    |
| `neg`            | —         | 131,000    |     | `max`         | 149,000 | 218,000    |
| `select`         | —         | 55,000     |     | `randEuint64` | —       | 24,000     |

### `euint128` — accumulators

| Op          | scalar  | non-scalar |     | Op       | scalar  | non-scalar |
| ----------- | ------- | ---------- | --- | -------- | ------- | ---------- |
| `add`       | 172,000 | 259,000    |     | `lt`     | 149,000 | 215,000    |
| `sub`       | 172,000 | 260,000    |     | `le`     | 150,000 | 218,000    |
| `mul`       | 696,000 | 1,686,000  |     | `min`    | 186,000 | 289,000    |
| `shr`/`shl` | 37,000  | 272,000    |     | `select` | —       | 57,000     |

### `ebool` and utilities

| Op                            | scalar | non-scalar |
| ----------------------------- | ------ | ---------- |
| `and`                         | 22,000 | 25,000     |
| `or`                          | 22,000 | 24,000     |
| `xor`                         | 2,000  | 22,000     |
| `not`                         | —      | 2          |
| `select`                      | —      | 55,000     |
| `cast`                        | 32     | —          |
| `trivialEncrypt` / `asEuintN` | 32     | —          |

**The three numbers worth memorising.** A 64-bit encrypted addition is about 162,000 HCU, so the depth budget permits
roughly **30 chained additions**. A non-scalar 128-bit multiplication is about 1,686,000 HCU — nearly a tenth of an
entire transaction's global budget for one operation. A `cast` is approximately free, so narrowing a value before a hot
loop is essentially pure profit.

---

## 3. Per-operation budgets in this system

### `_syncUser` — paid by the user's own transaction or pre-sync

| Path                                                | Derived HCU |                    Measured global HCU |      Measured max depth |
| --------------------------------------------------- | ----------: | -------------------------------------: | ----------------------: |
| Accrue ticket/yield and form both checkpoint deltas |  ~2,430,000 |                          **2,430,032** |           **1,215,032** |
| Maximum successful independent checkpoint batch     |         n/a |        **8 participants / 19,440,256** |           **1,215,032** |
| Frozen `PRESYNC_CAP`                                |         n/a | **4 participants (`floor(8 * 0.60)`)** | below measured boundary |

The split-at-`tEnd` path accrues only through `tEnd`, forms two deltas, then returns; it does not also perform an
ordinary post-window roll-forward. A surrounding balance/theta-changing action separately recomputes the rate with an
encrypted `euint128` multiply and minimum. That surrounding action is represented in the complete PASS B probe rather
than being charged to pre-sync.

Comfortably inside both limits. Direct-yield allocation is no longer lazy here because a cumulative index can apply an
old harvest rate to later weight and over-credit liabilities.

### `crankA` — PASS A, per participant

| Step                                             | Cost                      |
| ------------------------------------------------ | ------------------------- |
| `_syncUser` in the no-split, no-yield-delta case | ~1,910,000                |
| 2× `sub` euint128 (ticket/yield differences)     | ~520,000                  |
| 2× (`shr` euint128 scalar + narrow)              | ~74,000                   |
| `sub` euint64 (direct weight)                    | ~162,000                  |
| Fortune boost + effective-weight add             | measured in complete path |
| 3× `add` euint64 (effective/base/yield sums)     | ~486,000                  |
| **Known subtotal including unsplit `_syncUser`** | **≈ 3,150,000 + Fortune** |
| **Pre-synced known subtotal before overhead**    | **≈ 1,242,000 + Fortune** |

The complete pre-synced path measured **3,001,192 incremental global HCU per participant**. One participant plus the
fixed completion mask consumed 3,582,224 global HCU / 2,261,032 max depth. The largest successful batch was 6
(18,588,184 global / 3,071,032 max depth); 7 was rejected during Sepolia estimation. `BATCH_A_MAX = 3`, exactly
`floor(6 * 0.60)`.

> **This is the tightest constraint in the system, and the first thing to optimise.** Two available reductions: (a)
> require the keeper to call a separate `preSync(address[])` in its own transaction so `crankA` finds every user already
> synced, which removes the per-user accumulator roll from PASS A; (b) use `FHE.sum` where available to collapse the
> accumulation. Implement (a) — it is a pure win and needs no new cryptography.

With `preSync` separated, PASS A is global-HCU-bound before it is depth-bound. The measured cap leaves more than 40%
headroom against the successful boundary transaction.

### `crankB` — PASS B, per participant

| Step                                                 | Cost                      |
| ---------------------------------------------------- | ------------------------- |
| Winner comparisons + `and` + prize `select`          | ~375,000                  |
| Direct credit: widen + `mul` euint128 scalar + `shr` | ~733,000                  |
| Add prize/direct credit                              | ~162,000                  |
| Add total credit to user balance and liability       | ~324,000                  |
| Fortune update, ACL and persistence                  | measured in complete path |
| **Subtotal before unmeasured overhead**              | **≈ 1,594,000**           |

The complete path measured **4,025,320 global HCU per participant** and **3,032,096 max depth**. The largest successful
batch was 4 (16,101,280 global HCU); 5 was rejected during Sepolia estimation. `BATCH_B_MAX = 2`, exactly
`floor(4 * 0.60)`.

### `openRandom` — once per draw

| Step                           | Cost                         |
| ------------------------------ | ---------------------------- |
| `randEuint64`                  | 24,000                       |
| `rem` euint64 scalar           | 1,153,000                    |
| **Derived total**              | **≈ 1,211,000**              |
| **Measured strict-mode total** | **1,211,000 global / depth** |

### Confidential liability accounting and solvency checkpoint

The four-ledger correction adds encrypted work to user and credit paths. These costs are deliberately left unestimated
until the Task 2 spike measures the installed versions:

| Path                      | Additional encrypted work                                                              | Budget status |
| ------------------------- | -------------------------------------------------------------------------------------- | ------------- |
| Deposit                   | Add `moved` to per-user principal and aggregate principal/liability                    | [MEASURE]     |
| Withdraw/exit             | `min(moved, principalBalance)` plus user/aggregate principal and liability subtraction | [MEASURE]     |
| Direct-yield/prize credit | Add funded credit to aggregate liability; no principal mutation                        | [MEASURE]     |

Any measured per-action cost more than 50% above the resulting estimate is an escalation gate before batch caps or UX
assumptions are changed.

| Step                                                                   | Estimated cost          |
| ---------------------------------------------------------------------- | ----------------------- |
| Add vault + active + optional retiring adapter `euint64` asset handles | ~324,000                |
| Compare aggregate assets `ge` encrypted total liability                | ~149,000                |
| Persist and mark the aggregate `ebool` publicly decryptable            | included in measurement |
| **FHE subtotal before ACL/public-decryption overhead**                 | **≈ 473,000**           |

The complete three-source checkpoint measured **476,000 global HCU and 476,000 max depth**, a +0.6% difference from the
estimate.

This path is not per participant and is not in a draw hot loop. Task 2 must measure the complete
handle/ACL/public-decryption sequence on Sepolia; Task 14 re-runs it with production contracts. Numeric principal,
liability and asset totals stay encrypted, so no plaintext shortcut is permitted here.

### Transactions per draw

The old 25/25 projection is invalid and removed. The measured constants make the formula and projections authoritative:

| Stage          | Transaction count                                                       |
| -------------- | ----------------------------------------------------------------------- |
| preSync        | `ceil(N / PRESYNC_CAP)`                                                 |
| PASS A         | `ceil(N / BATCH_A_MAX)`                                                 |
| PASS B         | `ceil(N / BATCH_B_MAX)`                                                 |
| Fixed overhead | open, aggregate submission, randomness/reveal as applicable, settlement |

| Participants | preSync (`4`) | PASS A (`3`) | PASS B (`2`) | Variable transactions |
| -----------: | ------------: | -----------: | -----------: | --------------------: |
|           10 |             3 |            4 |            5 |                    12 |
|          100 |            25 |           34 |           50 |                   109 |
|        1,000 |           250 |          334 |          500 |                 1,084 |

After caps are measured, regenerate the N = 10/100/1,000/10,000 table and report it openly. Pair it with the improvement
paths in `docs/02-architecture.md` §12.

---

## 4. Working within the budget — heuristics

1. **Make an operand plaintext only when the allowlist says it leaks nothing.** Elapsed time, approved public draw
   totals and protocol constants qualify. Numeric principal/liability/assets and transaction deltas do not. Scalar
   variants are markedly cheaper where the privacy boundary permits them.
2. **Narrow before hot loops.** `cast` costs ~32 HCU. 64-bit comparison against 128-bit saves roughly 30% per iteration.
3. **Choose power-of-two denominators.** Division becomes `shr` at ~34–37,000 HCU instead of being impossible.
4. **Cache derived ciphertexts.** `rate = balance · θ` changes rarely; recomputing it per sync would be the most
   expensive line in the system.
5. **Move work into the user's own transaction.** Each transaction carries its own budget.
6. **Load accumulators once per transaction, not per loop iteration.**
7. **Prefer independent work over chained work.** Independent operations spend the 20M global budget; chained operations
   spend the 5M depth budget. Restructuring an accumulation into a tree reduces depth at no extra global cost.
8. **Cap batch parameters with a constant** so a caller cannot induce a revert with an oversized batch, and expose the
   cap for the keeper to read.

---

## 5. Measurement protocol — do this before building on any number above

`scripts/bench-hcu.ts` is a required deliverable, both for correctness and because the resulting table is one of the
three differentiators of this submission.

**Step 1 — instrument.** Deploy a `HCUProbe` contract on Sepolia exposing one function per candidate operation sequence:
a bare `crankA` iteration, a bare `crankB` iteration, a full `_syncUser`, and the randomness step. Each takes an
iteration count.

**Step 2 — bisect.** For each sequence, find the largest iteration count that does not revert. Binary search from 1
to 200. The revert boundary gives the effective per-iteration HCU cost, which is more trustworthy than the sum of table
entries because it includes overhead the table omits.

**Step 3 — record.** Write measured values into the tables above, marked `MEASURED yyyy-mm-dd`, keeping the derived
estimate alongside for comparison. Divergence beyond 50% is an escalation to the human per `CLAUDE.md` §8, because it
may invalidate the architecture.

**Step 4 — set constants from measurements.** Set `BATCH_A_MAX` and `BATCH_B_MAX` to **60% of the measured maximum**.
The margin absorbs protocol parameter changes and per-block cap interactions.

**Step 5 — publish.** Produce `docs/BENCHMARK.md` with the measured table, the derived table, batch sizes, transactions
per draw at N = 10 / 100 / 1,000, and the date and protocol version measured. Link it from the README. Run the benchmark
again immediately before submission — the protocol version may have moved.

---

<!-- BENCH-HCU:START -->

## 5.1 Latest Sepolia measurement

The measured per-iteration value is the incremental global HCU slope between the one-iteration transaction and the
largest successful transaction. PASS A includes its final anonymity-mask/public-decryption overhead at both points.

| Path                  | Revised estimate | Measured / iteration | Difference | Max success | 60% cap | Boundary transaction                                                 |
| --------------------- | ---------------: | -------------------: | ---------: | ----------: | ------: | -------------------------------------------------------------------- |
| \_syncUser checkpoint |        2,430,000 |            2,430,032 |      +0.0% |           8 |       4 | `0x07421d1501d2065616150e617651278976f0ba3d53f07972d35974f523ac61a1` |
| PASS A participant    |        3,556,000 |            3,001,192 |     -15.6% |           6 |       3 | `0x1c6c0ceb9779c484691b7c362c96e2dfc2c1a529c74e482359f0d7575262bff1` |
| PASS B participant    |        3,870,000 |            4,025,320 |      +4.0% |           4 |       2 | `0x4395fc2844dee2c92ed94d0ec5d0a5f11406ad677db0ba52d59cdbfa421951e3` |
| strict randomness     |        1,211,000 |            1,211,000 |      +0.0% |          16 |       9 | `0x7e94d9bcfca65a31e5adbd56400d8b984fc27e397bdba2996d84d5ec7bb79eff` |
| Fortune update        |        [MEASURE] |              294,128 |        n/a |          67 |      40 | `0xbbc8983711ad8bb272e7a5cf44e8ebc4f56f04c81b16af74964ce6394ec0b894` |
| solvency boolean      |          473,000 |              476,000 |      +0.6% |          42 |      25 | `0x5a045dcbf43a8294df501c50a4d4de69ee3fb9040727d9dfc5718fefdbc32e42` |

Configured pre-sync remains the reviewed production constant 4. The measured safe ceilings for PASS A and PASS B are 3
and 2; constants are frozen only when GATE 3 passes.

<!-- BENCH-HCU:END -->

---

## 6. Escalation triggers

- Measured per-participant cost more than 50% above the revised estimate, or either measured cap below the minimum
  needed for the documented demo-latency target, requires escalation before changing the design or UX.
- Any operation exceeding the depth limit on a **single** iteration → a dependent chain has been introduced where the
  design assumed independence. Find and break it.
- A per-block cap causing reverts when several cranks land in the same block → serialise the keeper and document the
  constraint.
