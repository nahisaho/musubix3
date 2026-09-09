---
schemaVersion: 1
feature: tdd-fingerprint-migration
---
# TDD stored-fingerprint algorithm migration

## Context
`REQ-TDD-FINGERPRINT-SCOPING-001` corrected how `testFingerprint` scopes a
nested test's hashed byte range. That correction is retroactive: every
already-recorded cycle whose test is nested inside a shared `describe(...)`
block now computes a different fingerprint than the one stored at its last
passing phase, even though the test's own declaration text never changed.
Recording a fresh Red phase for those cycles would fabricate a failure in
untouched, working features, which the constitution's TDD evidence rules
forbid. This feature adds a narrow, explicit, human-approved operation that
moves a cycle's stored fingerprint onto the new algorithm's output without
claiming a new Red/Green execution occurred.

## REQ-TDD-FINGERPRINT-MIGRATION-001: Explicit human-approved fingerprint algorithm migration
Priority: must
Type: functional
Pattern: event-driven
Statement: When an operator requests fingerprint migration for a TDD cycle and recomputing the superseded fingerprint algorithm against the test's current source text still yields the cycle's currently stored fingerprint, the system shall append an immutable, human-approved chain record updating the cycle's effective fingerprint to the value produced by the current algorithm.
Acceptance: Given a cycle whose stored fingerprint matches what the superseded algorithm computes from the test's current, unedited source, running the migration command with an explicit approver and confirmation appends a chain-linked migration record and `tdd validate`/`gate` subsequently report the cycle as non-stale without any new Red or Green phase being recorded. Given a cycle whose stored fingerprint does NOT match the superseded algorithm's recomputation (real drift, not just an algorithm change), the migration command refuses to record a migration and the cycle continues to report `TDD_TEST_STALE`, requiring a genuine Red/Green cycle instead. The migration record is rejected by evidence validation if it is not linked into the append-only hash chain in monotonic order, matching the existing chain integrity rules for Red/Green/Refactor phases.
