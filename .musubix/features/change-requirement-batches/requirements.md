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
Statement: The system shall evaluate the `CHANGE_TESTS_UNCHANGED`,
`CHANGE_IMPLEMENTATION_UNCHANGED`,
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`,
`CHANGE_TEST_CHANGED_AFTER_RED`, `CHANGE_RED_UNPROVEN`,
`CHANGE_GREEN_UNPROVEN`, `CHANGE_COMPLETENESS_TDD`, and
`CHANGE_IMPLEMENTATION_SCOPE_MISSING` diagnostics, plus the snapshot bindings
and currently-reported re-derivations of the waivable diagnostics among them,
using the current applicable requirement batch's own Red, Implementation, and
Green phase fingerprints and order, selecting the current batch by its
persisted monotonic Red order; other diagnostics retain their existing behavior
unless the acceptance criteria explicitly state otherwise.
Acceptance: Given valid ordered evidence, an applicable batch is an effective
batch whose requirement IDs contain the requirement being evaluated. The
current batch is the applicable
batch with the greatest integer Red `order`; if multiple candidates have the
same Red `order`, the later entry in persisted effective-batch order is selected
deterministically while `CHANGE_ORDER_MISMATCH` and `CHANGE_PHASE_ORDER`
remain blocking. The synthesized legacy full-set batch precedes the persisted
`tddBatches` entries in effective-batch order. This selection rule applies to
valid ordered batch evidence; malformed or migration-required evidence retains
its existing diagnostics and waiver behavior. If no applicable batch has an
integer Red `order`, the first applicable batch in effective-batch order remains
current, preserving the existing migration behavior instead of dropping
current-batch validation.

Given a change with two independent requirement batches, an implementation
change that is unrelated to a requirement in one batch but that would (if
compared against the other batch's markers) look unchanged does not raise a
false `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED` for that requirement, given
its own current batch's markers correctly bound genuine implementation
changes. Given valid legacy full-set Red, Implementation, and Green evidence
and a requirement-scoped batch with a greater Red `order` that contains the
same requirement ID, every requirement-specific chronology, completeness,
TDD order-migration, and waiver-snapshot check selects the scoped batch,
regardless of whether the older batch records Implementation or Green after
that Red. For requirement-keyed TDD proof and order-migration checks, the
current batch window begins after the greatest integer Red `order` of any
earlier applicable batch, or after the Requirements `order` when no earlier
applicable ordered Red exists, and ends at the current batch's Red `order`.
Within that window, any non-void valid Red/Green cycle can prove TDD as in the
legacy single-batch behavior. For requirement-keyed order-migration checks, the
cycle with the greatest integer Red `order` is current and equal orders select
the later persisted cycle. A cycle carrying recorded void evidence with valid
order-log and hash-chain linkage is excluded from proof and migration checks.
A latest incomplete cycle raises requirement-keyed
`CHANGE_ORDER_MIGRATION_REQUIRED`, while an earlier Red-only cycle superseded
by a later valid Red/Green cycle does not. Record-time `*_AT_RECORD`
fail-fast checks remain scoped to the exact
batch key being recorded and do not use current-batch selection. If the current
batch is incomplete, validation reports the corresponding missing or unproven
evidence and does not fall back to an older complete batch. In particular, a
current batch containing only Red reports
`CHANGE_RED_UNPROVEN` and `CHANGE_COMPLETENESS_TDD`; a current batch containing
Red and Green without a valid intervening Implementation reports
`CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, and
`CHANGE_COMPLETENESS_TDD`.

`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`, and
`CHANGE_TEST_CHANGED_AFTER_RED` are batch-wide and are evaluated once for each
batch that is current for at least one requirement.
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, `CHANGE_RED_UNPROVEN`,
`CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` are requirement-scoped
and evaluate only requirement IDs for which that batch is current, so a fully
superseded batch produces none of these current-batch diagnostics. A batch's
current requirement IDs are the intersection of its `requirementIds`, the
change's declared requirement IDs, and the IDs whose current-batch selection
resolves to that batch; undeclared IDs remain governed by the existing change
requirement-mismatch validation. Structural
diagnostics, including `CHANGE_PHASE_ORDER`, `CHANGE_ORDER_MISMATCH`, and
phase-level `CHANGE_ORDER_MIGRATION_REQUIRED`, continue to evaluate all
recorded batches. `CHANGE_IMPLEMENTATION_SCOPE_MISSING` is requirement-scoped
and evaluates only the requirement IDs for which a batch is current, so stale
scope metadata in a fully superseded batch does not block current evidence.
`CHANGE_PHASE_MISSING` and the Green-coverage prerequisite for Quality retain
their existing union-across-batches behavior; fail-closed handling of a current
incomplete batch is enforced by the requirement-scoped unproven and
completeness diagnostics. The `requirement:<id>` form of
`CHANGE_ORDER_MIGRATION_REQUIRED` and its currently-reported re-derivation use
the same current-batch and current-cycle selectors. Its existing waiver
snapshot remains bound to TDD cycle orders only, preserving compatibility with
append-only historical waivers; a selector change can make that waiver inactive
without changing its snapshot hash. Phase- and batch-key forms retain their
structural all-recorded-batches behavior.

For detail-free requirement-scoped `CHANGE_RED_UNPROVEN`,
`CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD`, waiver snapshot
generation and the pure currently-reported conditions use the same
current-batch selection as diagnostic generation. Detail-keyed snapshots
continue to resolve the batch named by their detail key. For
`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`, and
`CHANGE_TEST_CHANGED_AFTER_RED`, the currently-reported condition additionally
requires the keyed batch to be current for at least one declared requirement;
for `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, it must be current for the named
requirement ID. Structural detail-keyed diagnostics such as
`CHANGE_ORDER_MIGRATION_REQUIRED` and `CHANGE_PHASE_MISSING` do not gain a
current-batch condition. Existing waiver matching and staleness semantics
remain unchanged. Detail-free requirement-scoped waiver snapshots bind to the
current batch; changing current-batch selection can therefore make an existing
waiver stale under the existing hash comparison and requires separate evidence
remediation outside this requirement. A waiver for one of the four current-constrained
detail-keyed diagnostics remains fingerprint-bound to its named batch while
that batch is superseded, is not stale solely because it is inactive, and can
apply again without reapproval if the same unchanged batch later becomes
current.
When no valid TDD void exists, existing detail-free and requirement-keyed
migration waiver snapshot payloads retain their historical shape. Once a valid
void exists for a cycle whose Red order is inside the current batch window, its
void order is added to the snapshot so changing the active cycle requires
renewed waiver review without staling histories that the void cannot affect.
If a newer scoped Red lacks an integer order while an older batch has one, the
older batch remains current; the existing migration diagnostic is the blocking
evidence that prevents the malformed newer batch from being treated as valid,
and waiving that diagnostic retains the existing waiver semantics.
Any non-void TDD cycle whose Red order is itself missing continues to raise
requirement-keyed `CHANGE_ORDER_MIGRATION_REQUIRED` because it cannot be
assigned safely to an ordered batch window.
Ordered cycles outside the current batch window do not participate in its
requirement-keyed missing-Green migration diagnostic.
Given a later complete scoped batch, validation and completeness pass without a
waiver when all other evidence is valid. Given no later overlapping batch,
existing full-set evidence produces the same result as before.
