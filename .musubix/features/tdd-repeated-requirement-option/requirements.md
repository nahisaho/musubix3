---
schemaVersion: 1
feature: tdd-repeated-requirement-option
---
# Reject repeated TDD requirement options

Source: GitHub Issue #46. The `tdd red`, `tdd green`, and `tdd refactor`
commands currently declare `--requirement <id>` as a single-value Commander
option. Repeating that option silently keeps only the final value, so a command
that appears to bind one test cycle to several requirements succeeds while its
persisted evidence names only one requirement.

## REQ-TDD-REPEATED-REQUIREMENT-OPTION-001: Reject repeated requirement options before evidence mutation
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a caller supplies `--requirement` more than once to `tdd red`, `tdd green`, or `tdd refactor`, then the system shall reject the invocation before executing the configured test command and before creating or modifying TDD evidence or monotonic evidence-order records.
Acceptance: Given any of the three TDD phase commands with two or more `--requirement` arguments and all other required options present, the command exits with code 2, JSON mode returns `error.code: "CLI_ERROR"` and an error message that names `--requirement`, states that one TDD invocation records exactly one requirement, and directs the caller to run a separate Red/Green cycle for each requirement; non-JSON mode includes the same actionable message; the configured test command is not executed; and the bytes or absence of `.musubix/evidence/tdd.json` and `.musubix/evidence/order.json` remain unchanged. Given exactly one `--requirement`, parsing continues to the existing phase behavior without this repeated-option error. Error precedence when another required option is absent remains governed by Commander and is outside this requirement.

## REQ-TDD-REPEATED-REQUIREMENT-OPTION-002: Document one-requirement-per-invocation usage
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall document that each `tdd red`, `tdd green`, or `tdd refactor` invocation accepts exactly one `--requirement` and that a test verifying multiple requirements requires a separate Red/Green cycle for each requirement.
Acceptance: The `tdd red --help`, `tdd green --help`, and `tdd refactor --help` output, `README.md`, `README-ja.md`, `.github/skills/sdd-change/SKILL.md`, and `.github/skills/sdd-implementation/SKILL.md` state the one-requirement-per-invocation rule and show or describe separate invocations as the required multi-requirement pattern. The guidance explicitly distinguishes the single-value TDD phase option from the variadic `change-record --requirement <ids...>` option, which continues to accept a requirement batch. Installed example and test-work skill snapshots are outside this change's authoritative documentation scope.
