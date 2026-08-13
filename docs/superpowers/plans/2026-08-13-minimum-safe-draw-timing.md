# Minimum Safe Draw Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The owner selected inline execution; do not dispatch subagents.

**Goal:** Publish a final Ethereum Sepolia Lok stack using immutable draw timing `60/24/120/300` without weakening the frozen properties or invalidating the in-progress P-S2 Group B evidence.

**Architecture:** Complete and seal the old disposable Group B lifecycle before changing any timing-manifest dependency. Then update only the reviewed deployment profile, test fixtures, dynamic executor wait and non-frozen documentation; verify the unchanged Solidity state machine at its existing lower bounds; deploy a clean one-time-bound stack after a separately capped transaction budget is approved.

**Tech Stack:** Solidity 0.8.27, Hardhat 2.28.6, TypeScript 5.9, `@fhevm/solidity` 0.11.1, `@fhevm/hardhat-plugin` 0.4.2, Zama Sepolia Gateway/KMS, TLA+/TLC, React/Vite, Vercel.

## Global Constraints

- Ethereum Sepolia only; never use mainnet ETH or real-value assets.
- Final timing is exactly `DRAW_PERIOD=60`, `MIN_SETTLE_DELAY=24`, `REVEAL_WINDOW=120`, `STATE_TIMEOUT=300` seconds.
- Keep `LokVault.ADAPTER_DELAY = 1 days` unchanged.
- Do not edit frozen `docs/10-proof-strategy.md` section 3.
- Do not change Solidity accounting, FHE operations, ACL behavior, batch caps or proposition semantics.
- Complete P-S2 Group B D23-D39 before changing `scripts/deploy.ts` or `test/**`.
- Do not claim full P-S2 `MATCHES`; final evidence goes to the independent reviewer.
- Do not publish a new deployment or spend Sepolia ETH until a read-only transaction/gas/ETH manifest has an explicit owner cap approval.
- Preserve unrelated user changes and untracked design directories.

---

## File Map

- `scripts/deploy.ts`: canonical reviewed Sepolia timing profile and generated deployment manifest validation.
- `test/scripts/deploy.t.ts`: deployment-schema and constructor-argument expectations.
- `test/draw/helpers.ts`: shared draw fixture timing.
- `test/draw/DrawManager.state.t.ts`: constructor-floor and state-deadline acceptance.
- `scripts/p-s2-sepolia-groups.ts`: Group A waits for the deployed settle delay without duplicating a literal.
- `docs/02-architecture.md`: current Sepolia timing profile.
- `docs/DEPLOYMENT.md`: current verified deployment timing and, after deployment, final addresses.
- `README.md`: final verified deployment links and reproduction commands.
- `deployments/sepolia.json`: generated final deployment provenance; never hand-author transaction hashes.
- `deployments/history/sepolia-2026-08-13-120-30-180-600.json`: preserved old canonical manifest.
- `frontend/.env.production`: final verified contract addresses.
- `artifacts/sepolia/p-s2-groups-2026-08-13/**`: immutable old-deployment P-S2 receipts and handoff evidence.

### Task 1: Close The Existing Group B Lifecycle

**Files:**
- Read: `docs/proofs/P-S2-sepolia-execution-manifest-2026-08-13.md`
- Read/write generated evidence: `artifacts/sepolia/p-s2-groups-2026-08-13/**`
- No source edits

**Interfaces:**
- Consumes: journal containing D01-D22, five deployment receipts and `adapterActivateAfter`.
- Produces: D01-D39 evidence with zero pending exit/checkpoint, no retiring adapter and recovered disposable custody.

- [ ] **Step 1: Confirm the immutable resume gate**

Run:

```powershell
$ledger = Get-Content artifacts/sepolia/p-s2-groups-2026-08-13/ledger.json -Raw | ConvertFrom-Json
@($ledger.steps | Where-Object group -eq 'B').Count
$ledger.dedicated.activateAfter
git diff -- contracts test test-foundry spec
```

