# Near-Instant Draw Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` inline to implement this plan task-by-task. The
> human has prohibited agents and subagents for this repository.

**Goal:** Replace Lok's fixed seven-day draw with an immutable `120s / 30s / 180s / 600s` Sepolia timing profile, prove
the unchanged state-machine obligations, and publish a new verified deployment with a real settled 30-participant draw.

**Architecture:** `LokDrawManager` receives four validated timing values at construction and exposes them through the
existing uppercase getters. No runtime role can modify or bypass timing. The existing parameterized TLA+ model is
checked before Solidity changes; contract boundary tests enforce the concrete seconds and the existing two-pass
pagination remains unchanged.

**Tech Stack:** Solidity 0.8.27, `@fhevm/solidity` 0.11.1, Zama Sepolia FHEVM v0.13, Hardhat 2.28.6, TypeScript,
TLA+/TLC, Vite/React, Vercel.

## Global Constraints

- Sepolia only; no Arc, multichain, governance, second pool or Lok accounting relayer.
- Frozen `docs/10-proof-strategy.md` section 3 remains exactly 42 propositions; this plan must not edit it.
- Work order is proof review, TLC, red tests, Solidity, local verification, Sepolia deployment, settled-draw evidence.
- `DRAW_PERIOD = 120`, `MIN_SETTLE_DELAY = 30`, `REVEAL_WINDOW = 180`, `STATE_TIMEOUT = 600` on the new deployment.
- Constructor bounds are respectively `60..2^20`, `>=24`, `>=120`, and `>=300` seconds.
- Timing is immutable. No admin early-close, `tEnd` bypass or same-transaction whole-pool settlement is allowed.
- Keep `preSync = 4`, PASS A `= 3`, PASS B `= 2`, 30 seeded participants and the 60%-HCU safety rule.
- Deposit, withdraw, exit, setTheta and emergency withdrawal remain available under their frozen state obligations.
- Do not use any FHEVM or Zama symbol absent from `docs/API-VERIFIED.md`.
- The workspace has no `.git`; do not initialize Git. Use explicit verification checkpoints instead of commit steps.

---

## File Map

- `docs/02-architecture.md`: canonical timing rationale, bounds and immutable configuration.
- `docs/05-contract-specs.md`: constructor signature and timing validation contract.
- `docs/12-retention-mechanisms.md`: remove the assumption that Fortune's 52 draws means one calendar year.
- `spec/LokDraw.tla`, `spec/LokDraw.cfg`, `spec/LokDraw-risk.cfg`: unchanged parameterized proof model and TLC inputs.
- `contracts/LokDrawManager.sol`: timing immutables and constructor validation only.
- `test/draw/helpers.ts`: one canonical local test timing profile and deployment helper.
- `test/draw/DrawManager.state.t.ts`: constructor boundaries and recorded-window tests.
- `test/compliance/spec.t.ts`, `test/invariants/liveness.t.ts`, `test/LokStage2.ts`: direct constructor callers.
- `scripts/deploy.ts`: Sepolia timing profile, manifest traceability and constructor arguments.
- `test/scripts/deploy.t.ts`: manifest schema and timing validation tests.
- `test/integration/SepoliaDeployment.t.ts`: live timing getter checks.
- `deployments/history/`: immutable copy of the prior seven-day deployment manifest.
- `deployments/sepolia.json`: canonical new deployment only after successful deployment and binding checks.
- `frontend/src/contracts/addresses.ts`: generated new addresses.
- `README.md`, `docs/DEPLOYMENT.md`, `docs/BENCHMARK.md`, `docs/HANDOFF.md`: final evidence and latency wording.

---

### Task 1: Update The Reviewed Design Sources

**Files:**

- Modify: `docs/02-architecture.md`
- Modify: `docs/05-contract-specs.md`
- Modify: `docs/12-retention-mechanisms.md`
- Read only: `docs/10-proof-strategy.md`

**Interfaces:**

- Consumes: approved design in `docs/superpowers/specs/2026-08-12-near-instant-draw-timing-design.md`.
- Produces: reviewed constructor contract and proof assumptions used by Tasks 2-4.

