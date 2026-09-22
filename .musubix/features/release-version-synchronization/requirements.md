---
schemaVersion: 1
feature: release-version-synchronization
---
# Release version synchronization

Source: GitHub Issue #29. Preparing v0.1.20 required independent edits to the
root and workspace package manifests, npm lockfile, plugin manifests, CLI
version output, package tests, and English/Japanese release banners. The
release process needs one deterministic operation that updates these surfaces
and one non-mutating check that reports any divergence before packing or
tagging. Authored release-note content and headings in `CHANGELOG.md` remain
out of scope because promoting `Unreleased` requires a separately reviewed
date and release summary rather than mechanical version replacement.
Workspace dependency ranges also remain out of scope; if the repository later
adds version-pinned sibling workspace dependencies, that extension requires a
separate requirement before release synchronization can update them.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-001: The release-version command has one explicit interface and version grammar
Priority: must
Type: functional
Pattern: event-driven
Statement: When an operator invokes the release-version synchronization script through either supported entrypoint, the system shall accept exactly a version matching `^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[A-Za-z-][0-9A-Za-z-]*))*)?$`.
Acceptance: The supported entrypoints are exactly `npm run --silent release:version -- <version>`, `npm run --silent release:version -- --check <version>`, `node scripts/release-version.mjs <version>`, and `node scripts/release-version.mjs --check <version>`, and README.md plus README-ja.md document those forms; `--silent` is mandatory for the npm entrypoint so npm does not prepend lifecycle banners to the machine-readable stdout document; both entrypoints apply identical argument handling; update mode accepts `1.2.3` and `1.2.3-rc.1`; check mode accepts the same values; both modes reject a `v` prefix, omitted version, build metadata, incomplete versions, leading-zero core or numeric prerelease components, empty prerelease identifiers, leading or trailing whitespace, additional positional arguments, a bare `--`, repeated `--check`, or `<version> --check` before reading or changing any project file; `--check` is the only supported mode flag and is accepted only before the version, and every rejected invocation emits the diagnostic shape from REQ-RELEASE-VERSION-SYNCHRONIZATION-004 with reason `invalid-arguments`.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-002: One command synchronizes every release version surface
Priority: must
Type: functional
Pattern: event-driven
Statement: When an operator supplies an accepted version in update mode, the system shall set every declared release version surface to that exact version.
Acceptance: Given a fixture at an older version, update mode with `1.2.3` sets `package.json#version`; each manifest selected by `package.json#workspaces` at a repository-relative POSIX-separated `<workspace>/package.json#version`; `package-lock.json#version`, `package-lock.json#packages[""].version`, and `package-lock.json#packages[workspace].version` for each POSIX-separated workspace key; `plugin.json#version`; `.github/plugin/marketplace.json#metadata.version`; `.github/plugin/marketplace.json#plugins[0].version`; the version token in the unique `.version('<SEMVER>')` call in `packages/cli/src/main.ts`; the version tokens in exactly two `toBe('<SEMVER>')` calls in `tests/cli-package.test.ts`; the version token in the unique line matching `^\*\*Latest release v<SEMVER>` in `README.md`; and the version token in the unique line matching `^\*\*最新リリース v<SEMVER>` in `README-ja.md`, where every `<SEMVER>` uses the grammar from REQ-RELEASE-VERSION-SYNCHRONIZATION-001 independently of the requested target; values use `v1.2.3` only in the two README banner texts; every file outside the declared file set, explicitly including `CHANGELOG.md` and `.musubix/**`, has an unchanged SHA-256 digest; for each changed JSON file, the parsed value differs only at its declared version locations and serialization preserves the original indentation, key order, and trailing-newline state, explicitly leaving dependency-range fields unchanged; for each changed TypeScript or Markdown file, all bytes outside the declared version-token occurrences are unchanged; successful update mode exits zero and emits `{ \"valid\": true, \"expectedVersion\": \"1.2.3\", \"diagnostics\": [] }`; the same assertions hold for `1.2.3-rc.1`; a second identical update changes no file content, and check mode for the new version immediately succeeds.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-003: Invalid or incomplete projects fail atomically
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If any required release version surface cannot be read, parsed, uniquely located at its declared occurrence count, or committed successfully, then the system shall leave the project tree byte-identical to its pre-invocation state.
Acceptance: Workspace patterns are restricted to repository-relative POSIX paths ending in `/*`; a missing required file uses `missing-file`, malformed JSON uses `parse-error`, an unsupported/unmatched workspace pattern or matched directory without `package.json` uses `workspace-resolution`, a missing lockfile workspace entry or zero locator occurrence uses `missing-location`, an occurrence count above its declared count uses `occurrence-count`, a value difference uses `version-mismatch`, and commit-stage faults use `write-error`; for each representative structural fault plus injected staged-write failure and injected rename failure after one replacement is committed, update mode exits nonzero using the JSON diagnostic shape from REQ-RELEASE-VERSION-SYNCHRONIZATION-004; within the bounded fixture tree excluding `.git` and `node_modules`, the complete relative-path set, file types, and SHA-256 content digests are identical before and after the rejected invocation.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-004: Check mode detects exact version divergence without writing
Priority: must
Type: functional
Pattern: event-driven
Statement: When an operator invokes check mode with an accepted expected version, the system shall return success exactly when every declared release version surface equals that version without changing the project tree.
Acceptance: Given all declared surfaces synchronized to `1.2.3`, check mode exits zero, comparing README banner tokens after stripping their mandatory `v` prefix so diagnostics use bare versions for both `expected` and `actual`; structural faults use the same reason mapping as REQ-RELEASE-VERSION-SYNCHRONIZATION-003, exit nonzero, and do not write; after independently changing each declared surface in turn, check mode exits nonzero and reports that file with expected `1.2.3`, its normalized actual value, and reason; checking a project whose surfaces contain several different versions reports every divergence after normalizing relative-path separators to `/`, ordered with null paths first and then by ascending Unicode code point, with null-path ties ordered by `reason`, and for a common path null locations precede non-null locations, JSON pointers are ordered by Unicode code point, and text locations are 1-based decimal line numbers encoded as strings and ordered numerically; for every invocation through a supported entrypoint defined in REQ-RELEASE-VERSION-SYNCHRONIZATION-001, the command writes exactly one JSON document to stdout and no other stdout text, containing `valid`, `expectedVersion`, and a `diagnostics` array whose entries always contain `{ path, location, expected, actual, reason }`, where the top-level `expectedVersion` is a string or `null` and is `null` exactly when argument validation fails, `path`, `location`, `expected`, and `actual` are strings or `null`, non-applicable values are `null`, an `invalid-arguments` entry has all four nullable fields set to `null`, and `reason` is one of `invalid-arguments`, `missing-file`, `parse-error`, `workspace-resolution`, `missing-location`, `occurrence-count`, `version-mismatch`, or `write-error`; stderr is not part of the release-version command's machine-readable contract, and the complete bounded fixture tree is byte-identical before and after every check.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-005: Lockfile dependency metadata is preserved for the declared workspace set
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall produce a synchronized `package-lock.json` whose parsed JSON value differs only at the root `version`, `packages[""].version`, and one `packages[workspace].version` for every workspace manifest selected by `package.json#workspaces`.
Acceptance: Given representative workspaces and dependency records containing `integrity`, `resolved`, `os`, `cpu`, and `libc` metadata, synchronization changes exactly the root document version, root package-entry version, and each selected workspace package-entry version; replacing those expected version values with a common sentinel before comparison leaves the before/after parsed JSON deep-equal, and output preserves the input lockfile's indentation and trailing-newline state (two spaces and one trailing newline for this repository); adding another selected workspace and lock entry automatically adds exactly one more synchronized version without code changes.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-006: All release consistency checks share one validator
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall use one exported, explicit-expected-version release surface validator for check mode, package checking, and release preparation while preserving release preparation's independent tag-to-commit verification.
Acceptance: Unit tests invoke the same exported validator used by `scripts/check-package.mjs` and `scripts/release-prepare.mjs`; package checking supplies `package.json#version` as the expected version, release preparation supplies the `v`-stripped tag as the expected version, and the validator compares the root `package.json#version` surface to that supplied value; a representative non-root divergence produces equivalent ordered validator-returned diagnostic arrays through all three entrypoints while the existing stdout framing of `check-package.mjs` and `release-prepare.mjs` remains unchanged; a tag/root mismatch appears as a `package.json` `version-mismatch` diagnostic, and when `GITHUB_SHA` is set release preparation still separately rejects a tag that does not resolve to that commit.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-007: Release preparation validates before output mutation
Priority: must
Type: functional
Pattern: event-driven
Statement: When release preparation receives a release tag, the system shall complete shared surface validation and independent tag verification before creating, deleting, or changing any release output.
Acceptance: Release preparation accepts only a tag consisting of exactly one lowercase `v` followed by a version matching REQ-RELEASE-VERSION-SYNCHRONIZATION-001; a version without `v`, a double-`v` tag, a ref-qualified tag, or any invalid stripped version is rejected as `invalid-arguments` before reading or changing release output; given a valid tag matching the root package version but one or more other release surfaces diverging, `release:prepare` exits nonzero with the shared ordered diagnostics and leaves a pre-existing output directory byte-identical; given synchronized surfaces and a matching tag/commit, release preparation proceeds to package generation.

## REQ-RELEASE-VERSION-SYNCHRONIZATION-008: Synchronization runs offline without generated build output
Priority: must
Type: non-functional
Pattern: ubiquitous
Statement: The system shall perform release-version update and check modes using only repository files and Node.js standard-library capabilities.
Acceptance: In a clean fixture without `node_modules` or `dist`, both modes execute through `node scripts/release-version.mjs` and through the corresponding `npm run --silent release:version -- ...` form with identical exit codes and byte-for-byte identical stdout JSON documents; the script's static module graph imports only `node:` built-ins and local modules, and tests with child-process and network creation hooks configured to throw still succeed without invoking those hooks.
