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

## DES-TDD-GREEN-REQUIREMENT-SCOPING-002: Fail-fast change-record phase precondition for `tdd red`/`tdd green`

Responsibilities: Add a new exported pure helper,
`changeRecordPhasePrecondition(evidence: ChangeEvidence | null, phase: 'red'
| 'green', requirementId: string): { satisfied: boolean; changeId?: string;
missingPhase?: 'design' | 'red' | 'implementation' }`, to
`packages/analysis/src/change-evidence.ts`. Let `candidates` be
`(evidence?.changes ?? []).filter((change) => change.requirementIds.includes(requirementId))`
(so `evidence === null`, same as an `evidence.changes` array with no
matching entry, is treated identically to "zero candidates", per both
phases' shared design-check below). First, for both `phase: 'red'` and
`phase: 'green'` alike, check whether any `candidates` entry has
`phases.design` recorded (this is a shared sub-check, not just a `red`-only
one: `recordChangePhaseUnlocked` in `change.ts` itself requires
`change.phases.design` before a batch `red` can ever be recorded, so no
candidate can legitimately have a batch `red` without also already having
`phases.design`, but a candidate's `phases.design` can still be absent, e.g.
when `evidence.changes` is stale relative to `requirementId`, when no
candidate exists at all, or when checking `phase: 'red'` itself before any
`red` has ever been recorded). When no candidate has `phases.design`
recorded, return `satisfied: false`, `missingPhase: 'design'`, and the first
candidate's `changeId` if any `candidates` entry exists, or no `changeId` at
all when `candidates` is empty — this is the single shared path that also
correctly covers `phase: 'green'`'s "no change has recorded design yet"
case, instead of misreporting `missingPhase: 'red'` for a `change-record red`
invocation that `change.ts` would itself still reject. Only once at least one
candidate has `phases.design` recorded does the two phases' remaining checks
diverge: for `phase: 'red'`, that found design-satisfying candidate's
existence alone already means `satisfied: true` (no further check). For
`phase: 'green'`, among only the design-satisfying candidates, check each
one's `effectiveBatches(change)`-resolved batch (selected via the existing
`batchFor` selector) for `requirementId`; satisfied when at least one such
batch has both `red` and `implementation` recorded; when unsatisfied, prefer
a design-satisfying candidate whose batch already has `red` recorded
(returning `missingPhase: 'implementation'`) over one with neither
(`missingPhase: 'red'`), so the reported command always names the single
next phase actually missing and is always one `change.ts` would itself
currently accept.

In `runTddPhaseUnlocked()` (`packages/analysis/src/tdd.ts`), compute
`hasChangeDocuments` (the same `.musubix/changes/CHANGE-\d+\.md` existence
check already used by the existing `TDD_ADOPTION_PROJECT_WIDE` warning logic,
hoisted so both consumers share one computation) immediately after loading
config, before the existing `red`-only design-approval check, before any
`redPreflightCommands` execution, before building the trace, and before any
read of `.musubix/evidence/tdd.json`. When `hasChangeDocuments` is true and
`phase` is `'red'` or `'green'`, load `.musubix/evidence/changes.json` via
the existing `loadChangeEvidence(root)` and call
`changeRecordPhasePrecondition`. When unsatisfied, throw a descriptive
`Error` naming the exact `change-record <changeId> <missingPhase>
--requirement <requirementId>` command required first (or, when no matching
change exists at all, instructing that a staged change must record `design`
for this requirement first), before any other side effect in the function
runs. Because this check is inserted immediately after `loadConfig`, it runs
strictly before the existing `red`-only `requireApproval('design', …)` check
and before `DES-TDD-GREEN-REQUIREMENT-SCOPING-001`'s `previous`-cycle
matching (which only runs after `buildTrace`): a recording that fails both
this precondition and an existing check is rejected with this precondition's
error, intentionally, since it is the earliest-detectable failure and
requires the least wasted work (no trace build, no command execution) to
report. When more than one `ChangeRecord` references the same
`requirementId` and more than one fails the precondition, `evidence.changes`
array order (the order `change-record impact` was first invoked across
changes, usually but not necessarily matching ascending `changeId` creation
order) is the deterministic tie-break for which `changeId` is named; this is
an implementation-defined but stable and reproducible choice, not a
user-visible contract requiring a specific `changeId` across all cases.

Interfaces: `changeRecordPhasePrecondition(evidence, phase, requirementId)`
(new, exported from `change-evidence.ts`); consumed only by
`runTddPhaseUnlocked` in `tdd.ts`. No change to `TddPhaseEvidence`,
`ChangeRecord`, `ChangeTddBatch`, or any other persisted evidence schema;
this is a validation-only addition with no new stored fields.

Constraints: Must not introduce a module dependency cycle — `change.ts`
already imports several runtime functions from `tdd.ts`
(`loadTddEvidence`, `validlyVoidedTddCycles`, `validlyArchivedTddCycles`), so
`tdd.ts` must not import runtime values from `change.ts`; the new helper is
added to `change-evidence.ts`, which `tdd.ts` can safely import because
`change-evidence.ts`'s own existing import from `tdd.ts` is type-only
(erased at compile time). Must apply only when `hasChangeDocuments` is true,
so a project with zero staged change documents sees no behavior change at
all from this design. Must not alter `hasValidTddCycle`'s existing post-hoc
validation, its order-window computation, or any other existing diagnostic
code/condition in `change-evidence.ts` or `change.ts`; this is a strictly
additive, independent guard. Must reuse the existing `effectiveBatches`/
`batchFor` selectors rather than re-deriving batch-matching logic, so this
guard's notion of "the current batch for a requirement" can never silently
diverge from `hasValidTddCycle`'s.
Requirements: REQ-TDD-GREEN-REQUIREMENT-SCOPING-003
ADRs: ADR-0042
