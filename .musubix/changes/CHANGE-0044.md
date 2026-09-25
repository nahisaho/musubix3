---
schemaVersion: 1
id: CHANGE-0044
summary: Correct directory-sync helper forwarding and close coverage gaps
status: staged
---
# CHANGE-0044: transaction-directory-sync-policy-release-review-corrections

Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001

## Intent

Correct the optional-argument forwarding defect found during release review and
close the review's traceable test-coverage gaps without weakening the approved
directory synchronization policy.

## Classification

- Defect correction and corrective test-evidence change.

## Impact

- Preserve the public three-argument helper signatures while ensuring an
  explicitly omitted `openDirectory` does not shift `platform` into the wrong
  parameter position.
- Add one authoritative regression test that fails against the defective
  forwarding and also verifies the previously overclaimed writer-lock policy
  assignments, injected normal-catch rollback unsafe boundary, and
  committed-journal roll-forward unsafe recovery boundaries.
- Correct the acceptance-to-test descriptions so they name only evidence each
  test actually executes.
- Remove the `as DirectorySync` casts and bind the current and legacy helper
  shapes directly to the raw package-index exports.
- Keep the classifier, suppression allowlist, transaction diagnostics, and
  production policy assignments unchanged.

## Verification

- Record a genuine Red for the omitted-`openDirectory` platform callback case.
- Pass `openDirectory` and `platform` positionally to the shared helper, whose
  defaults already handle `undefined`.
- Record Green without changing the authoritative regression test.
- Run focused tests, typecheck, build, full tests, package checks, strict trace,
  Code Graph, changed gate, and status.

## Residual risks

- Workflow reconciliation still requires a completed Copilot session transcript
  with a terminal result or routine shutdown lifecycle.
- Formal checking remains unsupported for filesystem lifecycle semantics and is
  not claimed as behavioral proof.
