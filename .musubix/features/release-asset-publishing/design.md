---
schemaVersion: 1
feature: release-asset-publishing
---
# Release asset publishing design

## DES-RELEASE-ASSET-PUBLISHING-001: Canonical publish request parser
Responsibilities: Parse the one supported silent npm-script argument sequence; validate stable tag, repository, directory, optional verify-only mode, and npm CLI availability without filesystem, GitHub, or publish side effects; normalize tag to the bare package version and directory to an absolute path.
Interfaces: `parseReleasePublishArguments(args, cwd, npmExecPath) -> ReleasePublishRequest`; `ReleasePublishRequest = { verifyOnly, tag, version, repository, directory, npmExecPath }`; invalid input throws `ReleasePublishValidationError` with a stable code and message.
Constraints: Accept only `--verify-only? --tag <tag> --repository <owner/repo> --directory <path>` in canonical order; reject prerelease/build metadata and whitespace-normalized variants rather than repairing them; resolve relative directories from the caller's cwd; after argument syntax succeeds, require `npmExecPath` to be an existing regular non-symlink file with a `.js` suffix; perform no asset reads or subprocess calls.
Requirements: REQ-RELEASE-ASSET-PUBLISHING-001
ADRs: ADR-0037

## DES-RELEASE-ASSET-PUBLISHING-002: Closed-set local release validator
Responsibilities: Require a real readable directory containing exactly four expected regular non-symlink files; enumerate and diagnose observed tarballs; parse the exact two-entry SHA256SUMS contract; hash all four assets; validate checksum targets; return normalized local asset metadata without parsing untrusted archive contents.
Interfaces: `validateLocalReleaseAssets(request, dependencies?) -> LocalReleaseAssets`; `LocalReleaseAssets = { request, tarball, assets: Array<{ name, path, sha256 }> }`; injectable filesystem operations provide deterministic fault tests.
Constraints: Use Node.js built-ins; compare basenames by Unicode code-point order without locale collation; use `lstat` before reading; require the exact `<hex><two spaces><basename>` checksum syntax and one final newline; reject binary markers, symlinks, special files, unsafe names, duplicate or additional entries, and malformed hexadecimal digests.
Requirements: REQ-RELEASE-ASSET-PUBLISHING-002 REQ-RELEASE-ASSET-PUBLISHING-003
ADRs: ADR-0037
Depends-On: DES-RELEASE-ASSET-PUBLISHING-001

## DES-RELEASE-ASSET-PUBLISHING-003: GitHub Release digest binder
Responsibilities: Query the explicit repository and tag through the GitHub CLI; validate one non-draft release document; require a closed four-asset set with uploaded state and one lowercase SHA-256 digest each; compare every GitHub digest with the corresponding local byte digest; return digest-bound assets for archive inspection.
Interfaces: `bindGithubReleaseAssets(local, dependencies?) -> GithubBoundReleaseAssets`; injected `execFileSync` isolates GitHub success, absence, nonzero exit, malformed JSON, and schema drift.
Constraints: Invoke exactly `gh release view <tag> --repo <repository> --json tagName,isDraft,assets`; require the returned `tagName` to equal the request tag; never fall back to local-only success; reject duplicate, missing, additional, or non-uploaded assets and any digest not matching `sha256:<64 lowercase hex>`; strip the GitHub `sha256:` prefix only for comparison, retain each bare lowercase local byte digest as the eventual report value, and order assets by Unicode code point; preserve the absolute validated tarball path.
Requirements: REQ-RELEASE-ASSET-PUBLISHING-003 REQ-RELEASE-ASSET-PUBLISHING-004
ADRs: ADR-0037
Depends-On: DES-RELEASE-ASSET-PUBLISHING-002

