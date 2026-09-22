---
schemaVersion: 1
id: CHANGE-0022
summary: Assess and remediate npm audit findings
status: completed
---
# CHANGE-0022: npm-audit-remediation

Requirements: REQ-NPM-AUDIT-REMEDIATION-001 REQ-NPM-AUDIT-REMEDIATION-002 REQ-NPM-AUDIT-REMEDIATION-003 REQ-NPM-AUDIT-REMEDIATION-004

## Intent

Resolve the two moderate npm audit findings reported during v0.1.20
preparation, document their actual repository reachability, and establish a
repeatable dependency-audit review obligation.

## Impact

- Upgrade the development-only Vitest dependency from the vulnerable 3.x line
  to the minimum maintained fixed 4.x release or later compatible stable patch.
- Refresh the npm lockfile and verify that `vitest` and `@vitest/mocker` no
  longer resolve inside the advisory range.
- Add deterministic lockfile dependency-resolution checks and separately record
  the time-bound registry audit result as verification evidence.
- Preserve production dependencies, runtime exports, packaging, and test
  configuration semantics.
- Document English and Japanese dependency-audit review guidance.

## Advisory assessment

- Advisory: GHSA-82fw-gwwq-j7x9 / CVE-2026-84373.
- Severity: moderate; CVSS 5.9; CWE-22.
- Paths: direct development dependency `vitest` and transitive dependency
  `vitest > @vitest/mocker`.
- Affected range: `>=2.1.0 <4.1.11`; the installed 3.2.7 dependency graph is
  affected.
- The advisory separately affects Vitest 5 prereleases from 5.0.0-beta.1
  through versions before 5.0.0-rc.2. This change rejects prereleases and
  remains on stable 4.x, so that range cannot enter the resolved graph.
- The two npm audit findings are two affected package paths for this one
  advisory. The advisory publishes no fixed 3.x release; 4.1.11 is the minimum
  stable fixed release, so no non-breaking update can remediate it.
- Impact: a reachable Vite development server using the unauthenticated public
  mocker/interceptor plugin can be induced to read files outside the project
  root or files denied by Vite's file-serving policy.
- Current reachability: the repository uses Vitest only through local/CI
  command-line test execution. It does not configure browser mode, the public
  mocker/interceptor plugins, redirect mocks, or a network-exposed Vite
  development server. Production runtime code does not import Vitest.
- Residual risk before remediation: low for the repository's current execution
  model, but the vulnerable code remains installed for contributors and could
  become reachable through future test-server configuration or third-party
  tooling. A maintained fixed release is available, so non-reachability alone
  is not accepted as the final disposition.
- Decision: upgrade to Vitest 4.1.11 or later compatible stable 4.x, validate
  the major-version migration, and require no GHSA-82fw-gwwq-j7x9 finding or
  other moderate-or-higher npm audit finding.

## Acceptance

- The exact advisory, dependency paths, reachability, and decision are recorded.
- Vitest and `@vitest/mocker` resolve outside the vulnerable range.
- `npm audit --json` reports no GHSA-82fw-gwwq-j7x9 finding and no other
  moderate-or-higher finding.
- Test configuration semantics and production/distribution behavior remain
  unchanged.
- The published package retains `engines.node >=20`; Vitest 4.1.11 supports the
  CI lines Node.js 20, 22, and 24, while its exclusion of Node.js 21 and 23 is a
  development-tooling constraint.
- The resolved Vite dependency raises repository test development floors to
  Node.js 20.19 or 22.12; GitHub Actions uses the latest patch of each selected
  major line, so the existing Node.js 20, 22, and 24 jobs remain supported.
- Typecheck, build, full tests, package check, and package smoke test pass.
- Dependency-audit monitoring guidance is present in both READMEs.

## Verification

- Requirements artifact
  `126ca0824fbbb1302834361ceed0d5fcfa3fa8908e6a9adac28da5a48c70c0e9`
  and design artifact
  `58d549f42f92dc9a41f26a534d75423d2ce895c798856deaf03d5776774382cf`
  were approved.
- `package.json` and `package-lock.json` resolve `vitest` and
  `@vitest/mocker` 4.1.11 as development-only packages and resolve Vite 8.3.0
  with Node.js floor `^20.19.0 || >=22.12.0`.
- Audit command: `npm run audit:report` (`npm audit --json`).
- Audit captured at: 2026-09-22T18:13:20Z.
- Audited package-lock SHA-256:
  `7b9becf368784a85f4bfa3d1f9353d089b28ce74db36861c6321375c120eb95a`.
- Audit result: info 0, low 0, moderate 0, high 0, critical 0, total 0;
  GHSA-82fw-gwwq-j7x9 findings: 0; moderate-or-higher findings: 0.
- All four authoritative tests completed verified Red/Green cycles. Corrective
  cycles additionally made malformed lockfile package collections fail closed,
  bound root lockfile production metadata to the reviewed manifest, rejected
  duplicate CI setup-node/test steps, moved a previously nested suite declaration
  to a Vitest 4-compatible top-level suite, and protected the bilingual
  time-bound audit-evidence guidance.
- The nested suite had caused two workflow/attestation policy-weakening tests to
  remain undiscovered under Vitest 3. Vitest 4 rejected the invalid declaration;
  moving it to the top level restored those two authoritative tests.
- `.github/workflows/dependency-audit.yml` runs the full audit report weekly and
  on manual dispatch using immutable Node.js 24 action pins.
- The changed quality gate passes every required check and release approval is
  current. First scheduled/dispatched workflow-run evidence is deferred until
  the workflow exists on the default branch.
- `npm run typecheck`, `npm run build`, `npm run pack:check`, and
  `npm run pack:smoke` pass.
- `npm test` passes with 531 tests passed and 8 skipped; 50 test files pass and
  1 adapter integration file is skipped.
- Strict trace coverage is design 1.0, implementation 1.0, and tests 1.0 with
  zero diagnostics. The Code Graph gate is valid; its seven unresolved dynamic
  module-loading diagnostics remain compatible-mode warnings in existing
  release scripts/tests.
- Release approval is recorded; first default-branch dependency-audit run
  evidence remains pending as an operational follow-up.

## Residual risks

- Future advisories can affect currently safe versions; release preparation
  must repeat the documented audit review.
- Development-only classification lowers production exposure but does not make
  a known vulnerable installed tool acceptable when a maintained fix exists.