- [ ] **Step 1: Replace the fixed timing constants in architecture with immutable deployment parameters**

Use this exact semantic block:

```solidity
uint64 public immutable DRAW_PERIOD; // Sepolia demo: 120 seconds
uint64 public immutable MIN_SETTLE_DELAY; // Sepolia demo: 30 seconds
uint64 public immutable REVEAL_WINDOW; // Sepolia demo: 180 seconds
uint64 public immutable STATE_TIMEOUT; // Sepolia demo: 600 seconds
```

Document the bounds `60 <= DRAW_PERIOD <= 2^20`, `MIN_SETTLE_DELAY >= 24`, `REVEAL_WINDOW >= 120`, and
`STATE_TIMEOUT >= 300`. State that these values are fixed at deployment and cannot be changed by a role.

- [ ] **Step 2: Update the contract specification**

Specify the exact constructor:

```solidity
constructor(
    ILokVault vault_,
    address initialOwner,
    uint64 drawPeriod_,
    uint64 minSettleDelay_,
    uint64 revealWindow_,
    uint64 stateTimeout_
)
```

Specify `InvalidTiming()` for every failed bound and retain `InvalidAddress()` for zero vault/owner.

- [ ] **Step 3: Correct Fortune's calendar language**

Change the comment that equates 52 draws with one year. `FORTUNE_CAP = 52` remains a 52-draw cap; calendar duration now
depends on deployment cadence. Do not alter the Fortune formula or frozen propositions.

- [ ] **Step 4: Verify scope and frozen integrity**

Run:

```powershell
rg -n "7 days|weekly draws|one year of weekly" docs/02-architecture.md docs/05-contract-specs.md docs/12-retention-mechanisms.md
(Select-String -Path docs/10-proof-strategy.md -Pattern '^\| P-').Count
Select-String -Path docs/10-proof-strategy.md -Pattern 'Proposition count: 42'
```

Expected: no stale fixed-cadence claim in the three edited documents; proposition row/header integrity remains 42.

- [ ] **Step 5: Record the checkpoint**

Append a dated note to `docs/HANDOFF.md`: timing sources reviewed; §3 unchanged; TLC not yet rerun.

---

### Task 2: Re-run The Proof Gate Before Solidity

**Files:**

- Read only: `spec/LokDraw.tla`
- Read only: `spec/LokDraw.cfg`
- Read only: `spec/LokDraw-risk.cfg`
- Modify: `docs/HANDOFF.md`

**Interfaces:**

- Consumes: parameter bounds from Task 1.
- Produces: explicit proof authorization to begin contract tests; no Solidity output.

- [ ] **Step 1: Confirm the model is timing-parameterized**

Verify that `OpenDraw`, PASS A, strict reveal and deadlines use `DrawPeriod`, `SettleDelay`, `RevealWindow`, and
`StateDeadline`, with no seven-day literal. The current configs deliberately use small positive abstract units; they
already model shortened timing and ordering rather than wall-clock seconds.

- [ ] **Step 2: Run the draw model**

```powershell
& 'C:\Users\TBC\tools\jdk-21.0.12+8-jre\bin\java.exe' -jar 'C:\Users\TBC\tools\tla2tools.jar' -deadlock -workers 4 -config 'D:\Lok\spec\LokDraw.cfg' 'D:\Lok\spec\LokDraw.tla'
```

Expected: TLC completes with no error and all configured invariants pass.

- [ ] **Step 3: Run the risk/configuration model**

```powershell
& 'C:\Users\TBC\tools\jdk-21.0.12+8-jre\bin\java.exe' -jar 'C:\Users\TBC\tools\tla2tools.jar' -deadlock -workers 4 -config 'D:\Lok\spec\LokDraw-risk.cfg' 'D:\Lok\spec\LokDraw.tla'
```

Expected: TLC completes with no error, including P-L1-L7, P-S7, P-F3, P-F10, P-A4, P-A7, P-A8 and P-O1 model halves.

- [ ] **Step 4: Apply the proof stop rule**

If TLC produces a counterexample, stop before tests or Solidity. Present the trace and proposed changes to
`docs/02-architecture.md` and `docs/05-contract-specs.md`; do not edit those fixes without human approval.

