---
schemaVersion: 1
feature: upgrade-workflow
---
# Safe upgrade workflow design

## DES-UPGRADE-WORKFLOW-001: Skill-scoped upgrade helper
Responsibilities: Provide `upgradeSkills(root, packageRoot, options)` that, for each bundled `skillNames` directory under `.github/skills/`, reads every asset from the installed package and diffs it against the project's copy: `create` when absent, `replace` when different, `unchanged` when identical. Write only `create`/`replace` entries unless `options.dryRun` is set. Never enumerate or touch any path outside `.github/skills/`.
Interfaces: New exported `upgradeSkills(root: string, packageRoot: string, options?: { dryRun?: boolean }): Promise<{ dryRun: boolean; actions: InstallAction[] }>` in `packages/cli/src/install.ts`, reusing the existing `InstallAction` type and `skillNames` constant.
Constraints: Never creates, replaces, or deletes `.musubix/config.json`, `.musubix/policy-baseline.json`, `.musubix/constitution.md`, `.musubix/decisions/`, `.musubix/features/`, `.musubix/evidence/`, `.musubix/cache/`, or `.gitignore`; unlike `install`, replace is unconditional (no `--force` needed) because bundled skill files are not meant to be hand-edited by users.
Requirements: REQ-UPGRADE-WORKFLOW-001, REQ-UPGRADE-WORKFLOW-002
ADRs: ADR-0019
Depends-On: none

## DES-UPGRADE-WORKFLOW-002: `musubix3 upgrade` CLI command
Responsibilities: Expose `upgradeSkills` as a new top-level `upgrade` command accepting `--root` and `--dry-run`, printing the same `action  path` report format as `init`.
Interfaces: New `program.command('upgrade')` registration in `packages/cli/src/main.ts`, calling `upgradeSkills` and reusing the existing `output()` helper.
Constraints: Exit code/behavior on success mirrors `init`'s reporting conventions; command is additive and does not change `init`'s existing `--force` semantics.
Requirements: REQ-UPGRADE-WORKFLOW-001, REQ-UPGRADE-WORKFLOW-002
ADRs: ADR-0019
Depends-On: DES-UPGRADE-WORKFLOW-001
