# Lok Protocol Sepolia Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Contract implementation and proof execution must be assigned to independent
> workers with separate context.

**Goal:** Build, prove, deploy, verify, and package Lok Protocol as a confidential prize-savings vault on Ethereum
Sepolia by the internal submission target of 2026-09-03.

**Architecture:** Lok keeps per-user claimable/principal positions and aggregate principal/liability encrypted in
ERC-7984 cUSDC. It publicly decrypts only approved draw aggregates and a checkpoint-specific aggregate solvency boolean
over assets versus liabilities. A paginated two-pass draw refines the checked TLA+ state machine; risky custody
transitions require a current solvency checkpoint, while deposit and principal recovery remain available independently
of oracle liveness.

**Tech Stack:** Solidity 0.8.27, Hardhat 2, `@fhevm/solidity`, OpenZeppelin confidential contracts/ERC-7984, Foundry
invariant testing, TLA+/TLC, TypeScript, React, Vite, wagmi, viem, Zama SDK v3, Sepolia, Etherscan, and Vercel static
hosting.

## Global Constraints

- Target Ethereum Sepolia only. No Arc, multichain accounting, governance token, NFTs, leaderboard, multi-tier prizes,
  or Lok-operated accounting relayer.
- `docs/10-proof-strategy.md` section 3 remains frozen until the human explicitly approves and re-freezes the reviewed
  amendments in Task 1.
- Before any FHEVM or Zama SDK symbol is used, its exact installed-version signature must be `VERIFIED` in
  `docs/API-VERIFIED.md`; draw-pipeline and solvency-checkpoint calls must be `TESTED` on Sepolia.
- No production Solidity may be written until Task 1 is re-frozen, Task 2's disposable API probe passes, and Task 3 has
  no unresolved TLC counterexample.
- Deposit, withdraw, exit, and emergency withdrawal remain callable through every draw/pause/config state. Oracle
  failure may block new risk transitions but never principal recovery.
- Never branch on ciphertext, divide or take remainder by an encrypted divisor, emit encrypted handles for per-user
  values, or publicly decrypt a per-user ciphertext or numeric principal/liability/asset aggregate.
- Every stored ciphertext receives the required persistent ACL grant. Prize-credit grants are uniform across all
  participants.
- Every encrypted expression needs a written bound derivation and boundary test. Batch caps are 60% of measured Sepolia
  HCU maxima.
- The implementation team must not write or approve its own invariant proof. Proof workers consume specifications and
  public interfaces, not implementation reasoning.
- Use TDD: add a focused failing test, observe the expected failure, implement the smallest conforming behavior, then
  run focused and regression suites.
- Do not lower the Tier-A campaign target of 10,000,000 sequences. If unavailable, report the exact count and stop at
  GATE 4.
- Do not create the submission video or publish the X thread. Produce a human-recordable script and draft only.
- The current directory is not a Git repository. A human must create or attach the public repository before commit steps
  can execute; agents must not silently run `git init`.

## Current Baseline

- Frozen proposition table: 42 rows in `docs/10-proof-strategy.md`.
- TLA+ model: 32,540,661 generated states, 3,392,960 distinct states, depth 33, no counterexample in the last recorded
  run.
- Existing partial Tier-B obligations: P-L6 numeric boundary, P-S7 arithmetic, P-F3 red-team/distribution, P-A4 unit,
  P-A8 numeric solvency, and P-O1 unit/fuzz.
- Contract test is RED: `npx hardhat test test/LokStage2.ts` fails because `MockYieldAdapter` has no artifact.
- Sepolia RPC/deployer pipeline is blocked by an invalid Infura project ID. HCU and public-decryption latency remain
  unmeasured.
- Installed package snapshot is recorded in `docs/API-VERIFIED.md`; compatibility between Sepolia FHEVM v0.13 and
  installed `@fhevm/solidity@0.11.1` must be resolved before contracts.

## Target File Map

### Proof and specification

- Modify `CLAUDE.md`: revised I4/I11 text only after human approval.
- Modify `docs/02-architecture.md`: encrypted principal, bounded custody set, accounting epochs, solvency checkpoint,
  and recovery-only behavior.
- Modify `docs/05-contract-specs.md`: exact storage, interfaces, state transitions, errors, and checkpoint ABI.
- Modify `docs/08-threat-model.md`: solvency-status leakage, checkpoint timing leakage, adapter trust, and stale-proof
  attacks.
- Modify `docs/10-proof-strategy.md`: reviewed wording for P-S2/P-P7/P-P8/P-A8 and unchanged count of 42; re-freeze date
  supplied by human.
- Modify `spec/LokDraw.tla` and `spec/LokDraw.cfg`: accounting epoch, checkpoint pending/verified/false, restricted
  mode, and oracle-down interleavings.
- Create `docs/proofs/P-S2-solvency.md`, `docs/proofs/P-S3-prize-conservation.md`,
  `docs/proofs/overflow-derivations.md`, and `docs/proofs/modulo-bound.md`.

### Contracts and interfaces

- Create `contracts/interfaces/ILokVault.sol`: draw-manager-facing vault API.
- Create `contracts/interfaces/IYieldAdapter.sol`: confidential asset custody API.
- Create `contracts/LokVault.sol`: user accounting, eTWAB, principal ledger, custody, and solvency checkpoints.
- Create `contracts/LokDrawManager.sol`: dual-mode draw state machine and two paginated sweeps.
- Create `contracts/LokGuardian.sol`: abort-only threshold guardian, or omit it in favor of permissionless timeout abort
  if no real threshold signer set is available.
- Create `contracts/adapters/MockYieldAdapter.sol`: deployed confidential cUSDC demo adapter.
- Create `contracts/adapters/MorphoVaultAdapter.sol`: non-deployed compatibility adapter only if the live target
  preserves the approved confidential path.
- Create `contracts/probes/SolvencyCheckpointProbe.sol` and `contracts/probes/HCUProbe.sol`: disposable Sepolia/API
  measurements.
- Create `contracts/test/` mocks for malicious ERC-7984 behavior, forged adapters, and plaintext reference-model
  bridges.

### Tests and evidence

- Replace `test/LokStage2.ts` with focused suites under `test/unit`, `test/draw`, `test/compliance`, `test/invariants`,
  `test/privacy`, `test/statistical`, and `test/integration` as routed by `docs/07-test-plan.md`.
- Create `test/api/SolvencyCheckpointProbe.t.ts` and `test/integration/sepolia.e2e.t.ts`.
- Create Foundry files `foundry.toml`, `lib/forge-std`, `test-foundry/handlers`, `test-foundry/invariants`, and
  `test-foundry/reference`.
- Create `scripts/run-invariants.ps1`, `scripts/run-fairness.ts`, `scripts/privacy-scan.ts`, and
  `scripts/render-fairness.ts`.
