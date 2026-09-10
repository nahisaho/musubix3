---
schemaVersion: 1
feature: command-working-directory
---
# Per-command working directory for polyglot monorepo configurations

Source: GitHub Issue #6, found during a real multi-language trial project
against musubix3@0.1.11. Every configured command always runs with the
project root as its working directory; a multi-service, multi-language
monorepo (TypeScript/Go/Java/Rust services in separate subdirectories)
cannot express a per-service local toolchain (e.g. a service-local
`node_modules`) without an explicit per-command working directory.

## REQ-COMMAND-WORKING-DIRECTORY-001: Run a configured command in its declared working directory
Priority: must
Type: functional
Pattern: event-driven
Statement: When a configured command declares a cwd field, the system shall execute that command, including its TDD Red, Green, Refactor and Red preflight phases, with a working directory resolved from that field relative to the project root instead of the project root itself.
Acceptance: Given a command configured with `cwd: "services/route"` and args that are valid only when run from that directory, `gate` and `tdd red`/`tdd green` execute that command with `services/route` as its working directory and the command succeeds; given a command with no cwd field, it still executes with the project root as its working directory exactly as before this change.

## REQ-COMMAND-WORKING-DIRECTORY-002: Reject a cwd value that resolves outside the project root
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a configured command's cwd value resolves to a location outside the project root or to a nonexistent directory, then the system shall report a config lint diagnostic identifying that command and the invalid cwd value.
Acceptance: Given a command configured with `cwd: "../outside"`, `config lint` reports a diagnostic naming that command and the escaping path. Given a command configured with `cwd: "services/does-not-exist"`, `config lint` reports a diagnostic naming that command and the missing directory.

## REQ-COMMAND-WORKING-DIRECTORY-003: Check repository-relative path arguments against the command's own working directory
Priority: must
Type: functional
Pattern: complex
Statement: While a configured command declares a cwd field, when config lint scans that command's arguments for repository-relative paths, the system shall check each such argument for existence relative to that command's working directory instead of the project root.
Acceptance: Given a command configured with `cwd: "services/route"` and an argument that is a valid path relative to `services/route` but does not exist directly under the project root, `config lint` reports no CONFIG_ORPHANED_PATH diagnostic for that argument; given the same command with an argument that does not exist relative to either directory, `config lint` still reports CONFIG_ORPHANED_PATH for that argument.
