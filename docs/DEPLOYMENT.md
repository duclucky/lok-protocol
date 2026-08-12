# Sepolia Deployment

**Status:** COMPLETE - deployed, verified, seeded, settled, independently verified, and live-acceptance checked.  
**Network:** Ethereum Sepolia (`chainId = 11155111`)  
**Deployed:** 2026-08-12  
**Operator:** `0x8e7939E23a012143e5182d7173DAD42B2006c2b8`

## Canonical Contracts

| Contract              | Address                                                                                                                              | Deployment transaction                                               | Source   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------- |
| MockUSDC              | [`0x68e13782C114A885f754109EF99Cea269eb401b2`](https://sepolia.etherscan.io/address/0x68e13782C114A885f754109EF99Cea269eb401b2#code) | `0x4877fa461a3679339748f7f5e390e1cc31c4a49a399281d51038d587aae0023a` | Verified |
| YieldInjectingERC7984 | [`0x00eB52CF8f64eA64588BB0d427EE93A907Dbe107`](https://sepolia.etherscan.io/address/0x00eB52CF8f64eA64588BB0d427EE93A907Dbe107#code) | `0x668e8e749f931521409a7af448c239ac2c95464ea6ec66e8383e631a306a4946` | Verified |
| MockYieldAdapter      | [`0xB0FDA68126fC09DED8A7114ad436f2B638D89dfA`](https://sepolia.etherscan.io/address/0xB0FDA68126fC09DED8A7114ad436f2B638D89dfA#code) | `0xe3da35bc3ff28ab80f9c8f336f3ddde5547706d93a018e38a62e696ab9be3cad` | Verified |
| LokVault              | [`0xAA7B956c551B7f5336c2d9e786CB9024aB1657e1`](https://sepolia.etherscan.io/address/0xAA7B956c551B7f5336c2d9e786CB9024aB1657e1#code) | `0x031b60e4fa62f4a479b0b2cc5afce003444ae0b78da0a60fa2b4abf0f7ece6be` | Verified |
| LokDrawManager        | [`0x5592dB13624EB5C20B6Bb5841317148c79DFFAa5`](https://sepolia.etherscan.io/address/0x5592dB13624EB5C20B6Bb5841317148c79DFFAa5#code) | `0xaa01fe15b003f5473e5da1c0b991bdbac653820fa53906594defc0e1fa1b0d31` | Verified |

The confidential token is also the wrapper. Exact constructor arguments, runtime bytecode hashes, versions, and
verification flags are in `deployments/sepolia.json`. The prior seven-day release is preserved without modification in
`deployments/history/sepolia-seven-day-2026-08-11.json`.

## Configuration

| Setting             |         Value |
| ------------------- | ------------: |
| `DRAW_PERIOD`       | `120 seconds` |
| `MIN_SETTLE_DELAY`  |  `30 seconds` |
| `REVEAL_WINDOW`     | `180 seconds` |
| `STATE_TIMEOUT`     | `600 seconds` |
| `TICKET_SCALE_BITS` |          `26` |

All timing values are immutable constructor parameters. The live integration test confirms all runtime bytecode hashes,
bindings, owners, exact timing getters, and the current risk-epoch solvency authorization.

| Configuration action               | Transaction                                                          |
| ---------------------------------- | -------------------------------------------------------------------- |
| Bind adapter to vault              | `0x6bb099e8f75a0dd830c4117cfa555acee017c53fad58516de9dbec2a157d334c` |
| Bind draw manager to vault         | `0x78c36404cb31dd84b2380320e740eb82ac8ddd3af1b4ae5b29e67813b9b31780` |
| Open initial solvency checkpoint   | `0xecb8979de70d0cd1195e832a5b6d5750599c7fdda356614fac61f29c5e2539d5` |
| Submit initial solvency checkpoint | `0x721eff0cacdf973e1d1e1157155f0be589176d0034dbc8f25847688b0b800a9d` |

Guardian deployment is intentionally omitted because no reviewed threshold configuration with at least two independent
signers was supplied.

## Settled Draw Evidence

| Fact                         | Value                                                                |
| ---------------------------- | -------------------------------------------------------------------- |
| Participant count / snapshot | `30 / 30`                                                            |
| Demo yield funded            | `5,000,000` base units (`5.00 cUSDC`)                                |
| Demo mint transaction        | `0x87f4fe18fde1212e5dc44fb2ba59537c0e2b26fc7af14ec2e24d28a86ea573fa` |
| Yield funding transaction    | `0x6151a6e5df4789ed3c499807ce570c8e5dcfc982388dceadfd8f254544943bd7` |
| Draw ID / mode / state       | `1 / non-strict / SETTLED`                                           |
| Open transaction             | `0xc6f1d7239be48019b62d493082559f097da036ea90684a96982a85ad07ade9e7` |
| Open / end                   | `2026-08-12 15:45:36 / 15:47:36 UTC`                                 |
| Settlement transaction       | `0x5af934699595eb9adb0507ed1d5a5de64470771b269cdbb99e5caca67c01764e` |
| Settlement block / time      | `11474217 / 2026-08-12 15:58:48 UTC`                                 |
| Effective/base/yield totals  | `125 / 125 / 132`                                                    |
| Realised yield / prize       | `5,000,000 / 4,734,848` base units                                   |
| Seeder key persistence       | `false`                                                              |

The draw settled 13 minutes 12 seconds after opening. The 120-second draw period and 30-second settlement delay were
honored; the remaining time was real Sepolia pagination and receipt latency for 8 pre-sync, 10 PASS A, aggregate proof,
randomness, and 15 PASS B transactions.

`scripts/verify-draw.ts` passed all six public checks: event completeness, aggregate proof binding, range partition,
randomness commitment, mode-appropriate reveal transcript, and prize conservation. The full live integration suite
reports **3 passing**: bytecode/topology/timing, minimum participant set, and a real settled draw.

The default Sepolia RPC does not retain the historical `participantCount()` state at the draw-open block. For
`--latest-settled` only, the verifier therefore uses the Draw Manager's retained current `participantSnapshot` after
confirming that the requested draw is still the current draw and the state is exactly `SETTLED`. Older draws continue to
require an archive-capable RPC; this fallback cannot silently verify them against a newer snapshot.

## HCU And Privacy

Fresh Gate 3 evidence from 2026-08-12 is in `artifacts/hcu-benchmark.json` and `docs/BENCHMARK.md`.

- Pre-sync: measured max `8`, cap `4`.
- PASS A: measured max `6`, cap `3`; estimate drift `-15.6%`.
- PASS B: measured max `4`, cap `2`; estimate drift `+4.0%`.
- Largest absolute estimate drift is below the 50% escalation threshold.
- Public decryption p50/p95: `2665 / 3609 ms`; user decryption p50/p95: `2744 / 3148 ms`.
- Static privacy scan and the dynamic ACL suite pass; every participant receives exactly one grant on their own credit.

## Frontend

- Canonical URL: [https://lok-protocol.vercel.app](https://lok-protocol.vercel.app)
- Legacy alias: [https://frontend-xi-tawny-54.vercel.app](https://frontend-xi-tawny-54.vercel.app)
- Vercel project: `lok-protocol-app`; Git root directory: `frontend/`; runtime: Node.js `22.x`.
- GitHub source: [duclucky/lok-protocol](https://github.com/duclucky/lok-protocol), private pending submission
  publication.
- Git production deployment: `dpl_9pjjjVU6E8AyYNnWEYztHQHL7xQs`, built from `main` commit
  `c7ad99b0b4b713f4cbe19e3219e1192f696c8cbb`.
- Immutable deployment URL:
  [https://lok-protocol-iim3seyew-duckys-projects-bc83c6a0.vercel.app](https://lok-protocol-iim3seyew-duckys-projects-bc83c6a0.vercel.app)
- `frontend/.env.production` and `frontend/src/contracts/addresses.ts` contain the canonical addresses above.
- Local Node 22 evidence: 58/58 frontend tests and a successful TypeScript/Vite production build.
- Private reads remain permit-gated and user-triggered; the winner and loser use the same result-check flow.

Post-publish smoke on 2026-08-12 passed:

- Browser `/`: draw #1 is `SETTLED`, participant count is `30`, prize is `4.73 cUSDC`, and the footer links the
  canonical Vault and Draw Manager.
- Browser `/draw`: state is `SETTLED`, sweep is `30 / 30`, total ticket space is `125`, and the UI verifier request
  completes without console warnings or errors.
- HTTP `/`, `/draw`, and `/fhevm/tfhe_bg.v1.6.2.wasm`: all return `200` with `Cross-Origin-Opener-Policy: same-origin`
  and `Cross-Origin-Embedder-Policy: require-corp`.
- The TFHE asset is served as `application/wasm`.

The Git-connected deployment was smoke-tested again on 2026-08-13 with the same results. Vercel metadata binds it to the
private GitHub repository, `main` branch, and exact commit above.

## Operational Notes

The deployment has no proxy rollback. A replacement requires a new preserved history manifest, full proof/test gates,
fresh deployment identities, source verification, address export, seeding, a real settled draw, and verifier evidence.
Never silently repoint `deployments/sepolia.json` at different bytecode.