- Create generated evidence `artifacts/fairness.json`, `artifacts/fairness.png`, `artifacts/invariants/*.json`, and
  `artifacts/privacy-report.json` through commands, not manual editing.

### Frontend and operations

- Create `frontend/` as an independent Vite React TypeScript application with `src/fhe`, `src/contracts`,
  `src/components`, `src/features`, `src/pages`, and `src/test` boundaries.
- Create `scripts/probe-solvency.ts`, `scripts/assert-wasm.mjs`, `scripts/deploy.ts`, `scripts/seed-demo.ts`,
  `scripts/crank.ts`, `scripts/verify-draw.ts`, `scripts/bench-hcu.ts`, and `scripts/export-addresses.ts`.
- Create `deployments/sepolia.json` as the single generated source for contract addresses consumed by README and
  frontend.
- Create `docs/BENCHMARK.md`, `docs/DEPLOYMENT.md`, `docs/VIDEO-SCRIPT.md`, and `docs/X-THREAD-DRAFT.md`.
- Replace template `README.md` only after real evidence and deployment addresses exist.

## Delivery Calendar

| Date                     | Exit condition                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| 2026-08-08 to 2026-08-09 | Re-review frozen requirements; API/ACL/boolean checkpoint spike and Sepolia credentials pass.     |
| 2026-08-10               | Revised TLA+ model passes; Foundry execution mode is decided and recorded.                        |
| 2026-08-11 to 2026-08-15 | Stage 2 contracts pass compliance, eTWAB, draw, checkpoint, and adversarial mock tests.           |
| 2026-08-16 to 2026-08-20 | Stage 3 Tier-A campaigns and hand proofs complete with actual sequence counts.                    |
| 2026-08-21 to 2026-08-22 | Stage 4 differential and full mock-mode suites pass with no unexplained divergence.               |
| 2026-08-23               | Stage 5 fairness evidence and chart complete.                                                     |
| 2026-08-24               | Stage 6 privacy report complete; all enumerated channels refuted or surfaced.                     |
| 2026-08-25               | Stage 7 Sepolia HCU/latency measurements complete; batch caps frozen at 60%.                      |
| 2026-08-26 to 2026-08-29 | Stage 8 frontend complete, responsive, and deployed to a public preview URL.                      |
| 2026-08-30 to 2026-09-01 | Stage 9 final Sepolia deploy, Etherscan verification, seed, real settled draw, and verifier PASS. |
| 2026-09-02               | Clean-wallet/browser rehearsal, clean-clone run, README and delivery package final review.        |
| 2026-09-03               | Human records video, publishes thread/community post, and submits.                                |
| 2026-09-04 to 2026-09-05 | Emergency buffer only; no features. Deadline is 2026-09-05 23:59 AOE.                             |

---

### Task 1: Re-review and Re-freeze the Solvency Contract

**Owner:** Human reviewer with specification worker support.

**Files:**

- Modify: `CLAUDE.md`
- Modify: `docs/00-product-brief.md`
- Modify: `docs/02-architecture.md`
- Modify: `docs/03-fhevm-knowledge.md`
- Modify: `docs/04-hcu-budget.md`
- Modify: `docs/05-contract-specs.md`
- Modify: `docs/06-frontend-spec.md`
- Modify: `docs/07-test-plan.md`
- Modify: `docs/08-threat-model.md`
- Modify: `docs/10-proof-strategy.md`
- Modify: `docs/12-retention-mechanisms.md`
- Reference: `docs/superpowers/specs/2026-08-08-confidential-solvency-design.md`

**Consumes:** The approved confidential solvency design.

**Produces:** Authoritative I4/I11, P-S2/P-P7/P-P8/P-A8 wording and contract specification, with proposition count
still 42.

- [ ] Replace the plaintext `totalPrincipal` architecture with separate encrypted user/aggregate principal and claimable
      liability ledgers, bounded active/retiring adapter custody, separate `accountingVersion`/`riskEpoch` counters, and
      the aggregate assets-versus-liabilities `isSolvent` checkpoint flow.
- [ ] Specify exact checkpoint states, handle/nonce/risk-epoch/accounting-snapshot binding, recovery behavior, and the
      rule that deposit/withdraw/exit/emergency-withdraw remain enabled after a `false` result or permanent oracle
      failure.
- [ ] Amend I4 to allow only existing draw aggregates plus checkpoint-specific `isSolvent`; explicitly forbid numeric
      principal/liability/assets and per-user deltas.
- [ ] Amend I11 and P-S2 using the approved hybrid proof-by-construction/checkpoint statement; clarify that TLC covers
      liveness, not numeric solvency.
- [ ] Amend P-P7's aggregate-Fortune disclosure boundary, P-P8's static allowlist and P-A8's current-checkpoint
      dependency without adding a proposition row.
- [ ] Add checkpoint timing and solvency-status disclosure to the threat model as aggregate leakage; document that it
      reveals no amount.
- [ ] Have the human review the complete diff and set the new freeze line. Do not infer the freeze date or approval.
- [ ] Verify proposition integrity:

  Run: `rg -c "^\| P-" docs/10-proof-strategy.md`

  Expected: `42`.

- [ ] Verify removed plaintext design text no longer governs:

  Run:
  `rg -n "uint256 public totalPrincipal|\+moved|confidentialBalanceOfSelf_public" CLAUDE.md docs/02-architecture.md docs/05-contract-specs.md docs/10-proof-strategy.md`

  Expected: no authoritative match; historical discussion may remain only if explicitly marked superseded.

- [ ] Commit after Git exists:

  Run:
  `git add CLAUDE.md docs/02-architecture.md docs/05-contract-specs.md docs/08-threat-model.md docs/10-proof-strategy.md docs/superpowers/specs/2026-08-08-confidential-solvency-design.md`

  Then: `git commit -m "docs: re-freeze confidential solvency model"`

### Task 2: Complete the API and Sepolia De-risking Spike

**Owner:** Protocol integration worker; findings reviewed independently.

**Files:**

