---
schemaVersion: 1
feature: change-record-fail-fast
---
# Fail-fast unchanged-fingerprint detection in change-record

Source: GitHub Issue #20. Root cause: `recordChangePhase` (in
`packages/analysis/src/change.ts`) unconditionally accepts and durably
persists every phase checkpoint, computing `currentFingerprints(...)` without
ever comparing it against the immediately preceding phase's corresponding
fingerprint for the same change. The comparison that would have caught a
no-op phase (`CHANGE_REQUIREMENTS_UNCHANGED`, `CHANGE_DESIGN_UNCHANGED`,
`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`,
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`) exists only in
`validateChangeEvidence`, invoked much later by `trace check --strict` /
`gate`. Because each phase can be recorded exactly once per change with no
reset/overwrite affordance, and `.musubix/evidence/changes.json` is treated
as an append-only ledger throughout this codebase, a mistake caught this late
is permanently unfixable without discarding evidence outside the CLI. This
was independently reproduced in this repository's own working history during
Issue #19 (`CHANGE-0009`, recorded retroactively after implementation was
already complete) as well as twice in `nahisaho/aira2` (`CHANGE-0001`,
`CHANGE-0004`), confirming the same failure shape as reported.

This feature moves that same detection earlier, to the moment of recording,
for the phase transitions where an unchanged fingerprint is never valid
(`requirements` after `impact`, `design` after `requirements`, `red` "tests"
after `design`, `implementation` after `red`, per-requirement relevant
implementation after `red`), while still allowing an explicit, intentional
override for the one case the `sdd-change` workflow explicitly documents as
legitimate: a defect fix that keeps its requirement unchanged. It also adds a
preview mode so a caller can check this before committing to a durable,
unfixable-if-wrong recording, and documents the failure mode directly in the
CLI's own help output and README.

## REQ-CHANGE-RECORD-FAIL-FAST-001: Reject an unchanged requirements phase fingerprint at record time
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` is invoked for the `requirements` phase and its computed requirements fingerprint equals the change's recorded `impact` phase requirements fingerprint, then the system shall reject the recording with a non-zero exit and the stable diagnostic code `CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD` naming the change ID.
Acceptance: Given a change whose `impact` phase is recorded and no
`.musubix/features/*/requirements.md` file has changed since, invoking
`change-record <id> requirements --requirement <ids>` exits non-zero, prints
`CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD` naming the change ID, and
`changes.json` is byte-identical to its state before the invocation. After a
genuine edit to a requirements.md file, the same command succeeds and
records the phase.

## REQ-CHANGE-RECORD-FAIL-FAST-002: Reject an unchanged design phase fingerprint at record time
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` is invoked for the `design` phase and its computed design fingerprint equals the change's recorded `requirements` phase design fingerprint, then the system shall reject the recording with a non-zero exit and the stable diagnostic code `CHANGE_DESIGN_UNCHANGED_AT_RECORD` naming the change ID.
Acceptance: Given a change whose `requirements` phase is recorded and no
`design.md`/`ADR-*.md` file has changed since, invoking `change-record <id>
design --requirement <ids>` exits non-zero, prints
`CHANGE_DESIGN_UNCHANGED_AT_RECORD` naming the change ID, and `changes.json`
is unchanged. After a genuine edit to a design.md or ADR file, the same
command succeeds.

## REQ-CHANGE-RECORD-FAIL-FAST-003: Reject an unchanged tests fingerprint at Red record time
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` is invoked for the `red` phase of a requirement batch and its computed tests fingerprint equals that batch's `design` phase tests fingerprint, then the system shall reject the recording with a non-zero exit and the stable diagnostic code `CHANGE_TESTS_UNCHANGED_AT_RECORD` naming the change ID.
Acceptance: Given a batch whose `design` phase is recorded and no test file
has changed since, invoking `change-record <id> red --requirement <subset>`
exits non-zero, prints `CHANGE_TESTS_UNCHANGED_AT_RECORD` naming the change
ID, and `changes.json` is unchanged. After a genuine new or changed test,
the same command succeeds.

## REQ-CHANGE-RECORD-FAIL-FAST-004: Reject an unchanged implementation fingerprint at Implementation record time
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` is invoked for the `implementation` phase of a requirement batch and its computed implementation fingerprint equals that batch's `red` phase implementation fingerprint, then the system shall reject the recording with a non-zero exit and the stable diagnostic code `CHANGE_IMPLEMENTATION_UNCHANGED_AT_RECORD` naming the change ID.
Acceptance: Given a batch whose `red` phase is recorded and no non-test
source file has changed since, invoking `change-record <id> implementation
--requirement <subset>` exits non-zero, prints
`CHANGE_IMPLEMENTATION_UNCHANGED_AT_RECORD` naming the change ID, and
`changes.json` is unchanged. After a genuine source edit, the same command
succeeds.

## REQ-CHANGE-RECORD-FAIL-FAST-005: Reject an unchanged per-requirement relevant-implementation fingerprint at Implementation record time
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` is invoked for the `implementation` phase of a requirement batch and its computed per-requirement relevant-implementation fingerprint equals that batch's `red` phase fingerprint for any requirement ID in the batch, then the system shall reject the recording with a non-zero exit and the stable diagnostic code `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED_AT_RECORD` naming the change ID and the unchanged requirement ID(s).
Acceptance: Given a batch covering requirement IDs A and B whose `red` phase
is recorded, and only the Code Graph implementation scope of A has changed
since, invoking `change-record <id> implementation --requirement A,B` exits
non-zero and `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED_AT_RECORD` names B.
After B's relevant implementation also changes, the same command succeeds.

## REQ-CHANGE-RECORD-FAIL-FAST-006: Leave existing evidence untouched on any record-time rejection
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `change-record` rejects a recording under REQ-CHANGE-RECORD-FAIL-FAST-001 through -005, then the system shall leave both `.musubix/evidence/changes.json` and `.musubix/evidence/order.json` byte-identical to their state immediately before the invocation.
Acceptance: Given any of the five rejection scenarios in
REQ-CHANGE-RECORD-FAIL-FAST-001 through -005, comparing
`.musubix/evidence/changes.json` and `.musubix/evidence/order.json` before
and after the rejected invocation shows no difference, including no
consumed evidence-order sequence number for that attempt.

## REQ-CHANGE-RECORD-FAIL-FAST-007: Provide an explicit override for an intentionally unchanged requirements phase
Priority: must
Type: functional
Pattern: event-driven
Statement: When `change-record requirements` is invoked with an explicit `--allow-unchanged` flag, the system shall bypass the REQ-CHANGE-RECORD-FAIL-FAST-001 requirements-fingerprint check for that invocation, record the phase, and persist a durable marker on that phase's evidence indicating the override was used.
Acceptance: Given a defect-fix change whose requirement text is intentionally
unchanged, `change-record <id> requirements --requirement <ids>
--allow-unchanged` succeeds, records the phase, and the phase's evidence
entry in `changes.json` records that the override was used. Given the same
preconditions without `--allow-unchanged`, the invocation is rejected per
REQ-CHANGE-RECORD-FAIL-FAST-001. The override never bypasses any other
check (existing prerequisite-phase, requirement ID set, or duplicate-phase
validation still applies), and `--allow-unchanged` has no effect on
`design`, `red`, or `implementation`, for which no legitimate unchanged case
is documented.

## REQ-CHANGE-RECORD-FAIL-FAST-008: Suppress the historical unchanged-requirements diagnostic for a marked override
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a change's `requirements` phase evidence carries the REQ-CHANGE-RECORD-FAIL-FAST-007 override marker, then the system shall not report `CHANGE_REQUIREMENTS_UNCHANGED` for that change during `trace check --strict`/`gate` change-evidence validation.
Acceptance: Given a change recorded with `change-record requirements
--allow-unchanged`, running `gate --json`/`trace check --strict --json`
afterward does not report `CHANGE_REQUIREMENTS_UNCHANGED` for that change ID.
A change without the marker whose requirements fingerprint is unchanged
still reports `CHANGE_REQUIREMENTS_UNCHANGED` exactly as before this
feature; no other of the four remaining `*_UNCHANGED` diagnostic codes is
ever suppressed by this marker.

## REQ-CHANGE-RECORD-FAIL-FAST-009: Preview a phase recording, including all existing validation, without persisting it
Priority: must
Type: functional
Pattern: event-driven
Statement: When `change-record` is invoked with an explicit `--dry-run` flag, the system shall report the outcome that a real invocation with the same arguments and flags would produce, evaluating every check the real invocation would evaluate (including phase order, requirement ID set, duplicate-phase, and Quality Green-coverage validation, in addition to the fail-fast unchanged-fingerprint checks), without writing `.musubix/evidence/changes.json` or appending to the evidence order log.
Acceptance: Given any valid `change-record` invocation with `--dry-run`
added, `.musubix/evidence/changes.json` and `.musubix/evidence/order.json`
are byte-identical before and after the call, and the reported outcome
(success, or the specific rejection diagnostic/exit code) matches what the
same invocation without `--dry-run` would have produced, for at least: a
missing prerequisite phase, an already-recorded phase/batch, an invalid
requirement-ID subset, a Quality attempt with incomplete Green coverage, and
each of the five fail-fast unchanged-fingerprint rejections.
`--dry-run` combined with `--allow-unchanged` previews the overridden
outcome.

## REQ-CHANGE-RECORD-FAIL-FAST-010: Document the fail-fast behavior and its override
Priority: must
Type: functional
Pattern: state-driven
Statement: While a user views `change-record`'s command-line help output or the `README.md` section describing `change-record`, the system shall present documentation describing the fail-fast unchanged-fingerprint rejection, the `--allow-unchanged` override and its restriction to the `requirements` phase, and the `--dry-run` preview mode.
Acceptance: Given `musubix3 change-record --help`, the output text names the
fail-fast rejection, `--allow-unchanged`, and `--dry-run`. Given
`README.md`'s `change-record` section, the same three concepts are described
in prose, not only inside the `sdd-change` skill file.
