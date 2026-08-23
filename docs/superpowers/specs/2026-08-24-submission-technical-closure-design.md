# Submission Technical Closure And Product-Wide UI/UX Refinement Design

**Status:** Approved in principle by the owner on 2026-08-24; written-spec review pending.  
**Target:** Public GitHub repository and production Vercel deployment on Ethereum Sepolia.  
**Change control:** This design does not edit or unfreeze `docs/10-proof-strategy.md` section 3.

## 1. Objective

Move Lok Protocol from a functionally complete but verification-red submission to one reproducible release in which:

- the required GitHub workflow is green on the exact production commit;
- P-P1 evidence validates from a clean checkout without tests mutating canonical artifacts;
- the independent draw verifier passes against the preserved settled Sepolia demo;
- the production Vercel alias serves the build from that green commit;
- a fresh-wallet live smoke completes faucet, shield, deposit, private reads, draw progression, result check and
  withdrawal; and
- the complete UI is refined into a coherent, responsive, accessible confidential-finance product without changing
  the frozen protocol, contracts or deployment topology.

Video production, X publication and submission eligibility are explicitly excluded from this closure.

## 2. Chosen Approach

Use a minimal technical closure plus a product-wide frontend refinement. Preserve the current contracts, historical
evidence and Sepolia demo deployment. Do not create a fresh deployment or add a hosted keeper unless testing finds a
real requirement that cannot be met by the existing permissionless keeper flow.

Rejected alternatives:

1. **Patch only visible UI defects.** This leaves inconsistent transaction feedback, page hierarchy and mobile
   behavior unresolved.
2. **Full visual redesign.** Replacing Lok's visual identity before submission adds regression risk without improving
   protocol correctness.
3. **Fresh contract deployment.** Current Sepolia bytecode and bindings pass integration checks; redeployment would
   invalidate useful settled-draw evidence.

## 3. Global Constraints

- Ethereum Sepolia (`11155111`) only.
- Do not edit frozen `docs/10-proof-strategy.md` section 3.
- Do not weaken P-P1, omit entry 301 / `FheLe`, normalize protocol logs or change the accepted natural-run criterion.
- Do not modify production Solidity unless a separately reported production defect is demonstrated.
- Do not deploy contracts or send Sepolia transactions before the final owner-authorized live smoke.
- Do not change FHE arithmetic, ACL behavior, public-decryption allowlists, batch caps, timing or adapter rules.
- Do not commit private keys, mnemonics, provider keys, wallet material, `.env` files or ephemeral demo actor keys.
- Canonical evidence may only be generated from a clean worktree and must bind its exact source commit.
- CI and documented local reproduction use Node.js `22.x`.
- Existing React, Vite, wagmi, viem, Zama SDK and Lucide dependencies remain; no new UI framework is introduced.

## 4. Technical Closure Architecture

### 4.1 P-P1 evidence isolation

The current failure mode mixes two responsibilities: tests verify evidence behavior while also rewriting tracked
evidence files. Later tests then see dirty provenance and report a false closure failure.

The revised boundary is:

1. Unit and integration tests write evidence only to per-test temporary directories.
2. `scripts/privacy-scan.ts` validates the committed canonical package read-only by default.
3. A dedicated explicit campaign command is the only path allowed to replace canonical privacy evidence.
4. Canonical generation refuses a dirty worktree, records the exact commit and writes SHA-256 sidecars atomically.
5. Read-only validation verifies the evidence commit, transcript count/source, sidecars, entry 301 retention,
   pre-registered metrics and companion P-P2/P-P5 fragments.

The validator must continue to fail if any accepted artifact is missing, altered, synthetic, forced, generated with
`hardhat_setStorageAt`, below 1,000 natural runs, or statistically outside the frozen criterion.

### 4.2 Draw verifier event retrieval

`verify-draw.ts` must tolerate ordinary Sepolia RPC topic-index behavior without weakening event cardinality:

1. Query the exact indexed topics first.
2. If no indexed result is returned, query `topic0`, ABI-decode the logs and filter the requested `drawId`.
3. Deduplicate by `(transactionHash, logIndex)`.
4. Sort by `(blockNumber, transactionIndex, logIndex)`.
5. Resolve `--latest-settled` from the last unique decoded `DrawSettled` event.
6. After filtering and deduplication, still require exactly one `DrawOpened` and one `DrawSettled` for the selected
   draw.

