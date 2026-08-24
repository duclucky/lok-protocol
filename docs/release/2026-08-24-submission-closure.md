# Submission Technical Closure - 2026-08-24

## Scope And Source Binding

- Candidate parent commit: `5e0744738de9b1973447fecc77f40e20b22d2530`.
- Released application source: `48dce5ba6f289d3121591fb56ee6b0d883fcb841`.
- Live-smoke receipt ledger: `docs/release/2026-08-24-live-smoke-evidence.json`.
- Public repository: [github.com/duclucky/lok-protocol](https://github.com/duclucky/lok-protocol).
- Canonical application URL: [lok-protocol.vercel.app](https://lok-protocol.vercel.app).
- Frozen `docs/10-proof-strategy.md` section 3 was not edited.
- State-changing live smoke was separately owner-approved with hard caps of 46 transactions, 68,000,000 gas and 0.15
  Sepolia ETH.

The local shell was Node.js `24.11.1` with npm `11.18.0`. The browser matrix explicitly ran under Node.js 22, the GitHub
workflow is pinned to Node.js `22.x`, and Vercel uses Node.js `22.x`. Tested protocol dependencies are Hardhat `2.28.6`,
`@fhevm/solidity` `0.11.1`, `@fhevm/hardhat-plugin` `0.4.2`, `@openzeppelin/confidential-contracts` `0.5.2`, and Zama
React/TypeScript SDK `3.4.0`.

## Deployment Roles

`deployments/sepolia.json` is the unseeded 60/24/120/300 P-S2 evidence stack. It is the canonical contract-integrity
manifest and is expected to have no demo participants or settled demo draw.

`deployments/history/sepolia-2026-08-13-120-30-180-600.json` is the seeded live-demo stack used by the public frontend
and settled-draw verifier. Keeping these roles separate prevents demo-only participant and settlement expectations from
being applied to the P-S2 evidence deployment.

## Local Release Matrix

| Gate                                                                         | Result                                                                  |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run prettier:check`                                                     | PASS - all maintained source matched Prettier                           |
| `npm run lint:sol`                                                           | PASS - zero Solhint warnings                                            |
| `npm run lint:ts`                                                            | PASS                                                                    |
| `npm run compile`                                                            | PASS - Solidity compile and TypeChain generation                        |
| `npm run build:ts`                                                           | PASS                                                                    |
| `npm test`                                                                   | PASS - 196 passing, 7 pending                                           |
| `npm run privacy:validate`                                                   | PASS - read-only privacy scan                                           |
| `npx hardhat test test/integration/SepoliaDeployment.t.ts --network sepolia` | PASS - 3 passing                                                        |
| `npm --prefix frontend run test`                                             | PASS - 115 passing                                                      |
| `npm --prefix frontend run build`                                            | PASS - 4 non-empty FHEVM WASM assets; initial route chunk 890,586 bytes |
| `npm --prefix frontend run e2e`                                              | PASS - 68 passing, 2 desktop-only skips, 70 total across five viewports |
| `git diff -- docs/10-proof-strategy.md`                                      | PASS - empty                                                            |
| `git diff --check`                                                           | PASS - no whitespace errors; Windows line-ending notices only           |

The first sandboxed E2E invocation stopped before test discovery because npm could not write its user cache (`EPERM`).
The identical command was rerun with cache access and completed the full matrix successfully.

## Read-Only Public Draw Verification

Command:

```powershell
$env:LOK_VERIFY_MANIFEST="deployments/history/sepolia-2026-08-13-120-30-180-600.json"
$env:LOK_VERIFY_LATEST_SETTLED="1"
npx hardhat run scripts/verify-draw.ts --network sepolia
```

Result for draw `#4`, settlement block `11493487`, participant snapshot source `current-settled`:

| Public check            | Result                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------ |
| Event completeness      | PASS - exactly one `DrawOpened` and one `DrawSettled`                                |
| Aggregate proof binding | PASS - decrypted aggregate handles equal accepted totals                             |
| Range partition         | PASS - reviewed bytecode matches and every snapshotted participant was consumed once |
| Randomness commitment   | PASS - committed handle matches state and `r` is inside the ticket interval          |
| Reveal transcript       | PASS - strict reveal transcript is not required for this non-strict draw             |
| Prize conservation      | PASS - aggregate prize credits equal `prizeAmount`                                   |

## Frontend Release Semantics

- Settlement writes encrypted prize-or-zero credit uniformly; it does not expose a winner-only claim function.
- **Claim / check prize** privately decrypts only the connected wallet's credit through EIP-712.
- A winner recovers principal plus credited winnings through confidential cUSDC withdrawal; a loser retains full
  principal.
- The recurring operator runs `scripts/crank.ts`. The Draw page defaults to depositor-facing status and provides a
  separate Demo progress view with a permissionless manual fallback.
- The build reads the installed Zama React SDK version and binds `VITE_SOURCE_COMMIT` from `VERCEL_GIT_COMMIT_SHA`.
  Unbound local builds render `unbound-local-build` rather than a fabricated SHA.

## Publication And Live-Smoke Closure

- GitHub Actions `Main` run [#32680627309](https://github.com/duclucky/lok-protocol/actions/runs/32680627309) passed on
  exact source commit `48dce5ba6f289d3121591fb56ee6b0d883fcb841`.
- Vercel production deployment `dpl_FP6sxVnkTHR33zDESmMEAs77cGEv` is `Ready`; the canonical alias
  [lok-protocol.vercel.app](https://lok-protocol.vercel.app) resolves to that deployment.
- Production returned HTTP 200, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`
  and `application/wasm` for the FHEVM WASM asset.
- Vault, Deposit, Risk, Draw, Proof and Why Encrypted loaded without horizontal overflow or browser console errors. The
  footer reported FHEVM SDK `3.4.0` and source `48dce5b`.
- The owner-approved browser smoke used wallet `0xC495ef51618D03267A1f227aFe5b27B38c748272` with Chrome and OKX Wallet.
  It completed mock-token mint, shielding, vault operator authorization, confidential deposit, private balance read,
  draw `#5`, private prize-credit read and confidential withdrawal.
- The draw keeper used `0x8e7939E23a012143e5182d7173DAD42B2006c2b8` and the seeded live-demo manifest. Draw `#5`
  completed 8 pre-sync batches, 11 PASS-A batches, aggregate public decryption/submission, FHE randomness and 16 PASS-B
  batches before settlement.
- All 43 receipts succeeded. Actual usage was 56,808,227 gas and 0.06538403008685191 Sepolia ETH, below every approved
  cap. Private decrypted balances, prize outcome and winner identity are intentionally omitted.

## Operational Residual

`scripts/crank.ts` performs the full state-derived keeper cycle, but no repository-managed 24/7 scheduler is deployed.
The public UI retains a permissionless manual fallback. Hosting a recurring signer requires a separate owner decision on
secret custody, execution frequency, concurrency and recurring Sepolia ETH spend.
