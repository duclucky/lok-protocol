----------------------------- MODULE LokDraw -----------------------------
EXTENDS Naturals, FiniteSets, TLC

(*
Stage-1 control-state model for Lok Protocol.

This model intentionally abstracts encrypted arithmetic and concrete FHE handles.
It checks the finite-state, tier-B halves of frozen Section 3: draw progress,
timeouts, post-tEnd control isolation, public-decryption proof rejection,
pause/config reachability, adapter swap sequencing, and strict-mode
randomness-after-reveal ordering.

The state space is checked compositionally because adapter activation/removal is
IDLE-only: LokDraw.cfg checks DRAW interleavings, while LokDraw-risk.cfg checks
checkpoint/oracle/config/adapter interleavings. Safe user, funded-credit,
pause/config, and oracle transitions remain present in both modes.

TLC 2.19 exhaustive results, 2026-08-10, 3 participants, MaxTime=8:
  DRAW: 27,958,689 generated; 1,057,248 distinct; depth 32; no error.
  RISK:  2,075,393 generated;    79,424 distinct; depth 25; no error.

Abstraction boundary: P-L5, P-S7, P-A4, P-A8, and P-O1 retain their frozen
non-TLA+ obligations. P-L6 still needs the tEnd-1/tEnd/tEnd+1 numeric boundary
test. P-F3 checks the dependency on P-F10 and adversarial reveal ordering, not
the cryptographic distribution of FHE.rand.
*)

CONSTANTS
    Participants,
    MaxTime,
    DrawPeriod,
    SettleDelay,
    RevealWindow,
    StateDeadline,
    WithdrawWindow,
    BatchAMax,
    BatchBMax,
    MaxRiskEpoch,
    MaxCheckpointNonce,
    CheckMode

States == {
    "IDLE",
    "OPEN",
    "SWEEP_A",
    "AWAIT_TOTAL",
    "REVEAL",
    "RANDOM_SET",
    "SWEEP_B",
    "SETTLED"
}

DrawStates == States \ {"IDLE", "SETTLED"}
Idx == 1..Cardinality(Participants)
Totals == {"NONE", "W_ZERO", "T_ZERO", "POSITIVE"}
Outcomes == {"NONE", "VOID", "DIRECT_CREDIT", "AWARDED"}
CheckpointStatuses == {"NONE", "PENDING", "TRUE", "FALSE"}
Adapters == {"A0", "A1"}
OptionalAdapters == Adapters \cup {"NONE"}
RiskTransitionKinds == {"NONE", "ACTIVATE", "REMOVE"}
CheckModes == {"DRAW", "RISK"}
TimeLimit == MaxTime + StateDeadline + RevealWindow + WithdrawWindow + DrawPeriod + SettleDelay

VARIABLES
    state,
    now,
    drawId,
    strict,
    paused,
    oracleUp,
    tEnd,
    deadline,
    cursorA,
    cursorB,
    processedA,
    processedB,
    totalKind,
    totalAccepted,
    acceptedTotalDraw,
    revealDeadline,
    committed,
    revealed,
    revealAcc,
    revealClosed,
    revealAccAtClose,
    randomGenerated,
    randomGeneratedAt,
    randomCommitted,
    randExposedBeforeRevealClose,
    outcome,
    userNonce,
    rejectNonce,
    swapQueued,
    swapProposedAt,
    swapReadyAt,
    adapterVersion,
    lastSwapState,
    solvent,
    accountingVersion,
    riskEpoch,
    checkpointStatus,
    checkpointRiskEpoch,
    checkpointAccountingVersion,
    checkpointNonce,
    lastSolventRiskEpoch,
    restricted,
    configNonce,
    activeAdapter,
    retiringAdapter,
    retiringDrained,
    lastDepositRouted,
    lastRiskTransitionKind,
    lastRiskTransitionState,
    lastRiskTransitionPreEpoch,
    lastRiskTransitionPostEpoch,
    lastRiskTransitionAuthorized,
    lastRiskTransitionTimelocked

oldVars == <<
    state,
    now,
    drawId,
    strict,
    paused,
    oracleUp,
    tEnd,
    deadline,
    cursorA,
    cursorB,
    processedA,
    processedB,
    totalKind,
    totalAccepted,
    acceptedTotalDraw,
    revealDeadline,
    committed,
    revealed,
    revealAcc,
    revealClosed,
    revealAccAtClose,
    randomGenerated,
    randomGeneratedAt,
    randomCommitted,
    randExposedBeforeRevealClose,
    outcome,
    userNonce,
    rejectNonce,
    swapQueued,
    swapProposedAt,
    swapReadyAt,
    adapterVersion,
    lastSwapState,
    solvent
>>

newVars == <<
    accountingVersion,
    riskEpoch,
    checkpointStatus,
    checkpointRiskEpoch,
    checkpointAccountingVersion,
    checkpointNonce,
    lastSolventRiskEpoch,
    restricted,
    configNonce,
    activeAdapter,
    retiringAdapter,
    retiringDrained,
    lastDepositRouted,
    lastRiskTransitionKind,
    lastRiskTransitionState,
    lastRiskTransitionPreEpoch,
    lastRiskTransitionPostEpoch,
    lastRiskTransitionAuthorized,
    lastRiskTransitionTimelocked
>>

