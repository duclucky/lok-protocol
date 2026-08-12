# 11 — Tooling

Everything needed to set up and operate the project: contract toolchain, the Zama SDK and CLI, the official Zama agent
skills, Sepolia access, and the two proof tools (TLA+ and Foundry invariant mode).

Anything marked **[VERIFY]** must be confirmed against live documentation and recorded in `docs/API-VERIFIED.md` before
you depend on it. The FHEVM tooling moves; treat versions and command names as hypotheses until confirmed.

---

## 1. The one rule that prevents most lost days

**Install and use the official Zama agent skills before writing any FHEVM code.** Zama publishes an agent skills
repository (`zama-ai/skills`) built specifically to give coding agents current, correct context for FHEVM — more current
than any model's training data. The FHEVM API has had breaking changes in most releases, so grounding the agent in these
skills is not optional polish; it is defect prevention.

- Clone `zama-ai/skills` into the agent environment at project start.
- When it disagrees with this document, **the skill wins for API surface**, because it tracks the live release; record
  the discrepancy in `docs/API-VERIFIED.md` §6 so this document can be corrected.
- The docs site also exposes an LLM-oriented entry point ("Build with an LLM") and machine-readable documentation.
  Prefer these over blog posts, which are frequently stale.

---

## 2. Contract toolchain

### Scaffold

Start from the official FHEVM Hardhat template rather than an empty project — it wires the plugin, mock mode, and the
config base contract correctly, which are the three things most commonly misconfigured.

```
# [VERIFY] exact template name and package versions against the current docs
npx --yes @zama/create-fhevm-hardhat lok-protocol      # or: degit zama-ai/fhevm-hardhat-template
cd lok-protocol
npm install
```

Core dependencies (confirm versions in `docs/API-VERIFIED.md` §0):

```
@fhevm/solidity                       # the FHE Solidity library
@fhevm/hardhat-plugin                 # mock mode, test helpers, tasks
@openzeppelin/confidential-contracts  # ERC-7984, ERC-20 wrapper, vesting
@zama/sdk (or the current SDK name)   # TypeScript + React client
hardhat, typescript, ethers, chai
```

### The three execution modes

| Mode                                       | What runs                                                     | Use it for                                                         |
| ------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Mock**                                   | FHE operations simulated locally; no KMS, no gateway, instant | All logic and invariant tests. This is where the tight loop lives. |
| **Cleartext relayer** (`RelayerCleartext`) | The full client flow against a local node, FHE in cleartext   | Local end-to-end of the frontend without testnet latency.          |
| **Sepolia**                                | The real protocol                                             | Integration tests, HCU measurement, the deployed demo.             |

Develop almost entirely in mock mode. Touch Sepolia deliberately: for measurement, integration, and deployment — never
as the default test target, because its relayer is shared, slow and rate-limited.

### Hardhat tasks you will use

```
npx hardhat test                         # mock-mode tests
npx hardhat test --network sepolia       # integration; slow, consumes relayer quota
npx hardhat coverage
npx hardhat compile
npx hardhat run scripts/deploy.ts --network sepolia
npx hardhat verify --network sepolia <address> <args...>   # Etherscan verification
```

Mock-mode FHE tests rely on the plugin's helpers to encrypt inputs and to decrypt results in-test. **[VERIFY]** the
exact helper names (historically an `fhevm` test object exposing `createEncryptedInput` and user-decryption helpers) and
record them.

---

## 3. Zama SDK — client side

Configure once for Sepolia and the public testnet relayer. **No API key is required on testnet**; a key is only needed
for the hosted mainnet relayer, and that is out of scope here.

### Instance setup [VERIFY all names]

```
// conceptual — confirm against the SDK reference and record in API-VERIFIED §4
import { createInstance, SepoliaConfig } from "<zama-sdk-package>";
const instance = await createInstance({
  ...SepoliaConfig,          // chain id, relayer URL, contract addresses
  network: window.ethereum,  // or a viem/ethers provider
});
```

### The client operations Lok needs

| Purpose                                           | SDK surface (verify names)                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Encrypt + prove an input for `deposit`/`setTheta` | `createEncryptedInput(...).add64(...).encrypt()` → `{ handles, inputProof }`         |
| User-decrypt a handle (own balance, θ, credit)    | `userDecrypt(...)` with an EIP-712 permit                                            |
| Public-decrypt an aggregate (`totalTickets`, `r`) | the public decryption flow — **the critical unknown; see `docs/API-VERIFIED.md` §3** |
| Generate + sign the decryption permit             | `generateKeypair` + `createEIP712` + wallet signature                                |
| Reconstruct handles from event logs               | needed by `verify-draw.ts`                                                           |

