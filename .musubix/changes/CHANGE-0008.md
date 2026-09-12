---
schemaVersion: 1
id: CHANGE-0008
summary: Add musubix3 requirements/design scaffold commands
status: in-progress
---
# CHANGE-0008: Feature requirements/design scaffold commands

Requirements: REQ-REQUIREMENTS-DESIGN-SCAFFOLD-001 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-002 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-003 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-004 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-005 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-006

## Intent

Resolve GitHub Issue #18: `musubix3 requirements` only provides `validate`,
so starting a new feature requires hand-authoring
`.musubix/features/<slug>/requirements.md` (and its parent directory) from
scratch, copying the exact EARS header format from documentation or the
bundled `example` feature. This change adds CLI-native scaffolding so the
plain-CLI workflow is self-sufficient without relying on an AI agent to
author the initial skeleton.

## Scope

- `REQ-REQUIREMENTS-DESIGN-SCAFFOLD-001`/`-002`: `musubix3 requirements
  scaffold <slug>` creates `.musubix/features/<slug>/requirements.md` with
  one placeholder EARS entry (`REQ-<SLUG>-001`), refusing to overwrite an
  existing file.
- `REQ-REQUIREMENTS-DESIGN-SCAFFOLD-003`/`-004`: `musubix3 design scaffold
  <slug>` mirrors this for `.musubix/features/<slug>/design.md`
  (`DES-<SLUG>-001`), with the same overwrite refusal.
- `REQ-REQUIREMENTS-DESIGN-SCAFFOLD-005`: both commands validate the slug
  against the existing lowercase kebab-case convention used by `install()`
  before touching the filesystem.
- `REQ-REQUIREMENTS-DESIGN-SCAFFOLD-006`: `--title <text>` customizes the
  placeholder heading title for `requirements scaffold`.
- New `packages/analysis/src/scaffold-artifact.ts` module (`scaffoldRequirements`,
  `scaffoldDesign`) wired into `packages/cli/src/main.ts` as `requirements
  scaffold`/`design scaffold` subcommands.

## Other impacts

- No existing requirement's behavior changes; `requirements validate`/`design
  validate` and `install()` are unaffected.
- README documents the new subcommands.
