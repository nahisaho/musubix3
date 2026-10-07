---
schemaVersion: 1
id: CHANGE-0050
summary: Refresh TEST-ATTESTATION-EVIDENCE-STABILITY-003 TDD evidence after its CHANGE-0049-driven fixture update
status: staged
---
# CHANGE-0050: attestation-evidence-stability-tdd-refresh

Requirements: REQ-ATTESTATION-EVIDENCE-STABILITY-001

## Intent

This is an incidental maintenance change, required to unblock CHANGE-0049's
release gate. CHANGE-0049 (Issue #67) added a change-record phase precondition to
`tdd red`/`tdd green` that applies inside any project satisfying
`hasChangeDocuments` — including the isolated fixture project
`tests/attestation-evidence-stability.test.ts`'s
`TEST-ATTESTATION-EVIDENCE-STABILITY-003` builds to seed the `tdd`/
`changes`/`order` evidence inputs for REQ-ATTESTATION-EVIDENCE-STABILITY-001.
That fixture stages its own `.musubix/changes/CHANGE-9001.md`, so its seeded
`tdd red`/`tdd green` calls needed additional `requirements`/`design`/
`implementation` change-record phases recorded first to keep passing. That
fixture-only edit changed `tests/attestation-evidence-stability.test.ts`'s
own tracked content, which moved the real, outer
`TEST-ATTESTATION-EVIDENCE-STABILITY-003`'s source fingerprint and
invalidated its previously-recorded Green (`TDD_TEST_STALE`), blocking
`gate`'s required `tdd` check project-wide — including for CHANGE-0049's
own release approval, since `approval record release` always runs the full,
unscoped gate.

`tdd migrate TEST-ATTESTATION-EVIDENCE-STABILITY-003 --approver nahisaho
--confirm` was attempted first and correctly refused
(`MIGRATE: FAIL ... this is real drift, not an algorithm-only change`): the
test's tracked content genuinely changed (new fixture setup lines), so a
migrate-only re-fingerprint would be a misuse of that command. A genuine
Red/Green redo is the correct fix, which in turn requires
REQ-ATTESTATION-EVIDENCE-STABILITY-001 to have a staged change recording
`design` first (CHANGE-0049's own new precondition, applied here to a
requirement that — being older than the change-record system — had no
change-record history at all).

## Classification

- Defect-correction / evidence-maintenance: no behavior of
  REQ-ATTESTATION-EVIDENCE-STABILITY-001 changes (statement and acceptance
  criteria are unchanged); this records the already-true, already-approved
  requirement's ownership of a test whose fixture setup needed updating for
  an unrelated reason, so its TDD evidence can be legitimately refreshed.

## Impact

- `.musubix/features/attestation-evidence-stability/requirements.md`: one
  clarifying note added to REQ-ATTESTATION-EVIDENCE-STABILITY-001 (no
  statement/acceptance change).
- `.musubix/features/attestation-evidence-stability/design.md`: one
  clarifying update added to DES-ATTESTATION-EVIDENCE-STABILITY-004 (no
  behavior change).
- No test assertion changes beyond what CHANGE-0049 already made to
  `tests/attestation-evidence-stability.test.ts`'s fixture setup.
- `packages/analysis/src/attestation.ts`: one clarifying comment added
  above `collectEvidenceHeads` (no behavior change), needed only to give
  `change-record CHANGE-0050 implementation` a genuine fingerprint delta
  since the preceding `red` phase was recorded against a state where
  `attestation.ts` already carried every byte of CHANGE-0049's own fix.
- No waivers expected: the requirements.md/design.md clarifying notes are a
  real content delta (satisfying the record-time `CHANGE_REQUIREMENTS_
  UNCHANGED_AT_RECORD`/`CHANGE_DESIGN_UNCHANGED_AT_RECORD` checks on their
  own merits), so the later gate-time `CHANGE_REQUIREMENTS_UNCHANGED`/
  `CHANGE_DESIGN_UNCHANGED` diagnostics — which fire on the same
  unchanged-fingerprint condition — are not expected to occur.
- The project's `requirements`/`design` approval stage is scoped to every
  tracked `requirements.md`/`design.md`/ADR file, not per-feature; editing
  `attestation-evidence-stability/{requirements,design}.md` makes the
  already-recorded CHANGE-0049 requirements/design approvals stale. A fresh
  `approval prepare requirements`/`design` + `approval record` cycle
  (covering both CHANGE-0049's and CHANGE-0050's files, since both are
  carried by the same project-wide manifest) is required before any `tdd
  red`/`tdd green` call, since `runTddPhaseUnlocked`'s `red` path calls
  `requireApproval(root, 'design', ...)`.

## Acceptance

- `change-record CHANGE-0050 impact/requirements/design/red/implementation/
  green/quality` all succeed in that order.
- A fresh project-wide `requirements`/`design` approval is recorded (since
  editing `attestation-evidence-stability/requirements.md`/`design.md`
  makes CHANGE-0049's existing approvals stale) before `tdd red` is run.
- A genuine Red (failing) then Green (passing) TDD cycle is recorded for
  `TEST-ATTESTATION-EVIDENCE-STABILITY-003` against
  `REQ-ATTESTATION-EVIDENCE-STABILITY-001`.
- `gate --changed --json` / full `gate --json` report zero `tdd` /
  `change-history` / `change-completeness` errors for this change or for
  CHANGE-0049.
- `npm test` remains fully green (606 passed, 8 skipped).

## Verification

- `approval prepare requirements --json` / `approval prepare design --json`,
  `approval record requirements`/`design` (fresh hashes, covering both
  CHANGE-0049's and CHANGE-0050's files).
- `tdd red`/`tdd green` for `TEST-ATTESTATION-EVIDENCE-STABILITY-003`.
- `npm run typecheck`, `npm run build`, `npm test`.
- `trace build`, `trace check --strict`, `graph index`, `graph gate --json`,
  `gate --changed --json`, full `gate --json`.

## Residual risks

- `changeRecordPhasePrecondition`'s guard scope is project-wide
  (`hasChangeDocuments`), not per-requirement: any historical requirement
  with zero change-record history can be blocked from a legitimate TDD
  re-fingerprint-only redo as soon as any change is staged anywhere in the
  project, forcing a maintenance change like this one. Flagged to the
  requester as a candidate follow-up issue; out of scope for #67 and this
  change to resolve generally.
- Relatedly, the `requirements`/`design` approval stage's artifact manifest
  is also project-wide (every tracked `requirements.md`/`design.md`/ADR
  file, not per-feature), so any edit to any feature's requirements/design
  — however small or unrelated — invalidates every other staged change's
  already-recorded requirements/design approval in the same worktree,
  requiring a fresh project-wide re-approval. Also flagged as a candidate
  follow-up (domain-scoped approval, already partially supported via
  `approval-domain-scoping`, could mitigate this).
