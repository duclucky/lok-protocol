# Lok Protocol Handoff

## Current Status - 2026-08-12

The near-instant Sepolia migration and Task 9 production publication are complete.

- Canonical Vault: `0xAA7B956c551B7f5336c2d9e786CB9024aB1657e1`
- Canonical Draw Manager: `0x5592dB13624EB5C20B6Bb5841317148c79DFFAa5`
- Immutable timing: `120 / 30 / 180 / 600` seconds
- Normalization: `TICKET_SCALE_BITS = 26`
- Pool: 30 participants and 5.00 cUSDC funded demo yield
- Draw #1: non-strict, `SETTLED`, settlement block `11474217`
- Public verifier: PASS on all six checks
- Live Sepolia integration: 3/3 PASS
- HCU Gate 3: PASS; caps remain pre-sync `4`, PASS A `3`, PASS B `2`
- Frontend source address export: updated to the canonical stack
- Vercel project: `lok-protocol-app`, canonical alias live and smoke-tested
- GitHub source: `duclucky/lok-protocol`, private pending submission publication
- Git production: `dpl_9pjjjVU6E8AyYNnWEYztHQHL7xQs` from commit `c7ad99b0b4b713f4cbe19e3219e1192f696c8cbb`

The seven-day deployment remains historical evidence at `deployments/history/sepolia-seven-day-2026-08-11.json`. Do not
restore it as the canonical manifest.

## Operating Contract

- Follow `CLAUDE.md`, `docs/03-fhevm-knowledge.md`, and `docs/API-VERIFIED.md` before Solidity or TypeScript work.
- `docs/10-proof-strategy.md` section 3 remains frozen at 42 propositions. Do not edit it without explicit re-review.
- Sepolia only. No Arc, multichain, governance token, NFT, leaderboard, or private accounting relayer.
- Verify every new FHEVM/Zama symbol in `docs/API-VERIFIED.md` before use.
- This directory is not a Git repository. Do not initialize Git without explicit instruction.
- The deploy key and Etherscan key are stored outside the repository through Hardhat vars. Never print them.
- The owner instructed this task to execute without agents or subagents.

## Proof And Local Gates

The timing change followed the proof-first order:

1. Architecture/spec updated and reviewed without editing frozen propositions.
2. Parameterized TLA+ model rerun before Solidity:
   - DRAW: 27,958,689 generated; 1,057,248 distinct; depth 32; no error; 2m18s.
   - RISK: 2,075,393 generated; 79,424 distinct; depth 25; no error; 7s.
3. Constructor/timing tests failed for the expected missing behavior, then passed after implementation.
4. The 120-second RED tests exposed the scale-32 dust threshold. The human approved scale 26.

Scale-26 bounds:

- `W,B < 2^58`.
- Pre-division Fortune product `< 2^64`.
- Fortune-adjusted prefix `< 2^59`.
- 120-second non-dust yield threshold: about `0.559241 USDC`.

Fresh local evidence:

- Lint and compile: PASS.
- Hardhat: 146 passing, 4 explicitly Sepolia-only pending locally.
- Frontend Node 22: 58/58 tests, TypeScript and Vite build PASS.
- Fairness simulation: 2,000,000 draws each for P-F1 and P-F1'.
- Privacy scanner: PASS; dynamic ACL suite 3/3 PASS.
- Foundry safety: 10,000,004 sequences, 320,000,128 calls, 0 reverts, PASS.
- Fresh scale-26 Foundry fairness: 10,000,004 sequences, 320,000,128 calls, 0 reverts, 28 shards, PASS.

The proof worker is the owner-authorized implementation context, not an independent reviewer. Human/independent proof
sign-off remains a documented residual governance obligation.

## Sepolia Evidence

All five canonical contracts are source verified. The manifest validates exact constructor timing and bytecode hashes.
Bindings and initial solvency checkpoint transactions are recorded in `deployments/sepolia.json` and
`docs/DEPLOYMENT.md`.

Draw #1:

- Open tx: `0xc6f1d7239be48019b62d493082559f097da036ea90684a96982a85ad07ade9e7`
- Window: `2026-08-12 15:45:36` to `15:47:36 UTC`
- Settlement tx: `0x5af934699595eb9adb0507ed1d5a5de64470771b269cdbb99e5caca67c01764e`
- Settlement time: `2026-08-12 15:58:48 UTC`
- Effective/base/yield totals: `125 / 125 / 132`
- Realised yield/prize: `5,000,000 / 4,734,848` base units
- Total opening-to-settlement time: 13 minutes 12 seconds

The keeper initially reached `AWAIT_TOTAL` and exposed a real-runtime serializer bug: Sepolia returned bytes32 strings
while the mock path returned bigints, producing `0x0x...`. `scripts/crank.ts` now validates and normalizes both forms;
the focused keeper suite covers this behavior. No forged/stale total was submitted and the draw resumed from the
unchanged `AWAIT_TOTAL` state.

The default Sepolia RPC later stopped serving `participantCount()` at the draw-open block. The verifier now falls back
to the retained current snapshot only for `--latest-settled`, after checking that the target remains the current draw
and state is exactly `SETTLED`; historical draws still require an archive RPC. The regression suite covers both the
allowed fallback and refusal to apply it to an older draw.

## HCU Evidence

Probe: `0xFf607974D31445fd82D6D052926FEAc700AB46ae`

| Path             | Measured HCU | Max | 60% cap | Estimate drift |
| ---------------- | -----------: | --: | ------: | -------------: |
| Pre-sync         |    2,430,032 |   8 |       4 |          +0.0% |
| PASS A           |    3,001,192 |   6 |       3 |         -15.6% |
| PASS B           |    4,025,320 |   4 |       2 |          +4.0% |
| Randomness       |    1,211,000 |  16 |       9 |          +0.0% |
| Fortune          |      294,128 |  67 |      40 |            n/a |
| Solvency boolean |      476,000 |  42 |      25 |          +0.6% |

No measured path crossed the 50% escalation threshold. Public decryption p50/p95 is `2665/3609 ms`; user decryption
p50/p95 is `2744/3148 ms`. Raw evidence is in `artifacts/hcu-benchmark.json`.

## Task 9 Publication

- Canonical URL: [https://lok-protocol.vercel.app](https://lok-protocol.vercel.app)
- Legacy alias: [https://frontend-xi-tawny-54.vercel.app](https://frontend-xi-tawny-54.vercel.app)
- Vercel project: `lok-protocol-app`; Git root directory: `frontend/`; runtime: Node.js `22.x`.
- GitHub repository: [duclucky/lok-protocol](https://github.com/duclucky/lok-protocol), private.
- Git production deployment: `dpl_9pjjjVU6E8AyYNnWEYztHQHL7xQs`.
- Immutable URL:
  [https://lok-protocol-iim3seyew-duckys-projects-bc83c6a0.vercel.app](https://lok-protocol-iim3seyew-duckys-projects-bc83c6a0.vercel.app)
- Browser smoke: `/` and `/draw` show canonical addresses, 30 participants, and settled draw #1 with no console warnings
  or errors.
- HTTP smoke: `/`, `/draw`, and the TFHE WASM return `200`; COOP/COEP headers and `application/wasm` MIME pass.

## Remaining Work

Human-owned delivery items remain: fresh-wallet extension signatures/video recording, changing the repository from
private to public for submission, video/X publication, eligibility/KYC/geography confirmation, and final bounty
submission.
