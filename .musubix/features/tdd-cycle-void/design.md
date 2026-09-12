# TDD cycle void design

## DES-TDD-CYCLE-VOID-001: Void evidence data model, eligibility checks, and `tdd void` command
Responsibilities: Add a `TddVoidEvidence` shape (`phase: 'void'`, `approver`,
`reason`, `recordedAt`, `order?`) and extend `TddChainPhase` to include
`'void'`. Add a `void?: TddVoidEvidence` field on `TddCycle`. Implement
`voidTddCycle(root, testId, approver, reason): Promise<TddVoidResult>` in
`packages/analysis/src/tdd.ts`, mirroring the structure of
`migrateTddFingerprint`: load evidence and the order log (via
`inspectEvidenceOrder`, needed by the shared linkage predicate in
DES-TDD-CYCLE-VOID-002), locate the latest recorded cycle for `testId`,
and reject (no evidence written, no order/chain append attempted) when
any of the following holds: the latest cycle's Green is already `valid`
(REQ-001); the latest cycle already carries a `void` field at all —
whether validly linked or malformed (REQ-011's re-void case, tightened
here to also cover malformed void payloads so `tdd void` never overwrites
or duplicates evidence for an already-voided-looking cycle); no earlier
recorded cycle for the same `testId`, appearing before the latest cycle in
`evidence.cycles`, has both `red.valid` and `green?.valid` and is not
itself validly voided per DES-TDD-CYCLE-VOID-002's linkage predicate
(REQ-002); `approver` or `reason` is empty/whitespace-only (REQ-003; the
CLI layer separately enforces `--confirm`, see below); or `cycle.cycleId`
is missing, or the evidence has no `chain` array while `evidence.cycles`
contains more than this one cycle (the same "legacy evidence lacks an
append-only hash chain" condition `appendChainRecord` itself guards
against) — checking this explicitly here, before calling
`appendEvidenceOrder`, so a chain-append failure can never happen after an
order record has already been written to disk. Only once every check
passes does the function mutate anything: set `cycle.void`, call
`appendEvidenceOrder(root, { kind: 'tdd', entityId: cycle.cycleId, phase:
'void', testId: cycle.testId })` for the order sequence, call the existing
`appendChainRecord(evidence, cycle, 'void', record)` for the chain record,
and `writeJson` the updated evidence (REQ-004). This requires extending
`EvidenceOrderRecord` (`packages/analysis/src/order.ts`) with one new
optional field, `testId?: string`, and `appendEvidenceOrder`'s input type
to accept it; the field is additive and backward-compatible (existing
`change`-kind and pre-existing `tdd` `red`/`green`/`refactor`/`migrate`
order records never set it, and `validateEvidenceOrderLog`'s schema check
treats it as optional). Only newly appended `void` order records populate
it, satisfying REQ-004/REQ-005's requirement that the order record itself
carry a matching `testId` alongside `cycleId` (`entityId`). Because
`order.json` records are already uniquely keyed by `(kind, entityId,
phase)` and `entityId` is set to `cycle.cycleId`, looking the void order
record up with the existing `evidenceOrderRecord(order.records, 'tdd',
cycle.cycleId, 'void')` helper — the same helper already used for
`red`/`green`/`refactor`/`migrate` — already guarantees at most one such
record exists per cycle; the added `testId` field lets
DES-TDD-CYCLE-VOID-002 additionally confirm that record's `testId` matches
the cycle's own `testId` without any schema ambiguity. Identity binding
for the chain record uses `TddChainRecord`'s own `testId`/`cycleId`
fields, which `appendChainRecord` already populates from the cycle. Add a
`tdd void <test-id>` Commander.js command
in `packages/cli/src/main.ts`, wired like `tdd migrate`, with required
`--approver <name>` and `--reason <text>` options and a required
`--confirm` flag (rejecting with no call into `voidTddCycle` when
`--confirm` is absent, matching the existing `tdd migrate` pattern),
printing the result and setting a nonzero exit code on rejection. When no
TDD evidence file exists at all, reject with an error stating no TDD
evidence was found (mirroring `migrateTddFingerprint`'s identical
no-evidence error) and write nothing.
Interfaces: `voidTddCycle(root: string, testId: string, approver: string,
reason: string): Promise<TddVoidResult>` where `TddVoidResult = { voided:
boolean; testId: string; cycleId?: string; reason?: string }`. CLI: `tdd
void <test-id> --approver <name> --reason <text> --confirm`.
Constraints: Never mutate or remove any existing `red`/`green`/`refactor`/
`migrate` evidence, chain record, or order record for `testId` or any other
test ID. Never write partial evidence on any rejection path (all
eligibility checks, including the legacy-chain preflight check, run before
any mutation or any call to `appendEvidenceOrder`/`appendChainRecord`).
Reuse `appendChainRecord`/`appendEvidenceOrder`/`evidenceOrderRecord`
rather than duplicating hash-chain or order-log construction. Never
overwrite an existing `cycle.void` field, valid or malformed.
Requirements: REQ-TDD-CYCLE-VOID-001, REQ-TDD-CYCLE-VOID-002, REQ-TDD-CYCLE-VOID-003, REQ-TDD-CYCLE-VOID-004
ADRs: ADR-0023

