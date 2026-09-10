---
schemaVersion: 1
feature: tdd-superseded-cycle-scoping
---
# TDD superseded-cycle scoping

Source: GitHub Issue #11 (v0.1.11 large-scale trial dogfooding). Root cause:
`runTddValidate()` in `packages/analysis/src/tdd.ts` builds a `latestCycles`
map (keyed by test ID, keeping only the most recent recorded cycle) but only
consults it for the `TDD_TEST_STALE` check. The `TDD_RED_MISSING`,
`TDD_GREEN_MISSING`, and `TDD_LEGACY_OR_UNSCOPED_EVIDENCE` diagnostics iterate
every recorded cycle for a test ID, including cycles that were superseded by
a later, fully valid Red-Green cycle for the same test ID. One early
incomplete or invalid attempt therefore blocks `gate` for that test ID
permanently, even after a later fully valid cycle exists, with no supported
partial-prune remedy short of discarding all recorded TDD evidence for the
whole project.

## REQ-TDD-SUPERSEDED-CYCLE-SCOPING-001: Do not block on a superseded incomplete or invalid cycle
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall not raise `TDD_RED_MISSING`, `TDD_GREEN_MISSING`,
or `TDD_LEGACY_OR_UNSCOPED_EVIDENCE` for a recorded TDD cycle of a given test
ID when a later-recorded cycle for that same test ID exists whose Red and
Green phases are both present and valid, while continuing to raise these
diagnostics for the latest recorded cycle of a test ID and for any earlier
cycle when no later cycle for that test ID has both a valid Red and a valid
Green phase.
Acceptance: Given a test ID with two recorded cycles, an earlier cycle
missing a Green phase (or with an invalid Red or Green) followed by a later
cycle with both phases present and valid, `tdd check`/`gate` reports no
`TDD_RED_MISSING`, `TDD_GREEN_MISSING`, or `TDD_LEGACY_OR_UNSCOPED_EVIDENCE`
diagnostic referencing the earlier cycle. Given a test ID whose only cycle,
or whose latest cycle, is missing or has an invalid Red or Green phase, the
same diagnostics continue to be raised for that cycle exactly as before this
change. Chain-hash integrity, monotonic order, and duration-validity checks
continue to apply to every recorded cycle regardless of whether it is
superseded. `TDD_TEST_STALE` continues to be computed using only the latest
recorded cycle for each test ID, unaffected by this change: given a test ID
with a superseded earlier cycle and a later valid cycle whose recorded test
fingerprint no longer matches the test's current source text, `tdd
check`/`gate` still reports `TDD_TEST_STALE` for that test ID, exactly as
before this change.
