---
schemaVersion: 1
id: CHANGE-0038
summary: Scope feature trace artifacts to avoid repository-wide regeneration
status: staged
---
# CHANGE-0038: scoped-feature-trace-artifacts

Requirements: REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-001 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-004 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-005

## Intent

Fix GitHub Issue #49: `trace build` currently writes the entire
project-global trace graph into every feature-local
`.musubix/features/<slug>/trace.json`, so adding or changing one feature
rewrites trace artifacts for every unrelated feature, producing large
review noise, merge conflicts, and disproportionate approval-manifest
churn (observed during #32).

## Classification

- Feature/behavior change to generated-artifact persistence in
  `packages/analysis/src/trace.ts` and `packages/cli/src/install.ts`.

## Impact

- Each feature's persisted `trace.json` becomes a projection scoped to the
  nodes/edges/diagnostics/fingerprints reachable from that feature's own
  requirement/design nodes, instead of the full project-global graph.
- A new repository-tracked canonical graph file, `.musubix/trace.json`,
  is added as the complete project-global graph (deterministically sorted),
  persisted alongside the existing gitignored `.musubix/cache/trace.json`.
- `loadTrace`'s fallback (used when the gitignored local cache is absent)
  now reads `.musubix/trace.json` instead of an arbitrary feature's
  trace.json, preserving complete dangling-link detection and coverage.
- A feature's `trace.json` (and the canonical graph) is only rewritten when
  its content differs from the existing file, ignoring `generatedAt`, so
  unrelated rebuilds leave it byte-for-byte unchanged.
- No change to approval-manifest computation (`domainStagePaths`/`stagePaths`
  already never read any `trace.json`); a regression test records this
  invariant explicitly.

## Verification

- Red/Green TDD cycles per requirement in `tests/scoped-feature-trace-artifacts.test.ts`
  (and `tests/gate-install.test.ts` / `tests/approval*.test.ts` as needed).
- `trace build`, `trace check --strict`, `graph index`, `graph gate`.
- Full typecheck, build and test suite; `gate --changed --json` and
  `status --json`.
