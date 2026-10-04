---
schemaVersion: 1
feature: tdd-cycle-archive
---
# TDD cycle archive design

## DES-TDD-CYCLE-ARCHIVE-001: Archive evidence model and append-only recording
Responsibilities: Extend `packages/analysis/src/tdd.ts` with a new
`TddArchiveEvidence` type mirroring `TddVoidEvidence` exactly except for
`phase: 'archive'`, additionally capturing the owning `testId` and
`cycleId` on the payload itself (per REQ-005/REQ-006 identity-binding), and
add `archive?: TddArchiveEvidence` to `TddCycle`.
Extend `TddChainPhase` from `TddPhase | 'migrate' | 'void'` to
`TddPhase | 'migrate' | 'void' | 'archive'`, and extend every existing
phase-enumeration that validates chain presence or immutable payload
matching so `archive` is treated as a first-class append-only phase beside
`void`/`migrate` (the `for (const phase of [...])` loop inside
`validateTddEvidence` at `tdd.ts:655`, the `TDD_PHASES` constant in
`packages/analysis/src/evidence-merge.ts:57` and every loop iterating it
for cycle-ownership tracking, merge conflict detection, and evidence
reconstruction, plus any other exact phase unions in `tdd.ts` or
`evidence-merge.ts` that must stay exhaustive so merged/reconstructed
evidence preserves `archive` payloads exactly as it already preserves
`void`/`migrate` payloads). Add `TddArchiveResult = { archived: boolean; testId:
string; cycleId?: string; reason?: string }` and implement
`archiveTddCycle(root, testId, approver, reason): Promise<TddArchiveResult>`
as an exported `withEvidenceWriterLock(root, 'tdd archive', ...)` wrapper
around `archiveTddCycleUnlocked`, structurally mirroring `voidTddCycle`.
`archiveTddCycleUnlocked` loads the latest cycle for `testId`, rejects when
no evidence or no cycle exists, does not consult `green.valid`, and does
not require any earlier fallback cycle. Once all preconditions pass, it
creates `cycle.archive = { phase: 'archive', approver, reason, testId:
cycle.testId, cycleId: cycle.cycleId, recordedAt, order }`, appends
exactly one `appendEvidenceOrder(root, { kind: 'tdd', entityId:
cycle.cycleId, phase: 'archive', testId: cycle.testId })`
record, appends exactly one `appendChainRecord(evidence, cycle, 'archive',
record)` chain record, and writes the updated evidence without modifying
any pre-existing `red`/`green`/`refactor`/`migrate`/`void` payloads or any
other cycle. `packages/analysis/src/index.ts` already re-exports
`./tdd.js` via `export *`, so exporting `archiveTddCycle`,
`TddArchiveResult`, and `TddArchiveEvidence` from `tdd.ts` is sufficient
for downstream consumers; no new hand-maintained index export list is
needed.
Interfaces: `export interface TddArchiveEvidence { phase: 'archive';
approver: string; reason: string; testId: string; cycleId: string;
order?: number; recordedAt: string }`;
`export interface TddCycle { ...; archive?: TddArchiveEvidence }`;
`export type TddChainPhase = TddPhase | 'migrate' | 'void' | 'archive'`;
`export interface TddArchiveResult { archived: boolean; testId: string;
cycleId?: string; reason?: string }`; `export async function
archiveTddCycle(root: string, testId: string, approver: string, reason:
string): Promise<TddArchiveResult>`.
Constraints: `archiveTddCycle` must preserve REQ-001/REQ-002 literally:
archiving is allowed whether the latest cycle's Red/Green is valid,
invalid, or absent, and whether or not any earlier cycle exists. It must
reuse the existing `appendEvidenceOrder` and `appendChainRecord` helpers
instead of introducing a second archive-specific order/chain format. It
must reject before writing anything when `cycle.cycleId` is missing or when
the same "legacy evidence lacks an append-only hash chain" preflight that
`voidTddCycle` uses would make chain append impossible after an order write.
The added `archive` field is additive and must not alter `runTddPhase`'s
Red/Green/Refactor recording logic.
Requirements: REQ-TDD-CYCLE-ARCHIVE-001, REQ-TDD-CYCLE-ARCHIVE-002, REQ-TDD-CYCLE-ARCHIVE-005
ADRs: none — this reuses the existing append-only TDD evidence, order-log, and hash-chain architecture already established for Red/Green/Refactor/Migrate/Void without introducing a new architectural boundary.
Depends-On: none

