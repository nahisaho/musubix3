---
schemaVersion: 1
feature: native-test-evidence-stability
---
# Stable durable native test evidence

Source: GitHub Issue #48. Native adapter reports such as Vitest JSON include
wall-clock `startTime`, assertion durations, and other volatile telemetry.
`gate` currently stores that raw report under tracked
`.musubix/evidence/native/**/aggregate*` paths, so an unchanged successful
validation rerun changes durable evidence bytes, creates review noise, and
invalidates approval manifests without a semantic test-result change.

## Scope

- Durable native aggregate evidence means only
  `.musubix/evidence/native/<command>/aggregate*` produced by full configured
  command execution. Targeted TDD reports at `<testId>*` and existing
  `tdd.json` `reportSha256` semantics are unchanged. User-configured
  `command.testReport.path` reports are already required to use the
  `musubix-json` semantic schema and are outside this native-adapter change.
- File, stdout, and directory adapter sources are all in scope. After a
  successful execution, each durable aggregate path is a single canonical
  record file; raw adapter files, directories, and telemetry are not retained
  at that tracked path.
- Volatile run envelopes in `performance.json`, `model-correspondence.json`,
  and `quality.json` are outside this change. Their existing semantic head
  projections and validation rules remain unchanged.

## REQ-NATIVE-TEST-EVIDENCE-STABILITY-001: Unchanged native reruns preserve durable evidence bytes
Priority: must
Type: functional
Pattern: event-driven
Statement: When an unchanged native test command succeeds, the system shall preserve byte-identical durable native aggregate evidence.
Acceptance: Given fixture commands covering file, stdout, and directory native adapter source kinds whose two successful executions report the same annotated tests and statuses but different start times, end times, assertion durations, raw filenames, or equivalent volatile telemetry, running `gate` twice leaves each command's tracked `.musubix/evidence/native/**/aggregate*` path as the same single canonical file whose bytes after the second run are identical to the bytes written by the first run.

## REQ-NATIVE-TEST-EVIDENCE-STABILITY-002: Canonical evidence preserves semantic execution provenance
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall represent durable native aggregate evidence as a deterministic canonical record that preserves the command identity, command arguments digest, repository-input fingerprint, adapter, source kind, configured report path, process completion status, exit code, and every normalized test identity and its pass, fail, skip, or error status.
Acceptance: Given a successful native adapter execution, its durable aggregate evidence parses as the documented canonical schema, contains the configured command name, a valid command digest, the adapter, source kind, configured report path, `completed` process status, exit code zero, and normalized tests sorted deterministically by test ID. The repository-input fingerprint is the digest of canonical sorted entries containing every reported TEST ID's resolved trace test path and production-code paths connected either directly through the test's `verifies` requirement and a code `implements` edge, or through a design node that `satisfies` that requirement and a code `implements` edge, together with each path's current content SHA-256. A reported TEST ID without a trace test node in the built graph remains in the canonical test results but contributes no input path; duplicate or malformed annotations remain trace-validation errors. `.musubix/evidence/**`, generated artifacts, logs, skills, and unrelated paths are excluded. Changing any retained semantic field changes the durable bytes.

## REQ-NATIVE-TEST-EVIDENCE-STABILITY-003: Volatile telemetry is not durable semantic proof
Priority: must
Type: non-functional
Pattern: ubiquitous
Statement: The system shall exclude wall-clock timestamps, elapsed durations, and adapter-specific volatile timing telemetry from tracked durable native aggregate evidence and its validation digest.
Acceptance: The canonical durable native aggregate schema has no wall-clock or elapsed-duration field, two raw reports differing only in such telemetry produce identical durable bytes and digest, and deterministic performance requirements still require declared operation counters rather than elapsed time.

## REQ-NATIVE-TEST-EVIDENCE-STABILITY-004: Downstream validation remains fail-closed
Priority: must
Type: functional
Pattern: event-driven
Statement: When a validator consumes durable native aggregate evidence, the system shall reject evidence that is missing, malformed, stale, command-mismatched, source-mismatched, unsuccessful, skipped, failed, error, or tampered.
Acceptance: The canonical aggregate is the report re-read by performance and model-correspondence validation, and it reproduces the recorded digest and normalized tests without regeneration after an unchanged rerun. Every consumer recomputes the trace-resolved repository-input path set and content fingerprint from the current worktree, using a supplied current trace graph or building one when none is supplied; missing trace context never skips the check. A changed path set or fingerprint reports stable `NATIVE_TEST_EVIDENCE_SOURCE_MISMATCH`; command or schema mismatches report stable `NATIVE_TEST_EVIDENCE_COMMAND_MISMATCH` or `NATIVE_TEST_EVIDENCE_SCHEMA`. Downstream rejection may additionally use existing `TEST_REPORT_MISSING`, `TEST_REPORT_INVALID`, `PERFORMANCE_REPORT_TAMPERED`, `PERFORMANCE_REPORT_MISMATCH`, or `MODEL_CORRESPONDENCE_TEST_NOT_PASSED` diagnostics. After a native adapter process does not complete, exits non-zero, or fails normalization or canonicalization, its tracked durable aggregate path is absent and no raw adapter output remains at either the tracked durable path or its raw cache path. An exit-zero normalized report retains failed, skipped, or error test statuses in canonical evidence, which policy and downstream validation then reject. Deterministic operation-counter evidence and TDD fingerprints remain required and validated.
