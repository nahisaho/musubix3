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
that downgrades one specific, currently-present instance of one of these five
diagnostic codes (for one change and, where applicable, one requirement) from
`error` to `warning`, as an appended, hash-chained, audited record — never a
deletion, edit, or blanket disable of the underlying check. It is narrowly
scoped to this well-understood recording-order debt shape; it must not weaken
`change-history`/`change-completeness` for any other diagnostic code, for any
other change or requirement, or for a genuinely fresh violation of the same
code once the waived evidence state changes.

A native `rubber-duck` review of the first draft is expected to probe
duplicate-waiver handling, change-level vs. requirement-level code scoping,
and whether a waiver can silently keep suppressing a diagnostic after new,
unrelated evidence is recorded; this draft is written to close those gaps
up front (REQ-009 through REQ-011), modeled on the equivalent guarantees
already shipped for `tdd-cycle-void`.

## REQ-CHANGE-EVIDENCE-WAIVER-001: Restrict waivable codes to the documented recording-order allow-list
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record <CHANGE-ID> <CODE>` is invoked with a `<CODE>` other than `CHANGE_REQUIREMENTS_UNCHANGED`, `CHANGE_DESIGN_UNCHANGED`, `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, or `CHANGE_COMPLETENESS_TDD`, then the system shall reject the invocation and record no evidence.
Acceptance: Given `<CODE>` is `CHANGE_TEST_CHANGED_AFTER_RED`,
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, `CHANGE_COMPLETENESS_ACCEPTANCE`,
or any string not in the five-code allow-list, `change waiver record` exits
nonzero with an error naming the rejected code and listing the allowed
codes, and `.musubix/evidence/change-waivers.json` and
`.musubix/evidence/order.json` are byte-identical before and after the call.

## REQ-CHANGE-EVIDENCE-WAIVER-002: Require the diagnostic to be currently present before it can be waived
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record <CHANGE-ID> <CODE>` is invoked and re-running `validateChangeEvidence`/`validateChangeCompleteness` does not currently report that exact `<CODE>` for that `<CHANGE-ID>` (and `<REQ-ID>`, when required by REQ-004), then the system shall reject the invocation and record no evidence.
Acceptance: Given a `<CHANGE-ID>`/`<CODE>`/`<REQ-ID>` combination for which
the corresponding validator reports no matching diagnostic at invocation
time, `change waiver record` exits nonzero with an error stating there is
no matching diagnostic to waive, and both evidence files are
byte-identical before and after the call. This rejects pre-emptive,
speculative waivers recorded before the debt actually exists.

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

## REQ-CHANGE-EVIDENCE-WAIVER-004: Bind requirement-scoping to the diagnostic's own granularity
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `<CODE>` is `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, or `CHANGE_COMPLETENESS_TDD` and `--requirement <REQ-ID>` naming one of the change's declared requirement IDs is not supplied, or `<CODE>` is `CHANGE_REQUIREMENTS_UNCHANGED` or `CHANGE_DESIGN_UNCHANGED` and `--requirement` is supplied, then the system shall reject the invocation and record no evidence.
Acceptance: Waiving `CHANGE_RED_UNPROVEN` without `--requirement`, or with a
`--requirement` value not among the change's declared requirement IDs,
exits nonzero and records no evidence. Waiving `CHANGE_REQUIREMENTS_UNCHANGED`
with a `--requirement` value supplied exits nonzero, stating that code is
change-level and does not accept a requirement scope, and records no
evidence.

## REQ-CHANGE-EVIDENCE-WAIVER-005: Record the waiver as a hash-chained, ordered, identity-bound evidence entry
Priority: must
Type: functional
Pattern: event-driven
Statement: When `change waiver record` succeeds, the system shall append exactly one self-chained waiver record per REQ-CHANGE-EVIDENCE-WAIVER-015 to `.musubix/evidence/change-waivers.json`, computing and persisting that code's current `snapshotVersion` and its canonical-JSON SHA-256 as `snapshotHash` so the new record is non-stale under REQ-CHANGE-EVIDENCE-WAIVER-011 immediately after creation, alongside exactly one evidence-order entry stamped with that same `changeId`/`code`/`requirementId`/`phase: "waiver"`, without modifying, reordering, or deleting any existing change, TDD, or waiver evidence.
Acceptance: After a successful `change waiver record`, every previously
recorded change/TDD/waiver evidence entry is byte-identical to before the
call; the new waiver record's `snapshotVersion`/`snapshotHash` equal the
current recomputed values for that `changeId`/`code`/`requirementId` at
the moment of recording, so evaluating REQ-CHANGE-EVIDENCE-WAIVER-011
immediately afterward reports it non-stale; `.musubix/evidence/order.json`
gains exactly one new record whose `phase` is `waiver`, whose
`changeId`/`code`/`requirementId` match the invocation, and whose
`sequence` is one greater than the previous maximum and equals the new
waiver record's own `order` field.

