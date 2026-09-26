---
schemaVersion: 1
feature: workflow-evidence-waiver
---
# Workflow evidence waiver (audited, bounded relief for reconciliation debt)

Source: GitHub Issue #1 (recurrence comment, item 3/4), and the separate
`gate --changed` resolution session that shipped `change-evidence-waiver`
(CHANGE-0011/CHANGE-0012) but deliberately left the `workflow` check's
zero-tolerance status computation untouched pending its own requirements
review.

CHANGE-0048 extends this feature for resumed Copilot sessions: successful
verification persists a durable reconciliation ledger, snapshot version 2
uses a declaration-scope-local evidence head, and existing authoritative
snapshot-version-1 waivers remain effective only through the bounded migration
compatibility window defined by REQ-WORKFLOW-EVIDENCE-WAIVER-012.

`workflow-verify` reconciles self-reported `workflow-record <skill> <phase>
--status completed` declarations in `.musubix/evidence/workflow.json`
against real Copilot Skill invocations parsed from session transcript logs.
Declarations recorded in a session whose transcript log is no longer
available (rotated, from an earlier session not passed to `workflow-verify`,
or predating this reconciliation feature entirely), or recorded slightly out
of step with the exact invocation the tool can bind 1:1, cause
`validateWorkflow` to report `WORKFLOW_SKILL_NOT_INVOKED`,
`WORKFLOW_INVOCATION_ORDER`, `WORKFLOW_INVOCATION_INCOMPLETE`,
`WORKFLOW_INVOCATION_FAILED`, `WORKFLOW_INVOCATION_REUSED` (declaration-scoped
flavor), and the always-paired `WORKFLOW_BINDING_MISSING`, in every case
where reconciliation evidence is missing or imperfectly ordered for a
declaration — which may reflect an already-real skill invocation whose
evidence trail is merely incomplete, or, less commonly, a declaration for
which no invocation actually occurred; `validateWorkflow` cannot itself
distinguish the two, so this change relies on the required human
`--approver`/`--reason` review at waiver time, not on the diagnostic's
mere presence, to establish that a specific instance is safe to downgrade.
Before this feature, `packages/analysis/src/gate.ts` computed the `workflow`
check's `status` from `workflow.verified` (`true` only when `diagnostics`
was empty, with no severity concept). The `change-history` and
`change-completeness` validators instead define `valid` as the absence of
`error`-severity diagnostics; feature-scoped gate branches compute status
from error counts in scoped diagnostics. These are the relevant precedents
for allowing a validly waived warning to remain visible while reporting
`pass`; `validateTddEvidence` retains its independent severity-blind `valid`
contract.
`packages/analysis/src/approval-record.ts` then hard-blocks `release`
approval when any required check does not report `pass`, so a single unresolved
reconciliation-debt diagnostic in `workflow` permanently blocks release
approval even once every other check is clean.

This change adds an explicit, human-approved `workflow waiver record`
command that downgrades one specific, currently-present declaration-scoped
diagnostic instance (identified by `skill`, `phase`, and the declaration's
own `recordedAt` timestamp) from `error` to `warning`, as an appended,
hash-chained, audited record in a new
`.musubix/evidence/workflow-waivers.json` file — never a deletion, edit, or
blanket disable of `workflow-verify` or of any other declaration's
diagnostics. It then redefines the `workflow` check's `gate`/`status`
computation to the same error-severity-based validity semantics already
used by `change-history`/`change-completeness` and feature-scoped gate
branches, so a fully waived,
non-stale set of diagnostics reports `pass`, which — because
`approval-record.ts` already blocks purely on `status !== 'pass'` — resolves
the release hard-block without any change to `approval-record.ts` itself.
It must not weaken `workflow-verify` for any non-waived declaration, for any
other `skill`/`phase`/`recordedAt` scope, or for a genuinely fresh
reconciliation failure once the waived evidence state changes; it must never
allow a repository that has never attempted reconciliation at all
(`WORKFLOW_INVOCATION_UNVERIFIED`) to reach `pass` merely by waiving; and,
mirroring the existing `change-evidence-waiver` precedent only for
always-reported top-level `waiverDiagnostics` visibility, malformed or stale
workflow-waiver evidence must remain permanently visible in that separate
audit array. It is deliberately never folded into `workflow.diagnostics` and
therefore never blocks the `workflow` check's own status, intentionally
diverging from current change-waiver auditing, whose error-severity
malformed/stale diagnostics participate in change-check validity.


