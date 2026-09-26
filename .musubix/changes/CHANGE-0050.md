---
schemaVersion: 1
id: CHANGE-0050
summary: Strengthen Issue 46 regression evidence
status: staged
---
# CHANGE-0050: tdd-repeated-requirement-option-proof-strengthening

Requirements: REQ-TDD-REPEATED-REQUIREMENT-OPTION-001 REQ-TDD-REPEATED-REQUIREMENT-OPTION-002

## Intent

Replace the initial #46 regression's non-discriminating evidence setup with
valid Red, Green, and Refactor prerequisites and keep the dedicated contract
test fail-closed in repository policy.

## Source

- Corrective findings from the CHANGE-0049 release/quality review.

## Classification

- Defect correction to test and policy evidence for the existing #46 behavior.
- No requirement statement or acceptance change.

## Impact

- Amend DES-TDD-REPEATED-REQUIREMENT-OPTION-002 with the strengthened
  prerequisite, positive-control, snapshot, and policy-pin constraints and
  obtain a fresh design approval before corrective Red.
- Strengthen `TEST-TDD-REPEATED-REQUIREMENT-OPTION-001` with valid structured
  command output, positive command-execution controls, valid phase
  prerequisites, and byte snapshots taken immediately before rejection.
- Strengthen `TEST-TDD-REPEATED-REQUIREMENT-OPTION-003` to execute the policy
  checker against current configuration, a fixture missing the required
  command, and a fixture that retargets its arguments.
- Pin the dedicated command's executable and argument vector in the
  gate-command timeout-margin checker.
- Preserve the #46 CLI implementation and all approved observable behavior.

## Verification

- Record fresh Red/Green evidence for the strengthened TEST-001 and TEST-003.
- Run focused tests, typecheck, build, full tests, package checks, strict trace,
  Code Graph, changed gate, and status.

## Residual risks

- Repository-wide readiness may remain blocked by stale waivers or release
  approval belonging to other pre-existing dirty changes; report those
  separately from CHANGE-0050 scoped results.