## DES-TDD-CYCLE-ARCHIVE-002: Archive/void command preconditions, precedence, and CLI wiring
Responsibilities: Define one shared "marker already present" policy for the
latest cycle. In `archiveTddCycleUnlocked`, after validating
`approver?.trim()` and `reason?.trim()` but before any `green.valid`,
fallback, or cycle-repair preconditions, reject if the latest cycle
already carries either `cycle.void` or `cycle.archive`, whether validly
linked or malformed, so archive never overwrites or coexists with another
retirement marker. Symmetrically, in `voidTddCycleUnlocked`, keep the
existing argument-validation-first flow but move/add the marker checks so
the order becomes: validate non-empty `approver`/`reason`; load evidence
and latest cycle; reject if `cycle.void` is present; reject if
`cycle.archive` is present; only then evaluate `cycle.green?.valid`,
`cycle.cycleId`, legacy-chain preflight, and earlier-fallback eligibility.
Also tighten `voidTddCycleUnlocked`'s earlier-fallback scan so an earlier
cycle is eligible only when it has `red.valid`, `green?.valid`, no `void`
payload, and no `archive` payload at all; the exclusion is presence-based,
not linkage-based, so malformed archive payloads are also ineligible as
fallback candidates. Add the new CLI command in `packages/cli/src/main.ts`
as `common(tdd.command('archive <test-id>'))`, mirroring the existing
`tdd void <test-id>` block exactly: required `--approver <name>`,
required `--reason <text>`, optional `--confirm` flag defaulting false,
pre-call rejection with `if (!options.confirm) throw new Error('Archiving
a TDD cycle requires --confirm.');`, then `const archiveResult = await
archiveTddCycle(root, testId, options.approver, options.reason);`,
`output(archiveResult, !!options.json, archiveResult.archived ? \`ARCHIVE:
PASS (\${testId}) cycle=\${archiveResult.cycleId}\` : \`ARCHIVE: FAIL
(\${testId}) \${archiveResult.reason}\`)`, and `process.exitCode = 1` when
`!archiveResult.archived`. Import `archiveTddCycle` beside
`migrateTddFingerprint`/`voidTddCycle`.
Interfaces: Internal latest-cycle marker policy is still simple payload
presence checks (`if (cycle.void)`, `if (cycle.archive)`) rather than
linkage predicates; CLI interface: `tdd archive <test-id> --approver
<name> --reason <text> --confirm`.
Constraints: The marker-present rejection must take precedence over
`tdd void`'s valid-Green rejection and over its fallback-eligibility
rejection, exactly matching REQ-004. `archiveTddCycle` must perform
argument validation before marker-present checks so a missing/blank
`--approver` or `--reason` still reports the argument error first. No
archive/void rejection path may write to `.musubix/evidence/tdd.json` or
`.musubix/evidence/order.json`. Older non-latest cycles with `void` or
`archive` payloads must not block archive/void of a fresh later cycle for
the same `testId`; only the latest cycle and, for `void` fallback
selection, the explicitly scanned earlier candidates matter.
Requirements: REQ-TDD-CYCLE-ARCHIVE-003, REQ-TDD-CYCLE-ARCHIVE-004
ADRs: none — this is a narrow extension of the existing `tdd void`/`tdd migrate` command and latest-cycle eligibility pattern, with no new architectural decision.
Depends-On: DES-TDD-CYCLE-ARCHIVE-001

