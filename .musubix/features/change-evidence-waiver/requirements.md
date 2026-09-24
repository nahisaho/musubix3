---
schemaVersion: 1
feature: change-evidence-waiver
---
# Change evidence waiver (audited, bounded relief for retroactive-recording debt)

Source: GitHub Issue #1 (reopened; recurrence after Issue #19/#20,
`CHANGE-0009`/`CHANGE-0010`), items 1 and 4 of the recurrence comment.

`sdd-change`'s own workflow requires `requirements`/`design` to be written and
human-approved *before* `impact` can legitimately be recorded, and Red/Green
TDD cycles are commonly executed well before the corresponding
`change-record` phase is recorded at the end of a session. Both of these are
structurally unavoidable without either fabricating evidence or reverting
already-shipped, passing code, yet they cause `validateChangeEvidence`
(`change-history`) to raise `CHANGE_REQUIREMENTS_UNCHANGED`,
`CHANGE_DESIGN_UNCHANGED`, `CHANGE_RED_UNPROVEN`, and `CHANGE_GREEN_UNPROVEN`,
and cause `validateChangeCompleteness` (`change-completeness`) to raise
`CHANGE_COMPLETENESS_TDD`, purely because of recording order, not because the
underlying requirements/design/tests/implementation are actually missing or
wrong. `packages/analysis/src/approval-record.ts` then hard-blocks release
approval on both checks reporting `pass`, so release approval becomes
permanently unreachable once several `sdd-change` cycles accumulate, even
though the underlying features are functionally complete and reviewed.

This change adds an explicit, human-approved `change waiver record` command
that downgrades one specific, currently-present instance of one allow-listed
diagnostic code (for one change and, where applicable, one requirement
and/or one `--detail` scope per REQ-016) from `error` to `warning`, as an
appended, hash-chained, audited record — never a deletion, edit, or blanket
disable of the underlying check. It was first shipped scoped to exactly five
codes (below), then extended by CHANGE-0012 to the twelve codes enumerated
in REQ-001. It is narrowly scoped to this well-understood recording-order
debt shape; it must not weaken `change-history`/`change-completeness` for any
non-allow-listed diagnostic code, for any other change, requirement, or
`--detail` scope, or for a genuinely fresh violation of the same scope once
the waived evidence state changes.

A native `rubber-duck` review of the first draft is expected to probe
duplicate-waiver handling, change-level vs. requirement-level code scoping,
and whether a waiver can silently keep suppressing a diagnostic after new,
unrelated evidence is recorded; this draft is written to close those gaps
up front (REQ-009 through REQ-011), modeled on the equivalent guarantees
already shipped for `tdd-cycle-void`.

## Extension: broader pre-existing recording-order debt (CHANGE-0012)