### React hooks

The SDK ships React bindings. Use them; do not reimplement. **[VERIFY]** each name and record in `docs/API-VERIFIED.md`
§4.

```
useConfidentialBalance · useConfidentialBalances
useShield · useUnshield · useConfidentialTransfer · useConfidentialSetOperator
useEncrypt · useDecryptValues        # useDecryptValues is disabled until a permit is cached
useGrantPermit · useHasPermit
useWrapperDiscovery                   # find the cUSDC wrapper for USDC
```

Rules that avoid the common failures:

- Request the decryption permit **once, early, with an explanation.** A surprise signature prompt reads as an attack.
  Persist the permit across refreshes.
- Gate `useDecryptValues` on `useHasPermit`.
- Never auto-decrypt on page load — it burns shared relayer quota and trains the wrong mental model.

---

## 4. Sepolia access

| Need                                                           | Source                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| RPC endpoint                                                   | Any Sepolia RPC (Alchemy, Infura, public). Put it in `.env`, never in code.                                            |
| Test ETH for gas                                               | A Sepolia faucet.                                                                                                      |
| Protocol contract addresses (ACL, Executor, HCULimit, relayer) | The Zama testnet addresses page — record all in `docs/API-VERIFIED.md` §0.                                             |
| USDC ↔ cUSDC pair                                              | The Sepolia wrappers registry — confirm a usable pair exists.                                                          |
| Test USDC                                                      | Mint via the mock in `MockYieldAdapter`/the wrapper faucet, then shield. The demo's "Get test tokens" flow wraps this. |
| Contract verification                                          | Etherscan Sepolia + an Etherscan API key in `.env`.                                                                    |
| Protocol status                                                | `status.zama.org` and the version dashboard — check here first when a call that worked yesterday reverts today.        |

`.env` template (never commit it):

```
SEPOLIA_RPC_URL=
DEPLOYER_PRIVATE_KEY=          # a throwaway key holding only test funds
ETHERSCAN_API_KEY=
RELAYER_URL=                   # from the testnet addresses page
```

The deployer key must be a throwaway holding only test funds. Reminder from the safety rules: never place a real private
key, or any credential, into a file or a form — the human handles key material.

---

## 5. TLA+ — the tier-B proof tool

The state machine is model-checked **before** the contracts, per `docs/10-proof-strategy.md` Stage 1.

- **Tool:** TLA+ with the TLC model checker (the TLA+ Toolbox, or the VS Code extension, or `tlc` on the command line).
- **Model:** `spec/LokDraw.tla`. Encode the seven draw states plus the commit-reveal reveal phase and its timeout; the
  user actions (`deposit`, `withdraw`, `setTheta`, `exit`, `emergencyWithdraw`) as enabled in every state; and an
  adversary process able to withhold reveals, stop cranking, spam `abort`, and reorder its own steps. Model the oracle
  as a boolean that may latch to permanently-down.
- **Properties to check:** P-L1..P-L5, P-F3, P-A4 from the proof strategy. Encode liveness as temporal properties and
  safety as invariants.
- **Bounds:** keep the participant count small (e.g. 3–5) — model checking is about interleavings, not scale. A liveness
  or deadlock bug appears at small N; scale is handled by the tier-A fuzzing on the real contracts.
- **Output discipline:** a TLC counterexample is a design change, applied to `docs/02-architecture.md` and
  `docs/05-contract-specs.md` **before** touching Solidity. Record each counterexample and its resolution in the model's
  comments so the same mistake is not reintroduced.

If TLA+ is unfamiliar, Alloy is an acceptable substitute for the finite-state safety properties, though it is weaker on
liveness. Prefer TLA+ for the reveal-timeout liveness properties specifically.

---

## 6. Foundry invariant mode — the tier-A proof tool

Solidity invariants (P-S1..P-S6, P-A1..P-A3) are established with Foundry's invariant testing, which drives random
sequences of calls against handler contracts and asserts invariants after each.

- Add Foundry alongside Hardhat (`foundry.toml` + `forge-std`). Hardhat remains the primary framework for FHE mock-mode
  tests; Foundry is used for its invariant engine.
- **[VERIFY]** how FHE mock precompiles behave under `forge` versus Hardhat. If Foundry cannot host the FHE mock, run
  the invariant campaigns against a plaintext **reference model** of the accounting (the same reference used for
  differential testing in Stage 4) and reserve the FHE-in-the-loop checks for Hardhat mock mode. Record the decision.
