# P-S2 Independent Hand-Proof Re-review Record

- **Date:** 2026-08-13
- **Reviewer:** Codex independent audit context (not the production-code or proof-remediation author)
- **Review target:** `024a385a44353dc6203971d1ab8164827dff705f`
- **Method:** read-only source, proof, reference-model, frozen-criterion, and committed-artifact cross-check
- **Hand-proof verdict:** `APPROVED`
- **Full P-S2 verdict:** `BLOCKED`

## Separation And Scope

The reviewer did not author the production contracts, invariant handlers, reference models, proof remediation, or
Sepolia execution manifest. The review did not modify the frozen proposition in `docs/10-proof-strategy.md` section 3.

This verdict approves only the P-S2 hand proof and its implementation correspondence. It does not substitute for the
state-changing Sepolia Groups A and B required by the frozen integration criterion. No test, invariant campaign,
deployment, public-decryption request, relayer request, or Sepolia transaction was run during this re-review.

## Findings Disposition

| Finding | Independent disposition |
| --- | --- |
| Mathematical and authorization base cases were conflated | Closed. Production starts with `A=L=P=0`, `riskEpoch=1`, and `lastSolventRiskEpoch=0`; epoch 1 is initially unauthorized. |
| Normalized `tEnd`, `W=0`, and fixed-point allocation cases were incomplete | Closed. The proof derives `baseRisk_i<=yieldWeight_i`, `D=W-B`, handles `W=0` before harvest/division, and proves allocation at most `Y` for `W>0`. |
| Foundry settlement abstraction was presented as exact production correspondence | Closed. The package now limits it to its plaintext balance/theta abstraction and assigns production `tEnd` correspondence to the hand proof and integration evidence. |
| Adapter full return was presented as vault-enforced | Closed. It is explicitly an external supported-adapter postcondition; arbitrary `IYieldAdapter` implementations are not covered. |
| Foundry forged-checkpoint selector was treated as cryptographic evidence | Closed. It is limited to abstract identity/no-mutation behavior; Hardhat and pending Sepolia evidence remain separate. |
| Aggregate overflow proof used unsupported `W<2^52` | Closed. The corrected proof derives `W<2^58`, `YB<2^122`, and the Fortune-adjusted prefix bound `E<2^59<2^64`. |

## Independent Mathematical Re-derivation

With `Q=2^26`, `DRAW_PERIOD<=2^20`, and instantaneous aggregate participant balance below ERC-7984 total supply:

```text
sum_i yieldDelta_i < 2^64 * 2^20 = 2^84
W = sum_i floor(yieldDelta_i / Q) < 2^58
0 <= B <= W
```

For funded allocation:

```text
Y * B < 2^64 * 2^58 = 2^122 < 2^256
Y * Q < 2^90
directWide_i = d_i * directRate <= YQ < 2^90 < 2^128
prize + sum_i direct_i <= Y(B + D)/W = Y
```

For the winner prefix:

```text
baseRisk_i * fortune_i < 2^58 * 52 = 13 * 2^60 < 2^64
E = sum_i effective_i <= 1.5B < 2^59 < 2^64
```

The effective prefix therefore does not wrap. Frozen P-F7 applies to the ordinary half-open partition of `[0,E)`, so
the prize is issued exactly once in a non-void winning draw and zero times otherwise. This closes the dependency needed
to treat the single `prize` term as total issued prize liability in the P-S2 funded-allocation inequality.

The principal-first debit equations, exactly-once PASS-A/PASS-B cursor argument, accounting-version closure, and
oracle-independent recovery paths were also checked against the production transitions and accepted.

## Existing Machine Evidence Cross-check

The committed safety artifact records 22 selectors, `10,000,004` sequences, depth `32`, `320,000,128` calls,
`14,550,605` settlement calls, 28 unique shards, 28 zero exit codes, and zero reported reverts. Selector call counts sum
to the recorded total call count. This confirms that the frozen `>=10^7` reference-sequence threshold is met, while the
documented abstraction and cryptographic limitations remain in force.

## Residual Obligations

- Sepolia Group A shared-deployment state-changing lifecycle remains unauthorized and unexecuted.
- Sepolia Group B disposable adapter lifecycle remains unauthorized and unexecuted and requires its timelock delay.
- Receipts, negative cases, exact handle/risk-epoch/nonce binding, and raw-log hashes require independent review after
  those executions.
- P-P1 remains `WEAKER-THAN-CLAIMED` and is outside this P-S2 hand-proof approval.

## Sign-off

```text
P-S2 hand proof: APPROVED
Full P-S2: BLOCKED
P-P1: WEAKER-THAN-CLAIMED
```

This approval does not authorize any Sepolia transaction or ETH spend.
