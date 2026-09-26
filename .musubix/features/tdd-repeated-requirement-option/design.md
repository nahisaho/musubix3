# Reject repeated TDD requirement options design

## DES-TDD-REPEATED-REQUIREMENT-OPTION-001: Single-value Commander parser with pre-action rejection
Responsibilities: Add a small CLI-local parser function in
`packages/cli/src/main.ts` for the TDD phase `--requirement <id>` option. The
function accepts Commander's current value and previous parsed value, returns
the current value only when `previous === undefined`, and throws a plain
`Error` when `previous !== undefined` (including an empty first value). The
error message names `--requirement`, states
that one TDD invocation records exactly one requirement, and directs the caller
to run a separate Red/Green cycle for each requirement. Attach this parser to
the shared `requiredOption` declaration used by `tdd red`, `tdd green`, and
`tdd refactor`.
Interfaces:
`parseSingleTddRequirement(value: string, previous?: string): string`
(CLI-local helper) and the existing phase action options shape
`{ requirement: string; command: string; root: string; json?: boolean }`.
Constraints: Throw a plain `Error`, not Commander's `InvalidArgumentError`, so
the existing top-level catch emits exactly the repository-standard
`CLI_ERROR` JSON envelope in JSON mode and the `musubix3: <message>` human
error path without Commander's additional parser-error output. The parser
must run before the phase action, so `runTddPhase()` and its configured command,
writer lock, TDD evidence, and order append logic are never reached for a
repeated option. Do not change `runTddPhase`, `TddCycle`, evidence schemas,
`change-record`'s variadic requirement option, `change waiver record`, or the
TDD phase `--command` option. Assert error text by required semantic substrings,
not by Commander formatting. A single option occurrence must return the
original string unchanged. This deliberate plain-`Error` behavior differs from
the adjacent `--index` parser's `InvalidArgumentError`: repeated TDD
requirements need one consistent global `CLI_ERROR`/human message rather than
Commander's additional parser-error line. Give the helper an authoritative
trace comment with `@id CODE-TDD-REPEATED-REQUIREMENT-OPTION-001`,
`@implements REQ-TDD-REPEATED-REQUIREMENT-OPTION-001`, and
`@design DES-TDD-REPEATED-REQUIREMENT-OPTION-001`.
Requirements: REQ-TDD-REPEATED-REQUIREMENT-OPTION-001
ADRs: none - this is a local CLI argument-validation correction preserving the existing evidence architecture.

## DES-TDD-REPEATED-REQUIREMENT-OPTION-002: CLI-boundary regression and authoritative usage guidance
Responsibilities: Add a CLI regression test with trace IDs that invokes the
built CLI for Red, Green, and Refactor using two `--requirement` occurrences
and an otherwise valid configured command. For every phase, assert exit code 2,
the `CLI_ERROR` JSON envelope, actionable message substrings, absence of the
configured command's sentinel side effect, and byte-for-byte preservation (or
continued absence) of `.musubix/evidence/tdd.json` and
`.musubix/evidence/order.json`. Also cover an empty first option value followed
by a second requirement, and invoke one phase without `--json` to assert the
actionable message on stderr. In the same test surface, prove one
`--requirement` does not produce the repeated-option error. Add a documentation
test that checks all three phase help outputs with whitespace-tolerant regexes
and checks the authoritative README and skill files for the
one-requirement/separate-cycle rule and the distinction from variadic
`change-record`. Register this dedicated regression command as required in
`.musubix/config.json` and extend the reviewed required-command allowlist in
`scripts/check-gate-command-timeout-margin.mjs` so the policy remains
fail-closed when the required `tdd-repeated-requirement-option-tests` command
entry is removed or retargeted. Pin that entry's `command`, `args`, `adapter`,
`timeoutMs`, and `required` fields to `npx vitest run
tests/tdd-repeated-requirement-option.test.ts`, the `vitest` adapter, 120000ms,
and `true`; verify the checker against the live configuration plus fixtures
with the entry removed and with its arguments changed. Trace that policy registration as
`CODE-TDD-REPEATED-REQUIREMENT-OPTION-003` and
`TEST-TDD-REPEATED-REQUIREMENT-OPTION-003` under REQ-002 because it keeps the
authoritative documentation/help contract test continuously required.
Interfaces: Built CLI invocations through the existing test `runProcess`
helper; authoritative documentation files `README.md`, `README-ja.md`,
`.github/skills/sdd-change/SKILL.md`, and
`.github/skills/sdd-implementation/SKILL.md`.
Constraints: Tests must not treat successful SAT/formal checks as behavioral
proof. The rejection test must inspect actual CLI process results and
filesystem bytes inside a temporary `project()` fixture, never the repository
working tree. Help text is supplied on the shared `--requirement` option so
Red, Green, and Refactor render the same contract. Fold the `sdd-change`
guidance into its existing TDD/change-record lines without increasing the
skill beyond its tested fewer-than-80-lines limit. Update the Japanese command
table's TDD row and `change-record` row as well as the corresponding English
guidance. Do not update installed example or `.test-work` skill snapshots.
Preserve the existing independent `change-record --requirement <ids...>` batch
guidance. Give the shared TDD option/help declaration an authoritative trace
comment with `@id CODE-TDD-REPEATED-REQUIREMENT-OPTION-002`,
`@implements REQ-TDD-REPEATED-REQUIREMENT-OPTION-002`, and
`@design DES-TDD-REPEATED-REQUIREMENT-OPTION-002`. Preserve the English README
TDD row's existing `project-wide`, `TDD_REQUIREMENT_UNCOVERED`,
`approval record release`, and `tdd migrate ... only re-fingerprints ... valid
Green cycle` wording so the existing documentation contract remains intact.
For the no-side-effect proof, construct valid phase prerequisites: Red starts
from valid empty evidence, Green starts from a valid pending Red, and Refactor
starts from a valid Red/Green cycle. Arrange repeated arguments so the
pre-fix last-value-wins behavior would select the valid cycle and execute the
configured command; invalid sentinel evidence or missing prior phases must not
be used as the reason execution is skipped. The configured command must write
both a valid structured TDD report and an execution sentinel, with pass/fail
status controlled by fixture state. Clear the sentinel after prerequisite
construction, then snapshot `tdd.json` and `order.json` immediately before the
repeated-option invocation. For Red, Green, and Refactor independently, run an
otherwise-identical single-`--requirement` invocation from a separate valid
fixture and assert exit 0 plus a present execution sentinel as the positive
control for that phase.
Requirements: REQ-TDD-REPEATED-REQUIREMENT-OPTION-001 REQ-TDD-REPEATED-REQUIREMENT-OPTION-002
ADRs: none - tests and documentation directly verify the selected CLI contract.
