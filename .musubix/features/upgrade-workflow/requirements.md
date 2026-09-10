---
schemaVersion: 1
feature: upgrade-workflow
---
# Safe upgrade workflow for installed musubix3 skills

Source: user request to document how to upgrade an installed musubix3 project,
and to implement an upgrade mechanism if one does not already exist. `init
--force` was the only existing "refresh bundled files" path, but it
unconditionally overwrites `.musubix/config.json`, `.musubix/policy-baseline.json`,
`.musubix/constitution.md`, and the starter feature's `requirements.md`/
`design.md` — files users are expected to customize after the initial
install. There is no command that refreshes only the bundled, non-customized
`.github/skills/sdd-*` assets to match a newer installed musubix3 version.

## REQ-UPGRADE-WORKFLOW-001: Refresh bundled skills without touching user-owned artifacts
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall provide an `upgrade` command that compares each bundled `.github/skills/sdd-*/SKILL.md` asset in the installed musubix3 package against the project's copy and writes only the ones whose content differs, without creating, replacing, or deleting `.musubix/config.json`, `.musubix/policy-baseline.json`, `.musubix/constitution.md`, `.musubix/decisions/`, `.musubix/features/`, `.musubix/evidence/`, or `.gitignore`.
Acceptance: Given a project whose `.github/skills/sdd-change/SKILL.md` content differs from the currently installed musubix3 package's bundled copy, and whose `.musubix/config.json` also differs from the package's default template, running `musubix3 upgrade` rewrites `.github/skills/sdd-change/SKILL.md` to match the bundled copy and leaves `.musubix/config.json` byte-for-byte unchanged; running `musubix3 upgrade` again afterward reports every bundled skill file as `unchanged`.

## REQ-UPGRADE-WORKFLOW-002: Preview upgrade actions without writing
Priority: should
Type: functional
Pattern: ubiquitous
Statement: The system shall support `--dry-run` on `upgrade` to report the planned `create`/`replace`/`unchanged` action for each bundled skill file without writing any file.
Acceptance: Given a project with at least one stale bundled skill file, running `musubix3 upgrade --dry-run` reports that file's action as `replace` and leaves its on-disk content byte-for-byte unchanged afterward.
