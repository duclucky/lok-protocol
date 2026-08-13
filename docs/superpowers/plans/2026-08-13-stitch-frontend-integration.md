# Stitch Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Stitch-derived dark interface on top of Lok's real Sepolia and Zama SDK integration without fabricated values, fake success states, or contract changes.

**Architecture:** Preserve the existing Vite provider stack and route tree. Extend the current typed read/decrypt boundaries for public wallet balance, wallet cUSDC, theta, and encrypted action status; keep pages presentational and feed them only typed hook outputs. Port the visual language through one self-hosted token system and responsive shell rather than importing generated HTML.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Tailwind 4 entry CSS plus semantic CSS classes, wagmi 3, viem 2, `@zama-fhe/react-sdk` 3.4, Vitest, Testing Library, Playwright.

## Global Constraints

- Do not modify Solidity, deployment contracts, `docs/10-proof-strategy.md` section 3, proof artifacts, or Sepolia state.
- Do not import Stitch HTML, executable CDNs, Google Fonts, Material Symbols, or a second icon family.
- Keep routes `/`, `/deposit`, `/risk`, `/draw`, `/proof`, and `/why-encrypted` unchanged.
- Theme is dark only; design dials are variance 5, motion 3, density 6.
- Use one mint accent for actions and verified state; reserve gold for genuine prize values.
- Never auto-request a permit or auto-decrypt on render.
- Never display numeric aggregate assets, liabilities, principal, backing ratio, individual odds, or invented protocol data.
- One identical `Check my result` action and decrypt request shape serves winners and losers.
- Draw verification and proof publication remain unsupported and must not simulate success.
- Every behavior change follows a witnessed RED, minimal GREEN, refactor cycle.

---

## File Structure

- `frontend/src/fhe/useLokPrivateValues.ts`: explicit private-value readers for vault balance, wallet cUSDC, theta, action status, and draw credit.
- `frontend/src/features/wallet/model.ts`: typed public wallet-balance state and formatting helpers.
- `frontend/src/features/wallet/useLokWalletData.ts`: public underlying-USDC read only.
- `frontend/src/components/ActionStatus.tsx`: permit-gated reveal of encrypted deposit/withdraw outcome.
- `frontend/src/components/AppShell.tsx`: desktop top navigation, mobile bottom navigation, verified footer.
- `frontend/src/pages/*.tsx`: route presentation and local interaction state only.
- `frontend/src/styles.css`: approved dark tokens, components, responsive behavior, reduced motion.
- `frontend/src/test/**`: component and model behavior.
- `frontend/e2e/product-flow.spec.ts`: production-shaped browser assertions without fake draw controls or assumed winners.
- `docs/06-frontend-spec.md`: visual-direction update only; behavioral requirements stay intact.

---

### Task 1: Truthful Result and Draw Boundaries

**Files:**
- Modify: `frontend/src/test/pages/DrawPage.test.tsx`
- Modify: `frontend/src/test/pages/ProofPage.test.tsx`
- Modify: `frontend/src/pages/DrawPage.tsx`
- Modify: `frontend/src/pages/ProofPage.tsx`

**Interfaces:**
- Consumes: existing `LokPublicData` and `revealCredit(): Promise<bigint>`.
- Produces: draw UI with no local verification success; result UI with no local publication success.

- [ ] **Step 1: Write failing assertions for unsupported operations**

Add assertions that settled Draw renders `Use the external verifier` and has no button named `Verify this draw`; add a winner assertion that the page contains `Public proof publication is not available in this build` and no `Publish proof` button.

- [ ] **Step 2: Run focused tests and witness RED**

Run: `npm test -- src/test/pages/DrawPage.test.tsx src/test/pages/ProofPage.test.tsx`

Expected: FAIL because both simulated buttons still exist.

- [ ] **Step 3: Remove simulated success state**

Delete `verified`, `published`, and their setters. Render a non-button external-verifier note on settled draws and an informational winner-only notice after a nonzero private reveal.

- [ ] **Step 4: Run focused tests and witness GREEN**

Run: `npm test -- src/test/pages/DrawPage.test.tsx src/test/pages/ProofPage.test.tsx`

Expected: both files pass.

- [ ] **Step 5: Commit checkpoint**

Run: `git add frontend/src/pages/DrawPage.tsx frontend/src/pages/ProofPage.tsx frontend/src/test/pages/DrawPage.test.tsx frontend/src/test/pages/ProofPage.test.tsx && git commit -m "fix(frontend): remove simulated proof success"`

---

### Task 2: Private Reads and Wallet Data

