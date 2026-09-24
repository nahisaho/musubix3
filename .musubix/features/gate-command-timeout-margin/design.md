---
schemaVersion: 1
feature: gate-command-timeout-margin
---
# Gate command timeout margin design

## DES-GATE-COMMAND-TIMEOUT-MARGIN-001: Deterministic quality-policy regression
Responsibilities: Add
`TEST-GATE-COMMAND-TIMEOUT-MARGIN-001` to the existing repository
configuration-policy suite in `tests/npm-audit-remediation.test.ts`. Read
`.musubix/config.json`, `.musubix/constitution.md`, and `vitest.config.ts`
through a dedicated checker in
`scripts/check-gate-command-timeout-margin.mjs`, without executing the full
suite, and assert the exact timeout plus the coverage-preserving invariants
declared by the requirement.
Interfaces: Existing `npm-audit-remediation-tests` Vitest command and adapter;
`checkGateCommandTimeoutMargin(root)`; repository JSON/text fixtures; test identity
`TEST-GATE-COMMAND-TIMEOUT-MARGIN-001`.
Constraints: The test must fail while the `test` command timeout is 180000ms
or 240000ms and pass only when it is 305000ms. The checker must evaluate the target timeout
first so Red is attributable to that value. It must locate commands by name,
assert `pack-smoke` remains at 180000ms, and assert that the `test` command stays
`npm ["test"]` and required, that the configured required command-name set and
`requiredChecks` remain unchanged, that RULE-002/RULE-003 remain zero, and that
Vitest selection/timeouts/workers retain their parsed semantic values. Do not
use wall-clock duration as the assertion and do not add another runner.
Requirements: REQ-GATE-COMMAND-TIMEOUT-MARGIN-001
ADRs: ADR-0038
Depends-On: none

## DES-GATE-COMMAND-TIMEOUT-MARGIN-002: Full-test timeout configuration
Responsibilities: Change the reviewed expected-timeout constant and the
`timeoutMs` field of the `.musubix/config.json` command named `test` together
from 240000 to 305000.
Interfaces: `EXPECTED_TEST_TIMEOUT_MS` in
`scripts/check-gate-command-timeout-margin.mjs`; `.musubix/config.json` command
schema consumed by the gate command runner.
Constraints: Preserve the command name, executable, arguments, required flag,
all other command entries, required checks, constitution limits, and Vitest
configuration. Leave `.musubix/policy-baseline.json` unchanged because it does
not protect command timeouts and changing it would require unrelated policy
approval. The timeout is an execution ceiling, not passing evidence.
Requirements: REQ-GATE-COMMAND-TIMEOUT-MARGIN-001
ADRs: ADR-0038
Depends-On: DES-GATE-COMMAND-TIMEOUT-MARGIN-001

## DES-GATE-COMMAND-TIMEOUT-MARGIN-003: CHANGE-0037 evidence rebaseline
Responsibilities: Rebaseline the existing authoritative
`TEST-GATE-COMMAND-TIMEOUT-MARGIN-001` expectation from 240000ms to 305000ms
after CHANGE-0037 Design, record a fresh failing Red while configuration remains
240000ms, then change only the checker's expected-timeout constant and configured
`test.timeoutMs` value and record Green at 305000ms.
Interfaces: `TEST-GATE-COMMAND-TIMEOUT-MARGIN-001`;
`EXPECTED_TEST_TIMEOUT_MS`; `.musubix/config.json` command named `test`; existing
`npm-audit-remediation-tests` TDD command.
Constraints: Update the existing test title or assertion context after the
Design checkpoint so CHANGE-0037 has a real test fingerprint delta, and make the
test read `.musubix/config.json` and assert the named command's timeout is 305000
before invoking the checker. This direct assertion is the genuine Red cause
while configuration remains 240000. After Red, do not edit the authoritative
test before Green; the only Red-to-Green source changes are
`EXPECTED_TEST_TIMEOUT_MS` and the configured timeout moving together from
240000ms to 305000ms. Do not reuse CHANGE-0036's completed cycle or alter other
command timeouts. Record Red immediately after the test edit without running an
intermediate unscoped gate.
Requirements: REQ-GATE-COMMAND-TIMEOUT-MARGIN-001
ADRs: ADR-0038
Depends-On: DES-GATE-COMMAND-TIMEOUT-MARGIN-001 DES-GATE-COMMAND-TIMEOUT-MARGIN-002
