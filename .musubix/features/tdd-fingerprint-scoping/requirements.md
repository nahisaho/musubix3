---
schemaVersion: 1
feature: tdd-fingerprint-scoping
---
# TDD per-test fingerprint scoping

Source: GitHub Issue #1 (v0.1.10 evidence-debt investigation) — cycles
`TEST-CLI-WORKFLOW-UX-001` through `005` reported `TDD_TEST_STALE` even though
none of these tests' own bodies changed. Root cause: `testFingerprint()` in
`packages/analysis/src/tdd.ts` falls back, for tests nested inside a shared
`describe()` block, to slicing the test file from the current test's leading
`@id TEST-` comment up to the *next* such comment (or end of file). Adding or
removing a sibling test in the same file shifts that boundary, so an
unrelated test's fingerprint changes even though its own declaration is
byte-for-byte identical.

## REQ-TDD-FINGERPRINT-SCOPING-001: Scope test fingerprints to the test's own declaration
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall compute a test's TDD fingerprint from exactly that test's own leading trace-annotation comment and call-expression declaration (e.g. the `it(...)`/`test(...)` call it annotates), excluding the content of any other test declared in the same file, while preserving current fingerprint computation for a test declared as a top-level statement and for tests in non-source (comment-marker-delimited) files, where no other test's boundary can be conflated with the target test's own declaration.
Acceptance: Given a test file containing two or more annotated tests declared inside a shared `describe(...)` block, adding a new test after an existing one, or editing an unrelated sibling test's body, does not change the fingerprint computed for the untouched test; `gate`/`tdd check` reports no `TDD_TEST_STALE` for a cycle whose annotated test declaration is unchanged. Existing passing TDD cycles for tests declared as top-level statements, and for tests in non-source test-report/markdown-style files bounded by `@id TEST-` markers, continue to compute the same fingerprint value as before this change, given unchanged source text.
