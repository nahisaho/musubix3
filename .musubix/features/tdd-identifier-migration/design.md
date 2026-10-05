---
schemaVersion: 1
feature: tdd-identifier-migration
---
# TDD identifier-only evidence migration design

## DES-TDD-IDENTIFIER-MIGRATION-001: Route `tdd migrate` by arity while preserving the one-ID mode
Responsibilities: Extend the CLI and analysis entrypoint so `tdd migrate`
accepts either one test ID or an old/new test-ID pair. One positional ID
continues to invoke the existing stored-fingerprint migration flow unchanged.
Two positional IDs invoke a new identifier-relink flow that treats the first
argument as the covered historical ID and the second as the renamed current
authoritative ID. Argument arity validation remains fail-closed: zero IDs or
more than two IDs are usage errors and persist nothing.
Interfaces:
- `packages/cli/src/main.ts`: register `tdd migrate [ids...]` (or equivalent
  Commander shape) and dispatch one-ID invocations to the existing
  `migrateTddFingerprint(root, testId, approver)` path while dispatching
  two-ID invocations to a new
  `migrateTddIdentifier(root, oldTestId, newTestId, approver)` path.
- `packages/analysis/src/tdd.ts`: export
  `migrateTddIdentifier(root, oldTestId, newTestId, approver): Promise<TddIdentifierMigrationResult>`.
Constraints: The one-ID behavior defined by
`REQ-TDD-FINGERPRINT-MIGRATION-001` must remain byte-for-byte compatible in
its evidence effects and rejection behavior. A later one-ID invocation against
the current effective test ID of a cycle that already has identifier-mode
migrate history remains legal only as an additional fingerprint migration on
that same cycle; it appends a new `mode: 'fingerprint'` migrate record onto
the existing additive migrate stream and must never erase or "collapse" the
earlier identifier-mode relink back into the legacy singular shape. The two-ID
mode must require `oldTestId !== newTestId` before any evidence read that
would inform a write.
Requirements: REQ-TDD-IDENTIFIER-MIGRATION-001, REQ-TDD-IDENTIFIER-MIGRATION-005
ADRs: ADR-0009, ADR-0040
Depends-On: none

## DES-TDD-IDENTIFIER-MIGRATION-002: Prove pure rename eligibility against the effective covered cycle
Responsibilities: Implement the two-ID migration as a proof over the same
effective cycle that ordinary `tdd migrate` already targets. Resolve
`oldTestId`'s raw latest cycle, reject immediately when that latest cycle is
validly archived, and reroute across a validly voided latest cycle through the
existing `effectiveLatestCycle(...)` logic before evaluating any rename-only
preconditions. Resolve the current authoritative test declaration for
`newTestId` from the trace graph, require it to remain in the same test file as
the covered old cycle, require the current trace to contain exactly one
surviving authoritative declaration for `newTestId` at that preserved
path/context, and require the current trace to contain no surviving
authoritative declaration for `oldTestId` anywhere. Prove "identifier-only"
drift by rewriting only two source-side fields from `newTestId` back to
`oldTestId` before hashing the full declaration slice: the authoritative
`@id TEST-*` annotation text and the exact adapter-matched identity string that
the current adapter-recognition logic would use for that test. Compare the
normalized declaration fingerprint to the old cycle's current effective
fingerprint (the `toFingerprint` of the latest valid migrate record in the
cycle's effective migrate stream when present, otherwise the latest valid
Refactor or Green fingerprint), and also require the cycle's non-test
`sourceFingerprint` to remain unchanged.
Interfaces:
- `packages/analysis/src/tdd.ts`: factor helpers for
  `currentEffectiveTddCycle(...)`, `currentEffectiveFingerprint(...)`, and
  `normalizedIdentifierMigrationFingerprint(root, traceNode, oldTestId, newTestId)`,
  where `currentEffectiveFingerprint(...)` reads the latest entry from
  `cycle.migrateHistory ?? (cycle.migrate ? [cycle.migrate] : [])` so a prior
  one-ID migrate remains a valid baseline for a later relink on the same
  covered cycle.
- Reuse existing trace loading via `buildTrace(root)` and existing archive/void
  linkage helpers instead of duplicating cycle-selection semantics.
Constraints: The normalized comparison must remain declaration-scoped, never a
whole-file textual diff. Any added/removed executable statement, assertion,
helper call, literal, annotation other than the rewritten `@id`, or adapter
identity string is a hard rejection. A different test file path, any surviving
authoritative `oldTestId` declaration anywhere in the trace, a missing
`newTestId` declaration, or a changed `sourceFingerprint` are all hard
rejections that record nothing.
Requirements: REQ-TDD-IDENTIFIER-MIGRATION-002, REQ-TDD-IDENTIFIER-MIGRATION-003
ADRs: ADR-0023, ADR-0040
Depends-On: DES-TDD-IDENTIFIER-MIGRATION-001