oldVarsExceptReject == <<
    state,
    now,
    drawId,
    strict,
    paused,
    oracleUp,
    tEnd,
    deadline,
    cursorA,
    cursorB,
    processedA,
    processedB,
    totalKind,
    totalAccepted,
    acceptedTotalDraw,
    revealDeadline,
    committed,
    revealed,
    revealAcc,
    revealClosed,
    revealAccAtClose,
    randomGenerated,
    randomGeneratedAt,
    randomCommitted,
    randExposedBeforeRevealClose,
    outcome,
    userNonce,
    swapQueued,
    swapProposedAt,
    swapReadyAt,
    adapterVersion,
    lastSwapState,
    solvent
>>

vars == <<oldVars, newVars>>

CleanDrawLocals ==
    /\ strict = FALSE
    /\ tEnd = 0
    /\ deadline = 0
    /\ cursorA = 0
    /\ cursorB = 0
    /\ processedA = {}
    /\ processedB = {}
    /\ totalKind = "NONE"
    /\ totalAccepted = FALSE
    /\ acceptedTotalDraw = 0
    /\ revealDeadline = 0
    /\ committed = {}
    /\ revealed = {}
    /\ revealAcc = {}
    /\ revealClosed = FALSE
    /\ revealAccAtClose = {}
    /\ randomGenerated = FALSE
    /\ randomGeneratedAt = 0
    /\ randomCommitted = FALSE
    /\ randExposedBeforeRevealClose = FALSE
    /\ outcome = "NONE"

CleanDrawLocalsNext ==
    /\ strict' = FALSE
    /\ tEnd' = 0
    /\ deadline' = 0
    /\ cursorA' = 0
    /\ cursorB' = 0
    /\ processedA' = {}
    /\ processedB' = {}
    /\ totalKind' = "NONE"
    /\ totalAccepted' = FALSE
    /\ acceptedTotalDraw' = 0
    /\ revealDeadline' = 0
    /\ committed' = {}
    /\ revealed' = {}
    /\ revealAcc' = {}
    /\ revealClosed' = FALSE
    /\ revealAccAtClose' = {}
    /\ randomGenerated' = FALSE
    /\ randomGeneratedAt' = 0
    /\ randomCommitted' = FALSE
    /\ randExposedBeforeRevealClose' = FALSE
    /\ outcome' = "NONE"

Init ==
    /\ state = "IDLE"
    /\ now = 0
    /\ drawId = 0
    /\ paused = FALSE
    /\ oracleUp = FALSE
    /\ CleanDrawLocals
    /\ userNonce = [u \in Participants |-> 0]
    /\ rejectNonce = 0
    /\ swapQueued = FALSE
    /\ swapProposedAt = 0
    /\ swapReadyAt = 0
    /\ adapterVersion = 0
    /\ lastSwapState = "IDLE"
    /\ solvent = TRUE
    /\ accountingVersion = 0
    /\ riskEpoch = 1
    /\ checkpointStatus = IF CheckMode = "DRAW" THEN "TRUE" ELSE "NONE"
    /\ checkpointRiskEpoch = IF CheckMode = "DRAW" THEN 1 ELSE 0
    /\ checkpointAccountingVersion = 0
    /\ checkpointNonce = IF CheckMode = "DRAW" THEN 1 ELSE 0
    /\ lastSolventRiskEpoch = IF CheckMode = "DRAW" THEN 1 ELSE 0
    /\ restricted = FALSE
    /\ configNonce = 0
    /\ activeAdapter = "A0"
    /\ retiringAdapter = "NONE"
    /\ retiringDrained = FALSE
    /\ lastDepositRouted = FALSE
    /\ lastRiskTransitionKind = "NONE"
    /\ lastRiskTransitionState = "IDLE"
    /\ lastRiskTransitionPreEpoch = 0
    /\ lastRiskTransitionPostEpoch = 0
    /\ lastRiskTransitionAuthorized = TRUE
    /\ lastRiskTransitionTimelocked = TRUE

TypeOK ==
    /\ CheckMode \in CheckModes
    /\ state \in States
    /\ now \in 0..MaxTime
    /\ drawId \in Nat
    /\ strict \in BOOLEAN
    /\ paused \in BOOLEAN
    /\ oracleUp \in BOOLEAN
    /\ tEnd \in 0..TimeLimit
    /\ deadline \in 0..TimeLimit
    /\ cursorA \in 0..Cardinality(Participants)
    /\ cursorB \in 0..Cardinality(Participants)
    /\ processedA \subseteq Idx
    /\ processedB \subseteq Idx
    /\ totalKind \in Totals
    /\ totalAccepted \in BOOLEAN
    /\ acceptedTotalDraw \in Nat
    /\ revealDeadline \in 0..TimeLimit
    /\ committed \subseteq Participants
    /\ revealed \subseteq Participants
    /\ revealAcc \subseteq Participants
    /\ revealClosed \in BOOLEAN
    /\ revealAccAtClose \subseteq Participants
    /\ randomGenerated \in BOOLEAN
    /\ randomGeneratedAt \in 0..MaxTime
    /\ randomCommitted \in BOOLEAN
    /\ randExposedBeforeRevealClose \in BOOLEAN
    /\ outcome \in Outcomes
    /\ userNonce \in [Participants -> 0..1]
    /\ rejectNonce \in 0..1
    /\ swapQueued \in BOOLEAN
    /\ swapProposedAt \in 0..MaxTime
    /\ swapReadyAt \in 0..TimeLimit
    /\ adapterVersion \in Nat
    /\ lastSwapState \in States
    /\ solvent \in BOOLEAN
    /\ accountingVersion \in 0..1
    /\ riskEpoch \in 1..MaxRiskEpoch
    /\ checkpointStatus \in CheckpointStatuses
    /\ checkpointRiskEpoch \in 0..MaxRiskEpoch
    /\ checkpointAccountingVersion \in 0..1
    /\ checkpointNonce \in 0..MaxCheckpointNonce
    /\ lastSolventRiskEpoch \in 0..MaxRiskEpoch
    /\ restricted \in BOOLEAN
    /\ configNonce \in 0..1
    /\ activeAdapter \in Adapters
    /\ retiringAdapter \in OptionalAdapters
    /\ retiringDrained \in BOOLEAN
    /\ lastDepositRouted \in BOOLEAN
    /\ lastRiskTransitionKind \in RiskTransitionKinds
    /\ lastRiskTransitionState \in States
    /\ lastRiskTransitionPreEpoch \in 0..MaxRiskEpoch
    /\ lastRiskTransitionPostEpoch \in 0..MaxRiskEpoch
    /\ lastRiskTransitionAuthorized \in BOOLEAN
    /\ lastRiskTransitionTimelocked \in BOOLEAN

