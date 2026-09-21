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
collect every effective batch whose `requirementIds` includes it and select
the current batch as the candidate with the greatest integer Red `order`;
ties select the later effective-batch entry, and when no candidate has an
integer Red order the first applicable entry preserves legacy migration
behavior. Use that batch's own Red/Implementation/Green phase evidence, in
place of the change-level markers, when evaluating `CHANGE_TESTS_UNCHANGED`,
`CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`,
`CHANGE_TEST_CHANGED_AFTER_RED`, `CHANGE_RED_UNPROVEN`,
`CHANGE_GREEN_UNPROVEN`, the `requirement:<id>` form of
`CHANGE_ORDER_MIGRATION_REQUIRED`, and `CHANGE_COMPLETENESS_TDD`. Export the
canonical selector and helpers that derive each selected batch's current
requirement IDs from `change-evidence.ts` so validation, completeness, pure
waiver-condition re-derivation, and detail-free waiver snapshot generation
cannot diverge without introducing a dependency cycle.

For requirement-keyed TDD proof and migration checks, derive a current-cycle
window whose exclusive lower bound is the greatest ordered Red marker from an
earlier applicable batch, falling back to the Requirements order, and whose
inclusive upper bound is the current batch's Red order. Select the cycle with
the greatest integer Red order in that window only for order-migration
evaluation, with later persisted cycles winning ties. TDD proof retains the
legacy any-valid-cycle behavior within the window. Exclude cycles whose void
evidence has valid monotonic order and TDD hash-chain linkage from both paths,
so a latest incomplete attempt is migration-required and an earlier Red-only
attempt superseded by a later valid cycle does not block. Preserve historical
waiver snapshot shapes when no valid void exists; when one does, append its void
order to the snapshot payload only when that cycle's Red order lies in the
current batch window, so only an active-cycle change becomes reviewable.
A non-void cycle with no Red order remains migration-required because it cannot
be placed in an ordered batch window.
Use one shared pure helper to derive the ordered valid-void markers inside the
current batch window, so the detail-free and requirement-keyed migration
snapshot paths cannot diverge.

Evaluate batch-wide diagnostics once per batch selected by at least one
declared requirement, and requirement-scoped diagnostics only for the
intersection of the batch's requirement IDs, the change's declared requirement
IDs, and the IDs that select that batch. Undeclared IDs remain governed by the
existing change requirement-mismatch validation.
`CHANGE_IMPLEMENTATION_SCOPE_MISSING` uses the same current-requirement
projection. For the detail-keyed `CHANGE_TESTS_UNCHANGED`,
`CHANGE_IMPLEMENTATION_UNCHANGED`, and `CHANGE_TEST_CHANGED_AFTER_RED` waiver
conditions, require the named batch to be current for at least one declared
requirement. For `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, require it to be
current for the named requirement. Their snapshot payloads remain bound to
their explicit detail key. Structural detail-keyed conditions
(`CHANGE_ORDER_MIGRATION_REQUIRED` phase/batch forms and
`CHANGE_PHASE_MISSING`) do not gain a current-batch condition. Record-time
`*_AT_RECORD` checks continue to resolve the exact batch key being recorded.
Detail-free requirement-scoped waiver snapshots resolve the current batch
through the canonical selector; existing hash matching and staleness logic is
unchanged.

`CHANGE_PHASE_MISSING` for `red`/`implementation`/`green` and Quality's Green
coverage retain their union across all effective batches. Structural
order/mismatch checks (`CHANGE_ORDER_MISMATCH`, `CHANGE_PHASE_ORDER`, and
phase- or batch-key `CHANGE_ORDER_MIGRATION_REQUIRED`) apply within every
recorded batch (batch Red before batch Implementation before batch Green; the
change's Design order before every batch's Red order; the change's Quality
order after every batch's Green order that exists). Requirement-keyed TDD order
migration uses the current selector.
Interfaces: `validateChangeEvidence(root)`,
`validateChangeCompleteness(root)` (signatures unchanged);
`batchFor(batches, requirementId)` retains its public signature but implements
the current-batch rule; internal/exported projection helpers share the same
selection. The void-window helper accepts the change, requirement ID, TDD
evidence, and linkage-validated void-cycle set, and returns only the void orders
whose cycle Red orders fall inside the current batch window as a sorted
`number[]`; callers retain the existing missing-change guard and treat a missing
change as no window-bound void markers. Snapshot payloads must omit the
`voidedCycleOrders` key entirely when that array is empty, preserving the
historical canonical JSON and snapshot hash bit-for-bit.
`currentRequirementIdsForBatch(batches, batch, requirementIds)`
requires `batch` to be an element of that same `batches` array so duplicate
batch keys remain distinguishable.
Constraints: When a change has no `tddBatches` entries, every one of these
checks must produce the identical diagnostics as the pre-existing
single-marker logic (the full-set batch is the only effective batch). Existing
waiver matching/staleness semantics and malformed-evidence diagnostics remain
unchanged. Selection depends only on applicable Red order; Implementation or
Green presence must not affect selection, and validation must not fall back to
an older complete batch. Every existing `batchFor` caller must be audited as a
current-selection consumer; record-time exact-key paths continue to use
`batchForKey` or their existing exact batch lookup. Candidate snapshot matching
remains outside this change; an existing detail-free waiver can become stale
when current-batch selection changes.
Requirements: REQ-CHANGE-REQUIREMENT-BATCHES-005
ADRs: ADR-0011