A native `rubber-duck` review of the first draft found three must-fix gaps
(a schema field-naming collision between the declaration's own `recordedAt`
and the waiver record's own `recordedAt`; malformed/stale waiver diagnostics
that were reported but never wired into the `workflow` check's own
diagnostics/status, silently defeating REQ-008/012's intent; and an
undefined canonical-JSON serialization for the hash chain) plus several
should-fix gaps (an inaccurate claim that the precedent validators call
`countErrors(...)` directly, unspecified behavior for an absent or corrupted
`workflow-waivers.json` file, and unspecified timestamp format/ordering
rules). A later review round found that an intermediate draft had wired
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED`/`WORKFLOW_WAIVER_STALE` directly into
`workflow.diagnostics`, which would have let malformed/stale waiver
evidence itself block the `workflow` check's `status` — contradicting the
chosen workflow-waiver non-blocking model: workflow-check validity is defined
only by the reconciled invocation diagnostics in `workflow.diagnostics`,
while waiver-file integrity remains a separate audit concern. The current change-waiver model
instead includes its analogous diagnostics in change-check validity and is
not the precedent for this decision. This draft corrects that regression: REQ-005
renames the two `recordedAt` fields, REQ-008/REQ-012/REQ-015 keep the
named malformed/stale diagnostics in the always-reported
`waiverDiagnostics` array only — never in `workflow.diagnostics` and never
affecting the `workflow` check's `status` — REQ-013 defines
canonicalization by reusing the project's existing sorted-key recursive
JSON serializer, REQ-006 specifies file-genesis and corrupted-file
rejection, REQ-013 specifies canonical timestamp format while REQ-002
requires `Date.parse` validity and byte-for-byte declaration-time equality,
REQ-007/REQ-013 define deterministic sequence ordering, and REQ-011 consumes
that ordering for replacement eligibility.

## REQ-WORKFLOW-EVIDENCE-WAIVER-001: Restrict waivable codes to the documented declaration-scoped allow-list
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `workflow waiver record` is invoked with a `<CODE>` other than `WORKFLOW_SKILL_NOT_INVOKED`, `WORKFLOW_INVOCATION_ORDER`, `WORKFLOW_INVOCATION_INCOMPLETE`, `WORKFLOW_INVOCATION_FAILED`, or the declaration-scoped flavor of `WORKFLOW_INVOCATION_REUSED`, then the system shall reject the invocation and record no evidence.
Acceptance: Given `<CODE>` is `WORKFLOW_BINDING_MISSING`,
`WORKFLOW_INVOCATION_UNVERIFIED`, `WORKFLOW_VERIFICATION_STALE`,
`WORKFLOW_TRANSCRIPT_INCOMPLETE`, `WORKFLOW_TRANSCRIPT_SIZE`,
`WORKFLOW_TRANSCRIPT_FUTURE`, `WORKFLOW_TRANSCRIPT_EXPIRED`,
`WORKFLOW_SESSION_MISMATCH`, the tool-call-scoped flavor of
`WORKFLOW_INVOCATION_REUSED` (identified by `toolCallId`, not by
`skill`/`phase`/`recordedAt`), or any other string, `workflow waiver record`
exits nonzero with an error naming the rejected code and listing the five
allowed codes, and `.musubix/evidence/workflow-waivers.json` is
byte-identical (or absent, if it did not yet exist) before and after the
call. `WORKFLOW_BINDING_MISSING` is deliberately excluded from direct
waiving because, per `validateWorkflow`, it is raised if and only if one of
the five allow-listed reason codes is also raised for the identical
declaration event, so REQ-WORKFLOW-EVIDENCE-WAIVER-009 can always downgrade
it automatically as a fixed consequence of its paired reason code, with no
case in which it appears alone.

## REQ-WORKFLOW-EVIDENCE-WAIVER-002: Require the diagnostic to be currently present before it can be waived
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `workflow waiver record <code> --skill <skill> --phase <phase> --recorded-at <timestamp>` is invoked and re-running `validateWorkflow` does not currently report that exact `<code>` for a declaration event whose own `recordedAt` equals `<timestamp>` exactly (as a byte-for-byte string match, not a parsed/re-normalized comparison) and whose `skill`/`phase` equal the supplied options, then the system shall reject the invocation and record no evidence.
Acceptance: Given a `skill`/`phase`/`recordedAt`/`code` combination for
which `validateWorkflow` reports no matching diagnostic at invocation
time (including when no declaration event with that exact
`skill`/`phase`/`recordedAt` string exists at all, or exists only with a
differently formatted but equivalent timestamp string), `workflow waiver
record` exits nonzero with an error stating there is no matching
diagnostic to waive, and `.musubix/evidence/workflow-waivers.json` is
unchanged. `<timestamp>` must be a valid ISO-8601 string parseable by
`Date.parse`; an unparseable `--recorded-at` value exits nonzero with an
error naming the malformed timestamp before any diagnostic lookup is
attempted. Because every declaration event's own `recordedAt` is always
written by `recordWorkflow` as a canonical `Date.prototype.toISOString()`
value (never user-supplied), and REQ-002 requires byte-for-byte string
equality rather than parsed/normalized comparison, a `--recorded-at` value
that is `Date.parse`-valid but not in that exact canonical form can never
byte-match a real declaration and therefore always falls into the
"no matching diagnostic" rejection above; no separate format requirement
beyond the byte-equality check is needed to reject it. This rejects
pre-emptive, speculative waivers recorded before the debt actually
exists. The reconciliation failures named by
REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004 take precedence over this
diagnostic lookup: while one is raised, recording rejects with the
reconciliation repair reason rather than the otherwise-applicable
"no matching diagnostic to waive" reason.

## REQ-WORKFLOW-EVIDENCE-WAIVER-003: Require an explicit human approver, reason, and confirmation
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `workflow waiver record` is invoked without a non-empty `--approver` name, a non-empty `--reason` string, or the `--confirm` flag, then the system shall reject the invocation and record no evidence.
Acceptance: Omitting `--approver`, omitting `--reason`, omitting
`--confirm`, or supplying an empty/whitespace-only `--approver` or
`--reason` each exit nonzero with an error naming the missing/invalid
option, and `.musubix/evidence/workflow-waivers.json` is unchanged in every
case.

## REQ-WORKFLOW-EVIDENCE-WAIVER-004: Require prior reconciliation before any waiver is possible
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `workflow waiver record` is invoked while `validateWorkflow` currently reports `WORKFLOW_INVOCATION_UNVERIFIED` (the current `.musubix/evidence/workflow.json` has no `verification` object for its present declaration set — either because `workflow-verify` has never run, or because `recordWorkflow` cleared the prior verification when a later declaration was recorded and no `workflow-verify` has run since), then the system shall reject the invocation and record no evidence, regardless of `<code>`.
Acceptance: Given `.musubix/evidence/workflow.json` has at least one
declaration event and no `verification`
key — whether because reconciliation was never attempted, or because it
was previously successful but a subsequent `workflow-record` call cleared
it per `recordWorkflow`'s existing behavior — every `workflow waiver
record` call exits nonzero with an error stating that `workflow-verify`
must be (re-)run before any declaration-scoped diagnostic can be waived,
and `.musubix/evidence/workflow-waivers.json` is unchanged. This prevents
reaching `pass` by skipping reconciliation entirely rather than by waiving
a specific, reviewed, already-reconciled mismatch. Given
`.musubix/evidence/workflow.json` has zero declaration events (or does
not exist), `validateWorkflow` reports `present: false` with no
diagnostics at all (never `WORKFLOW_INVOCATION_UNVERIFIED`, per
`validateWorkflow`'s own early-return behavior), so this requirement does
not itself apply; every `workflow waiver record` call is instead rejected
by REQ-WORKFLOW-EVIDENCE-WAIVER-002, since no diagnostic of any allow-listed
code can be currently present for a scope with no declaration events. The
other reconciliation failures named by
REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004 use the same fail-closed
recording precedence: recording rejects with the reconciliation repair reason
before any "no matching diagnostic to waive" lookup result.

## REQ-WORKFLOW-EVIDENCE-WAIVER-005: Identify each waivable diagnostic instance by skill, phase, and declaration timestamp, disambiguating exact collisions
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall scope every REQ-WORKFLOW-EVIDENCE-WAIVER-001 allow-listed diagnostic instance to the triplet `skill`/`phase`/`declarationRecordedAt` (the exact `recordedAt` string of the one `status: "completed"` declaration event it was raised for — the only kind of declaration event `validateWorkflow` raises these diagnostics for), and, when more than one `status: "completed"` declaration event shares the identical `skill`/`phase`/`declarationRecordedAt` triplet, additionally require and accept a `--index` option naming that event's zero-based position among `workflow.json`'s `events` array to disambiguate it.
Acceptance: Given two `status: "completed"` declaration events with
identical `skill`, `phase`, and `recordedAt` (a timestamp collision),
`workflow waiver record` without
`--index` exits nonzero with an error stating the scope is ambiguous and
listing the candidate indices; supplying the correct `--index` waives only
that one event's diagnostic instance, leaving the other's `severity:
"error"` unaffected. Given no collision, `--index` must not be supplied;
if it is, the invocation is rejected and no evidence is recorded, so a
persisted record's `index` key is present if and only if this requirement required
one for disambiguation, never merely because an index happened to be
supplied. The field name `declarationRecordedAt` (never bare `recordedAt`)
is used everywhere this scope triplet is persisted or reported, to avoid
collision with the waiver record's own `waiverRecordedAt` defined in
REQ-WORKFLOW-EVIDENCE-WAIVER-013.

## REQ-WORKFLOW-EVIDENCE-WAIVER-006: Record the waiver as a hash-chained, ordered, identity-bound evidence entry, creating or validating the evidence file as needed
Priority: must
Type: functional
Pattern: event-driven
Statement: When `workflow waiver record` succeeds, the system shall append exactly one self-chained waiver record per REQ-WORKFLOW-EVIDENCE-WAIVER-013 to `.musubix/evidence/workflow-waivers.json` (creating it as a fresh `{ schemaVersion: 1, waivers: [] }` document first if it does not yet exist), computing and persisting that instance's current `snapshotVersion` and canonical-JSON SHA-256 `snapshotHash` so the new record is non-stale under REQ-WORKFLOW-EVIDENCE-WAIVER-012 immediately after creation, without modifying, reordering, or deleting any existing waiver record or any `.musubix/evidence/workflow.json` content.
Acceptance: After a successful `workflow waiver record`,
`.musubix/evidence/workflow.json` is byte-identical to before the call;
every previously recorded waiver record is byte-identical to before the
call; the new record's `snapshotVersion`/`snapshotHash` equal the current
recomputed values for that `skill`/`phase`/`declarationRecordedAt`/`index`/
`code` at the moment of recording, so evaluating
REQ-WORKFLOW-EVIDENCE-WAIVER-012 immediately afterward reports it
non-stale. Given `.musubix/evidence/workflow-waivers.json` does not exist,
a successful call creates it containing exactly one record whose
`previousSha256` is the genesis value. Given the file exists but is
invalid JSON, has the wrong top-level shape, or has a broken
`previousSha256`/`payloadSha256` chain, the call exits nonzero with an
error identifying the corruption and leaves the file byte-identical.

## REQ-WORKFLOW-EVIDENCE-WAIVER-007: Define valid waiver linkage as identity-bound, self-consistent, and hash-consistent, independent of any other record's staleness
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall treat a waiver record as validly linked only when its `code` is one of the five REQ-WORKFLOW-EVIDENCE-WAIVER-001 allow-listed values, its chain fields are valid per REQ-WORKFLOW-EVIDENCE-WAIVER-013, and its `skill`/`phase`/`declarationRecordedAt`/`index` resolve to exactly one `status: "completed"` declaration event in `.musubix/evidence/workflow.json` as follows: when `index` is absent, exactly one `status: "completed"` event matches the `skill`/`phase`/`declarationRecordedAt` triplet and that event is the resolved event; when `index` is present, two or more `status: "completed"` events match that identical triplet, `index` is a nonnegative integer equal to one of those events' own zero-based positions in `workflow.json`'s `events` array, and the event at that position is the resolved event; any other combination (zero matching events regardless of `index`, one matching event with `index` present, or two-or-more matching events with `index` absent or naming a non-matching position) has no resolved event and is invalidly linked. Because `.musubix/evidence/workflow.json`'s `events` array is append-only (`recordWorkflow` only ever pushes a new event; no code path mutates an existing event's fields), a previously resolved event's `status` never changes except through a direct, out-of-band edit of `workflow.json`, which this requirement treats identically to any other loss of the resolved event: as invalid linkage, reported per REQ-WORKFLOW-EVIDENCE-WAIVER-008, never as staleness under REQ-WORKFLOW-EVIDENCE-WAIVER-012 (which governs only a change in the *reconciled outcome* for a still-resolvable event, not the disappearance of the event itself). This structural validity depends only on the record's own fields and `.musubix/evidence/workflow.json`, never on whether any other waiver record for the identical scope is stale, superseded, or itself validly linked.
Acceptance: Given a waiver record that is otherwise hash-consistent but
declares a `code` outside the five-value allow-list, whose chain fields
fail REQ-WORKFLOW-EVIDENCE-WAIVER-013, or whose `skill`/`phase`/
`declarationRecordedAt`/`index` fail to resolve to exactly one
`status: "completed"` event per this requirement's Statement — including
zero matching events, exactly one matching event with `index` present,
two-or-more matching events with `index` absent, or an `index` that is
not the zero-based array position of one of the two-or-more matching
events — linkage is invalid under this definition, regardless of whether
any other record sharing its scope is itself valid, stale, or the
current authoritative record. More than one
validly linked waiver record may share the same
`skill`/`phase`/`declarationRecordedAt`/`index` scope, including when an
earlier state later recurs after REQ-WORKFLOW-EVIDENCE-WAIVER-011 already
permitted a replacement; among all validly linked records sharing one
scope, the **authoritative record** for that scope is always exactly the
one with the greatest `sequence` (per REQ-WORKFLOW-EVIDENCE-WAIVER-013),
and REQ-WORKFLOW-EVIDENCE-WAIVER-009/REQ-WORKFLOW-EVIDENCE-WAIVER-011/
REQ-WORKFLOW-EVIDENCE-WAIVER-012 evaluate staleness and downgrade
diagnostics only against that one record; every other validly linked
record sharing the scope is a superseded historical entry, never itself
independently re-evaluated as stale or active, and never causes any other
record (including the authoritative one) to be treated as invalidly
linked.

## REQ-WORKFLOW-EVIDENCE-WAIVER-008: Report malformed waiver evidence as an always-visible audit diagnostic, never as a check-blocking one
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `.musubix/evidence/workflow-waivers.json` as a whole is not valid JSON or does not match its schema, or an individual waiver record within it does not have valid linkage per REQ-WORKFLOW-EVIDENCE-WAIVER-007, then the system shall add a `WORKFLOW_WAIVER_EVIDENCE_MALFORMED` `error`-severity diagnostic naming the malformed document or waiver record to the existing `waiverDiagnostics` array already returned by `gate --json`/`status --json` (the same array that reports `CHANGE_WAIVER_EVIDENCE_MALFORMED`/`CHANGE_WAIVER_STALE`), without adding it to `workflow.diagnostics` and without downgrading the severity of any diagnostic on the strength of that malformed waiver.
Acceptance: Given `.musubix/evidence/workflow-waivers.json` is malformed
JSON or has the wrong top-level shape, `gate --json`'s `waiverDiagnostics`
array includes exactly one `WORKFLOW_WAIVER_EVIDENCE_MALFORMED` diagnostic
naming the file, with no per-record `skill`/`phase`/`declarationRecordedAt`/
`index` fields and no waiver-reason code named in the message (none are
recoverable from an unparseable document); the diagnostic's own `code` is
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED`. Given the document parses (`waivers` is an array) but one
specific element within it fails REQ-WORKFLOW-EVIDENCE-WAIVER-007 or is
not even shaped like an object (for example `null` or a scalar),
`waiverDiagnostics` includes one `WORKFLOW_WAIVER_EVIDENCE_MALFORMED`
diagnostic identifying that element by its zero-based position in the
`waivers` array, plus its `skill`/`phase`/`declarationRecordedAt`/`index`
fields only when each is itself present and independently well-typed per
REQ-WORKFLOW-EVIDENCE-WAIVER-013; when the element's waiver-reason `code`
is itself a well-typed string, the diagnostic names it in the message but
does not replace the diagnostic's own `code:
"WORKFLOW_WAIVER_EVIDENCE_MALFORMED"` field; and
the `WORKFLOW_*` diagnostic it targeted still reports `severity: "error"`
in `workflow.diagnostics`, exactly as if no waiver had been recorded for
it. Because `waiverDiagnostics` is a separate top-level `gate --json`
field never consulted by `aggregateStatus`/REQ-WORKFLOW-EVIDENCE-WAIVER-015,
a `WORKFLOW_WAIVER_EVIDENCE_MALFORMED` diagnostic never by itself changes
the `workflow` check's `status`; it exists purely so a human reviewing
`gate --json`/`status --json` output can see and repair the malformed
audit trail, consistent with how `CHANGE_WAIVER_EVIDENCE_MALFORMED`
is also exposed for `change-evidence-waiver` (while its effect on change-check
validity is intentionally different). `status --json` computes
`waiverDiagnostics` via the identical computation used by `gate --json`
(both are built by `packages/analysis/src/gate.ts`'s shared workflow-waiver
resolution logic; change-waiver audit diagnostics come from
`waiverEvidenceDiagnostics(root)` in both surfaces per
REQ-CHANGE-EVIDENCE-WAIVER-011), so every
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED` case
above applies identically to `status --json`'s `waiverDiagnostics` array,
not only to `gate --json`'s.
The combined top-level `waiverDiagnostics` array concatenates the
change-waiver subset first and the workflow-waiver subset second, preserving
each subset's requirement-defined order.

