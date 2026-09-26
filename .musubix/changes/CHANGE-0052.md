---
schemaVersion: 1
id: CHANGE-0052
summary: Preflight per-requirement TDD evidence before change phase append
status: staged
---
# CHANGE-0052: change-record-tdd-preflight

Requirements: REQ-CHANGE-RECORD-TDD-PREFLIGHT-001 REQ-CHANGE-RECORD-TDD-PREFLIGHT-002 REQ-CHANGE-RECORD-TDD-PREFLIGHT-003 REQ-CHANGE-RECORD-TDD-PREFLIGHT-004

## Intent

Prevent `change-record red`, `implementation`, and `green` from appending a
requirement batch that lacks the bounded per-requirement TDD evidence required
by the requested phase.

## Source

- GitHub Issue #47.
- CHANGE-0048 accepted a seven-requirement corrective batch even though TDD
  evidence covered only the final requirement; Quality detected the mismatch
  only after append.

## Classification

- Observable evidence-recording defect correction.

## Impact

- Preflight every requested requirement before appending Red, Implementation,
  or Green change evidence.
- Reuse canonical TDD cycle, void, fingerprint, command, and monotonic-order
  semantics rather than creating a weaker parallel proof.
- Return structured phase-specific diagnostics that identify uncovered
  requirements and why candidate cycles were rejected.
- Extend CLI error rendering so JSON mode preserves the phase-specific code,
  phase, uncovered requirement IDs, and deterministic rejection detail.
- Document the three stable preflight codes and write-before-check protection
  in the English and Japanese command guidance, and update the SDD change and
  implementation skills with the required interleaved record ordering.
- Preserve byte-identical change and order evidence on rejection and dry-run.
- Add regression coverage for multi-requirement batches where only the final
  requirement has TDD evidence.
- Migrate existing change-record test fixtures that intentionally append valid
  Red, Implementation, or Green phases so they first persist eligible bounded
  TDD evidence.
- Preserve historical waiver diagnostics by directly synthesizing intentionally
  unproven evidence fixtures, and repair synthetic order-log fixtures affected
  by the stricter preflight.

## Verification

- Approve requirements and design before Red.
- Record real failing Red evidence for each new requirement. The first
  full-set cycles were the organic test-first implementation evidence. After
  the initial Quality checkpoint detected later fixture/doc test additions,
  each requirement received a corrective subset cycle by temporarily removing
  the implemented preflight behavior, observing the unchanged authoritative
  test fail, restoring the reviewed implementation, and recording a new Green.
  Those corrective cycles self-host and prove the newly required interleaved
  `change-record` ordering; they introduce no additional production behavior.
- Run focused tests, typecheck, build, full tests, package checks, strict trace,
  Code Graph, changed and full gates, and status.

## Residual risks

- Historical invalid batches remain governed by validation and waiver evidence;
  this change prevents new invalid appends but does not rewrite prior history.
- Candidate diagnostics explain rejected evidence but do not make malformed or
  stale TDD evidence acceptable.
- A legacy non-void cycle without integer Red order, an invalid order log, or a
  missing change-boundary order record now blocks new Red/Implementation/Green
  appends for the affected requirement. Waivers do not bypass this fail-closed
  preflight; operators must repair or archive legacy evidence and regenerate a
  complete ordered cycle before continuing.
- `tddCycleIntegrityDiagnosticCodes` intentionally mirrors integrity predicates
  from full TDD validation for bounded preflight use. Regression coverage checks
  category ordering and representative projections, including order diagnostics;
  the non-order `tdd-validation` projection is not directly asserted. Future
  edits must keep both paths in sync to avoid diagnostic drift.