**Files:**
- Create: `frontend/src/features/wallet/model.ts`
- Create: `frontend/src/features/wallet/useLokWalletData.ts`
- Create: `frontend/src/test/features/wallet.test.ts`
- Modify: `frontend/src/fhe/useLokPrivateValues.ts`
- Modify: `frontend/src/test/fhe/contracts.test.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces `WalletPublicData = { status: "disconnected" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; publicUsdc: string }`.
- Extends `useLokPrivateValues` with `revealWalletCusdc(): Promise<string>`, `revealTheta(): Promise<number>`, and `revealActionStatus(): Promise<boolean>`.

- [ ] **Step 1: Write failing model and page-contract tests**

Test `formatPublicUsdc(12_345_678n) === "12.34 USDC"`, error/disconnected state mapping, theta values `0n..4n` mapping to `0..100`, boolean action-status decoding, and the ABI presence of `thetaOf` and `lastActionStatus`.

- [ ] **Step 2: Run focused tests and witness RED**

Run: `npm test -- src/test/features/wallet.test.ts src/test/fhe/contracts.test.ts`

Expected: FAIL because the wallet model does not exist and the new private API is absent.

- [ ] **Step 3: Implement public wallet data**

Use `useAccount()` and `useReadContract({ address: underlyingToken, abi: mockUsdcAbi, functionName: "balanceOf", args: [address] })`. Do not read while disconnected. Convert the bigint using the existing six-decimal USDC convention.

- [ ] **Step 4: Extend explicit private readers**

Read `confidentialToken.confidentialBalanceOf(account)`, `vault.thetaOf(account)`, and `vault.lastActionStatus(account)`. Create disabled `useDecryptValues` queries for each handle. Reuse the explicit permit gate, include only the producing contract needed for the requested handle, and convert clear values without comparing ciphertext bytes except the documented zero-handle sentinel.

- [ ] **Step 5: Run focused tests and witness GREEN**

Run: `npm test -- src/test/features/wallet.test.ts src/test/fhe/contracts.test.ts src/test/fhe/permit.test.ts`

Expected: all focused tests pass without a decrypt-on-render call.

- [ ] **Step 6: Commit checkpoint**

Run: `git add frontend/src/features/wallet frontend/src/fhe/useLokPrivateValues.ts frontend/src/test/features/wallet.test.ts frontend/src/test/fhe/contracts.test.ts frontend/src/App.tsx && git commit -m "feat(frontend): add explicit wallet private reads"`

---

### Task 3: Encrypted Action Status

**Files:**
- Modify: `frontend/src/components/ActionStatus.tsx`
- Modify: `frontend/src/test/pages/ActionStatus.test.tsx`
- Modify: `frontend/src/pages/VaultPage.tsx`
- Modify: `frontend/src/pages/DepositPage.tsx`

**Interfaces:**
- `ActionStatusProps = { action: "DEPOSIT" | "WITHDRAW"; reveal: () => Promise<boolean> }`.
- Pages receive `revealActionStatus?: () => Promise<boolean>` and render status only after a real confirmed deposit or withdrawal receipt.

- [ ] **Step 1: Write failing interaction tests**

Assert that receipt confirmation says `Transaction confirmed. Reveal the encrypted result.` rather than `Deposited` or `Withdrew`; clicking the reveal control maps true to `Deposited.` or `Withdrew.` and false to the frozen clamped/no-op message.

- [ ] **Step 2: Run focused tests and witness RED**

Run: `npm test -- src/test/pages/ActionStatus.test.tsx src/test/pages/VaultPage.test.tsx src/test/pages/DepositPage.test.tsx`

Expected: FAIL because `ActionStatus` accepts a plaintext `succeeded` prop and pages do not mount it.

- [ ] **Step 3: Implement the explicit result reveal**

Wrap `reveal()` in `SealedValue`; after reveal call `decodeVaultActionStatus(action, boolean).message`. Reset the confirmed-action state when a new transaction begins or the funding path changes.

- [ ] **Step 4: Run focused tests and witness GREEN**

Run: `npm test -- src/test/pages/ActionStatus.test.tsx src/test/pages/VaultPage.test.tsx src/test/pages/DepositPage.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 5: Commit checkpoint**

Run: `git add frontend/src/components/ActionStatus.tsx frontend/src/pages/VaultPage.tsx frontend/src/pages/DepositPage.tsx frontend/src/test/pages && git commit -m "feat(frontend): surface encrypted action outcomes"`

---

### Task 4: Stitch-Derived Application Shell