- [ ] **Step 5: Record exact TLC evidence**

Write generated/distinct state counts, depth, duration and invariant result into `docs/HANDOFF.md`. State explicitly
that P-L6's numeric `tEnd-1/tEnd/tEnd+1` half remains a contract boundary test.

---

### Task 3: Write Red Timing Tests

**Files:**

- Modify: `test/draw/helpers.ts`
- Modify: `test/draw/DrawManager.state.t.ts`
- Modify: `test/compliance/spec.t.ts`
- Modify: `test/invariants/liveness.t.ts`
- Modify: `test/LokStage2.ts`

**Interfaces:**

- Produces: `TEST_DRAW_TIMING` and a six-argument `LokDrawManager` deployment contract used by all local tests.

- [ ] **Step 1: Define one local timing profile**

Add to `test/draw/helpers.ts`:

```typescript
export const TEST_DRAW_TIMING = {
  drawPeriod: 120n,
  minSettleDelay: 30n,
  revealWindow: 180n,
  stateTimeout: 600n,
} as const;

export const TEST_DRAW_TIMING_ARGS = [
  TEST_DRAW_TIMING.drawPeriod,
  TEST_DRAW_TIMING.minSettleDelay,
  TEST_DRAW_TIMING.revealWindow,
  TEST_DRAW_TIMING.stateTimeout,
] as const;
```

Change every test deployment to append `...TEST_DRAW_TIMING_ARGS` after vault and owner.

- [ ] **Step 2: Add constructor boundary tests**

Cover each rejected profile:

```typescript
const valid = [120n, 30n, 180n, 600n] as const;
await expect(factory.deploy(vault, owner, 59n, valid[1], valid[2], valid[3])).to.be.revertedWithCustomError(
  factory,
  "InvalidTiming",
);
await expect(factory.deploy(vault, owner, 2n ** 20n + 1n, valid[1], valid[2], valid[3])).to.be.revertedWithCustomError(
  factory,
  "InvalidTiming",
);
await expect(factory.deploy(vault, owner, valid[0], 23n, valid[2], valid[3])).to.be.revertedWithCustomError(
  factory,
  "InvalidTiming",
);
await expect(factory.deploy(vault, owner, valid[0], valid[1], 119n, valid[3])).to.be.revertedWithCustomError(
  factory,
  "InvalidTiming",
);
await expect(factory.deploy(vault, owner, valid[0], valid[1], valid[2], 299n)).to.be.revertedWithCustomError(
  factory,
  "InvalidTiming",
);
```

Also deploy exact lower bounds and the exact approved profile successfully.

- [ ] **Step 3: Assert immutable getter values and deadlines**

In the state test, assert all four getters equal the constructor values, `tEnd - tStart == 120`, and initial
`stateDeadline == tEnd + 30 + 600`.

- [ ] **Step 4: Run the focused test and confirm RED**

```powershell
npx hardhat test test/draw/DrawManager.state.t.ts
```

Expected before contract implementation: constructor-argument/type generation failure or missing `InvalidTiming`; the
new assertions must not pass accidentally.

---

### Task 4: Implement Immutable Timing And Close Local Timing Tests

**Files:**

- Modify: `contracts/LokDrawManager.sol`
- Test: files from Task 3

**Interfaces:**

- Consumes: six-argument constructor from Task 1 and tests from Task 3.
- Produces: public immutable getters `DRAW_PERIOD()`, `MIN_SETTLE_DELAY()`, `REVEAL_WINDOW()`, `STATE_TIMEOUT()`.

- [ ] **Step 1: Add bounds and immutable storage**

Replace the four constants with:

```solidity
error InvalidTiming();

uint64 public constant MIN_DRAW_PERIOD = 60 seconds;
uint64 public constant MAX_DRAW_PERIOD = 1 << 20;
uint64 public constant MIN_SETTLE_DELAY_FLOOR = 24 seconds;
uint64 public constant MIN_REVEAL_WINDOW = 120 seconds;
uint64 public constant MIN_STATE_TIMEOUT = 300 seconds;

uint64 public immutable DRAW_PERIOD;
uint64 public immutable MIN_SETTLE_DELAY;
uint64 public immutable REVEAL_WINDOW;
uint64 public immutable STATE_TIMEOUT;
```

