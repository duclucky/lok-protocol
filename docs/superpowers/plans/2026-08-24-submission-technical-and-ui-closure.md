# Submission Technical And UI Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one reproducible, green release of Lok Protocol whose proof evidence, public draw verifier, CI, product-wide UI/UX, documentation, GitHub commit and Vercel deployment all agree without changing frozen propositions or production contracts.

**Architecture:** Close proof and release blockers before touching presentation. Keep canonical proof artifacts read-only during ordinary tests, make the Sepolia verifier resilient to RPC indexing without weakening cardinality, and require root plus frontend gates in CI. Refine the existing React/Vite app through shared tokens and state models, preserving the current contracts, FHEVM APIs, deployment addresses and permissionless keeper architecture.

**Tech Stack:** Solidity 0.8.x, Hardhat 2.28, TypeScript 5.9, Node 22, ethers 6, Zama FHEVM SDK 3.4, React 19, Vite 8, wagmi 3, viem 2, Vitest, Testing Library, Playwright, GitHub Actions and Vercel.

## Global Constraints

- Execute inline in this task; do not dispatch subagents.
- Do not edit `docs/10-proof-strategy.md`, production contracts, FHE arithmetic, ACL rules, public-decryption allowlists, draw timing, batch caps, adapter rules or deployment addresses.
- Do not normalize, filter or omit FHEVM Executor/ACL logs or entry 301 / `FheLe`.
- Do not send Sepolia transactions or deploy contracts until Task 10 receives separate owner approval for the state-changing live smoke.
- Preserve unrelated existing worktree changes. Stage each task by explicit path and inspect `git diff --cached` before committing.
- Use Node.js 22 for all root and frontend commands.
- Keep the existing light/ink/patina/seal identity, IBM Plex typography and Lucide icons. Do not add a UI framework or decorative asset system.
- Video, X publication and submission eligibility remain out of scope.

---

## Task 1: Isolate P-P1 Test Evidence From Canonical Artifacts

**Files:**
- Modify: `scripts/privacy-scan.ts`
- Modify: `test/privacy/acl-uniformity.t.ts`
- Modify: `test/privacy/gas-indistinguishability.t.ts`
- Modify: `test/privacy/log-indistinguishability.t.ts`
- Create: `test/privacy/privacy-evidence-isolation.t.ts`
- Modify: `package.json`

- [ ] **Step 1: Add a failing isolation test**

Create `test/privacy/privacy-evidence-isolation.t.ts` with tests that:

```ts
import { expect } from "chai";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  canonicalPrivacyEvidenceDirectory,
  resolvePrivacyEvidenceDirectory,
  writePrivacyEvidence,
} from "../../scripts/privacy-scan";

describe("privacy evidence output isolation", function () {
  it("requires an explicit output directory for test-generated evidence", function () {
    expect(() => resolvePrivacyEvidenceDirectory({ NODE_ENV: "test" })).to.throw(
      "LOK_PRIVACY_EVIDENCE_DIR is required while NODE_ENV=test",
    );
  });

  it("writes a test fragment only under the supplied temporary directory", function () {
    const directory = mkdtempSync(path.join(tmpdir(), "lok-privacy-isolation-"));
    const sentinel = path.join(canonicalPrivacyEvidenceDirectory(), "acl-uniformity.json");
    const before = existsSync(sentinel) ? readFileSync(sentinel, "utf8") : undefined;
    try {
      writePrivacyEvidence("acl-uniformity", {
        status: "PASS",
        sourceTestIdentifiers: ["privacy-evidence-isolation"],
      }, directory);
      expect(existsSync(path.join(directory, "acl-uniformity.json"))).to.equal(true);
      expect(existsSync(sentinel) ? readFileSync(sentinel, "utf8") : undefined).to.equal(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```powershell
npx hardhat test test/privacy/privacy-evidence-isolation.t.ts
```

Expected: compile/type failure because `canonicalPrivacyEvidenceDirectory` and `resolvePrivacyEvidenceDirectory` do not exist.

- [ ] **Step 3: Add explicit evidence directory resolution**

In `scripts/privacy-scan.ts`, export the canonical path and an environment resolver:

```ts
export function canonicalPrivacyEvidenceDirectory(): string {
  return PRIVACY_EVIDENCE_DIR;
}

