---
schemaVersion: 1
id: CHANGE-0023
summary: Prevent publishing stale or mismatched release assets
status: staged
---
# CHANGE-0023: release-asset-publishing

Requirements: REQ-RELEASE-ASSET-PUBLISHING-001 REQ-RELEASE-ASSET-PUBLISHING-002 REQ-RELEASE-ASSET-PUBLISHING-003 REQ-RELEASE-ASSET-PUBLISHING-004

## Intent

Implement GitHub Issue #31. Replace directory-order and single-tarball
assumptions with one explicit tag-bound validator shared by local operators and
GitHub Actions, while restricting provenance-enabled publishing to GitHub
Actions.

## Impact

- Require an explicit stable release tag, repository, and release-assets
  directory for every validation or publish.
- Validate exact tarball filename and embedded package identity.
- Verify local checksums and bind every required local asset to the current
  non-draft uploaded digest reported by the selected GitHub Release.
- Reject any local `release-assets/` listing that is not exactly the four
  required assets, including extra non-tarball files.
- Provide local verify-only operation and reject local publish attempts before
  npm invocation.
- Keep provenance-enabled npm publishing behind the existing protected
  environment while removing duplicated workflow validation.
- Add deterministic tests and bilingual operator documentation.

## Assumptions

- `release-assets/` is ignored local output; historical tarballs are leftover
  local artifacts rather than tracked release inputs.
- `SHA256SUMS` continues to bind the prepared npm tarball and CycloneDX SBOM.
- `musubix3-attestation.json` remains separate strict GitHub OIDC evidence
  created and verified by the release workflow before the GitHub Release is
  published.
- Published, non-draft GitHub Release asset digest metadata is available
  through `gh release view`; a query failure blocks publishing.
- npm's `--provenance` output remains the registry-side provenance record.

## Verification

- Requirements approval was recorded for
  `c5e018458b96687c2d0e23edecec31c247f72b956396206ea332f3b52e79b6e5`.
- Design approval was recorded for
  `c3220225c262f1b32dc3951ed76784cf7e9fe18231777b37b1d49ff75900c85a`.
- TDD recorded real failing Red and passing Green evidence for canonical
  arguments, closed asset selection, digest-bound archive inspection,
  verify-only/CI-only publishing, privileged workflow drift, fully qualified
  tag checkout, exact-byte inspection, and repository identity validation.
  Corrective Red/Implementation/Green batches for all four requirements
  supersede the initial Green checkpoint after review-driven test expansion.
- `release-asset-publishing-tests` passed 14/14 tests and
  `github-actions-node24-runtime-tests` passed 3/3 tests.
- The full suite passed 545 tests with 8 skipped across 51 passing test files
  and one skipped native-adapter file.
- `npm run typecheck`, `npm run build`, `npm run pack:check`, and
  `npm run pack:smoke` passed. Package verification covered 137 files and nine
  skills; smoke verification covered the executable, ESM exports, init, status,
  assets, and hidden skills.
- Strict traceability reported 691 nodes, 1223 edges, zero diagnostics, and
  design/implementation/test link coverage of 1.0/1.0/1.0.
- The compatible Code Graph gate passes with eight unresolved dynamic-loading
  warnings, including the intentional query-string dynamic import used to
  isolate the release publisher test module.
- Successive native implementation reviews raised security and policy
  blockers; all were corrected. The final review reported zero blocking
  findings after qualifying both privileged checkout refs as `refs/tags/...`
  and replacing permissive workflow normalization with exact reviewed source
  hashes.
- The current changed gate fails its required `workflow` check because all 75
  declarations are unreconciled (`WORKFLOW_INVOCATION_UNVERIFIED`) and fails
  its required `approval` check because release approval is stale. The previous
  HEAD evidence passed workflow reconciliation.
- The recorded quality evidence predates this corrected CHANGE record;
  `status` reports `gate.status: stale` because only
  `.musubix/changes/CHANGE-0023.md` differs from its fingerprint, so quality
  evidence must be regenerated before release approval.
- Reconciliation of the Issue #31 session remains unproven: `workflow-sanitize`
  rejects its transcript because a terminal `session.shutdown` is followed by
  later events. That failure must not be bypassed by truncating the transcript.
- The changed workflow declarations also invalidate 63 previously recorded
  workflow waivers. After successful compatible verification resolves
  `WORKFLOW_INVOCATION_UNVERIFIED`, those declaration-scoped waivers require
  explicit human review and re-recording before release approval can make the
  gate ready.

## Residual risks

- npm must ultimately open the validated absolute tarball path. The publisher
  re-reads and hashes that path immediately before invoking npm, but the
  filesystem cannot make the check and npm's subsequent open atomic.
- The strict tar parser intentionally rejects PAX/GNU extension entries. The
  current 137-file package passes, but a future package path exceeding USTAR
  limits will fail closed until the format policy is reviewed.
- Both the local `release-assets/` directory and the selected GitHub Release
  must contain exactly the four defined assets; extra files of any type fail
  closed. The `RELEASE_PUBLISH_ASSET_SET` diagnostic lists only observed
  tarballs.
- GitHub CLI capability is documented rather than version-pinned. A runner
  lacking `assets.digest` or `assets.state` support fails closed before npm.
- Workflow reconciliation and 63 stale waiver replacements are unresolved
  release-readiness blockers; `status.next` listing release approval actions
  does not override `gate.ready: false`.
- The rewritten privileged npm publishing path has not executed against a real
  release. Deferred release/npm-publish evidence and post-merge CI evidence
  remain pending until the next approved publication and default-branch run.
