---
schemaVersion: 1
feature: audit-override-contract
---
# Reviewed dependency override and audit contract

Source: CHANGE-0052; GHSA-hp3w-g68c-fv3c (`sprintf-js` denial of service).

## Scope and confirmed intent

This dependency-security / behavior change permits one reviewed transitive
override without weakening the existing production, Vitest, CI, or audit-policy
contracts. Existing REQ-NPM-AUDIT-REMEDIATION-001..004 remain unchanged.
The package version remains `0.1.20`; publication and the pending release
version bump are outside scope. All four requirements below are new.

The baseline investigation found 19 moderate and 2 high audit findings.
The vulnerable `sprintf-js` path is installed exclusively through the root
Jest devDependency, not imported by shipped runtime code. Development-only
classification is an exposure assessment, not a substitute for remediation.
The two high findings have npm-reported non-breaking fixes; the approved
implementation may apply those fixes without `--force` or manifest range
changes. A fix that changes direct dependency ranges, the package version, or
the reviewed Vitest constraint is rejected and escalated rather than accepted;
only compatible transitive lock-record updates are in scope. Final evidence
must come from the actual resulting lockfile.

## REQ-AUDIT-OVERRIDE-CONTRACT-001: Resolve only the reviewed replacement graph
Priority: must
Type: non-functional
Pattern: ubiquitous
Statement: The repository shall declare the reviewed `js-yaml` override and resolve a development-only replacement graph without `sprintf-js`.
Acceptance: The root `package.json` contains an `overrides` object exactly equal to `{"js-yaml":"^5.4.3"}` with no other keys, nested selectors, or changed range; npm regenerates lockfile version 3 through the reviewed override; every root or nested `js-yaml` package record resolves a stable version `>=5.4.3 <6.0.0`, remains development-only, and declares only `argparse: "^2.0.1"`; every root or nested `argparse` package record resolves a stable version `>=2.0.1 <3.0.0`, remains development-only, and has no declared dependencies; no root or nested `sprintf-js` package record remains, and installed-tree inspection confirms its absence; `node scripts/check-npm-audit-remediation.mjs lock` offline enumerates root and nested records using package paths, requires at least one js-yaml and argparse record, and exits nonzero with `LOCK_OVERRIDE_GRAPH` on any missing, malformed, out-of-range, non-development, or unexpected-dependency record or any sprintf-js record; isolated tests exercise those drift cases without a network request; direct dependency ranges, package version `0.1.20`, production dependencies, public exports, executable entry point, packaged file list, and `engines.node: ">=20"` remain unchanged.

## REQ-AUDIT-OVERRIDE-CONTRACT-002: Fail closed on unreviewed overrides
Priority: must
Type: functional
Pattern: event-driven
Statement: When the audit-remediation lock checker evaluates a manifest, the system shall accept only the exact reviewed override while preserving every other existing contract check.
Acceptance: `node scripts/check-npm-audit-remediation.mjs lock` exits 0 with `{"valid":true,"diagnostics":[]}` for the repository and an otherwise-valid fixture containing exactly `{"js-yaml":"^5.4.3"}`; isolated fixtures with an absent override, an empty object, a different package key, a different js-yaml range, an additional override, a nested selector, `null`, an array, or a string exit nonzero with `MANIFEST_CONTRACT`; other pinned fields and all existing negative fixtures continue to fail as before; after the approved npm install, the actual npm version and root-lock override representation are observed once and recorded in CHANGE-0052 verification evidence, and the checker pins only that representation, not both: if npm omits `packages[""].overrides`, the checker requires its absence and rejects an inserted field even with the reviewed value; if npm emits it, the checker requires exactly the reviewed object and rejects its removal or alteration; negative fixtures prove rejection of deviations from the observed representation; an npm-version change requires re-observation and an explicit evidence update, and any resulting change to the pinned representation requires renewed design review and human approval rather than silent reinterpretation; existing root-lock dependency, devDependency, binary, and engine comparisons remain enforced.

