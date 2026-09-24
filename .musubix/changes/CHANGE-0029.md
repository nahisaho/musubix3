---
schemaVersion: 1
id: CHANGE-0029
summary: Separate waiver linkage from mutable condition state
status: staged
---
# CHANGE-0029: waiver-linkage-condition-separation

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-002 REQ-CHANGE-EVIDENCE-WAIVER-006

## Intent

Support CHANGE-0028 by making waiver linkage depend only on structural
record identity while using the standalone condition evaluator as the sole
record-time authority.

## Classification

- Behavior correction and specification refinement: prevent resolved or
  unevaluable mutable scope state from being mislabeled as malformed evidence,
  and reject newly requested waivers unless their exact condition is currently
  `true`.

## Impact

- Define valid linkage from code/scope-key shape, chain, and matching order
  evidence rather than mutable chronology, requirement, document, or debt
  state.
- Reject `change waiver record` without writing evidence when the exact
  condition is `false` or `indeterminate`.
- Use the greatest-order validly linked record as authoritative for every
  waiver consumer.
- Preserve existing unambiguous snapshot hashes and append-only waiver
  evidence; when duplicate batch keys exist, include all matching batches in
  the snapshot so a newly owning batch cannot inherit an older waiver.
- Keep record-time evaluator predicates identical to validator emission
  predicates, and reject unsupported `phase:quality` order-migration details
  as invalid grammar.

## Verification

- Cover duplicate batch-key snapshot invalidation, unsupported quality-phase
  scope rejection, and structural linkage after mutable state changes.

## Residual risks

- An `indeterminate` scope remains intentionally unrecordable until its
  change/requirement/batch identity is evaluable.
