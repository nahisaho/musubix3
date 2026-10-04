# Scoped feature trace artifacts design

## DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001: Feature-reachable trace projection
Responsibilities: Given the full in-memory project trace graph built by `buildTrace`, compute for each feature directory a projection containing the nodes reachable (by bidirectional BFS over `graph.edges`, reusing the same traversal shape as `traceImpact`) from that feature's own requirement/design nodes (nodes whose `path` starts with `<featureDir>/`); the edges whose both endpoints are in that node set; the diagnostics whose `path` falls under one of those nodes' paths; and the fingerprints restricted to those same paths. Each collection is sorted by an explicit, locale-independent key before serialization: nodes by `(id)`, edges by `(from, to, relation)`, diagnostics by `(path ?? '', line ?? -1, code, severity, message)` with a final deterministic tie-break on the full JSON-stringified diagnostic object (covering any additional serialized field such as `changeId`/`requirementId`/`detail`), and fingerprint entries by path, all using plain code-point string comparison (`<`/`>`, never `localeCompare`). `generatedAt` is carried from the full graph unchanged. The canonical graph (DES-003) is the full graph `graph` itself with the same explicit sort applied — not a BFS-derived projection — so every node (including one with no path to any requirement/design, such as a genuinely dangling reference) is retained.
Interfaces: `featureTraceProjection(graph: TraceGraph, featureDir: string): TraceGraph` (new, exported from `packages/analysis/src/trace.ts`, re-exported via `packages/analysis/src/index.ts`); `canonicalSort(graph: TraceGraph): TraceGraph` (new, exported alongside it, applying the explicit sort to any graph, used for both the canonical graph and each feature projection's output).
Constraints: Must not mutate the input graph. Must use the explicit sort keys above (not array insertion order) so repeated builds with identical inputs produce byte-identical output regardless of traversal/locale differences. Must include every node transitively reachable, not only one hop, so cross-feature dependency chains, shared code/test nodes and ADRs remain represented in feature projections.
Requirements: REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-001
ADRs: ADR-0039
Depends-On: none

## DES-SCOPED-FEATURE-TRACE-ARTIFACTS-002: Change-detecting persistence
Responsibilities: Before writing any trace.json (a feature projection or the canonical graph), read the file's current contents (if any) and compare them to the newly computed graph with both sides' `generatedAt` fields ignored; write the file (with the current build's `generatedAt`) only when that comparison differs, and otherwise leave the existing file byte-for-byte untouched so unrelated feature artifacts, and the canonical graph on a fully unchanged rebuild, do not change.
Interfaces: `writeTraceIfChanged(root: string, path: string, graph: TraceGraph): Promise<void>` (new, exported from `packages/analysis/src/trace.ts` and re-exported via `packages/analysis/src/index.ts` so `packages/cli/src/install.ts` can call it directly without duplicating the comparison logic); used by `buildTraceUnlocked` and by `install.ts`'s initial-scaffold branch; no public signature change to `buildTrace`.
Constraints: Must treat a missing or unparsable existing file as "different" (always write). Must perform the comparison without relying on wall-clock values so two builds of unchanged inputs are idempotent no-ops.
Requirements: REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003
ADRs: ADR-0039
Depends-On: DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001

## DES-SCOPED-FEATURE-TRACE-ARTIFACTS-003: Canonical global graph at a fixed repository-tracked path
Responsibilities: `buildTraceUnlocked` and `install`'s initial-feature-scaffold path both write the full project-global graph (via `canonicalSort(graph)`, i.e. all nodes/edges/diagnostics/fingerprints included, deterministically sorted) to the fixed path `.musubix/trace.json`, through the same change-detecting writer (`writeTraceIfChanged`) as DES-002. `install.ts`'s required-`.gitignore`-entries list is unchanged (it already only ignores `.musubix/cache/`), so `.musubix/trace.json` is tracked by Git by construction.
Interfaces: `canonicalTracePath = '.musubix/trace.json'` constant in `packages/analysis/src/trace.ts`, exported via `packages/analysis/src/index.ts` for reuse by `loadTrace` (DES-004) and `install.ts`. `evidenceInputPaths` in `packages/analysis/src/files.ts` gains a literal `path !== '.musubix/trace.json'` filter term alongside its existing per-feature `trace.json` regex exclusion.
Constraints: Must be written via `writeTraceIfChanged(root, canonicalTracePath, canonicalSort(graph))` (the full graph, not a feature projection) whenever `.musubix/cache/trace.json` is written (same call sites: `buildTraceUnlocked`'s persist branch and `install.ts`'s initial-scaffold branch, both already importing from `packages/analysis/src/index.ts`). `.musubix/trace.json` must be excluded from `evidenceInputPaths` so gate's input-stability check does not flag it as modified when a quality command rebuilds it mid-run.
Requirements: REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003
ADRs: ADR-0039
Depends-On: DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001 DES-SCOPED-FEATURE-TRACE-ARTIFACTS-002

## DES-SCOPED-FEATURE-TRACE-ARTIFACTS-004: Canonical-graph trace loading fallback
Responsibilities: `loadTrace` prefers `.musubix/cache/trace.json` when present (unchanged, primary path used by the standard `trace build` → `trace check --strict` workflow), and otherwise loads `.musubix/trace.json` instead of the first feature's trace.json, giving `trace check --strict` and `trace impact` access to the complete graph (full fingerprints and every node, including nodes with a genuinely dangling target unreachable from any feature) even without the local cache.
Interfaces: `loadTrace(root: string): Promise<TraceGraph>` (existing signature, behavior-only change to its fallback branch: `.musubix/trace.json` replaces the previous `find()` over `.musubix/features/*/trace.json`).
Constraints: Must continue validating schema/shape identically to today. Must throw the existing "Trace graph missing; run musubix3 trace build." error when neither file exists.
Requirements: REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-004
ADRs: ADR-0039
Depends-On: DES-SCOPED-FEATURE-TRACE-ARTIFACTS-003

## DES-SCOPED-FEATURE-TRACE-ARTIFACTS-005: Approval manifests remain trace.json-independent
Responsibilities: No change to `packages/analysis/src/approval.ts`: `domainStagePaths` and `stagePaths` already select only `requirements.md`, `design.md` and decided ADRs for the requirements/design stages, never any `trace.json`; this design note records that invariant as a regression guard rather than introducing new behavior.
Interfaces: none (no code change).
Constraints: A regression test asserts the requirements/design approval manifest artifact hash is unaffected by a trace-projection-only rebuild.
Requirements: REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-005
ADRs: ADR-0039
Depends-On: none

Change: CHANGE-0038 implements DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001 through 004 in packages/analysis/src/{trace,files}.ts and packages/cli/src/install.ts; DES-SCOPED-FEATURE-TRACE-ARTIFACTS-005 adds no production code and is proven by a regression test in tests/scoped-feature-trace-artifacts.test.ts.