## REQ-WORKFLOW-EVIDENCE-WAIVER-009: Downgrade a diagnostic covered by an effective authoritative waiver, and its paired binding-missing diagnostic, to a warning, never suppress
Priority: must
Type: functional
Pattern: state-driven
Statement: While workflow-waiver evaluation is active and an effective authoritative waiver under REQ-WORKFLOW-EVIDENCE-WAIVER-012 covers a `skill`/`phase`/`declarationRecordedAt`/`index` scope, the system shall report both the waived diagnostic and the `WORKFLOW_BINDING_MISSING` diagnostic raised for that same declaration event with `severity: "warning"` and an attached `waiver` object containing exactly `approver`, `reason`, `recordedAt`, and `waiverRecordedAt`, where both timestamp fields equal the authoritative waiver record's `waiverRecordedAt`, instead of `severity: "error"`.
Acceptance: Given an effective authoritative waiver covering a
`WORKFLOW_SKILL_NOT_INVOKED`
instance for `sdd-requirements:complete` recorded at a given
`declarationRecordedAt`, `gate --json` reports both that diagnostic and
its paired `WORKFLOW_BINDING_MISSING` diagnostic for the identical
`skill`/`phase`/`declarationRecordedAt`/`index` with `severity: "warning"`
and a `waiver` object whose `approver`/`reason` match the recorded waiver and
whose `recordedAt`/`waiverRecordedAt` both equal the recorded waiver's
`waiverRecordedAt`; neither diagnostic is ever fully removed from the
report; message text is unchanged. Waiving one declaration event's
diagnostic never downgrades any other event's diagnostics, even for the
identical `skill`/`phase` pair at a different `declarationRecordedAt`/
`index`.

