---
schemaVersion: 1
feature: release-version-synchronization
---
# Release version synchronization design

## DES-RELEASE-VERSION-SYNCHRONIZATION-001: Surface discovery and validation
Responsibilities: Define the strict release-version grammar; expand each supported repository-relative workspace pattern ending in `/*`; load every declared JSON/text surface; locate version values with exact cardinality; normalize README `v` prefixes; return a complete deterministic diagnostic array without writing.
Interfaces: `parseReleaseVersionArguments(args) -> { mode, expectedVersion } | ReleaseVersionReport`; `inspectReleaseVersionSurfaces(root, expectedVersion) -> { report, snapshot }`; `ReleaseVersionReport = { valid, expectedVersion, diagnostics }`; `ReleaseVersionDiagnostic = { path, location, expected, actual, reason }`.
Constraints: Use only Node.js built-ins and local modules; normalize paths to `/`; sort diagnostics by the rules in REQ-004; represent text locations as 1-based decimal line strings; accept only workspace patterns ending in `/*`; preserve every source file's raw bytes in the inspection snapshot.
Requirements: REQ-RELEASE-VERSION-SYNCHRONIZATION-001 REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-005 REQ-RELEASE-VERSION-SYNCHRONIZATION-008
ADRs: ADR-0032

## DES-RELEASE-VERSION-SYNCHRONIZATION-002: Targeted transformation plan
Responsibilities: Build replacement content from a valid inspection snapshot by changing only declared JSON properties or matched version tokens; preserve every byte outside the located ranges so JSON key order, indentation, and trailing-newline state remain unchanged by construction; return an ordered path/content plan before any filesystem mutation.
Interfaces: `planReleaseVersionUpdate(snapshot, expectedVersion) -> ReleaseVersionPlan`; `ReleaseVersionPlan = Array<{ path, absolute, before, after, kind, permissionMode, expectedVersion }> & { readonly expectedVersion: string }` where `kind` is `json` or `text`; JSON updates replace only located string ranges identified by declared JSON pointers; text updates replace only captured version-token ranges.
Constraints: Reject structurally inconsistent snapshots; never perform repository-wide string replacement; leave CHANGELOG, `.musubix/**`, dependency ranges, and every undeclared byte unchanged; an already-synchronized tree yields an empty plan; filesystem staleness detection belongs only to commit.
Requirements: REQ-RELEASE-VERSION-SYNCHRONIZATION-002 REQ-RELEASE-VERSION-SYNCHRONIZATION-005
ADRs: ADR-0032
Depends-On: DES-RELEASE-VERSION-SYNCHRONIZATION-001

## DES-RELEASE-VERSION-SYNCHRONIZATION-003: Rollback-capable file transaction
Responsibilities: Stage every planned replacement beside its target; preserve target permission mode; commit replacements in normalized path order; retain same-directory backups until all commits complete; on any stage or commit failure, restore every original and remove transaction files before returning `write-error`.
Interfaces: `commitReleaseVersionPlan(plan, dependencies?) -> ReleaseVersionReport`; injectable synchronous filesystem operations expose deterministic staged-write and rename failure points for tests and preserve the failing normalized path in the returned diagnostic.
Constraints: Re-read every target and byte-compare it with `plan.before` before creating any staging file; reject a stale plan as `write-error`; validate and plan before creating transaction files; use unique transaction suffixes; fsync staged files and affected directories where supported; never report success until all backups and staging files are removed; if rollback also fails, return the original `write-error` diagnostic followed by one `write-error` diagnostic for each rollback-failing normalized path, with `location`, `expected`, and `actual` set to null.
Requirements: REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004
ADRs: ADR-0032
Depends-On: DES-RELEASE-VERSION-SYNCHRONIZATION-002

## DES-RELEASE-VERSION-SYNCHRONIZATION-004: Script and release integration
Responsibilities: Add `release:version` to the root package scripts; expose update/check through `scripts/release-version.mjs`; emit exactly one report document on release-version stdout; reuse surface inspection from `check-package.mjs` and `release-prepare.mjs`; derive each script's repository root from its own `import.meta.url`; derive release preparation's expected version from an exact `v<version>` tag before touching output; retain the independent `GITHUB_SHA` tag-to-commit check.
Interfaces: `runReleaseVersion(args, root, dependencies?)`; `inspectReleaseVersionSurfaces` returns a report; synchronous `verifyReleaseVersions(tag, directory)` returns the package manifest on success and throws `ReleaseVersionValidationError` carrying the report on validation failure before performing commit verification; `prepareRelease` propagates that failure before output mutation; `check-package.mjs` delegates validation before package content checks.
Constraints: The shared validator rejects an invalid expected version as `invalid-arguments`; remove duplicated version assertions from `check-package.mjs`; run its `npm pack` subprocess with the `import.meta.url`-derived root as `cwd`; require `npm run --silent release:version -- ...` for the npm entrypoint so lifecycle banners do not contaminate the JSON stdout contract; preserve existing success stdout framing for package checking and release preparation; only each script's CLI branch catches `ReleaseVersionValidationError`, writes its ordered report to stderr, and exits nonzero without adding a second stdout document; library exports throw rather than terminating the process; release preparation does not remove or create its output directory until tag syntax, surface consistency, and tag/commit checks pass; npm's command separator is not forwarded to the script, while a literal `--` received by the parser remains invalid.
Requirements: REQ-RELEASE-VERSION-SYNCHRONIZATION-001 REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-006 REQ-RELEASE-VERSION-SYNCHRONIZATION-007 REQ-RELEASE-VERSION-SYNCHRONIZATION-008
ADRs: ADR-0032
Depends-On: DES-RELEASE-VERSION-SYNCHRONIZATION-001 DES-RELEASE-VERSION-SYNCHRONIZATION-003

## DES-RELEASE-VERSION-SYNCHRONIZATION-005: Deterministic verification and operator documentation
Responsibilities: Test stable/prerelease updates, argument rejection, every surface locator, structural diagnostics, dynamic workspaces, metadata preservation, idempotence, check ordering, stale-plan rejection, stage/commit rollback, shared-validator integration, tag syntax/SHA checks, offline execution, and package distribution; for update and check modes, assert identical successful exit status and byte-for-byte identical stdout between the direct Node entrypoint and the spawned canonical silent npm entrypoint, then parse the complete stdout as exactly one JSON document; assert both English and Japanese documentation contain all four canonical entrypoint forms from REQ-RELEASE-VERSION-SYNCHRONIZATION-001 and release ordering.
Interfaces: `tests/release-version-synchronization.test.ts`; package smoke/check tests; README release workflow sections.
Constraints: Focused tests use exact `TEST-RELEASE-VERSION-SYNCHRONIZATION-*` IDs and isolated fixtures; include unmatched patterns and matched directories without manifests; failure injection must not depend on OS permissions or root behavior; subprocesses are limited to explicit clean-fixture entrypoint parity, Git tag/SHA verification, and package distribution checks, while offline synchronization-core assertions run in-process with throwing child-process/network hooks; tests compare complete fixture path/type/digest snapshots for atomicity; documentation requires `npm run build` after version synchronization and before package validation.
Requirements: REQ-RELEASE-VERSION-SYNCHRONIZATION-001 REQ-RELEASE-VERSION-SYNCHRONIZATION-002 REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-005 REQ-RELEASE-VERSION-SYNCHRONIZATION-006 REQ-RELEASE-VERSION-SYNCHRONIZATION-007 REQ-RELEASE-VERSION-SYNCHRONIZATION-008
ADRs: ADR-0032
Depends-On: DES-RELEASE-VERSION-SYNCHRONIZATION-004
