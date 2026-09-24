---
schemaVersion: 1
id: CHANGE-0031
summary: Close waiver stale-classification release review gaps
status: staged
---
# CHANGE-0031: waiver-stale-corrective-coverage

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-011

## Intent

Apply release-review corrections that cannot reuse CHANGE-0028's completed
REQ-011 Red/Implementation/Green subset.

## Classification

- Defect correction: ensure current-condition `false` always reports a stale
  warning and duplicate batch-key state changes invalidate the earlier waiver
  snapshot.

## Impact

- Prove hash-stable resolved conditions are stale warnings in both validators.
- Include every duplicate batch-key match in deterministic snapshot payloads.
- Preserve existing zero/single-match snapshot hashes.

## Verification

- TEST-CHANGE-EVIDENCE-WAIVER-022 and
  TEST-CHANGE-EVIDENCE-WAIVER-023 provide the corrective Red/Green evidence.

## Residual risks

- Staleness remains a stateless current-state classification; exact restoration
  of the originally approved state may reactivate a waiver.
