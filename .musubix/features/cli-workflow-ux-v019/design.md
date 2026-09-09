---
schemaVersion: 1
feature: cli-workflow-ux-v019
---
# CLI workflow UX improvements (v0.1.9) design

## DES-CLI-WORKFLOW-UX-001: Nested-workspace scan exclusion
Responsibilities: While walking files for `graph index`/`trace build`, skip any descendant directory containing its own `.musubix` directory, without excluding the scan root.
Interfaces: `files()` in `packages/analysis/src/files.ts`, consumed by `indexGraph` and `buildTrace`.
Constraints: The check applies only to descendants (relative path non-empty); a directory literally named `.musubix` is still always excluded from being walked into, as today.
Requirements: REQ-CLI-WORKFLOW-UX-001
ADRs: ADR-0006
Depends-On: none

## DES-CLI-WORKFLOW-UX-002: Trace impact summary text
Responsibilities: Produce a human-readable summary line for `trace impact`'s non-JSON output that names the query and states the bidirectional, candidate-review nature of the result before listing nodes/paths.
Interfaces: `trace impact` command handler in `packages/cli/src/main.ts`; reuses existing `traceImpact()` return value unchanged for `--json`.
Constraints: `--json` output stays exactly the existing `Impact[]` shape for backward compatibility.
Requirements: REQ-CLI-WORKFLOW-UX-002
ADRs: ADR-0007
Depends-On: none

## DES-CLI-WORKFLOW-UX-003: Approval error discoverability
Responsibilities: Append a suggestion to run `musubix3 approval validate` to the error `requireApproval` throws when a stage is missing or stale.
Interfaces: `requireApproval()` in `packages/analysis/src/approval.ts`.
Constraints: Only the error message text changes; validation logic and thrown conditions are unchanged.
Requirements: REQ-CLI-WORKFLOW-UX-003
ADRs: ADR-0007
Depends-On: none

## DES-CLI-WORKFLOW-UX-004: Config lint diagnostics
Responsibilities: Load `.musubix/config.json`, scan each command's `args` for tokens that look like repository-relative file paths (contain a `/` or a known source extension, do not start with `-`, and are not obviously a flag value placeholder such as `{testId}`/`{reportPath}`/`{testPath}`), and report a diagnostic for each such path that does not exist under the project root.
Interfaces: New `configLint()` in `packages/analysis/src/config.ts`; new `config lint` subcommand in `packages/cli/src/main.ts`, reusing the existing `result()` PASS/FAIL rendering helper.
Constraints: Read-only; never modifies `.musubix/config.json`. Missing paths are reported with the offending command name and the missing path.
Requirements: REQ-CLI-WORKFLOW-UX-004
ADRs: ADR-0007
Depends-On: none

## DES-CLI-WORKFLOW-UX-005: Feature-scoped gate
Responsibilities: Add a `--feature <name>` option to `gate` that filters requirements/design/ADR/CHANGE inputs to `.musubix/features/<name>/` (plus ADRs/CHANGE records that reference that feature's requirement IDs) before running the existing artifact-derived checks, while still running all configured native `commands` unfiltered; report `mode: "feature"` with the feature name, computing `status` solely from that feature's scoped checks.
Interfaces: `runGate()` in `packages/analysis/src/gate.ts` gains an optional `feature` option; `gate` command in `packages/cli/src/main.ts` passes `--feature` through.
Constraints: `--feature` scopes `status` to that feature's own artifact-derived checks; it is a diagnostic/reporting view, not a substitute for the repository-wide gate. Unknown feature names produce a clear error rather than a silently-empty report.
Requirements: REQ-CLI-WORKFLOW-UX-005
ADRs: ADR-0007
Depends-On: none

## DES-CLI-WORKFLOW-UX-006: Command scaffold proposals
Responsibilities: Scan the project tree (excluding the same directories as `files()`) for `go.mod`, `Cargo.toml`, `pom.xml`, `pyproject.toml`, and `package.json` manifests, and print one proposed native test-command entry per detected toolchain/directory.
Interfaces: New `scaffoldCommands()` in `packages/analysis/src/config.ts`; new `config scaffold` subcommand in `packages/cli/src/main.ts`.
Constraints: Output only (stdout text or `--json` array); never writes `.musubix/config.json`. Proposed entries are illustrative defaults a human must review and add manually.
Requirements: REQ-CLI-WORKFLOW-UX-006
ADRs: ADR-0007
Depends-On: none
