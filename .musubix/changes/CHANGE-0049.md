---
schemaVersion: 1
id: CHANGE-0049
summary: Reject repeated TDD requirement options
status: staged
---
# CHANGE-0049: tdd-repeated-requirement-option

Requirements: REQ-TDD-REPEATED-REQUIREMENT-OPTION-001 REQ-TDD-REPEATED-REQUIREMENT-OPTION-002

## Intent

Prevent `tdd red`, `tdd green`, and `tdd refactor` from silently discarding
all but the final repeated `--requirement` value.

## Source

- GitHub Issue #46.
- Human contract decision: reject repeated `--requirement` values rather than
  extending one TDD cycle to persist multiple requirements.

## Classification

- Defect correction for observable CLI and evidence-recording behavior.

## Impact

- Reject repeated `--requirement` arguments before the phase action can execute
  a test or mutate evidence; the design selects the precise CLI mechanism.
- Preserve the existing TDD evidence schema and its one-cycle,
  one-requirement invariant.
- Return exit code 2 and the repository-standard `CLI_ERROR` JSON envelope with
  an actionable separate-cycle invocation message.
- Update phase help, English and Japanese README command guidance, and the
  `sdd-change` and `sdd-implementation` skills with the required separate-cycle
  pattern for a test that verifies multiple requirements.
- Add regression coverage for Red, Green, and Refactor and for unchanged
  `tdd.json` and `order.json` bytes on rejection, plus preservation of the
  existing single-requirement happy path.
- Register the dedicated regression command as required in
  `.musubix/config.json` and extend
  `scripts/check-gate-command-timeout-margin.mjs`'s reviewed command set.

## Other impacted requirements

- `REQ-TDD-GREEN-REQUIREMENT-SCOPING-001` and
  `REQ-TDD-GREEN-REQUIREMENT-SCOPING-002` remain unchanged. Their
  single-requirement cycle matching remains the downstream behavior after a
  valid invocation passes CLI parsing.
- Existing TDD evidence schemas and append-only chain formats remain unchanged.
- `change waiver record --requirement` is outside #46's TDD-command scope. Its
  independently single-valued option remains unchanged by this change.
- Repeated `--command` handling is outside #46's requirement-option scope and
  remains unchanged.

## Verification

- Validate and approve requirements and design before Red.
- Record a real failing CLI regression test before changing parsing behavior.
- Run focused tests, typecheck, build, the complete test suite, strict trace,
  Code Graph, changed quality gate, and status readiness.

## Residual risks

- A test verifying several requirements requires repeated command execution,
  once per requirement. This is intentional to preserve auditable,
  independently ordered cycles.
- The same `--requirement` option name remains variadic for `change-record` but
  single-valued for TDD phase commands. Documentation must preserve that
  distinction to avoid transferring one command's invocation model to another.
