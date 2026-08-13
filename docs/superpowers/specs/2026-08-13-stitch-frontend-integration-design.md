# Lok Stitch Frontend Integration Design

**Date:** 2026-08-13

**Status:** APPROVED APPROACH, PENDING SPEC REVIEW
**Approved direction:** Safe production integration (Approach A)

## 1. Objective

Replace the current Lok presentation layer with the approved Stitch visual direction while preserving and strengthening the existing React, wagmi, viem, and Zama SDK integration. The result must display only values and states supported by the deployed contracts or by an explicit wallet decryption. It must never simulate a successful verification, proof publication, transaction, or private read.

This is a frontend integration project. It does not authorize a Solidity change, a new backend service, a change to the frozen proposition list in `docs/10-proof-strategy.md` section 3, or a claim that an unsupported protocol feature has been completed.

## 2. Source of truth and conflict resolution

Implementation decisions use the following precedence:

1. Frozen propositions and protocol invariants in `CLAUDE.md` and `docs/10-proof-strategy.md`.
2. Privacy and trust boundaries in `docs/08-threat-model.md`.
3. Contract behavior and verified API surfaces.
4. Product flows and state requirements in `docs/06-frontend-spec.md`.
5. Existing frontend tests, after removing stale or false expectations.
6. Stitch screenshots and HTML as a visual reference only.

The owner-approved dark Stitch direction supersedes the earlier light visual tokens in `docs/06-frontend-spec.md` section 7. It does not supersede that document's product behavior, privacy copy, async-decryption rules, silent-failure handling, or demo requirements. The implementation must update the visual-direction subsection so repository documentation and the shipped interface do not contradict each other.

## 3. Audit findings that constrain the integration

The Stitch package is not production code. Its pages are standalone HTML documents that use Tailwind and font CDNs, `href="#"`, inline scripts, hard-coded figures, and no contract integration. It will not be copied into the application tree.

The following Stitch content is explicitly rejected:

- Vault health factor, liquidation threshold, LTV, protocol insurance, ZK-SNARK labels, fabricated activity, fabricated draw history, and fabricated account values.
- Risk descriptions involving principal exposure, slashing, draw multipliers, or a 24-hour user timelock.
- Draw protocol versions, sequence identifiers, handles, blocks, timestamps, eligible volume, excluded dust, capacity utilization, and execution logs that do not come from live reads.
- Proof root hashes, verifier addresses, timestamps, or statements that publication is required to claim a prize.
- Descriptions of Lok as a zero-knowledge enclave, VRF system, or client-side cryptographic proof system.
- Any hard-coded wallet balance, network fee, participant count, prize amount, result, or transaction hash presented as real.

The following Stitch qualities are retained:

- Dark green-black canvas with restrained mint used for primary actions and verified states.
- IBM Plex Sans for interface copy and one monospaced family for figures, addresses, handles, and protocol state.
- Hairline borders, tonal elevation, minimal shadows, small consistent radii, compact financial density, and tabular figures.
- Desktop top navigation and mobile bottom navigation.
- Slash-pattern sealed values and clear separation between public state and private state.
- Subtle state-transition motion only, with reduced-motion support.

## 4. Design read and system locks

**Design Read:** A redesign-overhaul of a confidential financial application for depositors and technical reviewers, using a quiet secure-instrument language while preserving the existing product information architecture.

- `DESIGN_VARIANCE: 5`
- `MOTION_INTENSITY: 3`
- `VISUAL_DENSITY: 6`
- Theme lock: dark only for this approved redesign.
- Accent lock: one mint accent for primary actions and verified states. Gold remains reserved for genuine prize values only if retained.
- Shape lock: 4px controls and 8px major panels, with pills only for compact status badges.
- Motion lock: opacity and transform feedback only. No perpetual decoration, scroll hijacking, glow, or animated background.
- Typography lock: self-hosted fonts only. No Google Fonts or Material Symbols CDN.
- Icon lock: retain the single icon family already installed in the application. No hand-drawn SVG paths and no second icon family.

The target is an application interface, not a marketing landing page. Dense protocol state may use panels and data rows when they communicate real hierarchy. Decorative cards and invented instrumentation are forbidden.

