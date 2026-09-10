# Change requirement-batch TDD evidence design

## DES-CHANGE-REQUIREMENT-BATCHES-001: Requirement-batch Red/Implementation/Green recording
Responsibilities: In `recordChangePhase()`, when `phase` is `red`,
`implementation`, or `green`: if the given `requirementIds` (deduplicated,
sorted) equal the change's full declared `requirementIds`, behave exactly as
today (single occurrence stored in `change.phases[phase]`, existing
prerequisite/duplicate checks unchanged). Otherwise, the given IDs must be a
non-empty subset of the change's declared `requirementIds`; find or create a
matching entry in a new `change.tddBatches` array keyed by that exact ID set,
enforce the same one-shot-per-phase and Red-before-Implementation-before-
Green ordering within that entry, require the change's `design` phase to
already be recorded before a batch's `red`, and append the recorded phase's
monotonic-order-log entry using a phase key that embeds the batch's
requirement ID set so batches do not collide with each other or with the
full-set form. `quality` recording requires every declared requirement ID to
be present in the full-set `green` (if recorded) or in some batch's `green`.
Interfaces: `recordChangePhase(root, changeId, phase, requirementIds):
Promise<ChangeEvidence>` (signature unchanged); new exported type
`ChangeRecord.tddBatches?: Array<{ requirementIds: string[]; red?:
ChangePhaseEvidence; implementation?: ChangePhaseEvidence; green?:
ChangePhaseEvidence }>`.
Constraints: Must not change the recorded shape, validation result, or
monotonic-order-log key for any phase recorded with the change's exact
full requirement ID set (bit-for-bit compatible with previously recorded
`.musubix/evidence/changes.json` and `.musubix/evidence/order.json`
entries). Must reject a batch `requirementIds` argument that is empty or
contains an ID outside the change's declared set.
Requirements: REQ-CHANGE-REQUIREMENT-BATCHES-001 REQ-CHANGE-REQUIREMENT-BATCHES-003 REQ-CHANGE-REQUIREMENT-BATCHES-004
ADRs: ADR-0011

## DES-CHANGE-REQUIREMENT-BATCHES-002: Per-batch chronology and completeness evaluation
Responsibilities: In `validateChangeEvidence()` and
`validateChangeCompleteness()`, compute an "effective batches" list per
change: the full-set form (`change.phases.red`/`implementation`/`green`, if
any recorded) treated as one batch covering every declared requirement ID,
followed by every entry in `change.tddBatches`. For a given requirement ID,
locate the one effective batch whose `requirementIds` includes it (a
requirement belongs to at most one batch, enforced by construction) and use
that batch's own Red/Implementation/Green phase evidence, in place of the
change-level markers, when evaluating `CHANGE_TESTS_UNCHANGED`,
`CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`,
`CHANGE_TEST_CHANGED_AFTER_RED`, `CHANGE_RED_UNPROVEN`,
`CHANGE_GREEN_UNPROVEN`, `CHANGE_ORDER_MIGRATION_REQUIRED`, and
`CHANGE_COMPLETENESS_TDD`. `CHANGE_PHASE_MISSING` for `red`/`implementation`/
`green` fires per requirement ID lacking coverage in any effective batch,
rather than once per change. Order/mismatch checks (`CHANGE_ORDER_MISMATCH`,
`CHANGE_PHASE_ORDER`) apply within each batch (batch Red before batch
Implementation before batch Green; the change's Design order before every
batch's Red order; the change's Quality order after every batch's Green
order that exists).
Interfaces: `validateChangeEvidence(root)`,
`validateChangeCompleteness(root)` (signatures unchanged; diagnostic
`message` text additionally names the affected requirement batch when it is
not the full set).
Constraints: When a change has no `tddBatches` entries, every one of these
checks must produce the identical diagnostics as the pre-existing
single-marker logic (the full-set batch is the only effective batch).
Requirements: REQ-CHANGE-REQUIREMENT-BATCHES-005
ADRs: ADR-0011
