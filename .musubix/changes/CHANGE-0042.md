---
schemaVersion: 1
id: CHANGE-0042
summary: Add CHANGE_PHASE_ORDER to the bounded waivable-diagnostic allow-list
status: in-progress
---
# CHANGE-0042: change-evidence-waiver (CHANGE_PHASE_ORDER)

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-017

## Intent

Add `CHANGE_PHASE_ORDER` as a thirteenth, `--detail`-only-scoped code in
`WAIVABLE_CODES`, so an operator can record a bounded, audited waiver for a
recording-order inversion that cannot otherwise be repaired, as a safety net
alongside CHANGE-0020's `change quality-refresh` mechanism (GitHub Issue
#56).

## Impact

- Extend `WAIVABLE_CODES`/`DETAIL_ONLY_CODES` in `change-waiver.ts` with
  `CHANGE_PHASE_ORDER`.
- Extend `diagnosticDetail`/`parseDetail` with `CHANGE_PHASE_ORDER`'s
  `phase:<phaseName>` (change-level) and `batch:<phaseName>:<batchKey>`
  (per-batch) grammars.
- Extend `snapshotPayload` with `CHANGE_PHASE_ORDER`'s `{ firstOrder,
  secondOrder }` payload (and `matchingBatches` for multiple matches).
- Add `phaseOrderPhaseCondition`/`phaseOrderBatchItemCondition`/
  `phaseOrderBatchCondition` helpers in `change-evidence.ts`, and wire them
  into `evaluateWaiverCondition` in `change-waiver.ts`.
- Convert the six `CHANGE_PHASE_ORDER` emission sites in `change.ts`
  (`validateChangeEvidence`) from bare `error(...)` to `waivedDiagnostic(...)`.
- Update `.musubix/features/change-evidence-waiver/requirements.md`,
  `design.md`, and `.musubix/decisions/ADR-0025.md` (done).
- Add focused tests covering all six transitions, following the existing
  `change-evidence-waiver.test.ts` conventions.
- Update `CHANGELOG.md`.

## Acceptance

- `change waiver record <CHANGE-ID> CHANGE_PHASE_ORDER --detail <value>
  --reason <text> --approver <name> --confirm` is accepted for all six
  transition flavors (`phase:requirements`, `phase:design`,
  `batch:red:<key>`, `batch:implementation:<key>`, `batch:green:<key>`,
  `batch:quality:<key>`) and downgrades exactly its matching diagnostic
  instance from `error` to `warning`.
- The waiver becomes stale (reverts to blocking) the instant either
  compared order changes, per REQ-CHANGE-EVIDENCE-WAIVER-011's staleness
  rule.
- Waiver-free validation behavior for `CHANGE_PHASE_ORDER` is unchanged
  (same code/message/severity), gaining only the structured
  `changeId`/`detail` targeting fields.
- Full test suite, typecheck, and build remain green.