## REQ-CHANGE-EVIDENCE-WAIVER-006: Define valid waiver linkage as unique, identity-bound, self-consistent, and hash-consistent
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall treat a waiver record as validly linked only when its `code` is one of the five REQ-CHANGE-EVIDENCE-WAIVER-001 allow-listed values, its `requirementId` presence matches REQ-CHANGE-EVIDENCE-WAIVER-004's granularity rule for that `code`, its `changeId` names a change present in `.musubix/evidence/changes.json` whose declared `requirementIds` include `requirementId` when present, exactly one `order.json` record exists with `phase: "waiver"` and the same `changeId`/`code`/`requirementId`/`order` as that record, and that record's chain fields are valid per REQ-CHANGE-EVIDENCE-WAIVER-015.
Acceptance: Given a waiver record that is otherwise hash- and
order-consistent but declares a `code` outside the five-value allow-list,
declares a `requirementId` for a change-level code, omits `requirementId`
for a requirement-scoped code, names a `changeId` absent from
`.musubix/evidence/changes.json`, or names a `requirementId` not among
that change's declared `requirementIds`, linkage is invalid under this
definition. Given a waiver record whose `order` field has no matching
`order.json` entry, for which more than one `order.json` record declares
`phase: "waiver"` for that `changeId`/`code`/`requirementId`, or whose
chain fields fail REQ-CHANGE-EVIDENCE-WAIVER-015, linkage is likewise
invalid. Only a record passing every one of these conditions is validly
linked.

## REQ-CHANGE-EVIDENCE-WAIVER-007: Report malformed waiver evidence
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a waiver record does not have valid linkage per REQ-CHANGE-EVIDENCE-WAIVER-006, then the system shall report a `gate`/`status` diagnostic naming that waiver's malformed evidence without downgrading the severity of any diagnostic on the strength of that malformed waiver.
Acceptance: Given a waiver record that fails any condition of
REQ-CHANGE-EVIDENCE-WAIVER-006, `gate --json` reports a diagnostic
identifying the malformed waiver evidence, and the `CHANGE_*`/
`CHANGE_COMPLETENESS_*` diagnostic it targeted still reports `severity:
"error"`, exactly as if no waiver had been recorded for it.

## REQ-CHANGE-EVIDENCE-WAIVER-008: Downgrade a validly waived diagnostic instance to a warning, never suppress it
Priority: must
Type: functional
Pattern: state-driven
Statement: While a waiver record for a `changeId`/`code`/`requirementId` combination is validly linked and non-stale under REQ-CHANGE-EVIDENCE-WAIVER-011, the system shall report the `validateChangeEvidence`/`validateChangeCompleteness` diagnostic carrying that exact structured `changeId`/`code`/`requirementId` target with `severity: "warning"` and an attached `waiver` object containing the `approver` `reason` and `recordedAt` from that waiver record instead of `severity: "error"`.
Acceptance: Given a validly waived, non-stale `CHANGE_RED_UNPROVEN` instance
for `CHANGE-0009`/`REQ-APPROVAL-DOMAIN-SCOPING-001`, `gate --json` reports
that diagnostic with `severity: "warning"` and a `waiver` object whose
`approver`/`reason`/`recordedAt` match the recorded waiver, and the
diagnostic message text is unchanged; the diagnostic is never fully
removed from the report. Matching is performed only against each
diagnostic's structured `changeId`/`requirementId` fields (added by
REQ-CHANGE-EVIDENCE-WAIVER-013), never by parsing message text.

## REQ-CHANGE-EVIDENCE-WAIVER-009: Preserve error severity for every non-waived diagnostic instance of the same code
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report `severity: "error"`, unaffected, for every diagnostic instance of a waivable code that does not itself have a matching, validly linked, non-stale waiver record for that exact `changeId`/`code`/`requirementId` combination.
Acceptance: Given `CHANGE-0009` has a valid waiver for
`CHANGE_RED_UNPROVEN`/`REQ-APPROVAL-DOMAIN-SCOPING-001` only, a
`CHANGE_RED_UNPROVEN` instance for `REQ-APPROVAL-DOMAIN-SCOPING-002` on the
same change, or for `REQ-APPROVAL-DOMAIN-SCOPING-001` on a different
change, still reports `severity: "error"`; waiving one exact scope never
downgrades any other change's, requirement's, or code's diagnostic
instance.