export function resolvePrivacyEvidenceDirectory(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = environment.LOK_PRIVACY_EVIDENCE_DIR;
  if (configured !== undefined && configured.trim() !== "") return path.resolve(configured);
  if (environment.NODE_ENV === "test") {
    throw new Error("LOK_PRIVACY_EVIDENCE_DIR is required while NODE_ENV=test");
  }
  return PRIVACY_EVIDENCE_DIR;
}
```

Keep `buildPrivacyReport()` read-only. Its default input remains committed canonical evidence; it must not create or update evidence.

- [ ] **Step 4: Route every dynamic privacy test to one temporary evidence directory**

Add a shared Mocha setup in each of the three dynamic test files:

```ts
let evidenceDirectory: string;

before(function () {
  evidenceDirectory = mkdtempSync(path.join(tmpdir(), "lok-privacy-test-"));
});

after(function () {
  rmSync(evidenceDirectory, { recursive: true, force: true });
});
```

Pass `evidenceDirectory` as the third argument to every `writePrivacyEvidence(...)` call. Do not set a process-wide environment variable because the suite may import scanner helpers before hooks run.

- [ ] **Step 5: Add an explicit canonical validation command**

Add to root `package.json`:

```json
"privacy:validate": "ts-node scripts/privacy-scan.ts"
```

Do not add an implicit canonical generation command. Existing campaign scripts remain the only evidence producers.

- [ ] **Step 6: Verify test isolation and canonical byte stability**

Record hashes before and after:

```powershell
$before = Get-FileHash artifacts/privacy/acl-uniformity.json,artifacts/privacy/log-indistinguishability.json,artifacts/privacy/gas-indistinguishability.json -Algorithm SHA256
npx hardhat test test/privacy/privacy-evidence-isolation.t.ts test/privacy/acl-uniformity.t.ts test/privacy/log-indistinguishability.t.ts test/privacy/gas-indistinguishability.t.ts
$after = Get-FileHash artifacts/privacy/acl-uniformity.json,artifacts/privacy/log-indistinguishability.json,artifacts/privacy/gas-indistinguishability.json -Algorithm SHA256
Compare-Object $before $after -Property Path,Hash
npm run privacy:validate
```

Expected: tests pass, `Compare-Object` has no output, scanner reports `PASS` from canonical evidence.

- [ ] **Step 7: Commit only Task 1 files**

```powershell
git add scripts/privacy-scan.ts test/privacy/acl-uniformity.t.ts test/privacy/gas-indistinguishability.t.ts test/privacy/log-indistinguishability.t.ts test/privacy/privacy-evidence-isolation.t.ts package.json
git diff --cached --check
git commit -m "test(privacy): isolate canonical evidence outputs"
```

---

## Task 2: Make Draw Event Retrieval RPC-Resilient Without Weakening Verification

**Files:**
- Modify: `scripts/verify-draw.ts`
- Modify: `test/scripts/verify-draw.t.ts`

- [ ] **Step 1: Add failing tests for fallback, deduplication and ordering**

Export a provider-independent helper contract from the test by importing the planned `collectDrawEventLogs`. Add fixtures with duplicate logs and an RPC that returns zero indexed results but valid broad results.

```ts
it("falls back to decoded topic0 logs, deduplicates and orders deterministically", async function () {
  const exact = async () => [];
  const broad = async () => [laterLog, duplicateEarlierLog, earlierLog];
  const logs = await collectDrawEventLogs({
    fromBlock: 10,
    toBlock: 20,
    drawId: 2n,
    queryExact: exact,
    queryBroad: broad,
    decodeDrawId: (log) => BigInt(log.data),
  });
  expect(logs.map((log) => `${log.transactionHash}:${log.index}`)).to.deep.equal([
    `${earlierLog.transactionHash}:${earlierLog.index}`,
    `${laterLog.transactionHash}:${laterLog.index}`,
  ]);
});
```

Also assert:

- broad fallback is not called when exact indexed logs exist;
- malformed broad logs are rejected rather than synthesized;
- wrong-draw broad logs are excluded;
- two distinct matching logs remain two logs so `eventBlock()` still rejects duplicates.

- [ ] **Step 2: Run verifier unit tests and confirm RED**

```powershell
npx hardhat test test/scripts/verify-draw.t.ts
```

Expected: import failure for `collectDrawEventLogs`.

- [ ] **Step 3: Extract deterministic collection logic**

In `scripts/verify-draw.ts`, add:

```ts
type OrderedEventLog = Pick<Log, "blockNumber" | "transactionIndex" | "index" | "transactionHash">;

function eventLogIdentity(log: OrderedEventLog): string {
  return `${log.transactionHash.toLowerCase()}:${log.index}`;
}

