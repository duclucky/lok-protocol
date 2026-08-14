# P-P1 Re-review Charter

- **Re-review ID:** `P-P1-RR-2026-08-15`
- **Opened by:** owner approval in the audit thread on 2026-08-15
- **Scope:** P-P1 only
- **Status:** `OPENED_NOT_FROZEN`
- **Authoritative current verdict:** `WEAKER-THAN-CLAIMED`

This charter opens a separate P-P1 re-review round. It does not edit, supersede or satisfy the frozen
`docs/10-proof-strategy.md` section 3 row. Until this re-review is completed, independently reviewed and explicitly
re-frozen by the owner, the original P-P1 verdict remains `WEAKER-THAN-CLAIMED`.

## Frozen Row Under Review

Current frozen statement:

> Winner is not derivable from the full event log without a private key.

Current frozen pass criterion:

> No event field differs between winner and any loser.

Current counterexample:

- All application-level prize logs are byte-identical across forced winners.
- The full raw protocol transcript differs at entry 301.
- Entry 301 is the local FHEVM Executor
  `FheLe(address indexed caller, bytes32 lhs, bytes32 rhs, bytes1 scalarByte, bytes32 result)` event emitted by
  `LokDrawManager.crankB -> _processPassB -> FHE.le(rangeStart[user], draw.r)`.
- The differing fields are opaque FHE handles (`rhs` and `result`), not decrypted values or application events.
- Because at least one full-log field differs, the frozen byte-identity criterion is not met.

Primary evidence:

- `docs/proofs/P-P1-forensic-2026-08-13.md`
- `docs/proofs/P-P1-owner-decision-memo-2026-08-13.md`
- `artifacts/privacy/p-p1-forensic.json`

## Draft Replacement Statement For Re-review

Candidate P-P1 statement, not yet frozen:

> Given the complete public transcript, including every application and protocol log topic/data byte, no observer in
> the pre-registered public-transcript attack class identifies the winner with more than 5 percentage points absolute
> advantage over uniform guessing among the participant set.

Candidate tier/tool:

```text
Tier D: full-transcript adversarial classifier
        + structural ACL/call-shape gate
        + mutation positive controls
        + independent privacy review
```

This replacement does not claim universal cryptographic indistinguishability. It claims indistinguishability against a
pre-registered public-transcript observer class, while preserving the full FHEVM protocol logs including entry 301.

## Non-negotiable Rules

1. Do not remove, normalize, filter, hash away or bucket FHEVM Executor/ACL logs.
2. Do not drop event topics, data bytes, emitters, log indices, receipt ordering, gas, call boundaries or opaque handles.
3. Do not use winner labels to define preprocessing, feature selection, normalization or split boundaries.
4. Do not tune sample size, epsilon, classifier families, mutation controls or thresholds after seeing held-out results.
5. Do not edit any P-S proposition, P-O1, P-P2 or P-P5 as part of this re-review.
6. Do not change production contracts merely to make this privacy criterion pass unless a separate production bug is
   identified and approved.
7. Do not claim P-P1 `MATCHES` under the frozen criterion while entry 301 or any other full-log field differs.

## Pre-registered Dataset

- Participants: exactly five fixed public participant identities/positions.
- Runs: at least 1,000 balanced independent executions.
- Balance: exactly 200 executions per forced winner position.
- Split: freeze before fitting.
  - Train: 500 executions.
  - Held-out: 500 executions.
- Split artifact must record:
  - code commit,
  - seed list,
  - winner labels,
  - train/test assignment,
  - transcript hash for every execution,
  - raw transcript path for every execution.

Every raw transcript must include:

- all application logs,
- all FHEVM Executor logs,
- all ACL logs,
- emitter address,
- every topic,
- full data payload,
- receipt/log ordering,
- transaction hash,
- gas used,
- public call boundary / step label,
- decoded event name and arguments when ABI decoding is available.

## Pre-registered Observer Families

At minimum, implement and evaluate these materially different public-observer families:

1. **Sequence/shape observer**
   - emitter class,
   - topic0 sequence,
   - topic count,
   - data length,
   - receipt index,
   - log index,
   - transaction step label,
   - decoded event name and argument names.

2. **Byte observer**
   - complete topic/data byte n-grams,
   - byte offsets,
   - event-local byte positions,
   - no semantic decryption or private handle mapping.

3. **ACL/emitter/call-boundary observer**
   - raw emitter address,
   - ACL recipient/event shape,
   - FHEVM Executor event class,
   - call-boundary order,
   - gas and HCU summary fields if available publicly.