Expected: `22`, activation timestamp `1786714152`, and an empty executable diff.

- [ ] **Step 2: Resume after the on-chain timelock**

Run after `2026-08-14T13:29:12Z`:

```powershell
$env:LOK_P_S2_PHASE='group-b-2'
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run --network sepolia --no-compile scripts/p-s2-sepolia-groups.ts
```

Expected: fresh shared and dedicated preflights pass; D23-D39 are recorded; Group B reports exactly 39 transactions,
5 deployments and remains below 38,000,000 gas, 0.08 ETH total and 0.025 ETH deployment spend.

- [ ] **Step 3: Verify custody and artifact integrity**

Check every `*.sha256` sidecar with `Get-FileHash`, require 101 total receipts (`62 + 39`), zero duplicate IDs/hashes,
and inspect the D39 after-state for `participantCount=0`, `pendingCheckpoint=false`, `restricted=false`, zero retiring
adapter and zero pending exit.

- [ ] **Step 4: Commit only final evidence and reviewer handoff**

Stage the generated evidence explicitly even when ignored, plus a P-S2 Sepolia handoff document that records both
executor commits and exact totals. Do not stage unrelated untracked directories.

```powershell
git add -f artifacts/sepolia/p-s2-groups-2026-08-13
git add docs/proofs/P-S2-sepolia-groups-evidence-handoff-2026-08-14.md
git commit -m "test(proofs): record P-S2 Sepolia Groups A and B"
```

Expected status remains `Full P-S2: BLOCKED_PENDING_INDEPENDENT_EVIDENCE_REVIEW`.

### Task 2: Change The Reviewed Timing Profile Test-First

**Files:**
- Modify: `test/scripts/deploy.t.ts`
- Modify: `test/draw/helpers.ts`
- Modify: `scripts/deploy.ts`
- Test: `test/scripts/deploy.t.ts`
- Test: `test/draw/DrawManager.state.t.ts`

**Interfaces:**
- Consumes: existing constructor floors in `LokDrawManager`.
- Produces: `SEPOLIA_DRAW_TIMING` and `TEST_DRAW_TIMING` with exact final values plus five fresh hardhat-deploy names.

- [ ] **Step 1: Write the failing deployment-profile expectation**

Change `ReviewedTiming`, `manifest().timing`, draw constructor args and mismatch cases in `test/scripts/deploy.t.ts` to:

```ts
type ReviewedTiming = {
  drawPeriod: 60;
  minSettleDelay: 24;
  revealWindow: 120;
  stateTimeout: 300;
};

timing: {
  drawPeriod: 60,
  minSettleDelay: 24,
  revealWindow: 120,
  stateTimeout: 300,
},
```

The valid draw constructor suffix must be `"60", "24", "120", "300"`; use `"61"` only in the intentional mismatch.
Assert these exact fresh deployment names so the one-time-bound old stack cannot be reused:

```ts
{
  underlyingToken: "LokMinimumTimingMockUSDC",
  confidentialToken: "LokMinimumTimingConfidentialToken",
  yieldAdapter: "LokMinimumTimingMockYieldAdapter",
  vault: "LokMinimumTimingVault",
  drawManager: "LokMinimumTimingDrawManager",
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js test --no-compile test/scripts/deploy.t.ts
```

Expected: the complete traceability schema test fails because `scripts/deploy.ts` still requires `120/30/180/600`.

- [ ] **Step 3: Change the canonical deployment constant**

In `scripts/deploy.ts`, replace only the timing object:

```ts
export const SEPOLIA_DRAW_TIMING = {
  drawPeriod: 60,
  minSettleDelay: 24,
  revealWindow: 120,
  stateTimeout: 300,
} as const;
```

Also replace `SEPOLIA_DEPLOYMENT_NAMES` with the five `LokMinimumTiming*` names from Step 1. Reusing the
`LokNearInstant*` records is forbidden because the old adapter and vault have already consumed their one-time bindings.