## DES-TDD-CYCLE-VOID-002: Void linkage validation and malformed-evidence diagnostics
Responsibilities: Introduce one shared, general internal helper,
`phaseLinkageValid(order: ReturnType<typeof validateEvidenceOrderLog>,
chain: TddChainRecord[] | undefined, cycle: TddCycle, phase:
TddChainPhase, phaseEvidence: unknown): boolean`, reused for both the
void phase (this component) and the Green phase (DES-TDD-CYCLE-VOID-004),
so "is this phase's evidence genuinely intact" is answered identically
everywhere it matters. It requires: the overall order log validated
cleanly (`order.valid === true`, i.e. `validateEvidenceOrderLog` reported
no `EVIDENCE_ORDER_*` diagnostics for the whole file — a single cheap
global gate that already reflects the append-only order log's own
cryptographic and positional integrity, since a corrupt order log cannot
be selectively trusted for one phase and distrusted for another); a
matching `evidenceOrderRecord(order.records, 'tdd', cycle.cycleId, phase)`
record whose `sequence` equals `cycle[phase].order` (or, for `phase ===
'void'`, `cycle.void.order`) and, when `phase === 'void'`, whose `testId`
field (added in DES-TDD-CYCLE-VOID-001) equals `cycle.testId`; and exactly
one `TddChainRecord` in `chain` with the matching `phase` whose own
`testId`/`cycleId` fields equal `cycle.testId`/`cycle.cycleId`, whose
`recordSha256` equals the recomputed hash of its own payload (reusing the
existing per-record hash recomputation already performed for
`TDD_CHAIN_HASH_MISMATCH`, not re-derived), whose `previousSha256` equals
its immediate predecessor's `recordSha256` in `chain`, and whose
`phaseEvidenceSha256` equals `digest(JSON.stringify(phaseEvidence))`. Any
failing condition returns `false`. Build `voidLinkage(evidence, order,
cycle): { valid: boolean; reason?: string }` on top of this: `{ valid:
false }` when `cycle.void` is absent, otherwise `{ valid:
phaseLinkageValid(order, evidence.chain, cycle, 'void', cycle.void),
reason: <specific failure — invalid order log, missing/mismatched order
record, missing/duplicate/mismatched chain record, or broken predecessor/
payload hash link> }`. In `runTddValidate`, for every cycle with a `void`
field whose `voidLinkage(...).valid` is `false`, raise a new
`TDD_VOID_EVIDENCE_MALFORMED` diagnostic naming the test ID and the
specific failure reason, in addition to whatever
`TDD_RED_MISSING`/`TDD_GREEN_MISSING`/`TDD_LEGACY_OR_UNSCOPED_EVIDENCE`
diagnostics that cycle would already raise absent any `void` field
(REQ-006, REQ-007) — malformed-void cycles receive no additional
suppression beyond what `supersededCycles` already grants them.
Interfaces: `phaseLinkageValid(...)` and `voidLinkage(...)` as above;
`validlyVoidedCycles: Set<TddCycle>` computed alongside the existing
`supersededCycles` computation, populated only with cycles for which
`voidLinkage(...).valid` is `true`.
Constraints: Must not treat a `void` payload on one cycle as satisfying
linkage for a different cycle, even when both share the same `testId` (the
chain record's own `cycleId` match is mandatory, and the order record's
`entityId` lookup is inherently scoped to `cycle.cycleId`, with its new
`testId` field cross-checked for the void phase specifically). Must not
weaken `TDD_CHAIN_HASH_MISMATCH`, `TDD_CHAIN_ORPHAN`, `TDD_ORDER_MISMATCH`,
or `TDD_ORDER_SEQUENCE` for the void phase; the void chain/order records
are validated by those same
existing checks in addition to the new malformed-void check.
Requirements: REQ-TDD-CYCLE-VOID-005, REQ-TDD-CYCLE-VOID-006, REQ-TDD-CYCLE-VOID-007
ADRs: ADR-0023

