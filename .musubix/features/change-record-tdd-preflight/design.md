# Change-record TDD preflight design

## DES-CHANGE-RECORD-TDD-PREFLIGHT-001: Canonical persisted-evidence preflight analyzer
Responsibilities: Add a pure preflight analyzer in
`packages/analysis/src/change.ts` that evaluates a Red, Implementation, or
Green `change-record` request against the invocation-time persisted
`ChangeRecord`, `TddEvidence`, validated monotonic order log, and a
trace-derived map of authoritative verifying test IDs per requested
requirement. The analyzer must not mutate the supplied change, allocate an
order, or construct a new batch. For Implementation and Green, derive
requirement windows from the persisted effective batches and
greatest-Red-order selector used by REQ-CHANGE-REQUIREMENT-BATCHES-005. For
Red, where the requested batch has no persisted Red marker yet, use a dedicated
open-ended window whose exclusive lower bound is the maximum integer Red order
across all applicable persisted batches and the Requirements order. For
record-time safety, all three phases fail closed with `missing-order` instead
of using validation's historical migration fallback whenever a required
persisted boundary or candidate phase lacks a valid integer order or matching
order-log record.

The acceptance candidate universe for one requirement contains every persisted
cycle whose `requirementId` equals that requirement. A secondary
classification-only universe contains cycles whose `testId` is an
authoritative `@verifies` test for the requirement but whose `requirementId`
differs; those cycles produce `wrong-requirement` details and directly explain
the last-value-only failure without making trace membership an additional
acceptance condition. Unrelated repository cycles are excluded.
`no-candidate` means both universes are empty. For Red, an eligible cycle
matches the requirement, is not validly voided, has a valid linked Red after
the persisted lower boundary, and has no Green. For
Implementation, the requested persisted batch object (the synthesized
full-set batch for the full-set path, or the actual `tddBatches` object for a
subset) must be the current object selected for the requirement from the same
single `effectiveBatches(change)` snapshot, and the same pending Red must fall
inside that batch window. For Green, the requested persisted batch object from
that shared snapshot must be current and a linked valid Red-Green cycle must
have Red inside the current window and Green after the batch Implementation
marker.

TDD proof retains the existing any-valid-cycle-in-window rule.
Order-migration safety separately reuses only the missing-Red-order part of
`orderMigrationRequiredRequirementCondition`: any non-void cycle for the
requirement with a missing Red order is fail-closed regardless of
candidate/trace membership or window. The pending cycle's absent future Green
order is not evaluated for Red or Implementation preflight. Green preflight
instead requires its accepted cycle's persisted Green order and linkage as
part of phase-appropriate proof. A request succeeds only when it has that
phase-appropriate proof and no persisted non-void cycle for the requirement
requires Red-order migration.
Candidate references use `cycleId` when present, otherwise the zero-based index
in the complete persisted `TddEvidence.cycles` array in
`${testId}@${red.order ?? "unordered"}#${persistedCycleIndex}`. Candidate
details and TDD diagnostic codes are sorted and deduplicated.

Interfaces:
`analyzeChangeTddPreflight(change, effectiveBatchSnapshot, requestedBatch,
phase, requirementIds, tdd, order, verifyingTestIdsByRequirement):
ChangeTddPreflightResult`, where the result contains
`phase`, `uncoveredRequirementIds`, and `rejections`. Export the result,
rejection, category, and phase types from `packages/analysis/src/change.ts`.
Compute `effectiveBatchSnapshot` exactly once per invocation and use it both to
select `requestedBatch` and inside the analyzer, so synthesized full-set batch
identity remains stable. Reuse `batchFor`, persisted object identity, batch
keys, valid-void resolution, and shared TDD cycle integrity checks. Do not
place the analyzer in `change-evidence.ts`; keeping orchestration in
`change.ts` preserves the existing type-only dependency from
`change-evidence.ts` to `tdd.ts`.

Constraints: The analyzer reads only persisted evidence plus the current
authoritative trace mapping; it does not use an unpersisted change phase or
batch. An empty batch created for a candidate Red must never be visible to it.
If the persisted order log fails `validateEvidenceOrderLog`, all requested
requirements fail closed with `missing-order`; void classification must not
silently degrade to treating an unverifiable void as eligible evidence.
`requestedBatch` is undefined only for Red; its prospective batch key is
derived from the normalized requested requirement IDs, while
`superseded-batch` is not applicable. For Implementation/Green it is the exact
persisted full-set or subset object used by the invocation path.
`no-candidate` is emitted only when neither a same-requirement cycle nor an
authoritative-test wrong-requirement cycle exists; all other categories carry
stable non-empty details. A later overlapping Red batch makes an older
requested Implementation/Green batch `superseded-batch`. Existing waivers and
Quality history are ignored for record-time acceptance. The helper must not
equate valid formal/SAT evidence with TDD behavior.

