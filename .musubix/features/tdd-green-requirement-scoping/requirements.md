---
schemaVersion: 1
feature: tdd-green-requirement-scoping
---
# TDD Green/Refactor requirement-scoped cycle matching

Source: GitHub Issue #14 (found while implementing the fix for #12). Root
cause: `runTddPhase()` in `packages/analysis/src/tdd.ts` resolves the
pending cycle for a non-Red phase (`green`/`refactor`) as simply the
single latest recorded cycle for the given test ID, regardless of which
`requirementId` was passed. Since one test ID can now have more than one
independently pending (Red recorded, Green not yet recorded) cycle for
different requirement IDs, recording `green`/`refactor` for any pending
cycle other than the single most-recently-created one is rejected only
after the command has already been executed and after the phase's
monotonic order-log entry has already been appended. That order-log entry
is never rolled back, so the correct cycle's own subsequent `green`
recording is then permanently rejected as a duplicate order-log entry,
with no supported recovery short of discarding recorded TDD evidence.

## REQ-TDD-GREEN-REQUIREMENT-SCOPING-001: Match Green/Refactor to the pending cycle for the given requirement
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall match a `green` or `refactor` phase recording to
the latest recorded cycle for the given test ID whose own requirement ID
equals the given requirement ID, rather than to the single latest recorded
cycle for that test ID irrespective of requirement ID.
Acceptance: Given a test ID with a pending cycle for requirement A followed
by a pending cycle for requirement B, recording `green` for requirement A
attaches to requirement A's own cycle and recording `green` for requirement
B attaches to requirement B's own cycle, regardless of which cycle was
recorded most recently.

## REQ-TDD-GREEN-REQUIREMENT-SCOPING-002: Reject a mismatched Green/Refactor before any side effect
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `green` or `refactor` is requested for a test ID and requirement ID combination lacking a matching valid pending Red cycle recorded with the same command name, then the system shall reject the recording with a diagnostic error before executing the configured test command and before appending any monotonic evidence order entry.
Acceptance: Given a rejected `green`/`refactor` recording under the above
condition, the monotonic evidence order log gains no new entry, and a
subsequent correctly-matched `green`/`refactor` recording for the intended
cycle succeeds without reporting a duplicate order-log entry.
