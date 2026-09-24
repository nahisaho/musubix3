---
schemaVersion: 1
id: CHANGE-0034
summary: Complete workflow waiver staleness evidence
status: staged
---
# CHANGE-0034: workflow-waiver-staleness-evidence

Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-012

## Intent

Resolve the final release-review inconsistency and coverage gaps for workflow
waiver staleness.

## Classification

- Specification clarification and regression-coverage completion.

## Impact

- Clarify that stale waiver audit visibility is unconditional while restoration
  of the scoped workflow diagnostic to error applies only when it remains raised.
- Add direct coverage for snapshot-version drift and paired
  `WORKFLOW_BINDING_MISSING` error restoration.
- Add direct coverage for resolved scopes, changed allow-listed reason codes,
  and authoritative-versus-superseded record staleness.
- Pin stale diagnostic fields and path plus deterministic workflow-subset
  ordering.

## Verification

- Add focused `TEST-WORKFLOW-EVIDENCE-WAIVER-012` and `-013` coverage linked to
  REQ-WORKFLOW-EVIDENCE-WAIVER-012 for snapshot-version drift, paired binding
  restoration, resolved and changed-code scopes, and both
  authoritative-versus-superseded staleness combinations.
- Obtain a genuine Red by temporarily faulting the shared stale-record predicate,
  then restore the conforming implementation for Green; never record a passing
  test as Red.
- Re-run workflow waiver tests, full quality commands, trace, graph, and release
  gate.

## Residual risks

- Historical stale waiver diagnostics remain repository-wide audit output by
  design.