- **Handlers** expose bounded, realistic action sequences (deposit within a cap, withdraw ≤ balance, setTheta in range,
  advance time, run a full draw).
- **Invariants** assert the tier-A propositions after every sequence. Solvency (P-S2) and prize conservation (P-S3) are
  the two that must never fail; give them the largest run budget.
- Use the abundant compute budget here: run to ≥10⁷ sequences, and let long campaigns run in the background. This is
  where "unlimited resources" actually buys assurance.

---

## 7. Scripts

| Script           | Purpose                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `deploy.ts`      | Deploy vault, draw manager, guardian, mock adapter to Sepolia; verify on Etherscan; print addresses for the README and the app footer.                                                                                                                                   |
| `seed-demo.ts`   | Populate the pool with 30–50 participants at varied balances and θ so pagination visibly runs in the demo.                                                                                                                                                               |
| `crank.ts`       | Permissionless keeper: reads draw state and batch caps, advances `preSync` → `crankA` → `submitTotals` → `openRandom` → reveal window → `crankB` → settle, with backoff.                                                                                                 |
| `verify-draw.ts` | **Graded deliverable.** A third party runs it with no private keys: replays the event log, rebuilds the handle graph, checks the randomness commitment, the reveal (strict mode), and the prize-conservation invariant; prints PASS/FAIL. Run it on camera in the video. |
| `bench-hcu.ts`   | Deploys an `HCUProbe`, bisects the revert boundary per operation sequence, and writes measured HCU into `docs/04-hcu-budget.md` and `docs/BENCHMARK.md`.                                                                                                                 |

### 7.1 Implemented operations workflow

All Hardhat operations use Node 22. Task 17 built and locally verified the scripts; Task 18 is the first authorized core
deployment run.

```powershell
npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/deploy.ts --network sepolia
$env:LOK_SEED_COUNT="40"; npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/seed-demo.ts --network sepolia
$env:LOK_OPEN_DRAW="1"; npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/crank.ts --network sepolia
$env:LOK_VERIFY_LATEST_SETTLED="1"; npx --yes node@22 node_modules/hardhat/internal/cli/cli.js run scripts/verify-draw.ts --network sepolia
```

- `deploy.ts` uses `hardhat-deploy` checkpoints, resumes partially mined deployments, validates one-time bindings and
  the initial solvency checkpoint, writes full public traceability metadata, and retries Etherscan verification without
  redeploying matching bytecode.
- `seed-demo.ts` creates 30-50 varied actors. Their keys exist only in process memory and are never written or printed;
  the human demo wallet is supplied separately or defaults to the throwaway deployer.
- `crank.ts` dispatches only from current public state with caps 4/3/2, refreshes after stale concurrent transactions,
  backs off boundedly for public decryption, and never reads a per-user prize or winner value.
- `verify-draw.ts` uses public aggregate decryption, RPC logs/calldata, Etherscan-verified runtime provenance and event
  completeness. A strict draw additionally requires `--transcript <json>` containing public commit/reveal transaction
  hashes because the current contract emits no commit/reveal event. The script validates every supplied transaction and
  the final XOR accumulator; transcript completeness remains an explicit review obligation.
- `export-addresses.ts` writes the six public Vite variables and a generated address block from the validated manifest.

---

## 8. Recommended order of first-day tooling actions

Mirrors `docs/09-delivery-checklist.md` Days 1–2, tool-focused:

1. Clone `zama-ai/skills`; install into the agent environment.
2. Scaffold from the FHEVM Hardhat template; `npm install`; confirm mock-mode tests run.
3. Fill `docs/API-VERIFIED.md` §0 (versions, addresses, relayer, wrapper pair) from live docs.
4. Confirm the **public decryption** call sequence and its on-chain verification — the critical unknown
   (`docs/API-VERIFIED.md` §3). The draw cannot be built without it.
5. Stand up TLA+ / TLC; get an empty `LokDraw.tla` model-checking so the toolchain is proven before the model grows.
6. Add Foundry; confirm whether it can host the FHE mock or must run against the reference model.
7. Run `bench-hcu.ts` against a probe to measure real per-participant HCU; set batch caps to 60% of the measured
   maximum.
8. Wire `.env`, a throwaway deployer key, and a Sepolia RPC; do a trivial deploy to prove the pipeline end to end.

Only after 1–8 succeed does contract work on the real Lok logic begin — and even then, only after the TLA+ model of the
state machine has been checked (proof strategy Stage 1).
