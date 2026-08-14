# P-P1 Owner Decision Memo

**Status: OPTION 2 OPENED FOR RE-REVIEW ON 2026-08-15. Frozen section 3 is unchanged.**

Owner approval in the audit thread opened a separate P-P1 re-review round. The active re-review charter is
[`P-P1-re-review-charter-2026-08-15.md`](./P-P1-re-review-charter-2026-08-15.md). This memo remains the provenance
record for the decision; it does not reclassify P-P1. Until the chartered campaign, independent review and explicit
owner re-freeze complete, the authoritative verdict remains **P-P1 WEAKER-THAN-CLAIMED**.

## Current Finding

Frozen P-P1 says the winner is not derivable from the full event log without a private key. Its frozen pass criterion is
stricter: **no event field differs between winner and any loser**.

The controlled FHEVM runs classify this as CASE 2: protocol-log nondeterminism is not winner-correlated in the tested
classifier, but the frozen byte-identity criterion still fails. Entry 301 is the local FHEVM Executor event
`FheLe(address indexed caller, bytes32 lhs, bytes32 rhs, bytes1 scalarByte, bytes32 result)` emitted by the
`LokDrawManager.crankB -> _processPassB -> FHE.le(rangeStart[user], draw.r)` path. The opaque random/comparison handles
differ across counterfactual runs. Entry 301 remains in every full transcript and is not normalized, filtered or
ignored.

Current verdict: **P-P1 WEAKER-THAN-CLAIMED**. The current 25 held-out executions and 20% accuracy equal the five-class
random baseline, but that statistical result cannot satisfy the frozen byte-identity criterion.

## Owner Options

### Option 1: Keep The Frozen Criterion

- Do not edit P-P1.
- Keep entry 301 and all raw topics/data in evidence.
- Accept that P-P1 cannot become `MATCHES` while any full-log field differs.
- Disclose `WEAKER-THAN-CLAIMED` in the submission and do not claim full proof closure.

This has the strongest traceability and no governance change, but it leaves a permanent proposition-level gap even
though no tested public observer extracted the winner.

### Option 2: Explicitly Re-review And Re-freeze A Non-derivability Criterion

Recommended candidate statement:

> Given the complete public transcript, including every application and protocol log topic/data byte, no observer in the
> pre-registered public-transcript attack class identifies the winner with more than 5 percentage points absolute
> advantage over uniform guessing among the participant set.

Recommended tier/tool: **Tier D; full-transcript adversarial classifier + structural ACL/call-shape gate + mutation
positive controls**.

Candidate pass criterion for owner/reviewer consideration:

1. Use five fixed public participant identities/positions and at least 1,000 balanced independent executions, 200 per
   winner position. Freeze the generation protocol and split before model fitting: 500 train, 500 held-out test.
2. Feed classifiers the complete ordered transcript: emitter, every topic, every data byte, receipt/log ordering, gas
   and public call boundary. Include FheLe entry 301 unchanged. Do not drop event classes, topic slots, data payloads or
   opaque handles, and do not use winner labels to define normalization.
3. Pre-register at least three materially different public-observer families, including sequence/shape features,
   byte-offset or byte-n-gram features, and ACL/emitter/call-boundary features. The final held-out set is evaluated
   once.
4. For five participants, uniform baseline is 20%. Require the one-sided 99% Wilson upper confidence bound of each
   held-out classifier's accuracy to be no greater than 25%, and a label-permutation test p-value of at least 0.01.
5. Mutation controls must inject a winner-correlated bit separately into an indexed topic, data payload, emitter/call
   shape and ACL recipient. Each mutation must be detected with at least 95% held-out accuracy; otherwise the harness is
   not sensitive enough and the result is void.
6. P-P2 uniform ACL, P-P5 gas/HCU symmetry, the no-winner-only ABI gate, and the full raw-transcript retention check
   must all pass on the exact code/evidence commit.
7. The report must state the limitation honestly: this establishes indistinguishability against the registered attack
   class, not a universal cryptographic proof against every possible observer.

The 1,000-run/25% numbers are proposed criteria, not frozen requirements. They must be accepted or changed during the
re-review; they cannot be retroactively tuned after seeing held-out results.

## Re-review And Re-freeze Procedure

1. Owner explicitly opens P-P1 only for re-review. Proposition count remains 42; no other row is edited.
2. A privacy reviewer independent of the implementation and evidence author reviews the candidate statement, threat
   model, epsilon, sample size, classifier families and mutation controls before evidence generation.
3. Commit the approved candidate criterion and test protocol as a review draft, not a frozen PASS.
4. Run mutation controls first. Any missed injected leak invalidates the harness.
5. Run the pre-registered balanced campaign once, preserve every raw transcript including entry 301, and commit the
   train/test split, seeds, exact code commit and report hashes.
6. The independent reviewer audits raw transcript inclusion, absence of label-derived preprocessing, statistics and
   reproducibility. A same-context AI sign-off is not independent.
7. Only if the criterion and independent review pass may the owner re-freeze P-P1 with a new freeze date and explicit
   change note. Until that point, the authoritative verdict remains `WEAKER-THAN-CLAIMED`.

## Recommendation

Choose Option 2 only if the bounty submission needs a claim aligned with practical public-observer privacy. Choose
Option 1 if preserving the original byte-identity promise is more important than closure. No production-contract change
is justified by current evidence, and changing tests to omit FheLe entry 301 is not an acceptable option.
