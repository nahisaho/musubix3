---
schemaVersion: 1
feature: command-working-directory
---
# Per-command working directory for polyglot monorepo configurations design

## DES-COMMAND-WORKING-DIRECTORY-001: Optional cwd field, resolved via a shared commandCwd() helper
Responsibilities: Add `cwd?: string` to `CommandConfig` in `packages/analysis/src/config.ts`. Add and export `commandCwd(root: string, command: CommandConfig): string`, resolving `command.cwd` against `root` with the existing `within()` helper when present, otherwise returning `root`. Replace the hardcoded `cwd: root` passed to `runner(...)` in `tdd.ts`'s Red preflight loop, `tdd.ts`'s main command execution, and `gate.ts`'s command execution with `cwd: commandCwd(root, command)`.
Interfaces: `commandCwd(root: string, command: CommandConfig): string` (new, exported from `config.ts`). `CommandConfig.cwd?: string` (new optional field; omitting it preserves all current behavior). No existing exported signature changes.
Constraints: Must throw the same escaping-path error as every other use of `within()` when `cwd` resolves outside the project root, so an uncaught misconfiguration never silently runs a command outside the project. Must not change working directory for any command that omits `cwd`. Must not affect where `tddReport`/`testReport`/`mutationReport` paths or `.musubix/config.json` itself are resolved from.
Requirements: REQ-COMMAND-WORKING-DIRECTORY-001
ADRs: ADR-0016

## DES-COMMAND-WORKING-DIRECTORY-002: Validate cwd and scope CONFIG_ORPHANED_PATH to it in config lint
Responsibilities: In `configLint()`, for each command compute its working directory. If `command.cwd` is set and escapes the project root or does not exist as a directory, push a new `CONFIG_CWD_INVALID` diagnostic naming the command and the invalid `cwd` value, and skip that command's argument scan (there is no valid base to resolve arguments against). Otherwise, scan that command's `args` for repository-relative paths exactly as before, but check existence by resolving each candidate argument against the command's own working directory (falling back to the project root when `cwd` is absent) instead of always the project root.
Interfaces: `configLint(root: string): Promise<{ valid: boolean; diagnostics: Diagnostic[] }>` (exported signature unchanged). New diagnostic code `CONFIG_CWD_INVALID`.
Constraints: Must not change any diagnostic for a command that omits `cwd`. Must still enforce overall project-root containment (an argument resolved relative to a command's `cwd` must not itself escape the project root) using the existing `within()` check. Must not report `CONFIG_ORPHANED_PATH` a second time for a command already reported under `CONFIG_CWD_INVALID`.
Requirements: REQ-COMMAND-WORKING-DIRECTORY-002 REQ-COMMAND-WORKING-DIRECTORY-003
ADRs: ADR-0016
