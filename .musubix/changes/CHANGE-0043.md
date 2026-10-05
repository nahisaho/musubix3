# CHANGE-0043: Add identifier-only TDD evidence migration for renamed tests

Requirements: REQ-TDD-IDENTIFIER-MIGRATION-001, REQ-TDD-IDENTIFIER-MIGRATION-002, REQ-TDD-IDENTIFIER-MIGRATION-003, REQ-TDD-IDENTIFIER-MIGRATION-004, REQ-TDD-IDENTIFIER-MIGRATION-005, REQ-TDD-ADOPTION-WARNING-002

## Summary
GitHub Issue #57 proposal (1) reports a disproportionate failure mode in the
existing TDD evidence model: when a test's authoritative identifier is renamed
without changing the test body, assertions, or implementation under test, the
stored Red/Green evidence goes stale even though observable behavior has not
changed. Today the only sanctioned recovery is a fresh Red/Green cycle or a
waiver.

This change adds an audited identifier-migration path to `tdd migrate` so a
pure rename can relink existing evidence from `<old-id>` to `<new-id>` without
fabricating a new Red or Green execution. The requirements also preserve the
existing one-argument fingerprint-migration mode, define the refusal cases for
non-rename drift or conflicting evidence, add dedicated `tdd migrate` usage
documentation for both invocation forms, and update the adoption-warning text
so it no longer describes `tdd migrate` as only a re-fingerprinting command.
The changed pre-existing normative ID in scope is `REQ-TDD-ADOPTION-WARNING-002`,
included solely to keep its existing `tdd migrate` wording accurate after
proposal (1); `REQ-TDD-FINGERPRINT-MIGRATION-001` remains an unchanged
behavioral dependency of the preserved one-ID mode. This change does not
broaden the adoption-warning feature's separate project-wide behavior.