Requirements: REQ-CHANGE-RECORD-TDD-PREFLIGHT-001 REQ-CHANGE-RECORD-TDD-PREFLIGHT-002 REQ-CHANGE-RECORD-TDD-PREFLIGHT-003 REQ-CHANGE-RECORD-TDD-PREFLIGHT-004
ADRs: none - this is a local fail-fast extension of the existing change/TDD evidence architecture.
Depends-On: DES-CHANGE-RECORD-TDD-PREFLIGHT-002

## DES-CHANGE-RECORD-TDD-PREFLIGHT-002: Shared TDD cycle integrity classification
Responsibilities: Expose a side-effect-free TDD helper that returns stable
diagnostic codes for one persisted cycle's Red/Green integrity using the same
hash-chain, command, test-fingerprint, validity, and monotonic-order semantics
as the corresponding pure checks in `validateTddEvidence`. Implement it in
`packages/analysis/src/tdd.ts`, where private chain-linkage helpers are already
available. Refactor shared predicates where necessary so preflight and full
validation cannot disagree about phase linkage, `TDD_COMMAND_CHANGED`,
red/green stored test-fingerprint inconsistency, chain payload mismatch, or
order mismatch. This helper intentionally excludes filesystem-dependent `TDD_TEST_STALE`,
repository-wide coverage, evidence reuse, and
superseded-cycle suppression; preflight fails closed on integrity defects in
an otherwise authoritative candidate. The preflight analyzer maps returned
codes to `tdd-validation` and uses phase-specific structural categories for
window, void, result, and Green ordering failures.

Interfaces:
`tddCycleIntegrityDiagnosticCodes(evidence, order, cycle, phases):
string[]`; the input phase set is `['red']` for Red/Implementation and
`['red', 'green']` for Green. Existing `validateTddEvidence(root)` keeps its
public result and diagnostic messages unchanged.

Constraints: Preserve all existing validator diagnostics, severity, paths, and
ordering. The helper reports only codes attributable to the supplied cycle;
repository-wide coverage or unrelated-cycle diagnostics are excluded. It must
not accept hand-edited evidence merely because basic boolean fields look
valid.

Requirements: REQ-CHANGE-RECORD-TDD-PREFLIGHT-001 REQ-CHANGE-RECORD-TDD-PREFLIGHT-002 REQ-CHANGE-RECORD-TDD-PREFLIGHT-003 REQ-CHANGE-RECORD-TDD-PREFLIGHT-004
ADRs: none - shared predicates remove duplication without changing evidence schemas.

## DES-CHANGE-RECORD-TDD-PREFLIGHT-003: Pre-append integration and structured CLI error
Responsibilities: In `recordChangePhaseUnlocked`, preserve the existing
validation precedence through `unchangedRejection`, then load TDD/order
evidence and invoke DES-001 before candidate phase construction, batch
insertion, `appendEvidenceOrder`, or `writeJson`. Red must defer creation of a
new `tddBatches` entry until preflight succeeds. Throw a typed
`ChangeRecordTddPreflightError` when uncovered requirements remain, using
`CHANGE_RED_TDD_PREFLIGHT_FAILED`,
`CHANGE_IMPLEMENTATION_TDD_PREFLIGHT_FAILED`, or
`CHANGE_GREEN_TDD_PREFLIGHT_FAILED`. `--dry-run` executes the same analyzer and
returns the same error without writes.

Refactor `currentFingerprints` to return the already-built trace together with
the persisted fingerprints. Derive `verifyingTestIdsByRequirement` from that
trace rather than running `buildTrace(root, false)` a second time. This keeps a
single authoritative invocation-time trace snapshot and avoids duplicate trace
construction.

Extend the CLI top-level error projection so JSON mode serializes this typed
error as `{ error: { code, message, phase, uncoveredRequirementIds,
rejections } }`; non-JSON output keeps the standard `musubix3:` prefix and
includes the stable code and sorted uncovered IDs. Other errors retain their
existing `CLI_ERROR` or specialized rendering.

Interfaces:
`class ChangeRecordTddPreflightError extends Error` with readonly `code`,
`phase`, `uncoveredRequirementIds`, and `rejections`; a CLI rendering branch
before the generic `CLI_ERROR` branch.