Additional observers may be added before the campaign starts. None may be added after held-out results are known.

## Statistical Pass Criterion

For five participants, the uniform baseline is 20%.

Each held-out classifier must satisfy both:

1. Accuracy bound:
   - held-out sample count: 500,
   - correct predictions: `<= 102`,
   - measured accuracy: `<= 20.4%`,
   - one-sided 99% Wilson upper confidence bound: `<= 25%`.

2. Label-permutation check:
   - p-value: `>= 0.01`.

If any pre-registered classifier exceeds either bound, the re-review fails.

## Mutation Positive Controls

Before the main campaign, the harness must prove sensitivity by detecting deliberately injected winner-correlated leaks.

Required mutations:

1. winner-correlated indexed topic bit,
2. winner-correlated data payload bit,
3. winner-correlated emitter or call-shape bit,
4. winner-correlated ACL recipient asymmetry.

Each mutation must be detected with at least 95% held-out accuracy. If any mutation is missed, the harness is void and
the main campaign result cannot be used.

## Required Companion Gates

The exact code/evidence commit used for the P-P1 re-review must also satisfy:

- P-P2 uniform ACL grant multiset check,
- P-P5 gas/HCU symmetry check,
- no winner-only ABI/event gate,
- full raw-transcript retention check,
- privacy scanner must continue to report the original frozen P-P1 residual unless and until the owner explicitly
  re-freezes P-P1.

## Review Decision Matrix

| Condition | Result |
|---|---|
| Frozen section 3 edited before independent review | re-review invalid |
| Any raw protocol log omitted or normalized | re-review invalid |
| Any mutation control missed | re-review invalid |
| Any classifier has `>102/500` held-out correct predictions | re-review fails |
| Any classifier has permutation p-value `<0.01` | re-review fails |
| Companion gates fail | re-review fails |
| All criteria pass and independent reviewer approves | eligible for owner re-freeze |

## Handoff Prompt For Coding Agent

```text
You are implementing the P-P1 re-review campaign harness for Lok Protocol. Do not change production contracts and do
not edit docs/10-proof-strategy.md.

Read:
- docs/proofs/P-P1-re-review-charter-2026-08-15.md
- docs/proofs/P-P1-forensic-2026-08-13.md
- docs/proofs/P-P1-owner-decision-memo-2026-08-13.md
- test/privacy/log-indistinguishability.t.ts
- scripts/privacy-scan.ts

Task:
1. Add a dedicated P-P1 re-review runner/test/script that generates at least 1,000 balanced forced-winner transcripts:
   5 winner positions, 200 executions each.
2. Preserve complete raw transcripts, including application logs, FHEVM Executor logs, ACL logs, topics, data, emitter,
   ordering, gas and public call boundary. Do not normalize entry 301 or any opaque handle bytes.
3. Freeze and persist train/test split before classifier fitting: 500 train, 500 held-out.
4. Implement the three pre-registered observer families:
   - sequence/shape,
   - byte-offset or byte-n-gram,
   - ACL/emitter/call-boundary.
5. Implement mutation positive controls for:
   - indexed topic leak,
   - data payload leak,
   - emitter/call-shape leak,
   - ACL recipient asymmetry.
6. Fail the campaign if any mutation control has held-out accuracy below 95%.
7. Fail the campaign if any real held-out classifier has more than 102 correct predictions out of 500 or a
   label-permutation p-value below 0.01.
8. Emit machine-readable artifacts with code commit, source status, seeds, transcript hashes, raw transcript paths,
   split assignment, classifier metrics, permutation results, mutation metrics and SHA-256 sidecars.
9. Keep the existing frozen P-P1 scanner behavior intact unless the owner later approves an explicit re-freeze.

Verification:
- Run the new P-P1 re-review campaign or, if it is too long for the current turn, add a deterministic smoke mode and
  clearly mark the full campaign as NOT_RUN.
- Run existing privacy tests impacted by the change.
- Run npx tsc --noEmit.
- Confirm git diff -- docs/10-proof-strategy.md is empty.

Deliver:
- changed files,
- exact commands run,
- artifact paths and hashes,
- whether the re-review is READY_FOR_INDEPENDENT_REVIEW, FAILED, or NOT_RUN.
```

## Current Status After Opening

```text
P-P1 frozen verdict: WEAKER-THAN-CLAIMED
P-P1 re-review: OPENED_NOT_FROZEN
P-S2: MATCHES
```