## DES-TDD-CYCLE-ARCHIVE-003: Archive linkage validation, malformed diagnostics, and JSON surfacing
Responsibilities: Add `archiveLinkage(evidence, order, cycle):
{ valid: boolean; reason?: string }` in `packages/analysis/src/tdd.ts`,
mirroring `voidLinkage`'s public shape and failure taxonomy exactly but
checking `cycle.archive`, `phase: 'archive'`, and the archive payload.
`phaseLinkageValid` should be generalized just enough that `phase ===
'archive'` behaves like the void case for order lookup: it reads
`cycle.archive?.order`, requires `evidenceOrderRecord(order.records, 'tdd',
cycle.cycleId, 'archive')`, and requires that order record's `testId`
equal `cycle.testId`. `archiveLinkage` is valid only when REQ-006 holds:
the order log itself is valid, `cycle.archive.testId === cycle.testId`
and `cycle.archive.cycleId === cycle.cycleId` (rejecting a tampered
payload with mismatched embedded identity even if its hash and order/chain
records otherwise line up), exactly one matching `order.json` record
exists for `phase: 'archive'` and this cycle's `cycleId` (scanned by
`cycleId`+`phase` only, since `order.json` is never keyed by `testId`),
no more than one chain record declares `phase: 'archive'` for that same
`cycleId` regardless of `testId` (an `identityChainRecords` count computed
independently of `phaseLinkageValid`'s own `testId`-scoped match, so a
conflicting record under a different `testId` cannot be silently ignored),
that single chain record carries the same `testId`/`cycleId` as the
archived cycle, its `previousSha256` links to the immediately preceding
chain record, and its `phaseEvidenceSha256` equals
`digest(JSON.stringify(cycle.archive))`.
Any failure returns `{ valid: false, reason: "...archive evidence is
malformed: <specific reason>." }`, and `validateTddEvidence` emits a new
`TDD_ARCHIVE_EVIDENCE_MALFORMED` diagnostic for every cycle whose
`cycle.archive` exists but `archiveLinkage(...).valid` is false. In the
same validation pass, compute `validlyArchivedCycles: Set<TddCycle>` and a
new `archived: Array<{ testId: string; cycleId: string; archive:
{ approver: string; reason: string; recordedAt: string } }>` return field,
populated with exactly one entry per validly archived cycle, keyed by that
cycle's own `testId`/`cycleId`, with payload values copied verbatim from
that cycle's `archive` object. Extend the no-evidence early return to
include `archived: []`, and let the existing `tdd validate --json` command
surface the new array automatically through its unchanged `output(report,
!!options.json, ...)` behavior.
Verification: `TEST-TDD-CYCLE-ARCHIVE-014` exercises the conflicting-`testId`
`identityChainRecords` guard directly by appending a second, correctly
hash-linked `archive` chain record under a different `testId` but the same
`cycleId`, confirming `TDD_ARCHIVE_EVIDENCE_MALFORMED` fires and the cycle is
excluded from `archived`.
Interfaces: `function archiveLinkage(evidence: TddEvidence, order:
ReturnType<typeof validateEvidenceOrderLog>, cycle: TddCycle): { valid:
boolean; reason?: string }`; `validateTddEvidence(root: string):
Promise<{ present: boolean; valid: boolean; diagnostics: Diagnostic[];
cycles: number; voided: Array<...>; archived: Array<{ testId: string;
cycleId: string; archive: { approver: string; reason: string; recordedAt:
string } }> }>`; new diagnostic code:
`TDD_ARCHIVE_EVIDENCE_MALFORMED`.
Constraints: Malformed archive evidence must not suppress any cycle-local
diagnostic; it only adds `TDD_ARCHIVE_EVIDENCE_MALFORMED` on top of them.
This does not shield a malformed archive payload from the pre-existing,
archive-status-independent, generic chain/order-log integrity checks
(`TDD_CHAIN_PHASE_MISSING`, `TDD_CHAIN_PAYLOAD_MISMATCH`, `TDD_CHAIN_*`,
`TDD_ORDER_*`): per REQ-TDD-CYCLE-ARCHIVE-008 those remain unsuppressed and
unmodified for every cycle regardless of archive validity, exactly
mirroring existing `void` behavior, so REQ-TDD-CYCLE-ARCHIVE-007's "no
other diagnostic" guarantee is scoped to cycle-local stale-evidence
diagnostics only, never to these cross-cutting integrity diagnostics.
`archived`
contains only validly linked archive payloads, never malformed ones, and
must not merge entries across cycles sharing the same `testId`. The new
linkage rules must be identity-bound per cycle, not merely per test ID.
Requirements: REQ-TDD-CYCLE-ARCHIVE-006, REQ-TDD-CYCLE-ARCHIVE-007, REQ-TDD-CYCLE-ARCHIVE-013
ADRs: none — archive linkage and JSON reporting reuse the existing `phaseLinkageValid`/`voidLinkage` validation model and add only another phase-specific instance of that already-decided mechanism.
Depends-On: DES-TDD-CYCLE-ARCHIVE-001

