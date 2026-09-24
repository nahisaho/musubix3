---
schemaVersion: 1
id: CHANGE-0036
summary: Stabilize the required full-test gate timeout
status: staged
---
# CHANGE-0036: gate-command-timeout-margin

Source: GitHub Issue #45.

Requirements: REQ-GATE-COMMAND-TIMEOUT-MARGIN-001

## Intent

Prevent nondeterministic release-gate failures when the complete required test
suite runs near the configured command timeout.

## Classification

- Quality-configuration defect correction.

## Impact

- Preserve the required `npm test` command, arguments, and complete test
  selection.
- Increase only the configured timeout for the full-test command from 180000ms
  to 240000ms. The value rounds the observed 177.28-second successful run up to
  approximately 1.35x headroom, leaving 62.72 seconds of execution margin.
- Keep all required checks and constitution limits unchanged.

## Verification

- Add an authoritative configuration test before changing the timeout.
- Prove Red against the current 180-second value and Green at 240 seconds.
- Re-run typecheck, build, full tests, package checks, trace, graph, gate, and
  status.

## Residual risks

- The timeout provides execution margin; it does not make elapsed duration a
  correctness proof or permit skipped tests.
- Dynamic duration-ratio enforcement is out of scope because wall-clock timing
  is not deterministic evidence; future suite growth must be reviewed against
  the explicit configured value.
