---
schemaVersion: 1
id: CHANGE-0015
summary: Bind void waiver snapshots to the current batch window
status: in-progress
---
# CHANGE-0015: current-window-void-snapshot-evidence

Requirements: REQ-CHANGE-REQUIREMENT-BATCHES-005

## Intent

Complete the Issue #27 release evidence after review found that the final
window-limited void snapshot behavior was not independently bound to a
Red/Green cycle or final change chronology.

## Impact

- Requirement: unchanged; REQ-CHANGE-REQUIREMENT-BATCHES-005 already requires
  valid void evidence to affect snapshots only inside the current batch window.
- Design: expose one shared pure helper for the two waiver snapshot paths.
- Implementation: centralize filtering of linkage-validated void cycles by the
  current TDD order window.
- Tests: prove that a void inside the window is bound while older and later
  out-of-window voids are ignored.
- Documentation: correct CHANGE-0014's final snapshot and formal descriptions.

## Verification

- `TEST-CHANGE-REQUIREMENT-BATCHES-009` Red is structural: it fails because the
  shared void-window helper does not yet exist, rather than reproducing the
  already-correct window filter behavior.
- Green requires the helper to return only sorted valid-void orders whose cycle
  Red orders are inside the current batch window.
- Both detail-free TDD waiver snapshots and
  `CHANGE_ORDER_MIGRATION_REQUIRED:requirement:*` snapshots must consume that
  helper and omit `voidedCycleOrders` when it returns an empty array.
- The repository's existing CHANGE-0010 waivers must remain non-stale:
  `validateChangeEvidence` and `validateChangeCompleteness` remain valid.
- Final changed gate must pass change-history and change-completeness; before
  release approval, its only error may be `APPROVAL_STALE` for release.

- Red: TEST-CHANGE-REQUIREMENT-BATCHES-009 failed because the shared helper was
  not exported (TDD order 804; CHANGE Red order 805).
- Green: the targeted test passed after helper extraction (TDD order 807;
  CHANGE Implementation/Green orders 806/808).
- Refactor: targeted batch and waiver suites passed, 25 tests (TDD order 809).
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed, 470 tests passed and 8 skipped.
- `npm run pack:check`: passed, 125 files and 9 skills.

## Implementation

`voidedCycleOrdersInCurrentWindow()` shares the canonical current TDD order
window and returns sorted void orders only for linkage-validated cycles whose
Red orders fall inside that window. Both requirement-scoped waiver snapshot
paths consume the helper and preserve the historical payload shape when it
returns no orders.
