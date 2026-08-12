# Task 17 Draw Verifier Review

**Date:** 2026-08-11  
**Verdict:** `APPROVED_WITH_RESIDUAL_OBLIGATIONS`  
**Review context:** Owner-delegated same-context review. This is not an independent implementation context.

## Reviewed surface

- `scripts/verify-draw.ts`
- `test/scripts/verify-draw.t.ts`
- Public interfaces and events of `LokDrawManager` and `LokVault`
- Verified public-decryption API in `docs/API-VERIFIED.md`

## Findings

- The verifier never requests user decryption, reads per-user ciphertext values, or determines the winner. It decrypts
  only the allowlisted draw aggregates and post-settlement random value.
- It exits non-zero when any check fails and has focused rejection tests for forged totals, wrong commitment, wrong or
  unaccepted reveal, missing boundary/credit events, runtime provenance mismatch, and prize-conservation mismatch.
- Aggregate totals are compared with the exact public handles stored for the draw. `r` must match the committed handle
  and lie in `[0, totalTickets)`.
- The range-partition check is intentionally non-decrypting: Etherscan-verified Vault/Draw runtime hashes must match the
  manifest, and PASS B must emit exactly one credit event for every participant in the historical draw snapshot. The
  algebraic half-open interval proof remains P-F7's reviewed Tier-A evidence; the verifier does not pretend to reveal
  private ranges.
- RPC log queries are chunked to 5,000 blocks so verification does not rely on a provider accepting an unbounded range.

## Residual obligations

1. Run the verifier against a real settled Sepolia draw in Task 18. Local fixtures do not prove relayer/RPC integration.
2. The current contract emits no commit/reveal events. For strict draws, `--transcript` supplies public transaction
   hashes; the verifier fetches and validates each receipt/calldata pair and the final XOR accumulator, but standard
   logs cannot prove the supplied list is exhaustive. The default non-strict deployment path is unaffected.
3. This review shares context with implementation because the owner prohibited additional agents. It must not be
   represented as independent third-party sign-off.
