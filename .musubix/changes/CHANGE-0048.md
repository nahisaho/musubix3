---
schemaVersion: 1
id: CHANGE-0048
summary: Preserve workflow reconciliation across resumed sessions
status: staged
---
# CHANGE-0048: workflow-resumed-session-durability

Requirements: REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-003 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-005 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-006 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-007 REQ-WORKFLOW-MULTI-SESSION-001 REQ-WORKFLOW-EVIDENCE-WAIVER-012 REQ-WORKFLOW-EVIDENCE-WAIVER-014 REQ-WORKFLOW-WAIVER-BULK-001 REQ-WORKFLOW-WAIVER-BULK-002 REQ-WORKFLOW-WAIVER-BULK-004 REQ-ATTESTATION-EVIDENCE-STABILITY-004

## Intent

Make compatible and strict workflow reconciliation retain deterministic
invocation bindings across session shutdown and resume boundaries without
requiring every historical transcript on every verification run.

## Source

- GitHub Issue #32: Make workflow evidence reconciliation durable across
  resumed sessions.

## Classification

- Observable workflow evidence and gate behavior change.

## Impact

- Add a durable, hash-bound invocation ledger and declaration binding set to
  workflow evidence.
- Bind durable reconciliation digests into the attested workflow evidence head.
- Merge newly verified invocations into the ledger deterministically while
  rejecting conflicting reuse of a tool-call identity.
- Recompute one-to-one declaration bindings independently of transcript
  argument order with the configured event-skew allowance.
- Keep verification absent/stale states fail-closed and non-waivable.
- Replace global transcript-hash waiver invalidation with scope-local
  reconciliation evidence so unrelated resumed-session verification does not
  require repeated waivers.
- Migrate authoritative snapshot-version-1 workflow waivers to scope-local
  snapshot-version-2 successors without requesting repeated human approval.
- Keep stale v2 waiver audit visibility, but report it as a replacement-free
  warning when the scoped allow-listed reason is resolved; unresolved stale
  scopes remain errors.
- Preserve strict-mode session provenance and existing transcript lifecycle
  skew checks while adding declaration-binding skew tolerance.
- Add multi-session, repeated-verification, conflict, residual-stability, and
  clock-skew regression tests.
- Add a confirmed ledger-reset recovery path and document new fail-closed
  diagnostics and waiver-recording preconditions.
- Record ADR-0041 for canonical durable reconciliation and the recoverable
  workflow-first waiver migration protocol.

## Verification

- Obtain current requirements and design approval before Red.
- Record real failing Red tests for durable merge, binding stability,
  scope-local waiver stability, conflict rejection, and clock skew.
- The append-only chronology repair after the initial phase-recording mistake
  uses explicit corrective regression Reds against the completed behavior;
  those later cycles prove that the acceptance tests detect regressions, not
  that their assertions were first authored before every implementation edit.
- Run focused tests, typecheck, build, full tests, package checks, strict trace,
  Code Graph, and the changed quality gate.

## Residual risks

- Historical invocations not present in the durable ledger still require one
  explicit compatible verification with their transcript.
- Version-1 migration deliberately trusts valid declaration linkage plus an
  unchanged-or-resolved reason because legacy records did not persist enough
  local payload data to distinguish unrelated global-head staleness from an
  out-of-band declaration edit.
- After a version-2 successor is persisted, a changed invocation that affects
  a declaration's eligible candidate set intentionally invalidates that waiver.
- Changing configured `maxEventSkewMs` and successfully verifying again changes
  persisted `skewMs`; because it is part of every version-2 scope head, all
  affected historical waivers require review against the new eligibility
  boundary.
- Migrating a currently resolved version-1 scope creates a version-2 successor
  bound to a `null` current reason. If that diagnostic later returns, including
  after a confirmed ledger reset, the successor is stale and requires a new
  approval; while it remains resolved, stale audit visibility is warning-only
  and requires no replacement.
- While version-1 migration is pending or blocked, the historical approval may
  remain active from valid linkage and an identical reason without a
  scope-local binding until waiver evidence is repaired and a persisting
  verification completes migration.
- Before migration, the legacy version-1 compatibility branch treats a validly
  linked same-or-resolved reason as current and therefore does not separately
  report that an obsolete approval could be removed.
- Verification metadata remains fail-closed whenever declarations change until
  a new verification run binds the current event set.
- Repositories that tighten compatible evidence to strict mode must re-run
  strict verification; historical compatible-only evidence may become newly
  reviewed residuals when old strict transcripts are unavailable, or the
  operator must revert the config change.
- Configured-strict release approval cannot finish in the still-running
  session being attested; it resumes in a subsequent Copilot session after the
  prior terminal transcript exists.
