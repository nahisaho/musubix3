---
schemaVersion: 1
id: CHANGE-0039
summary: Add append-only archive evidence for retired TDD cycles
status: staged
---
# CHANGE-0039: tdd-cycle-archive

Requirements: REQ-TDD-CYCLE-ARCHIVE-001 REQ-TDD-CYCLE-ARCHIVE-002 REQ-TDD-CYCLE-ARCHIVE-003 REQ-TDD-CYCLE-ARCHIVE-004 REQ-TDD-CYCLE-ARCHIVE-005 REQ-TDD-CYCLE-ARCHIVE-006 REQ-TDD-CYCLE-ARCHIVE-007 REQ-TDD-CYCLE-ARCHIVE-008 REQ-TDD-CYCLE-ARCHIVE-009 REQ-TDD-CYCLE-ARCHIVE-010 REQ-TDD-CYCLE-ARCHIVE-011 REQ-TDD-CYCLE-ARCHIVE-012 REQ-TDD-CYCLE-ARCHIVE-013

## Intent

Add a human-approved `tdd archive <test-id>` path that retires one latest TDD
cycle without deleting or rewriting prior evidence, while preserving existing
coverage, validation, and append-only integrity rules.

## Classification

- Feature addition for append-only TDD evidence repair and validation.

## Impact

- Extend TDD evidence, linkage validation, merge handling, and CLI wiring with
  an archive phase alongside existing migrate/void flows.
- Preserve coverage semantics, stale-diagnostic scoping, and append-only order
  and hash-chain guarantees.
- Add requirement-scoped tests and a dedicated TDD command for the archive
  feature's Red/Green collection.

## Verification

- Record all thirteen archive requirements through genuine Red/Green TDD cycles.
- Run focused archive tests plus repository typecheck, build, full tests, trace,
  graph, and changed-worktree gate/status checks.

## Residual risks

- Archived cycles intentionally remain in shared append-only evidence, so stale
  or malformed archive linkage can still affect repository-wide validation until
  repaired.
- Feature correctness depends on deterministic order/chain append behavior that
  must remain aligned across analysis, merge, and CLI layers.
