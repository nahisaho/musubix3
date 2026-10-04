---
schemaVersion: 1
feature: tdd-cycle-archive
---
# TDD cycle archive (human-audited retirement of orphaned/stale evidence)

Source: GitHub Issue #50 (originally filed as `nahisaho/jupytermind#39`,
closed as wontfix on the consumer side since the fix must live in musubix3
itself).

`tdd-cycle-void` (Issue #1/#20) already lets a human retire a single
*dangling, invalid* trailing cycle, but only when (a) that cycle's Green
phase is not already recorded as valid, and (b) an earlier, non-voided
cycle for the same test ID has both a valid Red and a valid Green to fall
back on. Two real-world situations fall entirely outside that coverage and
have no supported partial-repair path today:

1. A test's `@id` is renamed more than once in the same project (for
   example during a project-wide `@id` global-uniqueness fix). Each
   abandoned former ID keeps exactly one recorded cycle forever (no later
   cycle for that same, now-unused ID is ever recorded, so it is never
   superseded; no earlier cycle for that ID exists either, so `tdd void`
   is rejected by its no-fallback rule even when that one cycle's Green
   happens to be invalid, and rejected outright when it happens to be
   valid).
2. A cycle's Green phase is invalidated by something unrelated to the test
   or implementation being wrong (for example a transient structured-report
   annotation-format mismatch), while the test still currently exists,
   passes, and is fully implemented. There is no earlier valid cycle to
   fall back to, so `tdd void` is rejected, and the only tool-supported
   remedy is moving `.musubix/evidence/tdd.json` aside and re-recording
   every Red/Green cycle in the entire project — disproportionate, and
   risky for a project with multiple already-approved/released changes
   sharing the same evidence ledger.

This change adds an explicit, human-approved `tdd archive <test-id>`
command that marks a single trailing cycle as archived (an appended,
hash-chained record, exactly like `void`, never a deletion or edit of
existing evidence), without either of `void`'s two preconditions: an
archived cycle's Green may already have been recorded as valid, and no
earlier valid fallback cycle is required to exist. Archiving does not
fabricate coverage: real mandatory-requirement coverage (`TDD_REQUIREMENT_UNCOVERED`) is computed independently of archive status and is unaffected,
so a requirement that genuinely still needs a passing test continues to be
reported as uncovered until a fresh, valid Red-Green cycle is recorded for
an authoritative verifying test ID.

This artifact is intended to be release-ready and self-contained; no
follow-up revision note is required to interpret the normative content
below.

## REQ-TDD-CYCLE-ARCHIVE-001: Archive regardless of the latest cycle's phase validity
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall allow `tdd archive <test-id>` to archive `<test-id>`'s latest recorded cycle whether or not that cycle's Red or Green phase is currently valid.
Acceptance: Given a test ID whose latest cycle has a valid Red and a valid Green phase, `tdd archive <test-id> --approver <name> --reason <text> --confirm` succeeds and records an archive payload for that cycle. Given a test ID whose latest cycle has an invalid Red, an invalid Green, or no Green phase recorded at all, `tdd archive <test-id> --approver <name> --reason <text> --confirm` likewise succeeds and records an archive payload for that cycle.

## REQ-TDD-CYCLE-ARCHIVE-002: Archive without requiring an earlier valid fallback cycle
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall allow `tdd archive <test-id>` to succeed whether or not `<test-id>` has any earlier recorded, non-voided, non-archived cycle with both a valid Red and a valid Green phase.
Acceptance: Given a test ID with exactly one recorded cycle (no earlier cycle of any kind), `tdd archive <test-id> --approver <name> --reason <text> --confirm` succeeds. Given a test ID whose only earlier cycles are themselves archived or voided, `tdd archive <test-id> --approver <name> --reason <text> --confirm` still succeeds, unaffected by the absence of a non-archived, non-voided fallback.

## REQ-TDD-CYCLE-ARCHIVE-003: Require an explicit human approver, reason, and confirmation
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `tdd archive <test-id>` is invoked without a non-empty `--approver` name, a non-empty `--reason` string, or the `--confirm` flag, then the system shall reject the invocation and record no evidence.
Acceptance: Omitting `--approver`, omitting `--reason`, omitting `--confirm`, or supplying an empty/whitespace-only `--approver` or `--reason` each exit nonzero with an error naming the missing/invalid option, and `.musubix/evidence/tdd.json`/`.musubix/evidence/order.json` are byte-identical before and after every such call.