Missing events, conflicting duplicates, malformed logs and wrong-draw events remain hard failures. The verifier does
not simulate, infer or synthesize an event.

### 4.3 CI responsibilities

The required GitHub workflow runs on Ubuntu with Node.js 22 and performs:

```text
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

Formatting must target maintained source/config files and must not rewrite frozen proof documents or generated
evidence. Solidity coverage is a separate diagnostic workflow because instrumentation changes gas and timing behavior
used by privacy tests; it is not permitted to replace or suppress the required test workflow.

### 4.4 Evidence and release cleanliness

- Revert test-generated artifact churn that is not part of an approved canonical campaign.
- Review every retained diff before staging.
- Require zero frozen-section diff and `git diff --check` success.
- Commit technical closure, UI refinement and release evidence in focused commits.
- Bind the final README, Vercel deployment and smoke record to the same green source commit.

## 5. UI/UX Product Direction

### 5.1 Design principles

Use a restrained Swiss/minimal financial-tool direction: functional grid, clear typography, high contrast, quiet
surfaces and visible proof/state information. Preserve Lok's light canvas, ink, patina green, seal yellow and IBM Plex
identity. Do not adopt the generated dark-slate/gold/purple palette because it conflicts with Lok's established visual
language and reads as a generic crypto dashboard.

The interface must feel like a consumer savings product with inspectable protocol state, not a marketing landing page
or an operator console. Ordinary user actions stay primary; keeper mechanics remain available for demo review but do
not dominate the default experience.

### 5.2 Semantic visual tokens

The frontend consolidates raw colors and spacing into semantic tokens:

| Role | Target |
| --- | --- |
| Canvas | `#F3F4F1` |
| Surface | `#FFFFFF` |
| Primary text | `#171A18` |
| Muted text | `#5F6863` or darker when needed for 4.5:1 contrast |
| Primary action / verified | `#0B7159` |
| Primary hover | `#085B48` |
| Seal accent | `#F0D95A` with dark text only |
| Border | `#D8DDD9` |
| Warning | `#8A5B00` with a separate text/icon label |
| Danger | `#B42318` with a separate text/icon label |
| Focus ring | high-contrast patina/ink, minimum 3 px |

Use IBM Plex Sans for interface text and IBM Plex Mono only for addresses, handles, timestamps and transaction hashes.
Body text is at least 16 px on mobile with line-height 1.5-1.7. Letter spacing remains `0`. Financial figures use
tabular numerals. Cards and framed tools use radius 8 px or less; status pills may remain fully rounded when their
semantics require a badge. Remove decorative gradients, striped overlays, floating blur and nested cards.

### 5.3 Responsive shell and navigation

Desktop (`>=1024px`):

- Keep one persistent sidebar, but make its width and internal grid explicit so wallet controls cannot exceed it.
- Show five labelled primary destinations: Vault, Deposit, Risk, Draw and Proof.
- Place Why Encrypted as secondary navigation.
- Display Sepolia and wallet identity as separate bounded rows.
- Render the address with one-line ellipsis and a fixed disconnect icon; the icon never pushes the control beyond the
  sidebar.

Tablet and mobile (`<1024px`):

- Replace the sidebar with a compact top identity bar and a five-item labelled navigation surface.
- Keep all targets at least 44 x 44 CSS px with at least 8 px between adjacent controls.
- Preserve page access through normal URLs and browser back behavior.
- Use adaptive gutters at 375, 768, 1024 and 1440 px.
- No horizontal page scrolling at 320 px or above; addresses and handles wrap or truncate within their own bounded
  components.

The shell reserves space for fixed navigation, keeps focused controls unobscured and moves focus to `main` after route
changes.

## 6. Page-Level UX Requirements

### 6.1 Vault

- Lead with the user's sealed balance and its reveal action, not protocol exposition.
- Present Deposit and Withdraw as the two primary money actions without nested card composition.
- Show public pool facts in one scannable metric band with stable dimensions while reads are loading.
- Distinguish private values, public aggregates and unavailable data with text plus icon, never color alone.
- Withdrawal exposes amount, Withdraw all and Emergency recovery through progressive disclosure; destructive or
  exceptional recovery is visually separated from routine withdrawal.
- Confirm transaction state inline and retain the submitted transaction link after confirmation.