- [ ] **Step 2: Validate and assign in the constructor**

```solidity
constructor(
    ILokVault vault_,
    address initialOwner,
    uint64 drawPeriod_,
    uint64 minSettleDelay_,
    uint64 revealWindow_,
    uint64 stateTimeout_
) Ownable(initialOwner) {
    if (address(vault_) == address(0) || initialOwner == address(0)) revert InvalidAddress();
    if (
        drawPeriod_ < MIN_DRAW_PERIOD ||
        drawPeriod_ > MAX_DRAW_PERIOD ||
        minSettleDelay_ < MIN_SETTLE_DELAY_FLOOR ||
        revealWindow_ < MIN_REVEAL_WINDOW ||
        stateTimeout_ < MIN_STATE_TIMEOUT
    ) revert InvalidTiming();
    vault = vault_;
    DRAW_PERIOD = drawPeriod_;
    MIN_SETTLE_DELAY = minSettleDelay_;
    REVEAL_WINDOW = revealWindow_;
    STATE_TIMEOUT = stateTimeout_;
}
```

Do not change draw transitions or add timing setters.

- [ ] **Step 3: Compile and regenerate types**

```powershell
npm run compile
```

Expected: Solidity and TypeChain complete successfully.

- [ ] **Step 4: Run focused timing/state tests**

```powershell
npx hardhat test test/draw/DrawManager.state.t.ts test/invariants/liveness.t.ts test/compliance/spec.t.ts test/LokStage2.ts
```

Expected: all selected tests pass; no constructor caller remains stale.

- [ ] **Step 5: Run exact boundary regressions**

```powershell
npx hardhat test test/unit/LokVault.sync.t.ts test/draw/DrawManager.randomness.t.ts test/draw/DrawManager.outcome-integrity.t.ts
```

Expected: the `tEnd-1/tEnd/tEnd+1` snapshot, strict randomness sequencing and forged/stale input tests all pass.

---

### Task 5: Make Deployment Timing Traceable

**Files:**

- Modify: `scripts/deploy.ts`
- Modify: `test/scripts/deploy.t.ts`
- Modify: `test/integration/SepoliaDeployment.t.ts`
- Modify: `deployments/sepolia.json` only through the deployment script in Task 7

**Interfaces:**

- Produces manifest field `timing` and six constructor arguments for `LokDrawManager`.

- [ ] **Step 1: Write failing manifest tests**

Extend `SepoliaDeploymentManifest` with:

```typescript
timing: {
  drawPeriod: 120;
  minSettleDelay: 30;
  revealWindow: 180;
  stateTimeout: 600;
}
```

Test that missing or altered values fail `assertDeploymentManifest`, and that the draw-manager deployment record lists
`[vault, owner, "120", "30", "180", "600"]`.

- [ ] **Step 2: Run manifest tests RED**

```powershell
npx hardhat test test/scripts/deploy.t.ts
```

Expected: failure because the current schema and constructor record lack timing.

- [ ] **Step 3: Add the deployment profile and validation**

Define:

```typescript
const SEPOLIA_DRAW_TIMING = {
  drawPeriod: 120,
  minSettleDelay: 30,
  revealWindow: 180,
  stateTimeout: 600,
} as const;
```

Pass its values to `deployments.deploy("LokDrawManager", ...)`, record them as constructor args, include the `timing`
object in the manifest, and validate every exact value in `assertDeploymentManifest`.

- [ ] **Step 4: Add live getter checks**

In `test/integration/SepoliaDeployment.t.ts`, compare all four on-chain getters against `manifest.timing`.

- [ ] **Step 5: Close deployment tests**

```powershell
npx hardhat test test/scripts/deploy.t.ts
```

Expected: all deployment script tests pass.

---

### Task 6: Run The Full Local Release Gate

**Files:**

- Modify generated evidence only when commands intentionally regenerate it.
- Modify: `docs/HANDOFF.md`

**Interfaces:**