**Files:**
- Modify: `frontend/src/components/AppShell.tsx`
- Modify: `frontend/src/components/WalletButton.tsx`
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/test/pages/AppShell.test.tsx`

**Interfaces:**
- Preserves the six route URLs and existing `WalletButton` provider boundary.
- Produces one desktop top nav, one mobile bottom nav, `Why encrypted?`, and verified footer links.

- [ ] **Step 1: Write failing shell tests**

Render `AppShell` under `MemoryRouter` with a child route. Assert five primary links, a separate Why Encrypted link, Sepolia text, Vault and Draw explorer URLs, no language button, and no sidebar landmark.

- [ ] **Step 2: Run focused test and witness RED**

Run: `npm test -- src/test/pages/AppShell.test.tsx`

Expected: FAIL because the current desktop shell is a sidebar.

- [ ] **Step 3: Implement shell markup and base tokens**

Replace the fixed sidebar with a 64-72px top header. Keep semantic `NavLink`, visible focus, skip link, and mobile bottom nav. Define the Stitch-derived dark canvas, tonal surfaces, mint accent, off-white text, muted sage, hairline border, gold prize token, 4px controls, and 8px panels in `:root`.

- [ ] **Step 4: Run focused tests and witness GREEN**

Run: `npm test -- src/test/pages/AppShell.test.tsx src/test/pages/VaultPage.test.tsx`

Expected: shell and existing vault semantics pass.

- [ ] **Step 5: Commit checkpoint**

Run: `git add frontend/src/components/AppShell.tsx frontend/src/components/WalletButton.tsx frontend/src/styles.css frontend/src/test/pages/AppShell.test.tsx && git commit -m "feat(frontend): add sealed instrument shell"`

---

### Task 5: Vault, Deposit, and Risk Screens

**Files:**
- Modify: `frontend/src/pages/VaultPage.tsx`
- Modify: `frontend/src/pages/DepositPage.tsx`
- Modify: `frontend/src/pages/RiskPage.tsx`
- Modify: `frontend/src/components/SealedValue.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/test/pages/VaultPage.test.tsx`
- Modify: `frontend/src/test/pages/DepositPage.test.tsx`
- Modify: `frontend/src/test/pages/RiskPage.test.tsx`

**Interfaces:**
- Deposit receives `walletData`, `revealWalletCusdc`, and `revealActionStatus`.
- Risk receives `revealTheta` separately from the selected target risk.
- Vault receives `revealBalance`, `revealActionStatus`, and real `LokPublicData`.

- [ ] **Step 1: Write failing truthful-data tests**

Assert that no route contains `LTV`, `liquidation`, `slashing`, `multiplier`, `insurance`, hard-coded fee, or fabricated history. Assert public USDC renders from props, cUSDC remains sealed, saved theta remains sealed, target theta defaults to 100%, and theta reveal converts `2` to `50%`.

- [ ] **Step 2: Run focused tests and witness RED**

Run: `npm test -- src/test/pages/VaultPage.test.tsx src/test/pages/DepositPage.test.tsx src/test/pages/RiskPage.test.tsx`

Expected: FAIL on new wallet-data, theta-reveal, and truthful-layout assertions.

- [ ] **Step 3: Port semantic page structure**

Use the approved panels, slash-pattern sealed field, compact metric strip, segmented risk control, visible labels, real empty/error states, and no invented fields. Keep public USDC immediate and wallet cUSDC explicit-reveal only.

- [ ] **Step 4: Apply responsive and interaction CSS**

Use single-column collapse below 768px, 44px targets, tabular numbers, clear focus rings, active press feedback, and no animation beyond reveal opacity/translation. Do not hide explanatory privacy copy on mobile.

- [ ] **Step 5: Run focused tests and witness GREEN**

Run: `npm test -- src/test/pages/VaultPage.test.tsx src/test/pages/DepositPage.test.tsx src/test/pages/RiskPage.test.tsx src/test/fhe/decryption-machine.test.ts`

Expected: all focused tests pass.

- [ ] **Step 6: Commit checkpoint**

Run: `git add frontend/src/pages/VaultPage.tsx frontend/src/pages/DepositPage.tsx frontend/src/pages/RiskPage.tsx frontend/src/components/SealedValue.tsx frontend/src/styles.css frontend/src/test/pages && git commit -m "feat(frontend): port core savings screens"`

---

### Task 6: Draw, Private Result, and Privacy Boundary Screens

**Files:**
- Modify: `frontend/src/pages/DrawPage.tsx`
- Modify: `frontend/src/pages/ProofPage.tsx`
- Modify: `frontend/src/pages/WhyEncryptedPage.tsx`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/test/pages/DrawPage.test.tsx`
- Modify: `frontend/src/test/pages/ProofPage.test.tsx`
- Create: `frontend/src/test/pages/WhyEncryptedPage.test.tsx`

**Interfaces:**
- Consumes only `LokPublicData` and the existing outcome-independent `revealCredit`.
- Produces no keeper, publication, public-decrypt, or verifier mutation.

- [ ] **Step 1: Write failing false-claim tests**

