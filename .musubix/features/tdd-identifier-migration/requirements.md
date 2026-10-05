---
schemaVersion: 1
feature: tdd-identifier-migration
---
# TDD identifier-only evidence migration for renamed tests

## Context
`REQ-TDD-FINGERPRINT-MIGRATION-001` already defines `tdd migrate <test-id>`
for one narrow case: the stored fingerprint algorithm changed while the test's
current source still matches the cycle's recorded fingerprint under the
superseded algorithm. GitHub Issue #57 proposal (1) describes a different,
legitimate correction that still fails today: a test keeps the same assertions,
behavior, and implementation-under-test coverage, but its authoritative
identifier is renamed (for example `TEST-OLD-001` to `TEST-NEW-001`). That
rename leaves the old cycle attached to a no-longer-authoritative ID and makes
the new ID appear uncovered, even though no observable behavior changed.

This feature extends `tdd migrate` with an explicit two-ID mode for that pure
rename case while preserving the existing one-ID fingerprint-migration mode.
The new mode must remain auditable and fail closed: it may only relink evidence
when the old cycle is already covered, the cycle's non-test `sourceFingerprint`
is unchanged, the new declaration differs from the old one only in the
identifier-bearing tokens that name the test, and the current trace contains no
still-authoritative `<old-id>` declaration at that preserved path/context. For
this feature, those allowed rename tokens are limited to the authoritative
`@id TEST-*` annotation and the the exact adapter-matched test identity string that
carry that same TEST-* identifier; every executable statement, assertion,
helper call, and every other annotation or literal must remain byte-identical,
and the test must stay in the same test file path.
The authoritative rename-only baseline is `<old-id>`'s current effective
fingerprint/effective evidence state, using the same precedence already used
for stale-evidence validation (latest valid `migrate` fingerprint when present,
otherwise the latest valid Refactor or Green fingerprint). Migration must
normalize the current `<new-id>` declaration by rewriting only those allowed
rename tokens back from `<new-id>` to `<old-id>` and then compare the
resulting fingerprint to `<old-id>`'s current effective fingerprint. The two-ID
mode inherits the existing `tdd migrate` target-cycle selection rules: it
rejects an archived latest cycle and, when the latest cycle is validly voided,
it reroutes to the same earlier effective cycle that the one-ID mode already
uses.

## REQ-TDD-IDENTIFIER-MIGRATION-001: Preserve the existing one-ID fingerprint-migration mode
Priority: must
Type: functional
Pattern: state-driven
Statement: While `tdd migrate` is invoked with exactly one positional test ID, the system shall preserve the stored-fingerprint migration behavior defined by `REQ-TDD-FINGERPRINT-MIGRATION-001`.
Acceptance: Given a cycle whose stored fingerprint still matches the superseded fingerprint algorithm, `tdd migrate TEST-EXAMPLE-001 --approver <name> --confirm` succeeds without requiring a second ID and appends only fingerprint-migration evidence for `TEST-EXAMPLE-001`, not identifier-relink evidence to any different test ID. Given a cycle whose stored fingerprint no longer matches the superseded fingerprint algorithm, `tdd migrate TEST-EXAMPLE-001 --approver <name> --confirm` refuses migration and leaves `.musubix/evidence/tdd.json` and `.musubix/evidence/order.json` byte-identical before and after the call. Invocations with zero positional IDs or more than two positional IDs exit nonzero with a usage error and record no evidence.

## REQ-TDD-IDENTIFIER-MIGRATION-002: Relink covered evidence across an identifier-only rename without recording a fresh Red or Green phase
Priority: must
Type: functional
Pattern: event-driven
Statement: When `tdd migrate <old-id> <new-id> --approver <name> --confirm` is invoked under pure-rename conditions, the system shall relink already-covered evidence from `<old-id>` to `<new-id>` without recording a fresh Red or Green phase.
Acceptance: Given a repository where `TEST-OLD-001` is the requirement's sole authoritative covering test with a valid Red-Green cycle, the authoritative `@id TEST-*` annotation and the exact adapter-matched test identity string are renamed from `TEST-OLD-001` to `TEST-NEW-001`, the test stays in the same test file path, the current trace contains exactly one surviving authoritative declaration there under `TEST-NEW-001` and none under `TEST-OLD-001`, every executable statement, assertion, helper call, and every other annotation or literal remains byte-identical, and replacing only those two identifier-bearing fields back from `TEST-NEW-001` to `TEST-OLD-001` reproduces `TEST-OLD-001`'s current effective fingerprint, no non-test evidence input contributing to the cycle's `sourceFingerprint` changed, and `TEST-NEW-001` has no prior cycle, `tdd migrate TEST-OLD-001 TEST-NEW-001 --approver <name> --confirm` succeeds. After that success, `tdd validate --json` and `gate --json` report neither `TDD_TEST_STALE` for the old/new rename nor any `TDD_REQUIREMENT_UNCOVERED` diagnostic naming the verified requirement solely because of that rename, and no new `red` or `green` phase is appended for either ID.

