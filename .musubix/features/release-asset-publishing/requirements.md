---
schemaVersion: 1
feature: release-asset-publishing
---
# Release asset publishing

Source: GitHub Issue #31. Historical tarballs may remain in the ignored local
`release-assets` output directory, while the current `release:publish` command
selects whichever sole `.tgz` happens to be present. Publishing must instead be
bound to one explicit reviewed stable release tag and the exact assets uploaded
to that GitHub Release. The existing release workflow remains responsible for
creating and verifying strict GitHub OIDC attestation evidence; this feature
binds every required local asset to GitHub's current non-draft uploaded
release-asset digest,
validates npm package identity, and preserves npm provenance at the final
registry boundary.

## REQ-RELEASE-ASSET-PUBLISHING-001: Publishing requires one explicit release identity
Priority: must
Type: functional
Pattern: event-driven
Statement: When an operator or GitHub Actions requests npm release-asset validation or publishing, the system shall require exactly one explicit stable tag, repository, and release-assets directory before inspecting assets, querying GitHub, or invoking npm.
Acceptance: The shared entrypoints are `npm run --silent release:publish -- --verify-only --tag <vSEMVER> --repository <owner/repo> --directory <path>` and the same command without `--verify-only` for GitHub Actions publishing; `<vSEMVER>` is exactly lowercase `v` followed by three dot-separated nonnegative decimal integers with no leading zero except `0`, so prerelease and build metadata tags are rejected; `--tag`, `--repository`, and `--directory` each occur exactly once with a nonempty value, `--verify-only` occurs at most once, and arguments are accepted only in that canonical order; `<owner/repo>` contains exactly one slash and GitHub-compatible nonempty owner/repository segments; relative directories resolve from the current working directory; missing, repeated, unknown, positional, reordered, whitespace-padded, non-`v`, or invalid values fail nonzero before reading the asset directory, querying GitHub, or invoking npm; `npm_execpath` is required and must resolve to an existing regular non-symlink `.js` file before asset inspection; local operators use verify-only, while both `.github/workflows/release.yml` and `.github/workflows/npm-publish.yml` use the publishing form with their explicit selected tag, repository, and directory.

## REQ-RELEASE-ASSET-PUBLISHING-002: Publishing accepts only the exact tag-bound tarball
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If the release-assets directory does not contain exactly the npm tarball named for the explicit stable tag, then the system shall refuse validation and publishing.
Acceptance: For tag `v1.2.3`, the only accepted `.tgz` basename is `musubix3-1.2.3.tgz`; the directory must exist as a readable real directory rather than a symlink; the expected tarball must be a readable regular file rather than a symlink; a missing, unreadable, non-directory, or symlink directory, zero tarballs, a differently named sole tarball, an additional historical tarball, a symlink, or any non-regular expected path fails nonzero before querying GitHub or invoking npm; diagnostics identify the expected basename and the sorted observed `.tgz` basenames when directory enumeration succeeds.

## REQ-RELEASE-ASSET-PUBLISHING-003: Publishing verifies release checksums and package identity
Priority: must
Type: functional
Pattern: event-driven
Statement: When the exact tag-bound tarball is present, the system shall verify its prepared-release checksum, embedded npm package identity, and current GitHub Release asset identity before invoking npm.
Acceptance: The local directory contains only `musubix3-<version>.tgz`, `musubix3.cdx.json`, `SHA256SUMS`, and `musubix3-attestation.json`, each a readable regular file rather than a symlink; `SHA256SUMS` contains exactly one line `<lowercase-64-hex><two spaces><tarball-basename>` and one line `<lowercase-64-hex><two spaces>musubix3.cdx.json`, with one final newline and no duplicate, additional, binary-marker, absolute, or traversal entry, and both byte digests match; after hashing the closed local set, the shared implementation queries `gh release view <tag> --repo <owner/repo> --json tagName,isDraft,assets`, requires the returned tag to equal the explicit tag and `isDraft` to be false, requires the GitHub Release to contain only the same four asset basenames, each with `state: "uploaded"` and a lowercase `sha256:<64-hex>` digest, and requires every local file digest to equal its GitHub asset digest; only after all digest comparisons pass, the gzip tarball is decompressed and parsed completely and must contain exactly one regular `package/package.json`, whose parsed JSON has exactly `name: "musubix3"` and `version: "<version>"`; an absent or draft release, missing `gh` executable, nonzero query exit, network/authentication/rate-limit failure, unparseable or schema-invalid query output, non-uploaded, missing, duplicate, or additional local or GitHub asset, malformed digest, unsafe checksum path, checksum mismatch, local/GitHub digest mismatch, unreadable or non-regular file, invalid gzip/tar/JSON, or package-identity mismatch fails nonzero before invoking npm without degrading to local-only success; successful validation returns the exact absolute tarball path plus normalized repository, tag, version, and asset digests.

## REQ-RELEASE-ASSET-PUBLISHING-004: One validated path performs provenance-enabled publishing
Priority: must
Type: functional
Pattern: event-driven
Statement: When all release identity and asset validations succeed, the system shall either report verified identity without publishing or publish only the validated tarball through npm with public access and provenance enabled.
Acceptance: With `--verify-only`, the shared implementation exits zero, writes exactly one JSON document and no other stdout text with exact top-level keys `{ valid: true, repository, tag, version, tarball, assets }`, where `tarball` is the absolute validated path and `assets` is the four entries `{ name, sha256 }` sorted by Unicode code-point basename order with each `sha256` encoded as a bare lowercase 64-character hexadecimal digest, and never invokes npm publish; without `--verify-only`, publishing proceeds only when `GITHUB_ACTIONS` equals exactly `"true"` and `GITHUB_REPOSITORY` equals the explicit `<owner/repo>`, while an unset or different value fails nonzero before npm invocation; an accepted GitHub Actions publish invokes the current npm CLI exactly once as `npm publish <absolute-validated-tarball> --provenance --access public`, preserves `NODE_AUTH_TOKEN` when set and omits it when unset, inherits stdio, and propagates npm failure without a success-shaped fallback; `.github/workflows/release.yml` derives a stable-tag job output using the exact stable grammar and runs npm publishing only when that output is true and the existing opt-in condition `inputs.publish_npm == true || vars.NPM_TRUSTED_PUBLISHING == 'true'` is also true, while making the job depend on successful GitHub Release creation; `.github/workflows/npm-publish.yml` describes and accepts only stable tags; both publish jobs retain `environment: npm-publish`, `contents: read`, and `id-token: write`, provide `GH_TOKEN`, check out the explicit release tag, install with `npm ci`, download that exact GitHub Release into a newly created empty directory, and call the shared silent entrypoint with explicit tag, repository, and directory; neither workflow contains independent tarball selection, checksum, package-version, nor direct `npm publish` logic; README.md and README-ja.md document `gh auth status` and `gh release download <vSEMVER> --repo <owner/repo> --dir <new-empty-directory>` before the exact local verify-only command, state that publishing is GitHub-Actions-only and direct `release:prepare` output lacks the CI attestation and is not publishable, and document the stable-tag restriction, historical-tarball refusal, checksum, embedded identity and GitHub digest checks, protected environment, and npm provenance behavior.
