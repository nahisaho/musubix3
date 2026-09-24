---
schemaVersion: 1
id: CHANGE-0035
summary: Bind workflow waiver staleness regressions to current TDD evidence
status: staged
---
# CHANGE-0035: workflow-waiver-staleness-tdd-binding

Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-012

## Intent

Replace the invalid passing-Red attempt from CHANGE-0034 with genuine,
test-scoped Red/Green evidence for the workflow-waiver staleness regressions.

## Classification

- Defect-evidence correction with no normative requirement change.

## Impact

- Preserve the existing REQ-WORKFLOW-EVIDENCE-WAIVER-012 statement and
  acceptance criteria.
- Bind `TEST-WORKFLOW-EVIDENCE-WAIVER-012` and `-013` to independently observed
  failing Red and passing Green executions.
- Add `TEST-WORKFLOW-EVIDENCE-WAIVER-014` after the Design checkpoint to
  directly assert the shared predicate's current, version-stale, and
  hash-stale outcomes.
- Use the single shared stale-record predicate for severity restoration,
  active-waiver listing, replacement eligibility, and audit diagnostics.
- Supersede the earlier invalid passing-Red cycle without rewriting evidence.
- Preserve CHANGE-0034's closed chronology and dispose of its unavoidable
  `CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, and
  `CHANGE_COMPLETENESS_TDD` diagnostics through explicit, audited waivers
  scoped to CHANGE-0034 and REQ-WORKFLOW-EVIDENCE-WAIVER-012.
- Replace CHANGE-0033's stale `CHANGE_RED_UNPROVEN`,
  `CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` waivers scoped to
  REQ-WORKFLOW-EVIDENCE-WAIVER-012 after the final TDD append.

## Verification

- Record a deterministic Red by temporarily faulting only the shared
  stale-record predicate after adding TEST-014, then record the CHANGE-0035 Red
  phase while all three new test-scoped Red observations are inside its current
  chronology window.
- Restore the approved implementation and record Green for all three
  authoritative test IDs.
- After all three CHANGE-0035 Green observations are appended, and before
  CHANGE-0035 Quality, record the three CHANGE-0034 waivers and replace the
  three stale CHANGE-0033 waivers. This ordering keeps TDD-bound snapshots
  current for the final gate.
- Verify the CHANGE-0033 and CHANGE-0034 residual diagnostics are represented
  by approved, current change waivers rather than rewritten or backdated TDD
  evidence.
- Re-run workflow-waiver tests, typecheck, build, full tests, package checks,
  trace, graph, gate, and status.

## Residual risks

- This change corrects evidence binding and predicate centralization; it does
  not alter the accepted waiver policy or broaden waivable diagnostic codes.
