# 06 — Frontend Specification

The frontend is graded. The bounty asks for polished UX and a working deployed demo, and the demo is what the reviewer
actually experiences. Most submissions lose points here, not in the contracts.

Two facts govern every decision in this document:

1. **Decryption is asynchronous, slow, rate-limited and sometimes fails.** The UI must be built around that, not in
   spite of it.
2. **Failure is silent under FHE.** Operations clamp to zero instead of reverting, so the interface is the only place a
   user can learn that something did not happen.

---

## 1. Stack

| Concern   | Choice                                   | Note                                                                                                                                                                     |
| --------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bundler   | **Vite**                                 | Never Webpack. The FHE WASM binary is a known Webpack failure mode: the SDK silently degrades to a non-encrypting "demo mode" while the wallet still shows as connected. |
| Framework | React + TypeScript                       |                                                                                                                                                                          |
| Wallet    | `wagmi` + `viem`                         | The Zama SDK ships `viem` and `ethers` adapters.                                                                                                                         |
| FHE       | Zama SDK v3 with the React bindings      | Use the provided hooks; do not hand-roll encryption.                                                                                                                     |
| State     | React Query (bundled with the SDK hooks) | Decryption results are cache entries with staleness, which is exactly React Query's model.                                                                               |
| Styling   | Tailwind, with the token system in §7    |                                                                                                                                                                          |
| Host      | Any static host                          | Must be a public URL before submission.                                                                                                                                  |

**Verify the WASM asset appears in `dist/` after `vite build`.** If it does not, encryption will silently not work in
production while working locally. Add a build assertion that fails the build if the asset is missing.

---

## 2. SDK integration

Wrap the app in the SDK's provider, configured for Sepolia and the public testnet relayer. No API key is required on
testnet; a key is only needed for the hosted mainnet relayer.

Use these hooks rather than reimplementing them. **[VERIFY]** exact names and signatures against the SDK reference and
record in `docs/API-VERIFIED.md`:

| Purpose                                    | Hook                         |
| ------------------------------------------ | ---------------------------- |
| Read a confidential balance                | `useConfidentialBalance`     |
| Read several balances at once              | `useConfidentialBalances`    |
| Confidential transfer                      | `useConfidentialTransfer`    |
| Public ERC-20 → confidential               | `useShield`                  |
| Confidential → public ERC-20               | `useUnshield`                |
| Operator approval for the vault            | `useConfidentialSetOperator` |
| Sign the EIP-712 decryption permit         | `useGrantPermit`             |
| Check whether a permit is cached           | `useHasPermit`               |
| Decrypt arbitrary handles (our credits, θ) | `useDecryptValues` or the SDK decryption client, after refetching the current handle |
| Encrypt a plaintext input                  | `useEncrypt`                 |
| Find the cUSDC wrapper for USDC            | `useWrapperDiscovery`        |

### The permit model

Decryption requires a signed EIP-712 permit authorising the relayer to serve re-encrypted values for specific contracts.
Two rules:

- **Request the permit only after an explicit reveal action, with an explanation.** Never prompt during render or
  onboarding. The user must understand which private value the signature will allow this device to read.
- **Gate decryption on a cached permit.** Whether the implementation uses `useDecryptValues` or the SDK decryption
  client directly, it must first confirm or obtain the permit and refetch the current encrypted handle. Never decrypt a
  stale handle captured before a state-changing transaction.

Persist permits so a page refresh does not re-prompt.

---

## 3. Screens

Five screens. Resist adding more.

### Vault (home)

- **Your balance** — encrypted by default, revealed on an explicit "Reveal" action, auto-hiding after 60 seconds. Never
  auto-decrypt on page load: it burns relayer quota on every visit and trains users to expect their balance to be
  visible, which is the wrong mental model for this product.
- **The pool** — current prize estimate, time to next draw, participant count, and solvency checkpoint status
  (`Verified for risk epoch E`, `Verification pending`, or `Restricted`). These are public and render immediately. Do
  not display numeric aggregate principal, liabilities, assets, or a live backing ratio.
- **Fortune disclosure** — never show a per-user Fortune leaderboard or infer a winner. The Why Encrypted view states
  that effective/base ticket totals reveal bounded pool-level Fortune movement while individual histories remain sealed.
