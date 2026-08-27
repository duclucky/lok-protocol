# Consumer-Grade UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking. This project owner previously disallowed subagents, so execution is
> inline only.

**Goal:** Redesign the Lok frontend into a polished confidential savings app while preserving the existing Sepolia
contract, keeper, wallet, FHE, and deployment flows.

**Architecture:** This is a frontend-only redesign over existing React/Vite components. The plan keeps the current route
structure and transaction hooks, then changes the page hierarchy, copy, and responsive styling. Tests are updated first
for user-visible labels, action hierarchy, accessibility affordances, and wallet overflow safety.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, Playwright, wagmi, Zama React SDK, lucide-react,
plain CSS tokens in `frontend/src/styles.css`.

## Global Constraints

- Do not modify Solidity, deployment addresses, proof docs, or `docs/10-proof-strategy.md`.
- Preserve current Sepolia live flow and transaction functions.
- Default product language is user-facing savings language, not protocol-internal keeper language.
- Keeper controls are a fallback, not the primary CTA.
- Deposit, shield, reveal, withdraw, and draw fallback actions must state why a wallet signature is needed.
- Every icon-only control needs an accessible name.
- Wallet address text must never overflow its parent.
- Buttons and critical touch targets must be at least 44px high.
- Verify at 375px, 768px, 1024px, and 1440px.
- Respect `prefers-reduced-motion`.

---

## File Structure

- Modify `frontend/src/components/AppShell.tsx`: route labels, shell hierarchy, wallet placement.
- Modify `frontend/src/components/WalletButton.tsx`: overflow-safe connected state and accessibility if needed.
- Modify `frontend/src/pages/VaultPage.tsx`: app-first home dashboard.
- Modify `frontend/src/pages/DepositPage.tsx`: guided funding wizard and signature reasons.
- Modify `frontend/src/pages/DrawPage.tsx`: default user view, protocol progress mode, fallback control, transaction
  timeline.
- Modify `frontend/src/pages/ProofPage.tsx`: result-oriented private-check flow.
- Modify `frontend/src/styles.css`: visual system, responsive layout, card/control polish.
- Modify existing tests under `frontend/src/test/pages/*.test.tsx`.
- Optionally modify `frontend/e2e/accessibility.spec.ts` only if selector text changed.

No new production data model is planned. Add a small presentational helper only if repeated markup appears in at least
two pages.

---

### Task 1: Shell, Navigation, And Wallet Framing

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/components/WalletButton.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/pages/AppShell.test.tsx`
- Test: `frontend/src/test/pages/WalletButton.test.tsx`

**Interfaces:**
- Consumes: existing `WalletButton` component and route table.
- Produces: route label "Result" for `/proof`, overflow-safe wallet controls, stable shell for later pages.

- [ ] **Step 1: Add/adjust failing shell tests**

Update `frontend/src/test/pages/AppShell.test.tsx` with assertions like:

```tsx
it("labels the private result route as Result instead of proof-first language", () => {
  render(<AppShell />, { wrapper: MemoryRouter });

  expect(screen.getAllByRole("link", { name: /result/i }).length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: /^Proof$/i })).not.toBeInTheDocument();
});
```

Update `frontend/src/test/pages/WalletButton.test.tsx` with:

```tsx
it("keeps the connected wallet address in an overflow-safe text cell", () => {
  walletState.address = "0xC495123456789012345678901234567890008272";
  walletState.chainId = LOK_CHAIN_ID;
  walletState.isConnected = true;

  const { container } = render(<WalletButton />);

  const group = container.querySelector(".wallet-button-group");
  const address = container.querySelector(".wallet-button__address");
  expect(group).toHaveClass("wallet-button-group");
  expect(address).toHaveTextContent("0xC495...8272");
  expect(address).toHaveAttribute("title", walletState.address);
  expect(screen.getByRole("button", { name: "Disconnect wallet" })).toHaveClass("wallet-button__disconnect");
});
```

- [ ] **Step 2: Run RED tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- AppShell.test.tsx WalletButton.test.tsx
```

