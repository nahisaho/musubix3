---
schemaVersion: 1
id: CHANGE-0044
summary: Keep waiver approval notes from re-staling CHANGE_RECORD_MISSING
status: staged
---
# CHANGE-0044: change-evidence-waiver approval-note stability

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-011

## Intent

Fix GitHub Issue #58 by preserving the integrity of a recorded
`CHANGE_RECORD_MISSING` waiver while allowing the operator to append the
waiver's own approval notes to the staged `CHANGE-*.md` document afterward.

## Classification

- Defect correction and specification refinement.

## Impact

- Narrow `CHANGE_RECORD_MISSING`'s document snapshot to the normative portion
  of the staged change document, excluding only a final
  `## Debt Remediation Approval` section that documents the waiver's own
  code/approver/timestamp/snapshot hash after recording.
- Preserve fail-closed staleness for any other change-document edit and for
  every `changes.json` / `order.json` state transition already covered by
  `REQ-CHANGE-EVIDENCE-WAIVER-011`.
- Add focused regression coverage for approval-only change-document appends and
  for substantive edits outside the excluded section.
- Update the waiver requirements, design, ADR rationale, and changelog.

## Acceptance

- After recording a valid `CHANGE_RECORD_MISSING` waiver, appending a final
  `## Debt Remediation Approval` section in
  `.musubix/changes/<CHANGE-ID>.md` keeps that waiver non-stale only when the
  section contains nothing except the waiver's own
  `Code`/`Approver`/`Recorded at`/`Snapshot hash` fields plus the exact
  deterministic `Files:` list for
  `.musubix/changes/<CHANGE-ID>.md`, `.musubix/evidence/changes.json`, and
  `.musubix/evidence/order.json`. Later edits also stay non-stale only when
  that same already-excluded section keeps exactly that schema and those same
  bound values.
- Editing any content before that final approval section, adding extra prose
  inside it, or placing any later level-2 section after it changes the
  snapshot and reports `CHANGE_WAIVER_STALE` according to the existing
  tri-state severity rules.
- `npm run typecheck`, `npm test`, and `npm run build` remain green.

## Verification

- `TEST-CHANGE-EVIDENCE-WAIVER-033` proves that appending the exact structured
  approval note keeps a `CHANGE_RECORD_MISSING` waiver active.
- `TEST-CHANGE-EVIDENCE-WAIVER-034` proves the carve-out remains fail-closed
  for mismatched approval-note content.
- `npx vitest run tests/change-evidence-waiver.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `npm run pack:check`
- `trace build`, `trace check --strict`, `graph index`, `graph gate --json`,
  and `gate --changed --json` (now failing only for pending release approval,
  with no remaining CHANGE-0044-specific gate failures)

## Residual risks

- `CHANGE-0044` carries reviewed waivers for `CHANGE_RED_UNPROVEN`,
  `CHANGE_GREEN_UNPROVEN`, and `CHANGE_COMPLETENESS_TDD` because the immutable
  change-record chronology was recovered after the TDD cycle had already been
  recorded during this session. The test evidence is present and verified, but
  the historical ordering debt remains visible as warnings.
