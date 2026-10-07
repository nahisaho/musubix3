---
schemaVersion: 1
id: CHANGE-0049
summary: Reject out-of-order tdd red/green phase recording before it corrupts evidence
status: staged
---
# CHANGE-0049: tdd-phase-order-guard

Requirements: REQ-TDD-GREEN-REQUIREMENT-SCOPING-003

## Intent

Fix GitHub Issue #67: `tdd green` (and in principle `tdd red`) can currently
be run before the corresponding `change-record red`/`implementation` phases
exist for a requirement. The TDD evidence is appended immediately
(hash-chained, append-only); only afterward does `hasValidTddCycle`
(`change-evidence.ts`) reject the resulting cycle as invalid, by which point
an out-of-order entry already sits in the append-only log. This exact
scenario occurred during CHANGE-0047 (Issue #55) and required manually
stashing the implementation, redoing Red→Implementation→Green in the correct
order, hand-repairing the hash-chain tail, and recovering a stale
evidence-writer lock.

## Classification

- Enhancement (a new fail-fast validation guard), closely coupled to a
  recurring defect-risk pattern: no existing requirement is violated by
  current behavior (the post-hoc `hasValidTddCycle` check already correctly
  rejects an out-of-order cycle as invalid), but the absence of an early
  guard allows avoidable evidence corruption and costly manual recovery.

## Impact

- New `changeRecordPhasePrecondition(evidence, phase, requirementId)` pure
  helper in `packages/analysis/src/change-evidence.ts`.
- New early precondition check in `runTddPhaseUnlocked()`
  (`packages/analysis/src/tdd.ts`), gated on the project already having at
  least one staged change document, applied to `tdd red` and `tdd green`.
- New requirement REQ-TDD-GREEN-REQUIREMENT-SCOPING-003 in the existing
  `tdd-green-requirement-scoping` feature's `requirements.md`/`design.md`.
- New ADR-0042 documenting the design decision and rejected alternatives.
- Relocated the 8 existing TDD-cycle-validity functions (`hasValidTddCycle`,
  `redUnprovenCondition`, `greenUnprovenCondition`,
  `completenessTddUnsatisfiedCondition`,
  `orderMigrationRequiredRequirementCondition`,
  `voidedCycleOrdersInCurrentWindow`, and two helpers) from
  `packages/analysis/src/change-evidence.ts` to
  `packages/analysis/src/tdd.ts` (bodies unchanged; see ADR-0042), updating
  the corresponding imports in `packages/analysis/src/change.ts`,
  `packages/analysis/src/change-waiver.ts`, and
  `tests/change-requirement-batches.test.ts`.

## Acceptance

- Given a staged change whose chronology has not recorded `design` for a
  requirement, `tdd red` for that requirement is rejected with an error
  naming `change-record <id> design --requirement <id>`, with no new
  monotonic order-log entry and no write to `.musubix/evidence/tdd.json`.
- Given a staged change whose chronology has recorded `red` but not yet
  `implementation` for a requirement, `tdd green` for that requirement is
  likewise rejected with an error naming
  `change-record <id> implementation --requirement <id>`, with no evidence
  or order-log side effect; after that `change-record` command is run, the
  same `tdd green` invocation then succeeds.
- Given a project that already has at least one staged change document but
  zero changes referencing the given requirement ID at all, `tdd red`/
  `tdd green` for that requirement ID is likewise rejected naming `design`
  as the missing phase, without naming any `change-record <id>` (since no
  change declares the requirement yet).
- Projects with zero staged change documents see no behavior change.
- `hasValidTddCycle`'s existing post-hoc order-window validation is
  unchanged and remains independently enforced.
- `npm run typecheck`, `npm run build`, and `npm test` remain green.

## Verification

- TDD red/green cycle for REQ-TDD-GREEN-REQUIREMENT-SCOPING-003 exercising
  both the `red`-missing-`design` and `green`-missing-`implementation`
  rejection paths, and the zero-staged-change-document passthrough case.
- `npm run typecheck`, `npm run build`, `npm test`.
- `trace build`, `trace check --strict`, `graph index`, `graph gate --json`,
  `gate --changed --json`.

## Residual risks

- The precondition's "which changeId/requirement to name" selection is
  deterministic (evidence array append order) but implementation-defined
  when more than one staged change references the same requirement ID; this
  is documented in `design.md` and does not affect correctness, only which
  single command is suggested first in a multi-change edge case.