## REQ-WORKFLOW-EVIDENCE-WAIVER-010: Preserve error severity for every non-waived diagnostic instance
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report `severity: "error"`, unaffected, for every declaration-scoped diagnostic instance whose scope has no effective authoritative waiver under REQ-WORKFLOW-EVIDENCE-WAIVER-012.
Acceptance: Given exactly one declaration event has a valid waiver, every
other unmatched declaration event's `WORKFLOW_SKILL_NOT_INVOKED`/
`WORKFLOW_INVOCATION_ORDER`/`WORKFLOW_INVOCATION_INCOMPLETE`/
`WORKFLOW_INVOCATION_FAILED`/`WORKFLOW_INVOCATION_REUSED`/
`WORKFLOW_BINDING_MISSING` diagnostic still reports `severity: "error"`;
the tool-call-scoped flavor of `WORKFLOW_INVOCATION_REUSED` (never
waivable per REQ-001) always reports `severity: "error"`.

## REQ-WORKFLOW-EVIDENCE-WAIVER-011: Reject a duplicate waiver for a scope with an effective authoritative waiver
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `workflow waiver record` is invoked for a `skill`/`phase`/`declarationRecordedAt`/`index` scope whose authoritative record is effective under REQ-WORKFLOW-EVIDENCE-WAIVER-012, then the system shall reject the invocation and record no additional evidence.
Acceptance: Calling `workflow waiver record` a second time for the
identical scope immediately after a successful waiver, with no
intervening evidence change, exits nonzero with an error stating the scope
is already waived, and `.musubix/evidence/workflow-waivers.json` is
byte-identical before and after the second call. When
REQ-WORKFLOW-EVIDENCE-WAIVER-012 later makes the authoritative record
stale, a subsequent call for the identical scope is accepted and appends
a new record with a strictly greater `sequence`, which immediately
becomes the new authoritative record per REQ-WORKFLOW-EVIDENCE-WAIVER-007;
the superseded, now-non-authoritative predecessor remains in the file,
structurally valid, and is never re-evaluated for staleness or
duplicate-rejection purposes again, even if reconciliation evidence later
happens to make its own snapshot match again. Which record is the
authoritative one for a scope is always determined by comparing
`sequence` integers, never by comparing `waiverRecordedAt` timestamp
strings.
An authoritative snapshot-version-1 record that is effective only through
REQ-WORKFLOW-EVIDENCE-WAIVER-012's migration compatibility window is also
rejected as already waived; only the automatic migration in
REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-005 may append its version-2
successor without new approval.

