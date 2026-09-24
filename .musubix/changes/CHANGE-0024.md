---
schemaVersion: 1
id: CHANGE-0024
summary: Restore cross-platform evidence writer lock CI
status: staged
---
# CHANGE-0024: evidence-writer-lock-platform-compatibility

Requirements: REQ-EVIDENCE-WRITER-LOCK-001

## Intent

Fix GitHub Issue #40 so the evidence writer lock preserves atomic publication
and file durability without treating Windows' unsupported directory `fsync` as
a lock-acquisition failure.

## Classification

- Behavior correction: revise REQ-EVIDENCE-WRITER-LOCK-001 to define the narrow
  Windows directory-sync capability boundary.
- Defect correction without specification change: align the macOS integration
  assertion with REQ-EVIDENCE-WRITER-LOCK-004, which already requires
  `EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE` on unsupported recovery platforms.
- The platform-specific recovery expectation is restated in REQ-001 because
  TEST-EVIDENCE-WRITER-LOCK-017 verifies both REQ-001 and unchanged REQ-004;
  release and recovery semantics otherwise remain owned by REQ-004.

## Impact

- Keep staging-file `fsync`, atomic hard-link publication, metadata validation,
  and fail-closed error handling mandatory on every platform.
- Suppress only Windows `EPERM`, `EINVAL`, and `ENOTSUP` raised by directory
  handle synchronization after the protected mutation has otherwise succeeded.
- Apply the same narrow policy after lock publication and verified release;
  recovery removal remains reachable only on platforms with the required
  recovery probes and continues to require successful directory sync.
- Revise DES-EVIDENCE-WRITER-LOCK-001 to narrow the durability-failure rule and
  add injectable platform and directory-synchronization dependencies.
- Extend DES-EVIDENCE-WRITER-LOCK-005 with deterministic suppressed and
  non-suppressed directory-sync tests plus platform-specific recovery
  expectations.
- Update the REQ-EVIDENCE-WRITER-LOCK-001 operator documentation in README.md,
  README-ja.md, and command help, with an explicit documentation-coverage test.
- Return the existing Windows and macOS Core matrix jobs to green; no workflow
  definition changes are required.

## Assumptions

- Node.js does not expose a Windows directory handle mode that makes
  `fsync`/`FlushFileBuffers` portable for this use.
- The closed allowlist is based on the observed `windows-latest` `EPERM` failure
  plus Node's unsupported-operation mappings `EINVAL` and `ENOTSUP`; any other
  observed errno remains fail-closed and requires a new requirements change
  rather than silent broadening. Diagnostics retain the underlying errno.
- Atomic hard-link publication and staging-file synchronization remain
  available and mandatory on supported Windows runners.
- Every non-Windows platform continues to require successful directory
  synchronization; this is a required successful filesystem call, not a claim
  that every operating system exposes identical media-flush guarantees.

## Verification

- Requirements approval recorded for manifest
  `89819d6d76d46d3a1e6fa7d16197104fb011b50205540bcbb9172c013150466a`.
- Design approval recorded for manifest
  `c8638ea3ebcbf6f627afde76e17f7689e231aabc2cef24afe1978b32fbcfd9bc`.
- TEST-EVIDENCE-WRITER-LOCK-024 recorded a real failing Red followed by Green
  for Windows publication/release directory-sync capability handling.
- TEST-EVIDENCE-WRITER-LOCK-017 now confirms the platform-specific recovery
  diagnostic, and TEST-EVIDENCE-WRITER-LOCK-025 verifies both README files and
  command help.
- `npm run typecheck`, `npm run build`, and `npm run pack:check` pass.
- The full Vitest run passes 547 tests with 8 intentional skips across 52 test
  files; the adapter integration file remains environment-gated.
- Trace strict checking and graph gating pass with zero trace errors or cycles.
  The changed quality gate passes every required check except the intentionally
  stale release approval, which must be renewed for this release candidate.
- Windows and macOS GitHub Actions confirmation remains pending until the
  approved release candidate is committed and pushed to PR #39.

## Residual risks

- Windows cannot provide the same directory-entry durability guarantee as
  platforms that support directory `fsync`; a crash after a suppressed
  post-release directory sync can resurrect an already released lock on a
  platform where automatic recovery is unsupported, requiring documented
  manual inspection and targeted removal. The policy remains fail-closed for
  every other publication, release, and recovery-removal failure.