export async function collectDrawEventLogs<T extends OrderedEventLog>(options: {
  fromBlock: number;
  toBlock: number;
  drawId?: bigint;
  queryExact(): Promise<readonly T[]>;
  queryBroad(): Promise<readonly T[]>;
  decodeDrawId(log: T): bigint;
}): Promise<T[]> {
  const direct = [...await options.queryExact()];
  const source = options.drawId === undefined || direct.length > 0
    ? direct
    : (await options.queryBroad()).filter((log) => options.decodeDrawId(log) === options.drawId);
  return [...new Map(source.map((log) => [eventLogIdentity(log), log])).values()].sort(
    (left, right) =>
      left.blockNumber - right.blockNumber ||
      left.transactionIndex - right.transactionIndex ||
      left.index - right.index,
  );
}
```

Use it inside each 5,000-block chunk of `queryEventLogs()`. ABI parsing failures must throw with the event name and transaction hash.

- [ ] **Step 4: Keep exact cardinality after normalization**

Do not change `eventBlock()` or `verifyDrawEvidence()`. `DrawOpened` and `DrawSettled` must still have exactly one unique matching event after filtering and deduplication.

- [ ] **Step 5: Verify locally and against preserved Sepolia evidence**

```powershell
npx hardhat test test/scripts/verify-draw.t.ts
$env:LOK_VERIFY_MANIFEST="deployments/history/sepolia-2026-08-13-120-30-180-600.json"
$env:LOK_VERIFY_LATEST_SETTLED="1"
npx hardhat run scripts/verify-draw.ts --network sepolia
Remove-Item Env:LOK_VERIFY_MANIFEST,Env:LOK_VERIFY_LATEST_SETTLED
```

Expected: unit tests pass and the read-only verifier reports all checks passed. No transaction is sent.

- [ ] **Step 6: Commit Task 2**

```powershell
git add scripts/verify-draw.ts test/scripts/verify-draw.t.ts
git diff --cached --check
git commit -m "fix(verifier): tolerate Sepolia event indexing"
```

---

## Task 3: Establish One Required Green CI Workflow

**Files:**
- Modify: `.github/workflows/main.yml`
- Modify: `.prettierignore`
- Modify: `package.json`

- [ ] **Step 1: Reproduce the exact intended gate locally**

Run every command before editing CI and record the failing command:

```powershell
npm ci
npm run lint:sol
npm run lint:ts
npm run compile
npm run build:ts
npm test
npm --prefix frontend ci
npm --prefix frontend run test
npm --prefix frontend run build
```

Task 1 and Task 2 must have removed the known root-test and verifier blockers before continuing.

- [ ] **Step 2: Narrow formatting to maintained files**

Replace the repository-wide formatter glob with explicit maintained surfaces:

```json
"prettier:check": "prettier --check contracts scripts test frontend/src frontend/e2e *.js *.json *.ts *.yml .github/workflows"
```

Keep frozen proof docs and generated evidence outside automatic formatting. Add generated artifact roots and `docs/10-proof-strategy.md` to `.prettierignore` as defense in depth.

- [ ] **Step 3: Complete the required workflow**

Preserve the pinned actions and Node 22 setup. Make `.github/workflows/main.yml` run, in order:

```yaml
      - run: npm ci
      - run: npm run lint:sol
      - run: npm run lint:ts
      - run: npm run compile
      - run: npm run build:ts
      - run: npm test
      - run: npm --prefix frontend ci
      - run: npm --prefix frontend run test
      - run: npm --prefix frontend run build
```

Do not put Solidity coverage in the required job because instrumentation changes gas-sensitive privacy behavior.

- [ ] **Step 4: Verify workflow syntax and the full local command list**

```powershell
npm run prettier:check
npm run lint:sol
npm run lint:ts
npm run compile
npm run build:ts
npm test
npm --prefix frontend run test
npm --prefix frontend run build
git diff --check
```

- [ ] **Step 5: Commit Task 3 without discarding pre-existing workflow edits**

Inspect `.github/workflows/main.yml` against its pre-task content and retain compatible user changes.

```powershell
git add .github/workflows/main.yml .prettierignore package.json
git diff --cached
git commit -m "ci: require root and frontend release gates"
```

---

## Task 4: Consolidate Visual Tokens And Fix The Responsive Shell

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/components/WalletButton.tsx`
- Modify: `frontend/src/test/pages/AppShell.test.tsx`
- Create: `frontend/src/test/pages/WalletButton.test.tsx`
- Modify: `frontend/e2e/product-flow.spec.ts`
- Modify: `frontend/playwright.config.ts`

- [ ] **Step 1: Add failing shell and wallet tests**

Extend `AppShell.test.tsx` to assert the footer exposes network, FHEVM SDK version, source commit and both Etherscan links. Add `WalletButton.test.tsx` to assert:

- connected address is in a dedicated `.wallet-button__address` span;
- disconnect has an accessible name and fixed icon-only geometry;
- wrong-network text does not coexist with the connected address;
- pending labels preserve the button's accessible name.

- [ ] **Step 2: Add exact target viewports and overflow assertions**

Change Playwright projects to:

```ts
{ name: "mobile-375", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } } },
{ name: "landscape-812", use: { ...devices["Desktop Chrome"], viewport: { width: 812, height: 375 } } },
{ name: "tablet-768", use: { ...devices["Desktop Chrome"], viewport: { width: 768, height: 1024 } } },
{ name: "desktop-1024", use: { ...devices["Desktop Chrome"], viewport: { width: 1024, height: 768 } } },
{ name: "desktop-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
```

Keep the existing route-by-route overflow detector and add `320 x 720` as a focused Chromium test using `page.setViewportSize`.

- [ ] **Step 3: Run tests and confirm RED**

```powershell
npm --prefix frontend run test -- AppShell.test.tsx WalletButton.test.tsx
npm --prefix frontend run e2e -- --grep "every route fits"
```

- [ ] **Step 4: Consolidate semantic tokens**

At the top of `styles.css`, retain aliases required by existing selectors but source them from:

```css
:root {
  --canvas: #f3f4f1;
  --surface: #ffffff;
  --surface-quiet: #f7f8f6;
  --text-primary: #171a18;
  --text-muted: #5f6863;
  --action: #0b7159;
  --action-hover: #085b48;
  --seal: #f0d95a;
  --border: #d8ddd9;
  --warning: #8a5b00;
  --danger: #b42318;
  --focus: #0b7159;
  --radius-card: 8px;
  --radius-control: 6px;
  --motion-fast: 160ms;
  --motion-normal: 240ms;
}
```

Remove decorative gradients from buttons, cap cards at 8 px, retain status pills only where they encode status, and keep letter spacing at `0`.

- [ ] **Step 5: Implement bounded wallet layout**

Render the connected control as a group with a non-growing address button and a fixed disconnect icon button. Apply `minmax(0, 1fr) 44px`, `min-width: 0`, one-line ellipsis and no parent overflow clipping that hides focus rings.

- [ ] **Step 6: Implement route-focus and shell spacing**

Add a small `RouteFocus` component inside `AppShell` using `useLocation()` and `useEffect()` to focus `#main-content` after pathname changes. Ensure fixed mobile navigation reserves bottom padding and never obscures focused controls.

- [ ] **Step 7: Verify shell accessibility and responsive behavior**

```powershell
npm --prefix frontend run test -- AppShell.test.tsx WalletButton.test.tsx
npm --prefix frontend run e2e -- --grep "shell|every route fits"
npm --prefix frontend run build
```

- [ ] **Step 8: Commit Task 4**

```powershell
git add frontend/src/styles.css frontend/src/components/AppShell.tsx frontend/src/components/WalletButton.tsx frontend/src/test/pages/AppShell.test.tsx frontend/src/test/pages/WalletButton.test.tsx frontend/e2e/product-flow.spec.ts frontend/playwright.config.ts
git diff --cached --check
git commit -m "feat(ui): harden responsive application shell"
```

---

## Task 5: Introduce Shared Transaction And Private-Read Feedback

**Files:**
- Modify: `frontend/src/features/transactions/model.ts`
- Create: `frontend/src/components/AsyncActionStatus.tsx`
- Modify: `frontend/src/components/ActionStatus.tsx`
- Modify: `frontend/src/fhe/decryption-machine.ts`
- Modify: `frontend/src/test/features/transactions.test.ts`
- Create: `frontend/src/test/pages/AsyncActionStatus.test.tsx`
- Modify: `frontend/src/test/pages/ActionStatus.test.tsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Specify the state model in failing unit tests**

Add this discriminated union to the test expectation:

```ts
export type AsyncActionState =
  | { phase: "idle" }
  | { phase: "validating"; message: string }
  | { phase: "awaiting-wallet"; message: string }
  | { phase: "processing"; message: string }
  | { phase: "submitted"; hash: Hex; message: string }
  | { phase: "confirming"; hash: Hex; message: string }
  | { phase: "confirmed"; hash: Hex; message: string }
  | { phase: "failed"; message: string; technicalDetail?: string; retryable: boolean };