## 5. Application architecture

The existing route structure remains stable:

- `/` - Vault
- `/deposit` - Deposit
- `/risk` - Risk Dial
- `/draw` - Draw
- `/proof` - Private result and proof availability
- `/why-encrypted` - Privacy boundary

The existing provider and data boundaries remain in place:

```text
WagmiProvider
  -> QueryClientProvider
    -> ZamaProvider
      -> public contract reads
      -> wallet transaction actions
      -> explicit permit-gated private reads
      -> route presentation components
```

Visual components must consume typed page models or the existing hook results. They must not call contracts from decorative child components, infer private results from handles, or embed deployment values copied from Stitch.

The frontend remains a static Vite application. No new server, database, keeper key, relayer key, or API route is introduced by this work.

## 6. Backend capability matrix

### Supported and required to remain functional

- Wallet connect, disconnect, account display, and wrong-network feedback.
- Sepolia public reads for participant count, risk epoch, solvency status, funded yield, draw state, cursors, snapshot size, deadlines, aggregate draw totals, and stored random handle.
- Confidential deposit after operator approval.
- Public USDC shielding with the mandatory disclosure that the shield amount is visible.
- Mock-USDC mint as a separately labelled demo transaction.
- Confidential partial withdrawal.
- Encrypted risk-setting update.
- Permit-gated user balance decryption.
- Permit-gated draw credit decryption through one identical action for winners and losers.
- Verified deployment links and source-controlled protocol metadata in the footer.

### Existing capabilities to connect during this integration

- Public underlying-token balance.
- Confidential wallet cUSDC balance, shown sealed until an explicit reveal.
- Current encrypted theta handle, revealed only after an explicit user action.
- `lastActionStatus` after deposit or withdrawal so confirmed transactions distinguish `OK` from `CLAMPED_OR_NO_OP` without inventing a more specific cause.

These additions must use verified installed SDK hooks or the established custom-contract decrypt flow. Input ciphertexts must target the exact consuming contract. Decryption must remain disabled until the user explicitly requests it and a permit is present.

### Unsupported and therefore never simulated

- In-browser draw verification equivalent to `scripts/verify-draw.ts`.
- Public publication of a winner's credit as an independently verifiable proof.
- Browser orchestration of a complete draw or keeper workflow.

For this phase, unsupported actions are either omitted or rendered as clearly unavailable informational affordances. A button must not report success unless a real operation returned evidence of success. Completing any of these features requires a separate design and proof-boundary review.

## 7. Screen specifications

### 7.1 App shell

- Desktop uses a single-line top navigation no taller than 72px.
- Mobile uses the Stitch-inspired bottom navigation with five primary routes and safe-area padding.
- `Why encrypted?` remains reachable without displacing a primary product route.
- The wallet control shows disconnected, connecting, connected, wrong-network, and failure states.
- Footer metadata comes from verified source-controlled values and links to the deployed Vault and DrawManager contracts.
- No nonfunctional language selector is rendered.

### 7.2 Vault

The Vault page shows:

- A sealed balance panel with explicit reveal, decrypting, revealed, failed, retry, hide, and 60-second auto-hide states.
- Real public prize or funded-yield label, next-draw timing, participant count, and solvency checkpoint state.
- Real Deposit and Withdraw actions.
- A sealed Risk Dial summary linking to `/risk`.
- Only draw history actually available from the current read model. It must not fabricate prior draws, winner status, transaction hashes, or activity.

The page must not display a backing ratio, numeric assets, liabilities, principal, LTV, liquidation data, or insurance claims.

### 7.3 Deposit

- Private cUSDC is the default path and is labelled `Fully private`.
- Public USDC is a distinct path and displays the exact public-entry disclosure before submission.
- The two paths never submit in one hidden combined transaction. Mint, shield, and deposit remain explicit wallet actions.
- Available public USDC may render immediately after a public read.
- Available cUSDC remains sealed and requires explicit reveal.
- Pending, wallet rejection, receipt failure, confirmed, `OK`, and `CLAMPED_OR_NO_OP` states are visible and truthful.
- The test-token action remains inside a clearly labelled Demo Control region.

No estimated gas fee is displayed unless it is obtained from a real estimate for the exact prepared transaction.