- Create: `contracts/probes/SolvencyCheckpointProbe.sol`
- Create: `test/api/SolvencyCheckpointProbe.t.ts`
- Modify: `docs/API-VERIFIED.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `hardhat.config.ts`

**Consumes:** Re-frozen allowlist and exact checkpoint ABI from Task 1.

**Produces:** `TESTED` signatures and transaction evidence for ERC-7984 ACL, aggregate boolean public decryption, proof
binding, and compatible package versions.

- [ ] Configure a valid Sepolia RPC and throwaway funded deployer using Hardhat encrypted variables; never write a
      private key into the repository.

  Run: `npx hardhat vars setup`

  Expected: required variable names are listed and no secret value is printed.

- [ ] Compare installed package versions to the live Sepolia protocol version. If `@fhevm/solidity@0.11.1` is
      incompatible with Sepolia v0.13, update the FHEVM packages as one compatible set, regenerate the lockfile, and
      record the exact migration in `docs/API-VERIFIED.md` before using changed symbols.
- [ ] Write the probe only with symbols already marked `VERIFIED`: obtain an encrypted ERC-7984 balance handle, grant
      cross-contract ACL, compute `FHE.ge`, mark only the `ebool` publicly decryptable, and bind a submitted proof to
      its recorded handle and epoch.
- [ ] Add RED tests for valid `true`, valid `false`, forged proof, malformed cleartext, wrong handle, stale epoch,
      duplicate submission, and missing ACL.
- [ ] Run mock-mode probe tests:

  Run: `npx hardhat test test/api/SolvencyCheckpointProbe.t.ts`

  Expected: all cases pass; the public-decryption allowlist contains only the probe's aggregate boolean.

- [ ] Deploy the probe to Sepolia and execute one real public-decryption round trip.

  Run: `npx hardhat run scripts/probe-solvency.ts --network sepolia`

  Expected: transaction hashes for open and submit, decoded `true`, and explicit rejection transactions or call
  simulations for forged/stale cases.

- [ ] Record latency, fee payer, ABI encoding, ACL behavior, returned-transfer handle behavior, contract addresses,
      package versions, and source links as `TESTED` in `docs/API-VERIFIED.md`.
- [ ] Stop at GATE 3 if documented API behavior differs; stop at GATE 2 if a confidential adapter asset handle cannot be
      used by the vault.
- [ ] Commit:

  Run:
  `git add contracts/probes/SolvencyCheckpointProbe.sol test/api/SolvencyCheckpointProbe.t.ts docs/API-VERIFIED.md package.json package-lock.json hardhat.config.ts scripts/probe-solvency.ts`

  Then: `git commit -m "test: prove confidential solvency checkpoint API"`

### Task 3: Refine and Re-check the TLA+ Model

**Owner:** Proof worker with no contract implementation context.

**Files:**

- Modify: `spec/LokDraw.tla`
- Modify: `spec/LokDraw.cfg`
- Modify: `docs/10-proof-strategy.md` only if the human explicitly requests a proposition re-review.

**Consumes:** Re-frozen P-S2/P-P7/P-P8/P-A8 and checkpoint state transitions.

**Produces:** TLC evidence that checkpoint/oracle/config interleavings do not block principal recovery or authorize
stale risk transitions.

- [ ] Add abstract variables for `accountingVersion`, `riskEpoch`, checkpoint snapshot/status, restricted mode,
      active/retiring adapter state, and oracle availability.
- [ ] Model deposit and withdrawal as always-enabled conservation transitions and funded credit as a safe accounting
      transition; model checkpoint completion as optional forever when the oracle is down.
- [ ] Model post-`tEnd` safe-flow spam that advances `accountingVersion`; assert it neither invalidates a checkpoint in
      the same `riskEpoch` nor stalls the draw cursor. Model a risk-boundary change as invalidating prior authorization.
- [ ] Model stale/forged/false checkpoint submissions, adapter proposal/activation/removal, pause/config, spam abort,
      and adversarial step reordering.
- [ ] Model both zero-denominator outcomes: `W == 0` voids directly, while `W > 0 && T == 0` skips randomness and
      reaches PASS B direct-credit settlement without a winner.
- [ ] Add invariants: stale or false checkpoints never authorize risk transitions; adapter activation is IDLE-only and
      timelocked; recovery actions remain enabled in every reachable state.
- [ ] Run TLC with 3 participants and the existing finite bounds:

  Run:
  `& 'C:\Users\TBC\tools\jdk-21.0.12+8-jre\bin\java.exe' -jar 'C:\Users\TBC\tools\tla2tools.jar' -deadlock -workers 4 -config 'D:\Lok\spec\LokDraw.cfg' 'D:\Lok\spec\LokDraw.tla'`

  Expected: `Model checking completed. No error has been found.` Record generated/distinct states and depth.

- [ ] If TLC finds a design counterexample, stop at GATE 1 and show the trace plus proposed architecture/spec fix before
      editing those docs.
- [ ] Commit:

  Run: `git add spec/LokDraw.tla spec/LokDraw.cfg`

  Then: `git commit -m "proof: model confidential solvency checkpoints"`

### Task 4: Establish Foundry and Independent Reference Models

**Owner:** Verification worker, separate from Solidity implementation.

**Files:**

- Create: `foundry.toml`
- Create: `test-foundry/reference/LokAccountingModel.sol`
- Create: `test-foundry/reference/LokDrawReference.sol`
- Create: `test-foundry/handlers/LokHandler.sol`
- Create: `test-foundry/invariants/LokAccountingInvariant.t.sol`
- Modify: `docs/API-VERIFIED.md`

**Consumes:** Numeric bounds and re-frozen propositions, not contract internals.

**Produces:** A runnable plaintext reference model and a recorded decision on Foundry/FHE mock compatibility.

- [ ] Install Foundry and `forge-std` through the official Foundry workflow; record versions.
- [ ] Test whether Foundry can execute the installed FHE mock precompiles with a one-operation probe.
- [ ] If it cannot, record the decision required by `docs/11-tooling.md`: Foundry runs the independent plaintext
      reference model; Hardhat owns FHE-in-the-loop checks.
- [ ] Encode deposit/withdraw accounting, epochs, adapter custody, draw partitioning, Fortune, and prize conservation
      directly from specs without importing production contracts.
- [ ] Add one RED invariant proving the harness detects an intentionally injected principal-credit mismatch; remove the
      injected defect only after observing failure.
- [ ] Run smoke campaigns:

  Run: `forge test --match-path "test-foundry/**/*.sol" -vv`

  Expected: all smoke tests pass and invariant call counts are printed.

- [ ] Commit:

  Run: `git add foundry.toml test-foundry docs/API-VERIFIED.md`

  Then: `git commit -m "test: add independent Lok reference models"`

### Task 5: Define Contract Interfaces and RED Compliance Tests

**Owner:** Contract implementation worker.

**Files:**

- Create: `contracts/interfaces/ILokVault.sol`
- Create: `contracts/interfaces/IYieldAdapter.sol`
- Create: `test/compliance/spec.t.ts`
- Modify: `test/LokStage2.ts`

**Consumes:** Re-frozen contract specs and `TESTED` APIs.

**Produces:** Exact ABI boundaries and failing R1-R9/skeleton tests before implementation.

- [ ] Define `ILokVault` functions required by the draw manager: participant pagination, `preSync`, draw checkpoint
      reads/writes, uniform prize crediting, realised-yield access, and draw-state callbacks.
- [ ] Define `IYieldAdapter` around confidential cUSDC custody: asset address, encrypted deposit/withdraw result,
      encrypted aggregate assets with vault ACL, harvest behavior, and no privileged fund-transfer interface.
- [ ] Replace stale constructor assumptions in `test/LokStage2.ts` with constructors specified in Task 1.
- [ ] Add the exact compliance test names R1-R9 from `docs/07-test-plan.md`, including R2's default-theta full-yield
      cycle.
- [ ] Run RED:

  Run: `npx hardhat test test/LokStage2.ts test/compliance/spec.t.ts`

  Expected: failure is limited to missing `LokVault`, `LokDrawManager`, and `MockYieldAdapter` behavior/artifacts, not
  TypeScript syntax or fixture errors.

- [ ] Commit test/interfaces checkpoint:

  Run: `git add contracts/interfaces test/LokStage2.ts test/compliance/spec.t.ts`

  Then: `git commit -m "test: define Lok contract compliance surface"`

### Task 6: Implement Confidential Adapter Custody and Solvency Checkpoints

**Owner:** Contract implementation worker.

**Files:**

- Create: `contracts/adapters/MockYieldAdapter.sol`
- Create: `contracts/test/MaliciousYieldAdapter.sol`
- Create: `test/unit/LokVault.solvency.t.ts`
- Create: `test/unit/MockYieldAdapter.t.ts`
- Create: `contracts/LokVault.sol`

**Consumes:** Task 2 probe behavior and Task 5 interfaces.

**Produces:** Lossless confidential custody, bounded adapter set, accounting epochs, and exact proof binding.

- [ ] Write RED tests for confidential deposit/withdraw returned amounts, vault ACL, epoch increments, valid checkpoint,
      false checkpoint, stale/forged/wrong-handle proof, non-empty adapter removal, and oracle-independent recovery.
- [ ] Run focused RED:

  Run: `npx hardhat test test/unit/MockYieldAdapter.t.ts test/unit/LokVault.solvency.t.ts`

  Expected: failures identify unimplemented adapter/checkpoint methods.

- [ ] Implement `MockYieldAdapter` with cUSDC-only custody, bounded access, deterministic demo yield injection, and no
      admin principal transfer.
- [ ] Implement vault checkpoint storage and transitions exactly as re-frozen, including `accountingVersion`,
      `riskEpoch`, checkpoint nonce/handle/snapshot, `lastSolventRiskEpoch`, restricted mode, and active/retiring
      adapter rules.
- [ ] Implement `_principalBalance`, `_encryptedTotalPrincipal` and `_encryptedTotalLiability`; checkpoint aggregate
      assets against liabilities, which implies principal coverage.
- [ ] Add `FHE.allowThis`/vault grants at every persistence/cross-contract boundary and no user/role grant on aggregate
      principal/liability/assets.
- [ ] Run focused GREEN and full regression:

  Run focused: `npx hardhat test test/unit/MockYieldAdapter.t.ts test/unit/LokVault.solvency.t.ts`

  Run regression: `npx hardhat test`

  Expected: focused suites pass; unrelated template tests remain passing or are intentionally removed in a separate
  cleanup commit.

- [ ] Commit:

  Run:
  `git add contracts/adapters/MockYieldAdapter.sol contracts/test/MaliciousYieldAdapter.sol contracts/LokVault.sol test/unit`

  Then: `git commit -m "feat: add confidential custody and solvency checkpoints"`

### Task 7: Implement LokVault User Accounting and eTWAB

**Owner:** Contract implementation worker.

**Files:**

- Modify: `contracts/LokVault.sol`
- Create: `test/unit/LokVault.deposit.t.ts`
- Create: `test/unit/LokVault.withdraw.t.ts`
- Create: `test/unit/LokVault.theta.t.ts`
- Create: `test/unit/LokVault.sync.t.ts`
- Create: `test/unit/LokVault.yield.t.ts`
- Create: `test/invariants/overflow.t.ts`
- Create: `docs/proofs/overflow-derivations.md`

**Consumes:** Custody/checkpoint primitives from Task 6 and numeric constants from architecture.

**Produces:** Deposit, withdrawal, exit, emergency withdrawal, theta, eTWAB, Fortune storage, participant enrollment,
and encrypted status results.

- [ ] Add RED tests for all ten eTWAB cases in `docs/07-test-plan.md`, all user actions in every draw state, ERC-7984
      clamping, participant enrollment/removal, and encrypted status codes.
- [ ] Add boundary tests for every encrypted expression before adding the corresponding implementation expression; write
      the closed-form bound beside each test in `docs/proofs/overflow-derivations.md`.
- [ ] Implement `_syncUser`, exact `tEnd` segment splitting, `_recomputeRate`, `preSync`, deposit, withdraw,
      withdrawAll, exit, emergencyWithdraw, and setTheta without ciphertext branches.
- [ ] Ensure deposit adds the returned `moved` handle to user/aggregate balance and principal; withdrawal subtracts
      `moved` from liability and only `min(moved, principalBalance)` from principal. Funded credits update liability
      only.
- [ ] Grant persistent ACL to the vault and owner-only decryption ACL to the user for both user ledgers; never grant a
      numeric aggregate ledger to a user or role.
- [ ] Run focused suites:

  Run: `npx hardhat test test/unit/LokVault.*.t.ts test/invariants/overflow.t.ts`

  Expected: all vault/eTWAB/boundary tests pass.

- [ ] Run static forbidden-pattern scan:

  Run: `rg -n "if\s*\(.*FHE\.|FHE\.(div|rem)\([^,]+,\s*e|emit .*euint|makePubliclyDecryptable" contracts/LokVault.sol`

  Expected: only checkpoint-specific aggregate boolean public-decryption call is allowlisted; no encrypted
  branch/divisor/event finding.

- [ ] Commit:

  Run: `git add contracts/LokVault.sol test/unit test/invariants/overflow.t.ts docs/proofs/overflow-derivations.md`

  Then: `git commit -m "feat: implement confidential vault accounting"`

### Task 8: Implement the Dual-mode Draw Manager

**Owner:** Contract implementation worker.

**Files:**

- Create: `contracts/LokDrawManager.sol`
- Create: `test/draw/DrawManager.state.t.ts`
- Create: `test/draw/DrawManager.sweepA.t.ts`
- Create: `test/draw/DrawManager.sweepB.t.ts`
- Create: `test/draw/DrawManager.randomness.t.ts`
- Create: `test/draw/DrawManager.outcome-integrity.t.ts`

**Consumes:** Checked TLA transitions and `ILokVault`.

**Produces:** IDLE/OPEN/SWEEP_A/AWAIT_TOTAL/REVEAL/RANDOM_SET/SWEEP_B/SETTLED flow, strict reveal sequencing,
proof-verified totals, and uniform settlement.

- [ ] Add RED tests for every legal/illegal transition, bounded cursors, concurrent crank idempotence, abort cleanup,
      pause/config reachability, strict reveal timeout, randomness-after-reveal, and zero/all-dust voids.
- [ ] Add explicit adversarial RED tests for P-O1: forged/stale totals or proofs, stale randomness, caller-controlled
      batch boundaries, cursor skipping/reprocessing, and pre-deadline random generation.
- [ ] Implement `openDraw`, commitment/reveal, `enterReveal`, `crankA`, proof-verified `submitTotals`, both `openRandom`
      modes, `crankB`, settlement, and abort as a refinement of `spec/LokDraw.tla`.
- [ ] In PASS A, derive normalized per-draw base-risk/yield/direct/effective weights from the exact `tEnd` checkpoints
      and commit effective-ticket, base-risk and yield-weight aggregate handles. In PASS B, compute fixed-point direct
      credit exactly once per participant; do not implement a cumulative `yieldIndex`.
- [ ] Handle `W == 0` as a clean void and `W > 0 && E == 0` as no-winner direct-credit settlement without randomness.
- [ ] Use half-open ranges `[rangeStart, rangeEnd)`; ensure the encrypted win predicate and Fortune reset use
      `FHE.select`; grant prize-credit decryption uniformly to every participant.
- [ ] Mark only approved aggregate draw handles publicly decryptable; never expose range, weight, Fortune, theta,
      balance, or credit handles.
- [ ] Run focused and regression suites:

  Run focused: `npx hardhat test test/draw/*.t.ts test/compliance/spec.t.ts`

  Run regression: `npx hardhat test`

  Expected: draw/compliance/full suites pass with no stale-template artifact dependency.

- [ ] Commit:

  Run: `git add contracts/LokDrawManager.sol test/draw test/compliance/spec.t.ts`

  Then: `git commit -m "feat: implement checked Lok draw state machine"`

### Task 9: Close Authorization, Reentrancy, and Adapter-swap Surfaces

**Owner:** Contract implementation worker; tests reviewed by verification worker.

**Files:**

- Create: `contracts/LokGuardian.sol` only if a real threshold of at least two signers is configured.
- Create: `contracts/test/MaliciousConfidentialToken.sol`
- Create: `test/invariants/authorization.t.ts`
- Create: `test/invariants/reentrancy.t.ts`
- Create: `test/unit/LokGuardian.t.ts`
- Modify: `contracts/LokVault.sol`
- Modify: `contracts/LokDrawManager.sol`

**Consumes:** Completed vault/draw public surfaces.

**Produces:** P-S8 and P-A1/A2/A3/A4/A6/A8 enforcement with no privileged fund or decryption path.

- [ ] Decide guardian deployment mechanically: deploy only when at least two independent signer addresses and
      threshold >=2 exist; otherwise omit the contract and use permissionless timeout abort.
- [ ] Add malicious callback tests that re-enter deposit, withdraw, exit, checkpoint submission, crank, and adapter
      activation.
- [ ] Add role tests proving owner, guardian, keeper, and adapter admin cannot move funds, decrypt user state, mutate
      theta/Fortune/credit/eligibility, steer outcomes, or bypass checkpoint/timelock/IDLE rules.
- [ ] Implement least-privilege roles, checks-effects-interactions ordering, reentrancy guards, delayed adapter
      proposal, and abort-only guardian surface.
- [ ] Run:

  Run: `npx hardhat test test/invariants/authorization.t.ts test/invariants/reentrancy.t.ts test/unit/LokGuardian.t.ts`

  Expected: every unauthorized/malicious call reverts or no-ops without protected-state change.

- [ ] Commit:

  Run: `git add contracts test/invariants test/unit/LokGuardian.t.ts`

  Then: `git commit -m "security: enforce Lok role and reentrancy boundaries"`

### Task 10: Execute Tier-A Proof Campaigns

**Owner:** Independent proof worker; production implementation workers may only answer interface questions.

**Files:**

- Create: `test-foundry/invariants/LokSafetyInvariant.t.sol`
- Create: `test-foundry/invariants/LokFairnessInvariant.t.sol`
- Create: `scripts/run-invariants.ps1`
- Create: `docs/proofs/P-S2-solvency.md`
- Create: `docs/proofs/P-S3-prize-conservation.md`
- Create: `artifacts/invariants/` through the runner.

**Consumes:** Public contract ABI, re-frozen propositions, and independent reference model.

**Produces:** Actual sequence counts and hand proofs for all Tier-A obligations and partial A-halves.

- [ ] Implement handlers for deposit, withdraw, theta, time, open/abort/settle draw, forged proofs, malicious token
      callbacks, adapter proposal/activation, pause, and recovery.
- [ ] Assert P-S1, P-S2, P-S3, P-S4, P-S5, P-S6, P-S8, P-S9, P-A1, P-A2, P-A3, P-A4-half, P-A6, P-A8-half, P-F5, P-F6,
      P-F7, P-F9, P-L5-half, P-L6 boundary, P-S7 arithmetic, and P-O1 unit/fuzz.
- [ ] Test P-L6 at `tEnd-1`, `tEnd`, and `tEnd+1`; test wEff/prefix bounds at maximum balance, Fortune, participants,
      and dust.
- [ ] Write inductive hand proofs enumerating every transition for P-S2 and P-S3; state platform/adapter assumptions
      explicitly.
- [ ] Run each campaign to at least 10,000,000 action sequences and write machine-readable counts:

  Run: `powershell -ExecutionPolicy Bypass -File scripts/run-invariants.ps1`

  Expected: every report has `sequences >= 10000000`, zero invariant failure, seed, duration, tool version, and git
  commit.

- [ ] If any campaign cannot reach the target, stop at GATE 4 and report the exact count. Do not reduce runs/depth
      silently.
- [ ] Have a human or independent proof reviewer sign off the P-S2/P-S3 markdown proofs.
- [ ] Commit:

  Run: `git add test-foundry scripts/run-invariants.ps1 docs/proofs artifacts/invariants`

  Then: `git commit -m "proof: complete tier A invariant campaigns"`

### Task 11: Run Differential and Full Mock-mode Testing

**Owner:** Verification workers in two independent contexts.

**Files:**

- Create: `test/reference/sync-reference.ts`
- Create: `test/reference/draw-reference.ts`
- Create: `test/differential/sync.differential.t.ts`
- Create: `test/differential/draw.differential.t.ts`
- Complete: all test files routed by `docs/07-test-plan.md`.

**Consumes:** Production ABI and independent reference models.

**Produces:** No unexplained divergence and complete mock/adversarial coverage.

- [ ] Have one worker implement the mathematical `_syncUser` oracle and another implement the draw oracle from
      specifications without reading production implementations.
- [ ] Generate deterministic fuzz vectors covering time boundaries, balance/theta changes, dust, zero totals, Fortune
      cap/splits, cursor boundaries, and stale inputs.
- [ ] Compare production decrypted mock outputs against both references for every vector; persist the first divergent
      seed before diagnosis.
- [ ] Run all compliance, eTWAB, Fortune, liveness, accounting, overflow, and adversarial cases from
      `docs/07-test-plan.md`.
- [ ] Run coverage:

  Run: `npm run coverage`

  Expected: contracts exceed 90% line and 80% branch coverage; no excluded critical accounting/draw file.

- [ ] Run quality checks:

  Run: `npm run lint`

  Run: `npm run build:ts`

  Run: `npm test`

  Expected: all commands exit 0.

- [ ] Treat any unexplained differential divergence as GATE 1 when it reflects a spec ambiguity/design change.
- [ ] Commit:

  Run: `git add test docs/07-test-plan.md`

  Then: `git commit -m "test: complete differential and adversarial suites"`

### Task 12: Produce Statistical Fairness Evidence

**Owner:** Independent statistical verification worker.

**Files:**

- Create: `scripts/run-fairness.ts`
- Create: `scripts/render-fairness.ts`
- Create: `artifacts/fairness.json` through the runner.
- Create: `artifacts/fairness.png` through the renderer.
- Create: `docs/proofs/modulo-bound.md`

**Consumes:** Frozen P-F1/P-F1'/P-F2/P-F4 and exact tEnd snapshot behavior.

**Produces:** >=1,000,000-draw Monte Carlo evidence, chi-squared result, chart, modulo proof, and trust boundary.

- [ ] Generate deterministic scenarios with varied balances, theta, draw windows, and Fortune histories; include
      zero-weight and split-principal cases.
- [ ] Run at least 1,000,000 draws for the Fortune-active P-F1' distribution; record seed, observed/expected counts, 99%
      intervals, chi-squared statistic, degrees of freedom, and p-value.
- [ ] Require every participant inside the stated interval and `p > 0.01`; a failure is investigated, never rerolled by
      changing the seed.
- [ ] Render the expected-versus-observed chart from `artifacts/fairness.json`.
- [ ] Write and independently review the modulo bias bound; document FHE.rand uniformity as P-F4's platform trust
      boundary.
- [ ] Run:

  Run: `npx ts-node scripts/run-fairness.ts`

  Run: `npx ts-node scripts/render-fairness.ts`

  Expected: JSON reports `draws >= 1000000` and `pValue > 0.01`; PNG exists and is non-empty.

- [ ] Commit:

  Run:
  `git add scripts/run-fairness.ts scripts/render-fairness.ts artifacts/fairness.json artifacts/fairness.png docs/proofs/modulo-bound.md`

  Then: `git commit -m "proof: publish Lok fairness evidence"`

### Task 13: Complete Tier-D Privacy Verification

**Owner:** Privacy red-team worker with no implementation context.

**Files:**

- Create: `scripts/privacy-scan.ts`
- Create: `test/privacy/acl-uniformity.t.ts`
- Create: `test/privacy/log-indistinguishability.t.ts`
- Create: `test/privacy/gas-indistinguishability.t.ts`
- Create: `artifacts/privacy-report.json` through the scanner.
- Modify: `docs/08-threat-model.md` only after surfacing any new channel.

**Consumes:** Re-frozen public-decryption allowlist and deployed ABI candidates.

**Produces:** P-P1/P-P2/P-P4/P-P5/P-P6/P-P7/P-P8 and ABI half of P-P9 evidence.

- [ ] Scan Solidity AST/ABI for every `makePubliclyDecryptable`, ACL grant, event field, role function, and winner-only
      path.
- [ ] Allowlist only effective-ticket, base-risk, yield-weight, post-settlement-randomness and checkpoint-specific
      `isSolvent` handles; reject numeric principal/liability/assets and all persistent per-user classes.
- [ ] Verify the only Fortune-derived disclosure is the bounded aggregate effective-minus-base difference, with no
      per-user decomposition and `MIN_PARTICIPANTS` enforced; record residual inference as S8.
- [ ] Compare winner and loser event/log slices, grant counts, call traces, gas, and HCU within the documented
      threshold.
- [ ] Confirm no `claimPrize` or winner-only ABI/event exists and the same credit-check path serves winner and loser.
- [ ] Perform a red-team pass for leakage not already enumerated, including checkpoint timing, participant churn, handle
      mutation timing, relayer request shape, Fortune reset, revert differences, and frontend telemetry.
- [ ] Run:

  Run: `npx ts-node scripts/privacy-scan.ts`

  Run: `npx hardhat test test/privacy/*.t.ts`

  Expected: all enumerated channels pass; residual/new channels are explicitly reported rather than silently patched.

- [ ] Commit:

  Run: `git add scripts/privacy-scan.ts test/privacy artifacts/privacy-report.json docs/08-threat-model.md`

  Then: `git commit -m "proof: complete adversarial privacy checks"`

### Task 14: Measure HCU and Freeze Batch Caps

**Owner:** Protocol benchmark worker.

**Files:**

- Create: `contracts/probes/HCUProbe.sol`
- Create: `scripts/bench-hcu.ts`
- Create: `docs/BENCHMARK.md`
- Modify: `docs/04-hcu-budget.md`
- Modify: `contracts/LokDrawManager.sol` only to replace provisional caps with measured 60% caps.

**Consumes:** Final contract operation sequences and valid Sepolia credentials.

**Produces:** Measured maxima/costs/depth, transaction projections, latency, and fixed `BATCH_A_MAX`/`BATCH_B_MAX`.

- [ ] Deploy `HCUProbe` to Sepolia and bisect success/revert boundaries for `_syncUser`, `crankA`, `crankB`, randomness,
      Fortune update, and solvency boolean.
- [ ] Measure each final production path, not an abbreviated synthetic operation list; record transaction hashes and
      protocol/package versions.
- [ ] Compute batch caps as `floor(measuredMax * 0.60)` and reject any configured batch above the cap.
- [ ] Compute transactions per draw for N=10, 100, and 1,000 and measure public/user decryption p50/p95.
- [ ] Run:

  Run: `npx hardhat run scripts/bench-hcu.ts --network sepolia`

  Expected: `docs/BENCHMARK.md` and measured columns in `docs/04-hcu-budget.md` contain date, versions, hashes, maxima,
  60% caps, and projections.

- [ ] Stop at GATE 3 if a measured cost differs by more than 50% from the revised estimate or a measured batch cap
      misses the documented demo-latency target after preSync separation.
- [ ] Re-run compile/tests after freezing constants:

  Run: `npm run compile`

  Run: `npm test`

  Expected: all tests pass with oversized-batch rejection cases updated to measured caps.

- [ ] Commit:

  Run:
  `git add contracts/probes/HCUProbe.sol contracts/LokDrawManager.sol scripts/bench-hcu.ts docs/BENCHMARK.md docs/04-hcu-budget.md`

  Then: `git commit -m "bench: freeze measured Sepolia HCU batch caps"`

### Task 15: Build and Verify the Frontend SDK Layer

**Owner:** Frontend integration worker using `zama-protocol` then `zama-typescript`; UI behavior tests reviewed
independently.

**Files:**

- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/src/fhe/provider.tsx`
- Create: `frontend/src/fhe/permit.ts`
- Create: `frontend/src/fhe/decryption-machine.ts`
- Create: `frontend/src/contracts/addresses.ts`
- Create: `frontend/src/contracts/abis.ts`
- Create: `frontend/src/test/fhe/`
- Create: `scripts/assert-wasm.mjs`
- Modify: `docs/API-VERIFIED.md`

**Consumes:** Verified contract ABI, Sepolia addresses schema, SDK symbols verified from live docs/installed source.

**Produces:** Vite-only app foundation, wallet/provider setup, permit gate, shared SEALED-to-REVEALED machine, status
decoding, and WASM build assertion.

- [ ] Verify and record every SDK/provider/hook symbol before import; resolve whether installed SDK hooks match names in
      `docs/06-frontend-spec.md`.
- [ ] Scaffold Vite React TypeScript under `frontend/`; add wagmi, viem, React Query, Tailwind, and the verified Zama
      SDK packages without Webpack.
- [ ] Add RED tests for permit requested once, no auto-decrypt on mount, cached decryption by handle, 60-second reseal,
      honest failure/retry/backoff, and encrypted status mapping.
- [ ] Implement the shared decryption state machine: SEALED, REQUESTING_PERMIT, DECLINED, DECRYPTING, REVEALED, FAILED.
- [ ] Add a build-time assertion that fails when `tfhe_bg.wasm` or the version-equivalent verified WASM asset is absent
      from `frontend/dist`.
- [ ] Run:

  Run: `npm --prefix frontend test`

  Run: `npm --prefix frontend run build`

  Run: `node scripts/assert-wasm.mjs frontend/dist`

  Expected: tests pass, Vite build exits 0, and WASM assertion prints the emitted asset path.

- [ ] Commit:

  Run: `git add frontend scripts/assert-wasm.mjs docs/API-VERIFIED.md`

  Then: `git commit -m "feat: add verified Zama frontend foundation"`

### Task 16: Build the Five-screen Product Experience

**Owner:** Frontend product worker using the repository-required UI/UX design skill before component work.

**Files:**

- Create: `frontend/src/pages/VaultPage.tsx`
- Create: `frontend/src/pages/DepositPage.tsx`
- Create: `frontend/src/pages/RiskPage.tsx`
- Create: `frontend/src/pages/DrawPage.tsx`
- Create: `frontend/src/pages/ProofPage.tsx`
- Create: `frontend/src/pages/WhyEncryptedPage.tsx`
- Create: `frontend/src/components/SealedValue.tsx`
- Create: `frontend/src/components/SolvencyStatus.tsx`
- Create: `frontend/src/features/vault/`, `frontend/src/features/draw/`, and `frontend/src/features/demo/`.
- Create: `frontend/src/test/pages/` and `frontend/e2e/`.

**Consumes:** SDK layer, verified contract ABI, measured decryption timeouts, and design tokens in
`docs/06-frontend-spec.md`.

**Produces:** Responsive usable demo with identical winner/loser check flow and truthful checkpoint status.

- [x] Read `D:\Genlayer Project\ui-ux-design-pro\taste\taste-skill\SKILL.md`, state the one-line Design Read, then run
      the required local design engine and persist the approved sealed-ledger design system:

  Run:
  `python "D:\Genlayer Project\ui-ux-design-pro\scripts\search.py" "confidential prize savings fintech sealed ledger" --design-system -p "Lok Protocol" --stack react --variance 6 --motion 4 --density 6 --persist --output-dir "D:\Lok\frontend"`

  Expected: persisted design-system output for Lok Protocol; if the engine returns zero results, retry once with
  `"confidential fintech savings"` and record any built-in fallback rather than inventing a result.

- [x] Add RED component/e2e tests for both deposit paths and shield warning, risk default 100%, no odds display, every
      draw state/progress, identical winner/loser check action, proof publishing warning, and solvency states
      `Verified for risk epoch`, `Pending`, and `Restricted`.
- [x] Implement five core screens plus the one-screen Why Encrypted page, sealed-value treatment, shared decryption UX,
      encrypted status messages, test-token flow, and separated DEMO CONTROL.
- [x] Keep all public data immediately renderable; never block the page or auto-decrypt private values.
- [x] Validate keyboard focus, labels, contrast, reduced motion, mobile layouts, long addresses/handles, and no
      overlapping text at 360x800, 768x1024, and 1440x900.
- [x] Run:

  Run: `npm --prefix frontend test`

  Run: `npm --prefix frontend run build`

  Run: `npm --prefix frontend run e2e`

  Expected: component/e2e/build suites pass and WASM assertion remains green.

- [x] Complete the human-review half of P-P9: same button, same relayer-observable request pattern, and no winner-only
      route before local decryption.
- [ ] Commit:

  Run: `git add frontend`

  Then: `git commit -m "feat: build Lok sealed-ledger experience"`

### Task 17: Build Deployment, Keeper, Seeder, and Verifier Scripts

**Owner:** Operations worker; verifier reviewed as a third-party tool.

**Files:**

- Create: `scripts/deploy.ts`
- Create: `scripts/seed-demo.ts`
- Create: `scripts/crank.ts`
- Create: `scripts/verify-draw.ts`
- Create: `scripts/export-addresses.ts`
- Create: `test/scripts/verify-draw.t.ts`
- Create: `test/scripts/crank.t.ts`
- Create: `deployments/sepolia.json` through deployment.

**Consumes:** Final ABIs, HCU caps, checkpoint flow, and deployment role policy.

**Produces:** Idempotent Sepolia deployment, 30-50 participant seed, permissionless keeper, and independent PASS/FAIL
verifier.

- [x] Add RED tests for deploy idempotence/schema, crank state transitions/backoff/stale retry, and verifier rejection
      of forged totals, wrong commitment, wrong reveal, missing events, and prize-conservation mismatch.
- [x] Implement deployment in dependency order: cUSDC fixture/reference, MockYieldAdapter, LokVault, LokDrawManager,
      optional threshold guardian; configure roles once and renounce/remove any demo-only fund power.
- [x] Make `deployments/sepolia.json` include chain ID, commit, FHEVM/package versions, addresses, constructor args,
      deploy tx hashes, and Etherscan URLs.
- [x] Seed 30-50 varied participants without recording private keys in repository artifacts; separate human-controlled
      demo wallet from synthetic actors.
- [x] Implement permissionless crank with exact state dispatch, measured caps, checkpoint/public-decryption backoff,
      strict reveal timing, resumability, and no winner knowledge.
- [x] Implement verifier using only public RPC/log/proof data; print a non-zero exit code on any failed check.
- [x] Run local script tests:

  Run: `npx hardhat test test/scripts/*.t.ts`

  Expected: scripts are restart-safe and verifier rejects every tampered fixture.

- [ ] Commit:

  Run: `git add scripts test/scripts`

  Then: `git commit -m "feat: add Lok deployment and verification tooling"`

### Task 18: Deploy, Verify, Seed, and Settle on Sepolia

**Owner:** Deployment operator with human control of credentials.

**Files:**

- Generate: `deployments/sepolia.json`
- Create: `docs/DEPLOYMENT.md`
- Modify: `frontend/src/contracts/addresses.ts` through `scripts/export-addresses.ts`.

**Consumes:** All passing tests/proofs, final HCU caps, funded throwaway deployer, Etherscan key.

**Produces:** Verified Sepolia contracts, seeded pool, one real settled draw, verifier PASS, and public frontend
production URL.

- [ ] Run the full predeploy gate:

  Run: `npm run lint`

  Run: `npm run build:ts`

  Run: `npm run compile`

  Run: `npm test`

  Run: `forge test`

  Run: `npm --prefix frontend test`

  Run: `npm --prefix frontend run build`

  Expected: every command exits 0; Tier-A artifacts separately show >=10,000,000 sequences.

- [ ] Deploy contracts:

  Run: `npx hardhat run scripts/deploy.ts --network sepolia`

  Expected: `deployments/sepolia.json` is written and every address has non-empty bytecode on chain ID 11155111.

- [ ] Verify every production contract on Etherscan using exact constructor arguments; record verification URLs.
- [ ] Export addresses into the frontend and rebuild:

  Run: `npx ts-node scripts/export-addresses.ts`

  Run: `npm --prefix frontend run build`

  Run: `node scripts/assert-wasm.mjs frontend/dist`

  Expected: frontend address file matches `deployments/sepolia.json` exactly and WASM is present.

- [ ] Seed 30-50 participants, open and complete a real draw with `scripts/crank.ts`, and record draw ID plus
      transaction hashes.
- [ ] Run third-party verification:

  Run: `npx ts-node scripts/verify-draw.ts --network sepolia --latest-settled`

  Expected: process exits 0 and prints `PASS` with commitment, aggregate-proof, range-partition, revealed-randomness,
  and prize-conservation checks.

- [ ] Run live E2E:

  Run: `npx hardhat test test/integration/sepolia.e2e.t.ts --network sepolia`

  Expected: full lifecycle, concurrent cranks, checkpoint proof, oracle-down recovery simulation, and decryption latency
  tests pass.

- [ ] Authenticate the human-owned Vercel account, deploy `frontend/dist`, and test the returned production URL in a
      clean browser profile and fresh wallet.

  Run: `npx vercel --prod --cwd frontend`

  Expected: command returns an HTTPS production URL serving the current commit and emitted FHE WASM asset.

- [ ] Write `docs/DEPLOYMENT.md` with addresses, tx hashes, draw ID, verifier output, URL, deployment date, versions,
      and rollback/redeploy procedure.
- [ ] Commit generated public deployment metadata, never credentials:

  Run: `git add deployments/sepolia.json frontend/src/contracts/addresses.ts docs/DEPLOYMENT.md`

  Then: `git commit -m "deploy: publish verified Lok Sepolia release"`

### Task 19: Harden the Demo and Assemble the Submission Package

**Owner:** Delivery worker; final sign-off by human submitter.

**Files:**

- Replace: `README.md`
- Create: `docs/VIDEO-SCRIPT.md`
- Create: `docs/X-THREAD-DRAFT.md`
- Modify: `docs/01-bounty-compliance.md`
- Modify: `docs/BENCHMARK.md`
- Modify: `frontend/` footer/demo affordances only when evidence reveals a defect.

**Consumes:** Real Sepolia addresses, public URL, settled draw/verifier output, fairness/privacy/invariant/HCU
artifacts.

**Produces:** Submission-ready repository and human recording/posting materials.

- [x] Re-run the HCU benchmark against the current protocol version; compare to Task 14 and stop at GATE 3 if drift
      exceeds 50%.
- [x] Write README in the exact 14-section order from `docs/09-delivery-checklist.md`, with live URL, verified
      addresses, R1-R16 compliance/test mapping, specification interpretation, trust boundary, benchmark table, fairness
      chart, privacy argument, failure paths, and clean-clone commands.
- [x] Include checkpoint solvency language accurately: display boolean checkpoint evidence, never claim a live plaintext
      backing ratio or expose numeric aggregate principal, liability or assets.
- [x] Write a three-minute human video shot list/script; do not generate AI voice/video.
- [x] Write the X thread draft; do not publish it for the human.
- [ ] Test from a clean clone after the human has established the public Git repository:

  Run: `npm ci`

  Run: `npm run compile`

  Run: `npm test`

  Run: `npm --prefix frontend ci`

  Run: `npm --prefix frontend run build`

  Expected: all commands pass with no untracked secret/config dependency.

- [ ] Rehearse demo with fresh wallet: get test tokens, shield warning, confidential deposit, risk setting, run draw,
      pagination, identical result check, optional proof, withdraw, and verifier PASS.
- [x] Run final evidence audit:

  Run:
  `rg -n "UNVERIFIED|PARTIAL|localhost|ZeroAddress|zzzzzz|TODO|TBD" README.md docs deployments frontend/src contracts scripts`

  Expected: every match is either resolved or explicitly documented as a remaining trust boundary/non-deployed
  compatibility item; no production address/config placeholder remains.

- [ ] Human checks all submission-form pages, team eligibility, license, geographic/KYC conditions, public-repository
      rules, and scoring rubric; record verified answers in `docs/01-bounty-compliance.md` section 4.
- [ ] Human records the video, publishes the X thread/community review, and submits on 2026-09-03.
- [ ] Commit final package:

  Run: `git add README.md docs frontend`

  Then: `git commit -m "docs: finalize Lok Season 4 submission package"`

## Mandatory Stop Gates

- **GATE 1:** A failing test/property requires a design change. Surface the minimal case, affected
  proposition/invariant, and proposed edits to architecture/spec; do not apply until approved.
- **GATE 2:** Frozen proposition/invariant conflicts with implementation, a proposition is unprovable at its tier, or
  confidential adapter custody cannot be implemented. Human decides wording/tiering.
- **GATE 3:** Measured HCU differs by more than 50%, documented FHEVM API misbehaves, batch A falls below 15, or work
  would add scope.
- **GATE 4:** Tier-A campaign cannot reach 10,000,000 sequences or public-decryption/checkpoint API cannot be resolved.

## Final Acceptance Record

Execution is complete only when one consolidated report contains:

- TLA+ generated/distinct state counts and all full/partial Tier-B outcomes.
- Tier-A result per proposition with exact sequence counts, seeds, durations, and independent proof-review status.
- Differential divergences or explicit zero-divergence result.
- Fairness draw count, p-value, chart path, and P-F4 trust boundary.
- Privacy result per enumerated channel plus residual/human P-P9 review.
- Sepolia HCU table, measured maxima, 60% caps, latency p50/p95, versions, and transaction hashes.
- Verified contract addresses, Etherscan links, real settled draw ID, `verify-draw.ts` PASS output, and public frontend
  URL.
- Video script and X-thread draft paths.
- Every gate raised, every approved design change, and every remaining partial or human-only obligation.