- [ ] **Step 4: Run the deployment test and confirm GREEN**

Run the focused command from Step 2.

Expected: all `test/scripts/deploy.t.ts` cases pass, including altered timing and constructor mismatch rejection.

- [ ] **Step 5: Move the shared draw fixture to the floors**

Change `TEST_DRAW_TIMING` in `test/draw/helpers.ts` to:

```ts
export const TEST_DRAW_TIMING = {
  drawPeriod: 60n,
  minSettleDelay: 24n,
  revealWindow: 120n,
  stateTimeout: 300n,
} as const;
```

- [ ] **Step 6: Verify constructor and state-machine boundaries**

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js test test/draw/DrawManager.state.t.ts
```

Expected: accepted profile equals all four lower bounds; 59/23/119/299 remain rejected; deadline and abort tests pass.

- [ ] **Step 7: Commit the profile checkpoint**

```powershell
git add scripts/deploy.ts test/scripts/deploy.t.ts test/draw/helpers.ts
git commit -m "feat(draw): use minimum safe Sepolia timing"
```

### Task 3: Remove The Executor Timing Literal

**Files:**
- Modify: `scripts/p-s2-sepolia-groups.ts`
- Test: TypeScript compiler and source inspection

**Interfaces:**
- Consumes: `LokDrawManager.MIN_SETTLE_DELAY() -> uint64` and optional `LOK_P_S2_EVIDENCE_DIR`.
- Produces: Group A wait bound to the deployed runtime and a deployment-scoped journal that cannot collide with old evidence.

- [ ] **Step 1: Add the dynamic read**

After loading `drawInfo`, read:

```ts
const minSettleDelay = (await draw.getFunction("MIN_SETTLE_DELAY").staticCall()) as bigint;
```

Replace:

```ts
await waitUntil((info.tEnd as bigint) + 30n);
```

with:

```ts
await waitUntil((info.tEnd as bigint) + minSettleDelay);
```

Parameterize the evidence root while preserving the existing Group A/B default:

```ts
const EVIDENCE_DIR = path.resolve(
  process.env.LOK_P_S2_EVIDENCE_DIR ??
    path.join(ROOT, "artifacts", "sepolia", "p-s2-groups-2026-08-13"),
);
```

When loading an existing ledger, require every `sharedDeployment` address to equal the current manifest address. A
new final-deployment Group A run must set:

```powershell
$env:LOK_P_S2_EVIDENCE_DIR='D:\Lok\artifacts\sepolia\p-s2-minimum-timing-group-a-2026-08-14'
```

- [ ] **Step 2: Verify no stale timing literal remains**

```powershell
rg -n "tEnd.*30n|120/30/180/600" scripts/p-s2-sepolia-groups.ts
npx tsc --noEmit
```

Expected: search has no match and TypeScript compilation exits 0.

- [ ] **Step 3: Commit the executor checkpoint**

```powershell
git add scripts/p-s2-sepolia-groups.ts
git commit -m "fix(proofs): read deployed settle delay"
```

### Task 4: Synchronize Non-Frozen Documentation

**Files:**
- Modify: `docs/02-architecture.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify after deployment: `README.md`
- Do not modify: `docs/10-proof-strategy.md`

**Interfaces:**
- Consumes: final profile and later generated deployment manifest.
- Produces: documentation that distinguishes routine draw timing from the 24-hour admin adapter timelock.

- [ ] **Step 1: Update current profile statements**

Use exact values in architecture and deployment docs:

```text
DRAW_PERIOD = 60 seconds
MIN_SETTLE_DELAY = 24 seconds
REVEAL_WINDOW = 120 seconds (strict mode only)
STATE_TIMEOUT = 300 seconds (stalled-path recovery only)
ADAPTER_DELAY = 1 day (owner adapter replacement only)
```