Constraints: For the full-set path, run preflight after
`unchangedRejection` and before constructing `change.phases[phase]`. For the
subset path, resolve the existing persisted batch for Implementation/Green,
but do not execute `change.tddBatches ??= []`, push a Red batch, or construct a
phase candidate until preflight succeeds. Both `changes.json` and `order.json`
must remain byte-identical on every rejection. No candidate object or in-memory
batch mutation may escape the failed invocation. Existing `*_AT_RECORD` errors
remain reachable and take precedence. The typed error must be serializable
without casts that weaken type safety.

Requirements: REQ-CHANGE-RECORD-TDD-PREFLIGHT-001 REQ-CHANGE-RECORD-TDD-PREFLIGHT-002 REQ-CHANGE-RECORD-TDD-PREFLIGHT-003 REQ-CHANGE-RECORD-TDD-PREFLIGHT-004
ADRs: none - the typed error follows existing specialized CLI error rendering patterns.
Depends-On: DES-CHANGE-RECORD-TDD-PREFLIGHT-001 DES-CHANGE-RECORD-TDD-PREFLIGHT-002

## DES-CHANGE-RECORD-TDD-PREFLIGHT-004: Phase and diagnostic regression coverage
Responsibilities: Extend the dedicated change-record fail-fast test surface
with authoritative tests for Red, Implementation, Green, structured CLI JSON,
dry-run, overlapping-batch rejection, missing-order failure, validly voided and
already-Green cycles, and complete positive controls. The primary regression
uses requirements A, B, and C with eligible evidence only for C and asserts
that A and B are both reported in sorted order while `changes.json` and
`order.json` remain byte-identical. Tests must use valid persisted TDD and
order evidence so the intended preflight, not an unrelated schema failure,
causes rejection.

Migrate existing change-record test fixtures that intentionally exercise valid
Red, Implementation, or Green appends to create eligible persisted TDD
evidence first. Add a focused shared test helper where that avoids duplicating
cycle/order setup, while keeping tests that intentionally exercise malformed
or missing evidence explicit. Apply the migration to the affected
change-quality-refresh, change-record-recordedat-order,
change-requirement-batches, and change-record-fail-fast test surfaces.
Preserve change-evidence-waiver tests that intentionally exercise historical
`CHANGE_RED_UNPROVEN` and `CHANGE_GREEN_UNPROVEN` diagnostics by constructing
those invalid states directly as evidence fixtures instead of calling the
newly protected public record API. Update the gate-install fixture that uses a
synthetic Implementation marker by replacing the non-contiguous `red.order +
1000` value with a sequence allocated through `appendEvidenceOrder`, then use
that exact sequence as the marker order so it continues to exercise its
validate-time diagnostic.

Interfaces: `tests/change-record-fail-fast.test.ts`,
`tests/change-quality-refresh.test.ts`,
`tests/change-record-recordedat-order.test.ts`,
`tests/change-requirement-batches.test.ts`,
`tests/change-evidence-waiver.test.ts`, `tests/gate-install.test.ts`,
`tests/helpers.ts`, and the existing required commands in
`.musubix/config.json`.

Constraints: Include at least one real CLI process assertion for the JSON
shape and one non-JSON assertion. Preserve existing tests proving
`CHANGE_*_UNCHANGED_AT_RECORD` precedence. Do not add a redundant command or
weaken the required command policy. Explicitly test the authoritative-test
candidate bound, the initial Red open-ended window, full-set and subset paths,
and a latest incomplete cycle that would otherwise trigger order-migration
only after append. The missing-order test must use an otherwise-integer TDD
phase whose order-log record is absent or mismatched, because malformed
change-phase integer orders are rejected by the pre-existing earlier guard.
Use the trace returned by the refactored `currentFingerprints` call so a
rejected preflight neither rebuilds nor persists trace cache output. Update
`README.md` and `README-ja.md` with the three stable preflight codes,
write-before-check prohibition, structured JSON behavior, and the required
interleave `tdd red -> change-record red -> change-record implementation ->
tdd green -> change-record green`. Update
`.github/skills/sdd-change/SKILL.md` and
`.github/skills/sdd-implementation/SKILL.md` with the same ordering so
`green-already-recorded` is avoided; the human-readable error message points to
that recovery-safe sequence while structured category details remain stable
candidate references.

Requirements: REQ-CHANGE-RECORD-TDD-PREFLIGHT-001 REQ-CHANGE-RECORD-TDD-PREFLIGHT-002 REQ-CHANGE-RECORD-TDD-PREFLIGHT-003 REQ-CHANGE-RECORD-TDD-PREFLIGHT-004
ADRs: none - regression coverage extends the existing fail-fast command surface.
Depends-On: DES-CHANGE-RECORD-TDD-PREFLIGHT-003