Expected: at least the route-label test fails if the current UI still says `Proof`; wallet test may already pass and is
kept as a regression guard.

- [ ] **Step 3: Implement shell/wallet changes**

Change the `/proof` nav label to `Result` in `AppShell.tsx`, keep the route path unchanged, and ensure wallet connected
state renders as:

```tsx
<span className="wallet-button__address" title={address}>
  {shortAddress(address)}
</span>
```

Keep disconnect as a separate `button` with `aria-label="Disconnect wallet"`.

- [ ] **Step 4: Tighten shell CSS**

In `frontend/src/styles.css`, ensure these selectors exist and keep overflow bounded:

```css
.wallet-button-group {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 44px;
  gap: 6px;
}

.wallet-button__address {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 5: Run GREEN tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- AppShell.test.tsx WalletButton.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/components/AppShell.tsx frontend/src/components/WalletButton.tsx frontend/src/styles.css frontend/src/test/pages/AppShell.test.tsx frontend/src/test/pages/WalletButton.test.tsx
git commit -m frontend-shell-wallet-redesign
```

---

### Task 2: Vault Page As Product Dashboard

**Files:**
- Modify: `frontend/src/pages/VaultPage.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/pages/VaultPage.test.tsx`

**Interfaces:**
- Consumes: `LokPublicData`, `SealedValue`, `SolvencyStatus`, existing withdrawal actions.
- Produces: first-screen dashboard with Deposit, Reveal balance, Draw status, and Withdraw visible.

- [ ] **Step 1: Write failing dashboard tests**

Update `VaultPage.test.tsx` to assert the new first-viewport hierarchy:

```tsx
it("presents the vault as a savings app with obvious primary actions", () => {
  render(<VaultPage publicData={publicData} nowMs={1_786_500_000_000} />, { wrapper: MemoryRouter });

  expect(screen.getByRole("heading", { name: /private prize savings on sepolia/i })).toBeVisible();
  expect(screen.getByRole("link", { name: /deposit privately/i })).toHaveAttribute("href", "/deposit");
  expect(screen.getByRole("button", { name: /reveal your balance/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /^Withdraw$/i })).toBeVisible();
  expect(screen.getByText(/withdraw anytime/i)).toBeVisible();
  expect(screen.getByText(/automation/i)).toBeVisible();
});
```

Add a loading-state check:

```tsx
it("keeps the savings dashboard labels stable while Sepolia data loads", () => {
  render(<VaultPage publicData={{ status: "loading" }} />, { wrapper: MemoryRouter });

  expect(screen.getByText("Private balance")).toBeVisible();
  expect(screen.getByText("Current prize")).toBeVisible();
  expect(screen.getByText("Draw automation")).toBeVisible();
  expect(screen.getByText("Principal recovery")).toBeVisible();
});
```

- [ ] **Step 2: Run RED tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- VaultPage.test.tsx
```

Expected: new heading/action labels fail against the old layout.

- [ ] **Step 3: Restructure `VaultPage.tsx`**

Keep existing props and transaction handlers. Replace the top layout with:

```tsx
<section className="vault-hero" aria-labelledby="vault-hero-title">
  <div>
    <p className="section-label">Lok Protocol</p>
    <h1 id="vault-hero-title">Private prize savings on Sepolia</h1>
    <p>Deposit cUSDC, keep your balance sealed, and stay withdrawable while draws run onchain.</p>
  </div>
  <div className="vault-hero__actions">
    <Link className="button button--primary" to="/deposit">Deposit privately</Link>
    <button className="button button--secondary" type="button" onClick={() => setWithdrawOpen(true)}>
      Withdraw
    </button>
  </div>
</section>
```

Add dashboard cards for "Private balance", "Current prize", "Draw automation", and "Principal recovery". Use current
`SealedValue`, `prizeLabel`, `participantCount`, `draw.state`, and withdrawal handlers; do not invent data.

- [ ] **Step 4: Add dashboard CSS**

Add or update:

```css
.vault-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) auto;
  gap: 24px;
  align-items: end;
  margin-bottom: 18px;
}