## DES-TDD-CYCLE-VOID-003: Scope diagnostic suppression to validly voided cycles only
Responsibilities: Extend the three existing `!supersededCycles.has(cycle)`
guards for `TDD_LEGACY_OR_UNSCOPED_EVIDENCE` (Red-side),
`TDD_RED_MISSING`, and `TDD_GREEN_MISSING` to also read
`!validlyVoidedCycles.has(cycle)` (i.e. `!supersededCycles.has(cycle) &&
!validlyVoidedCycles.has(cycle)`), so a validly voided cycle is suppressed
independently of, and by the same mechanism as, an already-superseded
cycle (REQ-008). Every cycle not itself in `validlyVoidedCycles` (whether
malformed-void, not voided at all, or a different cycle of the same test
ID) continues to raise these diagnostics exactly as today, since voiding
one cycle only ever adds that one cycle to `validlyVoidedCycles` — it never
adds, removes, or otherwise affects membership for any other cycle
(REQ-009).
Interfaces: No new exported interface; extends the existing per-cycle
diagnostic loop's guard conditions in `runTddValidate`.
Constraints: Must not change `supersededCycles` computation itself. Must
not suppress `TDD_CHAIN_HASH_MISMATCH`, `TDD_ORDER_MISMATCH`,
`TDD_ORDER_SEQUENCE`, `TDD_DURATION_INVALID`, `TDD_COMMAND_CHANGED`, or
`TDD_GREEN_WITHOUT_SOURCE_CHANGE` for any cycle, voided or not — those
protect chain integrity and are orthogonal to whether a dangling cycle is
acknowledged as intentionally abandoned.
Requirements: REQ-TDD-CYCLE-VOID-008, REQ-TDD-CYCLE-VOID-009
ADRs: ADR-0023

## DES-TDD-CYCLE-VOID-004: Effective-latest-cycle resolution for `TDD_TEST_STALE`
Responsibilities: Where `runTddValidate` currently gates `TDD_TEST_STALE`
computation on `latestCycles.get(cycle.testId) === cycle` (the array's last
cycle for that test ID), additionally treat a cycle as the target of
staleness comparison when it is not the array's last cycle but is the
selected "effective latest" cycle for a test ID whose actual latest cycle
is in `validlyVoidedCycles`. Compute the effective latest cycle as: among
cycles for that `testId` with `red.valid`, `green?.valid`, and not in
`validlyVoidedCycles`, using each candidate's Green sequence only when
`phaseLinkageValid(order, evidence.chain, candidate, 'green',
candidate.green)` (the same general helper from DES-TDD-CYCLE-VOID-002)
is `true` — a candidate whose Green order/chain linkage does not fully
validate contributes no sequence and is therefore never selected, rather
than falling back to its unverified `green.order` field — the sequence
itself being `evidenceOrderRecord(order.records, 'tdd', candidate.cycleId,
'green')!.sequence` once linkage is confirmed valid. The one whose
verified Green sequence is the greatest value strictly less than the
voided cycle's own verified void-phase sequence
(`evidenceOrderRecord(order.records, 'tdd', voidedCycle.cycleId,
'void')!.sequence`, valid because `voidedCycle` is already in
`validlyVoidedCycles`) is the effective latest cycle (REQ-010). When the
actual latest cycle is validly voided and an effective latest cycle exists,
run the existing `TDD_TEST_STALE` fingerprint comparison (current source
fingerprint vs. the candidate list built from Green/Refactor/Migrate
orders) against this effective latest cycle instead of skipping the check
entirely. When no eligible effective latest cycle exists (which REQ-002
already prevents at void-time, but evidence could still be corrupted after
the fact), skip `TDD_TEST_STALE` for that test ID exactly as today's "no
latest cycle" path already does, rather than guessing a target.
Interfaces: Internal `effectiveLatestCycle(testId): TddCycle | undefined`
helper consulted only when `latestCycles.get(testId)` is in
`validlyVoidedCycles`; reuses `phaseLinkageValid(...)` from
DES-TDD-CYCLE-VOID-002 for candidate Green verification; the existing
candidate-fingerprint construction and `TDD_TEST_STALE` emission are
otherwise reused unchanged, now keyed off this resolved cycle in place of
the raw latest cycle.
Constraints: Must not change `TDD_TEST_STALE` behavior for any test ID
whose actual latest cycle is not validly voided. Must not select a
malformed-void or otherwise-not-validly-voided cycle as an "actual latest
cycle validly voided" trigger — REQ-010 only applies once the latest cycle
passes DES-TDD-CYCLE-VOID-002's linkage check. Must not select a candidate
cycle whose own Green order/chain linkage is invalid.
Requirements: REQ-TDD-CYCLE-VOID-010
ADRs: ADR-0023