### 7.4 Risk Dial

- The selection options remain exactly 0%, 25%, 50%, 75%, and 100%.
- The proposed selection defaults to 100%, without claiming that 100% is the user's current saved setting.
- The saved setting is sealed until explicitly revealed from `thetaOf(user)`.
- Copy uses the five frozen product meanings: yield split between steady accrual and prize participation.
- The page repeats that the setting is private and does not show estimated odds.
- Saving encrypts the selected theta for LokVault and waits for a successful Sepolia receipt.

The page must not mention principal loss, slashing, leverage, exposure multipliers, liquidation, or a user timelock.

### 7.5 Draw

- Render all eight modeled states from live public data with the existing plain-language descriptions.
- Render the applicable `preSyncCursor` or sweep cursor against the participant snapshot.
- Render only stored deadlines, mode, aggregates, and handles already exposed by the contract.
- A stored ciphertext handle is labelled opaque and unreadable. Its bytes are never interpreted as a value.
- Settled output shows stored public totals. A public value that still needs external decryption is labelled pending or links to the verified CLI workflow.
- The visual execution log is omitted because no trustworthy log model currently feeds it.
- `Verify this draw` cannot become a success state in this phase. If shown, it links to or explains the external verifier and is not an action simulation.

### 7.6 Private result and proof

- Every participant sees the same `Check my result` action before decryption.
- One credit handle is read and one outcome-independent decrypt request is made.
- Zero displays `No prize this draw`; nonzero displays the cUSDC credit.
- Permit, decrypting, failure, retry, and disconnected states are explicit.
- Winner-only UI is rendered only after a nonzero private reveal and does not create different on-chain or relayer request paths before that reveal.
- Public proof publication is described as unavailable in this build or omitted. No local state may change the label to `Proof published`.

### 7.7 Why encrypted

- Describe FHEVM, not a ZK enclave or VRF system.
- Public column includes only documented public facts: membership and participant count, prize amount, allowed completed aggregates, post-settlement randomness, and the checkpoint solvency boolean.
- Sealed column includes balances, confidential deposit and withdrawal amounts, theta, individual weights and odds, Fortune, prize credits, and numeric accounting aggregates.
- State clearly that membership and transaction timing are public, and that shielding or exiting exposes a public amount.
- Preserve the residual aggregate-Fortune disclosure and minimum-participant context.

## 8. State and error model

Every network-backed surface must represent these states where applicable:

- Disconnected wallet.
- Wrong network.
- Public read loading.
- Public read unavailable.
- Empty or not-yet-created protocol state.
- Private value sealed.
- Permit explanation and explicit signature request.
- Decrypting.
- Decryption failed with retry.
- Revealed with explicit hide and automatic reseal.
- Encrypting input.
- Wallet confirmation pending.
- Transaction submitted.
- Receipt confirmed or reverted.
- Encrypted action status pending.
- Action status `OK` or `CLAMPED_OR_NO_OP`.

Errors explain whether the failure affected a read, a signature, an encryption request, transaction submission, or confirmation. A decryption failure must state that funds and on-chain state are unchanged. A successful receipt must not be translated into `Deposited` or `Withdrew` until the encrypted action status supports that statement.

## 9. Privacy and security requirements

- Never decrypt on initial render.
- Never request a permit without an explicit user action and explanation.
- Scope permits to the exact Vault and DrawManager contracts needed by the requested value.
- Use separate persistent stores for FHE credentials and permit credentials.
- Never log decrypted balances, theta, credits, encryption payloads, permits, or relayer responses.
- Never branch, key React state, or infer equality from ciphertext handle bytes.
- Never display numeric aggregate principal, liabilities, assets, or a derived backing ratio.
- Never display estimated individual odds.
- Preserve one winner-check flow and one relayer-observable request shape for all participants.
- Do not add winner-only analytics events or telemetry.
- Do not import remote fonts, remote icon CSS, or executable CDN assets.
- Preserve COOP/COEP headers and the production WASM asset assertion.

## 10. Accessibility and responsive behavior

