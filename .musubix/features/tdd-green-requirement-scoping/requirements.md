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
Statement: The system shall match a `green` or `refactor` phase recording to the latest recorded cycle for the given test ID whose own requirement ID equals the given requirement ID, rather than to the single latest recorded cycle for that test ID irrespective of requirement ID.
Acceptance: Given a test ID with a pending cycle for requirement A followed by a pending cycle for requirement B, recording `green` for requirement A attaches to requirement A's own cycle and recording `green` for requirement B attaches to requirement B's own cycle, regardless of which cycle was recorded most recently.

## REQ-TDD-GREEN-REQUIREMENT-SCOPING-002: Reject a mismatched Green/Refactor before any side effect
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `green` or `refactor` is requested for a test ID and requirement ID combination lacking a matching valid pending Red cycle recorded with the same command name, then the system shall reject the recording with a diagnostic error before executing the configured test command and before appending any monotonic evidence order entry.
Acceptance: Given a rejected `green`/`refactor` recording under the above condition, the monotonic evidence order log gains no new entry, and a subsequent correctly-matched `green`/`refactor` recording for the intended cycle succeeds without reporting a duplicate order-log entry.

## REQ-TDD-GREEN-REQUIREMENT-SCOPING-003: Reject `tdd red`/`tdd green` before its change-record phase precondition is satisfied

Source: GitHub Issue #67, reproducing a real incident during CHANGE-0047
(Issue #55): `tdd green` was run before `change-record red`/`implementation`
had been recorded for the requirement. `hasValidTddCycle`
(`change-evidence.ts`) already rejects the resulting cycle as invalid, but
only after `runTddPhase()` had already executed the configured test command
and appended a hash-chained, append-only entry to `.musubix/evidence/tdd.json`
and the monotonic order log. Recovering required stashing the implementation,
redoing Red→Implementation→Green in the correct order, manually repairing the
hash-chain tail, and recovering a stale evidence-writer lock. This requirement
adds a fail-fast precondition check so the same ordering mistake is rejected
before any evidence is written, complementing (not replacing) the existing
post-hoc `hasValidTddCycle` validation.

Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a project has at least one staged change document (`.musubix/changes/CHANGE-*.md`) and `tdd red` or `tdd green` is requested for a requirement ID for which no staged change's recorded chronology satisfies that phase's change-record precondition (`design` recorded for `red`; both `red` and `implementation` recorded for `green`), then the system shall reject the recording with an error naming the exact `change-record <change-id> <phase> --requirement <requirement-id>` command required first, before executing the configured test command, before appending any monotonic evidence order entry, and before writing to `.musubix/evidence/tdd.json`.

Acceptance: Given a project with a staged change document whose change chronology has not recorded `design` for a requirement, running `tdd red <test-id> --requirement <requirement-id> --command <name>` is rejected with an error naming `change-record <change-id> design --requirement <requirement-id>`; the monotonic evidence order log and `.musubix/evidence/tdd.json` gain no new entry. Given a staged change whose chronology has recorded `red` but not yet `implementation` for a requirement, running `tdd green` for that same requirement and test is likewise rejected with an error naming `change-record <change-id> implementation --requirement <requirement-id>`, with no evidence or order-log side effect; after the named `change-record` command is run, the same `tdd green` invocation then succeeds. Given a project that already has at least one staged change document but zero changes referencing the given requirement ID at all, `tdd red`/`tdd green` for that requirement ID is likewise rejected, with an error naming `design` as the missing phase but without naming any `change-record <change-id>` (since no change declares the requirement yet), and with no evidence or order-log side effect. Given a project with zero staged change documents, `tdd red`/`tdd green` behavior is unaffected by this requirement (existing non-staged-change TDD workflows keep working exactly as before). Because this check runs strictly before every other existing `tdd red`/`tdd green` validation (the `red`-only design-approval check and REQ-002's cycle-matching check both included), a recording that fails both this precondition and an existing check is rejected with this requirement's error, not the other one; this requirement does not change which error is reported when this precondition alone is already satisfied. This check never weakens or replaces `hasValidTddCycle`'s existing post-hoc order-window validation; both remain independently enforced.