```

Tests must prove the state is serializable, terminal success requires a hash, failure exposes recovery text, and raw RPC detail is not the primary message.

- [ ] **Step 2: Add failing component tests**

`AsyncActionStatus` must render one `role="status"` live region, a confirmed Etherscan link, a retry button only when retryable, and an optional native `<details>` for technical information.

- [ ] **Step 3: Run and confirm RED**

```powershell
npm --prefix frontend run test -- transactions.test.ts AsyncActionStatus.test.tsx ActionStatus.test.tsx
```

- [ ] **Step 4: Implement the shared model and component**

Keep wallet actions unchanged. Add pure constructors such as `awaitingWallet(message)`, `processing(message)`, `confirmed(hash, message)` and `failedAction(error)` so page components do not duplicate RPC-message parsing.

`AsyncActionStatus` receives:

```ts
type AsyncActionStatusProps = Readonly<{
  state: AsyncActionState;
  onRetry?: () => void;
}>;
```

Use `aria-live="polite"`, `aria-atomic="true"`, stable minimum height and text plus icon for every phase.

- [ ] **Step 5: Align encrypted action-result messaging**

Keep the contract's two-state truth only:

- `OK`: action completed;
- `CLAMPED_OR_NO_OP`: requested action was clamped or made no change, funds remain accounted for.

Do not infer insufficient balance, rate cap or zero amount from this encrypted bit.

- [ ] **Step 6: Verify and commit**

```powershell
npm --prefix frontend run test -- transactions.test.ts AsyncActionStatus.test.tsx ActionStatus.test.tsx
npm --prefix frontend run build
git add frontend/src/features/transactions/model.ts frontend/src/components/AsyncActionStatus.tsx frontend/src/components/ActionStatus.tsx frontend/src/fhe/decryption-machine.ts frontend/src/test/features/transactions.test.ts frontend/src/test/pages/AsyncActionStatus.test.tsx frontend/src/test/pages/ActionStatus.test.tsx frontend/src/styles.css
git commit -m "feat(ui): unify confidential action feedback"
```

---

## Task 6: Refine Vault, Deposit And Risk Workflows

**Files:**
- Modify: `frontend/src/pages/VaultPage.tsx`
- Modify: `frontend/src/pages/DepositPage.tsx`
- Modify: `frontend/src/pages/RiskPage.tsx`
- Modify: `frontend/src/features/vault/model.ts`
- Modify: `frontend/src/test/pages/VaultPage.test.tsx`
- Modify: `frontend/src/test/pages/DepositPage.test.tsx`
- Modify: `frontend/src/test/pages/RiskPage.test.tsx`
- Modify: `frontend/e2e/product-flow.spec.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add failing Vault workflow tests**

Assert that:

- sealed balance and explicit reveal are first;
- Deposit and Withdraw are the two routine money actions;
- Withdraw all and Emergency recovery are progressively disclosed and never replace routine withdrawal;
- confirmed withdrawals retain an Etherscan link and encrypted action-result control;
- public metrics reserve stable labels during loading.

- [ ] **Step 2: Add failing Deposit workflow tests**

Assert default confidential cUSDC, explicit Public USDC disclosure, one primary CTA per step, inline amount errors, and distinct recovery messages for disconnected wallet, wrong network, insufficient balances, wallet rejection and encryption failure. Keep the test-token faucet in a subordinate demo section.

- [ ] **Step 3: Add failing Risk workflow tests**

Assert all five supported values are keyboard-operable radios, 100% is the default, reveal-current and save-new are separate actions, duplicate saves are disabled, and no estimated odds appear.

- [ ] **Step 4: Run page tests and confirm RED**

```powershell
npm --prefix frontend run test -- VaultPage.test.tsx DepositPage.test.tsx RiskPage.test.tsx
```

- [ ] **Step 5: Implement Vault progressive disclosure**

Use unframed page bands for balance and public metrics. Put emergency recovery under a disclosure labelled `Recovery options`; explain that it is exceptional and available regardless of draw state. Use `AsyncActionStatus` for receipt phases and retain `ActionStatus` for the encrypted outcome.

- [ ] **Step 6: Implement the two deposit paths**

Use a fieldset with two radio/segmented options. The public path sequence is:

```text
Get test USDC (optional demo) -> Shield public amount -> Confirm shield -> Deposit encrypted cUSDC
```

Before shield signature, show: `Shielding publishes this amount on-chain. The later Lok deposit uses encrypted cUSDC.` Do not combine shield and deposit into one privacy claim.

- [ ] **Step 7: Implement the Risk control**

Use radio buttons for `0 / 25 / 50 / 75 / 100`; update one sentence from the selected option; preserve encrypted theta semantics and avoid any odds estimate.

- [ ] **Step 8: Verify responsive workflows and commit**

