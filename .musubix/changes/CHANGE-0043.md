---
schemaVersion: 1
id: CHANGE-0043
summary: Correct directory-sync policy TDD chronology
status: staged
---
# CHANGE-0043: transaction-directory-sync-policy-corrective-evidence

Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001

## Intent

Add discriminating host-independent assertions to the two changed Windows
portability tests and record their reviewed Red/Green evidence after
CHANGE-0042's immutable Red checkpoint.

## Classification

- Corrective test and evidence change; approved runtime behavior is unchanged.

## Impact

- Reuse the approved requirement text unchanged and record the requirements
  phase with the defect-correction `--allow-unchanged` mechanism.
- Extend TEST-WINDOWS-CORE-PORTABILITY-003 and
  TEST-WINDOWS-CORE-PORTABILITY-004 so each rejects the same `EPERM` sync error
  under an injected non-Windows platform.
- Reenact the superseded broad cross-platform suppression only long enough to
  obtain genuine focused Red, restore the approved implementation, and record
  Green.
- Record independent Red/Green cycles for both portability test IDs, clearing
  their unwaivable `TDD_TEST_STALE` diagnostics.
- After corrective Quality, waive only CHANGE-0042's immutable
  `CHANGE_TEST_CHANGED_AFTER_RED` chronology diagnostic.

## Verification

- After recording the corrective design phase, finalize the two portability
  tests, then record focused Red/Green for
  TEST-WINDOWS-CORE-PORTABILITY-003 and
  TEST-WINDOWS-CORE-PORTABILITY-004 against
  REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001.
- Record Red for both tests while the reenactment is present, restore the
  approved implementation once, record the change implementation phase, then
  record Green for both tests.
- Reenact the prior helper catch that accepted
  `EISDIR`, `EPERM`, `EACCES`, and `EINVAL` without a platform check, while
  preserving the current three-argument signatures and trace annotations.
  Reproduce only the old catch predicate and combined suppression boundary; do
  not copy the old two-argument signature. The original predicate is recoverable
  from base commit `83544c3` in
  `packages/analysis/src/quality-refresh.ts` and
  `packages/analysis/src/evidence-merge.ts`.
- Confirm the restored implementation fingerprint exactly matches the
  CHANGE-0042 Quality implementation fingerprint before recording Green.
- Re-run typecheck, build, full tests, package checks, strict trace, Code Graph,
  changed gate, and status.

## Residual risks

- The corrective Red is an explicit temporary reenactment and is not a claim
  that CHANGE-0042 originally followed test-first chronology.
- CHANGE-0043 currently has a non-blocking recordedAt/order warning because
  wall-clock capture does not establish chronology; persisted order remains
  authoritative.
- DES-TRANSACTION-DIRECTORY-SYNC-POLICY-005 was initially drafted before the
  corrective impact checkpoint; the reviewed post-requirements design edit and
  persisted design phase provide the authoritative checkpoint.