## DES-TDD-IDENTIFIER-MIGRATION-003: Record identifier relinks as append-only `migrate` evidence with explicit old/new identity
Responsibilities: Reuse the existing append-only `migrate` phase rather than
introducing a second relink-only phase. Extend the persisted migrate model so
it can represent both modes, and more than one migrate record on the same
covered cycle, without ambiguity: retain `fromFingerprint`, `toFingerprint`,
`approver`, `recordedAt`, and `order`, and add mode-specific identity fields
sufficient for audit and conflict detection (`mode: 'fingerprint' |
'identifier'`, `oldTestId?`, `newTestId?`, and the target `cycleId` carried by
the owning cycle/order identity). Preserve the existing singular
`cycle.migrate` payload as the backward-compatible first-entry view, and add an
ordered additive companion collection (`cycle.migrateHistory` or an equivalent
compatibility-preserving representation) that validation treats as the
authoritative migrate stream whenever present. The one-ID mode on an
unmigrated cycle records `mode: 'fingerprint'` in the legacy singular shape
with no old/new override. The two-ID mode records `mode: 'identifier'`, names
both test IDs, and appends exactly one new order entry plus exactly one new
chain record without mutating the cycle's existing Red/Green/Refactor payloads;
if the cycle already has a legacy one-ID `migrate`, the relink adds the
companion migrate-history view instead of overwriting that original payload.
For identifier-mode records, `fromFingerprint` remains the old cycle's prior
effective fingerprint, while `toFingerprint` becomes the actual current
declaration fingerprint of `newTestId` before normalization; replay/validation
thereafter derives the cycle's effective current identity from the latest
identifier-mode migrate record (`newTestId` when present, otherwise the legacy
`cycle.testId`). Every stale-check, requirement-coverage, and gate-evaluation
path that currently keys on `cycle.testId` must instead resolve and use that
same effective identity, and compare its current declaration fingerprint
against the latest migrate record's `toFingerprint`, so a successful relink
deterministically clears both `TDD_TEST_STALE` and rename-caused
`TDD_REQUIREMENT_UNCOVERED` outcomes without mutating the old Red/Green
evidence. Validation treats an
identifier-mode migrate record as malformed unless its payload, order entry,
and chain record all agree on the target cycle and the named old/new
identifiers, so later conflicting relinks of the same covered cycle are
rejected deterministically. If a cycle already has identifier-mode migrate
history, any later one-ID fingerprint migration targets that cycle's current
effective identity (`newTestId` from the latest identifier-mode relink) and
appends after the relink in the same ordered migrate stream, so mixed
fingerprint-plus-identifier migrations remain replayable without ambiguity.
Interfaces:
- `packages/analysis/src/tdd.ts`: extend `TddMigrationEvidence`,
  `TddMigrationResult` (or add `TddIdentifierMigrationResult`), `TddCycle`
  with additive migrate-history support, the migrate validation path, the
  requirement-coverage/stale-resolution path, and any migrate-evidence JSON
  rendering returned by `validateTddEvidence`.
- `packages/analysis/src/order.ts`: extend `EvidenceOrderRecord`,
  `EvidenceOrderScope`, and `appendEvidenceOrder(...)` so identifier-mode
  migrate order entries can carry `oldTestId`/`newTestId`, and so the migrate
  record key scopes those identifiers when present instead of colliding with
  the legacy one-record-per-cycle key.
- `packages/analysis/src/evidence-merge.ts`: preserve the extended migrate
  payload and additive migrate-history representation during
  reconstruction/merge, and treat the enriched payload hash as the
  authoritative identity for migrated records.
Constraints: The new fields are additive and must not invalidate pre-existing
one-ID migrate evidence. One-ID migrate on an unmigrated cycle must continue to
persist the legacy singular `cycle.migrate` shape so pre-existing evidence
effects stay compatible. Two-ID migration must reject if the effective migrate
stream already carries a conflicting identifier-mode migrate record targeting a
different `newTestId`, if an identical identifier-mode relink is attempted a
second time, or if `newTestId` already has its own cycle history.
Requirements: REQ-TDD-IDENTIFIER-MIGRATION-003, REQ-TDD-IDENTIFIER-MIGRATION-004
ADRs: ADR-0009, ADR-0040
Depends-On: DES-TDD-IDENTIFIER-MIGRATION-002

## DES-TDD-IDENTIFIER-MIGRATION-004: Document both migrate forms and keep adoption-warning wording accurate
Responsibilities: Update the dedicated `tdd migrate` help text and README
command reference so operators can discover both supported forms:
`tdd migrate <test-id>` for stored-fingerprint migration and
`tdd migrate <old-id> <new-id>` for identifier-only relinking. Update the
existing `tdd red` adoption-warning wording and README prose only enough to
remove the stale "only re-fingerprints" description and replace it with the
accurate statement that `tdd migrate` reuses already covered valid
Green-backed evidence rather than bulk-onboarding uncovered requirements.
Interfaces:
- `packages/cli/src/main.ts`: `tdd migrate --help` description and
  `tdd red --help` wording.
- `README.md`: command-reference rows for `tdd migrate` and
  `tdd red|green|refactor`.
- `.musubix/features/tdd-adoption-warning/design.md`: refresh DES-TDD-ADOPTION-WARNING-003 wording so the design matches the updated requirement semantics.
Constraints: This documentation work must not change command flags, exit codes,
or JSON payload shapes. The adoption-warning update is wording-only and must
not broaden that feature's behavior beyond keeping its `tdd migrate`
description accurate after the two-ID mode ships.
Requirements: REQ-TDD-IDENTIFIER-MIGRATION-005, REQ-TDD-ADOPTION-WARNING-002
ADRs: ADR-0040
Depends-On: DES-TDD-IDENTIFIER-MIGRATION-001
