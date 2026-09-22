---
schemaVersion: 1
feature: github-actions-node24-runtime
---
# GitHub Actions Node.js 24 runtime

Source: GitHub Issue #34 and workflow run 35674614899.

## REQ-GITHUB-ACTIONS-NODE24-RUNTIME-001: Use supported action runtimes
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The repository shall use GitHub Actions releases whose JavaScript actions declare the supported Node.js 24 runtime.
Acceptance: Every external non-local and non-`docker://` `uses:` reference in `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `.github/workflows/npm-publish.yml` has exactly one entry in `scripts/github-actions-lock.json`, and the lock has no unreferenced entries; each entry records the repository, exact commit SHA, reviewed release tag, action kind, observed `runs.using` value from `action.yml` when the kind is JavaScript, immutable GitHub source URL, review date, reviewer, every crossed major release, and the immutable upstream release or migration-note URLs reviewed for those majors; a deterministic offline test executed by the existing `npm test` command rejects missing, duplicate, stale, malformed, or mismatched metadata, incomplete crossed-major review metadata, a JavaScript runtime other than `node24`, or an external action without explicit kind classification; this test verifies the checked-in reviewed metadata rather than refetching live action content; the first post-merge CI run is checked with `gh run view <run-id> --log` followed by a literal zero-match check for `The following actions target Node.js 20`, and the exact command, run URL, and result are recorded in the change evidence before completion; the first later release and npm-publish runs used for publication are subject to the same log check and recording obligation as deferred release-operation evidence.

## REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002: Preserve immutable and least-privilege workflows
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The repository shall pin each external action to an immutable full commit SHA and preserve the protected workflow behavior recorded at baseline commit `7f1f45297a5bef4413257c42071c12fba91cc9e8`.
Acceptance: Every external `uses:` reference is a 40-character lowercase hexadecimal commit SHA whose adjacent version comment equals the reviewed tag recorded for that SHA; `tests/fixtures/github-actions-node24-runtime/baseline.json` contains the protected workflow values extracted from baseline commit `7f1f45297a5bef4413257c42071c12fba91cc9e8` and records each source path, Git blob ID, and source-byte SHA-256: `.github/workflows/ci.yml` blob `9d50637ca015041aa6ab5b9e18dd5b2b30811dad` SHA-256 `7e33bf761781450ff6bbc26107436fbe7ec75afa11592451a3e914fe4b0a8f91`, `.github/workflows/release.yml` blob `9dcf0a6cfeaa855c67127e2af112a43fb0896292` SHA-256 `8270e75010fedb0411dfeb60d6a3af0144ab3c5ce3f2405f01b04a512cef2e03`, and `.github/workflows/npm-publish.yml` blob `10f3101d44661d44d8cc3e1ab270841d2ccc6a3f` SHA-256 `8f96f689963fd720ea9155203e2933aebf1f160a8d0b94911113b1ca81859610`; before requirements approval, CHANGE-0021 records successful `git rev-parse <commit>:<path>` and `git show <commit>:<path> | sha256sum` correspondence checks for all three paths, while ordinary shallow-checkout tests trust the fixed reviewed provenance fields; compared with that fixture, action SHAs, version comments, and action-input changes listed in CHANGE-0021 under `## Upstream-mandated input changes` as pipe-delimited data rows `action | input | baseline | replacement | immutable upstream source` are the only permitted differences among the enumerated protected values; the Markdown header and separator are ignored and no input changes are represented by zero data rows; job and step identities and order, `on` triggers, workflow and job `permissions`, `if` conditions, environments, concurrency settings, all other action inputs including each `node-version`, the `node-compatibility` matrix, npm OIDC/provenance flags, and publication commands remain unchanged; deterministic tests executed by the existing `npm test` command enforce these invariants without adding a workflow step; focused static contract tests derive each artifact's resolved destination files from the upload artifact name and upload root semantics, the corresponding download artifact name and destination directory, and later command references, then require the expected tarball, checksum, and attestation file paths to resolve identically under the destination, so reviewed major-version default changes cannot silently alter the declared release hand-off.

## REQ-GITHUB-ACTIONS-NODE24-RUNTIME-003: Define the hosted runner compatibility policy
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The repository shall document the intentional use of GitHub-maintained floating hosted-runner labels and require compatibility validation when GitHub changes their selected images.
Acceptance: `README.md` and `README-ja.md` state that the CI portability matrix intentionally uses `ubuntu-latest`, `windows-latest`, and `macos-latest`, that all other CI jobs plus release and npm publication use `ubuntu-latest`, and that a hosted-image migration requires revalidation of toolchain installation, typecheck, build, tests, package checks, release preparation, provenance, and publication controls; deterministic tests executed by the existing `npm test` command assert both documents and workflow runner labels remain consistent with this policy.
