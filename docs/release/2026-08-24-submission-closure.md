# Submission Technical Closure - 2026-08-24

## Scope And Source Binding

- Candidate parent commit: `5e0744738de9b1973447fecc77f40e20b22d2530`.
- Release source: the commit containing this record. GitHub Actions and the Vercel footer must resolve the exact final
  SHA before publication is accepted.
- Public repository: [github.com/duclucky/lok-protocol](https://github.com/duclucky/lok-protocol).
- Canonical application URL: [lok-protocol.vercel.app](https://lok-protocol.vercel.app).
- Frozen `docs/10-proof-strategy.md` section 3 was not edited.
- No state-changing Sepolia transaction was signed or sent during this closure run.

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

## Remaining Publication Gates

1. Commit this record and the scoped release changes.
2. Push the exact commit and require the `Main` GitHub workflow to succeed on Node.js 22.
3. Confirm Vercel publishes that exact green commit and the canonical alias returns `Ready`.
4. Run read-only production smoke for headers, WASM MIME, six routes, console health, responsive overflow and footer SHA
   equality.
5. Stop for owner approval before any state-changing browser smoke.
