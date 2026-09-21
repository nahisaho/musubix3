---
schemaVersion: 1
id: CHANGE-0016
summary: Merge independently valid append-only evidence histories
status: in-progress
---
# CHANGE-0016: evidence-history-merge

Requirements: REQ-EVIDENCE-HISTORY-MERGE-001 REQ-EVIDENCE-HISTORY-MERGE-002 REQ-EVIDENCE-HISTORY-MERGE-003 REQ-EVIDENCE-HISTORY-MERGE-004 REQ-EVIDENCE-HISTORY-MERGE-005

## Intent

Begin the first phased change for GitHub Issue #28. Add a supported
`evidence merge --incoming <directory>` workflow that combines the current
root's valid append-only evidence history with an independently valid incoming
history without manual JSON editing.

## Impact

- New `evidence-history-merge` requirements, design, ADR, implementation, and
  tests.
- CLI registration and the `evidence-history-merge-tests` command are added,
  with operator documentation in `README.md` and `README-ja.md`.
- Evidence merge covers the monotonic order log, TDD cycles/hash chain, change
  chronology, and change-waiver order references.
- A transaction journal and sibling temporary files provide rollback/roll-forward
  recovery and must be excluded from evidence fingerprints and ordinary evidence
  file discovery.
- Existing evidence refresh, approval stability, concurrent writer locking, and
  root-cause diagnostic suppression remain separate later phases of #28.

## Verification

- Requirements and design approvals are current. CHANGE phase orders are:
  Impact 811, Requirements 812, Design 813, Red 819, Implementation 825,
  Green 826, and Quality 837.
- `TEST-EVIDENCE-HISTORY-MERGE-001` through `005` recorded Red at orders
  814-818, Green at 820-824, Refactor at 827-831, and reviewed fingerprint
  migrations at 832-836.
- The authoritative five tests prove base-first merge/deduplication, rebuilt
  order and TDD hash chains, conflict rejection without writes, byte-identical
  rollback after injected replacement failure, and dry-run parity.
- Seven additional recovery/edge tests cover the pending-journal guard,
  staging-only cleanup, prepared rollback, committed roll-forward, unsafe
  journal remediation, stale-waiver/supersession reporting, and rejection of a
  merged TDD migrate/refactor order inversion.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed, 482 tests passed and 8 skipped.
- `npm run pack:check`: passed, 131 package files and 9 skills verified.
- `trace check --strict`: passed with 535 nodes, 891 edges, and no diagnostics.
- `graph gate`: passed with 88 files, 427 imports, 5060 symbols, and no
  violations.
- Native release-blocker review completed with no findings.
- At release-candidate review, `gate --changed` failed only because the prior
  release approval was stale; the release approval must be prepared and
  recorded against the final manifest after this Verification update.

### Evidence-debt disclosure

The Red fixture helpers required correction after Red so generated fixture
histories contained valid source changes, and the CHANGE Implementation
checkpoint was recorded after the TDD Green records instead of before them.
Because the chronology is append-only, the human approver authorized 16 bounded
waivers at orders 838-853: one `CHANGE_TEST_CHANGED_AFTER_RED`, plus
`CHANGE_RED_UNPROVEN`, `CHANGE_GREEN_UNPROVEN`, and
`CHANGE_COMPLETENESS_TDD` for each of the five requirements. These waivers were
recorded after Quality order 837 and document the recording-process debt; they
do not replace the passing TDD chain, the 12 focused merge/recovery tests, the
482-test full suite, or the final typecheck/build/package/trace/graph evidence.
