---
schemaVersion: 1
feature: tdd-adoption-warning
---
# Design: `TDD_ADOPTION_PROJECT_WIDE` first-cycle warning and adoption documentation

## DES-TDD-ADOPTION-WARNING-001: First-cycle adoption warning computation
Responsibilities: Within `runTddPhase` (`packages/analysis/src/tdd.ts`), when
`phase === 'red'`, capture whether `evidence.cycles.length === 0` immediately
before this call pushes its new cycle onto `evidence.cycles` (the exact
predicate `gate.ts`'s `tdd.present` uses, via `validateTddEvidence`'s
`!evidence?.cycles.length` check). Only when that predicate held, compute the
warning: reuse the already-built `trace` (from the existing
`buildTrace(root)` call earlier in `runTddPhase`) to enumerate mandatory
requirement nodes other than `requirementId`, determine "uncovered" for each
using the identical rule `validateTddEvidence` already applies (no cycle in
`evidence.cycles` — the pre-push array, since the just-pushed cycle has no
Green yet and is irrelevant to any other requirement's coverage — with that
requirement's ID, a verifying test per `trace`'s `verifies` edges, and both
`red.valid` and `green?.valid`), and build one
`{ code: 'TDD_ADOPTION_PROJECT_WIDE', severity: 'warning', message }` entry.
The message always names every uncovered other requirement ID explicitly
(never merely a count, including the empty list), states that the
just-recorded requirement itself remains uncovered until its Green phase,
and states whether this call is what makes `gate`'s `tdd` check required
project-wide or that the check was already independently required and this
call activates its full-project coverage evaluation for the first time.
Compute that causality clause with exactly the same two inputs `gate.ts`'s
`required: required('tdd') || tdd.present || hasChangeDocuments` formula
uses for every check other than `tdd.present` itself (which this call is
about to make true): `config.requiredChecks.includes('tdd')` (mirroring
`gate.ts`'s local `required = (name) => config.requiredChecks.includes(name)`
helper, read directly from the already-loaded `config` in `runTddPhase`,
without importing anything from `gate.ts`), and `hasChangeDocuments`,
recomputed identically to `gate.ts` as
`(await files(root)).some((path) => /^\.musubix\/changes\/CHANGE-\d+\.md$/.test(path))`
(`files` is already imported in `tdd.ts`). If either is true, state that the
check was already required and this call activates its project-wide
coverage evaluation; otherwise state that this call is what makes it
required. Store the resulting single-element array as `result.warnings`
inside the same object literal used to construct `result` (alongside
`diagnostics`, `testStatus`, etc.), not as a later mutation, so it is part of
the payload `appendChainRecord` hashes immediately afterward (see
DES-TDD-ADOPTION-WARNING-001's Constraints and ADR-0028). Leave
`result.warnings` unset (`undefined`) whenever the predicate does not hold,
or when `phase !== 'red'`.
Interfaces: `packages/analysis/src/tdd.ts`'s `runTddPhase`; new
`TddPhaseEvidence.warnings?: Diagnostic[]` field (see ADR-0028). Reads
`config.requiredChecks` and recomputed `hasChangeDocuments` (via `files`),
not `gate.ts` itself, to avoid a module dependency from `tdd.ts` onto
`gate.ts` (which already imports from `tdd.ts`, so the reverse import would
be circular).
Constraints: Must never add to `result.diagnostics` (the array `valid` is
computed from); see ADR-0028. Must be included in the `TddPhaseEvidence`
object literal at construction time, before `result.order` is assigned and
before `appendChainRecord` is called for this phase, so the persisted
hash-chain record's `phaseEvidenceSha256` covers the exact same payload
`tdd validate`/replay later re-hashes; must never be attached to `result`
after that point. Must not persist any new evidence file or mutate
`.musubix/evidence/tdd.json`'s existing schema beyond the new optional
field. Must not run for `phase !== 'red'`, and must not repeat once
`evidence.cycles.length > 0` before the call (i.e., on the second and later
Red calls in a project, regardless of which test/requirement). Must produce
exactly one `TDD_ADOPTION_PROJECT_WIDE` entry when it fires, not one
per uncovered requirement.
Requirements: REQ-TDD-ADOPTION-WARNING-001
ADRs: ADR-0028

## DES-TDD-ADOPTION-WARNING-002: CLI surfacing of the adoption warning
Responsibilities: In `packages/cli/src/main.ts`'s `tdd red` action, after
calling `runTddPhase` and building the existing
`${phase.toUpperCase()}: ${valid ? 'PASS' : 'FAIL'} (${testId})` summary
line, append each entry of `evidence.warnings` (if present) to that summary
text, one per line, before passing it to `output()`. `--json` mode requires
no additional code: `output()` already serializes the full `evidence`
object (including `warnings`) when `--json` is set.
Interfaces: `packages/cli/src/main.ts`'s existing `for (const phase of
['red', 'green', 'refactor'])` command-registration loop; only the summary
string passed to `output()` changes, scoped to when `evidence.warnings` is
non-empty.
Constraints: Must not change `process.exitCode` (an adoption warning never
fails the command; only `!evidence.valid` — driven solely by
`diagnostics`, per ADR-0028 — sets `process.exitCode = 1`, unchanged). Must
not print anything additional for `green`/`refactor` phases, or for a `red`
call where `evidence.warnings` is absent.
Requirements: REQ-TDD-ADOPTION-WARNING-001
ADRs: none - direct application of the DES-TDD-ADOPTION-WARNING-001 field
through the CLI's existing output plumbing; no alternative was rejected

## DES-TDD-ADOPTION-WARNING-003: Adoption-semantics documentation
Responsibilities: Add a `.description()` to the `red` subcommand itself
(`tdd.command('red <test-id>')`, currently the only phase-loop subcommand
with no description of its own — `npx musubix3 tdd red --help` renders only
that subcommand's own description, never the parent `tdd` command's, so the
text must live there, not on `program.command('tdd')`) and extend the
README's `tdd validate` / `tdd red|green|refactor` CLI reference rows, to
state: recording the project's first TDD cycle makes `gate`'s `tdd` check
required for every mandatory requirement project-wide (each uncovered one
surfaced as `TDD_REQUIREMENT_UNCOVERED`); `approval record release`
(`packages/analysis/src/approval-record.ts`) always runs the full,
non-`--changed` gate, so it is blocked by any resulting
`TDD_REQUIREMENT_UNCOVERED` diagnostics; and `tdd migrate` cannot bulk-onboard
previously-uncovered requirements, since it only re-fingerprints a
requirement that already has a valid Green cycle.
Interfaces: `packages/cli/src/main.ts`'s `red` subcommand's own
`.description()` text (set on the same `Command` instance returned by
`tdd.command('red <test-id>')`, before its existing `.requiredOption(...)`
calls); `README.md`'s CLI reference table rows for `tdd validate` and
`tdd red|green|refactor`.
Constraints: Must not alter any command's flags, exit codes, or JSON output
shape. Must not add this description to the `green`/`refactor` subcommands
(the shared `for (const phase of ['red', 'green', 'refactor'])` loop must
special-case `red`, or `red` must be registered outside that loop, since
REQ-TDD-ADOPTION-WARNING-002's acceptance only requires `tdd red --help`,
which renders only its own subcommand's description). Must include the
literal substrings `project-wide`, `TDD_REQUIREMENT_UNCOVERED`,
`approval record release`, and `tdd migrate` in both the `tdd red --help`
output and the README documentation, per REQ-TDD-ADOPTION-WARNING-002's
acceptance criteria.
Requirements: REQ-TDD-ADOPTION-WARNING-002
ADRs: none - documentation-only change; no alternative approach was rejected
