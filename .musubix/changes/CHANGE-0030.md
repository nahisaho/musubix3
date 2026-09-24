---
schemaVersion: 1
id: CHANGE-0030
summary: Clarify aggregate phase-missing waiver detail grammar
status: staged
---
# CHANGE-0030: phase-missing-detail-grammar

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-016

## Intent

Remove the ambiguity between aggregate `CHANGE_PHASE_MISSING` details and
batch-scoped `CHANGE_ORDER_MIGRATION_REQUIRED` details so record-time parsing,
validator emission, and snapshot evaluation use one canonical grammar.

## Classification

- Specification correction with validation hardening: aggregate phase-missing
  diagnostics use `phase:<phaseName>` for all seven phases, while
  `batch:<phaseName>:<batchKey>` belongs only to order-migration diagnostics.

## Impact

- Define `phase:red`, `phase:implementation`, and `phase:green` as canonical
  aggregate `CHANGE_PHASE_MISSING` details.
- Reject `batch:` details for `CHANGE_PHASE_MISSING` as invalid grammar before
  condition evaluation.
- Preserve the existing batch grammar for
  `CHANGE_ORDER_MIGRATION_REQUIRED`.

## Verification

- Add a Red/Green regression proving the invalid cross-code `batch:` grammar is
  rejected without evidence writes while aggregate `phase:red` remains valid.

## Residual risks

- Existing structurally valid records keep their stored detail values; this
  change only makes the previously intended code-specific grammar explicit.
- A legacy stored detail outside the clarified grammar becomes malformed
  linkage and blocks new waiver appends until the append-only chain is
  repaired; all currently stored waiver details satisfy the clarified grammar.
