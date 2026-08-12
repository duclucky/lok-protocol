# P-F2 Modulo Bias Bound

**Status:** PASS, same-context owner-delegated review on 2026-08-11. This is not an independent review.

## Claim

Let `M = 2^64` and let `N = totalTickets`, with `1 <= N <= 2^64 - 1`. If `X` is uniform over the `M` possible `uint64`
values and Lok maps it to `Y = X mod N`, then the maximum relative deviation of any ticket from the ideal probability
`1/N` is at most:

```text
N / 2^64
```

This is the frozen P-F2 bound. It concerns the modulo mapping only; raw `FHE.rand` uniformity is the P-F4 Zama platform
trust boundary.

## Derivation

Write:

```text
M = qN + s
q = floor(M / N)
s = M mod N, where 0 <= s < N
```

Exactly `s` output tickets have `q + 1` preimages under modulo reduction. The remaining `N - s` tickets have `q`
preimages. If `s = 0`, every ticket has exactly `q` preimages and the bias is zero.

For a heavy ticket, the relative deviation from `1/N` is:

```text
((q + 1) / M - 1 / N) / (1 / N)
= (N - s) / M
```

For a light ticket, the relative deviation is:

```text
(1 / N - q / M) / (1 / N)
= s / M
```

Therefore:

```text
maxRelativeDeviation = max(s, N - s) / M    when s != 0
maxRelativeDeviation = 0                     when s == 0
```

Because `0 < s < N` in the non-divisible case, both `s < N` and `N - s < N`. Thus:

```text
maxRelativeDeviation < N / 2^64
```

The implementation uses the frozen non-strict criterion `<= N / 2^64`, which follows immediately.

## Executable Check

`scripts/run-fairness.ts` computes `s`, `max(s, N - s)`, and the common denominator `2^64` for every scenario.
`test/statistical/fairness.t.ts` checks a concrete non-divisible boundary and all four published scenarios require
`withinFrozenBound == true`.

The generated evidence is in `artifacts/fairness.json`. The four measured ticket totals are checked without
floating-point arithmetic in the bound itself.

## Trust Boundary

The Monte Carlo runner uses SplitMix64 only as a deterministic, reproducible source of full-width uniform `uint64` test
inputs. It does not claim to test the cryptographic construction or uniformity of Zama's `FHE.rand` output. P-F4
explicitly assigns that guarantee to the Zama platform. Lok proves and tests only the application-controlled mapping
from a uniform 64-bit input into the half-open prefix partition.

## Review Boundary

The same implementation context wrote and reviewed this derivation because the owner prohibited agents and directed work
to continue in this task. Algebra, executable checks, and generated evidence agree, but the plan's independent-review
separation was waived rather than performed.