- Produces: local authorization to spend Sepolia ETH on a fresh deployment.

- [ ] **Step 1: Run lint and compile**

```powershell
npm run lint
npm run compile
```

Expected: both exit zero.

- [ ] **Step 2: Run the complete Hardhat suite**

```powershell
npm test
```

Expected: zero failures; Sepolia-only tests remain explicitly pending locally.

- [ ] **Step 3: Run invariants, fairness and privacy**

```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-invariants.ps1
npx ts-node scripts/run-fairness.ts
npx ts-node scripts/privacy-scan.ts
```

Expected: invariant target reached with no counterexample, fairness thresholds pass, privacy report passes every
machine-checkable channel.

- [ ] **Step 4: Verify frontend remains independent of hard-coded timing**

```powershell
npx --yes node@22 frontend/node_modules/vitest/vitest.mjs run
npx --yes node@22 frontend/node_modules/typescript/bin/tsc -b
npx --yes node@22 frontend/node_modules/vite/bin/vite.js build
```

Expected: 58 frontend tests pass and production build exits zero. If the UI promises a fixed seven-day cadence, add a
read-only timing query and test before continuing.

- [ ] **Step 5: Record the local gate**

Write exact counts and artifact paths to `docs/HANDOFF.md`. Stop if any proof/test differs materially from the approved
design.

---

### Task 7: Deploy And Verify The New Sepolia Stack

**Files:**

- Create: `deployments/history/sepolia-seven-day-2026-08-11.json`
- Replace via script: `deployments/sepolia.json`
- Modify via generated output: `frontend/src/contracts/addresses.ts`

**Interfaces:**

- Consumes: Task 6 release gate and funded deployer.
- Produces: source-verified fresh topology with timing `120/30/180/600`.

- [ ] **Step 1: Archive the current manifest before deployment**

Copy the exact current `deployments/sepolia.json` to the history path and verify its draw manager is
`0x5f84BD38aC815092021DaBB3C1AB9f292773A293`. Never overwrite the historical file after creation.

- [ ] **Step 2: Check deployer balance without exposing the private key**

Use Node 22 and the existing Hardhat vars. Require enough ETH for full-stack deployment, bindings, checkpoint, seeding,
draw settlement and verification. Stop and report if the projected balance margin is inadequate.

- [ ] **Step 3: Deploy with the reviewed script**

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/deploy.ts --network sepolia
```

Expected: five fresh addresses, successful adapter/vault/draw bindings, submitted true solvency checkpoint and a new
manifest containing exact timing values.

- [ ] **Step 4: Verify bytecode, bindings and Etherscan source**

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js test test/integration/SepoliaDeployment.t.ts --network sepolia --grep "matches the recorded bytecode"
```

Expected: the focused bytecode, topology, source-verification and timing checks pass. Participant-count and settled-draw
tests are intentionally deferred until Task 8 seeds and settles the new deployment.

- [ ] **Step 5: Export addresses**

```powershell
npx --yes node@22 node_modules/ts-node/dist/bin.js scripts/export-addresses.ts
```

Expected: only the generated block in `frontend/src/contracts/addresses.ts` changes to the new manifest addresses.

---

### Task 8: Seed, Settle, Verify And Re-benchmark

**Files:**

- Modify through scripts: `deployments/sepolia.json`, `artifacts/hcu-benchmark.json`, `artifacts/privacy-report.json`
- Modify: `docs/BENCHMARK.md`, `docs/04-hcu-budget.md`, `docs/DEPLOYMENT.md`, `docs/HANDOFF.md`

**Interfaces:**

- Produces: real settled draw and final on-chain acceptance evidence.

- [ ] **Step 1: Seed exactly the reviewed demonstration topology**

Run `scripts/seed-demo.ts` under Node 22 to create at least 30 participants, fund realized yield and open a non-strict
draw. Confirm on-chain `DRAW_PERIOD=120`, `MIN_SETTLE_DELAY=30`, `participantSnapshot>=30`, and record `tEnd`.

- [ ] **Step 2: Wait only for the immutable short boundary**

