# TDD superseded-cycle scoping design

## DES-TDD-SUPERSEDED-CYCLE-SCOPING-001: Scope blocking cycle diagnostics to non-superseded cycles
Responsibilities: In `runTddValidate()`, for each recorded cycle being
evaluated for `TDD_RED_MISSING`, `TDD_GREEN_MISSING`, and the Red-side
`TDD_LEGACY_OR_UNSCOPED_EVIDENCE` diagnostic, determine whether the cycle is
"superseded": a cycle for test ID T is superseded when a cycle recorded
later (higher `order`) for the same T exists whose Red and Green phases are
both present and `valid`. Suppress these three diagnostics for a superseded
cycle; continue to raise them for the latest cycle of each test ID and for
any earlier cycle when no later cycle for that test ID is both Red-valid and
Green-valid. Leave every other check (`TDD_CHAIN_HASH`, order/sequence
checks, `TDD_DURATION_INVALID`, `TDD_TEST_STALE`) applied to every recorded
cycle exactly as before, since those protect append-only chain integrity and
staleness detection regardless of superseding.
Interfaces: `runTddValidate(root): Promise<{ valid: boolean; diagnostics: Diagnostic[] }>`
(internal to `packages/analysis/src/tdd.ts`; behavior-only change inside the
existing function, no exported signature change). Reuses the existing
`latestCycles` map already built in that function (currently only consulted
for `TDD_TEST_STALE`), adding a `supersededCycles` derivation from it.
Constraints: Must not change any diagnostic raised for a test ID whose only
recorded cycle, or latest recorded cycle, has an invalid or missing Red or
Green phase (those continue to be raised for that cycle). Must not weaken
`TDD_CHAIN_HASH`, order/sequence, or `TDD_DURATION_INVALID` checks for any
cycle, superseded or not. Must not alter `TDD_TEST_STALE`'s existing
latest-cycle-only computation.
Requirements: REQ-TDD-SUPERSEDED-CYCLE-SCOPING-001
ADRs: ADR-0012
