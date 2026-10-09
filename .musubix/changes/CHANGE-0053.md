---
schemaVersion: 1
id: CHANGE-0053
summary: Add an opt-in fast re-approval path for rebase-only approval-manifest drift
status: staged
---
# CHANGE-0053: approval-rebase-fast-reapproval

Requirements: REQ-APPROVAL-REBASE-FAST-REAPPROVAL-001 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-003 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-005 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-006 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-007

## Intent and classification

Feature addition (new optional CLI capability): implements GitHub Issue #71
("Reduce rebase-triggered re-approval friction for parallel in-flight
changes"). `approval prepare <stage> --json`'s `requirements`/`design` and
`release` manifests are project-wide, not scoped to one change's own files.
When a sibling in-flight branch merges to `origin/main` first, every other
branch's already-recorded approval hash goes stale purely because the
manifest now includes that sibling's merged content, even when the current
change's own files are byte-identical to what a human already approved
(observed live during CHANGE-0049/Issue #67, after CHANGE-0048/Issue #66
merged).

This change adds a new, strictly opt-in `approval record <stage>
--fast-reapprove --own-files <path...>` path that lets a reviewer, who has
already manually confirmed that a rebase only touched files outside their
own change, re-record their original approval decision for the new manifest
hash without re-reading content they already reviewed — while keeping every
existing precondition (`--confirm`, exact full-manifest `--artifact-sha256`
match, approver/hash-format/domain validation, release-stage
requirements/design/gate prerequisites) fully in force, and requiring the
identical prior approver. This is not a weakening of the approval model: the
full manifest hash is still computed and bound exactly as before; only the
human re-review burden for provably-unchanged own files is reduced.

All seven listed requirements are new obligations for this new feature; no
existing requirement's statement or acceptance criteria changes.

## Impact inspection

- `packages/analysis/src/approval.ts`: add `fastReapprovalEligibility()`
  (pure helper reusing the existing `artifactDrift()`); extend
  `ApprovalEvidence` with optional `fastReapproval`/`priorArtifactSha256`
  fields; extend `loadApproval`'s schema validation to accept both the
  existing shape and the new optional-fields shape.
- `packages/analysis/src/approval-record.ts`: extract
  `validateRecordPreconditions()` from `recordApprovalUnlocked` (pure
  refactor, no behavior change for the existing non-fast path — proven by
  the existing `tests/approval.test.ts`/`tests/approval-domain-scoping.test.ts`
  suites passing unmodified); add `recordFastReapproval()` implementing the
  deterministic 7-step check order from DES-APPROVAL-REBASE-FAST-REAPPROVAL-002.
- `packages/cli/src/main.ts`: add `--fast-reapprove` and `--own-files
  <path...>` options to the existing `approval record <stage>` command.
- `.musubix/features/approval-rebase-fast-reapproval/{requirements,design}.md`,
  `.musubix/decisions/ADR-0045.md`: new feature specification and decision
  record (already authored and approved).
- New test file (name to be finalized at Red time) covering each
  REQ-APPROVAL-REBASE-FAST-REAPPROVAL-00x acceptance criterion.
- `README.md`: document the new `--fast-reapprove`/`--own-files` option pair
  alongside the existing `approval record`/`approval prepare --diff-only`
  documentation, once implementation is Green.
- `CHANGELOG.md`: add an `## Unreleased` entry once release-candidate
  evidence is ready.

No other existing requirement, design element, or test is modified by this
change.