CurrentRiskAuthorized ==
    ~restricted /\ lastSolventRiskEpoch = riskEpoch

Stalled ==
    state \in DrawStates /\ now >= deadline

ToggleUser(u) ==
    userNonce

ParticipantSymmetry == Permutations(Participants)

Deposit(u) ==
    /\ u \in Participants
    /\ userNonce' = ToggleUser(u)
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

Withdraw(u) == Deposit(u)
Exit(u) == Deposit(u)
SetTheta(u) == Deposit(u)
EmergencyWithdraw(u) == Deposit(u)

UserAction ==
    \E u \in Participants:
        Deposit(u) \/ Withdraw(u) \/ Exit(u) \/ SetTheta(u) \/ EmergencyWithdraw(u)

Tick ==
    /\ now < MaxTime
    /\ now' = now + 1
    /\ revealClosed' =
        IF state = "REVEAL" /\ now < revealDeadline /\ now + 1 >= revealDeadline
        THEN TRUE
        ELSE revealClosed
    /\ revealAccAtClose' =
        IF state = "REVEAL" /\ now < revealDeadline /\ now + 1 >= revealDeadline
        THEN revealAcc
        ELSE revealAccAtClose
    /\ UNCHANGED <<state, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        randomGenerated, randomGeneratedAt, randomCommitted,
        randExposedBeforeRevealClose, outcome, userNonce, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

SetOracle(up) ==
    /\ up \in BOOLEAN
    /\ oracleUp' = up
    /\ UNCHANGED <<state, now, drawId, strict, paused, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        rejectNonce, swapQueued, swapProposedAt, swapReadyAt, adapterVersion,
        lastSwapState, solvent>>

Pause ==
    /\ paused' = TRUE
    /\ UNCHANGED <<state, now, drawId, strict, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        rejectNonce, swapQueued, swapProposedAt, swapReadyAt, adapterVersion,
        lastSwapState, solvent>>

Unpause ==
    /\ paused' = FALSE
    /\ UNCHANGED <<state, now, drawId, strict, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        rejectNonce, swapQueued, swapProposedAt, swapReadyAt, adapterVersion,
        lastSwapState, solvent>>

OpenDraw(s) ==
    /\ s \in BOOLEAN
    /\ ~paused
    /\ CurrentRiskAuthorized
    /\ state \in {"IDLE", "SETTLED"}
    /\ now + DrawPeriod + SettleDelay + StateDeadline <= MaxTime
    /\ state' = "OPEN"
    /\ drawId' = drawId + 1
    /\ strict' = s
    /\ tEnd' = now + DrawPeriod
    /\ deadline' = now + StateDeadline
    /\ cursorA' = 0
    /\ cursorB' = 0
    /\ processedA' = {}
    /\ processedB' = {}
    /\ totalKind' = "NONE"
    /\ totalAccepted' = FALSE
    /\ acceptedTotalDraw' = 0
    /\ revealDeadline' = 0
    /\ committed' = {}
    /\ revealed' = {}
    /\ revealAcc' = {}
    /\ revealClosed' = FALSE
    /\ revealAccAtClose' = {}
    /\ randomGenerated' = FALSE
    /\ randomGeneratedAt' = 0
    /\ randomCommitted' = FALSE
    /\ randExposedBeforeRevealClose' = FALSE
    /\ outcome' = "NONE"
    /\ UNCHANGED <<now, paused, oracleUp, userNonce, rejectNonce, swapQueued,
        swapProposedAt, swapReadyAt, adapterVersion, lastSwapState, solvent>>

CommitEntropy(u) ==
    /\ strict
    /\ state = "OPEN"
    /\ now < tEnd
    /\ u \in Participants
    /\ committed' = committed \cup {u}
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, revealed, revealAcc, revealClosed,
        revealAccAtClose, randomGenerated, randomGeneratedAt, randomCommitted,
        randExposedBeforeRevealClose, outcome, userNonce, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

