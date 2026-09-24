---
schemaVersion: 1
id: CHANGE-0026
summary: Correct Windows Core CI portability failures
status: staged
---
# CHANGE-0026: windows-core-ci-portability

Requirements: REQ-CHANGE-QUALITY-REFRESH-001 REQ-EVIDENCE-HISTORY-MERGE-004 REQ-EVIDENCE-WRITER-LOCK-003 REQ-EVIDENCE-WRITER-LOCK-004 REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002 REQ-NPM-AUDIT-REMEDIATION-001 REQ-RELEASE-APPROVAL-ORDERING-003

## Intent

Correct the Windows-only implementation and test-fixture defects exposed by the
first pull-request CI run after CHANGE-0024 and CHANGE-0025, while making the
Windows canonical-root identity and LF byte-review boundaries explicit.

## Classification

- Specification refinement: require LF checkout bytes for tracked text whose
  SHA-256 is reviewed as evidence.
- Defect correction without specification change: preserve the existing file
  durability, recovery, merge coordination, and release-approval behavior.

## Impact

- Add a dedicated transaction-file sync helper that opens staging files with a
  Windows-compatible writable handle; keep directory sync on its separate
  read-only handle and existing error policy.
- Use one injectable native canonical-root resolver for acquisition, lease-map
  lookup, and nested guards; preserve owner metadata, lock paths, and
  different-root isolation.
- Make simulated Linux recovery tests inject successful strict directory sync
  instead of invoking an unsupported Windows directory operation.
- Enforce LF checkout for all tracked text so reviewed source-byte and
  package-lock digests are platform-independent.
- Remove case-insensitive `npm_execpath` collisions from the release CLI test
  fixture so its injected npm executable is deterministic on Windows.
- Add focused deterministic regression coverage for each corrected boundary.

## Verification

- `npm run typecheck`, `npm run build`, `npm test`, and `npm run pack:check`
  completed successfully; the final full suite reported 553 passed and 8
  skipped tests.
- The focused portability run passed 50 tests across the Windows portability,
  writer-lock, release-approval, and merge-recovery suites.
- The GitHub Actions workflow-byte and npm lockfile-byte policy checks passed.
- Strict trace and graph gates passed. CHANGE-0026 Quality evidence was
  recorded for the complete requirement set.
- The shared portability test covers several requirements while persisted TDD
  cycles scope one requirement at a time. Human-approved bounded waivers record
  that evidence-ordering limitation; they do not waive test failures or
  implementation checks.
- A real Windows Core runner has not yet executed this uncommitted correction;
  Windows CI validation remains pending until the PR branch is pushed.

## Residual risks

- The fixes intentionally preserve fail-closed recovery, production
  directory-sync execution, and byte-level review checks; they do not weaken
  those policies to accommodate Windows.
- The pre-existing cross-platform directory-sync errno policy in Quality
  refresh and evidence merge is outside this file-handle correction and is
  tracked by #43 rather than silently changed here.
