---
schemaVersion: 1
id: CHANGE-0051
summary: Add --diff-only output to approval prepare so human reviewers see only changed files
status: staged
---
# CHANGE-0051: approval-prepare-diff-only

Requirements: REQ-APPROVAL-PREPARE-DIFF-ONLY-001 REQ-APPROVAL-PREPARE-DIFF-ONLY-002 REQ-APPROVAL-PREPARE-DIFF-ONLY-003 REQ-APPROVAL-PREPARE-DIFF-ONLY-004 REQ-APPROVAL-PREPARE-DIFF-ONLY-005 REQ-APPROVAL-PREPARE-DIFF-ONLY-006 REQ-APPROVAL-PREPARE-DIFF-ONLY-007

## Intent

Fix GitHub Issue #68: `approval prepare <stage> --json` hashes every
tracked+untracked artifact (300+ files) into `artifacts`/`artifactSha256`,
which is correct for cryptographic integrity but impractical for a human
reviewer to read. Prior CHANGEs (Issues #56/#57/#58/#61/#64/#55) each
required a manual `git diff`/ad-hoc comparison to extract "only the files
that actually changed" before presenting an approval request to a human,
especially since `design` approval's manifest includes all of
`requirements`'s files and `release`'s includes all of `design`'s.

This change adds an opt-in `--diff-only` flag to `approval prepare <stage>
--json` that adds a `changedFiles` array (plus a `diffOnlyBaseline` state
field) listing only the paths whose content differs from the last recorded
approval for that exact stage and domain. The full `artifactSha256` and
`artifacts` map are always computed and returned exactly as before — this
is a strictly additive, non-breaking output enhancement; no cryptographic
guarantee is weakened and `approval record` is unaffected.

## Classification

Feature/enhancement to the `approval` CLI command (new opt-in output mode).
No existing requirement's statement or acceptance criteria changes.

## Impact

- `packages/analysis/src/approval.ts`: add a `diffOnlyChangedFiles` (or
  equivalently named) helper that, given the current manifest and the
  previously loaded `ApprovalEvidence | null` for the same stage/domain,
  computes the sorted list of added/modified/removed paths, or all current
  paths with `diffOnlyBaseline: 'none'` when no prior evidence exists.
  Corrupted/invalid prior evidence continues to throw exactly as
  `loadApproval` already does (REQ-APPROVAL-PREPARE-DIFF-ONLY-007); no new
  silent fallback path is added.
- `packages/cli/src/main.ts`: add a `--diff-only` option to `approval
  prepare <stage>`, wire it to the new helper, and adjust the non-`--json`
  console summary to show only `changedFiles` (plus the hash and baseline)
  when `--diff-only` is set.
- `.musubix/features/approval-prepare-diff-only/{requirements,design}.md`:
  new feature directory (new REQ-APPROVAL-PREPARE-DIFF-ONLY-001..007 and
  DES-APPROVAL-PREPARE-DIFF-ONLY-*).
- `.musubix/decisions/`: no new ADR expected (reuses the existing
  `ApprovalManifest`/`ApprovalEvidence` schema without changing it); will
  add one if design review determines the comparison algorithm needs a
  dedicated ADR.
- `tests/approval.test.ts` (or a new `tests/approval-diff-only.test.ts`):
  new TDD-covered tests for: nothing changed since last approval, some
  files changed (added/modified/removed), and no prior approval at all
  (first-ever approval for that stage/domain), plus domain-scoping and
  corrupted-evidence cases.
- `README.md` (and any CLI help text) updated to document `--diff-only`.
- No change to `ApprovalManifest`/`ApprovalEvidence`/`approvalManifest()`'s
  existing return shape or hashing; `changedFiles`/`diffOnlyBaseline` are
  new, additional fields present only when `--diff-only` is passed.

## Acceptance

- `change-record CHANGE-0051 impact/requirements/design/red/implementation/
  green/quality` all succeed in that order.
- A fresh `requirements`/`design`/`release` approval cycle is prepared and
  recorded as needed for this change's own artifacts.
- Genuine Red (failing) then Green (passing) TDD cycles are recorded for
  each new `TEST-APPROVAL-PREPARE-DIFF-ONLY-*` test, each linked via
  `@verifies` to its requirement.
- `gate --changed --json` / full `gate --json` report zero new errors.
- `npm run typecheck`, `npm run build`, and `npm test` all pass.
- `npm run pack:check` passes (no distribution-breaking change expected,
  but run since this touches a published CLI command's public behavior).

## Verification

- `approval prepare requirements --json` / `approval prepare design --json`
  / `approval prepare release --json`, each also exercised with
  `--diff-only`.
- `approval record requirements`/`design`/`release` using the exact
  reviewed hash.
- `tdd red`/`tdd green` for each new test ID.
- `trace build`, `trace check --strict`, `graph index`, `graph gate --json`,
  `gate --changed --json`, full `gate --json`, `status --json`.

## Residual risks

- `changedFiles` compares against the last *recorded* approval, not
  against the previous `approval prepare` invocation (which may differ if
  the project changed again without an intervening `approval record`).
  This mirrors the existing `artifactSha256` staleness model (comparison is
  always against recorded evidence, never against an ephemeral prior
  `prepare` call) and is called out explicitly in the design/requirements
  so reviewers are not misled.
- The project-wide (non-domain-scoped) `requirements`/`design` manifest
  scope — already flagged as a residual risk in CHANGE-0050 — is
  unchanged by this feature; `--diff-only` reduces the *display* burden
  but does not alter the underlying project-wide artifact scope.
