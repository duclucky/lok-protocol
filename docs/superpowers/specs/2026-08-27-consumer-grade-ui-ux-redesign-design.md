# Consumer-Grade UI/UX Redesign

Date: 2026-08-27
Owner approval: Direction B, "Confidential Savings App"
Scope: Frontend presentation and user-flow redesign only.

## 1. Objective

Lok must feel like a usable confidential savings app, not a proof dashboard. The redesigned interface should make the
primary user path obvious within the first viewport:

1. Connect wallet.
2. Get test tokens when needed.
3. Shield to cUSDC.
4. Deposit privately.
5. Watch the draw automation progress.
6. Check a private result.
7. Withdraw principal at any time.

The existing Sepolia contracts, deployment addresses, FHE accounting, decryption flows, and keeper transaction logic
remain unchanged unless a UI integration bug is discovered. This redesign changes how the product is presented and how
users are guided through existing flows.

## 2. Non-Goals

- No Solidity changes.
- No deployment-address changes.
- No new keeper economics or keeper reward contract.
- No change to public/private decryption boundaries.
- No new proof claims.
- No marketing-only landing page.
- No dark-mode-only redesign.
- No decorative animations, gradients, or visual effects that obscure the operational app.

## 3. Product Positioning

The app should present Lok as:

- A no-loss prize savings vault.
- Private by default for balances, deposits inside the pool, odds, and prize credits.
- Publicly inspectable for draw state, timing, aggregate proof steps, deployment addresses, and transaction evidence.
- Automated for draw operations, with manual keeper controls only as fallback.

The first screen must answer three user questions without requiring protocol knowledge:

- What can I do now?
- Is my money recoverable?
- Is the draw running?

## 4. Information Architecture

Keep the existing route set, but change priority and labels:

| Existing route | Redesigned role |
| --- | --- |
| Vault | Home dashboard for balance, prize, automation, and primary actions |
| Deposit | Guided funding wizard |
| Risk | Optional private savings/prize preference |
| Draw | User result view plus protocol progress mode |
| Proof | Private result check |
| Why Encrypted | Plain-language confidentiality explanation |

Navigation labels stay short: Vault, Deposit, Risk, Draw, Result, Privacy.

## 5. Visual Direction

Use a light, premium fintech interface with operational density. The page should feel calm, clear, and financially
serious.

### Tokens

Keep the current token family but tighten usage:

| Role | Usage |
| --- | --- |
| Ink | Text, critical labels, primary contrast |
| Paper | App background |
| Surface | Primary panels |
| Surface quiet | Nested read-only areas |
| Patina | Healthy live state, automation, verified public state |
| Gold | Prize values only |
| Seal | Encrypted/private accents only |
| Danger | Transaction and network errors |

Avoid one-color domination. Patina and seal are accents, not page backgrounds.

### Typography

Continue IBM Plex Sans and IBM Plex Mono. Use:

- `h1`: product or page-level outcome, not protocol state names.
- `h2`: card-level task labels.
- Mono only for addresses, hashes, handles, timers, and fixed figures.
- Tabular numerals for balances, counts, and timestamps.

### Layout

- Desktop: compact sidebar, bounded content width, two-column dashboard where useful.
- Tablet/mobile: top app bar plus bottom navigation, no horizontal scroll.
- Cards use `8px` radius or less.
- No cards inside cards.
- Primary actions must be 44px minimum height.
- Wallet button and address text must never overflow their parent.

## 6. Home / Vault Redesign

The Vault page becomes the product dashboard.

### First Viewport

Top area:

- Title: "Private prize savings on Sepolia"
- Supporting text: "Deposit cUSDC, keep your balance sealed, and stay withdrawable while draws run onchain."
- Primary CTA: "Deposit privately"
- Secondary actions: "Reveal balance", "Withdraw"
- Network/deployment status remains visible but not visually dominant.

Primary cards:

1. Private balance
   - Default sealed state.
   - Explicit reveal button.
   - Shows EIP-712 read explanation near the reveal action, not as generic protocol copy.

2. Current prize
   - Prize value.
   - Participant count.
   - Draw status in plain language.

3. Automation status
   - "Running", "Waiting for draw close", "Settled", or "Needs manual fallback".
   - No keeper jargon in the default state.

4. Principal recovery
   - "Withdraw anytime" affordance.
   - Emergency recovery appears inside secondary disclosure, not as a scary default control.

### Lower Dashboard

- Risk setting summary.
- Latest draw row.
- Deployment links.
- Privacy boundary summary: what is sealed and what is public.

## 7. Deposit Wizard

Deposit should be a guided three-step surface instead of a generic form.

Step 1: Test tokens

- Shows mock USDC balance if available.
- CTA: "Mint test USDC" when empty.
- Copy explains this is Sepolia test money.

Step 2: Shield

- CTA: "Shield to cUSDC".
- Copy must state that shielding a public token exposes the shielded amount, while the later Lok deposit is private.
- Show wallet-sign reason before triggering the transaction.

Step 3: Private deposit

- Amount field remains controlled.
- CTA: "Deposit privately".
- Copy explains this moves encrypted cUSDC into Lok.
- After confirmation, show next recommended action: "View draw" or "Reveal balance".

Each step must show:

- Current status.
- Why a wallet signature is needed.
- Transaction confirmation hash when available.
- Actionable error near the failed step.

## 8. Draw Page Redesign

The Draw page uses two explicit modes.

### User View

Default mode for judges and ordinary users.

It shows:

- Current draw status in plain language.
- Whether the user needs to do anything.
- Countdown or "automation is processing".
- Primary action after settlement: "Check private result".
- Secondary link: "View protocol progress".

It must not ask the user to operate the draw by default.

### Protocol Progress Mode

This mode makes the FHE state machine inspectable.

It shows:

- State rail: IDLE, OPEN, SWEEP_A, AWAIT_TOTAL, REVEAL, RANDOM_SET, SWEEP_B, SETTLED.
- Sweep progress: cursor / participant count.
- Transaction timeline:
  - Pre-sync
  - PASS A batches
  - Aggregate public decrypt
  - Submit totals
  - Open random
  - PASS B batches
  - Settled
- Explorer links for browser-confirmed transactions.
- Clear statement that automation may advance transactions not initiated by this browser.
- Manual fallback button only when action is currently enabled.

Manual fallback button styling:

- Secondary, not primary.
- Label: "Run one fallback step".
- Status text explains "Draw automation normally runs this. Use fallback only if it stalls."

## 9. Proof / Result Page

The Proof page becomes "Result".

Default:

- "Your result is sealed."
- Button: "Check private result".
- Copy explains EIP-712 user decryption and that every participant checks through the same path.

After decrypt:

- Losing state: "No prize this draw. Principal remains withdrawable."
- Winning state: prize amount with gold figure, then "Withdraw" as next action.

Do not imply a public claim transaction exists. Settlement already credited encrypted prize-or-zero uniformly.

## 10. Wallet And Signing UX

Every wallet-triggering action should have a short reason visible before the click:

| Action | Reason copy |
| --- | --- |
| Connect | "Connect a Sepolia wallet to use the live vault." |
| Mint | "Mint Sepolia test USDC to fund the demo." |
| Shield | "Convert public test USDC into confidential cUSDC." |
| Approve operator | "Allow Lok to move the encrypted deposit amount you submit." |
| Deposit | "Send encrypted cUSDC into the vault." |
| Reveal | "Sign an EIP-712 permit so this device can decrypt your value." |
| Withdraw | "Move encrypted cUSDC back to your wallet." |
| Draw fallback | "Advance one permissionless draw step if automation stalls." |

The wallet chip must:

- Fit inside sidebar and topbar.
- Use ellipsis for address.
- Keep disconnect as a separate 44px icon button.
- Preserve visible focus and accessible labels.

## 11. Component Changes

Expected frontend component updates:

- `AppShell`: stronger app frame, improved wallet placement, route label update from Proof to Result.
- `VaultPage`: new dashboard composition and primary task hierarchy.
- `DepositPage`: wizard-style step layout.
- `DrawPage`: user/protocol mode hierarchy, automation status, tx timeline visual polish.
- `ProofPage`: result-oriented language and layout.
- `WalletButton`: overflow-safe layout verification.
- `styles.css`: token cleanup, dashboard surfaces, responsive fixes.

Shared components should be added only when they remove repeated UI state or copy.

## 12. Accessibility And Responsive Requirements

- Body text contrast must meet WCAG AA.
- Interactive controls must be keyboard reachable and visibly focused.
- Icon-only controls need accessible names.
- Buttons and critical touch targets must be at least 44px high.
- The app must work at 375px, 768px, 1024px, and 1440px widths.
- No horizontal overflow on small screens.
- Reduced motion must be respected.
- Loading and transaction states must use stable layout and `role="status"` where relevant.

## 13. Testing Strategy

Because this is a UI/UX redesign over existing behavior, tests should verify observable behavior and accessibility rather
than visual details alone.

Required updates:

- Component tests for revised labels and action hierarchy.
- Draw page tests for default user view and protocol progress mode.
- Deposit page tests for wizard step copy and wallet-sign reasons.
- Wallet button tests for connected layout labels and disconnect accessibility.
- Existing e2e accessibility test must remain green.

Verification commands:

```powershell
cd D:\Lok\frontend
npm test
npm run build
npx playwright test
git diff -- docs/10-proof-strategy.md
git diff --check
```

If Playwright cannot run because browsers are missing in the local environment, run the component/build checks and report
the Playwright blocker explicitly.

## 14. Release Plan

1. Implement UI changes locally.
2. Run tests and build.
3. Start the Vite dev server and visually inspect desktop and mobile breakpoints.
4. Commit focused frontend changes.
5. Push to GitHub.
6. Let Vercel deploy from GitHub.
7. Check the live URL in Chrome for layout, wallet chip, deposit flow entry, draw page, and result page.

## 15. Acceptance Criteria

The redesign is acceptable when:

- The first screen presents Lok as a usable savings app.
- A judge can identify Deposit, Reveal balance, Draw status, Check result, and Withdraw without protocol explanation.
- Keeper controls are no longer the primary CTA in normal draw viewing.
- The draw progress mode still exposes the protocol evidence path.
- Wallet and network controls do not overflow on desktop or mobile.
- Existing live Sepolia integration paths are not removed.
- Frontend tests/build pass, or any environment-specific blocker is documented with exact command output.

