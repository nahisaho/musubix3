---
schemaVersion: 1
id: CHANGE-0014
summary: Select the latest applicable requirement batch during evidence validation
status: in-progress
---
# CHANGE-0014: latest-requirement-batch-selection

Requirements: REQ-CHANGE-REQUIREMENT-BATCHES-005

## Intent

Resolve GitHub Issue #27. When legacy full-set Red/Implementation/Green
evidence coexists with later requirement-scoped evidence, validation must use
the latest applicable batch for each requirement instead of selecting the
legacy batch solely because it appears first. A later incomplete batch is the
current fail-closed state and must not be hidden by falling back to an older
complete batch.

## Impact

- Requirement: clarify the deterministic coexistence and fail-closed selection
  rules in
  `.musubix/features/change-requirement-batches/requirements.md`.
- Design and ADR: revise the per-batch selector responsibility and remove the
  obsolete assumption that a requirement can belong to only one effective
  batch.
- Implementation: replace first-match `batchFor()` selection with a canonical
  latest-applicable-batch selector used by change validation, completeness,
  TDD order-migration checks, and waiver snapshot validation. Record-time
  `*_AT_RECORD` fail-fast checks remain keyed to the exact batch being recorded.
  Restrict current-batch diagnostics and implementation-scope checks to the
  requirements for which a batch is current. Existing malformed-evidence and
  waiver staleness semantics remain unchanged; snapshots bind valid void
  evidence only when its Red order lies inside the selected batch window.
- Tests: add regressions proving that later scoped evidence supersedes legacy
  full-set evidence and that a later incomplete batch fails closed rather than
  falling back. Cover current requirement projection, no-integer Red-order
  fallback, deterministic ties, and current-cycle selection that ignores a
  superseded Red-only attempt but fails closed on the latest incomplete attempt.
- Documentation: record the defect correction and append-only supersession
  behavior in `README.md`, `README-ja.md`, and `CHANGELOG.md`.

## Implementation

`batchFor()` now considers every effective batch containing a requirement and
selects the candidate with the greatest integer Red order, using later
effective-batch position as a deterministic tie-break and retaining first-match
behavior when no candidate has ordered Red evidence.

`currentRequirementIdsForBatch()` projects each batch onto only the declared
requirements for which it is current. Change-history diagnostics use that
projection for batch-wide and requirement-scoped checks, while structural
checks and union-based phase coverage remain unchanged. Waiver
currently-reported re-derivations use the same projection for the four
batch-keyed diagnostic codes.

Requirement-keyed TDD proof uses any valid cycle within the current batch's
ordered window, preserving legacy behavior. Migration checks use the latest
cycle in that window so earlier Red-only attempts can be superseded without
hiding a latest incomplete attempt. Validly linked void cycles are excluded;
snapshot payloads retain their historical shape until a valid void inside the
current batch window exists, then bind its order.

## Verification

- `TEST-CHANGE-REQUIREMENT-BATCHES-008`: Red reproduced legacy first-match
  selection; Green proves later scoped evidence is selected by Red order.
- Supporting regressions verify incomplete-later selection, current requirement
  projection, orderless legacy fallback, deterministic equal-order tie-breaking,
  and superseded/latest-incomplete migration handling within the current batch
  window.
- Validator/waiver integration coverage verifies that a fully superseded legacy
  batch no longer reports a current-batch diagnostic and cannot receive a new
  waiver for that inactive diagnostic.
- Independent TDD and final chronology for window-limited void snapshot binding
  are recorded by CHANGE-0015 / TEST-CHANGE-REQUIREMENT-BATCHES-009.
- `npx vitest run tests/change-requirement-batches.test.ts
  tests/change-evidence-waiver.test.ts`: passed, 24 tests.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed, 470 tests passed and 8 skipped after CHANGE-0015 added
  the independently traced void-window regression.
- `npm run pack:check`: passed, package contents verified.
- `trace check --strict`: passed.
- `graph gate`: passed with no cycles.
- Formal consistency: REQ-CHANGE-REQUIREMENT-BATCHES-005 produced one
  unconditional atom and zero constraints; REQ-001/003/004 were unsupported.
  Z3 reported SAT for that constraint-free abstraction, which proves neither
  consistency of the full requirements set nor selector behavior.