## DES-TDD-CYCLE-ARCHIVE-004: Suppress only the archived cycle's stale-evidence diagnostics
Responsibilities: In `validateTddEvidence`, compute
`validlyArchivedCycles` beside `validlyVoidedCycles` and thread it through
the exact cycle-local diagnostic call sites named by REQ-008. The guards
for `TDD_RED_MISSING`, `TDD_GREEN_MISSING`, the Red-side
`TDD_LEGACY_OR_UNSCOPED_EVIDENCE`, the Green-side
`TDD_LEGACY_OR_UNSCOPED_EVIDENCE` inside `if (cycle.green?.valid)`, the
Refactor-side `TDD_LEGACY_OR_UNSCOPED_EVIDENCE` call site (at
`tdd.ts:822`, guarded by `if (cycle.refactor?.valid && ...)`), the
migrate-side `TDD_LEGACY_OR_UNSCOPED_EVIDENCE` call site (at `tdd.ts:779`,
guarded by `if (!cycle.migrate.approver)` inside `if (cycle.migrate)`),
`TDD_GREEN_WITHOUT_SOURCE_CHANGE`, and both `TDD_COMMAND_CHANGED` call
sites (Red/Green mismatch and Red/Refactor mismatch) each gain an added
`&& !validlyArchivedCycles.has(cycle)` condition, alongside the existing
`!supersededCycles.has(cycle)` and/or `!validlyVoidedCycles.has(cycle)`
logic as appropriate. Do not add such a guard to
`TDD_EVIDENCE_REUSED`, `TDD_DURATION_INVALID`, `TDD_ORDER_MIGRATION_REQUIRED`,
`TDD_ORDER_MISMATCH`, `TDD_ORDER_SEQUENCE`, `TDD_CHAIN_MISSING`,
`TDD_CHAIN_SEQUENCE`, `TDD_CHAIN_LINK`, `TDD_CHAIN_HASH_MISMATCH`,
`TDD_CHAIN_PHASE_DUPLICATE`, `TDD_CHAIN_PHASE_MISSING`,
`TDD_CHAIN_PAYLOAD_MISMATCH`, or `TDD_CHAIN_ORPHAN`; archived cycles
keep participating in every cross-cycle integrity and append-only-history
check exactly as non-archived cycles do. For `TDD_TEST_STALE`, archive
does not introduce a fallback concept the way void does, so
`isStaleTarget` must be refined to exclude any cycle whose own
effective-latest status is archived or whose descendant actual latest
cycle is validly archived. Concretely:
when `latestCycles.get(testId)` is validly archived, no cycle for that
`testId` is a stale target until a fresh later cycle is recorded; when the
actual latest cycle is validly voided, the existing `effectiveLatestCycle`
fallback remains in use only if the resolved target is not itself in
`validlyArchivedCycles`; otherwise stale checking is skipped for that test
ID. This is not cross-cycle suppression of another cycle's diagnostic:
without void's valid-fallback mechanism, an older non-latest cycle for
that `testId` was never an eligible stale target in the first place, so
removing the stale target entirely when the latest is archived changes
only the archived cycle's own (lack of) `TDD_TEST_STALE`, honoring
REQ-009's requirement that unrelated cycles' diagnostics stay unaffected.
Interfaces: No new exported API beyond the `archived` field from
DES-TDD-CYCLE-ARCHIVE-003; internally, `validateTddEvidence` now maintains
`const validlyArchivedCycles = new Set<TddCycle>()` and uses it in the
named guard call sites and in `isStaleTarget` computation.
Constraints: Suppression is linkage-based, not payload-presence-based:
only `archiveLinkage(...).valid === true` grants suppression. A malformed
archive payload must still raise the same unsuppressed diagnostics the cycle
would have raised without any archive payload. Archiving one cycle must not
suppress diagnostics for a different cycle, even under the same `testId`,
except that REQ-008 explicitly removes the stale target entirely while the
actual latest status for that `testId` is validly archived.
Requirements: REQ-TDD-CYCLE-ARCHIVE-008, REQ-TDD-CYCLE-ARCHIVE-009
ADRs: none — this is scoped guard refinement inside the existing validator, not a new architectural boundary.
Depends-On: DES-TDD-CYCLE-ARCHIVE-003