## REQ-AUDIT-OVERRIDE-CONTRACT-003: Bind zero-finding evidence to the current lockfile
Priority: must
Type: non-functional
Pattern: event-driven
Statement: When the dependency remediation is verified, the repository shall record a real full-workspace zero-finding audit bound to the resulting lockfile bytes.
Acceptance: After npm regeneration and any reviewed non-breaking audit fixes, an actual root `npm audit --json` run includes development dependencies and all severities, exits 0, and reports `metadata.vulnerabilities` with info, low, moderate, high, critical, and total each 0; its unfiltered JSON is retained as verification evidence; CHANGE-0022 contains exactly one current audit summary with those real counts, a valid RFC 3339 UTC `Z` capture timestamp, and the computed lowercase SHA-256 of this worktree's actual LF `package-lock.json` bytes; a short history note links CHANGE-0052 without erasing the original advisory account; CHANGE-0052 records the new advisory and actual remediation outcome; the existing evidence checker passes for current evidence and still rejects nonzero summaries or stale/malformed digests and timestamps; ordinary deterministic tests do not query the registry; any later lockfile-byte change requires a new actual audit and refreshed digest/timestamp before readiness can be claimed.

## REQ-AUDIT-OVERRIDE-CONTRACT-004: Document exposure and verify tooling compatibility
Priority: must
Type: non-functional
Pattern: ubiquitous
Statement: The repository shall document the new advisory's exposure and remediation rationale with verified tooling compatibility.
Acceptance: CHANGE-0052 records GHSA-hp3w-g68c-fv3c, its unbounded-precision CPU-denial-of-service precondition, the complete observed `jest > @jest/core > @jest/transform > babel-plugin-istanbul > @istanbuljs/load-nyc-config > js-yaml > argparse > sprintf-js` path with baseline versions, the lack of a published fixed sprintf-js version, and the decision to remove that dependency rather than accept it as harmless; it distinguishes local/development or future attacker-controlled formatter input from current production exposure, records that production source does not import Jest/js-yaml/sprintf-js and that inspected package contents do not ship that development dependency chain, and does not claim universal unreachability; it records the actual `@istanbuljs/load-nyc-config` `.load(await readFile(..., "utf8"))` YAML call site and demonstrates that a representative `.nycrc.yaml` config still loads through that installed consumer after the override; `MUSUBIX_RUN_NATIVE_ADAPTERS=1 npm run test:adapters -- -t "executes and normalizes a targeted Jest test"` executes the native Jest integration, with retained runner output showing that named case passed and zero skipped Jest cases; typecheck, build, the complete test suite, and package distribution checks pass; the intentional override outside the consumer's declared `js-yaml: "^3.13.1"` range is recorded and all resolved js-yaml consumers are enumerated; any additional consumer blocks readiness until equivalent compatibility evidence exercising its YAML call site is recorded in CHANGE-0052; the major migration is not called compatible solely because the method name is unchanged; remaining risk and recurring audit monitoring are documented.

## Assumptions and outstanding observations

- `^5.4.3` is the reviewed manifest range, not a promise of an exact installed
  patch; the lockfile binds the actual stable 5.x release.
- Registry metadata confirms js-yaml 5.4.3 depends only on argparse 2.x,
  which declares no dependencies. Installed replacement metadata, package
  contents, YAML semantics, and native Jest compatibility remain to be verified
  after requirements and design approval.
- The existing root lock entry omits overrides before installation. Its
  post-install representation is observed once with the npm version and pinned
  as the single allowed root-metadata representation under
  REQ-AUDIT-OVERRIDE-CONTRACT-002; no metadata is invented and both
  representations are not accepted interchangeably.
- Unsupported dependency behavior, remaining audit findings, or failed
  compatibility checks block readiness; they are not waived by dev-only status.

## Acceptance self-check

| Requirement | Observable check | Negative boundary |
| --- | --- | --- |
| 001 | Exact manifest and every resolved dev-only YAML/argparse record | Missing/different override, legacy graph, any sprintf-js |
| 002 | Checker accepts the reviewed manifest and npm-generated root metadata | Missing, malformed, extra, or changed override; existing surface drift |
| 003 | Real all-zero audit plus current bytes digest and timestamp | Any severity finding or stale/malformed evidence |
| 004 | Assessment, actual consumer YAML load, Jest integration, package checks | Undocumented exposure, unsupported compatibility claim, skipped Jest |

Formal coverage is not asserted for registry findings, filesystem hashes,
reachability, or third-party behavior. Automated contract tests and actual
verification evidence, not satisfiability of a prose abstraction, establish
these acceptance results.