## DES-TDD-CYCLE-VOID-005: Reject re-voiding an already validly voided latest cycle
Responsibilities: In `voidTddCycle`, before any mutation, reject (no
evidence written) when the latest recorded cycle for `testId` already
carries a `void` field at all — this is the same "already carries a `void`
payload" check already specified in DES-TDD-CYCLE-VOID-001 (deliberately
not limited to validly-linked void payloads, so a malformed void record
can never be silently overwritten or duplicated), reported with an error
naming the test ID and stating the latest cycle is already voided. When
the latest cycle for `testId` is a newer cycle recorded after a previously
voided cycle (i.e. the previously voided cycle is no longer the latest),
evaluate DES-TDD-CYCLE-VOID-001's REQ-001/REQ-002 eligibility checks
against this new latest cycle only, without regard to any earlier voided
cycle.
Interfaces: Reuses the single "does this cycle already carry a `void`
field" check from DES-TDD-CYCLE-VOID-001 (a simple presence check, not the
`voidLinkage(...)` validity predicate from DES-TDD-CYCLE-VOID-002 — those
two checks answer different questions and both apply: presence blocks
re-voiding/overwriting, while `voidLinkage(...)` validity gates
suppression and effective-latest selection).
Constraints: Must not reject voiding a fresh, later, fully valid Red-Green
cycle solely because an earlier cycle of the same `testId` was previously,
validly voided.
Requirements: REQ-TDD-CYCLE-VOID-011
ADRs: ADR-0023

## DES-TDD-CYCLE-VOID-006: Route `tdd migrate` around a validly voided latest cycle
Responsibilities: In `migrateTddFingerprint`, where the function currently
selects `evidence.cycles.filter((entry) => entry.testId === testId).at(-1)`
as the sole migration target, first check whether that selected cycle
carries a validly linked `void` payload (via the shared `voidLinkage(...)`
predicate from DES-TDD-CYCLE-VOID-002, which requires loading the order
log via `inspectEvidenceOrder` in `migrateTddFingerprint`, mirroring
`runTddValidate`'s existing use of it). If so, substitute the same
effective-latest cycle selection defined in DES-TDD-CYCLE-VOID-004
(REQ-010) as the migration target in place of the voided cycle, then
continue with the function's existing `green.valid`/`cycle.migrate` checks
and fingerprint comparison against that substituted cycle unchanged
(REQ-012). If the latest cycle is not validly voided, behavior is exactly
as today.
Interfaces: No signature change to `migrateTddFingerprint`; internally
resolves its working `cycle` reference through the same effective-latest
selection helper used by DES-TDD-CYCLE-VOID-004 before proceeding.
Constraints: Must not change `migrateTddFingerprint`'s behavior for any
test ID whose latest cycle is not validly voided. Must raise the existing
"already been migrated" error when the substituted effective-latest cycle
already has a `migrate` record, unaffected by the later voided cycle. Must
not select an earlier cycle with a valid Green but invalid/missing Red as a
migration target (REQ-010's Red+Green eligibility applies identically
here).
Requirements: REQ-TDD-CYCLE-VOID-012
ADRs: ADR-0023

## DES-TDD-CYCLE-VOID-007: Surface scoped void evidence in `tdd validate --json`
Responsibilities: Extend `validateTddEvidence`'s return type with a
`voided: Array<{ testId: string; cycleId: string; void: { approver:
string; reason: string; recordedAt: string } }>` field, populated with
exactly one entry per cycle in `validlyVoidedCycles`. Each array element is
the machine-readable "entry" required by REQ-013: it is identified by its
own top-level `testId`/`cycleId` fields (copied from that cycle, never from
any other cycle), and it carries a nested `void` object with `approver`,
`reason`, and `recordedAt` copied verbatim from that same cycle's `void`
payload. Cycles with no `void` field, or with a malformed one, contribute
no entry to this array (REQ-013). When no TDD evidence file exists at all,
`validateTddEvidence` already returns early with `present: false`; that
early return additionally includes `voided: []`.
Interfaces: `validateTddEvidence(root: string): Promise<{ present: boolean;
valid: boolean; diagnostics: Diagnostic[]; cycles: number; voided:
Array<{ testId: string; cycleId: string; void: { approver: string; reason:
string; recordedAt: string } }> }>` — an additive field; existing
consumers of this return value (e.g. `gate`) that do not read `voided` are
unaffected.
Constraints: Must not include an entry for a malformed-void cycle. Must not
merge or deduplicate entries across cycles sharing a `testId`; each validly
voided cycle contributes its own entry keyed by its own `cycleId`.
Requirements: REQ-TDD-CYCLE-VOID-013
ADRs: ADR-0023