```powershell
npm --prefix frontend run test -- VaultPage.test.tsx DepositPage.test.tsx RiskPage.test.tsx
npm --prefix frontend run e2e -- --grep "vault|deposit|risk|every route fits"
npm --prefix frontend run build
git add frontend/src/pages/VaultPage.tsx frontend/src/pages/DepositPage.tsx frontend/src/pages/RiskPage.tsx frontend/src/features/vault/model.ts frontend/src/test/pages/VaultPage.test.tsx frontend/src/test/pages/DepositPage.test.tsx frontend/src/test/pages/RiskPage.test.tsx frontend/e2e/product-flow.spec.ts frontend/src/styles.css
git commit -m "feat(ui): refine confidential savings workflows"
```

---

## Task 7: Refine Draw User View, Demo Progress And Keeper Timeline

**Files:**
- Modify: `frontend/src/pages/DrawPage.tsx`
- Modify: `frontend/src/features/draw/model.ts`
- Modify: `frontend/src/features/keeper/model.ts`
- Modify: `frontend/src/test/pages/DrawPage.test.tsx`
- Modify: `frontend/src/test/features/keeper.test.ts`
- Modify: `frontend/e2e/product-flow.spec.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add failing tests for both view modes**

User view must be default and expose only:

- current state in plain language;
- whether user action is required;
- expected next protocol step;
- Proof CTA after settlement.

Demo progress must expose:

- full state rail;
- cursor/participant progress;
- randomness sequencing;
- automation status;
- secondary manual fallback;
- transaction timeline.

- [ ] **Step 2: Add failing timeline tests**

Replace the `Date.now()` key with deterministic entries:

```ts
type KeeperExecutionLogEntry = Readonly<{
  step: string;
  hash: Hex;
  status: "submitted" | "confirmed" | "failed";
}>;
```

Assert every confirmed entry has step label, short hash, status text and Sepolia Etherscan link. Assert the sweep card reports batch count without implying the current browser observed automation transactions it did not submit.

- [ ] **Step 3: Run tests and confirm RED**

```powershell
npm --prefix frontend run test -- DrawPage.test.tsx keeper.test.ts
```

- [ ] **Step 4: Implement truthful automation states**

Use these labels:

- automation available: `Keeper automation is advancing this draw`;
- no active browser transaction: `No action is required from depositors`;
- manual fallback: `Run next step manually`;
- aggregate decrypt: `Requesting public decryption of draw totals`.

Never invent percentage progress for the Gateway request. Show an indeterminate processing state and retry only after a real failure.

- [ ] **Step 5: Keep permissionless fallback secondary**

Manual controls remain available in Demo progress, but visually secondary. The action is derived only from `keeperDecision`; no new keeper action or contract call is introduced.

- [ ] **Step 6: Verify all eight draw states and commit**

```powershell
npm --prefix frontend run test -- DrawPage.test.tsx keeper.test.ts
npm --prefix frontend run e2e -- --grep "draw|every route fits"
npm --prefix frontend run build
git add frontend/src/pages/DrawPage.tsx frontend/src/features/draw/model.ts frontend/src/features/keeper/model.ts frontend/src/test/pages/DrawPage.test.tsx frontend/src/test/features/keeper.test.ts frontend/e2e/product-flow.spec.ts frontend/src/styles.css
git commit -m "feat(ui): clarify draw automation and progress"
```

---

## Task 8: Complete Proof/Claim Semantics And Disclosure Documentation UI

**Files:**
- Modify: `frontend/src/pages/ProofPage.tsx`
- Modify: `frontend/src/pages/WhyEncryptedPage.tsx`
- Modify: `frontend/src/test/pages/ProofPage.test.tsx`
- Modify: `frontend/src/test/pages/WhyEncryptedPage.test.tsx`
- Modify: `frontend/e2e/product-flow.spec.ts`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Add failing winner/loser parity tests**

Both outcomes must begin with the same `Claim / check prize` action. Winner test expects decrypted amount, private-result explanation and `Withdraw winnings` link to the Vault withdrawal flow. Loser test expects principal-safety text and `Deposit for next draw` link. No winner-only onchain action, event wording or telemetry hook may appear.

- [ ] **Step 2: Add failing decryption failure tests**

Cover wallet rejection, SDK unavailable and decryption timeout using typed failures from the decryption machine. Each state must give a specific recovery action and state that a read failure does not change funds.

- [ ] **Step 3: Add disclosure-table accessibility tests**

Require one labelled public/sealed table, keyboard-reachable section links and no claim that infrastructure sees nothing. Preserve public membership, shield amount/timing and aggregate disclosure statements.

- [ ] **Step 4: Run and confirm RED**

```powershell
npm --prefix frontend run test -- ProofPage.test.tsx WhyEncryptedPage.test.tsx
```

- [ ] **Step 5: Implement exact claim semantics**

Display this sequence in concise copy:

```text
Settlement credits encrypted winnings automatically.
Checking decrypts only your connected wallet's credit.
Withdrawal moves principal and credited winnings as confidential cUSDC.
```

Do not add `claimPrize`, public proof publication or winner-only network behavior.

- [ ] **Step 6: Refine Why Encrypted for reading, not marketing**

Use constrained line length, short anchored sections and the existing disclosure table. Keep diagrams/data blocks small and factual; do not add a hero, illustration or nested cards.

- [ ] **Step 7: Verify and commit**

```powershell
npm --prefix frontend run test -- ProofPage.test.tsx WhyEncryptedPage.test.tsx
npm --prefix frontend run e2e -- --grep "result|every route fits"
npm --prefix frontend run build
git add frontend/src/pages/ProofPage.tsx frontend/src/pages/WhyEncryptedPage.tsx frontend/src/test/pages/ProofPage.test.tsx frontend/src/test/pages/WhyEncryptedPage.test.tsx frontend/e2e/product-flow.spec.ts frontend/src/styles.css
git commit -m "feat(ui): complete private prize result flow"
```

---

## Task 9: Close Accessibility, Responsive And Bundle Gates

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/e2e/product-flow.spec.ts`
- Modify: `frontend/playwright.config.ts`
- Create: `frontend/e2e/accessibility.spec.ts`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add failing keyboard, zoom and reduced-motion checks**

