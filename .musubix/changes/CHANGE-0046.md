---
schemaVersion: 1
id: CHANGE-0046
summary: Exclude validly archived TDD cycles from the change order window
status: staged
---
# CHANGE-0046: exclude archived TDD cycles from the Red-phase order window

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-018

## Intent

Fix GitHub Issue #64 by excluding validly archived TDD cycles from the
Red-phase order window that `validateChangeEvidence`'s
`CHANGE_ORDER_MIGRATION_REQUIRED` diagnostic uses, mirroring the existing
exclusion already applied to validly voided cycles. A dangling TDD cycle
created for a test that already passed without the fix (correctly rejected
by `tdd red`'s forced-failure check) and subsequently cleaned up with `tdd
archive` must never be selected as a requirement's "current" cycle, and
must never by itself cause a false-positive `CHANGE_ORDER_MIGRATION_REQUIRED`.

## Classification

- Defect correction (implementation violated intended behavior: archived
  cycles should be excluded from the order window just like voided ones).

## Impact

- Add an exported `validlyArchivedTddCycles` helper in `tdd.ts`, mirroring
  `validlyVoidedTddCycles`.
- Extend `currentTddCycle` and `orderMigrationRequiredRequirementCondition`
  in `change-evidence.ts` with an optional `validlyArchived` parameter,
  backward-compatible with every other existing caller.
- Wire the new parameter at both call sites of
  `orderMigrationRequiredRequirementCondition`: the gate-time diagnostic in
  `change.ts` and the waiver-recording-time condition re-check in
  `change-waiver.ts`.
- Add a new EARS requirement `REQ-CHANGE-EVIDENCE-WAIVER-018` and design
  component `DES-CHANGE-EVIDENCE-WAIVER-006` documenting the fix.
- Add focused regression coverage reproducing Issue #64's exact scenario.
- Update the changelog.

## Acceptance

- A change's Red-phase order window for a requirement that contains only a
  validly archived cycle with no Green no longer raises
  `CHANGE_ORDER_MIGRATION_REQUIRED` for that requirement.
- A genuinely incomplete non-archived, non-voided cycle in the same window
  still raises the diagnostic exactly as before.
- A cycle with a malformed `archive` record remains unexcluded and keeps
  triggering the diagnostic when otherwise applicable.
- `npm run typecheck`, `npm test`, and `npm run build` remain green.

## Verification

- A new regression test in `tests/change-evidence-waiver.test.ts`
  reproducing Issue #64's exact scenario.
- `npx vitest run tests/change-evidence-waiver.test.ts`
- `npm run typecheck`
- `npm run build`
- `npm test`
- `trace build`, `trace check --strict`, `graph index`, `graph gate --json`,
  and `gate --changed --json`

## Residual risks

- None identified; this is a narrow, additive exclusion mirroring an
  already-accepted pattern (voided-cycle exclusion) with no change to any
  other diagnostic code's behavior.
