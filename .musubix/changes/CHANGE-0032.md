---
schemaVersion: 1
id: CHANGE-0032
summary: Finalize waiver stale evidence and remediation semantics
status: staged
---
# CHANGE-0032: waiver-stale-release-corrections

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-011

## Intent

Close final release-review gaps in stale-waiver coverage, document-absence
snapshot compatibility, predicate sharing, and audit remediation wording.

## Classification

- Defect correction and specification clarification.

## Impact

- Prove `true` and `indeterminate` stale errors in both change validators.
- State the intentional same-version hash change for non-record-missing scopes
  whose change document is absent but chronology remains.
- Reuse the batch order-migration predicate across evaluator and emission.
- Describe condition `false` as no longer reported, without claiming all
  underlying debt is resolved.

## Verification

- `TEST-CHANGE-EVIDENCE-WAIVER-027` proves `false`, `true`, and
  `indeterminate` remediation/severity in both validators.
- Existing batch-key fixtures plus the shared item predicate preserve
  absent/integer/non-integer and single/multi-match emission parity.
- The waiver suite passes 27/27 alongside typecheck and build.

## Residual risks

- Exact restoration of the originally approved state can reactivate a waiver,
  as documented by REQ-011.
