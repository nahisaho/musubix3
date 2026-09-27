---
schemaVersion: 1
id: CHANGE-0053
summary: Stabilize durable native test evidence across unchanged reruns
status: staged
---
# CHANGE-0053: stable-native-test-evidence

Requirements: REQ-NATIVE-TEST-EVIDENCE-STABILITY-001 REQ-NATIVE-TEST-EVIDENCE-STABILITY-002 REQ-NATIVE-TEST-EVIDENCE-STABILITY-003 REQ-NATIVE-TEST-EVIDENCE-STABILITY-004

## Intent

Prevent unchanged successful native test command reruns from rewriting tracked
durable evidence solely because the runner emitted new wall-clock timestamps or
timing measurements.

## Source

- GitHub Issue #48.
- Full-suite validation rewrites unrelated tracked native `aggregate` reports
  when only volatile runner telemetry changes.

## Classification

- Observable evidence-recording defect correction.

## Impact

- Add a canonical durable representation for successful native adapter reports.
- Preserve deterministic test identity, status, command, input fingerprint,
  process result, and adapter provenance while excluding volatile timing fields.
- Compute the input fingerprint from the current content of each reported
  trace-linked test and implementation path, and validate it on reread.
- Cover file, stdout, and directory native adapter sources by replacing their
  tracked aggregate output with one canonical record file after normalization.
- Limit this change to full-command `aggregate*` evidence; targeted TDD reports
  and volatile run envelopes in other evidence files retain their existing
  contracts.
- Continue to reject missing, malformed, failed, skipped, stale, or tampered
  evidence.
- Remove raw aggregate output after a non-successful command instead of leaving
  volatile tracked artifacts.
- Keep TDD freshness and deterministic performance operation counters
  fail-closed; elapsed time remains telemetry rather than performance proof.
- Add a regression that runs the same successful native command twice and
  asserts byte-identical durable evidence on the second run.

## Verification

- Approve requirements and design before Red.
- Record real failing Red evidence for every requirement.
- Run focused tests, typecheck, build, full tests, package checks, strict trace,
  Code Graph, changed and full gates, and status.

## Residual risks

- Raw native runner formats remain adapter-specific and may change between
  upstream tool versions; normalization must continue to reject unknown or
  malformed result shapes.
- Stable durable evidence deliberately excludes wall-clock and elapsed-time
  telemetry, so users needing such telemetry must obtain it from the runner or
  an explicitly non-durable channel.
- A reported TEST ID without a trace node remains in semantic results but
  contributes no source path. An aggregate containing only such IDs therefore
  has the canonical empty input fingerprint; model-correspondence still
  requires its own traced authoritative test, and native adapters cannot supply
  deterministic performance operation counters.
- Feature-scoped gate filters unrelated trace diagnostics. Duplicate TEST IDs
  outside that feature remain detectable by full strict trace/gate validation,
  not by the aggregate fingerprint projection alone.
- Adapter runners are expected to resolve generated report arguments against
  their process working directory; a runner-specific alternate root fails
  closed as a missing raw report rather than producing durable evidence.
- Project-global trace generation still updates generated trace metadata on
  reruns; stabilizing or scoping trace generation remains outside CHANGE-0053
  and is tracked separately from native aggregate evidence.