- **Deposit / Withdraw** — the primary action.
- **Your Risk Dial** — see below.
- **Draw history** — public per-draw facts (prize, effective/base/yield aggregate weights, revealed `r`) plus _your_
  encrypted credit per draw, revealed on demand.

### Deposit

Two paths, and the distinction between them is a privacy statement, not a technical detail:

**Path A — you already hold cUSDC (default, recommended).** One confidential transfer. End-to-end encrypted. Badge it:
_"Fully private."_

**Path B — you hold public USDC.** Requires shielding first. **The UI must state plainly, before the user signs:**
_"Shielding publishes this amount on-chain. Your balance inside Lok stays private, but the deposit amount will be
visible. Deposit in a separate, later transaction to weaken the link."_ Badge it: _"Entry amount visible."_

This is trap T3 in `docs/01-bounty-compliance.md`. Handling it visibly earns credit; hiding it will be found.

### Risk Dial

A five-position control: 0% / 25% / 50% / 75% / 100%, defaulting to **100%**.

Copy for each position, written from the user's side:

| Setting | Label          | Explanation                                                            |
| ------- | -------------- | ---------------------------------------------------------------------- |
| 100%    | All in prizes  | Your full yield share funds the prize pool. Highest chance of winning. |
| 75%     | Mostly prizes  | Most of your yield funds prizes; a little accrues to your balance.     |
| 50%     | Half and half  | Half your yield accrues steadily; half buys chances.                   |
| 25%     | Mostly savings | Your yield mostly accrues; a small share buys chances.                 |
| 0%      | Savings only   | Your yield accrues to your balance. You do not enter draws.            |

Beneath the control: _"Your saved setting is encrypted on-chain. Reveal it only through an explicit wallet permit."_
Do not claim that infrastructure can observe nothing; public transactions, membership and ciphertext transcripts remain
observable even when the underlying value is encrypted.

Do **not** display estimated odds. It is technically impossible (the numerator is encrypted and must stay so, per
invariant I3) and it is also the exact behaviour the thesis identifies as fatal. If a reviewer asks why odds are absent,
the answer is that showing them is the bug. Put that answer in the FAQ.

### Draw

Live view of the state machine. Reviewers judge sophistication here, so make the machinery legible:

- Current state with a short plain-language explanation.
- Sweep progress: `cursor / participants` for each pass, with a progress bar. This is where the paginated architecture
  becomes visible — an asset, not something to hide.
- The randomness commitment: show the handle and the block, labelled _"Committed before any winner was determined.
  Nobody can read this value, including us."_
- After settlement: the revealed `r`, the total ticket space, and a link to the external verification evidence. The app
  must not simulate a verifier or display a local success state unless the complete verifier actually ran.
- **Your result:** _"Check my result"_ → decrypt your own credit for the draw. Two outcomes only: _"No prize this draw"_
  or the celebratory reveal. This is a device-local private read and must not imply that a public proof was published.

### Proof of win

Only reachable after a user decrypts a non-zero credit. It explains what the private result establishes and links to
the public draw evidence. Public proof publication is not currently supported. If added later, it requires a separately
specified and audited public-decryption flow; the frontend must never imitate that flow with a local status message.

---

## 4. Async decryption — the rules

Every private value passes through this state machine. Implement it once as a shared component and reuse it;
inconsistency here is what makes an app feel unfinished.

```
SEALED  ──reveal──►  REQUESTING_PERMIT ──►  DECRYPTING ──►  REVEALED ──60s──►  SEALED
                              │                  │
                              ▼                  ▼
                          DECLINED            FAILED  ──retry──►  DECRYPTING
```

Requirements:

- **`SEALED` is the default and it must look intentional**, not like a loading skeleton. A deliberate masked treatment
  (see §7) communicates "this is encrypted", whereas a grey shimmer communicates "this is broken".
- **Never block the whole screen on a decryption.** Public data renders immediately; private values fill in.
- **`FAILED` states must be honest and actionable.** _"Couldn't reach the decryption network. Your balance is safe —
  this is a read failure, not a transaction failure. Retry."_ Never a bare "Error".
- **Cache by encrypted handle.** A decrypted value stays valid until the underlying handle changes. Refetch the handle
  immediately before an explicit reveal, but do not automatically decrypt on mount or repeatedly decrypt an unchanged
  handle.