## REQ-WORKFLOW-EVIDENCE-WAIVER-012: Define the snapshot payload and invalidate a waiver when the reconciled outcome changes, reverting to error while the scoped diagnostic remains raised
Priority: must
Type: functional
Pattern: state-driven
Statement: While workflow-waiver evaluation is active, the system shall evaluate authoritative records using the snapshot payload, effective-waiver predicate, staleness severity, and message rules defined in this requirement's Acceptance criteria.
Acceptance: Workflow-waiver evaluation is active exactly when none of
`WORKFLOW_INVOCATION_UNVERIFIED`, `WORKFLOW_RECONCILIATION_MALFORMED`,
`WORKFLOW_RECONCILIATION_LIMIT`, or
`WORKFLOW_RECONCILIATION_CONFIG_MISMATCH` activates the suppression required
by REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004. The current snapshot version
is `2` when the workflow has a valid `reconciliation` own property and `1`
when that property is absent. An **effective authoritative
waiver** is the scope's authoritative record per
REQ-WORKFLOW-EVIDENCE-WAIVER-007 that is validly linked and either has the
current snapshot version with a matching recomputed snapshot hash or is a
migration-compatible authoritative version-1 record as defined below. Any
other validly linked authoritative record is **stale**. While evaluation is
active, `gate --json` reports one scope-naming `WORKFLOW_WAIVER_STALE` in
`waiverDiagnostics` for every stale authoritative record regardless of whether
an allow-listed declaration-scoped reason remains raised. While one remains
raised, the stale diagnostic is `error` severity and `gate --json` also reports
the reason plus its paired `WORKFLOW_BINDING_MISSING` with `severity: "error"`
and no `waiver` object. When none remains raised, the stale diagnostic is
`warning` severity, its message contains the exact substring `condition is
resolved; a replacement waiver is not required`, and the workflow check
remains passing when every other scope is likewise clean. The canonical
snapshot payload is exactly: the declaration
event's own `skill`/`phase`/`status`/`recordedAt`/`version`, the
declaration event's own `commandSha256` when present or the explicit
`null` sentinel when the event carries no `commandSha256` (since
`commandSha256` is itself optional on a `WorkflowEvent`, and
`canonicalJson` omits `undefined` object values entirely per
REQ-WORKFLOW-EVIDENCE-WAIVER-013, an omitted-vs-`null` ambiguity here
would otherwise let two implementations disagree on `snapshotHash`), the
waiver's own `index` (or the explicit `null`
sentinel, when REQ-WORKFLOW-EVIDENCE-WAIVER-005 did not require one),
`workflowScopeEvidenceHead(workflow, eventIndex)` (the exported function from
`packages/analysis/src/workflow-waiver.ts` that hashes the freshly recomputed
declaration binding or `null`, persisted `reconciliation.skewMs`, and the
same-skill canonical durable-ledger invocation semantic fields excluding
provenance `sources`, whose
`invokedAt <= recordedAt + reconciliation.skewMs`, deliberately including
later-completing invocations as the conservative superset defined by
REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-003), and the current allow-listed declaration-scoped reason code
(one of the five REQ-WORKFLOW-EVIDENCE-WAIVER-001 values; never
`WORKFLOW_BINDING_MISSING`, which is always a fixed, redundant consequence
of exactly one such reason code per REQ-001's acceptance and therefore
carries no independent snapshot information) that `validateWorkflow`
currently raises for that scope, or an explicit `null` sentinel when no
allow-listed reason diagnostic is currently raised for it. The exact canonical
object hashed by `workflowScopeEvidenceHead` has exactly the keys `binding`,
`skewMs`, and `invocations`; `binding` is the freshly recomputed binding
object or `null`, `skewMs` is the persisted integer, and each `invocations`
entry has exactly `skill`, `toolCallId`, `invokedAt`, optional `completedAt`,
and `status`, with no provenance `sources` key. Given a validly
waived `WORKFLOW_SKILL_NOT_INVOKED` instance, a later
`workflow-verify` run whose new transcript hash, session metadata, or
unrelated invocations do not change that declaration's eligible invocation
set, binding, declaration fields, or current reason code preserves the
snapshot hash and the waiver remains active. If a later verification changes
an invocation eligible for that declaration or changes its binding, the
scope-local evidence head changes and the waiver becomes stale. Given a later `workflow-verify` run against additional session
logs changes the raised code for that exact scope to
`WORKFLOW_INVOCATION_ORDER` (a different reason for the same
declaration), or resolves it to no diagnostic at all, `gate --json`
reports the newly current outcome (a `severity: "error"`
`WORKFLOW_INVOCATION_ORDER`, or no `WORKFLOW_*` diagnostic for that scope,
respectively) plus a `WORKFLOW_WAIVER_STALE` entry in `waiverDiagnostics`
identifying that scope's waiver as stale; it never continues reporting
the original, now-superseded code as downgraded. Because
`WORKFLOW_WAIVER_STALE` lives only in `waiverDiagnostics`, never in
`workflow.diagnostics`, it never by itself changes the `workflow` check's
`status` under REQ-WORKFLOW-EVIDENCE-WAIVER-015: when reconciliation
resolves the scope to no diagnostic at all, the `workflow` check reports
`pass` (assuming every other scope is likewise clean) even while the
`WORKFLOW_WAIVER_STALE` audit entry for the now-stale record remains
visible in `waiverDiagnostics` indefinitely, purely as a historical audit
trail — no acknowledgement action is required or defined, and a human may
optionally record a new waiver for that scope (per
REQ-WORKFLOW-EVIDENCE-WAIVER-002) only if a diagnostic is still currently
raised for it. This workflow-waiver treatment intentionally differs from change-waiver
auditing: change-waiver malformed/stale blocking, severity, and validator
behavior are owned by REQ-CHANGE-EVIDENCE-WAIVER-007/011/014.
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED` and historical
`WORKFLOW_WAIVER_STALE` records remain visible in top-level
`waiverDiagnostics` without affecting the `workflow` check's gate status
under REQ-WORKFLOW-EVIDENCE-WAIVER-008/012/015; recording-time rejection of
malformed workflow-waiver evidence under REQ-WORKFLOW-EVIDENCE-WAIVER-017
remains required.
Given a scope whose superseded lower-sequence record has a snapshot mismatch
while its authoritative record matches the current snapshot, `gate --json`
reports no `WORKFLOW_WAIVER_STALE` for that scope and reports its scoped
diagnostics as `warning` with a `waiver` object. Given the inverse state, where
the superseded record matches and the authoritative record has a snapshot
mismatch, `gate --json` reports exactly one `WORKFLOW_WAIVER_STALE` entry for
the scope; its presence is determined only by the authoritative record's
snapshot state. Each `WORKFLOW_WAIVER_STALE`
diagnostic carries the standard diagnostic `code`/`severity`/`message`/`path`
fields plus the authoritative record's `skill`/`phase`/
`declarationRecordedAt` and its `index` only when defined; it carries no
waiver-reason `code`, `sequence`, `snapshotVersion`, `snapshotHash`,
`previousHash`, record `hash`, approval metadata, reason, or attached `waiver`
object, and its `path` is exactly
`.musubix/evidence/workflow-waivers.json`. Within the workflow-waiver subset of top-level `waiverDiagnostics`,
entries follow ascending persisted `waivers` array position: a malformed
record's diagnostic occupies its own position, while, when a scope's
authoritative record is stale, its single `WORKFLOW_WAIVER_STALE` entry
occupies the array position of that scope's lowest-position validly linked
record and uses the authoritative record's reported fields defined above.
This scope-local payload is snapshot version `2`. The first successful durable
verification migrates authoritative version-1 records to version-2 successors
under REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-005; superseded version-1
records are not independently reported stale. Before a version-2 successor is successfully persisted, an authoritative
version-1 record is **migration-compatible** on read when reconciliation is
present and unsuppressed, the record is individually shape-valid and
declaration-linked, the sequence/previous-hash/payload-hash chain from genesis
through that record is valid, and its stored allow-listed code equals the
scope's current code or the current code is `null`. This read-side predicate
does not depend on REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-005 having completed
write-side pending selection. Its currently raised identical allow-listed
reason remains downgraded during the retry window. The window therefore
survives a whole-file migration skip caused by a different record's unrelated
invalid field while the predicates above remain true, but does not survive
chain corruption at or before this record; it ends when a version-2 successor
for that scope is successfully persisted or the record itself ceases to
satisfy those predicates. A legacy workflow document without `reconciliation` retains
its existing version-1 evaluation behavior. When reconciliation is present,
an authoritative version-1 record outside that migration compatibility window is
stale by definition because snapshot version 1 is non-current; the system does
not recompute a legacy global workflow head for it. Any later incompatible
payload change after migration increments `snapshotVersion`, making an
authoritative record under a prior version stale regardless of field equality,
except for this explicit version-1 migration compatibility window.
When `workflow.reconciliation` is absent, `workflow waiver record` and
`workflow waiver record-all` continue
to create snapshot-version-1 records whose exact canonical snapshot object keys
are `skill`, `phase`, `status`, `recordedAt`, `version`, `commandSha256`,
`index`, `workflowEvidenceHead`, and `code`, using the same explicit `null`
sentinels defined above and `workflowEvidenceHead(workflow)` as the legacy
global head; existing version-1 records continue to use that payload. An
authoritative version-2 record in a workflow document with no
`reconciliation` own property is stale by definition and is never evaluated
with the legacy global head. Version-2 recording
and `workflowScopeEvidenceHead` are used only when valid reconciliation is
present; therefore the scope-head function is never invoked for a legacy
workflow document. When reconciliation is present but malformed, over a
durable limit, or config-mismatched, both recording commands reject without writing under
REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004, so no snapshot version is
selected from unsafe reconciliation.
The exact version-2 canonical snapshot object keys are `skill`, `phase`,
`status`, `recordedAt`, `version`, `commandSha256`, `index`,
`workflowScopeEvidenceHead`, and `code`, with the explicit `null` sentinels
defined above. The `eventIndex` argument is the resolved declaration event's
zero-based position in `workflow.events`: the persisted waiver `index` when
present, otherwise the unique event position resolved from
`skill`/`phase`/`declarationRecordedAt` under
REQ-WORKFLOW-EVIDENCE-WAIVER-007.

## REQ-WORKFLOW-EVIDENCE-WAIVER-013: Define the workflow-waiver evidence file schema, canonicalization, and chain genesis
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall persist `.musubix/evidence/workflow-waivers.json` as a `{ schemaVersion: 1, waivers: WorkflowWaiverRecord[] }` document where each `WorkflowWaiverRecord` carries exactly the fields enumerated in this Statement and no other top-level or nested properties (an object with any additional property fails REQ-WORKFLOW-EVIDENCE-WAIVER-007's shape check and is reported per REQ-WORKFLOW-EVIDENCE-WAIVER-008), specifically: a non-empty string `skill`, non-empty string `phase`, a `Date.prototype.toISOString()`-format string `declarationRecordedAt` (matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`), a nonnegative integer `index` (present only when disambiguating a collision per REQ-WORKFLOW-EVIDENCE-WAIVER-005; otherwise the key is entirely omitted, never `null`), one of the five REQ-WORKFLOW-EVIDENCE-WAIVER-001 allow-listed `code` values, non-empty string `approver`, non-empty string `reason`, a `Date.prototype.toISOString()`-format string `waiverRecordedAt` (matching the same `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` pattern, distinct from `declarationRecordedAt`), a positive integer `sequence` (one greater than the previous record's `sequence`, or `1` for the first record), a positive integer `snapshotVersion`, a lowercase 64-character hexadecimal `snapshotHash`, a lowercase 64-character hexadecimal `previousSha256`, and a lowercase 64-character hexadecimal `payloadSha256`, hashing with the project's existing exported `canonicalJson` function from `packages/analysis/src/change-waiver.ts` (recursively sorted lexicographic object keys, entries whose value is `undefined` omitted entirely, arrays serialized in element order, reused verbatim rather than reimplemented or aliased to the differently behaved private `canonical` function in `packages/analysis/src/workflow.ts`), with the first record's `previousSha256` fixed to sixty-four `"0"` characters and every later record's `previousSha256` equal to the immediately preceding record's `payloadSha256`.
Acceptance: A freshly recorded first waiver has `sequence: 1` and
`previousSha256` equal to `"0".repeat(64)`; a second waiver has
`sequence: 2` and `previousSha256` equal to the first waiver's
`payloadSha256`; `payloadSha256` for each record is the SHA-256 of
`canonicalJson` applied to that record's fields excluding `payloadSha256`
itself; a record whose `declarationRecordedAt`/`waiverRecordedAt` does not
both match the `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` pattern
and round-trip exactly through `new Date(value).toISOString() === value`
(rejecting syntactically pattern-matching but calendrically impossible
values such as `2026-13-40T25:61:61.999Z`), whose `sequence`/
`snapshotVersion` is not a positive integer, or whose
`snapshotHash`/`previousSha256`/`payloadSha256` is not a 64-character
lowercase hex string fails REQ-WORKFLOW-EVIDENCE-WAIVER-007's shape check
and is reported per REQ-WORKFLOW-EVIDENCE-WAIVER-008; validating the file
detects and reports a broken chain (a record whose `previousSha256` does
not equal its predecessor's `payloadSha256`, a record whose `sequence`
does not equal one greater than its predecessor's, or a first record
whose `previousSha256` is not the genesis value or whose `sequence` is not
`1`) the same way. Two independently generated
implementations serializing the identical logical record produce
byte-identical canonical JSON and therefore identical `payloadSha256`
values, since the serialization algorithm is fully specified by reuse of
the existing `canonicalJson` function, not redefined ad hoc.
`.musubix/evidence/workflow-waivers.json` is audit evidence and is excluded
from both `workflowEvidenceHead`/`workflowScopeEvidenceHead` and attestation
evidence-head collection, so appending its self-chained records cannot
recursively invalidate the snapshot or attestation that authorized the append.

## REQ-WORKFLOW-EVIDENCE-WAIVER-014: Surface active waivers in `status`/`gate --json` for audit visibility
Priority: should
Type: functional
Pattern: event-driven
Statement: When `gate --json` or `status --json` runs, the system shall include a `workflowWaivers` array listing every currently raised allow-listed reason diagnostic covered by an effective authoritative waiver under REQ-WORKFLOW-EVIDENCE-WAIVER-012 using that record's `skill`, `phase`, `declarationRecordedAt`, `index` (when present), `code`, `approver`, `reason`, and `waiverRecordedAt`.
Acceptance: `gate --json` output contains a `workflowWaivers` array with
at most one entry per `skill`/`phase`/`declarationRecordedAt`/`index`
scope — the entry for that scope's authoritative record, when it is
effective and its identical allow-listed `code` is currently
raised for that scope — each carrying
only the fields enumerated in this requirement's own Statement,
with `index` included only when present (never the persisted-only `sequence`/`snapshotVersion`/
`snapshotHash`/`previousSha256`/`payloadSha256` fields defined by
REQ-WORKFLOW-EVIDENCE-WAIVER-013), using
the same `declarationRecordedAt`/`waiverRecordedAt` field names defined in
REQ-WORKFLOW-EVIDENCE-WAIVER-005/013; a stale or malformed authoritative
waiver (per REQ-WORKFLOW-EVIDENCE-WAIVER-008/012) is excluded from this
array (though its corresponding
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED`/`WORKFLOW_WAIVER_STALE` diagnostic is
still reported per those requirements), and every superseded,
non-authoritative record for a scope (per
REQ-WORKFLOW-EVIDENCE-WAIVER-007) is likewise always excluded from this
array regardless of its own validity or snapshot state. A migrated version-2
successor whose current snapshot `code` input is `null` because its residual
is resolved is excluded from `workflowWaivers`, even though the record is
an effective authoritative waiver. A pending migration-compatible authoritative
version-1 record whose identical allow-listed `code` is currently raised is
included in `workflowWaivers` while REQ-WORKFLOW-EVIDENCE-WAIVER-012 keeps its
diagnostic downgraded. While any reconciliation error named by
REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004 is raised, or while
`WORKFLOW_INVOCATION_UNVERIFIED` is raised, this pending record
and every other workflow waiver are excluded from `workflowWaivers`.
Entries are ordered by ascending persisted `waivers` array position of their
authoritative records. When no scope qualifies, `workflowWaivers` is present as
an empty array rather than omitted.
`status --json`
computes its `workflowWaivers` array via the identical computation used
for `gate --json`'s `workflowWaivers` array (both are built by
`packages/analysis/src/gate.ts`'s shared workflow-waiver resolution logic).
Separately, change-waiver audit arrays use
`waiverEvidenceDiagnostics(root)` in both surfaces per
REQ-CHANGE-EVIDENCE-WAIVER-011. Thus `status
--json`'s `workflowWaivers` array satisfies every rule above identically
to `gate --json`'s.

## REQ-WORKFLOW-EVIDENCE-WAIVER-015: Redefine the workflow check's gate status as free of error-severity diagnostics
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall compute the `workflow` check's `gate`/`status` result as `pass` when `workflow.present` is `true` and `workflow.diagnostics` contains no `error`-severity diagnostic, consistent with the error-severity-based validity semantics used by the `change-history`/`change-completeness` validators and feature-scoped `countErrors` gate branches, rather than requiring `diagnostics.length === 0` regardless of severity; `WORKFLOW_WAIVER_EVIDENCE_MALFORMED`/`WORKFLOW_WAIVER_STALE` diagnostics (per REQ-WORKFLOW-EVIDENCE-WAIVER-008/012) are never included in `workflow.diagnostics` and therefore never affect this `status` computation.
Acceptance: Given a repository whose only `workflow` diagnostics are
warnings covered by effective authoritative waivers (per
REQ-WORKFLOW-EVIDENCE-WAIVER-009),
`gate --json`'s `workflow` check reports `status: "pass"`, even while a
separate `WORKFLOW_WAIVER_EVIDENCE_MALFORMED`/`WORKFLOW_WAIVER_STALE`
entry for an unrelated scope is visible in `waiverDiagnostics`; given the
same repository additionally has one non-waived `error`-severity
`WORKFLOW_*` diagnostic in `workflow.diagnostics`, the `workflow` check
still reports `status: "fail"`. Recording release approval for a state
where every required check (including `workflow`) independently reports
`pass` succeeds without any change to
`packages/analysis/src/approval-record.ts`'s existing
`check.status !== 'pass'` blocking condition, and without requiring
`waiverDiagnostics` to be empty.

## REQ-WORKFLOW-EVIDENCE-WAIVER-016: Attach structured skill, phase, declaration timestamp, and index fields to waivable diagnostics
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall attach structured `skill`, `phase`, `declarationRecordedAt`, and, when the originating `status: "completed"` declaration event's `skill`/`phase`/`recordedAt` triplet is shared by more than one `status: "completed"` event, `index` fields to every `WORKFLOW_SKILL_NOT_INVOKED`, `WORKFLOW_INVOCATION_ORDER`, `WORKFLOW_INVOCATION_INCOMPLETE`, `WORKFLOW_INVOCATION_FAILED`, declaration-scoped `WORKFLOW_INVOCATION_REUSED`, and `WORKFLOW_BINDING_MISSING` diagnostic emitted by `validateWorkflow` (each of which `validateWorkflow` raises only for a `status: "completed"` declaration event, per REQ-WORKFLOW-EVIDENCE-WAIVER-005's identical scoping).
Acceptance: Given two declaration events for different `phase` values of
the same `skill` each reporting `WORKFLOW_SKILL_NOT_INVOKED`, `gate
--json`'s diagnostic entries each carry `skill`/`phase`/
`declarationRecordedAt` fields matching their originating declaration,
distinguishable without parsing the `message` string. This applies
identically to each of the other four allow-listed reason codes
(`WORKFLOW_INVOCATION_ORDER`, `WORKFLOW_INVOCATION_INCOMPLETE`,
`WORKFLOW_INVOCATION_FAILED`, and the declaration-scoped flavor of
`WORKFLOW_INVOCATION_REUSED`) and to the paired `WORKFLOW_BINDING_MISSING`
diagnostic raised for the same declaration event — each carries the
identical `skill`/`phase`/`declarationRecordedAt`/`index` fields as its
paired reason code. The tool-call-scoped flavor of
`WORKFLOW_INVOCATION_REUSED` (identified by `toolCallId`, never waivable
per REQ-001) carries no `skill`/`phase`/`declarationRecordedAt`/`index`
fields, so it is structurally distinguishable from the declaration-scoped
flavor without parsing message text either. Given two `status:
"completed"` declaration events
share an identical `skill`/`phase`/`declarationRecordedAt` triplet (a
collision), both events' diagnostics carry an `index` field with their
respective distinct zero-based positions; given no collision exists for a
given triplet, its diagnostics carry no `index` field at all.
REQ-WORKFLOW-EVIDENCE-WAIVER-002 and REQ-WORKFLOW-EVIDENCE-WAIVER-009
match waivers only against these structured fields, never by parsing
message text.

## REQ-WORKFLOW-EVIDENCE-WAIVER-017: Reject appending when the evidence file or any existing record within it is invalid, instead of compounding it
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `.musubix/evidence/workflow-waivers.json` exists but is not valid JSON, does not match the `{ schemaVersion: 1, waivers: WorkflowWaiverRecord[] }` shape, or contains any existing record that fails REQ-WORKFLOW-EVIDENCE-WAIVER-013's shape/chain rules or REQ-WORKFLOW-EVIDENCE-WAIVER-007's linkage rules (staleness per REQ-WORKFLOW-EVIDENCE-WAIVER-012 excepted, since a stale-but-structurally-valid record never blocks appending), then the system shall reject every `workflow waiver record` invocation and record no evidence, instead of appending to it.
Acceptance: Given the file's content is malformed JSON, is missing the
`schemaVersion`/`waivers` keys, contains a record whose `previousSha256`
does not equal its predecessor's `payloadSha256`, whose `sequence` values
are not the exact one-based, gap-free ascending sequence required by
REQ-WORKFLOW-EVIDENCE-WAIVER-013, or whose `skill`/`phase`/
`declarationRecordedAt`/`index` name no currently-`"completed"`
declaration event in `.musubix/evidence/workflow.json` (a broken linkage,
per REQ-WORKFLOW-EVIDENCE-WAIVER-007), every `workflow waiver record`
call exits nonzero with an error identifying the corruption, and the
file's bytes are unchanged by the call. Given every existing record is
structurally valid and validly linked but one of them is merely stale
per REQ-WORKFLOW-EVIDENCE-WAIVER-012, a `workflow waiver record` call for
a different scope is accepted; a call for the identical stale scope is
likewise accepted per REQ-WORKFLOW-EVIDENCE-WAIVER-011's replacement
allowance. This applies in addition to, and independently of, the
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED` diagnostic defined by
REQ-WORKFLOW-EVIDENCE-WAIVER-008, which reports the same corruption
during `gate`/`status` runs rather than only at recording time. Once
corrupted this way, `.musubix/evidence/workflow-waivers.json` has no
in-tool automated repair. This absence of a repair command matches the
existing `change-evidence-waiver` precedent (whose
`recordChangeWaiver` likewise throws `"... is malformed; regenerate or
repair it before recording a new waiver."` with no built-in repair
command), although the two features intentionally differ in whether malformed
audit evidence affects gate-check validity. Recovery is an out-of-band, manual, human-reviewed edit or
regeneration of the evidence file outside `workflow waiver record` itself,
never an automated or partial in-place correction by this feature.
