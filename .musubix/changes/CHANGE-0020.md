---
schemaVersion: 1
id: CHANGE-0020
summary: Append audited Quality refresh checkpoints after corrective TDD batches
status: completed
---
# CHANGE-0020: change-quality-refresh

Requirements: REQ-CHANGE-QUALITY-REFRESH-001 REQ-CHANGE-QUALITY-REFRESH-002 REQ-CHANGE-QUALITY-REFRESH-003

## Intent

Allow a staged change that receives corrective Red/Implementation/Green batches
after its first Quality checkpoint to append a new authoritative Quality
checkpoint without rewriting prior evidence or waiving chronology errors.

## Impact

- Extend change evidence with append-only Quality checkpoint history.
- Keep existing single-Quality evidence valid without migration.
- Update recording, validation, evidence merge payload resolution, and order
  identity.
- Upgrade the repository-wide change evidence document to schema version 2 on
  first refresh and preserve the maximum supported schema through merges.
- Update the SDD change Skill guidance for corrective batches, Quality refresh,
  schema version 2, and deterministic refresh failures.
- Add focused deterministic tests for refresh acceptance and rejection.

## Acceptance

- A corrective batch recorded after Quality can be followed by a new Quality
  checkpoint that becomes authoritative while retaining the prior checkpoint,
  when that batch uses a requirement-ID subset not already recorded for the
  change. This includes CHANGE-0019's new singleton corrective batches.
- Refresh is rejected unless it follows a newer complete Green batch and covers
  every declared requirement.
- Legacy change evidence and evidence merge behavior remain compatible.
- `.github/skills/sdd-change/SKILL.md` documents when and how to append a
  refreshed Quality checkpoint.

## Verification

- Requirements approval was recorded at 2026-09-22T10:48:18Z and design
  approval at 2026-09-22T11:04:44Z.
- `TEST-CHANGE-QUALITY-REFRESH-001`, `-002`, and `-003` each recorded a real
  failing Red and passing Green for REQ-CHANGE-QUALITY-REFRESH-001 through
  REQ-CHANGE-QUALITY-REFRESH-003.
- `npm run typecheck`, `npm run build`, the full 522-passed/8-skipped test
  suite, `npm run pack:check`, and all 39 configured quality commands passed.
- Strict trace coverage is design 1.0, implementation 1.0, and tests 1.0.
- The required policy, requirements, design, constitution, trace, graph,
  workflow, change-history, command, and deterministic test-identity checks
  pass; release approval is the only remaining gate.
- CHANGE-0019 used the implemented refresh path to append an authoritative
  Quality checkpoint after its corrective Green batches while retaining its
  prior checkpoint as immutable audit history.

## Residual risks

- The three requirements are outside the current Boolean formal abstraction;
  no SAT or behavior-proof claim is made.
- Recovery correctness depends on filesystem durability guarantees for
  fsync/rename/link operations; malformed or ambiguous journals fail closed
  with explicit manual-remediation diagnostics.
