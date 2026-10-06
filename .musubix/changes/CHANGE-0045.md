---
schemaVersion: 1
id: CHANGE-0045
summary: Document sdd-change operational guidance for ordering, convergence, and release cadence
status: in-progress
---
# CHANGE-0045: sdd-change operational guidance improvements

Requirements: REQ-SDD-CHANGE-OPS-IMPROVEMENTS-001 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-002 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-003 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-004 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-005 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-006

## Intent

Resolve GitHub Issue #61 by tightening the contributor guidance in
`.github/skills/sdd-change/SKILL.md` so that future changes avoid the specific
operational failures seen during CHANGE-0042/CHANGE-0043: misordered
TDD/change-record evidence, late evidence-file merge conflicts from stale
parallel worktrees, unconverged rubber-duck review loops, missed `CHANGELOG.md`
updates, and redundant full `gate --json` reruns. This is a documentation-only
change to workflow guidance; the optional runtime diagnostic proposed in the
issue for early TDD/order detection is out of scope for this change.

This feature intentionally omits TDD and runtime-code phases under the
repository's documentation-only policy because it changes contributor guidance
rather than observable product behavior. Impact, requirements, design, and
quality evidence still remain required for the guide change itself.

## Acceptance evidence

- REQ-SDD-CHANGE-OPS-IMPROVEMENTS-003: Section 2 now caps rubber-duck review at
  3 rounds, requires diff-only rounds 2-3, and escalates unresolved findings to
  a human continue-vs-proceed decision after round 3, explicitly asking whether
  to continue with fixes or proceed as-is instead of auto-looping.
- REQ-SDD-CHANGE-OPS-IMPROVEMENTS-002: Section 1 now requires a symmetric
  `origin/main` divergence check plus refreshing/rebasing before release time in
  long-lived or parallel worktrees.
- REQ-SDD-CHANGE-OPS-IMPROVEMENTS-004: The bounded review guidance now runs
  validators first, reviews related requirements/design/ADR artifacts together
  in one pass when appropriate, and keeps the prompt scoped to
  logic/contradiction/acceptance/consistency issues.
- REQ-SDD-CHANGE-OPS-IMPROVEMENTS-005: Section 4 now requires confirming the
  `CHANGELOG.md` entry before release approval is requested, before the change
  is treated as release-ready, and in the quality checklist itself.
- REQ-SDD-CHANGE-OPS-IMPROVEMENTS-006: Section 4 now uses `gate --changed
  --json` plus `status --json` for intermediate checks and reserves the full
  `gate --json` run for the final release-candidate confirmation only.