### 6.2 Deposit

- Default to already-confidential cUSDC.
- Present Private cUSDC and Public USDC as an actual segmented/radio choice with a clear privacy consequence.
- The public path becomes an explicit two-step flow: approve/shield, then deposit. The UI must not imply the shield
  amount is private.
- Keep one primary CTA per step and place validation below the amount field.
- Show disconnected, wrong-network, insufficient public balance, insufficient confidential balance, rejected
  signature, encryption failure and confirmation states with a direct recovery action.
- Keep Get test tokens in a clearly labelled demo band subordinate to the deposit form.

### 6.3 Risk

- Treat the risk dial as an optional extension, not a prerequisite to deposit.
- Use a labelled segmented/radio control for the supported choices; do not rely on a precision drag gesture.
- Explain the selected effect in one short dynamic sentence while keeping theta and odds private.
- Keep reveal-current and save-new actions visually distinct and prevent duplicate submissions.

### 6.4 Draw

- Retain two explicit modes: **User view** and **Demo progress**.
- User view shows only current draw state, whether user action is needed, expected next protocol step and result CTA
  after settlement.
- Demo progress shows the full state rail, bounded sweep progress, public randomness sequencing, keeper action and a
  transaction timeline.
- When automation is active, the manual keeper action becomes a secondary fallback labelled accordingly; it must not
  look like a mandatory user action.
- Every confirmed keeper transaction displays step label, short hash, confirmation state and Etherscan link.
- Long-running aggregate decryption displays an honest asynchronous state and retry path without inventing progress.
- Progress, buttons and loading labels use stable dimensions so state changes do not shift the layout.

### 6.5 Proof / claim

The economic and privacy semantics are explicit:

```text
Settlement credits encrypted winnings automatically.
Claim / check prize privately decrypts the connected wallet's draw credit.
Withdraw transfers principal and credited winnings as confidential cUSDC.
```

- Winner and loser use the same EIP-712 action and relayer-visible UI path.
- A winner sees the decrypted prize, a concise privacy explanation and primary `Withdraw winnings` CTA.
- A loser sees principal-safety confirmation and a secondary `Deposit for next draw` CTA.
- Failure states explain whether the wallet rejected signing, the SDK is unavailable or the decryption network timed
  out, and offer the correct retry.
- Do not add a winner-only contract call, event or telemetry branch.

### 6.6 Why Encrypted

- Keep this as readable product documentation, not a landing-page hero.
- Use constrained line length, section navigation and small diagrams/data blocks only where they explain FHE, Quiet
  Win or public aggregates.
- Ensure links and technical terms are keyboard reachable and readable on mobile.

## 7. Transaction And Async State Model

All state-changing controls use one consistent lifecycle:

```text
idle -> validating -> awaiting-wallet -> encrypting/relaying -> submitted -> confirming -> confirmed
                                                                    \-> failed/retryable
```

Private reads use:

```text
sealed -> awaiting-signature -> decrypting -> revealed
                             \-> declined
                             \-> failed -> retrying
```

Requirements:

- Disable only the action currently in progress, not unrelated withdrawal/recovery actions.
- Show wallet-signature requests before they appear so repeated signatures are understandable.
- Never show success before the receipt or decryption result is verified.
- Error text states cause and recovery; raw RPC errors may appear only behind an expandable technical detail.
- Status updates use one contextual `aria-live` region and never move keyboard focus unexpectedly.

## 8. Accessibility, Motion And Performance

Accessibility acceptance:

- WCAG 2.2 AA contrast: 4.5:1 normal text and 3:1 meaningful control boundaries/icons.
- Complete keyboard operation, logical tab order and visible focus.
- Correct heading hierarchy, labels, fieldsets, `aria-pressed`, `aria-expanded`, `aria-busy` and live regions.
- Color is never the sole status indicator.
- Text remains usable at 200% browser zoom and long addresses cannot overlap controls.
- Route changes focus the main heading; sticky UI cannot obscure focus.

Motion acceptance:

- Only opacity/transform micro-transitions at shared 160/240 ms tokens.
- Motion communicates state change; no decorative entrance choreography.
- `prefers-reduced-motion: reduce` removes non-essential motion and smooth scrolling.
- No animation controls transaction correctness or delays user input.

Performance acceptance:

- Profile before changing rendering behavior.
- Lazy-load route-level page code where it measurably reduces the initial bundle.
- Keep public reads available without eagerly initializing encryption/decryption work that is not yet needed.
- Reserve stable space for asynchronous metrics to keep CLS below 0.1.
- Preserve required FHEVM WASM MIME and cross-origin isolation headers.

## 9. Documentation Alignment

README and deployment documentation must:

- state that the GitHub repository is public;
- identify the production Vercel URL and exact source commit;
- identify the preserved demo manifest and current verified settled draw;
- explain the settlement-credit / private-check / confidential-withdraw claim model;
- distinguish the P-S2 evidence deployment from the seeded live demo deployment; and
- provide one verified command for the public draw verifier.

The footer displays network, FHEVM version, short source commit and links to the live Vault and Draw Manager addresses.

## 10. Verification Matrix

### 10.1 Technical gates

```powershell
npm run lint:sol
npm run lint:ts
npm run compile
npm run build:ts
npm test
npx ts-node scripts/privacy-scan.ts
npx hardhat test test/integration/SepoliaDeployment.t.ts --network sepolia
```

Expected: all required tests pass, privacy status is `PASS`, integration is `3 passing`, no tracked evidence changes
after ordinary tests, and frozen section 3 has zero diff.

Verifier gate:

```powershell
$env:LOK_VERIFY_MANIFEST="deployments/history/sepolia-2026-08-13-120-30-180-600.json"
$env:LOK_VERIFY_LATEST_SETTLED="1"
npx hardhat run scripts/verify-draw.ts --network sepolia
```

Expected: all public transcript checks pass without sending a transaction.

### 10.2 Frontend gates

```powershell
npm --prefix frontend run test
npm --prefix frontend run build
npm --prefix frontend run e2e
```

Required Playwright viewports:

- 375 x 812 mobile portrait;
- 812 x 375 mobile landscape;
- 768 x 1024 tablet;
- 1024 x 768 compact desktop; and
- 1440 x 900 desktop.

Each viewport must prove no horizontal overflow, no wallet/navigation overlap, stable loading geometry and operable
primary actions. Additional runs enable keyboard-only navigation, 200% zoom and reduced motion. Screenshots are
reviewed for Vault, Deposit, Risk, Draw user view, Draw demo progress, Proof winner, Proof loser and representative
error/loading states.

### 10.3 Live smoke

After GitHub is green and Vercel serves the same commit, a fresh Sepolia wallet/profile performs:

```text
connect -> obtain test tokens -> shield -> deposit -> reveal wallet/vault balance
-> open or observe draw -> advance permissionless keeper steps -> check prize -> withdraw
```

Record the source commit, Vercel deployment ID, wallet address, transaction hashes, draw ID, browser/version and result
of each step. The smoke may spend only Sepolia ETH and test assets.

## 11. Execution Order

1. Isolate P-P1 test output from canonical evidence and restore a read-only privacy validation path.
2. Fix and regression-test draw event retrieval, then pass the read-only Sepolia verifier.
3. Finalize the required CI workflow and make the public GitHub commit green.
4. Implement the shared visual tokens, shell, transaction feedback and responsive behavior.
5. Refine Vault, Deposit, Risk, Draw, Proof and Why Encrypted in that order, retaining existing contract interfaces.
6. Run frontend unit, accessibility, viewport and screenshot review gates.
7. Align README/footer/deployment documentation with the release commit and claim semantics.
8. Deploy Vercel from the green commit and run read-only production checks.
9. Obtain owner approval for the final state-changing clean-wallet smoke, execute it and record evidence.

No later step may conceal or bypass a failure from an earlier step.

## 12. Definition Of Done

- Git worktree is clean after the release evidence commit.
- Frozen `docs/10-proof-strategy.md` section 3 has zero diff.
- Root lint, compile, TypeScript build, full tests and privacy scanner pass.
- Frontend unit, production build, E2E, accessibility and responsive screenshot gates pass.
- Sepolia deployment integration is `3 passing`.
- The public draw verifier passes against the preserved settled demo.
- The public GitHub Actions run is green on the release commit.
- Vercel production is `Ready` and bound to that exact commit.
- The fresh-wallet live cycle passes with transaction evidence.
- No production contract, deployment address, FHE/ACL behavior or frozen proposition changed.

