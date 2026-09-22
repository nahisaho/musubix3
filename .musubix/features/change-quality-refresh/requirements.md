---
schemaVersion: 1
feature: change-quality-refresh
---
# Change Quality checkpoint refresh

Source: GitHub Issue #36. A release-evidence review can legitimately require a
new Red/Implementation/Green batch after a staged change has already recorded
Quality. The current recorder accepts that corrective batch but permits only one
Quality checkpoint, so validation reports a non-waivable phase-order error even
after every current test and quality command passes.

## REQ-CHANGE-QUALITY-REFRESH-001: Append a refreshed Quality checkpoint
Priority: must
Type: functional
Pattern: event-driven
Statement: When `change-record <CHANGE-ID> quality` is invoked after the same change has recorded a newer complete corrective Red/Implementation/Green batch, the system shall append a new Quality checkpoint and retain every previously recorded Quality checkpoint as immutable audit history.
Acceptance: Given a change with an existing Quality checkpoint followed by a
requirement batch whose requirement-ID subset has no prior batch key and whose
Red, Implementation, and Green phases have greater monotonic order values,
invoking `change-record` for Quality with the change's exact full requirement
set succeeds. This includes CHANGE-0019's corrective singleton batches for
REQ-RELEASE-APPROVAL-ORDERING-001 through -003. The refresh appends the previous
`phases.quality` payload unchanged to `qualityHistory` in oldest-to-newest order,
writes the new checkpoint to `phases.quality`, and adds exactly one new
monotonic order record. After any published Quality-refresh transaction is
recovered, the recovered change's quiescent evidence state contains neither an
orphan Quality order identity nor a checkpoint that lacks its order record.
This transactional guarantee applies only to the atomicity of the Quality
refresh write; all evidence writers gain the pre-write recovery gate below.
The first Quality checkpoint retains the legacy order phase key `quality`; the
second and later checkpoints use unique deterministic keys `quality:2`,
`quality:3`, and so on without changing any earlier order record or hash.
For a persisted non-dry-run refresh, `recordChangePhase()` and
`change-record --json` return evidence whose `phases.quality.order` is the
newest checkpoint order, so existing readers that consume the authoritative
field observe the refresh without reading history.
For persisted evidence, `phases.quality` is the greatest-order Quality
checkpoint and `qualityHistory` contains every lower-order checkpoint in
strictly ascending order.

## REQ-CHANGE-QUALITY-REFRESH-002: Reject invalid or unnecessary refreshes
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a requested Quality refresh has no newer complete Green batch, does not use the change's exact full requirement set, or leaves any declared requirement without current Green coverage, then the system shall reject the refresh without changing change evidence or monotonic order evidence.
Acceptance: Given an already current Quality checkpoint, an immediate second
Quality invocation fails without writing either evidence file. Given a
post-Quality batch with Red only or Red and Implementation only, refresh fails
and identifies the requirement IDs lacking Green in their greatest-Red-order
current batch. Given a proper subset or an undeclared requirement ID, refresh
fails. After every requirement's current batch completes Green and at least one
such Green order is greater than the authoritative Quality order, the same
full-set invocation succeeds. Initial Quality recording retains the existing
union-across-batches Green-coverage rule; the stricter current-batch rule applies
only to a refresh. A requirement untouched since the authoritative Quality is
satisfied by the Green of its greatest-Red-order current batch even when that
Green precedes Quality; only the corrected requirement's newer current batch
must move beyond Quality. Rejection for no newer Green includes
the plain Error message prefix `CHANGE_QUALITY_REFRESH_NOT_NEEDED`; rejection
for missing current Green includes the plain Error message prefix
`CHANGE_QUALITY_REFRESH_GREEN_MISSING` and the uncovered requirement IDs.
`--dry-run` applies the same prerequisites and returns the projected
`qualityHistory` and authoritative `phases.quality` without writing either
evidence file or reserving an order sequence; the projected checkpoint omits
`order`, reports projected schema version 2, and persisted-order invariants do
not apply to that projection. Full-set and undeclared-ID validation occurs
before refresh Green-coverage validation so an invalid scope is not reported as
missing Green. Refresh rejection precedence is scope validation,
Quality-lineage validation, current Green coverage
(`CHANGE_QUALITY_REFRESH_GREEN_MISSING`), then the newer-than-Quality check
(`CHANGE_QUALITY_REFRESH_NOT_NEEDED`); the last code is used only when every
requirement has current Green but none of those Green orders exceeds the
authoritative Quality order.
For `quality`, this refresh path supersedes the legacy immediate
`${changeId}:quality is already recorded.` duplicate-phase rejection.
Repeating corrective batches for an already-used requirement subset remains
governed by the existing duplicate-phase rejection and is outside this Quality
refresh operation; the operator must start a new staged change for another
correction to that same subset and make the independently reviewed
requirements/design artifact changes required by that distinct change. A pure
second code/test correction with no new requirements or design change remains
unsupported by this feature.

