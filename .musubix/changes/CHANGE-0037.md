---
schemaVersion: 1
id: CHANGE-0037
summary: Rebaseline the full-test timeout against current gate evidence
status: staged
---
# CHANGE-0037: gate-command-timeout-rebaseline

Requirements: REQ-GATE-COMMAND-TIMEOUT-MARGIN-001

## Intent

Correct the timeout margin after release evidence showed that the initial
240-second ceiling left only 14.60 seconds above the latest 225.40-second
`command:test` duration within an unscoped gate run.

## Classification

- Quality-configuration defect correction with a revised measurable threshold.

## Impact

- Preserve the required full test command and all coverage invariants.
- Raise only the `test` command timeout from 240000ms to 305000ms.
- Rebaseline the reviewed margin against the latest unscoped gate observation.

## Verification

- Update the authoritative checker expectation before implementation.
- Record genuine Red at 240000ms and Green at 305000ms.
- Re-run focused/full tests, typecheck, build, package checks, strict trace, and
  both changed and unscoped gates.

## Residual risks

- 305000ms is an execution ceiling, not correctness or performance proof.
- Future suite growth can consume the reviewed margin and requires new evidence.