CrankA(k) ==
    LET n == Cardinality(Participants) IN
    LET end == IF cursorA + k > n THEN n ELSE cursorA + k IN
    LET newly == {i \in Idx: cursorA < i /\ i <= end} IN
    /\ k \in 1..BatchAMax
    /\ state \in {"OPEN", "SWEEP_A"}
    /\ now >= tEnd + SettleDelay
    /\ cursorA < n
    /\ state' = IF end = n THEN "AWAIT_TOTAL" ELSE "SWEEP_A"
    /\ cursorA' = end
    /\ processedA' = processedA \cup newly
    /\ deadline' = now + StateDeadline
    /\ UNCHANGED <<now, drawId, strict, paused, oracleUp, tEnd, cursorB,
        processedB, totalKind, totalAccepted, acceptedTotalDraw,
        revealDeadline, committed, revealed, revealAcc, revealClosed,
        revealAccAtClose, randomGenerated, randomGeneratedAt, randomCommitted,
        randExposedBeforeRevealClose, outcome, userNonce, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

RejectBadCrankA(k) ==
    /\ k \in 0..(BatchAMax + 2)
    /\ ~(k \in 1..BatchAMax)
    /\ state \in {"OPEN", "SWEEP_A"}
    /\ rejectNonce' = 1 - rejectNonce
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

SubmitValidTotal(kind) ==
    /\ kind \in {"W_ZERO", "T_ZERO", "POSITIVE"}
    /\ state = "AWAIT_TOTAL"
    /\ totalAccepted' = TRUE
    /\ acceptedTotalDraw' = drawId
    /\ totalKind' = kind
    /\ state' =
        IF kind = "W_ZERO" THEN "SETTLED"
        ELSE IF kind = "T_ZERO" THEN "SWEEP_B"
        ELSE IF strict THEN "REVEAL"
        ELSE "RANDOM_SET"
    /\ revealDeadline' =
        IF kind = "POSITIVE" /\ strict THEN now + RevealWindow ELSE revealDeadline
    /\ revealClosed' =
        IF kind = "POSITIVE" /\ strict /\ RevealWindow = 0 THEN TRUE ELSE revealClosed
    /\ revealAccAtClose' =
        IF kind = "POSITIVE" /\ strict /\ RevealWindow = 0 THEN revealAcc ELSE revealAccAtClose
    /\ cursorB' = IF kind = "T_ZERO" THEN 0 ELSE cursorB
    /\ processedB' = IF kind = "T_ZERO" THEN {} ELSE processedB
    /\ outcome' = IF kind = "W_ZERO" THEN "VOID" ELSE outcome
    /\ deadline' = now + StateDeadline
    /\ UNCHANGED <<now, drawId, strict, paused, oracleUp, tEnd, cursorA,
        processedA, committed, revealed, revealAcc,
        randomGenerated, randomGeneratedAt, randomCommitted,
        randExposedBeforeRevealClose, userNonce, rejectNonce, swapQueued,
        swapProposedAt, swapReadyAt, adapterVersion, lastSwapState, solvent>>

SubmitForgedOrStaleTotal ==
    /\ state = "AWAIT_TOTAL"
    /\ rejectNonce' = 1 - rejectNonce
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

RevealEntropy(u) ==
    /\ strict
    /\ state = "REVEAL"
    /\ now < revealDeadline
    /\ u \in committed
    /\ u \notin revealed
    /\ revealed' = revealed \cup {u}
    /\ revealAcc' = revealAcc \cup {u}
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealClosed,
        revealAccAtClose, randomGenerated, randomGeneratedAt, randomCommitted,
        randExposedBeforeRevealClose, outcome, userNonce, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

GenerateRandom ==
    /\ totalKind = "POSITIVE"
    /\ ~randomGenerated
    /\ state \in {"RANDOM_SET", "REVEAL"}
    /\ IF strict
        THEN state = "REVEAL" /\ now >= revealDeadline /\ revealClosed
        ELSE state = "RANDOM_SET"
    /\ state' = "SWEEP_B"
    /\ randomGenerated' = TRUE
    /\ randomGeneratedAt' = now
    /\ randomCommitted' = TRUE
    /\ randExposedBeforeRevealClose' =
        randExposedBeforeRevealClose \/ (strict /\ now < revealDeadline)
    /\ cursorB' = 0
    /\ processedB' = {}
    /\ deadline' = now + StateDeadline
    /\ UNCHANGED <<now, drawId, strict, paused, oracleUp, tEnd, cursorA,
        processedA, totalKind, totalAccepted, acceptedTotalDraw,
        revealDeadline, committed, revealed, revealAcc, revealClosed,
        revealAccAtClose, outcome, userNonce, rejectNonce, swapQueued,
        swapProposedAt, swapReadyAt, adapterVersion, lastSwapState, solvent>>

CrankB(k) ==
    LET n == Cardinality(Participants) IN
    LET end == IF cursorB + k > n THEN n ELSE cursorB + k IN
    LET newly == {i \in Idx: cursorB < i /\ i <= end} IN
    /\ k \in 1..BatchBMax
    /\ state = "SWEEP_B"
    /\ cursorB < n
    /\ state' = IF end = n THEN "SETTLED" ELSE "SWEEP_B"
    /\ cursorB' = end
    /\ processedB' = processedB \cup newly
    /\ outcome' =
        IF end = n
        THEN IF totalKind = "T_ZERO" THEN "DIRECT_CREDIT" ELSE "AWARDED"
        ELSE outcome
    /\ deadline' = now + StateDeadline
    /\ UNCHANGED <<now, drawId, strict, paused, oracleUp, tEnd, cursorA,
        processedA, totalKind, totalAccepted, acceptedTotalDraw,
        revealDeadline, committed, revealed, revealAcc, revealClosed,
        revealAccAtClose, randomGenerated, randomGeneratedAt, randomCommitted,
        randExposedBeforeRevealClose, userNonce, rejectNonce, swapQueued,
        swapProposedAt, swapReadyAt, adapterVersion, lastSwapState, solvent>>