## REQ-TDD-IDENTIFIER-MIGRATION-003: Reject identifier migration whenever a rename-only precondition is false
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If any rename-only precondition for `tdd migrate <old-id> <new-id>` is false, then the system shall reject the invocation and record no migration evidence.
Acceptance: Each of the following leaves `.musubix/evidence/tdd.json` and `.musubix/evidence/order.json` byte-identical before and after the call, and exits nonzero with an error that names the blocking condition: invoking `tdd migrate TEST-OLD-001 TEST-OLD-001 --approver <name> --confirm`; invoking `tdd migrate TEST-OLD-001 TEST-NEW-001 --approver <name> --confirm` when `TEST-OLD-001` lacks a valid latest effective Green; when `TEST-OLD-001`'s latest cycle is archived; when a still-authoritative `TEST-OLD-001` declaration remains or the current trace contains anything other than exactly one surviving authoritative declaration at that path/context under `TEST-NEW-001`; when `TEST-NEW-001`'s current test body adds, removes, or changes any assertion or executable statement beyond the rename tokens; when the test moved to a different file path; when replacing only the `@id TEST-*` annotation text plus the exact adapter-matched test identity string from `TEST-NEW-001` back to `TEST-OLD-001` does not reproduce `TEST-OLD-001`'s current effective fingerprint; when any non-test evidence input contributing to the old cycle's `sourceFingerprint` changed; when `TEST-NEW-001` already has a recorded cycle; or when the same old cycle was already relinked to a different new ID. Given a latest cycle that is validly voided but has an earlier effective valid cycle, `tdd migrate TEST-OLD-001 TEST-NEW-001 --approver <name> --confirm` evaluates the rename-only preconditions against that same earlier effective cycle instead of the voided latest cycle.

## REQ-TDD-IDENTIFIER-MIGRATION-004: Append identity-bound migration evidence without mutating prior cycle evidence
Priority: must
Type: functional
Pattern: event-driven
Statement: When identifier migration succeeds, the system shall append a human-approved, identity-bound migration record that carries at least the old test ID, the new test ID, the target cycle ID, the approver, and the recorded timestamp, participates in the same append-only order and hash-chain validation model as existing `tdd migrate` evidence, and leaves the old cycle's recorded Red, Green, and Refactor payloads unchanged and unrelated test IDs unaffected.
Acceptance: After a successful `tdd migrate TEST-OLD-001 TEST-NEW-001 --approver <name> --confirm`, the pre-existing Red/Green/Refactor payloads for `TEST-OLD-001` are byte-identical to their pre-call values, `.musubix/evidence/tdd.json` and `.musubix/evidence/order.json` grow monotonically rather than shrinking or rewriting prior entries, the appended migrate evidence identifies `TEST-OLD-001`, `TEST-NEW-001`, the target cycle, the approver, and the recorded timestamp, `tdd validate --json` reports no malformed migrate-evidence diagnostic for that relink, and no unrelated test ID's recorded evidence changes. A second identical relink attempt, or a conflicting attempt to relink the same covered old cycle to some other `TEST-NEW-XYZ`, is rejected and records nothing. A later unrelated requirement with no migrated pair continues to report the same TDD coverage diagnostics it would have reported had this migration never occurred.

## REQ-TDD-IDENTIFIER-MIGRATION-005: Document both supported `tdd migrate` invocation forms where operators look for migrate usage
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall document both supported `tdd migrate` invocation forms — `tdd migrate <test-id>` and `tdd migrate <old-id> <new-id>` — in `tdd migrate --help` and in the README's `tdd migrate` command reference.
Acceptance: Running `npx musubix3 tdd migrate --help` prints text matching both `/tdd migrate <test-id>/` and `/tdd migrate <old-id> <new-id>/`. The README's `tdd migrate` command reference row (or an adjacent paragraph it directly references) contains the literal substrings `tdd migrate <test-id>` and `tdd migrate <old-id> <new-id>`, and distinguishes the one-ID fingerprint-migration mode from the two-ID identifier-relink mode.