## REQ-CHANGE-EVIDENCE-WAIVER-010: Reject a duplicate waiver for an already validly waived, non-stale scope
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change waiver record` is invoked for a `changeId`/`code`/`requirementId` combination that already has a validly linked, non-stale waiver record, then the system shall reject the invocation and record no additional evidence.
Acceptance: Calling `change waiver record` a second time for the identical
`changeId`/`code`/`requirementId` immediately after a successful waiver,
with no intervening evidence change, exits nonzero with an error stating
the scope is already waived, and both evidence files are byte-identical
before and after the second call.

## REQ-CHANGE-EVIDENCE-WAIVER-011: Define the per-code snapshot payload and invalidate a waiver when it no longer matches, reverting to error
Priority: must
Type: functional
Pattern: state-driven
Statement: While a waiver record's stored `snapshotVersion`/`snapshotHash` for its `code` does not equal the current `snapshotVersion`/recomputed canonical-JSON SHA-256 hash of that code's defined evidence fields for that same `changeId`/`code`/`requirementId`, the system shall treat that waiver as stale and, when the corresponding diagnostic still fires, report it with `severity: "error"` alongside a separate diagnostic naming the stale waiver.
Acceptance: The canonical snapshot payload for each allow-listed code
contains exactly: for `CHANGE_REQUIREMENTS_UNCHANGED`,
`impact.fingerprints.requirements`, `requirements.fingerprints.requirements`,
and `requirements.allowUnchanged`; for `CHANGE_DESIGN_UNCHANGED`,
`requirements.fingerprints.design` and `design.fingerprints.design`; for
`CHANGE_RED_UNPROVEN`/`CHANGE_GREEN_UNPROVEN`/`CHANGE_COMPLETENESS_TDD`,
the targeted requirement's effective batch's `red`/`implementation`/`green`
phase fingerprints and `order` values, the change's `requirements` phase
`order`, and every TDD cycle for that requirement with its `red`/`green`
`valid`/`order` values, each batch/cycle list sorted by `order` ascending.
Given a validly waived `CHANGE_GREEN_UNPROVEN` instance, after a new TDD
cycle or a new `change-record green` phase changes any field of this
payload for that change/requirement, `gate --json` reports the
`CHANGE_GREEN_UNPROVEN` instance with `severity: "error"` (not
`"warning"`) plus a separate diagnostic identifying that requirement's
waiver as stale. Given the same change afterward, the underlying condition
no longer holds and `validateChangeEvidence`/`validateChangeCompleteness`
no longer emits that `changeId`/`code`/`requirementId` diagnostic, `gate
--json` reports only the stale-waiver diagnostic and does not fabricate
the now-resolved `CHANGE_*`/`CHANGE_COMPLETENESS_*` diagnostic. A future,
incompatible change to a code's snapshot payload definition increments
`snapshotVersion`, making every waiver recorded under a prior version
stale regardless of field equality.

## REQ-CHANGE-EVIDENCE-WAIVER-012: Surface active waivers in `status`/`gate --json` for audit visibility
Priority: should
Type: functional
Pattern: event-driven
Statement: When `gate --json` or `status --json` runs and one or more validly linked non-stale waiver records exist, the system shall include a `waivers` array listing each waiver's `changeId`, `code`, `requirementId` (when present), `approver`, `reason`, and `recordedAt`.
Acceptance: `gate --json` output contains a `waivers` array with one entry
per validly linked, non-stale waiver record, each carrying exactly the
`changeId`/`code`/`requirementId`/`approver`/`reason`/`recordedAt` values
persisted by REQ-CHANGE-EVIDENCE-WAIVER-005; a stale or malformed waiver
(per REQ-CHANGE-EVIDENCE-WAIVER-007/011) is excluded from this array.

## REQ-CHANGE-EVIDENCE-WAIVER-013: Attach structured `changeId`/`requirementId` targets to waivable diagnostics
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall attach a structured `changeId` field, and a `requirementId` field when the diagnostic is requirement-scoped per REQ-CHANGE-EVIDENCE-WAIVER-004, to every `CHANGE_REQUIREMENTS_UNCHANGED`, `CHANGE_DESIGN_UNCHANGED`, `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` diagnostic emitted by `validateChangeEvidence`/`validateChangeCompleteness`.
Acceptance: Given two changes each emitting `CHANGE_RED_UNPROVEN` for
different requirements, `gate --json`'s diagnostic entries each carry a
`changeId` and `requirementId` field matching their originating change and
requirement, distinguishable without parsing the `message` string; a
`CHANGE_DESIGN_UNCHANGED` diagnostic carries only `changeId`, with no
`requirementId` field.

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
Statement: The system shall persist `.musubix/evidence/change-waivers.json` as a `{ schemaVersion: 1, waivers: WaiverRecord[] }` document where each `WaiverRecord` carries `changeId`, `code`, `requirementId` (when applicable), `approver`, `reason`, `recordedAt`, `snapshotVersion`, `snapshotHash`, `order` (the matching `order.json` sequence), `previousSha256`, and `payloadSha256`, with the first record's `previousSha256` fixed to sixty-four `"0"` characters and every later record's `previousSha256` equal to the immediately preceding record's `payloadSha256`.
Acceptance: A freshly recorded first waiver has `previousSha256` equal to
`"0".repeat(64)`; a second waiver's `previousSha256` equals the first
waiver's `payloadSha256`; `payloadSha256` for each record is the SHA-256 of
the canonical JSON of that record's fields excluding `payloadSha256`
itself; validating the file detects and reports a broken chain (a record
whose `previousSha256` does not equal its predecessor's `payloadSha256`,
or a first record whose `previousSha256` is not the genesis value) as
malformed per REQ-CHANGE-EVIDENCE-WAIVER-007.