## DES-TDD-CYCLE-ARCHIVE-005: Preserve coverage semantics, allow fresh cycles, and reject migration of an archived latest cycle
Responsibilities: Keep `TDD_REQUIREMENT_UNCOVERED` exactly on its current
criteria — authoritative verifying test, `red.valid`, and `green?.valid` —
without consulting either `validlyArchivedCycles` or archive payload
presence, so archive neither creates nor removes mandatory-requirement
coverage. Preserve `runTddPhaseUnlocked`'s current Red behavior for
REQ-011: a fresh `tdd red <test-id>` always appends a new cycle even when
the previously latest cycle for that `testId` is validly archived, so no
archive-specific guard should be added to Red recording. The existing
`supersededCycles` computation already marks an earlier archived cycle as
superseded once a later cycle for the same `testId` records both a valid
Red and a valid Green, so REQ-011 needs no archive-specific supersession
branch. Reject `tdd migrate <test-id>` when the latest cycle is validly
archived by inserting
an archive check in `migrateTddFingerprint` immediately after
`const order = await inspectEvidenceOrder(root);` and before the existing
validly-voided rerouting block. The flow becomes: select the raw latest
cycle; load `order`; if `archiveLinkage(evidence, order, cycle).valid`,
throw an error stating `${testId}'s latest cycle is archived and cannot be
migrated; record a fresh Red-Green cycle instead.`; otherwise continue with
the existing `voidLinkage(...).valid` rerouting-to-`effectiveLatestCycle`
logic, then the existing `!cycle.cycleId`, `!cycle.green?.valid`,
`cycle.migrate`, and fingerprint checks. This makes archive a hard stop for
migration, while still letting a later fresh cycle become the new latest
cycle and then participate in ordinary migrate/validate behavior.
Interfaces: No new public signatures beyond those already introduced; the
observable migration behavior change is a new rejection path in
`migrateTddFingerprint(root, testId, approver): Promise<TddMigrationResult>`.
Constraints: REQ-010 forbids touching requirement coverage logic, so no
archive/void branch may be added to the `covered = evidence.cycles.some(...)`
predicate for mandatory requirements. REQ-011 means archived latest cycles
must not block a later Red phase. REQ-012's rejection is linkage-based:
only a validly archived latest cycle blocks migration; malformed archive
payloads remain handled by normal validation diagnostics rather than by this
migration precondition.
Requirements: REQ-TDD-CYCLE-ARCHIVE-010, REQ-TDD-CYCLE-ARCHIVE-011, REQ-TDD-CYCLE-ARCHIVE-012
ADRs: none — these are policy refinements over existing coverage, phase-recording, and migration flows, with no new architectural decision.
Depends-On: DES-TDD-CYCLE-ARCHIVE-001 DES-TDD-CYCLE-ARCHIVE-003 DES-TDD-CYCLE-ARCHIVE-004