`accessibility.spec.ts` must verify:

- skip link reaches `#main-content`;
- all primary routes are keyboard reachable in logical order;
- visible focus exists on nav, wallet and primary action controls;
- at 200% emulated zoom there is no horizontal page overflow;
- reduced-motion media disables animation durations and smooth scrolling;
- fixed navigation does not obscure the focused element.

- [ ] **Step 2: Add stable-layout assertions**

For Vault metrics, Draw state/progress and transaction status, record element bounds before and after loading-state changes. Reject movement greater than 4 CSS px in either axis when the component remains on screen.

- [ ] **Step 3: Run E2E and capture RED evidence**

```powershell
npm --prefix frontend run e2e
```

- [ ] **Step 4: Measure the bundle before lazy loading**

```powershell
npm --prefix frontend run build
Get-ChildItem frontend\dist\assets\*.js | Sort-Object Length -Descending | Select-Object Name,Length
```

Record the initial route chunk size in the task notes. Only then replace eager page imports in `App.tsx` with `lazy()` and a bounded route fallback. Do not lazy-load the shell or wallet network guard.

- [ ] **Step 5: Add a build assertion for FHEVM WASM**

Create a `frontend` script that checks `dist/assets` contains at least one `.wasm` file and fails otherwise:

```json
"build:assert": "node scripts/assert-build.mjs",
"build": "tsc -b && vite build && npm run build:assert"
```

Create `frontend/scripts/assert-build.mjs` using `readdirSync` recursively; also verify the emitted WASM is non-empty. Do not fetch the network.

- [ ] **Step 6: Fix only measured failures**

Adjust responsive constraints, focus styles, stable dimensions and route loading. Keep motion to opacity/transform at 160/240 ms and preserve `prefers-reduced-motion` overrides.

- [ ] **Step 7: Run full frontend verification**

```powershell
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run e2e
```

Review Playwright screenshots for all six routes at five configured viewports, plus Draw user/demo and Proof winner/loser states. Reject overlap, clipped text, blank content, stale labels or hidden focus.

- [ ] **Step 8: Commit Task 9**

```powershell
git add frontend/src/App.tsx frontend/src/styles.css frontend/e2e/product-flow.spec.ts frontend/e2e/accessibility.spec.ts frontend/playwright.config.ts frontend/package.json frontend/scripts/assert-build.mjs
git diff --cached --check
git commit -m "test(ui): enforce accessibility and release quality"
```

---