## REQ-TDD-CYCLE-ARCHIVE-004: Reject archiving a cycle that already has a void or archive marker, and reciprocally reject voiding an already-archived cycle, checked after argument validation but before either command's own evidence-state preconditions
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `tdd archive <test-id>` is invoked with a non-empty `--approver`, a non-empty `--reason`, and `--confirm`, and `<test-id>`'s latest recorded cycle already carries any `void` or `archive` payload (whether validly linked or malformed), or if `tdd void <test-id>` is invoked with a non-empty `--approver`, a non-empty `--reason`, and `--confirm`, and `<test-id>`'s latest recorded cycle already carries any `archive` payload (whether validly linked or malformed), then the system shall reject the invocation before evaluating that command's own Green-validity or fallback-eligibility preconditions and record no evidence, so that a single cycle never carries both a void and an archive payload regardless of which command is tried first or second.
Acceptance: Given valid `--approver`/`--reason`/`--confirm`, calling `tdd archive <test-id>` immediately after a successful `tdd archive <test-id>` or a successful `tdd void <test-id>` for the same latest cycle, with no new cycle recorded in between, exits nonzero with an error stating the latest cycle already carries a void or archive marker, and both evidence files are byte-identical before and after the second call. Given valid `--approver`/`--reason`/`--confirm`, calling `tdd void <test-id>` against a latest cycle that already carries an `archive` payload — including one whose latest cycle also has a valid Green phase, which would otherwise be rejected first by `tdd void`'s existing valid-Green precondition — exits nonzero with the archive-marker error specifically (not the valid-Green error), and both evidence files are byte-identical before and after that call. Given an invocation that both omits a required `--approver`/`--reason`/`--confirm` option and targets a cycle that already carries the other command's marker, the missing-option error from REQ-TDD-CYCLE-ARCHIVE-003 (or `tdd void`'s own equivalent rule) is reported, not the marker error, since argument validation is still evaluated first. The archive-marker-first precedence over Green-validity/fallback preconditions applies regardless of whether the existing `archive` or `void` payload is validly linked or malformed: a malformed marker still blocks the other command exactly as a valid one does, and REQ-TDD-CYCLE-ARCHIVE-007 independently continues to report that marker's malformed linkage. Given a test ID whose archived (or voided) cycle is later followed by a fresh cycle, a subsequent `tdd archive <test-id>` or `tdd void <test-id>` evaluates against that new latest cycle and is not rejected solely because an earlier cycle for the same test ID was previously archived or voided. A cycle carrying any `archive` payload (valid or malformed) is also never selected as an earlier-cycle fallback candidate by `tdd void`'s own fallback-eligibility rule.

## REQ-TDD-CYCLE-ARCHIVE-005: Record the archive as a hash-chained, ordered, identity-bound evidence entry
Priority: must
Type: functional
Pattern: event-driven
Statement: When `tdd archive <test-id>` succeeds, the system shall append an `archive` payload (capturing the approver, reason, timestamp, `testId`, and `cycleId`) to the latest cycle for `<test-id>`, exactly one evidence-order entry stamped with that same `testId`/`cycleId`/`phase: "archive"`, and exactly one matching chain record stamped with that same `testId`/`cycleId`/`phase: "archive"` whose recorded hash covers that archive payload, without modifying, reordering, or deleting any existing phase evidence for `<test-id>` or any other test ID.
Acceptance: After a successful `tdd archive <test-id>`, the previously recorded `red`/`green`/`refactor`/`migrate`/`void` entries for every cycle of `<test-id>` are byte-identical to before the call; `.musubix/evidence/order.json` gains exactly one new record whose `phase` is `archive`, whose `testId`/`cycleId` match the archived cycle, and whose `sequence` is one greater than the previous maximum; the hash chain gains exactly one new chain record with `phase: "archive"`, matching `testId`/`cycleId`, whose `phaseEvidenceSha256` is computed from the archive payload and whose `previousSha256` matches the prior chain record's `recordSha256`; every other test ID's evidence is unchanged.

## REQ-TDD-CYCLE-ARCHIVE-006: Define valid archive linkage as unique, identity-bound, and hash-consistent
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall treat a cycle's `archive` payload as validly linked only when the monotonic evidence order log itself is valid, exactly one evidence-order record and exactly one chain record exist with `phase: "archive"` and that payload's `cycleId`, no other chain or order record declares `phase: "archive"` for that same `cycleId` under a different `testId`, the single matching chain/order record's `testId` equals that payload's `testId`, that chain record's `previousSha256` matches the prior chain record's `recordSha256`, and that chain record's `phaseEvidenceSha256` equals the recomputed hash of that exact archive payload.
Acceptance: Given an archive payload whose repository order log is invalid, whose matching chain/order records carry a different `testId` or `cycleId`, whose chain record has no matching order-log entry, for which more than one order record or chain record declares `phase: "archive"` for that `cycleId` (whether or not they share the same `testId`), or whose recomputed payload hash does not equal the chain record's `phaseEvidenceSha256`, linkage is invalid under this definition; only a payload with a valid order log and a single, identity-matched, hash-consistent chain and order record pair is validly linked. This holds even when exactly one chain record's `testId` happens to match the payload's `testId` while an additional conflicting chain record for the same `cycleId` under a different `testId` also exists: the conflicting record still invalidates linkage.

## REQ-TDD-CYCLE-ARCHIVE-007: Report malformed archive evidence without suppressing the cycle's own diagnostics
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a cycle's `archive` payload does not have valid linkage per REQ-TDD-CYCLE-ARCHIVE-006, then the system shall report a `tdd validate`/`gate` diagnostic naming that test ID's malformed archive evidence, in addition to every diagnostic that cycle would otherwise raise absent any `archive` payload.
Acceptance: Given a cycle with an `archive` payload that fails any condition of REQ-TDD-CYCLE-ARCHIVE-006 (missing/duplicate chain or order record, mismatched `testId`/`cycleId`, or mismatched hash), `tdd validate --json` still reports every diagnostic that cycle would raise absent any archive payload (for example `TDD_GREEN_MISSING` or `TDD_LEGACY_OR_UNSCOPED_EVIDENCE`), plus a diagnostic identifying the malformed archive evidence, and reports no other cycle-local stale-evidence diagnostic beyond those two categories — none that the cycle would not otherwise have raised absent the malformed archive payload; this acceptance criterion does not constrain the pre-existing cross-cycle chain/order-log integrity diagnostics (`TDD_CHAIN_*`, `TDD_ORDER_*`), which, per REQ-TDD-CYCLE-ARCHIVE-008, remain governed only by the generic hash-chain/evidence-order validation already applied uniformly to every recorded phase of every cycle, independent of archive status.

## REQ-TDD-CYCLE-ARCHIVE-008: Suppress stale-evidence diagnostics for a validly archived cycle, while leaving cross-cycle integrity checks active
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall not raise `TDD_RED_MISSING`, `TDD_GREEN_MISSING`, `TDD_LEGACY_OR_UNSCOPED_EVIDENCE`, `TDD_GREEN_WITHOUT_SOURCE_CHANGE`, `TDD_COMMAND_CHANGED`, or `TDD_TEST_STALE` for a cycle whose `archive` payload has valid linkage per REQ-TDD-CYCLE-ARCHIVE-006, while continuing, unaffected and unsuppressed, to raise `TDD_EVIDENCE_REUSED`, `TDD_DURATION_INVALID`, `TDD_ORDER_MIGRATION_REQUIRED`, `TDD_ORDER_MISMATCH`, `TDD_ORDER_SEQUENCE`, and every `TDD_CHAIN_*`/evidence-order-log diagnostic for that same cycle exactly as it would for any other recorded cycle, archived or not.
Acceptance: Given a test ID whose single recorded cycle has a valid Red and a valid Green but a Green/Red command mismatch, archiving that cycle suppresses its `TDD_COMMAND_CHANGED` and `TDD_GREEN_WITHOUT_SOURCE_CHANGE` diagnostics alongside its `TDD_RED_MISSING`/`TDD_GREEN_MISSING`/`TDD_LEGACY_OR_UNSCOPED_EVIDENCE` diagnostics. Given a test ID whose only recorded cycle has an invalid Green, archiving it suppresses `TDD_GREEN_MISSING` and `TDD_LEGACY_OR_UNSCOPED_EVIDENCE` for that cycle. Given a test ID's source annotation is later removed from the project entirely (for example after a rename), its archived cycle continues to raise no diagnostics in the suppressed set. Given an archived cycle's Red or Green phase evidence reuses the same structured-report hash as another test ID's phase evidence, `TDD_EVIDENCE_REUSED` is still reported for that reuse exactly as it would be for a non-archived cycle, and the same holds for a corrupted or out-of-order hash chain/evidence-order record on an archived cycle (`TDD_CHAIN_*`, `TDD_ORDER_*`, `TDD_DURATION_INVALID`): these are never suppressed by archive status.

## REQ-TDD-CYCLE-ARCHIVE-009: Preserve diagnostics for cycles that are not themselves validly archived or voided
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall continue to evaluate and report every otherwise-applicable diagnostic listed in REQ-TDD-CYCLE-ARCHIVE-008, without archive-based or void-based suppression, for every recorded cycle that is neither itself validly archived per REQ-TDD-CYCLE-ARCHIVE-006 nor validly voided under `tdd-cycle-void` nor already superseded under `tdd-superseded-cycle-scoping`.
Acceptance: Given a test ID with two recorded cycles where only the newest is archived, the older cycle's diagnostics (if any) remain fully reported and unaffected by the newer cycle's archive status; archiving one cycle never suppresses diagnostics for any other cycle, of that test ID or any other test ID.

## REQ-TDD-CYCLE-ARCHIVE-010: Leave mandatory-requirement coverage computation unaffected by archiving
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall compute TDD_REQUIREMENT_UNCOVERED for a mandatory requirement from the same valid-Red-and-valid-Green cycle criteria it already uses today, without treating a cycle's archive or void status as evidence of coverage either for or against that requirement.
Acceptance: Given a mandatory requirement whose only verifying test's only cycle has a valid Red and an invalid Green, archiving that cycle does not change `TDD_REQUIREMENT_UNCOVERED` reporting for that requirement: it remains reported as uncovered until a fresh cycle with a valid Red and a valid Green is recorded for an authoritative verifying test ID. Given a mandatory requirement whose verifying test's cycle has both a valid Red and a valid Green, archiving that cycle does not cause `TDD_REQUIREMENT_UNCOVERED` to newly appear for that requirement, since archive status is not consulted by that computation.

## REQ-TDD-CYCLE-ARCHIVE-011: Allow a fresh cycle to follow an archived cycle for the same test ID
Priority: must
Type: functional
Pattern: state-driven
Statement: While a test ID's latest recorded cycle is validly archived, the system shall allow a new Red phase to be recorded for that same test ID, evaluated independently of the archived cycle.
Acceptance: Given a test ID whose latest cycle is validly archived, `tdd red <test-id> --requirement <req-id> --command <name>` succeeds and records a new cycle; once that new cycle also records a valid Green, the earlier archived cycle is additionally recognized as superseded under `tdd-superseded-cycle-scoping`'s existing rule, and the new cycle is evaluated by every diagnostic in REQ-TDD-CYCLE-ARCHIVE-008/009 exactly as any other fresh cycle.

## REQ-TDD-CYCLE-ARCHIVE-012: Reject migrating an archived latest cycle
Priority: must
Type: functional
Pattern: state-driven
Statement: While a test ID's latest recorded cycle is validly archived, the system shall reject `tdd migrate <test-id>` and record no migration evidence, requiring a fresh Red-Green cycle under REQ-TDD-CYCLE-ARCHIVE-011 instead of extending the archived cycle.
Acceptance: Given a test ID whose latest cycle is validly archived, `tdd migrate <test-id> --approver <name> --confirm` exits nonzero with an error stating the latest cycle is archived and cannot be migrated, and `.musubix/evidence/tdd.json`/`.musubix/evidence/order.json` are byte-identical before and after the call. Given that same test ID subsequently records a fresh Red-Green cycle per REQ-TDD-CYCLE-ARCHIVE-011, `tdd migrate <test-id>` is evaluated against that new cycle exactly as it would be for any other test ID, unaffected by the earlier archived cycle.

## REQ-TDD-CYCLE-ARCHIVE-013: Surface scoped archive evidence in `tdd validate --json`
Priority: should
Type: functional
Pattern: event-driven
Statement: When `tdd validate --json` runs and a cycle has a validly linked archive payload, the system shall include exactly one top-level `archived` array entry for that cycle's own `cycleId` and `testId`, carrying an `archive` object whose `approver`, `reason`, and `recordedAt` are copied from the persisted archive payload.
Acceptance: `tdd validate --json` output contains exactly one `archived` array entry for the archived cycle's own `cycleId`/`testId`, and that entry's `archive.approver`, `archive.reason`, and `archive.recordedAt` exactly match the values persisted in that cycle's `archive` payload; no unarchived or malformed-archive cycle appears in the `archived` array.
