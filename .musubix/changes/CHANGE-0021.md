---
schemaVersion: 1
id: CHANGE-0021
summary: Update GitHub Actions to supported Node.js 24 action runtimes
status: completed
---
# CHANGE-0021: github-actions-node24-runtime

Requirements: REQ-GITHUB-ACTIONS-NODE24-RUNTIME-001 REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002 REQ-GITHUB-ACTIONS-NODE24-RUNTIME-003

## Intent

Remove the Node.js 20 action-runtime deprecation warning from CI, release, and
npm publication while retaining immutable action pins and the current security,
provenance, and publication behavior.

## Impact

- Replace every official GitHub Action pin in the three repository workflows
  with a reviewed Node.js 24 action release pinned by full commit SHA.
- Add a repository-maintained action lock manifest with upstream source and
  review provenance, plus an offline deterministic checker for exact workflow
  coverage, SHA, tag, action kind, and reviewed runtime metadata.
- Preserve workflow triggers, permissions, environments, concurrency,
  tested Node.js versions, provenance, publication controls, and every action
  input not explicitly listed in the machine-checked upstream-mandated input
  change table, relative to baseline commit
  `7f1f45297a5bef4413257c42071c12fba91cc9e8`, represented by a checked-in
  protected-value fixture that works in shallow CI checkouts.
- Review and record the upstream migration notes for every crossed Action major,
  with focused release-artifact contract tests for names, destination paths,
  extracted files, checksums, and attestation hand-off.
- Add deterministic tests that inspect workflow action pins and protected
  workflow semantics.
- Document the intentional three-OS portability matrix, the remaining
  `ubuntu-latest` jobs, and their hosted-image compatibility-validation
  obligation.
- No TypeScript runtime package behavior or public CLI interface changes.

## Acceptance

- Every external JavaScript action is covered by reviewed lock metadata and
  declares the Node.js 24 action runtime.
- Every external action remains pinned to an immutable 40-character SHA with
  an accurate reviewed-tag comment.
- Tests prove protected workflow structure and release semantics match baseline
  commit `7f1f45297a5bef4413257c42071c12fba91cc9e8`.
- `README.md` and `README-ja.md` accurately document the CI OS matrix,
  `ubuntu-latest` usage, and hosted-image migration validation.
- After merge, the first relevant CI, release, and npm-publish run URLs are
  checked with `gh run view <run-id> --log`; CI evidence is required before
  completion, while release and npm-publish evidence is recorded when the next
  publication executes those deferred operational obligations.

## Verification

- Requirements approval was recorded for artifact
  `e65f95e1949c7c031a51190a2d080b62bf46cacbc0e9076f2a449511a4dacdd9`.
- Design approval was recorded for artifact
  `84980ea49298a2b3391028de4d6eb34036c93358cfe9a5ead0c024eab7575dce`.
- `TEST-GITHUB-ACTIONS-NODE24-RUNTIME-001`, `-002`, and `-003` each recorded a
  real failing Red and passing Green; `-003` also recorded a corrective
  Red/Green cycle for this evidence summary after the first Quality checkpoint.
- The action lock, protected-workflow contract, and hosted-runner documentation
  checks pass with no diagnostics.
- `npm run typecheck`, `npm run build`, 525 passed/8 skipped tests,
  `npm run pack:check`, and `npm run pack:smoke` passed.
- Strict trace coverage is design 1.0, implementation 1.0, and tests 1.0;
  graph gate passes with only the repository's existing compatible-mode dynamic
  import warnings.
- The changed quality gate passed all required non-approval checks after
  compatible transcript verification and the explicitly approved historical
  workflow residual waiver refresh.
- Baseline correspondence evidence below is complete.
- Post-merge CI evidence: https://github.com/nahisaho/musubix3/actions/runs/35746618493.
  `gh run view 35746618493 --log` returned zero literal matches for
  `The following actions target Node.js 20`.
- Deferred release/npm-publish evidence: pending until the next real
  publication; do not trigger a release solely to manufacture this evidence.

## Baseline correspondence evidence

- `git rev-parse 7f1f45297a5bef4413257c42071c12fba91cc9e8:.github/workflows/ci.yml`
  returned `9d50637ca015041aa6ab5b9e18dd5b2b30811dad`.
- `git show 7f1f45297a5bef4413257c42071c12fba91cc9e8:.github/workflows/ci.yml | sha256sum`
  returned `7e33bf761781450ff6bbc26107436fbe7ec75afa11592451a3e914fe4b0a8f91`.
- `git rev-parse 7f1f45297a5bef4413257c42071c12fba91cc9e8:.github/workflows/release.yml`
  returned `9dcf0a6cfeaa855c67127e2af112a43fb0896292`.
- `git show 7f1f45297a5bef4413257c42071c12fba91cc9e8:.github/workflows/release.yml | sha256sum`
  returned `8270e75010fedb0411dfeb60d6a3af0144ab3c5ce3f2405f01b04a512cef2e03`.
- `git rev-parse 7f1f45297a5bef4413257c42071c12fba91cc9e8:.github/workflows/npm-publish.yml`
  returned `10f3101d44661d44d8cc3e1ab270841d2ccc6a3f`.
- `git show 7f1f45297a5bef4413257c42071c12fba91cc9e8:.github/workflows/npm-publish.yml | sha256sum`
  returned `8f96f689963fd720ea9155203e2933aebf1f160a8d0b94911113b1ca81859610`.

## Residual risks

- GitHub may change the image behind `ubuntu-latest`; the documented policy
  requires revalidation rather than assuming image stability.
- Action release behavior is externally maintained, so reviewed immutable SHAs
  remain necessary even after the runtime migration.

## Upstream-mandated input changes

action | input | baseline | replacement | immutable upstream source
--- | --- | --- | --- | ---
