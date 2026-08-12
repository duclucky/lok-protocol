# Lok Protocol - X Thread Draft

**Human-only rule:** review current links and figures, attach real screenshots, then publish from the human account. Do
not publish this draft automatically.

## Post 1

Prize-linked savings has a privacy problem on-chain.

NS&I reported GBP 134.6B in eligible Premium Bonds at the end of 2025. PoolTogether reports $10M+ in prizes, while its
public draw history lets people inspect winners.

I built Lok on @zama FHEVM to keep the draw verifiable and the saver private. Thread:

## Post 2

Lok is a confidential prize-linked savings vault on Ethereum Sepolia.

Balances, risk settings, time-weighted odds, winner ranges and prize credits remain ciphertexts. Only allowlisted
aggregate draw evidence is publicly decrypted. Numeric principal, liabilities and custody assets are never published.

## Post 3

The subtle privacy bug: granting decryption rights only to the winner identifies the winner through the ACL footprint.

Lok grants every participant access to their own credit handle. One decrypts to a prize; the rest decrypt to zero. Same
function, same event shape, same result button.

## Post 4

FHE forces a different draw algorithm.

- no branch on a ciphertext
- no division by an encrypted divisor
- sequential encrypted accumulation hits transaction depth around 30 users

So weighted reservoir sampling and the Gumbel trick do not rescue the naive design.

## Post 5

Lok’s answer:

1. update encrypted time-weighted accumulators when users transact;
2. freeze the exact draw-end snapshot;
3. publicly decrypt only aggregate totals;
4. carry an encrypted prefix through bounded two-pass pagination.

Users can still deposit and withdraw mid-draw.

## Post 6

The caps are measured on Sepolia:

- pre-sync: 2,430,032 HCU/user, cap 4
- PASS A: 3,001,192 HCU/user, cap 3
- PASS B: 4,025,320 HCU/user, cap 2

At 1,000 participants the variable path is 1,084 transactions. That limit is disclosed, tested and reproducible.

## Post 7

Fairness evidence: 2,000,000 deterministic Monte Carlo draws across base and Fortune-adjusted scenarios. Every
positive-weight category stayed inside simultaneous 99% intervals; zero-weight users never won.

[Attach `artifacts/fairness.png`]

## Post 8

Live demo: https://frontend-xi-tawny-54.vercel.app

Verified Sepolia Vault: https://sepolia.etherscan.io/address/0xAA7B956c551B7f5336c2d9e786CB9024aB1657e1#code

Verified Draw Manager: https://sepolia.etherscan.io/address/0x5592dB13624EB5C20B6Bb5841317148c79DFFAa5#code

[Add public repository URL, video URL and settled draw verifier screenshot before publishing.]

## Source Check Before Publishing

- NS&I 2025 figures: https://nsandi-corporate.com/news-research/news/premium-bonds-2025-year-figures
- PoolTogether overview: https://docs.pooltogether.com/welcome
- PoolTogether winner visibility: https://docs.pooltogether.com/welcome/faq
- Lok benchmark: `docs/BENCHMARK.md`
- Lok deployment: `docs/DEPLOYMENT.md`
