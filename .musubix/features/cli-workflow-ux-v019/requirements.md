---
schemaVersion: 1
feature: cli-workflow-ux-v019
---
# CLI workflow UX improvements (v0.1.9)

Source: friction points found while running the full requirements→design→
implementation→trace→gate workflow end-to-end on a real multi-language example
(`examples/ecommerce-marketplace/`) for the large-scale-development Qiita article.

## REQ-CLI-WORKFLOW-UX-001: Exclude nested MUSUBIX3 workspaces from ancestor scans
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall exclude, from an ancestor repository's `graph`/`trace` file scan, any descendant directory that itself contains a `.musubix` directory, while never excluding the scan root itself.
Acceptance: Given a repository root with a nested directory that contains its own `.musubix` directory, `graph index` and `trace build` run at the repository root report 0 files and 0 trace nodes/edges sourced from inside that nested directory; running the same commands with the nested directory itself as `--root` is unaffected and continues to report its own files, nodes, and edges.

## REQ-CLI-WORKFLOW-UX-002: Clarify trace impact bidirectional candidate semantics
Priority: should
Type: functional
Pattern: ubiquitous
Statement: The system shall state, in `trace impact`'s non-JSON output, that returned nodes are a bidirectional candidate-review range reachable from the query, not a list of artifacts that must change.
Acceptance: Running `trace impact <id>` without `--json` prints a summary line containing the words "bidirectional" and "candidate" before the per-node listing; `--json` output is unchanged (an `Impact[]` array) for backward compatibility.

## REQ-CLI-WORKFLOW-UX-003: Point approval-required errors to approval validate
Priority: should
Type: functional
Pattern: event-driven
Statement: When `requireApproval` rejects an operation because a stage is missing or stale, the system shall include a suggestion to run `musubix3 approval validate` for a full per-stage status in the thrown error message.
Acceptance: The error message text raised by `requireApproval` for a missing or stale stage contains the substring `approval validate`.

## REQ-CLI-WORKFLOW-UX-004: Detect orphaned config references
Priority: should
Type: functional
Pattern: ubiquitous
Statement: The system shall provide a `config lint` command that reports, for the loaded `.musubix/config.json`, any configured command whose `args` contains a repository-relative file path that does not exist under the project root.
Acceptance: Given a config with at least one command entry whose `args` contains a repository-relative path (e.g. a test file path) that does not exist under the project root, `config lint` exits non-zero and reports a diagnostic naming that command and the missing path; given a config where every such path exists, `config lint` exits 0 and reports 0 diagnostics.

## REQ-CLI-WORKFLOW-UX-005: Scope gate to one feature
Priority: should
Type: functional
Pattern: event-driven
Statement: When `gate` is run with `--feature <name>`, the system shall restrict artifact-derived checks (requirements, design, trace, tdd, change-history, change-completeness) to artifacts under `.musubix/features/<name>/` and its linked ADRs/CHANGE records.
Acceptance: Running `gate --feature <name>` for a feature with 0 dangling trace links reports that feature's checks as `pass` even when unrelated features elsewhere in the repository fail; configured native `commands` still run unfiltered; the report's top-level `mode` is `"feature"` with the feature name recorded, and `status` is computed solely from that feature's requirements, design, trace, tdd, change-history and change-completeness checks; an unknown feature name produces a clear error instead of an empty report.

## REQ-CLI-WORKFLOW-UX-006: Propose native command scaffolding per toolchain
Priority: may
Type: functional
Pattern: ubiquitous
Statement: The system shall provide a `config scaffold` command that inspects the project tree for `go.mod`, `Cargo.toml`, `pom.xml`, `pyproject.toml`, and `package.json` manifests and prints proposed native test-command entries for each detected toolchain, without writing to `.musubix/config.json`.
Acceptance: Given a project containing at least one supported manifest, `config scaffold` prints a proposed command entry (name, command, args) for each detected toolchain and `.musubix/config.json` is byte-for-byte unchanged after the command runs; `--json` prints an array of proposal objects instead of text.
