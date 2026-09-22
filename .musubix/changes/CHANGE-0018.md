---
schemaVersion: 1
id: CHANGE-0018
summary: Synchronize release versions from one authoritative input
status: completed
---
# CHANGE-0018: release-version-synchronization

Requirements: REQ-RELEASE-VERSION-SYNCHRONIZATION-001 REQ-RELEASE-VERSION-SYNCHRONIZATION-002 REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-005 REQ-RELEASE-VERSION-SYNCHRONIZATION-006 REQ-RELEASE-VERSION-SYNCHRONIZATION-007 REQ-RELEASE-VERSION-SYNCHRONIZATION-008

## Intent

Implement GitHub Issue #29. Replace manual version edits across package,
plugin, CLI, documentation, test, and lockfile surfaces with one deterministic,
fail-atomic synchronization operation and a reusable non-mutating validation
operation.

## Impact

- Add a release-version synchronization script with update and check modes.
- Validate every release version surface, including the root package manifest,
  against an explicitly supplied expected version.
- Preserve dependency and platform metadata while updating only the root and
  workspace version fields in `package-lock.json`.
- Reuse the complete validation in release preparation before output cleanup.
- Add deterministic tests for stable/prerelease updates, idempotence,
  fail-atomic validation, divergence diagnostics, and release preparation.
- Require the tarball installation smoke test in the quality gate; this check
  resolves package dependencies through the configured npm registry.
- Document the single-command release version workflow.

## Verification

- Requirements and design approvals are current.
- `TEST-RELEASE-VERSION-SYNCHRONIZATION-001..007` provide passing Red/Green
  evidence for REQ-RELEASE-VERSION-SYNCHRONIZATION-001..008.
- `npm run typecheck` passed.
- `npm run build` passed.
- `npm test` passed with 512 tests passed and 8 skipped.
- The focused suite passed with ambient `GITHUB_SHA` set and with
  `npm_execpath` removed.
- `npm run pack:check` passed with 134 files and 9 skills.
- `npm run pack:smoke` passed against the generated tarball.
- `node scripts/release-version.mjs --check 0.1.20` reported no divergence.
- Native rubber-duck review completed with all blocking findings resolved.

## Residual risks

- `CHANGELOG.md` promotion remains an authored review step and is intentionally
  outside mechanical version synchronization.
- Workspace dependency ranges are not changed; adding version-pinned sibling
  dependencies requires a separately approved extension.
- The required `pack:smoke` gate command needs npm registry access when its
  isolated consumer has no warm dependency cache; transient registry failures
  block readiness rather than being treated as a successful package check.
- The managed CLI/test surfaces intentionally require one CLI `.version()`
  literal and two `toBe('<semver>')` assertions; adding another matching
  assertion requires extending the approved locator instead of silently
  broadening the release rewrite.
