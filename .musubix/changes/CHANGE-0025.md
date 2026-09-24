---
schemaVersion: 1
id: CHANGE-0025
summary: Prove strict writer-lock recovery synchronization
status: staged
---
# CHANGE-0025: evidence-writer-lock-recovery-sync-proof

Requirements: REQ-EVIDENCE-WRITER-LOCK-001

## Intent

Close the release-review evidence gap found after CHANGE-0024 Quality by proving
that recovery removal never inherits the Windows publication/release directory
synchronization exception.

## Classification

- Defect-proof correction without specification change: preserve the approved
  REQ-EVIDENCE-WRITER-LOCK-001 behavior and make the per-call synchronization
  policy observable to deterministic tests.

## Impact

- Keep CHANGE-0024 production behavior unchanged.
- Refine the test dependency callback to receive the selected
  `allow-unsupported` or `strict` directory-sync policy.
- Add a deterministic recovery test that requires `strict` and rejects Windows
  `EPERM` in a hypothetical capability probe after verified recovery unlink.
- Revise DES-EVIDENCE-WRITER-LOCK-001 with the callback policy interface and
  DES-EVIDENCE-WRITER-LOCK-005 with its deterministic test contract.
- Track the separate acquisition-rollback identity/durability ambiguity in
  Issue #41 rather than freezing unspecified behavior in this correction.

## Verification

- Requirements approval confirmed for
  `89819d6d76d46d3a1e6fa7d16197104fb011b50205540bcbb9172c013150466a`.
- Design approval recorded for
  `9883e1bc8c3a476014da3bdf31d714077945afeaf9a1727cc8ca2df320207e48`.
- TEST-EVIDENCE-WRITER-LOCK-026 records a deterministic failing Red against the
  missing callback policy followed by Green after one policy value became the
  suppression decision and observed test input.
- `npm run typecheck`, `npm run build`, and `npm run pack:check` pass.
- The full Vitest run passes 548 tests with 8 intentional skips across 52 test
  files; the adapter integration file remains environment-gated.
- Acquisition rollback identity/durability is tracked separately by #41.
- Post-unlink recovery durability reporting is tracked separately by #42.

## Residual risks

- The callback is a test seam; production filesystem behavior remains governed
  by the closed platform/error allowlist approved in CHANGE-0024.
