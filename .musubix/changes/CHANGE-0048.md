---
schemaVersion: 1
id: CHANGE-0048
summary: Exclude a fixed scratch-file naming convention from the release manifest hash
status: staged
---
# CHANGE-0048: release-manifest scratch-file exclusion

Requirements: REQ-RELEASE-APPROVAL-ORDERING-005

## Intent

Fix GitHub Issue #66: `approval prepare release` / `releaseCandidatePaths`
hashes every untracked file returned by
`git ls-files --others --exclude-standard` into the release manifest. An
operator's ad hoc scratch/debug inspection output written into the worktree
(for example `approval-prepare-release.json`, `relcheck-*.json`, as actually
happened twice during CHANGE-0047/Issue #55) therefore becomes part of the
manifest, changing the reported hash on every re-inspection and triggering
unnecessary approval-hold/re-report cycles.

## Classification

- Defect correction, scoped to the `release`-stage untracked-candidate
  collection step of `releaseCandidateInventory` in
  `packages/analysis/src/approval.ts`. No change to the `requirements` or
  `design` stage manifests (already a fixed allowlist, unaffected), and no
  change to tracked-file handling.

## Impact

- Add a fixed, source-code-hardcoded (not configurable) scratch-path
  predicate applied as a final post-filter on `releaseCandidateInventory`'s
  returned candidate `paths`, gated on untracked origin: excludes any path
  at or beneath `.musubix/scratch/`, and any path whose final segment
  matches `^[^/]+\.scratch\.[^/.]+$` (for example `*.scratch.json`). The
  existing `releaseProjectPaths`/`excludedByStructure` structural
  (nested-workspace/generated-directory) computation still runs against the
  complete, unfiltered candidate set first, so a scratch file's presence or
  absence never changes whether any other path is structurally included or
  excluded (a gap found and fixed during design rubber-duck review).
- Tracked (`git ls-files --cached`) paths are never filtered by this
  predicate, regardless of name, preserving the existing guarantee that
  every committed release input is always part of the hashed manifest.
- New requirement REQ-RELEASE-APPROVAL-ORDERING-005 in the
  `release-approval-ordering` feature's `requirements.md`, plus a design
  update describing the predicate and its placement.
- Document `.musubix/scratch/` and the `*.scratch.<ext>` suffix in
  `README.md` / `README-ja.md` as the sanctioned convention for ad hoc
  operator inspection output during an approval/release session.

## Acceptance

- An untracked file at `.musubix/scratch/<anything>` or matching
  `*.scratch.<ext>` is absent from `approvalManifest(root, 'release')`'s
  `artifacts`/`artifactSha256`, and creating/rewriting/deleting such a file
  across repeated `approval prepare release --json` runs never changes the
  reported hash.
- An ordinary untracked file matching neither pattern continues to appear
  in the manifest and still changes the hash when added/modified/removed.
- A **tracked** file whose name matches either pattern is still included,
  exactly like any other tracked release input.
- `npm run typecheck`, `npm test`, and `npm run build` remain green.

## Verification

- `TEST-RELEASE-APPROVAL-ORDERING-008` (TDD red/green) proves the scratch
  exclusion for both the `.musubix/scratch/` directory and the
  `*.scratch.<ext>` suffix, proves hash stability across repeated
  `approvalManifest` calls while a matching untracked file exists, proves
  an ordinary untracked file is unaffected, and proves a tracked file with
  a matching name is still included.
- `TEST-RELEASE-APPROVAL-ORDERING-009` (TDD red/green) proves the
  nested-workspace structural-marker-derivation ordering is correct: an
  untracked `*.scratch.<ext>` file that also happens to be the sole marker
  establishing a `.csproj`-style generated-directory exclusion still causes
  that exclusion, because structural marker derivation runs against the
  complete, unfiltered candidate set before the scratch post-filter is
  applied.
- `npm run typecheck`
- `npm test`
- `npm run build`
- `trace build`, `trace check --strict`, `graph index`, `graph gate --json`,
  and `gate --changed --json`

## Residual risks

- The fixed `*.scratch.<ext>` naming convention only prevents *future*
  recurrences; it cannot retroactively exclude arbitrarily-named scratch
  files (such as the actual `approval-prepare-release.json` /
  `relcheck-*.json` files from the Issue #55 incident) unless the operator
  adopts the documented convention going forward. This is an accepted
  trade-off versus a heuristic/count-based warning approach, because a
  fixed naming convention keeps the manifest's exclusion set auditable and
  cannot be silently widened to hide a real change.