Do not edit the historical 2026-08-12 design/plan; the approved 2026-08-13 addendum supersedes it.

- [ ] **Step 2: Verify documentation consistency and frozen zero-diff**

```powershell
rg -n "Sepolia demo: (120|30|180|600)|`(120|30|180|600) seconds`" docs/02-architecture.md docs/DEPLOYMENT.md
git diff -- docs/10-proof-strategy.md
git diff --check
```

Expected: stale-profile search is empty, frozen diff is empty and diff check exits 0.

- [ ] **Step 3: Commit documentation**

```powershell
git add docs/02-architecture.md docs/DEPLOYMENT.md
git commit -m "docs: document minimum safe draw timing"
```

### Task 5: Run Proof And Local Regression Gates

**Files:**
- Read only: `spec/LokDraw.tla`, `spec/LokDraw.cfg`, `spec/LokDraw-risk.cfg`
- Generated local output only: test/TLC logs outside tracked source unless an existing evidence path requires them

**Interfaces:**
- Consumes: final source profile.
- Produces: fresh proof and regression results before any new Sepolia spend.

- [ ] **Step 1: Run both TLC configurations**

```powershell
& 'C:\Users\TBC\tools\jdk-21.0.12+8-jre\bin\java.exe' -jar 'C:\Users\TBC\tools\tla2tools.jar' -deadlock -workers 4 -config 'D:\Lok\spec\LokDraw.cfg' 'D:\Lok\spec\LokDraw.tla'
& 'C:\Users\TBC\tools\jdk-21.0.12+8-jre\bin\java.exe' -jar 'C:\Users\TBC\tools\tla2tools.jar' -deadlock -workers 4 -config 'D:\Lok\spec\LokDraw-risk.cfg' 'D:\Lok\spec\LokDraw.tla'
```

Expected: both complete with no error/counterexample. Stop and escalate any counterexample.

- [ ] **Step 2: Run TypeScript, formatting and focused draw tests**

```powershell
npx tsc --noEmit
npx prettier --check scripts/deploy.ts scripts/p-s2-sepolia-groups.ts test/scripts/deploy.t.ts test/draw/helpers.ts docs/02-architecture.md docs/DEPLOYMENT.md
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js test test/scripts/deploy.t.ts test/draw/DrawManager.state.t.ts test/draw
```

Expected: all commands exit 0.