- WCAG AA contrast for text, controls, placeholders, error copy, focus rings, and sealed-value affordances.
- Visible keyboard focus and a working skip link.
- Minimum 44px interactive targets.
- Form labels remain visible and are never replaced by placeholders.
- Status is conveyed by text and icon, never color alone.
- Desktop navigation remains on one line.
- Every multi-column screen collapses to one column below 768px.
- Mobile bottom navigation does not cover content and respects safe-area insets.
- No horizontal overflow at 360px, 768px, 1024px, or 1440px.
- Reduced-motion disables reveal movement while retaining immediate state feedback.
- Private values have meaningful accessible labels without exposing their contents while sealed.

## 11. Test-first implementation strategy

Before changing production components, add or update tests that fail for the intended reasons.

### Unit and component tests

- Stitch-only false claims and fabricated labels never render.
- Each route renders only typed model data supplied to it.
- Deposit path defaults, disclosure ordering, and explicit transaction separation.
- Risk proposed default versus revealed saved value.
- Identical pre-decryption winner and loser result UI.
- No proof-publication success state without a real publication operation.
- No draw-verification success state without a real verification result.
- Wallet, permit, decrypt, transaction, receipt, and encrypted action-status transitions.
- Sealed-value auto-hide and failure retry.
- Public and confidential available-balance behavior.
- Current theta reveal behavior.

### Integration and browser tests

- Replace the stale draw-state combobox E2E with deterministic route fixtures or component coverage that does not invent a production control.
- Replace the E2E assumption that every browser result is a win with explicit zero-credit and nonzero-credit fixtures.
- Run route overflow checks at 360px, 768px, 1024px, and 1440px.
- Assert no console or page errors.
- Assert public data renders while private values stay sealed.
- Assert no permit or decrypt request happens on page load.
- Assert the same check action appears before either result.

### Build and protocol gates

- TypeScript build and Vitest suite pass.
- Playwright suite passes in every configured viewport.
- Vite production build contains all required FHEVM WASM and worker assets.
- COOP/COEP headers remain configured in local preview and Vercel.
- Privacy scanner remains free of new public-decryption, ACL, event, or winner-only ABI violations.
- Final copy scan finds no gambling terminology, false cryptographic claims, fabricated figures, or unsupported success messages.

## 12. Delivery sequence

1. Correct the behavioral tests and add failing tests for truthful rendering and newly connected reads.
2. Extract the approved dark tokens and responsive shell without changing data hooks.
3. Port Vault and the shared sealed/private-state components.
4. Port Deposit and connect real available-balance and action-status states.
5. Port Risk and connect explicit saved-theta reveal.
6. Port Draw using only live public fields.
7. Port Private Result and remove simulated publication.
8. Port Why Encrypted with the verified FHEVM boundary.
9. Update the visual-direction documentation and remove stale E2E assumptions.
10. Run unit, build, browser, privacy, responsive, copy, and final-diff verification.

## 13. Acceptance criteria

The integration is complete only when all of the following are true:

- All six routes use the approved dark Stitch-derived visual system and real React routing.
- No Stitch CDN, inline script, `href="#"`, hard-coded protocol result, or fabricated success state enters production code.
- Every displayed protocol value is traceable to a typed live read, a verified source-controlled deployment value, or an explicit wallet decryption.
- Deposit, shield, test mint, withdraw, risk update, balance reveal, theta reveal, and result check reach their real existing backend surfaces.
- Deposit and withdrawal completion messages reflect decrypted `lastActionStatus` rather than receipt success alone.
- No automatic permit or decrypt request occurs.
- Winner and loser flows are identical until the one private credit decryption returns.
- Draw verification and proof publication are not falsely represented as implemented.
- The frozen proposition list and production contracts are unchanged.
- Unit tests, production build, responsive E2E, WASM assertion, and relevant privacy checks pass with fresh output.

## 14. Explicit non-goals

- Modifying LokVault, LokDrawManager, token, wrapper, adapter, or deployment contracts.
- Re-freezing or weakening any proof proposition.
- Building a keeper or exposing keeper credentials in the browser.
- Implementing public proof publication.
- Porting the full CLI draw verifier into the browser.
- Adding analytics, localization, a language selector, a theme toggle, new routes, or a new design-system dependency.
- Importing generated Stitch HTML as application code.
