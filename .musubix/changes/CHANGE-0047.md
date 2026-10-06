---
schemaVersion: 1
id: CHANGE-0047
summary: Guard the packaged release artifact against a waiver stale-severity regression
status: staged
---
# CHANGE-0047: waiver-stale-packaging-regression-guard

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-019

## Intent

Fix GitHub Issue #55 ("waiver stale deadlock") by closing the actual
remaining gap: the severity-downgrade fix for a resolved
(`condition === 'false'`) `CHANGE_WAIVER_STALE` scope (added by
CHANGE-0028/CHANGE-0029) is already present in `packages/analysis/src/change-waiver.ts`
on `main`, but the published `musubix3@0.1.20` npm package does not
contain it, reproducing the original deadlock against a released artifact.
Add a packaging-time regression guard so `npm run pack:check` fails
whenever the packaged `dist/packages/analysis/src/change-waiver.js` does
not exhibit this behavior.

## Classification

- Defect correction, scoped to release-packaging verification: no
  change to `change-waiver.ts`'s runtime logic (already correct on
  `main`); the defect is an unverified build/package boundary that let an
  already-fixed source regress silently in a published artifact.

## Impact

- Add an independent, exported `assertWaiverStaleSeverityFix(directory)`
  function to `scripts/check-package.mjs` that dynamically imports a
  directory's packaged `dist/packages/analysis/src/change-waiver.js` and
  functionally asserts the `CHANGE_WAIVER_STALE` severity-downgrade
  behavior for a resolved waiver scope.
- Wire it into `scripts/check-package.mjs`'s CLI entrypoint (run by
  `npm run pack:check`, already a required step in `ci.yml` and in
  `release.yml`'s `validate` job before `release:prepare`/GitHub
  Release/npm publish), without changing the existing synchronous
  `checkPackage(directory)` contract owned by
  REQ-RELEASE-VERSION-SYNCHRONIZATION-006.
- New requirement REQ-CHANGE-EVIDENCE-WAIVER-019 in the
  `change-evidence-waiver` feature's `requirements.md`.

## Acceptance

- Given a packaged `dist/packages/analysis/src/change-waiver.js` whose
  `reportWaiverEvidenceDiagnostics` reports `severity: 'warning'` (not
  `'error'`) for a resolved (`condition === 'false'`) `CHANGE_WAIVER_STALE`
  scope, `npm run pack:check` succeeds (exit code 0).
- Given a packaged `dist/packages/analysis/src/change-waiver.js` that
  regresses to reporting `severity: 'error'` unconditionally for that same
  scenario (reproducing the gap the published `musubix3@0.1.20` package
  exhibited), `npm run pack:check` fails (non-zero exit code) with a
  message naming the regression.
- `checkPackage(directory)`'s existing signature, synchronous behavior,
  and `tests/release-version-synchronization.test.ts`'s synchronous-throw
  assertion on it are unaffected.
- `npm run typecheck`, `npm test`, and `npm run build` remain green.

## Verification

- A new regression test (TDD red/green) exercising
  `assertWaiverStaleSeverityFix` against both the real (correct) built
  `dist/` and a corrective-mutation fixture simulating the Issue #55
  regression.
- `npm run build && npm run pack:check`
- `npm run typecheck`
- `npm test`
- `trace build`, `trace check --strict`, `graph index`, `graph gate --json`,
  and `gate --changed --json`

## Residual risks

- The packaging guard only detects a regression in the specific
  `change-waiver.js` severity-downgrade behavior it asserts; it is not a
  general-purpose packaged-artifact behavioral diff and would not catch an
  unrelated regression elsewhere in the packaged `dist/` tree.
- `assertWaiverStaleSeverityFix` dynamically imports packaged code, so a
  stale or unbuilt `dist/` at `pack:check` time (e.g. forgetting
  `npm run build` first) could cause it to import outdated or missing
  code; this risk is identical in kind to `checkPackage`'s own existing
  reliance on a freshly built `dist/` and `npm pack --dry-run` output, and
  is already mitigated by `release.yml`'s existing `npm run build` step
  preceding `pack:check`.

## Rationale for not pursuing Issue #55's three proposed options

See `.musubix/features/change-evidence-waiver/requirements.md`'s
"Rationale for REQ-CHANGE-EVIDENCE-WAIVER-019" section for the full
investigation. Summary: (a) severity downgrade is already implemented;
(b) a `change waiver retract` command and (c) `--force` re-recording are
both unnecessary/risky re-openings of CHANGE-0029's intentional rejection
of re-legitimizing resolved-debt waivers, since a `condition: 'false'`
waiver is already non-blocking (warning-only).