- [ ] **Step 3: Run the full local Hardhat regression**

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js test
```

Expected: zero failures. The >=10^7 Foundry campaign is not rerun because no Solidity/reference-model source changed;
record an empty `git diff 65ff43262778a1c073d1d2f413a11d9c57cb98a5..HEAD -- contracts test-foundry spec` as the
equivalence basis.

- [ ] **Step 4: Verify source scope**

Require:

```powershell
git diff -- docs/10-proof-strategy.md
git status --short
```

Expected: frozen diff empty; only intended generated evidence may remain.

### Task 6: Prepare And Approve The New Sepolia Budget

**Files:**
- Create: a dated read-only deployment execution manifest under `docs/proofs/`
- Create: `deployments/history/sepolia-2026-08-13-120-30-180-600.json`
- No transaction in this task

**Interfaces:**
- Consumes: deploy transaction estimates, current gas data and operator balance.
- Produces: exact transaction count, per-call gas ceilings, total gas cap and ETH cap for owner approval.

- [ ] **Step 1: Run read-only preflight and gas estimation**

Record chain ID, signer address, balance, source commit, expected five deployment transactions, binding/checkpoint calls,
constructor args, recovery path and deployment runtime hashes. Never print a private key or secret variable.

Before replacing the canonical manifest, preserve its exact bytes at
`deployments/history/sepolia-2026-08-13-120-30-180-600.json` and record its SHA-256 in the read-only execution manifest.

- [ ] **Step 2: Write the capped manifest**

The manifest must list every state-changing transaction, estimated gas, hard gas ceiling, custody effect, rollback and
total ETH cap. Include Etherscan verification and frontend publishing as non-custodial post-deployment steps.

- [ ] **Step 3: Stop for explicit owner approval**

Do not infer an ETH cap from prior Group A/B authorization. Continue only after the owner approves both transaction and
ETH budgets for this new deployment.

### Task 7: Deploy, Verify And Bind The Final Stack

**Files:**
- Generate/replace after successful deployment: `deployments/sepolia.json`
- Update generated evidence under the repository's existing Sepolia artifact paths

**Interfaces:**
- Consumes: approved deployment budget and `SEPOLIA_DRAW_TIMING`.
- Produces: source-verified topology whose timing getters equal `60/24/120/300`.

- [ ] **Step 1: Run fresh preflight and deploy under the approved caps**

Use the existing Node 22 Hardhat Sepolia deployment entrypoint. Stop on wrong chain, signer, balance, bytecode, receipt,
gas or projected cap.

- [ ] **Step 2: Verify topology and timing read-only**

Require wrapper alias, adapter-vault binding, one-time draw-manager binding, owner identity, current true solvency epoch,
and all four timing getters matching the manifest.

- [ ] **Step 3: Verify all five contracts on Etherscan**

Record direct source-verification URLs and mark `verified=true` only after Etherscan reports verified source.

- [ ] **Step 4: Commit deployment provenance**

```powershell
git add deployments/sepolia.json docs/DEPLOYMENT.md artifacts/sepolia/minimum-timing-deployment-2026-08-14
git commit -m "chore(sepolia): deploy minimum-timing Lok stack"
```

### Task 8: Final Integration, Group A And Frontend Publication

**Files:**
- Modify: `frontend/.env.production`
- Modify: `README.md`
- Generate: final Group A receipts/decryptions/hashes in a new deployment-scoped evidence directory

**Interfaces:**
- Consumes: verified final manifest.
- Produces: settled public draw, final P-S2 Group A evidence, updated public UI and reviewer handoff.

- [ ] **Step 1: Seed and settle the required final non-strict draw**

Use manifest-capped fixture values and existing batch caps. Run the public verifier:

```powershell
$env:LOK_VERIFY_LATEST_SETTLED='1'
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run --network sepolia scripts/verify-draw.ts
```

Expected: verifier prints PASS for the final draw transcript.

- [ ] **Step 2: Run P-S2 Group A against the final deployment**

Prepare a deployment-scoped Group A manifest/cap before sending transactions. Require 62 receipts, settlement at S44,
post-settlement recovery, exact negative cases and zero SHA mismatch. Do not rerun Group B unless the independent
reviewer rejects the unchanged-source equivalence argument.

Run with the new journal root:

```powershell
$env:LOK_P_S2_EVIDENCE_DIR='D:\Lok\artifacts\sepolia\p-s2-minimum-timing-group-a-2026-08-14'
$env:LOK_P_S2_PHASE='group-a'
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run --network sepolia --no-compile scripts/p-s2-sepolia-groups.ts
```

- [ ] **Step 3: Update and test frontend addresses**

Set all six `VITE_*_ADDRESS` values from `deployments/sepolia.json`, then run:

```powershell
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: tests and Vite production build pass without fallback or stale addresses.

- [ ] **Step 4: Update README and publish only the verified build**

Replace old Etherscan links with final addresses, state `60/24/120/300`, distinguish strict mode and the adapter-only
24-hour timelock, then deploy the linked private GitHub branch through the existing Vercel project.

- [ ] **Step 5: Final evidence review and handoff**

Check all receipts/hashes, exact commits, clean intended worktree, frozen zero-diff and public URLs. Report:

```text
P-S2 hand proof: APPROVED
Full P-S2: BLOCKED_PENDING_INDEPENDENT_EVIDENCE_REVIEW
P-P1: WEAKER-THAN-CLAIMED
```

Never self-sign the independent verdict.
