# TDD Green/Refactor requirement-scoped cycle matching design

## DES-TDD-GREEN-REQUIREMENT-SCOPING-001: Match pending cycle by testId and requirementId; validate before any side effect
Responsibilities: In `runTddPhase()` (`packages/analysis/src/tdd.ts`), for a
`green` or `refactor` phase, resolve `previous` by filtering recorded cycles
on both `cycle.testId === testId` and `cycle.requirementId === requirementId`
and taking the latest match, instead of filtering on `testId` alone. Move
the full pre-flight validation for this phase — a matching `previous` cycle
exists, its Red phase is present and `valid`, its recorded test fingerprint
matches the current one, and its recorded command name equals the
requested command name — to run before the configured test command is
executed and before `appendEvidenceOrder` is called. Only once that
validation passes may the command run and the order-log entry be appended;
on any validation failure, throw the existing diagnostic error with no
prior order-log or evidence side effect.
Interfaces: `runTddPhase(root, phase, testId, requirementId, commandName, options): Promise<TddPhaseResult>`
(internal to `packages/analysis/src/tdd.ts`; no exported signature change).
Reuses the existing `evidence.cycles` array and `appendEvidenceOrder`
helper; no new fields added to `TddCycle` or the evidence schema.
Constraints: Must not change Red-phase recording behavior (a Red always
starts a new cycle and is unaffected by this matching change). Must not
change the existing diagnostic error messages/codes used for a rejected
Green/Refactor, only when the rejection decision is made relative to
running the test command and appending order-log entries. Must not affect
`runTddValidate()`'s already-independent superseded-cycle logic
(ADR-0012); that logic reads recorded cycles after the fact and is
unaffected by how `previous` is resolved during recording. Because
`TDD_GREEN_WITHOUT_SOURCE_CHANGE` also reads `previous`, this change means
that diagnostic now compares against the matched (testId, requirementId)
cycle's own Red source fingerprint rather than the latest cycle for that
test ID irrespective of requirement — the intended, corrected comparison
for a Green being recorded against its own Red, not another requirement's.
Requirements: REQ-TDD-GREEN-REQUIREMENT-SCOPING-001 REQ-TDD-GREEN-REQUIREMENT-SCOPING-002
ADRs: ADR-0013