.vault-dashboard {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.dashboard-card {
  min-width: 0;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}
```

- [ ] **Step 5: Run GREEN tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- VaultPage.test.tsx
```

Expected: all VaultPage tests pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/pages/VaultPage.tsx frontend/src/styles.css frontend/src/test/pages/VaultPage.test.tsx
git commit -m frontend-vault-dashboard-redesign
```

---

### Task 3: Deposit Funding Wizard

**Files:**
- Modify: `frontend/src/pages/DepositPage.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/pages/DepositPage.test.tsx`

**Interfaces:**
- Consumes: existing `mintTestTokens`, `shield`, `deposit`, `revealWalletCusdc`, and `revealActionStatus` props.
- Produces: three-step guided flow with wallet-sign reasons.

- [ ] **Step 1: Write failing wizard tests**

Add tests:

```tsx
it("renders funding as a three-step wallet-guided wizard", () => {
  render(<DepositPage />, { wrapper: MemoryRouter });

  expect(screen.getByText("Step 1")).toBeVisible();
  expect(screen.getByText("Get test USDC")).toBeVisible();
  expect(screen.getByText("Step 2")).toBeVisible();
  expect(screen.getByText("Shield to cUSDC")).toBeVisible();
  expect(screen.getByText("Step 3")).toBeVisible();
  expect(screen.getByText("Deposit privately")).toBeVisible();
});

it("states why each wallet signature is needed before actions are clicked", () => {
  render(<DepositPage />, { wrapper: MemoryRouter });

  expect(screen.getByText(/mint sepolia test usdc to fund the demo/i)).toBeVisible();
  expect(screen.getByText(/convert public test usdc into confidential cusdc/i)).toBeVisible();
  expect(screen.getByText(/send encrypted cusdc into the vault/i)).toBeVisible();
});
```

- [ ] **Step 2: Run RED tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- DepositPage.test.tsx
```

Expected: wizard labels or signature-reason copy fail.

- [ ] **Step 3: Restructure `DepositPage.tsx`**

Keep current transaction functions and amount state. Render a `deposit-wizard` with three `deposit-step` sections:

```tsx
<section className="deposit-wizard" aria-label="Deposit steps">
  <article className="deposit-step">
    <span className="step-kicker">Step 1</span>
    <h2>Get test USDC</h2>
    <p>Mint Sepolia test USDC to fund the demo.</p>
    ...
  </article>
  <article className="deposit-step">
    <span className="step-kicker">Step 2</span>
    <h2>Shield to cUSDC</h2>
    <p>Convert public test USDC into confidential cUSDC.</p>
    ...
  </article>
  <article className="deposit-step">
    <span className="step-kicker">Step 3</span>
    <h2>Deposit privately</h2>
    <p>Send encrypted cUSDC into the vault.</p>
    ...
  </article>
</section>
```

Keep the public-entry warning visible before shield submission. Do not remove existing action-status handling.

- [ ] **Step 4: Add wizard CSS**

Add:

```css
.deposit-wizard {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.deposit-step {
  min-width: 0;
  padding: 20px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}

.step-kicker {
  color: var(--patina);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}
```

- [ ] **Step 5: Run GREEN tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- DepositPage.test.tsx
```

Expected: all DepositPage tests pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/pages/DepositPage.tsx frontend/src/styles.css frontend/src/test/pages/DepositPage.test.tsx
git commit -m frontend-deposit-wizard-redesign
```

---

### Task 4: Draw User View And Protocol Progress

**Files:**
- Modify: `frontend/src/pages/DrawPage.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/pages/DrawPage.test.tsx`

**Interfaces:**
- Consumes: existing `keeperDecision`, `keeperAction.advanceDraw`, and transaction log state.
- Produces: default user draw status and secondary protocol progress with timeline and manual fallback.

- [ ] **Step 1: Write failing draw hierarchy tests**

Update/add:

```tsx
it("defaults to a user draw status that does not expose fallback controls first", () => {
  render(<DrawPage publicData={publicData("SWEEP_A")} keeperAction={keeperActions()} />);

  expect(screen.getByRole("heading", { name: /draw automation/i })).toBeVisible();
  expect(screen.getByText(/no action is required from depositors/i)).toBeVisible();
  expect(screen.queryByRole("button", { name: /run one fallback step/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /protocol progress/i })).toBeVisible();
});

it("shows fallback controls only in protocol progress mode", async () => {
  const user = userEvent.setup();
  render(<DrawPage publicData={publicData("AWAIT_TOTAL")} keeperAction={keeperActions()} nowMs={1_787_256_624_000} />);

  await user.click(screen.getByRole("button", { name: /protocol progress/i }));

  expect(screen.getByRole("heading", { name: /transaction timeline/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /run one fallback step/i })).toBeVisible();
  expect(screen.getByText(/automation normally runs this/i)).toBeVisible();
});
```

- [ ] **Step 2: Run RED tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- DrawPage.test.tsx
```

Expected: old labels like `Demo progress` or `Keeper panel` fail the new assertions.

- [ ] **Step 3: Update `DrawPage.tsx` labels and sections**

Change mode labels:

- `User view`
- `Protocol progress`

Rename `KeeperPanel` user-visible heading to "Manual fallback". Keep internal component name if it avoids churn. Change
button label to:

```tsx
Run one fallback step: {decision.label}
```

Rename `ExecutionLogPanel` heading to "Transaction timeline".

Keep `advanceDraw(decision.action)` unchanged.

- [ ] **Step 4: Add timeline polish CSS**

Add:

```css
.keeper-status {
  margin: 16px 0;
  padding: 14px;
  background: var(--surface-quiet);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}

.execution-log-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
}
```

- [ ] **Step 5: Run GREEN tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- DrawPage.test.tsx
```