## REQ-CHANGE-QUALITY-REFRESH-003: Validate and merge Quality history deterministically
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall treat the order-linked Quality checkpoint with the greatest monotonic order as authoritative for chronology and completeness, validate every retained checkpoint and its order identity, and preserve existing single-checkpoint evidence behavior.
Acceptance: Given legacy evidence containing only `phases.quality`, validation
and merge results are unchanged. Given refreshed evidence, validation requires
Design before each effective batch, Red before Implementation before Green, and
the authoritative `phases.quality` checkpoint after every recorded Green; an
older retained checkpoint before a corrective batch does not produce
`CHANGE_PHASE_ORDER`. Each `qualityHistory` entry must match its ordinal order
identity (`quality` for the first, `quality:2` and later for subsequent
checkpoints), precede the next checkpoint, and have a unique order.
`qualityHistory[0]` pairs with the `quality` order record;
`qualityHistory[index]` for `index > 0` pairs with `quality:<index + 1>`;
`phases.quality` pairs with `quality` when `qualityHistory` is absent and otherwise with
`quality:<qualityHistory.length + 1>`. Exactly one order record pairs with each
checkpoint and no Quality order record for a change present in `changes.json`
is orphaned within that change's Quality lineage. Quality order records whose
change ID has no change entry are outside this feature's orphan check. Missing, duplicated,
malformed, orphaned, or mismatched Quality history/order entries produce
non-waivable error `CHANGE_QUALITY_HISTORY_MALFORMED`.
`qualityHistory` is an optional sibling of `phases` on each `ChangeRecord`.
It is malformed when it is not a non-empty array or when any entry is not a Quality
`ChangePhaseEvidence` object containing the same required fields as
`phases.quality`, including `phase: "quality"`, `recordedAt`, `fingerprints`,
and an integer `order`.
Recorder and merge output omit `qualityHistory` entirely when no retained
checkpoint exists. Retained checkpoints participate in
`CHANGE_RECORDEDAT_OUT_OF_ORDER` using distinct ordinal labels.

Before constructing refresh candidates, the recorder validates the complete
Quality lineage. An invalid lineage is rejected with plain Error prefix
`CHANGE_QUALITY_REFRESH_LINEAGE_INVALID`. Refresh persistence uses a dedicated
Quality-refresh transaction identity distinct from evidence-merge journals.
After an injected or real interruption, recovery of a prepared transaction
restores `order.json` and `changes.json` byte-identically to their journaled
originals; recovery of a committed transaction makes both files byte-identical
to their journaled candidates. Recovery never invents or adopts an unbound
checkpoint payload.

`change quality-recover` is the sole recovery surface for a published
Quality-refresh journal. While that journal is present, validation, dry-run, and
every other evidence reader/writer fail fast without inspecting evidence, using
non-waivable `CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED`; ordinary writers never
auto-recover. Unrecoverable or invalid transaction state fails with plain Error
prefix `CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE`.

Quality refresh refuses to publish while an evidence-merge journal exists, and
evidence merge plus its recovery path refuse while a Quality-refresh journal
exists. The shared writer lock and those preconditions prevent both journal
kinds from being published concurrently. If both are nevertheless observed,
both recovery commands fail unsafe rather than overwriting either transaction.
Committed recovery verifies each target is either its journaled original or
candidate before roll-forward; any unrelated target digest is unsafe. The
recorder exposes a deterministic dependency-injected fault seam used only by
tests to create prepared and committed recovery states.
`--dry-run` performs the same lineage validation and rejection ordering.