Do not send early settlement transactions. After chain time reaches `tEnd + 30`, run:

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/crank.ts --network sepolia
```

Expected: permissionless progress through pre-sync, PASS A, aggregate public decryption, randomness, PASS B and
`SETTLED`. Record every transaction hash and measured elapsed time.

- [ ] **Step 3: Run the independent verifier and live integration gate**

```powershell
$env:LOK_VERIFY_LATEST_SETTLED='1'
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/verify-draw.ts --network sepolia
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js test test/integration/SepoliaDeployment.t.ts --network sepolia
```

Expected: verifier PASS for all checks and live integration `3 passing` or more if timing adds a separate test.

- [ ] **Step 4: Re-run HCU Gate 3**

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/bench-hcu.ts --network sepolia
```

Expected: no measured path differs by more than 50%; batch caps remain at or below 60% of measured maximum. Stop and
escalate on either violation.

- [ ] **Step 5: Regenerate privacy evidence**

```powershell
npx ts-node scripts/privacy-scan.ts
npx hardhat test test/privacy/acl-uniformity.t.ts
```

Expected: static/dynamic privacy gates pass; P-P9's UX half remains explicitly human-reviewed.

---

### Task 9: Publish The New Canonical Demo

**Files:**

- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/BENCHMARK.md`
- Modify: `docs/HANDOFF.md`
- Modify generated: `frontend/src/contracts/addresses.ts`
- Deploy: `frontend/` to Vercel

**Interfaces:**

- Consumes: verified addresses and settled draw from Task 8.
- Produces: public demo and delivery package pointing only to the new canonical stack.

- [ ] **Step 1: Update evidence without deleting history**

Replace canonical addresses, Etherscan links, draw ID, timing and latency. Keep the prior seven-day deployment
identified as superseded historical evidence, not the active demo. Remove the 2026-08-19 waiting instruction.

- [ ] **Step 2: Build frontend under Node 22**

```powershell
npx --yes node@22 frontend/node_modules/vitest/vitest.mjs run
npx --yes node@22 frontend/node_modules/typescript/bin/tsc -b
npx --yes node@22 frontend/node_modules/vite/bin/vite.js build
```

Expected: all frontend tests pass and the generated bundle references the new contract addresses.

- [ ] **Step 3: Deploy production on Vercel**

Use the existing authenticated Vercel CLI session. Preserve the canonical alias
`https://frontend-xi-tawny-54.vercel.app` and record the new deployment ID.

- [ ] **Step 4: Run production smoke checks**

Verify `/`, `/draw`, and `/fhevm/tfhe_bg.v1.6.2.wasm` return HTTP 200 with COOP `same-origin`, COEP `require-corp`, and
WASM `application/wasm`. Browser-check the draw state, 30 participants, new addresses, no console errors and no mobile
horizontal overflow.

- [ ] **Step 5: Retire stale waiting automation**

Delete the old Task 18 automation only after the new draw is settled and production smoke passes. It must not later
overwrite evidence with the superseded deployment.

- [ ] **Step 6: Run final repository gate**

```powershell
npm run lint
npm run compile
npm test
rg -n "7 days|2026-08-19|5f84BD38aC815092021DaBB3C1AB9f292773A293|UNVERIFIED|PARTIAL|localhost|ZeroAddress|zzzzzz|TODO|TBD" README.md docs deployments frontend/src contracts scripts
```

Expected: tests have zero failures; old timing/address matches occur only in explicitly labelled historical artifacts;
all other grep matches are resolved or documented trust boundaries.

---

## Completion Gate

This timing migration is complete only when:

1. Both TLC configurations pass before the Solidity change.
2. Frozen §3 remains exactly 42 propositions.
3. All local contract, invariant, fairness, privacy and frontend gates pass.
4. New Sepolia contracts are source-verified and expose `120/30/180/600`.
5. At least 30 participants are present and one real non-strict draw is `SETTLED`.
6. `verify-draw.ts` and live integration tests pass.
7. HCU drift is within Gate 3 and caps retain the 60% margin.
8. The production frontend points to the new deployment and passes browser/HTTP smoke.

Human-only submission, video, X publication, eligibility and P-P9 runtime sign-off remain separate Task 19 gates.