Expected: all DrawPage tests pass.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/pages/DrawPage.tsx frontend/src/styles.css frontend/src/test/pages/DrawPage.test.tsx
git commit -m frontend-draw-automation-redesign
```

---

### Task 5: Result Page Copy And Private-Read Flow

**Files:**
- Modify: `frontend/src/pages/ProofPage.tsx`
- Modify: `frontend/src/styles.css`
- Test: `frontend/src/test/pages/ProofPage.test.tsx`

**Interfaces:**
- Consumes: existing `revealCredit(drawId?)`.
- Produces: "Result" page language without public-claim implication.

- [ ] **Step 1: Write failing result-page tests**

Update `ProofPage.test.tsx`:

```tsx
it("presents the page as a sealed private result check", () => {
  render(<ProofPage revealCredit={vi.fn().mockResolvedValue(0n)} />);

  expect(screen.getByRole("heading", { name: /your result is sealed/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /check private result/i })).toBeVisible();
  expect(screen.getByText(/sign an eip-712 permit/i)).toBeVisible();
  expect(screen.queryByRole("button", { name: /claim prize/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- ProofPage.test.tsx
```

Expected: old `Claim / check prize` label fails.

- [ ] **Step 3: Update `ProofPage.tsx`**

Replace user-visible action labels:

- Heading: "Your result is sealed"
- Button: "Check private result"
- Losing state: "No prize this draw. Principal remains withdrawable."
- Winning next action: "Withdraw"

Keep decryption error handling and `revealCredit` call count unchanged.

- [ ] **Step 4: Run GREEN tests**

Run:

```powershell
cd D:\Lok\frontend
npm test -- ProofPage.test.tsx
```

Expected: all ProofPage tests pass.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/pages/ProofPage.tsx frontend/src/styles.css frontend/src/test/pages/ProofPage.test.tsx
git commit -m frontend-result-page-redesign
```

---

### Task 6: Responsive Visual Polish And Accessibility Gate

**Files:**
- Modify: `frontend/src/styles.css`
- Modify: `frontend/e2e/accessibility.spec.ts` only if text selectors need updating.

**Interfaces:**
- Consumes: all redesigned page markup.
- Produces: stable responsive layout and accessible focus/touch targets.

- [ ] **Step 1: Run full frontend unit suite before CSS polish**

Run:

```powershell
cd D:\Lok\frontend
npm test
```

Expected: pass before CSS-only polish. If any test fails, fix the page task that introduced it before continuing.

- [ ] **Step 2: Apply responsive CSS**

Ensure:

```css
@media (max-width: 1023px) {
  .vault-dashboard,
  .deposit-wizard {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 700px) {
  .vault-hero,
  .vault-dashboard,
  .deposit-wizard {
    grid-template-columns: 1fr;
  }

  .execution-log-list li {
    grid-template-columns: 1fr;
  }
}
```

Review the full file for:

- No text scaling with viewport width.
- No negative letter spacing.
- No horizontal scroll sources.
- `:focus-visible` remains visible.
- `prefers-reduced-motion` block remains present.

- [ ] **Step 3: Run build and e2e accessibility**

Run:

```powershell
cd D:\Lok\frontend
npm run build
npx playwright test
```

Expected: build succeeds and Playwright passes. If Playwright browsers are missing, record the exact missing-browser
message and run `npm test` plus `npm run build` as the local gate.

- [ ] **Step 4: Start local dev server for visual inspection**

Run:

```powershell
cd D:\Lok\frontend
npm run dev -- --host 127.0.0.1
```

Open the shown local URL. Inspect:

- 375px mobile
- 768px tablet
- 1024px desktop
- 1440px desktop

Check: no wallet overflow, no hidden bottom-nav content, no horizontal scroll, all primary actions visible.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/styles.css frontend/e2e/accessibility.spec.ts
git commit -m frontend-responsive-polish
```

If `frontend/e2e/accessibility.spec.ts` was not modified, omit it from `git add`.

---

### Task 7: Final Verification, Push, And Vercel Check

**Files:**
- No source changes expected.
- Modify release notes only if a final evidence note is requested by the owner.

**Interfaces:**
- Consumes: all prior frontend commits.
- Produces: verified and deployed redesigned UI.

- [ ] **Step 1: Run complete local verification**

Run:

```powershell
cd D:\Lok\frontend
npm test
npm run build
npx playwright test
cd D:\Lok
git diff -- docs\10-proof-strategy.md
git diff --check
```

Expected:

- `npm test`: all tests pass.
- `npm run build`: TypeScript, Vite, and build assertion pass.
- `npx playwright test`: e2e passes, or exact browser-environment blocker is recorded.
- `git diff -- docs\10-proof-strategy.md`: empty.
- `git diff --check`: no whitespace errors.

- [ ] **Step 2: Review final diff**

Run:

```powershell
cd D:\Lok
git status --short
git diff --stat HEAD~6..HEAD
```

Expected: only frontend UI/tests/CSS and the spec/plan commits are changed. No Solidity, deployments, artifacts,
proof-strategy, or secrets.

- [ ] **Step 3: Push**

Run:

```powershell
cd D:\Lok
git push origin main
```

Expected: push succeeds.

- [ ] **Step 4: Check GitHub/Vercel**

Check:

- GitHub Actions run for the pushed commit is green.
- Vercel deployment reaches Ready.
- Canonical URL remains `https://lok-protocol.vercel.app`.

- [ ] **Step 5: Live visual smoke**

Open `https://lok-protocol.vercel.app` in Chrome and inspect:

- Vault first viewport.
- Deposit wizard.
- Draw user/protocol mode.
- Result page.
- Wallet chip connected and disconnected states if available.

Do not send live transactions unless the owner separately approves a transaction budget.

- [ ] **Step 6: Final report**

Report:

- Final commit SHA.
- Files changed.
- Verification command results.
- Vercel URL.
- Whether live visual smoke was read-only.
- Any residual UX issue.

