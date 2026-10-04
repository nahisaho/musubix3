---
schemaVersion: 1
feature: scoped-feature-trace-artifacts
---
# Scoped feature trace artifacts / フィーチャー単位のトレース成果物の限定

Source: GitHub Issue #49 — `trace build` persists the full project-global
trace graph into every feature-local `.musubix/features/<slug>/trace.json`.
Adding or editing one feature therefore rewrites the committed trace file of
every other unrelated feature (new ADR nodes, unrelated line-number shifts),
producing large review noise, merge conflicts and disproportionate
approval-manifest churn, observed during #32 across dozens of feature trace
files for one unrelated change.

Design direction (per the issue's own suggested alternative): persist one
repository-tracked canonical project-global graph at the fixed path
`.musubix/trace.json` as the single source of truth for dangling-link
detection, coverage and staleness, plus a small deterministic per-feature
projection at each feature's `.musubix/features/<slug>/trace.json` scoped to
that feature's own reachable nodes, kept for localized human review and
left untouched unless a real dependency edge reaches it. The gitignored
`.musubix/cache/trace.json` remains the fast local copy of the full graph.

## REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-001: Persist a feature-scoped trace projection
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall persist, for each feature and from every code path that writes a feature's trace.json (`trace build` and initial feature scaffolding/install), a projection containing exactly the nodes reachable from that feature's own requirement/design nodes by a chain of trace edges (including cross-feature dependencies, a code/test node shared with another feature, and decision records), the edges whose both endpoints are in that node set, the diagnostics whose path falls under one of those nodes' paths, and the fingerprints restricted to those same paths, each collection sorted by a fixed deterministic key, to that feature's `.musubix/features/<slug>/trace.json`.
Acceptance: Given a project with two independent features that share no trace edge, each feature's persisted trace.json contains only nodes/edges/diagnostics/fingerprints reachable from that feature's own requirements/design and excludes the other feature's unrelated nodes; given a third feature whose design `Depends-On` references a component owned by one of the first two features, that third feature's persisted trace.json includes the depended-on component, its owning requirement, and any ADR it decides; given a single code or test node whose annotations link it to requirements owned by two different features, both features' persisted trace.json files include that shared node and the edge connecting it to their own requirement.

## REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002: Preserve unrelated feature artifacts byte-for-byte
Priority: must
Type: functional
Pattern: event-driven
Statement: When trace build recomputes a feature's scoped trace projection and finds it identical to the persisted trace.json ignoring the build timestamp, the system shall leave that feature's trace.json file untouched, preserving its exact bytes and previously recorded timestamp.
Acceptance: Given two independent features, rebuilding the trace graph after adding or modifying only one of them, including adding a new unrelated source file with no trace annotation, does not change the other feature's `trace.json` file contents, verified by exact byte comparison before and after the build; given the same unchanged project rebuilt twice in succession, both builds produce byte-identical per-feature projections once the build timestamp is disregarded.

## REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003: Commit one canonical global graph at a fixed path
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall persist, from every code path that writes the trace graph (`trace build` and initial feature scaffolding/install), a repository-tracked canonical project-global trace graph at the fixed path `.musubix/trace.json` containing the complete nodes, edges, diagnostics and fingerprints with every collection sorted by the same fixed deterministic key used for per-feature projections, separately from the per-feature projections and the gitignored local `.musubix/cache/trace.json`, while excluding `.musubix/trace.json` from gate and evidence input-stability hashing exactly like the existing per-feature `trace.json` exclusion.
Acceptance: Given `trace build` runs, or a project is freshly installed via `musubix3 init`, `.musubix/trace.json` exists afterward containing every node and edge present in the freshly built in-memory graph, is not listed in `.gitignore`, and is byte-identical across two successive builds of unchanged inputs once the build timestamp is disregarded; given `gate` runs `trace build` as part of a quality command and `.musubix/trace.json` is regenerated during execution, the gate's input-stability check does not report `.musubix/trace.json` as modified.

## REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-004: Load the canonical graph when the local cache is absent
Priority: must
Type: functional
Pattern: event-driven
Statement: When the gitignored local `.musubix/cache/trace.json` is absent, the system shall load `.musubix/trace.json` for `trace check --strict` and `trace impact`, so dangling-link detection, coverage and staleness checking remain exactly as complete as when loading the freshly built in-memory graph.
Acceptance: Given the gitignored local cache file is deleted but `.musubix/trace.json` is otherwise unchanged, `trace check --strict` reports identical diagnostics, coverage and validity, and `trace impact` reports an identical impact set for any query, to the same commands run immediately after `trace build`; given a code node whose only `@implements`/`@verifies` target does not exist anywhere in the project, a true dangling reference not owned by any feature, `trace check --strict` loaded from `.musubix/trace.json` still reports `TRACE_DANGLING` for it.

## REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-005: Keep approval manifests unaffected by trace.json scoping
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall continue computing requirements-stage and design-stage approval manifests from each feature's `requirements.md`, `design.md` and the ADRs its design decides, never from any `trace.json` file, so that per-feature trace projection scoping neither creates nor removes approval-manifest sensitivity to a feature's actual specification changes.
Acceptance: Given only an unrelated feature's trace projection changes, with no requirements.md/design.md/ADR edit, the requirements-stage and design-stage approval manifest artifact hash for every other feature's domain is unchanged.