Source: `gate --changed` resolution work following Issue #1's recurrence,
surfacing that `CHANGE-0005`, `CHANGE-0006`, `CHANGE-0009`, `CHANGE-0010`, and
`CHANGE-0011` carry additional diagnostic codes emitted by
`validateChangeEvidence`/`validateChangeCompleteness` that are of the exact
same recording-order nature as the original five (the requirements, design,
tests, and implementation are not actually missing or wrong; only the
after-the-fact chronology recording is incomplete or was recorded out of the
tool's expected order), but were outside the original five-code allow-list:
`CHANGE_RECORD_MISSING`, `CHANGE_PHASE_MISSING`, `CHANGE_ORDER_MIGRATION_REQUIRED`,
`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`,
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, and `CHANGE_TEST_CHANGED_AFTER_RED`.
`CHANGE_COMPLETENESS_CODE` (missing Code Graph implementation evidence for a
requirement) is deliberately excluded: it reports a genuine implementation
gap, not a recording-order artifact, so it stays outside the allow-list and
must be resolved by writing/linking the missing code, never waived.

Unlike the original five, several of these codes can legitimately report
**more than one simultaneous instance for the same `changeId`** (e.g. a change
missing several phases at once, or several independent per-requirement TDD
batches each independently missing tests/implementation changes). REQ-016
introduces an additional, optional `detail` scope key — alongside the existing
`requirementId` key — so each such instance can be waived individually without
ever waiving a sibling instance of the same code on the same change.

## REQ-CHANGE-EVIDENCE-WAIVER-001: Restrict waivable codes to the documented recording-order allow-list
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record <CHANGE-ID> <CODE>` is invoked with a `<CODE>` other than `CHANGE_REQUIREMENTS_UNCHANGED`, `CHANGE_DESIGN_UNCHANGED`, `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, `CHANGE_COMPLETENESS_TDD`, `CHANGE_RECORD_MISSING`, `CHANGE_PHASE_MISSING`, `CHANGE_ORDER_MIGRATION_REQUIRED`, `CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, or `CHANGE_TEST_CHANGED_AFTER_RED`, then the system shall reject the invocation and record no evidence.
Acceptance: Given `<CODE>` is `CHANGE_COMPLETENESS_ACCEPTANCE`,
`CHANGE_DOCUMENT_MISSING`, `CHANGE_PHASE_ORDER`, `CHANGE_ORDER_MISMATCH`,
`CHANGE_IMPLEMENTATION_SCOPE_MISSING`, `CHANGE_COMPLETENESS_CODE`, or any
string not in the twelve-code allow-list, `change waiver record` exits
nonzero with an error naming the rejected code and listing the allowed
codes, and
`.musubix/evidence/change-waivers.json` and `.musubix/evidence/order.json`
are byte-identical before and after the call.

## REQ-CHANGE-EVIDENCE-WAIVER-002: Require the exact waiver condition to be currently true
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record <CHANGE-ID> <CODE>` is invoked and its REQ-CHANGE-EVIDENCE-WAIVER-011 condition evaluator does not return `true` for the exact scope, then the system shall reject the invocation and record no evidence.
Acceptance: Given a full
`changeId`/`code`/`requirementId`/`detail` scope for which the evaluator
returns `false`, `change waiver record` exits nonzero with an
error stating there is no matching diagnostic to waive, and both evidence files are
byte-identical before and after the call. This rejects pre-emptive,
speculative waivers recorded before the debt actually exists.
Given a syntactically valid batch-scoped `--detail` whose batch key is absent
from the current effective batches, the evaluator returns `indeterminate`;
the command exits nonzero with an error stating that the scope cannot be
evaluated before considering diagnostic absence, and both evidence files
remain byte-identical.
Given `CHANGE_ORDER_MIGRATION_REQUIRED --detail requirement:<REQ-ID>` where
the encoded requirement is not currently declared by the change, the
evaluator likewise returns `indeterminate` and the same no-write rejection
applies.

## REQ-CHANGE-EVIDENCE-WAIVER-003: Require an explicit human approver, reason, and confirmation
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record` is invoked without a non-empty `--approver` name, a non-empty `--reason` string, or the `--confirm` flag, then the system shall reject the invocation and record no evidence.
Acceptance: Omitting `--approver`, omitting `--reason`, omitting `--confirm`,
or supplying an empty/whitespace-only `--approver` or `--reason` each exit
nonzero with an error naming the missing/invalid option, and
`.musubix/evidence/change-waivers.json`/`.musubix/evidence/order.json` are
unchanged in every case.

## REQ-CHANGE-EVIDENCE-WAIVER-004: Bind each code to exactly one documented scope-key regime
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record` is invoked with a `<CODE>`/`--requirement`/`--detail` combination that does not exactly match that `<CODE>`'s allow-listed scope-key row (`CHANGE_REQUIREMENTS_UNCHANGED`, `CHANGE_DESIGN_UNCHANGED`, `CHANGE_RECORD_MISSING`: neither key; `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, `CHANGE_COMPLETENESS_TDD`: `--requirement` only; `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`: both `--requirement` and `--detail`; `CHANGE_PHASE_MISSING`, `CHANGE_ORDER_MIGRATION_REQUIRED`, `CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_TEST_CHANGED_AFTER_RED`: `--detail` only), then the system shall reject the invocation and record no evidence.
Acceptance: This matrix is exhaustive over all twelve
REQ-CHANGE-EVIDENCE-WAIVER-001 allow-listed codes; every code appears in
exactly one row, and every row names exactly one of {neither key, `--requirement`
only, `--detail` only, both keys}. Waiving `CHANGE_RED_UNPROVEN` without
`--requirement`, with `--detail` supplied, or with a `--requirement` value
not among the change's declared requirement IDs, exits nonzero and records
no evidence. Waiving `CHANGE_REQUIREMENTS_UNCHANGED` or `CHANGE_RECORD_MISSING`
with `--requirement` or `--detail` supplied exits nonzero, stating that code
is change-level and accepts neither scope key, and records no evidence.
Waiving `CHANGE_PHASE_MISSING` with `--requirement` supplied (instead of
`--detail`) exits nonzero. Waiving `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`
with only one of `--requirement`/`--detail` supplied exits nonzero, since
that code requires both to disambiguate an overlapping-batch instance.

## REQ-CHANGE-EVIDENCE-WAIVER-016: Define the canonical `--detail` value grammar per code
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `<CODE>` is one of `CHANGE_PHASE_MISSING`, `CHANGE_ORDER_MIGRATION_REQUIRED`, `CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_TEST_CHANGED_AFTER_RED`, or `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, and a supplied `--detail <value>` is not valid for that code's canonical grammar below, then the system shall reject the invocation before condition evaluation and record no evidence; a grammatically valid detail is subsequently accepted or rejected solely by the REQ-CHANGE-EVIDENCE-WAIVER-011 evaluator and REQ-CHANGE-EVIDENCE-WAIVER-002.
Acceptance: The canonical `detail` grammar is: for `CHANGE_PHASE_MISSING`,
exactly `phase:<phaseName>` (`phaseName` one of
`impact`/`requirements`/`design`/`quality`/`red`/`implementation`/`green`,
with the three TDD phase names representing aggregate missing-requirement
coverage); for the phase-level flavor of
`CHANGE_ORDER_MIGRATION_REQUIRED`, exactly `phase:<phaseName>` (`phaseName`
one of `impact`/`requirements`/`design`); for its batch-phase
flavor, exactly `batch:<phaseName>:<batchKey>` (`phaseName` one of
`red`/`implementation`/`green`, `batchKey` the batch's unique requirement
IDs deduplicated, sorted ascending, and joined with `,`, identical to the
existing internal `batchKey` convention). A supplied batch key is valid only
when it is non-empty, consists of non-empty comma-separated requirement-ID
tokens, contains no duplicates, and is already sorted ascending by that same
comparator; otherwise it is invalid grammar rather than an absent current
batch. For the TDD-cycle-order flavor of
`CHANGE_ORDER_MIGRATION_REQUIRED`, exactly `requirement:<REQ-ID>`; for
`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`,
`CHANGE_TEST_CHANGED_AFTER_RED`, and the batch component of
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, exactly `<batchKey>` alone (no
prefix). Given a fixture change reports simultaneous `CHANGE_PHASE_MISSING`
instances with `detail` values `phase:requirements`, `phase:design`, and
`phase:red` (same `changeId`/`code`), calling
`change waiver record CHANGE-0001 CHANGE_PHASE_MISSING --detail
phase:requirements ...` waives only that instance; the `phase:design` and
`phase:red` instances continue reporting `severity: "error"` per
REQ-CHANGE-EVIDENCE-WAIVER-009 (generalized to the `changeId`/`code`/
`requirementId`/`detail` tuple). Given two independently recorded `red`
batches for different requirement sets on the same change both lacking
`order`, their `CHANGE_ORDER_MIGRATION_REQUIRED` instances emit distinct
`batch:red:<batchKey>` values and a waiver naming one `batchKey` never
downgrades the other. Omitting `--detail` for a code whose row requires
it exits nonzero and records no evidence; a grammatically valid detail is
then accepted or rejected under REQ-002/011. A code whose
REQ-CHANGE-EVIDENCE-WAIVER-004 row does not require `--detail` never
accepts it; supplying it exits nonzero.
Supplying an unlisted phase name or a `batch:` detail for
`CHANGE_PHASE_MISSING` exits nonzero with an invalid-detail error before
condition evaluation and leaves waiver/order evidence byte-identical.
Given two effective batches sharing the same canonical batch key, they share
one exact structured waiver scope: a matching `batch:<phase>:<batchKey>` or
bare `<batchKey>` waiver applies to every emitted diagnostic instance with
that tuple, while REQ-CHANGE-EVIDENCE-WAIVER-011 aggregates all colliding
instances and returns `true` if and only if at least one such target instance
is emitted.

## REQ-CHANGE-EVIDENCE-WAIVER-005: Record the waiver as a hash-chained, ordered, identity-bound evidence entry
Priority: must
Type: functional
Pattern: event-driven
Statement: When `change waiver record` succeeds, the system shall append exactly one self-chained waiver record per REQ-CHANGE-EVIDENCE-WAIVER-015 to `.musubix/evidence/change-waivers.json`, computing and persisting that code's current `snapshotVersion` and its canonical-JSON SHA-256 as `snapshotHash` so the new record is non-stale under REQ-CHANGE-EVIDENCE-WAIVER-011 immediately after creation, alongside exactly one evidence-order entry stamped with that same `changeId`/`code`/`requirementId`/`detail`/`phase: "waiver"`, without modifying, reordering, or deleting any existing change, TDD, or waiver evidence.
Acceptance: After a successful `change waiver record`, every previously
recorded change/TDD/waiver evidence entry is byte-identical to before the
call; the new waiver record's `snapshotVersion`/`snapshotHash` equal the
current recomputed values for that `changeId`/`code`/`requirementId`/`detail`
at the moment of recording, so evaluating REQ-CHANGE-EVIDENCE-WAIVER-011
immediately afterward reports it non-stale; `.musubix/evidence/order.json`
gains exactly one new record whose `phase` is `waiver`, whose
`changeId`/`code`/`requirementId`/`detail` match the invocation, and whose
`sequence` is one greater than the previous maximum and equals the new
waiver record's own `order` field.

## REQ-CHANGE-EVIDENCE-WAIVER-006: Define valid waiver linkage as unique, identity-bound, self-consistent, and hash-consistent
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall determine valid waiver linkage solely from an allow-listed `code`, the presence or absence and canonical grammar of `requirementId`/`detail` required by REQ-CHANGE-EVIDENCE-WAIVER-004/016, exactly one matching `phase: "waiver"` order record for that record's scope and stored `order` sequence, exclusive ownership of that order sequence by one waiver record, and a valid REQ-CHANGE-EVIDENCE-WAIVER-015 chain.
Acceptance: Given a waiver record that is otherwise hash- and
order-consistent but declares a `code` outside the twelve-value
allow-list, declares `requirementId`/`detail` whose presence or absence is
inconsistent with its code's REQ-004 row, stores a `detail` that fails that
code's REQ-016 canonical grammar, has no matching
`order.json` entry, or whose chain fields fail
REQ-CHANGE-EVIDENCE-WAIVER-015, linkage is likewise invalid; more than one
validly linked waiver record may share the same
`changeId`/`code`/`requirementId`/`detail` scope across separate `order`
values (for example when REQ-CHANGE-EVIDENCE-WAIVER-010 permits a
replacement after an earlier one goes stale), and every waiver consumer
(diagnostic downgrade, duplicate rejection, stale reporting, and active-waiver
listing) uses only the validly linked record with the greatest `order` for
that scope as authoritative. Given a structurally valid waiver, adding or removing its
`changes.json` entry, adding or removing its `requirementId` from the
current declaration, deleting/restoring its change document, or
resolving/reintroducing its underlying condition does not make linkage
malformed; those state changes are classified by the standalone condition
evaluator and any independently applicable validator diagnostics.
Requirement-value membership in the
current declaration is not a linkage condition. Only a record passing
every record-identity, chain, and order-linkage condition is validly linked.
Every reference in the remaining requirements to a validly linked,
non-stale waiver record means this authoritative record for its exact scope.
Two waiver records may not claim the same stored `order` sequence; such a
collision makes the colliding linkage invalid rather than relying on array
position as an authority tie-breaker.

## REQ-CHANGE-EVIDENCE-WAIVER-007: Report malformed waiver evidence
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If the waiver evidence file cannot be parsed/validated as a record array, or a waiver record does not have valid linkage per REQ-CHANGE-EVIDENCE-WAIVER-006, then the system shall emit an error-severity `CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic naming the malformed file or record through both change validators and top-level `gate`/`status` `waiverDiagnostics`, without downgrading any target diagnostic on the strength of that malformed evidence.
Acceptance: Given a waiver record that fails any condition of
REQ-CHANGE-EVIDENCE-WAIVER-006, `gate --json` reports a diagnostic
identifying the malformed waiver evidence, and the `CHANGE_*`/
`CHANGE_COMPLETENESS_*` diagnostic it targeted still reports `severity:
"error"`, exactly as if no waiver had been recorded for it.

## REQ-CHANGE-EVIDENCE-WAIVER-008: Downgrade a validly waived diagnostic instance to a warning, never suppress it
Priority: must
Type: functional
Pattern: state-driven
Statement: While a waiver record for a `changeId`/`code`/`requirementId`/`detail` combination is validly linked and non-stale under REQ-CHANGE-EVIDENCE-WAIVER-011, the system shall report the `validateChangeEvidence`/`validateChangeCompleteness` diagnostic carrying that exact structured `changeId`/`code`/`requirementId`/`detail` target with `severity: "warning"` and an attached `waiver` object containing the `approver` `reason` and `recordedAt` from that waiver record instead of `severity: "error"`.
Acceptance: Given a validly waived, non-stale `CHANGE_RED_UNPROVEN` instance
for `CHANGE-0009`/`REQ-APPROVAL-DOMAIN-SCOPING-001`, `gate --json` reports
that diagnostic with `severity: "warning"` and a `waiver` object whose
`approver`/`reason`/`recordedAt` match the recorded waiver, and the
diagnostic message text is unchanged; the diagnostic is never fully
removed from the report. Given a validly waived, non-stale
`CHANGE_PHASE_MISSING` instance for `CHANGE-0011`/`detail: "phase:design"`, only
that `detail` value's diagnostic instance is downgraded. Matching is
performed only against each diagnostic's structured `changeId`/
`requirementId`/`detail` fields (added by REQ-CHANGE-EVIDENCE-WAIVER-013),
never by parsing message text.

## REQ-CHANGE-EVIDENCE-WAIVER-009: Preserve error severity for every non-waived diagnostic instance of the same code
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report `severity: "error"`, unaffected, for every diagnostic instance of a waivable code whose exact `changeId`/`code`/`requirementId`/`detail` scope does not have an authoritative, validly linked, non-stale waiver record.
Acceptance: Given `CHANGE-0009` has a valid waiver for
`CHANGE_RED_UNPROVEN`/`REQ-APPROVAL-DOMAIN-SCOPING-001` only, a
`CHANGE_RED_UNPROVEN` instance for `REQ-APPROVAL-DOMAIN-SCOPING-002` on the
same change, or for `REQ-APPROVAL-DOMAIN-SCOPING-001` on a different
change, still reports `severity: "error"`; waiving one exact scope never
downgrades any other change's, requirement's, code's, or `detail` value's
diagnostic instance. Given `CHANGE-0011` has a valid waiver for
`CHANGE_PHASE_MISSING`/`detail: "phase:design"` only, its `detail: "phase:quality"`
instance still reports `severity: "error"`.

## REQ-CHANGE-EVIDENCE-WAIVER-010: Reject a duplicate waiver for an already validly waived, non-stale scope
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record` is invoked for a `changeId`/`code`/`requirementId`/`detail` combination whose authoritative record is validly linked and non-stale, then the system shall reject the invocation and record no additional evidence.
Acceptance: Calling `change waiver record` a second time for the identical
`changeId`/`code`/`requirementId`/`detail` immediately after a successful
waiver, with no intervening evidence change, exits nonzero with an error
stating the scope is already waived, and both evidence files are
byte-identical before and after the second call.

## REQ-CHANGE-EVIDENCE-WAIVER-011: Define the per-code snapshot payload and stale-waiver severity
Priority: must
Type: functional
Pattern: state-driven
Statement: While an authoritative waiver record is stale, the system shall report `CHANGE_WAIVER_STALE` naming that scope with `severity: "error"` when the canonical condition predicate evaluates `true` or `indeterminate` and `severity: "warning"` only when it evaluates `false`.
Acceptance: An authoritative waiver record is stale when its stored
`snapshotVersion`/`snapshotHash` differs from the current
`snapshotVersion`/recomputed canonical-JSON SHA-256 hash for the same exact
scope, or while its canonical condition predicate is `false` or
`indeterminate`. A `false` condition is currently stale because that target
code is no longer reported for the scope (warning), without asserting that
every related underlying debt is resolved; an `indeterminate` condition is
stale-and-unevaluable (error).
The canonical snapshot payload for each allow-listed code
contains exactly: for `CHANGE_REQUIREMENTS_UNCHANGED`,
`impact.fingerprints.requirements`, `requirements.fingerprints.requirements`,
and `requirements.allowUnchanged`; for `CHANGE_DESIGN_UNCHANGED`,
`requirements.fingerprints.design` and `design.fingerprints.design`; for
`CHANGE_RED_UNPROVEN`/`CHANGE_GREEN_UNPROVEN`/`CHANGE_COMPLETENESS_TDD`,
the targeted requirement's effective batch's `red`/`implementation`/`green`
phase fingerprints and `order` values, the change's `requirements` phase
`order`, and every TDD cycle for that requirement with its `red`/`green`
`valid`/`order` values, plus the `void.order` values of validly voided cycles
in the current TDD window when that list is non-empty. Cycle objects use a
total order: integer `red.order` values ascending, then present non-integer
values by canonical JSON, then absent values, with `cycleId` ascending
lexicographically (absent as `""`) and then the canonical JSON of the
serialized cycle object as final tie-breakers before `cycleId` is excluded.
The `void.order` list is sorted numerically ascending independently;
For `CHANGE_RECORD_MISSING`, the payload is `null` when the change document is
absent; otherwise it contains the SHA-256 digest of
`.musubix/changes/<CHANGE-ID>.md`'s current text content, plus whether
`.musubix/evidence/changes.json` currently has an entry for `changeId`
(an explicit absent/present sentinel) and, when present, that entry's
canonical-JSON digest, plus whether `.musubix/evidence/order.json`'s
append-only, never-modified-or-deleted record log (a pre-existing system
invariant covering every recorded `change`/`tdd` phase, not only waivers)
contains any `kind: "change"` record with
that `entityId`/`changeId` and a `phase` other than `"waiver"` (a second,
independently monotonic ever-recorded sentinel that cannot revert to false
once true, even if the `changes.json` entry is later removed); for
`CHANGE_PHASE_MISSING` with `phase:<impact|requirements|design|quality>`,
the shared payload
`{ phasePresent, orderIsInteger, phaseOrder, missingRequirementIds: null }`
representing that phase's presence/`order` integrality; with
`phase:<red|implementation|green>`, the same four-field payload with
`phasePresent`/`orderIsInteger`/`phaseOrder` fixed to `null` and
`missingRequirementIds` equal to the sorted currently missing requirement IDs
for that aggregate phase; for
`CHANGE_ORDER_MIGRATION_REQUIRED` when its `detail` has the
`phase:`/`batch:` prefix, that phase or batch item’s presence/`order`
integrality; for
`CHANGE_ORDER_MIGRATION_REQUIRED` when its `detail` has the `requirement:`
prefix, that requirement's TDD cycles' `red`/`green` `order` integrality plus
the `void.order` values of validly voided cycles in the current TDD window
when that list is non-empty, using the same total cycle ordering and
independently numerically sorted void-order list defined above;
for `CHANGE_TESTS_UNCHANGED` scoped by `detail` (the batch key), the
change's `design` phase `fingerprints.tests` and that batch's `red` phase
`fingerprints.tests`; for `CHANGE_IMPLEMENTATION_UNCHANGED` scoped by
`detail` (the batch key), that batch's `red` phase
`fingerprints.implementation` and `implementation` phase
`fingerprints.implementation`; for `CHANGE_TEST_CHANGED_AFTER_RED` scoped
by `detail` (the batch key), that batch's `red` phase `fingerprints.tests`
and `green` phase `fingerprints.tests`; for
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED` scoped by both `requirementId`
and `detail` (the batch key), that batch's `red`/
`implementation` `fingerprints.requirementImplementations[requirementId]`
values. For each `CHANGE_ORDER_MIGRATION_REQUIRED` `batch:` or
bare-batch-key payload, when zero or one effective batch matches the key, the
payload keeps that existing flat shape, evaluating an absent batch exactly as
the current zero-match payload does; when more than one effective batch
matches, the
payload instead contains `matchingBatches` in effective-batch order. The
`CHANGE_TESTS_UNCHANGED` change-level `design.fingerprints.tests` field stays
at the payload root, while each matching object has exactly these code-specific
fields: `{ phaseItemPresent,
orderIsInteger, phaseOrder }` for the order-migration `batch:` flavor;
`{ ownedRequirementIds, batchRedTests }` for `CHANGE_TESTS_UNCHANGED`;
`{ ownedRequirementIds, redImplementation,
implementationImplementation }` for `CHANGE_IMPLEMENTATION_UNCHANGED`;
`{ ownedRequirementIds, redTests, greenTests }` for
`CHANGE_TEST_CHANGED_AFTER_RED`; and `{ ownedRequirementIds,
redRequirementImplementation, implementationRequirementImplementation }`
for `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`. Each listed
`ownedRequirementIds` value is sorted and returned by the current
batch-ownership rule; the
`CHANGE_ORDER_MIGRATION_REQUIRED` `batch:` flavor has no ownership field.
Thus adding or removing duplicate matches changes the canonical payload;
transferring ownership changes a multi-match bare-key payload, while a
single-match ownership change is payload-invisible unless the matched batch
loses all current ownership, in which case the evaluator returns `false`;
reordering matches changes a payload whenever their serialized matching
objects differ. Document-present zero/single-match payloads preserve their
last-released field shape and hash computation; document-present multi-match
and document-absent states use the corrected shapes defined here at the
current snapshot version.
Given a `CHANGE_RECORD_MISSING` waiver recorded while `changes.json` has no
entry for `changeId` and `order.json` has no non-`waiver` `change` record
for it either, a subsequent `change-record` invocation that both adds a
`changes.json` entry and appends the first non-`waiver` `order.json`
record for that `changeId`, followed by that entry's later removal from
`changes.json`, leaves the `order.json` ever-recorded sentinel permanently
`true`; the snapshot therefore differs from its original value and the old
waiver reports stale rather than silently re-applying.
Given a validly waived `CHANGE_GREEN_UNPROVEN` instance, after a new TDD
cycle or a new `change-record green` phase changes any field of this
payload for that change/requirement, `gate --json` reports the
`CHANGE_GREEN_UNPROVEN` instance with `severity: "error"` (not
`"warning"`) plus a separate diagnostic identifying that requirement's
waiver as stale. Given the same change afterward, the underlying condition
no longer holds and `validateChangeEvidence`/`validateChangeCompleteness`
no longer emits that `changeId`/`code`/`requirementId`/`detail` diagnostic,
`gate --json` reports only the stale-waiver diagnostic with `severity:
"warning"`, does not fabricate the no-longer-reported
`CHANGE_*`/`CHANGE_COMPLETENESS_*` diagnostic, and does not fail a required
check solely because of that warning. Stale-waiver reporting uses a standalone,
independently callable tri-state evaluator that never infers condition state
from a validator's assembled diagnostics and implements the same
code-specific condition semantics which produce the corresponding structured
diagnostic: `true`, `false`, or `indeterminate`. Only `false` maps to
`severity: "warning"`; `true` and `indeterminate` map to `severity: "error"`.
A missing change, undeclared
requirement, malformed detail, batch key absent from the current effective
batches, unavailable scope, or other inability to evaluate the condition
returns `indeterminate` rather than `false`. Given a stale
`CHANGE_COMPLETENESS_TDD` waiver whose exact evaluator condition is `true` or
`indeterminate`, both change-history and change-completeness reporting retain
an error for that stale scope; when that condition becomes `false` (including
through debt resolution or a validator guard that stops reporting the target),
both reporting paths instead report the stale waiver as a warning. For every
allow-listed code, each validator
reports exactly one stale-waiver diagnostic for each authoritative, validly
linked stale scope, using the same tri-state result and severity mapping rather
than inferring resolution from its own local diagnostic array. For every
allow-listed code and fully evaluable exact scope, at least one corresponding
validator diagnostic instance is emitted if and only if the evaluator returns
`true`;
`indeterminate` does not fabricate the target diagnostic.
This cross-validator audit is intentional: either standalone validator can
become invalid from an error-severity stale scope even when the corresponding
target code originated in the other validator. `gate --json` and `status
--json` each expose an identical repository-wide top-level
`waiverDiagnostics` change-waiver subset containing exactly one
`CHANGE_WAIVER_STALE` per authoritative stale scope plus the malformed
diagnostics required by REQ-007; workflow-waiver audit entries may coexist in
the same field. The change-waiver subset is exactly entries whose `code` is
`CHANGE_WAIVER_STALE` or `CHANGE_WAIVER_EVIDENCE_MALFORMED`: one malformed
entry per invalid waiver record (or one file-level entry when the file cannot
be parsed/validated as a record array), and one stale entry per authoritative
stale scope. If the file itself is malformed, the file-level diagnostic is the sole
change-waiver subset entry. Otherwise iterate ascending waiver-array index:
emit a malformed record diagnostic at its record index, or, for the first
index whose record carries a given valid scope, emit that scope's
authoritative stale diagnostic when applicable, at most once per scope. Both
surfaces obtain that subset from `waiverEvidenceDiagnostics`, so their
change-waiver subsets deep-equal for the same repository state. The change, TDD, order, and change-waiver evidence files remain byte-identical
before and after `gate --json`; a second run over unchanged state yields a
deep-equal change-waiver subset. This top-level field is report-only; full/`--changed`
blocking comes from the validators' per-check diagnostics. `gate --feature`
does not filter the top-level field, and the same repository-wide subset is
reported by full, `--changed`, and `--feature` gate modes plus `status`.
Feature per-check arrays intentionally
retain the existing path/message feature filter for every diagnostic,
including waiver diagnostics; unscoped waiver diagnostics that do not match
that filter are omitted from feature-check status by design, preserving
REQ-CLI-WORKFLOW-UX-005 isolation.
The evaluator first applies these scope-availability preconditions:
`indeterminate` is required when the change document is absent for
`CHANGE_RECORD_MISSING`, a
non-`CHANGE_RECORD_MISSING` scope has no current change-evidence entry, a
required `requirementId` is undeclared, `detail` fails its canonical grammar,
the requirement encoded by a `requirement:<REQ-ID>` detail is undeclared, or a
detail-scoped batch key resolves to zero current effective batches. For
evaluation, these `indeterminate` preconditions take precedence over every
code-specific helper or ownership predicate below. Otherwise the evaluator
applies each code's defining predicate: an absent chronology entry is `true`
for `CHANGE_RECORD_MISSING`; a missing referenced phase or aggregate
requirement coverage is `true` for `CHANGE_PHASE_MISSING`; and any other
absence that the corresponding validator predicate itself defines as the
target diagnostic condition is likewise `true`. For
`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`,
`CHANGE_TEST_CHANGED_AFTER_RED`, and
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, when one or more batches share the
key, the evaluator applies the same `currentRequirementIdsForBatch` ownership
rule as the validator, returns `false` when no matching batch currently owns
any requirement per `currentRequirementIdsForBatch` (or, for
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, when none owns the named
`requirementId`), and otherwise returns `true` when any currently owned
matching batch emits the exact target (for
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, when the named requirement is
currently owned and its helper is true), or `false` when none do. For the
`CHANGE_ORDER_MIGRATION_REQUIRED` `batch:` flavor, the evaluator applies no
ownership filter; when one or more effective batches match the key it returns
`true` when any match has the named phase item present with a non-integer
order, or `false` when none do. Zero matches returns `indeterminate`. The
evaluator maps each existing total code-specific boolean helper directly,
including its defined result for absent phases or fingerprints, except that
`CHANGE_RED_UNPROVEN` and `CHANGE_GREEN_UNPROVEN` return `false` when
`qualityHistory` is non-empty, matching the validator guard. For
every fully evaluable exact scope, the evaluator returns `true` if and only if
at least one corresponding target diagnostic instance is emitted.
`change waiver record` succeeds only when this evaluator returns `true` for
the exact scope; a scope that evaluates `indeterminate` causes the command to
exit nonzero with an error stating that
the scope cannot be evaluated, while `.musubix/evidence/change-waivers.json`
and `.musubix/evidence/order.json` remain byte-identical, so every successful
new waiver remains non-stale immediately after creation as required by
REQ-005. A stored detail that no longer passes REQ-016 is malformed linkage
under REQ-006/007, not an indeterminate stale scope. Restoring an absent
document/change/requirement/batch scope makes an
indeterminate historical waiver evaluable again; the user then resolves the
debt or records an allowed replacement, so append-only evidence does not
require a deletion/tombstone path.
Given a fixture with no waiver evidence, validation before and after this
change emits the same set of the twelve allow-listed target diagnostics with
the same severity, message, `changeId`, `requirementId`, and `detail`; sharing
the evaluator as the predicate implementation must not alter waiver-free
behavior.
For an authoritative stale target whose condition is `indeterminate`,
`CHANGE_WAIVER_STALE` itself remains the error-severity fail-closed
diagnostic; the validator does not fabricate the unresolved target diagnostic.
An independently applicable existing upstream diagnostic, including
`CHANGE_IMPLEMENTATION_SCOPE_MISSING` for absent or empty
requirement-implementation fingerprints, remains unchanged. When the evaluator
returns `false` no corresponding validator diagnostic is emitted. Given a stale batch-scoped waiver whose
recorded batch key no longer exists, the stale-waiver diagnostic remains an
error because its condition is `indeterminate`, not resolved. A future, incompatible change to a code's snapshot payload field set or
canonical shape increments `snapshotVersion`, making every waiver recorded
under a prior version stale regardless of field equality. This revision keeps
the current snapshot version because its new `matchingBatches` shape is
reachable only for previously ambiguous multi-match scopes; a correction that
changes only computed values for a previously miscomputed state also keeps the
version because the existing hash mismatch makes every affected waiver
`CHANGE_WAIVER_STALE`. Changes that alter an existing zero/single-match field
set or canonical shape for a valid code-specific zero-, single-, or
multi-match payload in a state that already had a defined valid payload
require a version increment. Defining a previously ambiguous state or
correcting computed values while preserving the field set does not. Replacing the unintended
global `null` short-circuit with the already-defined code-specific payload
does not require an increment because `null` was not a valid payload for these
eleven codes. A stale scope whose evaluator
returns `false` intentionally remains as a persistent warning and append-only
record; it remains machine-visible through the diagnostic and
`.musubix/evidence/change-waivers.json` even though REQ-012 excludes stale
records from the active `waivers` array.
For the eleven non-`CHANGE_RECORD_MISSING` codes, snapshot computation uses
chronology/TDD/order state even when the independent change document is
absent. This same-version correction can change hashes only for the
document-absent state, including a payload computed from absent chronology
by applying the exact code-specific field derivations defined above:
absent fingerprint/order/phase-item/`allowUnchanged` values serialize as
explicit `null`; non-aggregate presence/integer flags serialize as `false`,
while code-specific aggregate fields fixed to `null` remain `null`; aggregate
`missingRequirementIds` is `null` when the change entry is absent. Batch match
lists are empty. TDD-derived `cycles` remains its deterministically sorted
array. With chronology present, the
independently emitted `CHANGE_DOCUMENT_MISSING` error remains fail-closed;
with chronology also absent, the evaluator remains fail-closed through an
`indeterminate` stale error.
Given equivalent document-present zero/single-match fixtures, their canonical
snapshot payloads and hashes remain byte-identical to the last-released
calculation. Given a
waiver recorded from the former document-absent behavior and retained with
chronology present, its recomputed hash differs and both validators report
`CHANGE_WAIVER_STALE` with the severity determined by the current tri-state
condition.
The `CHANGE_WAIVER_STALE` diagnostic `message` contains `target code is no
longer reported` and `replacement waiver is not required` for `false`, without
saying that all related debt is resolved. For `true`, its message contains
`condition still exists` and directs the user to resolve it or record an
allowed replacement. For `indeterminate`, its message contains `cannot be
evaluated` and directs the user to restore an evaluable change, requirement,
or batch scope before rerunning validation.
The batch-scoped order-migration evaluator and validator emission use the same
code-specific predicate implementation so their presence, integer-order, and
matching-batch semantics cannot diverge.
Across absent, present-with-integer-order, present-with-non-integer-order,
zero-match, single-match, and multi-match fixtures, that shared predicate
causes the evaluator to return `true` if and only if the target diagnostic is
emitted, returns `false` when no match has a named phase item with non-integer
order (including a phase-item-absent match or all-integer matches), and
returns `indeterminate` when the exact batch scope has zero matches.
Given a recorded waiver whose snapshot hash remains equal but whose evaluator
changes from `true` to `false`, both `validateChangeEvidence` and
`validateChangeCompleteness` report exactly one warning-severity
`CHANGE_WAIVER_STALE` for the authoritative scope and emit no fabricated target
diagnostic. Given a later effective batch with the same canonical batch key,
the recomputed multi-match snapshot differs from the prior single-match
snapshot, so a still-`true` target is error-severity and the earlier waiver no
longer downgrades any matching diagnostic.

## REQ-CHANGE-EVIDENCE-WAIVER-012: Surface active waivers in `status`/`gate --json` for audit visibility
Priority: should
Type: functional
Pattern: event-driven
Statement: When `gate --json` or `status --json` runs and one or more validly linked non-stale waiver records exist, the system shall include a `waivers` array listing each waiver's `changeId`, `code`, `requirementId` (when present), `detail` (when present), `approver`, `reason`, and `recordedAt`.
Acceptance: `gate --json` output contains a `waivers` array with one entry
per scope whose authoritative record is validly linked and non-stale, each carrying exactly the
`changeId`/`code`/`requirementId`/`detail`/`approver`/`reason`/`recordedAt`
values persisted by REQ-CHANGE-EVIDENCE-WAIVER-005; a stale or malformed
waiver (per REQ-CHANGE-EVIDENCE-WAIVER-007/011) is excluded from this
array.

## REQ-CHANGE-EVIDENCE-WAIVER-013: Attach structured `changeId`/`requirementId`/`detail` targets to waivable diagnostics
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall attach a structured `changeId` field, a `requirementId` field when the diagnostic is requirement-scoped per REQ-CHANGE-EVIDENCE-WAIVER-004, and a `detail` field when the diagnostic is `detail`-scoped per REQ-CHANGE-EVIDENCE-WAIVER-016, to every `CHANGE_REQUIREMENTS_UNCHANGED`, `CHANGE_DESIGN_UNCHANGED`, `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, `CHANGE_COMPLETENESS_TDD`, `CHANGE_RECORD_MISSING`, `CHANGE_PHASE_MISSING`, `CHANGE_ORDER_MIGRATION_REQUIRED`, `CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, and `CHANGE_TEST_CHANGED_AFTER_RED` diagnostic emitted by `validateChangeEvidence`/`validateChangeCompleteness`.
Acceptance: Given two changes each emitting `CHANGE_RED_UNPROVEN` for
different requirements, `gate --json`'s diagnostic entries each carry a
`changeId` and `requirementId` field matching their originating change and
requirement, distinguishable without parsing the `message` string; a
`CHANGE_DESIGN_UNCHANGED` diagnostic carries only `changeId`, with no
`requirementId`/`detail` field. Given `CHANGE-0011` emits three
simultaneous `CHANGE_PHASE_MISSING` diagnostics, each carries a distinct
`detail` field (the missing phase name) alongside the same `changeId`.

## REQ-CHANGE-EVIDENCE-WAIVER-014: Redefine change-history and change-completeness validity as free of error-severity diagnostics
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall compute `validateChangeEvidence`'s `valid` result, `validateChangeCompleteness`'s `valid` result, and each change's `ChangeCompleteness.valid` (combined, unaffected, with its existing `completeRequirements === requirements` condition) as the absence of any `severity: "error"` diagnostic among that result's own diagnostics rather than the absence of any diagnostic regardless of severity.
Acceptance: Given a change whose only `change-history` diagnostic is a
validly waived, non-stale `CHANGE_RED_UNPROVEN` warning, repository-wide
`gate --json` (not only `gate --changed`) reports the `change-history`
check as `pass`; given the same change's per-change completeness slice has
only a validly waived, non-stale `CHANGE_COMPLETENESS_TDD` warning and
`completeRequirements === requirements` still holds, that change's
`ChangeCompleteness.valid` is `true` and the aggregate `change-completeness`
check reports `pass`; recording release approval for that state succeeds
once every other required check independently reports `pass`. A
`ChangeCompleteness` whose warning-only slice nonetheless has
`completeRequirements !== requirements` remains `valid: false`, since the
warning downgrade never substitutes for genuinely absent required
artifacts.

## REQ-CHANGE-EVIDENCE-WAIVER-015: Define the waiver evidence file schema and chain genesis
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall persist `.musubix/evidence/change-waivers.json` as a `{ schemaVersion: 1, waivers: WaiverRecord[] }` document where each `WaiverRecord` carries `changeId`, `code`, `requirementId` (when applicable), `detail` (when applicable per REQ-CHANGE-EVIDENCE-WAIVER-016), `approver`, `reason`, `recordedAt`, `snapshotVersion`, `snapshotHash`, `order` (the matching `order.json` sequence), `previousSha256`, and `payloadSha256`, with the first record's `previousSha256` fixed to sixty-four `"0"` characters and every later record's `previousSha256` equal to the immediately preceding record's `payloadSha256`.
Acceptance: A freshly recorded first waiver has `previousSha256` equal to
`"0".repeat(64)`; a second waiver's `previousSha256` equals the first
waiver's `payloadSha256`; `payloadSha256` for each record is the SHA-256 of
the canonical JSON of that record's fields excluding `payloadSha256`
itself; validating the file detects and reports a broken chain (a record
whose `previousSha256` does not equal its predecessor's `payloadSha256`,
or a first record whose `previousSha256` is not the genesis value) as
malformed per REQ-CHANGE-EVIDENCE-WAIVER-007.
