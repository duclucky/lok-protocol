# Lok Protocol - Three-Minute Video Script

**Human-only rule:** record with a real person and real voice. Do not use generated voice or video. Record only after
draw `#1` is settled and `scripts/verify-draw.ts` passes against Sepolia.

## Recording Setup

- Use a fresh browser profile and a fresh Sepolia wallet.
- Pre-open the production app, Etherscan contract tabs, `docs/BENCHMARK.md`, `artifacts/fairness.png`, and a terminal.
- Keep the terminal at a legible font size with the verifier command ready.
- Record a successful fallback take locally before publishing.
- Replace the README video line with the final public URL before submission.

## Shot List And Spoken Script

| Time      | Screen                                               | Spoken line                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00-0:25 | Lok home, then NS&I and PoolTogether references      | “Prize-linked savings is already a mass-market product. NS&I reported GBP 134.6 billion in eligible Premium Bonds at the end of 2025. PoolTogether brought the model on-chain and reports more than ten million dollars in prizes, but public draw history can expose who won. Lok asks whether verification can stay public while the saver stays private.”           |
| 0:25-0:55 | Fresh wallet, Get test tokens, shielding warning     | “This is Lok on Ethereum Sepolia. The demo token flow is explicit: shielding public USDC reveals that shield amount, so the confidential deposit is a separate later transaction. The default path starts with already-confidential cUSDC.”                                                                                                                            |
| 0:55-1:20 | Deposit, sealed balance, default 100% risk           | “The deposit amount, vault balance and risk setting are encrypted. At the default one hundred percent setting, all of this saver’s yield contribution enters periodic prizes, which is the specification-exact path.”                                                                                                                                                  |
| 1:20-1:40 | Risk Dial at 25%                                     | “The Risk Dial is an opt-in extension. This preference is itself encrypted. It changes the saver’s prize exposure without publishing a personal financial choice or rewarding somebody for not saving.”                                                                                                                                                                |
| 1:40-2:10 | Draw page with 30 participants and paginated cursors | “FHE changes the algorithm. Encrypted division and ciphertext branching are unavailable, and a sequential encrypted sum reaches the transaction-depth ceiling around thirty users. Lok updates eTWAB when users transact, decrypts only allowlisted aggregate totals, and runs two bounded passes. Deposits and withdrawals remain available while the draw advances.” |
| 2:10-2:30 | Two wallets use the same Check my result action      | “Every participant receives the same encrypted credit path and the same ACL pattern. Losers decrypt zero; exactly one participant decrypts the prize. A winner-only claim would publish the winner, so Lok has no such function.”                                                                                                                                      |
| 2:30-2:48 | Terminal runs verifier                               | “Now an independent public verifier replays the settled transcript, checks the committed evidence, complete participant processing, interval construction and prize conservation.” Pause until every check prints PASS.                                                                                                                                                |
| 2:48-3:00 | Benchmark and verified addresses                     | “The current Sepolia caps are measured, not estimated: three participants in PASS A and two in PASS B at a sixty-percent safety cap. All five deployed contracts are source-verified. Lok makes the privacy boundary inspectable.”                                                                                                                                     |

## Required On-Camera Evidence

1. The production URL and Sepolia network indicator.
2. The public shielding warning before any shield transaction.
3. A confidential deposit and encrypted setting transaction from the fresh wallet.
4. Draw `#1` in `SETTLED`, with pagination visible in its recorded history.
5. The identical “Check my result” action for two participant wallets.
6. `scripts/verify-draw.ts` printing PASS for the real settled draw.
7. The measured HCU table and verified Etherscan source links.

Do not claim a live Morpho integration. The deployed adapter is `MockYieldAdapter`; `IYieldAdapter` is the reviewed
production integration boundary.
