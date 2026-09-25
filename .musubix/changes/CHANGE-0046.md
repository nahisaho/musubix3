---
schemaVersion: 1
id: CHANGE-0046
summary: Clarify directory-sync executable evidence scope
status: staged
---
# CHANGE-0046: transaction-directory-sync-policy-evidence-scope

Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001

## Intent

Clarify which transaction directory-sync tests have persisted Red/Green cycles
and disclose the requirement-batch scope of the CHANGE-0042 chronology waiver.

## Classification

- Documentation-only evidence description correction; requirements and runtime
  behavior are unchanged.

## Impact

- State that TEST-001 and TEST-005 have persisted Red/Green cycles while
  TEST-002 through TEST-004 provide current passing coverage without individual
  persisted cycles.
- State that CHANGE-0042's `CHANGE_TEST_CHANGED_AFTER_RED` waiver is scoped to
  the whole requirement batch and is broader than CHANGE-0043's two corrective
  portability cycles.
- State that CHANGE-0044's `CHANGE_TEST_CHANGED_AFTER_RED` waiver is likewise
  requirement-batch-scoped because a fingerprint-external fixture was completed
  after Red, while TEST-005's authoritative test fingerprint remained unchanged
  from Red through Green.
- State only the verified consequences of the optional focused command: the
  required full `test` command executes the same file and the current
  `commands.failures = 0` rule makes its failure gate-blocking.

## Verification

- Validate and review the updated design to zero findings.
- Rebuild strict trace and rerun changed gate.
- Record no fabricated Red, Implementation, Green, or Quality checkpoint.
  Quality is unavailable without Green evidence for this documentation-only
  change.
- Use approver-signed waivers only for CHANGE-0046's
  `CHANGE_PHASE_MISSING` details `phase:red`, `phase:implementation`,
  `phase:green`, and `phase:quality`, plus `CHANGE_COMPLETENESS_TDD` for
  REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001.

## Residual risks

- This Impact section was amended after the immutable impact (order 1593) and
  requirements (order 1594) checkpoints, both of which record the superseded
  impact fingerprint; the reviewed design checkpoint records the current text
  and is authoritative.
- TEST-002 through TEST-004 remain passing coverage without individual
  persisted Red/Green cycles.
- No runtime behavior changes.
- Workflow reconciliation still requires the completed session transcript.