RejectBadCrankB(k) ==
    /\ k \in 0..(BatchBMax + 2)
    /\ ~(k \in 1..BatchBMax)
    /\ state = "SWEEP_B"
    /\ rejectNonce' = 1 - rejectNonce
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

CloseSettled ==
    /\ state = "SETTLED"
    /\ state' = "IDLE"
    /\ CleanDrawLocalsNext
    /\ UNCHANGED <<now, drawId, paused, oracleUp, userNonce, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

AbortDraw ==
    /\ state \in DrawStates
    /\ (state # "SWEEP_B" \/ cursorB = 0)
    /\ now >= deadline
    /\ state' = "IDLE"
    /\ CleanDrawLocalsNext
    /\ UNCHANGED <<now, drawId, paused, oracleUp, userNonce, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

SpamAbortRejected ==
    /\ state \in DrawStates
    /\ (now < deadline \/ (state = "SWEEP_B" /\ cursorB > 0))
    /\ rejectNonce' = 1 - rejectNonce
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

ProposeSwap ==
    /\ ~swapQueued
    /\ swapQueued' = TRUE
    /\ swapProposedAt' = now
    /\ swapReadyAt' = now + WithdrawWindow
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        rejectNonce, adapterVersion, lastSwapState, solvent>>

ExecuteSwap ==
    /\ swapQueued
    /\ now >= swapReadyAt
    /\ state = "IDLE"
    /\ solvent
    /\ adapterVersion' = adapterVersion + 1
    /\ swapQueued' = FALSE
    /\ lastSwapState' = state
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        rejectNonce, swapProposedAt, swapReadyAt, solvent>>

RejectedSwapActivation ==
    /\ swapQueued
    /\ now >= swapReadyAt
    /\ state # "IDLE"
    /\ rejectNonce' = 1 - rejectNonce
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd, deadline,
        cursorA, cursorB, processedA, processedB, totalKind, totalAccepted,
        acceptedTotalDraw, revealDeadline, committed, revealed, revealAcc,
        revealClosed, revealAccAtClose, randomGenerated, randomGeneratedAt,
        randomCommitted, randExposedBeforeRevealClose, outcome, userNonce,
        swapQueued, swapProposedAt, swapReadyAt, adapterVersion, lastSwapState,
        solvent>>

CoreNext ==
    \/ Tick
    \/ SetOracle(TRUE)
    \/ SetOracle(FALSE)
    \/ Pause
    \/ Unpause
    \/ \E s \in BOOLEAN: OpenDraw(s)
    \/ \E u \in Participants: CommitEntropy(u)
    \/ \E k \in 1..BatchAMax: CrankA(k)
    \/ \E k \in 0..(BatchAMax + 2): RejectBadCrankA(k)
    \/ \E kind \in {"W_ZERO", "T_ZERO", "POSITIVE"}: SubmitValidTotal(kind)
    \/ SubmitForgedOrStaleTotal
    \/ \E u \in Participants: RevealEntropy(u)
    \/ GenerateRandom
    \/ \E k \in 1..BatchBMax: CrankB(k)
    \/ \E k \in 0..(BatchBMax + 2): RejectBadCrankB(k)
    \/ CloseSettled
    \/ AbortDraw
    \/ SpamAbortRejected

RiskEnvironmentNext ==
    \/ Tick
    \/ SetOracle(TRUE)
    \/ SetOracle(FALSE)
    \/ Pause
    \/ Unpause

SafeDeposit(u) ==
    /\ Deposit(u)
    /\ accountingVersion' = 1 - accountingVersion
    /\ lastDepositRouted' = CurrentRiskAuthorized
    /\ UNCHANGED <<riskEpoch, checkpointStatus, checkpointRiskEpoch,
        checkpointAccountingVersion, checkpointNonce, lastSolventRiskEpoch,
        restricted, configNonce, activeAdapter, retiringAdapter,
        retiringDrained, lastRiskTransitionKind, lastRiskTransitionState,
        lastRiskTransitionPreEpoch, lastRiskTransitionPostEpoch,
        lastRiskTransitionAuthorized, lastRiskTransitionTimelocked>>

SafeRecovery(u) ==
    /\ Withdraw(u)
    /\ accountingVersion' = 1 - accountingVersion
    /\ UNCHANGED <<riskEpoch, checkpointStatus, checkpointRiskEpoch,
        checkpointAccountingVersion, checkpointNonce, lastSolventRiskEpoch,
        restricted, configNonce, activeAdapter, retiringAdapter,
        retiringDrained, lastDepositRouted, lastRiskTransitionKind,
        lastRiskTransitionState, lastRiskTransitionPreEpoch,
        lastRiskTransitionPostEpoch, lastRiskTransitionAuthorized,
        lastRiskTransitionTimelocked>>

SafeWithdraw(u) == SafeRecovery(u)
SafeExit(u) == SafeRecovery(u)
SafeEmergencyWithdraw(u) == SafeRecovery(u)

SafeSetTheta(u) ==
    /\ SetTheta(u)
    /\ accountingVersion' = 1 - accountingVersion
    /\ UNCHANGED <<riskEpoch, checkpointStatus, checkpointRiskEpoch,
        checkpointAccountingVersion, checkpointNonce, lastSolventRiskEpoch,
        restricted, configNonce, activeAdapter, retiringAdapter,
        retiringDrained, lastDepositRouted, lastRiskTransitionKind,
        lastRiskTransitionState, lastRiskTransitionPreEpoch,
        lastRiskTransitionPostEpoch, lastRiskTransitionAuthorized,
        lastRiskTransitionTimelocked>>

SafeUserAction ==
    \E u \in Participants:
        SafeDeposit(u) \/ SafeWithdraw(u) \/ SafeExit(u)
        \/ SafeSetTheta(u) \/ SafeEmergencyWithdraw(u)

FundedCredit ==
    /\ accountingVersion' = 1 - accountingVersion
    /\ UNCHANGED oldVars
    /\ UNCHANGED <<riskEpoch, checkpointStatus, checkpointRiskEpoch,
        checkpointAccountingVersion, checkpointNonce, lastSolventRiskEpoch,
        restricted, configNonce, activeAdapter, retiringAdapter,
        retiringDrained, lastDepositRouted, lastRiskTransitionKind,
        lastRiskTransitionState, lastRiskTransitionPreEpoch,
        lastRiskTransitionPostEpoch, lastRiskTransitionAuthorized,
        lastRiskTransitionTimelocked>>

UpdateConfig ==
    /\ configNonce' = 1 - configNonce
    /\ UNCHANGED oldVars
    /\ UNCHANGED <<accountingVersion, riskEpoch, checkpointStatus,
        checkpointRiskEpoch, checkpointAccountingVersion, checkpointNonce,
        lastSolventRiskEpoch, restricted, activeAdapter, retiringAdapter,
        retiringDrained, lastDepositRouted, lastRiskTransitionKind,
        lastRiskTransitionState, lastRiskTransitionPreEpoch,
        lastRiskTransitionPostEpoch, lastRiskTransitionAuthorized,
        lastRiskTransitionTimelocked>>

OpenCheckpoint ==
    /\ checkpointNonce < MaxCheckpointNonce
    /\ ~CurrentRiskAuthorized
    /\ checkpointStatus' = "PENDING"
    /\ checkpointRiskEpoch' = riskEpoch
    /\ checkpointAccountingVersion' = accountingVersion
    /\ checkpointNonce' = checkpointNonce + 1
    /\ UNCHANGED oldVars
    /\ UNCHANGED <<accountingVersion, riskEpoch, lastSolventRiskEpoch,
        restricted, configNonce, activeAdapter, retiringAdapter,
        retiringDrained, lastDepositRouted, lastRiskTransitionKind,
        lastRiskTransitionState, lastRiskTransitionPreEpoch,
        lastRiskTransitionPostEpoch, lastRiskTransitionAuthorized,
        lastRiskTransitionTimelocked>>

SubmitCheckpointTrue ==
    /\ oracleUp
    /\ checkpointStatus = "PENDING"
    /\ checkpointRiskEpoch = riskEpoch
    /\ checkpointStatus' = "TRUE"
    /\ lastSolventRiskEpoch' = riskEpoch
    /\ restricted' = FALSE
    /\ UNCHANGED oldVars
    /\ UNCHANGED <<accountingVersion, riskEpoch, checkpointRiskEpoch,
        checkpointAccountingVersion, checkpointNonce, configNonce,
        activeAdapter, retiringAdapter, retiringDrained, lastDepositRouted,
        lastRiskTransitionKind, lastRiskTransitionState,
        lastRiskTransitionPreEpoch, lastRiskTransitionPostEpoch,
        lastRiskTransitionAuthorized, lastRiskTransitionTimelocked>>

SubmitCheckpointFalse ==
    /\ oracleUp
    /\ checkpointStatus = "PENDING"
    /\ checkpointRiskEpoch = riskEpoch
    /\ checkpointStatus' = "FALSE"
    /\ restricted' = TRUE
    /\ lastDepositRouted' = FALSE
    /\ UNCHANGED oldVars
    /\ UNCHANGED <<accountingVersion, riskEpoch, checkpointRiskEpoch,
        checkpointAccountingVersion, checkpointNonce, lastSolventRiskEpoch,
        configNonce, activeAdapter, retiringAdapter, retiringDrained,
        lastRiskTransitionKind, lastRiskTransitionState,
        lastRiskTransitionPreEpoch, lastRiskTransitionPostEpoch,
        lastRiskTransitionAuthorized, lastRiskTransitionTimelocked>>

RejectBadCheckpoint ==
    /\ (checkpointStatus # "PENDING"
        \/ checkpointRiskEpoch # riskEpoch
        \/ ~oracleUp)
    /\ rejectNonce' = 1 - rejectNonce
    /\ UNCHANGED oldVarsExceptReject
    /\ UNCHANGED newVars

OtherAdapter(a) == IF a = "A0" THEN "A1" ELSE "A0"

ProposeAdapterSwap ==
    /\ ProposeSwap
    /\ UNCHANGED newVars

ExecuteAdapterSwap ==
    /\ ExecuteSwap
    /\ CurrentRiskAuthorized
    /\ retiringAdapter = "NONE"
    /\ riskEpoch < MaxRiskEpoch
    /\ accountingVersion' = 1 - accountingVersion
    /\ riskEpoch' = riskEpoch + 1
    /\ checkpointStatus' = "NONE"
    /\ checkpointRiskEpoch' = 0
    /\ checkpointAccountingVersion' = accountingVersion
    /\ activeAdapter' = OtherAdapter(activeAdapter)
    /\ retiringAdapter' = activeAdapter
    /\ retiringDrained' = FALSE
    /\ lastDepositRouted' = FALSE
    /\ lastRiskTransitionKind' = "ACTIVATE"
    /\ lastRiskTransitionState' = state
    /\ lastRiskTransitionPreEpoch' = riskEpoch
    /\ lastRiskTransitionPostEpoch' = riskEpoch + 1
    /\ lastRiskTransitionAuthorized' = TRUE
    /\ lastRiskTransitionTimelocked' = (now >= swapReadyAt)
    /\ UNCHANGED <<checkpointNonce, lastSolventRiskEpoch, restricted,
        configNonce>>

DrainRetiringAdapter ==
    /\ retiringAdapter # "NONE"
    /\ ~retiringDrained
    /\ retiringDrained' = TRUE
    /\ accountingVersion' = 1 - accountingVersion
    /\ UNCHANGED oldVars
    /\ UNCHANGED <<riskEpoch, checkpointStatus, checkpointRiskEpoch,
        checkpointAccountingVersion, checkpointNonce, lastSolventRiskEpoch,
        restricted, configNonce, activeAdapter, retiringAdapter,
        lastDepositRouted, lastRiskTransitionKind, lastRiskTransitionState,
        lastRiskTransitionPreEpoch, lastRiskTransitionPostEpoch,
        lastRiskTransitionAuthorized, lastRiskTransitionTimelocked>>

RemoveRetiringAdapter ==
    /\ state = "IDLE"
    /\ retiringAdapter # "NONE"
    /\ retiringDrained
    /\ CurrentRiskAuthorized
    /\ riskEpoch < MaxRiskEpoch
    /\ adapterVersion' = adapterVersion + 1
    /\ lastSwapState' = state
    /\ accountingVersion' = 1 - accountingVersion
    /\ riskEpoch' = riskEpoch + 1
    /\ checkpointStatus' = "NONE"
    /\ checkpointRiskEpoch' = 0
    /\ checkpointAccountingVersion' = accountingVersion
    /\ retiringAdapter' = "NONE"
    /\ retiringDrained' = FALSE
    /\ lastDepositRouted' = FALSE
    /\ lastRiskTransitionKind' = "REMOVE"
    /\ lastRiskTransitionState' = state
    /\ lastRiskTransitionPreEpoch' = riskEpoch
    /\ lastRiskTransitionPostEpoch' = riskEpoch + 1
    /\ lastRiskTransitionAuthorized' = TRUE
    /\ lastRiskTransitionTimelocked' = TRUE
    /\ UNCHANGED <<state, now, drawId, strict, paused, oracleUp, tEnd,
        deadline, cursorA, cursorB, processedA, processedB, totalKind,
        totalAccepted, acceptedTotalDraw, revealDeadline, committed,
        revealed, revealAcc, revealClosed, revealAccAtClose,
        randomGenerated, randomGeneratedAt, randomCommitted,
        randExposedBeforeRevealClose, outcome, userNonce, rejectNonce,
        swapQueued, swapProposedAt, swapReadyAt, solvent>>
    /\ UNCHANGED <<checkpointNonce, lastSolventRiskEpoch, restricted,
        configNonce, activeAdapter>>

RejectBadAdapterTransition ==
    /\ (swapQueued
        /\ (now < swapReadyAt
            \/ state # "IDLE"
            \/ ~CurrentRiskAuthorized
            \/ retiringAdapter # "NONE"
            \/ riskEpoch = MaxRiskEpoch))
        \/ (retiringAdapter # "NONE"
            /\ (~retiringDrained
                \/ state # "IDLE"
                \/ ~CurrentRiskAuthorized
                \/ riskEpoch = MaxRiskEpoch))
    /\ rejectNonce' = 1 - rejectNonce
    /\ UNCHANGED oldVarsExceptReject
    /\ UNCHANGED newVars

Next ==
    \/ /\ CheckMode = "DRAW"
       /\ CoreNext
       /\ UNCHANGED newVars
    \/ /\ CheckMode = "RISK"
       /\ RiskEnvironmentNext
       /\ UNCHANGED newVars
    \/ SafeUserAction
    \/ FundedCredit
    \/ UpdateConfig
    \/ /\ CheckMode = "RISK"
       /\ (OpenCheckpoint
           \/ SubmitCheckpointTrue
           \/ SubmitCheckpointFalse
           \/ RejectBadCheckpoint
           \/ ProposeAdapterSwap
           \/ ExecuteAdapterSwap
           \/ DrainRetiringAdapter
           \/ RemoveRetiringAdapter
           \/ RejectBadAdapterTransition)

Spec == Init /\ [][Next]_vars

\* P-L1 / P-A7: user recovery actions stay enabled, including paused/config states.
P_L1_UserActionsEnabled ==
    \A u \in Participants:
        /\ ENABLED SafeWithdraw(u)
        /\ ENABLED SafeExit(u)
        /\ ENABLED SafeEmergencyWithdraw(u)

P_A7_RecoveryDespitePauseConfig ==
    \A u \in Participants:
        /\ ENABLED SafeWithdraw(u)
        /\ ENABLED SafeExit(u)
        /\ ENABLED SafeEmergencyWithdraw(u)

\* P-L2: bounded form of "can progress or abort"; TLC deadlock checking is also enabled.
P_L2_NoLocalDeadEnd ==
    now = MaxTime
    \/ state \in {"IDLE", "SETTLED"}
    \/ ENABLED Tick
    \/ ENABLED AbortDraw
    \/ ENABLED GenerateRandom
    \/ (\E k \in 1..BatchAMax: ENABLED CrankA(k))
    \/ (\E kind \in {"W_ZERO", "T_ZERO", "POSITIVE"}: ENABLED SubmitValidTotal(kind))
    \/ (\E u \in Participants: ENABLED RevealEntropy(u))
    \/ (\E k \in 1..BatchBMax: ENABLED CrankB(k))

\* P-L3.
P_L3_RevealTimeoutEventuallyEnablesRandom ==
    state = "REVEAL" /\ now >= revealDeadline => ENABLED GenerateRandom

\* P-L4: oracle liveness is irrelevant for emergency withdrawal.
P_L4_EmergencyOnStall ==
    Stalled => \A u \in Participants: ENABLED SafeEmergencyWithdraw(u)

\* P-L5: cursor monotonicity and no double-processing are represented by prefix sets.
PrefixSet(c) == {i \in Idx: i <= c}

P_L5_CursorsWellFormed ==
    /\ processedA = PrefixSet(cursorA)
    /\ processedB = PrefixSet(cursorB)
    /\ Cardinality(processedA) = cursorA
    /\ Cardinality(processedB) = cursorB

\* P-L6: TLC half only; numeric exact-tEnd accumulator boundary is a Foundry/unit boundary test.
P_L6_PostTEndNoCursorCorruption ==
    now >= tEnd =>
        /\ P_L5_CursorsWellFormed
        /\ (checkpointStatus = "TRUE" => checkpointRiskEpoch = riskEpoch)

\* P-L7.
P_L7_CleanIdle ==
    state = "IDLE" => CleanDrawLocals

\* P-S7 TLC half: W=0 voids; W>0 and T=0 uses direct-credit PASS B.
P_S7_ZeroDrawVoids ==
    /\ (totalKind = "W_ZERO" =>
        /\ outcome = "VOID"
        /\ ~randomGenerated
        /\ state \notin {"RANDOM_SET", "REVEAL", "SWEEP_B"})
    /\ (totalKind = "T_ZERO" =>
        /\ ~randomGenerated
        /\ state \notin {"RANDOM_SET", "REVEAL"}
        /\ outcome \in {"NONE", "DIRECT_CREDIT"})

\* P-F10.
P_F10_RandomnessAfterRevealSequencing ==
    /\ ~randExposedBeforeRevealClose
    /\ (strict /\ randomGenerated => randomGeneratedAt >= revealDeadline)
    /\ (strict /\ randomGenerated => revealClosed)
    /\ (strict /\ revealClosed => revealAcc = revealAccAtClose)

\* P-F3 abstraction: this checks the dependency shape, not random distribution.
P_F3_DependsOnSequencedHonestReveal ==
    (strict /\ randomGenerated /\ revealed # {}) => P_F10_RandomnessAfterRevealSequencing

\* P-A4.
P_A4_TimelockAndExitWindow ==
    /\ (swapQueued => swapReadyAt >= swapProposedAt + WithdrawWindow)
    /\ \A u \in Participants: ENABLED SafeExit(u)

\* P-A8.
P_A8_AdapterSwapOnlyIdleSolvent ==
    /\ (lastRiskTransitionKind # "NONE" =>
        /\ lastRiskTransitionState = "IDLE"
        /\ lastRiskTransitionAuthorized
        /\ lastRiskTransitionPostEpoch = lastRiskTransitionPreEpoch + 1)
    /\ (lastRiskTransitionKind = "ACTIVATE" =>
        lastRiskTransitionTimelocked)
    /\ (retiringAdapter # "NONE" => retiringAdapter # activeAdapter)
    /\ (checkpointStatus = "TRUE" =>
        /\ checkpointRiskEpoch = riskEpoch
        /\ lastSolventRiskEpoch = riskEpoch
        /\ ~restricted)
    /\ (checkpointStatus = "FALSE" => restricted)
    /\ (lastDepositRouted => CurrentRiskAuthorized)

CheckpointAuthorizationIntegrity ==
    /\ (restricted => ~CurrentRiskAuthorized)
    /\ (checkpointStatus = "TRUE" => CurrentRiskAuthorized)
    /\ (checkpointStatus = "FALSE" => ~CurrentRiskAuthorized)

RiskBoundaryInvalidatesAuthorization ==
    lastRiskTransitionKind # "NONE" =>
        /\ lastRiskTransitionPostEpoch = lastRiskTransitionPreEpoch + 1
        /\ lastRiskTransitionAuthorized
        /\ (checkpointStatus # "TRUE" => ~CurrentRiskAuthorized)

OracleDownRecovery ==
    ~oracleUp => \A u \in Participants: ENABLED SafeEmergencyWithdraw(u)

\* P-O1: invalid caller input can only be rejected, never accepted into outcome state.
P_O1_OutcomeIntegrity ==
    /\ totalAccepted => acceptedTotalDraw = drawId
    /\ randomGenerated => totalKind = "POSITIVE"
    /\ (state = "SWEEP_B" /\ cursorB > 0 => ~ENABLED AbortDraw)
    /\ outcome = "AWARDED" => randomGenerated /\ cursorB = Cardinality(Participants)
    /\ outcome = "DIRECT_CREDIT" =>
        totalKind = "T_ZERO" /\ ~randomGenerated /\ cursorB = Cardinality(Participants)

=============================================================================
