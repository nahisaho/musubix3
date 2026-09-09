---
schemaVersion: 1
id: CHANGE-0005
summary: Fix nested-test TDD fingerprint scoping and migrate superseded stored fingerprints
status: in-progress
---
# CHANGE-0005: TDD fingerprint scoping fix and stored-evidence migration

Requirements: REQ-TDD-FINGERPRINT-SCOPING-001 REQ-TDD-FINGERPRINT-MIGRATION-001

## Intent

Resolve GitHub Issue #1 item 2: `testFingerprint()` scoped a nested test's hash
using a comment-marker-to-EOF fallback that conflated the test's own boundary
with its neighbors', producing `TDD_TEST_STALE` false positives whenever a
sibling test was appended after it in a shared `describe(...)` block. Fix the
scoping to use a full-AST statement walk, and provide an explicit,
human-approved, append-only mechanism to migrate cycles whose stored
fingerprint was computed under the superseded algorithm, without fabricating
a new Red/Green execution for untouched, working tests.

## Scope

- `REQ-TDD-FINGERPRINT-SCOPING-001`: scope a test's fingerprint to exactly its
  own AST declaration regardless of nesting depth, preserving existing
  fingerprint values for top-level and non-source tests.
- `REQ-TDD-FINGERPRINT-MIGRATION-001`: append a `migrate` chain phase that
  updates a cycle's effective fingerprint to the corrected algorithm's output,
  only when recomputing the superseded algorithm against current source still
  matches the currently stored fingerprint; refuse otherwise.
- Applied `tdd migrate` to the 16 cycles Issue #1's evidence-debt review
  flagged as newly stale after the scoping fix: 11 migrated cleanly
  (`TEST-HUMAN-APPROVAL-GATES-001`–`008`, `TEST-SESSION-SCOPED-DEVELOPMENT-002`,
  `TEST-WORKFLOW-SHUTDOWN-001`, `TEST-CLI-WORKFLOW-UX-006`); 5 were refused by
  design (`TEST-CLI-WORKFLOW-UX-001`–`005`) because their legacy fingerprint
  was itself recorded against shorter, earlier file text before later sibling
  tests were appended, so the superseded-algorithm safety check cannot
  reproduce it from current text. Closing those 5 requires a genuine future
  Red/Green cycle on that feature, not evidence migration.

## Other impacts

- `ADR-0008` (scoping fix) and `ADR-0009` (migration mechanism) record the
  rejected alternatives and consequences, including this residual.
- GitHub Issue #1 is updated with the corrected root-cause finding and the
  remaining 5-cycle residual.
