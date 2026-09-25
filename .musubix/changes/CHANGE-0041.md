---
schemaVersion: 1
id: CHANGE-0041
summary: Correct recovery durability TDD lineage
status: staged
---
# CHANGE-0041: evidence-writer-lock-recovery-durability-tdd

Source: GitHub Issue #42 corrective evidence.

Requirements: REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001

## Intent

Record the changed existing recovery-policy test in a fresh Red/Green sequence
after CHANGE-0040 added its new durability expectation too late for that
change's original Red boundary.

## Classification

- Defect-correction evidence follow-up with no requirement change and one
  corrective evidence-design addition.

## Impact

- Strengthen the existing post-unlink synchronization regression assertion by
  verifying that the canonical lock remains absent. This invariant passes under
  both error boundaries and is not itself the source of Red.
- Reproduce the old combined error boundary as an explicitly disclosed
  temporary-revert Red reenactment; the durability-code and structured-state
  expectations added during CHANGE-0040 are what fail.
- Restore the approved split error boundary and record Green.
- After corrective Quality, waive only CHANGE-0040's immutable
  `CHANGE_TEST_CHANGED_AFTER_RED` chronology diagnostic with CHANGE-0041 as the
  replacement proof.

## Verification

- Reuse the currently approved requirement and add the reviewed corrective
  evidence design.
- TEST-EVIDENCE-WRITER-LOCK-026 recorded a failing Red against the disclosed
  temporary revert and a passing Green after restoring the approved boundary.
- Typecheck, build, 580 passing tests with 8 intentional skips, package check,
  package smoke, strict trace, and Code Graph gate pass.
- Individual TDD JSON is required for the selected Red/Green test; other
  requirement-linked tests are represented by the passing native aggregate.
- Refresh Quality, changed gate, and status evidence after recording the
  narrowly scoped CHANGE-0040 chronology waiver.

## Residual risks

- None beyond CHANGE-0040; this change corrects evidence chronology only.