## Task 10: Align Documentation, Prove The Release And Publish

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/06-frontend-spec.md`
- Modify: `frontend/src/components/AppShell.tsx`
- Create: `docs/release/2026-08-24-submission-closure.md`

- [ ] **Step 1: Update factual documentation only**

Change stale repository wording from private to public. Document:

- public GitHub URL;
- canonical Vercel URL;
- seeded demo manifest versus P-S2 evidence manifest;
- exact settled draw verifier command;
- settlement-credit, private-check and confidential-withdraw semantics;
- keeper automation versus manual fallback;
- current tested Node/FHEVM/frontend versions.

Do not edit historical proof conclusions or frozen §3.

- [ ] **Step 2: Bind footer build metadata**

Expose `VITE_SOURCE_COMMIT` and the installed FHEVM SDK version at build time. Render short commit and version in the footer with bounded mono text. Production Vercel must receive the Git commit SHA; local fallback is `unbound-local-build`, not a fabricated commit.

- [ ] **Step 3: Run the complete local release matrix**

```powershell
npm run prettier:check
npm run lint:sol
npm run lint:ts
npm run compile
npm run build:ts
npm test
npm run privacy:validate
npx hardhat test test/integration/SepoliaDeployment.t.ts --network sepolia
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run e2e
git diff -- docs/10-proof-strategy.md
git diff --check
```

Expected: all required gates pass, integration reports `3 passing`, frozen doc diff is empty, and ordinary tests do not change tracked evidence.

- [ ] **Step 4: Run the read-only public verifier**

```powershell
$env:LOK_VERIFY_MANIFEST="deployments/history/sepolia-2026-08-13-120-30-180-600.json"
$env:LOK_VERIFY_LATEST_SETTLED="1"
npx hardhat run scripts/verify-draw.ts --network sepolia
Remove-Item Env:LOK_VERIFY_MANIFEST,Env:LOK_VERIFY_LATEST_SETTLED
```

Record all six check results in `docs/release/2026-08-24-submission-closure.md`. This command is read-only.

- [ ] **Step 5: Commit release documentation**

```powershell
git add README.md docs/DEPLOYMENT.md docs/06-frontend-spec.md frontend/src/components/AppShell.tsx docs/release/2026-08-24-submission-closure.md
git diff --cached --check
git commit -m "docs: bind submission release evidence"
```

- [ ] **Step 6: Push and require the public GitHub workflow to turn green**

```powershell
git push origin main
gh run list --workflow Main --limit 3
gh run view <new-run-id> --log-failed
```

Do not continue while the exact source commit is red or pending.

- [ ] **Step 7: Deploy Vercel from the exact green commit**

Use the existing Git-connected Vercel project with root `frontend/`. Confirm the deployment reports `Ready`, the production alias is `https://lok-protocol.vercel.app`, and the deployment source SHA equals the green GitHub commit.

- [ ] **Step 8: Run read-only production smoke first**

Verify HTTP 200, COOP/COEP headers, WASM MIME, all six routes, no console/page errors, correct chain/addresses, no overflow at mobile/desktop viewports and footer commit equality. Record results without connecting or signing.

- [ ] **Step 9: Stop for owner approval before state-changing live smoke**

Present the wallet, estimated maximum transaction count, Sepolia ETH cap and exact steps:

```text
connect -> mint test token -> shield -> deposit -> reveal balance
-> observe/advance draw -> check result -> withdraw
```

Do not sign or send a transaction until the owner approves that budget and session.

- [ ] **Step 10: After approval, execute and record the live cycle**

Record wallet, browser, source commit, Vercel deployment ID, draw ID, transaction hashes, private-read outcomes and final withdrawal. Do not record private keys, permit signatures, decrypted balances or winner identity in public evidence.

- [ ] **Step 11: Final repository integrity check**

```powershell
git status --short
git diff -- docs/10-proof-strategy.md
git diff --check
git log -1 --format=fuller
```

Expected: no unexplained tracked changes, frozen §3 zero diff and release evidence bound to the same green/published commit.

---

## Completion Criteria

- [ ] Canonical P-P1 evidence remains byte-identical after ordinary tests and validates read-only.
- [ ] Public draw verifier passes against the preserved settled Sepolia demo without sending a transaction.
- [ ] Required GitHub Actions run is green on the exact release commit.
- [ ] Root lint, compile, build, tests and privacy scanner pass.
- [ ] Frontend unit tests, production build, WASM assertion and all Playwright projects pass.
- [ ] No horizontal overflow exists at 320 px or any required viewport.
- [ ] Wallet identity, disconnect, navigation and focused controls never overlap.
- [ ] Vault, Deposit, Risk, Draw, Proof and Why Encrypted satisfy the approved page requirements.
- [ ] Vercel production is `Ready` and source-bound to the green commit.
- [ ] State-changing live smoke is executed only after separate owner budget approval.
- [ ] `docs/10-proof-strategy.md` has zero diff.
- [ ] No production contract, deployment address, FHE/ACL behavior or frozen proposition changed.