## DES-RELEASE-ASSET-PUBLISHING-004: Digest-gated npm archive inspector
Responsibilities: After GitHub digest equality is established, decompress the tarball within a fixed output bound; parse and checksum every tar header; construct each path from the ustar prefix and name fields; require exactly one regular `package/package.json`; validate its JSON package identity; inspect the complete archive before success.
Interfaces: `inspectNpmTarball(bound, dependencies?) -> ReleaseAssetVerification`; `ReleaseAssetVerification = { valid: true, repository, tag, version, tarball, assets: Array<{ name, sha256 }> }`.
Constraints: Use Node.js built-in gzip with `maxOutputLength` of 64 MiB; accept only regular entries (`0` or NUL) and directory entries (`5`); reject PAX global/local headers, GNU long-name/link entries, vendor extensions, sparse entries, links, devices, unsupported base-256 sizes, invalid header checksums, nonempty ustar prefix for the package manifest, absolute or traversal paths, truncated entries, duplicate manifests, invalid UTF-8/JSON, and trailing nonzero data after the two zero end blocks.
Requirements: REQ-RELEASE-ASSET-PUBLISHING-003 REQ-RELEASE-ASSET-PUBLISHING-004
ADRs: ADR-0037
Depends-On: DES-RELEASE-ASSET-PUBLISHING-003

## DES-RELEASE-ASSET-PUBLISHING-005: Verify-only and CI publish orchestration
Responsibilities: Compose request parsing, local validation, GitHub binding, and archive inspection; in verify-only mode emit exactly one JSON document; reject publishing outside GitHub Actions; in CI publish mode invoke the npm CLI once for the validated absolute tarball with public access and provenance; expose pure orchestration functions and a fail-closed CLI from `scripts/release-publish.mjs`.
Interfaces: `validateReleaseForPublish(request, dependencies?) -> ReleaseAssetVerification`; `publishReleaseAssets(request, environment, dependencies?) -> ReleaseAssetVerification`; `runReleasePublish(args, environment, dependencies?) -> ReleaseAssetVerification`; `scripts/release-publish.mjs` remains excluded from the npm package by the root `files` allowlist.
Constraints: Never invoke npm before all validation succeeds, `GITHUB_ACTIONS === "true"`, and `GITHUB_REPOSITORY === request.repository`; call `process.execPath` with `[npmExecPath, "publish", tarball, "--provenance", "--access", "public"]`; pass a copied environment, retaining `NODE_AUTH_TOKEN` only when present; propagate subprocess failure; reserve CLI stdout for verify-only JSON while publish inherits npm stdio; avoid `process.exit` in exports; preserve existing package distribution boundaries and pack checks.
Requirements: REQ-RELEASE-ASSET-PUBLISHING-001 REQ-RELEASE-ASSET-PUBLISHING-003 REQ-RELEASE-ASSET-PUBLISHING-004
ADRs: ADR-0037
Depends-On: DES-RELEASE-ASSET-PUBLISHING-004

## DES-RELEASE-ASSET-PUBLISHING-006: Workflow, policy, and operator integration
Responsibilities: Make both GitHub Actions publishing paths consume an explicit stable GitHub Release through the shared script; gate the release workflow's publish job to stable tags after GitHub Release creation; check out the selected tag and install its implementation; download into a new empty directory; update bilingual operator guidance; protect these contracts with deterministic workflow/document tests.
Interfaces: `.github/workflows/release.yml`; `.github/workflows/npm-publish.yml`; `README.md`; `README-ja.md`; `tests/release-asset-publishing.test.ts`; `.musubix/config.json` command `release-asset-publishing-tests`.
Constraints: Use existing immutable action pins; no workflow-local checksum, tar selection, package extraction, or direct npm publish command; use `npm run --silent release:publish -- --tag "$RELEASE_TAG" --repository "$GITHUB_REPOSITORY" --directory release-assets`; expose an exact stable-tag output from the validate job and conjunct it with the existing `inputs.publish_npm == true || vars.NPM_TRUSTED_PUBLISHING == 'true'` opt-in while using `needs: [validate, attest, github-release]`; exact tag validation remains owned by the shared script; retain `environment: npm-publish`, `contents: read`, `id-token: write`, and job `GH_TOKEN`; standalone dispatch describes stable tags only; both paths checkout the tag, run `npm ci`, create a new empty download directory, and download the selected release; docs cover `gh auth status`, require a GitHub CLI that supports `assets.digest` and `assets.state`, fresh download, local verify-only, CI-only publishing, stable tags, stale-tarball refusal, checksums, embedded identity, GitHub digests, protected environment, provenance, and why direct prepare output is not publishable.
Requirements: REQ-RELEASE-ASSET-PUBLISHING-001 REQ-RELEASE-ASSET-PUBLISHING-004
ADRs: ADR-0037
Depends-On: DES-RELEASE-ASSET-PUBLISHING-005