Every Quality pairing path uses the ordinal identity rules above, including
`validateChangeEvidence`'s singular-phase validation, evidence-merge input
validation, and rebuilt-candidate reference validation. Those passes also pair
each history entry with its ordinal identity. Quality identity/payload
mismatches produce `CHANGE_QUALITY_HISTORY_MALFORMED` rather than the legacy
`CHANGE_ORDER_MISMATCH`.

The repository-wide change evidence document remains schema version 1 until its
first Quality refresh. Recording that refresh upgrades the whole document
one-way to schema version 2; unrelated legacy changes remain valid entries but
older readers abort with `Invalid change chronology evidence.` rather than
reporting misleading phase/order drift. New readers accept versions 1 and 2 and
`loadChangeEvidence` first rejects a missing, non-numeric, non-integer, zero, or
negative schema version, and a non-array `changes` field, with the existing
`Invalid change chronology evidence.` error. It then rejects integer versions
greater than 2 by throwing a plain Error prefixed
`CHANGE_EVIDENCE_SCHEMA_UNSUPPORTED`; this is not a waivable diagnostic. A
present but empty `qualityHistory` is malformed rather than equivalent to
absence. A version-1 document containing a non-empty `qualityHistory` is invalid
and produces non-waivable error
`CHANGE_QUALITY_HISTORY_MALFORMED`. Evidence merge rejects such an input with
`EVIDENCE_MERGE_CONFLICT` before version maximization; otherwise it outputs the
maximum input schema version and always outputs version 2 when any merged change
carries a non-empty `qualityHistory`.

Evidence merge chronology and Quality-order validation use the authoritative
checkpoint. A refreshed change merges cleanly when all other evidence is valid.
For merge payload resolution, the `quality` identity resolves to
`qualityHistory[0]` when history exists and otherwise to `phases.quality`;
`quality:N` resolves to `qualityHistory[N - 1]` when that entry exists and
otherwise to `phases.quality` only when `N` is the authoritative final ordinal.
`phases.quality` input validation pairs with its greatest-order Quality identity,
and every history entry pairs with its ordinal identity.
The legacy slot-wise merge comparison of `phases.quality` is replaced by this
ordinal-lineage comparison, so a legacy prefix checkpoint is not incorrectly
compared with the refreshed authoritative checkpoint at a different ordinal.
Merge adds explicit Quality payload resolution for `quality` and `quality:N`;
it does not rely on the existing batch-only `payloadFor` path used by
Red/Implementation/Green order records.

When one merge side's ordered Quality lineage is an exact ordinal prefix of the
other side's lineage, including the legacy one-checkpoint case, the merged
result preserves the longer lineage. Identical checkpoints deduplicate by
ordinal identity and payload; divergent payloads or identities at the same
ordinal produce `EVIDENCE_MERGE_CONFLICT` and fail without partial writes. Merge
inputs containing an unresolvable, gapped, or orphaned `quality:N` identity also
produce `EVIDENCE_MERGE_CONFLICT` and fail without partial writes. Merge
preserves each checkpoint's ordinal identity, payload apart from `order`, and
lineage order; sequence renumbering rewrites checkpoint orders through the
existing sequence remap in base, incoming, and whole-change clone paths, and
order-chain hash rebuilding follows the existing merge contract. Merge output
re-establishes the invariant that `phases.quality` has
the greatest Quality order and history is strictly lower and ascending.
The merged change evidence document has schema version 2 whenever either input
is version 2 or the merged result contains `qualityHistory`.
`CHANGE_PHASE_ORDER` remains non-waivable; Quality refresh resolves chronology
by adding validated evidence, not by downgrading the diagnostic.
The bundled `.github/skills/sdd-change/SKILL.md` documents the
corrective-batch-then-Quality-refresh sequence, schema version 2 transition,
plain Error prefixes from REQ-CHANGE-QUALITY-REFRESH-002/003, and the
same-subset limitation.
