---
schemaVersion: 1
feature: gate-command-timeout-margin
---
# Gate command timeout margin

Source: GitHub Issue #45. At issue discovery, the complete required test suite
had an observed successful duration of 177.28 seconds while its command timeout
was 180 seconds, and two consecutive release-gate executions timed out without
a test failure.

## REQ-GATE-COMMAND-TIMEOUT-MARGIN-001: Preserve full-test coverage with execution margin
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The quality gate shall execute the complete required `npm test`
command with a timeout that provides stable execution margin without changing
the command, its arguments, required status, or selected tests.
Acceptance: In `.musubix/config.json`, the command named `test` remains
`required: true`, invokes `npm` with exactly `["test"]`, and has
`timeoutMs: 305000`. The 305000ms value is the latest observed 225.40-second
`command:test` duration within an unscoped gate run multiplied by approximately
1.35 and rounded up, leaving 79.60 seconds of margin. The authoritative test
reads repository files and also proves that
`requiredChecks` remains exactly `["requirements", "design", "constitution",
"trace", "graph", "commands"]`, the 41 configured commands that are currently
`required: true` retain that status, constitution RULE-002 and RULE-003 retain
limit `0`, and `vitest.config.ts` retains
the semantic values `include = ["tests/**/*.test.ts"]`,
`testTimeout = 20000`, and `maxWorkers = 2`, independent of quote style or
numeric separators. The `pack-smoke` command retains `timeoutMs: 180000`.
Required execution evidence is separate from these deterministic assertions:
`npm run typecheck`, `npm run build`, `npm test`, `npm run pack:check`, and
both `npx musubix3 gate --changed --json` and unscoped
`npx musubix3 gate --json` pass. Dynamic wall-clock ratio enforcement is
outside this requirement because elapsed duration is not deterministic
correctness evidence.
