---
schemaVersion: 1
feature: npm-audit-remediation
---
# npm audit remediation

Source: GitHub Issue #35 and GitHub Security Advisory
GHSA-82fw-gwwq-j7x9 (CVE-2026-84373).

## REQ-NPM-AUDIT-REMEDIATION-001: Record advisory exposure
Priority: must
Type: non-functional
Pattern: ubiquitous
Statement: The repository shall record the affected dependency paths, exploit preconditions, package exposure, and remediation decision for every npm audit finding addressed by this change.
Acceptance: CHANGE-0022 identifies GHSA-82fw-gwwq-j7x9, records that the two reported npm audit findings are the same advisory applied to direct `vitest` and transitive `@vitest/mocker`, and records the vulnerable range `>=2.1.0 <4.1.11`, CVSS 5.9 and CWE-22 classification, and the arbitrary-file-read impact; it records that the advisory publishes no fixed 3.x release and that 4.1.11 is the minimum stable fixed release, so no non-breaking 3.x remediation is available; it records that the affected packages are development-only test tooling, are not imported by production runtime code, and are not executed during installation of the published package; it also records that the repository does not configure Vitest browser mode, `mockerPlugin`, `interceptorPlugin`, a network-exposed Vite development server, or redirect mocks, so the current repository workflow is not remotely reachable through the advisory path, while local or future third-party dev-server use remains exposed until upgraded.

## REQ-NPM-AUDIT-REMEDIATION-002: Resolve the vulnerable test dependency
Priority: must
Type: non-functional
Pattern: ubiquitous
Statement: The repository shall resolve Vitest and `@vitest/mocker` to maintained versions containing the upstream path-validation fix without changing production package behavior.
Acceptance: `package.json` requires Vitest `^4.1.11`; `@vitest/mocker` remains transitive rather than becoming a direct development dependency or override; `package-lock.json` resolves both `vitest` and `@vitest/mocker` outside all affected ranges; a root-workspace `npm audit --json` run covering all severities and development dependencies is recorded in CHANGE-0022 at change-verification time with a valid RFC 3339 UTC `Z` timestamp no more than five minutes in the future, and with a lowercase hexadecimal SHA-256 exactly equal to the digest of the repository's current `package-lock.json` file bytes; the recorded result reports zero findings at every severity, while the weekly workflow supplies recurring freshness without making ordinary deterministic tests expire; the published package continues to declare `engines.node >=20`, the selected Vitest release supports the Node.js lines used by CI (20, 22, and 24), and Vitest's exclusion of odd-numbered Node.js 21 and 23 is recorded as a development-environment-only constraint; no production dependency, public export, executable entry point, packaged runtime file set, or application behavior changes as part of the remediation.

## REQ-NPM-AUDIT-REMEDIATION-003: Preserve test and distribution behavior
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The repository shall preserve its existing test selection, test execution constraints, and distribution checks across the Vitest major-version upgrade.
Acceptance: `vitest.config.ts` continues to select `tests/**/*.test.ts`, use a 20-second per-test timeout, and cap workers at two; the `test`, `test:adapters`, and `test:watch` scripts in `package.json` preserve their current selection semantics, including the one-worker cap for adapter integration; the dedicated remediation test deterministically proves from `package.json` and `package-lock.json` that Vitest is constrained to fixed 4.x releases and that both `vitest` and `@vitest/mocker` resolve outside the affected range without making a network request; `npm run typecheck`, `npm run build`, the complete test suite, `npm run pack:check`, and `npm run pack:smoke` pass; any required Vitest 4 compatibility edits are limited to test/configuration code, preserve equivalent concurrency bounds, identify the changed upstream API, and are documented in CHANGE-0022.

## REQ-NPM-AUDIT-REMEDIATION-004: Monitor deferred dependency risk
Priority: must
Type: non-functional
Pattern: ubiquitous
Statement: The repository shall maintain documented and automated dependency-audit monitoring that blocks release-readiness claims until every reported finding has an explicit reachability, remediation-availability, and residual-risk decision.
Acceptance: `README.md` and `README-ja.md` document the dependency-audit review obligation and require root-workspace `npm audit --json` evidence covering all severities and development dependencies when findings occur; `package.json` defines `audit:report` as exactly `npm audit --json`, with no workspace, severity, dependency-omission, or exit-suppression arguments; `.github/workflows/dependency-audit.yml` runs exactly `npm run audit:report` against the current lockfile without redirection, filtering, step-level suppression, or job-level suppression of its nonzero exit, on exact cron `23 4 * * 1` and manual dispatch, using Node.js 24 and immutable action SHAs that `scripts/check-github-actions.mjs` validates against `scripts/github-actions-lock.json`; the unfiltered JSON remains in the GitHub Actions run log; deterministic tests executed by `npm test` reject drift in the script definition, cron, manual trigger, exact workflow command/output path, step/job failure propagation, Node.js line, or action-lock pins; the guidance distinguishes production reachability from development-only exposure, prohibits treating non-reachability as remediation when a safe maintained fix is available, and requires an explicit monitoring rationale for every accepted residual risk.