Assert absence of `ZK`, `VRF`, `enclave`, `eligible volume`, `capacity utilization`, `must publish`, root hash, verifier address, and execution log. Assert the accurate FHEVM boundary, public membership limitation, shielding disclosure, and external verifier status.

- [ ] **Step 2: Run focused tests and witness RED**

Run: `npm test -- src/test/pages/DrawPage.test.tsx src/test/pages/ProofPage.test.tsx src/test/pages/WhyEncryptedPage.test.tsx`

Expected: FAIL until the new privacy-boundary test and screen copy are implemented.

- [ ] **Step 3: Port truthful layouts**

Retain the Stitch state rail and dense settlement panels, but populate only live state, cursors, snapshot, deadlines, stored totals, and opaque handles. Use the same pre-decrypt result card for all users. Rewrite Why Encrypted from the documented FHEVM disclosure table.

- [ ] **Step 4: Run focused tests and witness GREEN**

Run: `npm test -- src/test/pages/DrawPage.test.tsx src/test/pages/ProofPage.test.tsx src/test/pages/WhyEncryptedPage.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 5: Commit checkpoint**

Run: `git add frontend/src/pages/DrawPage.tsx frontend/src/pages/ProofPage.tsx frontend/src/pages/WhyEncryptedPage.tsx frontend/src/styles.css frontend/src/test/pages && git commit -m "feat(frontend): port truthful draw and privacy views"`

---

### Task 7: Browser Tests and Frontend Documentation

**Files:**
- Modify: `frontend/e2e/product-flow.spec.ts`
- Modify: `docs/06-frontend-spec.md`

**Interfaces:**
- Browser tests exercise production-shaped routes without a fake draw-state selector or forced winning result.
- Documentation changes only section 7 visual direction and records the approved dark token system.

- [ ] **Step 1: Replace stale E2E assertions**

Remove the nonexistent draw-state combobox loop and the assumption that clicking `Check my result` produces a winner. Assert the live draw page exposes no production state selector, result check begins neutral, unsupported publication is not presented as completed, and every route fits 360, 768, 1024, and 1440 widths.

- [ ] **Step 2: Run E2E and witness any remaining RED**

Run: `npm run e2e`

Expected before final CSS fixes: at least one screenshot, overflow, copy, or stale-selector assertion fails for the intended changed behavior.

- [ ] **Step 3: Fix only browser-observed integration issues**

Adjust responsive CSS, accessible labels, or deterministic E2E fixtures without adding production-only demo controls or suppressing console errors.

- [ ] **Step 4: Update visual direction documentation**

Replace only the earlier light palette and layout description with the owner-approved dark green-black, mint, IBM Plex Sans, mono, hairline, tonal-layer, bottom-navigation, sealed slash-pattern direction. Preserve all behavioral and privacy requirements.

- [ ] **Step 5: Run browser tests and witness GREEN**

Run: `npm run e2e`

Expected: all configured projects pass with no horizontal overflow or runtime error.

- [ ] **Step 6: Commit checkpoint**

Run: `git add frontend/e2e/product-flow.spec.ts docs/06-frontend-spec.md frontend/src/styles.css && git commit -m "test(frontend): align browser coverage with production UI"`

---

### Task 8: Full Verification and Final Review

**Files:**
- Review all files changed by Tasks 1-7.

**Interfaces:**
- Produces fresh verification evidence and a clean scoped diff.

- [ ] **Step 1: Run complete unit suite**

Run: `npm test`

Expected: zero failed Vitest files and tests.

- [ ] **Step 2: Run production build and WASM assertion**

Run: `npm run build` followed from repository root by `node scripts/assert-wasm.mjs frontend/dist`.

Expected: both exit 0 and every required FHEVM worker/WASM asset is present.

- [ ] **Step 3: Run complete Playwright suite**

Run: `npm run e2e`

Expected: zero failed browser tests in every viewport project.

- [ ] **Step 4: Run privacy and copy gates**

Run from repository root: `npx ts-node scripts/privacy-scan.ts` and `rg -n -i "lottery|gambling|casino|wager|slashing|liquidation|zk-snark|zero-knowledge enclave|proof published|verification requested" frontend/src docs/06-frontend-spec.md`.

Expected: privacy scan retains its documented P-P1 residual but reports no new frontend/ACL/public-decryption violation; copy scan returns no forbidden shipped claim.

- [ ] **Step 5: Review diff and repository state**

Run: `git diff HEAD~8 --check`, `git status --short`, and inspect every changed file. Confirm no `.env`, secret, generated `dist`, `test-results`, Stitch HTML, contract, frozen proposition, or artifact file was committed.

- [ ] **Step 6: Record final checkpoint commit if verification required a fix**

If and only if verification required a scoped correction, stage only that correction and run `git commit -m "fix(frontend): close integration verification gaps"` after repeating its failing gate.
