---
schemaVersion: 1
feature: change-requirement-batches
---
# Change requirement-batch TDD evidence

Source: GitHub Issue #12 (v0.1.11 large-scale trial dogfooding). Root cause:
`ChangeRecord.phases` records the Red, Implementation, and Green phases of a
staged change exactly once each, for the full set of the change's declared
requirement IDs. `validateChangeCompleteness`'s `CHANGE_COMPLETENESS_TDD`
check (and the parallel `CHANGE_RED_UNPROVEN`/`CHANGE_GREEN_UNPROVEN` checks
in `validateChangeEvidence`) require, for every requirement in the change,
a TDD cycle whose Red phase falls between the change's `requirements` and
`red` markers and whose Green phase falls between the change's
`implementation` and `green` markers. Because each of these three markers
can be recorded only once per change, this is only satisfiable by completing
Red TDD for every requirement in the change before recording the single
`red` marker, implementing everything before recording the single
`implementation` marker, and completing Green TDD for every requirement
before recording the single `green` marker — a rigid global batch workflow
that is incompatible with completing an interleaved per-requirement
Red-implement-Green loop across a multi-requirement change.

## REQ-CHANGE-REQUIREMENT-BATCHES-001: Record Red/Implementation/Green evidence per requirement subset
Priority: must
Type: functional
Pattern: event-driven
Statement: When `change-record` is invoked for a phase using a requirement ID subset that is a proper non-empty subset of the change's declared requirement IDs, the system shall record that phase's evidence scoped to exactly that subset as an independent requirement batch.
Acceptance: Given a change declaring requirement IDs A and B, recording Red
then Implementation then Green for subset {A} alone succeeds, and
subsequently recording Red then Implementation then Green for subset {B}
alone also succeeds, without either subset's evidence being rejected as a
duplicate or requiring the other subset's requirement ID. Given previously
recorded change chronology evidence using the full-set form for Red,
Implementation, and Green, `trace`/`gate`/`change` validation reports the
same result as before this change, given no other modification to that
evidence or its referenced artifacts.

## REQ-CHANGE-REQUIREMENT-BATCHES-003: Enforce per-batch phase order and prerequisites
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` is invoked for the Implementation or Green phase of a requirement batch whose immediately preceding phase was not recorded for that identical requirement ID subset, then the system shall reject the recording with a diagnostic error.
Acceptance: Given a change whose Design phase is not yet recorded, recording
Red for any requirement batch is rejected. Given a batch that has recorded
Red but not Implementation, recording Green for that same batch is rejected.
Recording Implementation or Green for a different, unrelated requirement
batch is unaffected by another batch's missing phases.

## REQ-CHANGE-REQUIREMENT-BATCHES-004: Require full Green coverage before Quality
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` is invoked for the Quality phase while at least one declared requirement ID lacks recorded Green evidence, then the system shall reject the recording with a diagnostic error identifying the uncovered requirement IDs.
Acceptance: Given a change with requirement IDs A and B where only A has
recorded Green evidence, recording Quality is rejected and the diagnostic
names B. After B's Green evidence is also recorded (via its own batch or the
full-set form), recording Quality succeeds.

## REQ-CHANGE-REQUIREMENT-BATCHES-005: Evaluate completeness and chronology checks per batch
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall evaluate the `CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, `CHANGE_TEST_CHANGED_AFTER_RED`, `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` diagnostics using each requirement batch's own Red, Implementation, and Green phase fingerprints and order.
Acceptance: Given a change with two independent requirement batches, an
implementation change that is unrelated to a requirement in one batch but
that would (if compared against the other batch's markers) look unchanged,
does not raise a false `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED` for that
requirement, given its own batch's markers correctly bound genuine
implementation changes.