- **Exponential backoff on retry**, capped, with no automatic retry storm.

---

## 5. Silent failure must never reach the user

Because encrypted operations clamp rather than revert, a transaction can succeed while accomplishing nothing. The
current contract exposes `lastActionStatus` as one encrypted boolean, so the client must translate only the two states
that one bit can distinguish:

| Contract status    | User-facing message                                                                    |
| ------------------ | -------------------------------------------------------------------------------------- |
| `OK`               | "Deposited." / "Withdrew."                                                             |
| `CLAMPED_OR_NO_OP` | "The requested action was clamped or made no change. Your funds remain accounted for." |

The client must not infer whether `CLAMPED_OR_NO_OP` was caused by insufficient balance, a rate cap, or a zero amount. A
more precise message requires an encrypted enum contract change and the corresponding proof and test re-review.

A transaction that "succeeded" while moving nothing, with no explanation, is the single worst UX failure available on
this stack. It is also what an inattentive submission will ship.

---

## 6. Demo hardening

The reviewer arrives with an empty wallet and no patience. Every item here is required; see also
`docs/09-delivery-checklist.md`.

| Problem                                       | Required affordance                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| No cUSDC on Sepolia                           | **"Get test tokens"** — mints mock USDC and shields it in one guided flow                                                      |
| Empty pool makes a draw meaningless           | Pre-seeded participants via `scripts/seed-demo.ts` — 30 to 50 addresses with varied balances and θ, so pagination visibly runs |
| Nobody waits a week for a draw                | **"Run draw now"** — clearly labelled `DEMO CONTROL`, visually separated from user actions                                     |
| Relayer slow or rate-limited                  | Everything in §4                                                                                                               |
| Reviewer cannot tell what is real             | Verified Sepolia deployment addresses linking to Etherscan, plus an explicit network label; never hard-code a stale commit or SDK version |
| Reviewer wants the argument, not just the app | A one-screen **"Why encrypted?"** page carrying the thesis with its numbers                                                    |

---

## 7. Design direction

**Concept: Zama App-inspired confidential savings utility.** Use [Zama App](https://app.zama.org/activity) as the visual
calibration for hierarchy and restraint, without copying its logo, assets, source code or product wording. The interface
is a light operational dashboard: a neutral canvas, a floating white navigation surface, crisp white data panels,
charcoal typography and black primary actions. Yellow identifies the selected navigation item only; it is not a gradient
or decorative wash.

**Tokens** — derive all component values from these semantic roles:

```
--ink           #292929   primary text and black actions
--paper         #F1F1F1   application canvas
--surface       #FFFFFF   navigation and card surfaces
--surface-quiet #F6F6F6   nested and read-only surfaces
--seal          #FFE56A   selected navigation and encrypted-value accent
--patina        #0B7159   verified and healthy public state
--gold          #9A7020   prize figures only
--border        #DDDDDA   quiet structural borders
```

**Type:** IBM Plex Sans for interface copy and figures, with IBM Plex Mono for addresses, handles and fixed-width
technical values. Use tabular numerals. Hierarchy comes from weight, scale and whitespace rather than a decorative
display font.

**Layout:** on desktop, use a floating rounded sidebar and a single bounded content column. On mobile, reduce this to a
compact top bar plus a fixed bottom navigation bar, while preserving enough bottom padding that controls and content are
never obscured. Cards use a 16px family radius; small controls use 4–8px radii; wallet and primary actions may use pills.

**The signature element** remains the **sealed-value treatment**. An encrypted figure must look intentionally covered,
using a quiet repeating slash or security-line pattern beneath a veil—never a loading skeleton. Revealing it may use one
brief transition; the rest of the interface stays calm.

**Motion:** use motion only for state changes such as reveal, navigation and progress. Respect
`prefers-reduced-motion`; do not add ambient animation.

**Quality floor, unannounced:** responsive to mobile, visible keyboard focus, adequate contrast, correct labels on every
control.

**Copy discipline:** active voice; a control names exactly what happens; the same verb persists through the flow
("Deposit" → "Deposited"); errors explain what went wrong and how to fix it without apologising; empty states invite an
action. Name things by what the user controls, never by how the system is built — "your balance is sealed", not
"ciphertext handle unresolved".
