---
schemaVersion: 1
id: CHANGE-0027
summary: Complete Windows CI cross-feature portability coverage
status: staged
---
# CHANGE-0027: windows-ci-cross-feature-coverage

Requirements: REQ-CHANGE-QUALITY-REFRESH-002 REQ-EVIDENCE-HISTORY-MERGE-001 REQ-EVIDENCE-HISTORY-MERGE-002 REQ-EVIDENCE-HISTORY-MERGE-003 REQ-EVIDENCE-HISTORY-MERGE-005 REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-005 REQ-NPM-AUDIT-REMEDIATION-002 REQ-RELEASE-ASSET-PUBLISHING-004

## Intent

Complete the requirement and regression coverage for the cross-feature Windows
failures that share the fixes introduced by CHANGE-0026.

## Classification

- Specification refinement: require one shared native canonical-root resolver
  across all writer, reader, and incoming-root coordination paths without
  changing persisted canonical paths or lock locations.
- Specification refinement: apply the reviewed LF checkout identity to npm
  audit and release-publishing evidence.
- Defect correction without additional behavior change: make merge recovery
  fixtures exercise their declared platform model deterministically.

## Impact

- Cover the evidence-history merge behaviors that failed after their fixture
  setup lost writer ownership on Windows.
- Cover Quality refresh rejection behavior that failed at its shared staging
  file synchronization boundary.
- Cover writer-lock and merge-recovery integration with an injected successful
  strict sync when the fixture simulates Linux on a Windows host.
- Cover the audited lockfile and protected publishing workflows under the
  repository-wide LF checkout rule.
- Add explicit test IDs and requirement links to the merge-recovery regression
  cases that previously relied on inferred coverage.

## Verification

- `npm run typecheck`, `npm run build`, `npm test`, and `npm run pack:check`
  completed successfully; the final full suite reported 553 passed and 8
  skipped tests.
- The focused portability run passed 50 tests across the Windows portability,
  writer-lock, release-approval, and merge-recovery suites.
- Recovery TEST-EVIDENCE-HISTORY-MERGE-006, -007, and -008 are included in
  the structured merge command and passed.
- Strict trace and graph gates passed. CHANGE-0027 Quality evidence was
  recorded for the complete requirement set.
- The shared portability test covers several requirements while persisted TDD
  cycles scope one requirement at a time. Human-approved bounded waivers record
  that evidence-ordering limitation; they do not waive test failures or
  implementation checks.
- A real Windows Core runner has not yet executed this uncommitted correction;
  Windows CI validation remains pending until the PR branch is pushed.

## Residual risks

- CHANGE-0026 and CHANGE-0027 are one corrective delivery but retain separate
  immutable requirement sets because CHANGE-0026 impact evidence was already
  recorded before the additional cross-feature failures were classified.
- The production directory-sync errno-policy gap remains tracked by #43.
