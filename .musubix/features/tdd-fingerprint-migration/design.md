# TDD stored-fingerprint algorithm migration design

## DES-TDD-FINGERPRINT-MIGRATION-001: Append-only fingerprint migration chain phase
Responsibilities: Provide a `migrateTddFingerprint` operation that, for one
named TDD cycle, recomputes the test's fingerprint under the retained
superseded algorithm (`legacyTestFingerprint`) against the test's current
source text. If that recomputation equals the cycle's currently effective
stored `testFingerprint` (from its latest passing Green or Refactor phase, or
a prior migration record if one already exists), it appends a new,
chain-linked, monotonically-ordered record of a new phase kind, `migrate`,
carrying the from/to fingerprint pair, an explicit human approver, and a
timestamp — never mutating any existing Red/Green/Refactor phase evidence in
place. If the recomputation does not match, the operation reports a refusal
diagnostic and appends nothing. `validateTddEvidence`'s `TDD_TEST_STALE`
check uses a cycle's latest valid `migrate` record's `toFingerprint` (falling
back to Refactor, then Green, as today) as the effective stored fingerprint
against which the currently live-computed fingerprint is compared.
Interfaces:
- `legacyTestFingerprint(root, test): Promise<string>` — the pre-
  `REQ-TDD-FINGERPRINT-SCOPING-001` algorithm, retained solely so migration
  can prove non-drift; not used for any other evidence computation.
- `migrateTddFingerprint(root, testId, approver): Promise<TddMigrationResult>`
  — exported from `packages/analysis/src/tdd.ts`; loads evidence, resolves
  the named cycle's latest phase, performs the comparison above, and either
  appends the chain record (returning `{ migrated: true, from, to }`) or
  returns `{ migrated: false, reason }` without writing evidence.
- CLI: `musubix3 tdd migrate <test-id> --approver <name> --confirm`, following
  the same explicit `--confirm` pattern as `approval record`.
Constraints: Must not rewrite or delete any existing chain record (append-only
invariant preserved). Must not alter `Red`/`Green`/`Refactor` phase evidence
fields. Must refuse (not silently skip) when the legacy recomputation does
not match, so real drift is never masked as an algorithm-only change. The new
`migrate` phase must participate in the existing hash chain and monotonic
evidence-order validation using the same record shape and rules already
applied to `red`/`green`/`refactor` (chain link, sequence, payload hash).
Requirements: REQ-TDD-FINGERPRINT-MIGRATION-001
ADRs: ADR-0009
