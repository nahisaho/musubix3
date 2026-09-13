# Change evidence waiver design

## DES-CHANGE-EVIDENCE-WAIVER-001: Order-log scoping fields and waiver evidence data model
Responsibilities: Extend `EvidenceOrderRecord` (`packages/analysis/src/order.ts`)
with one new optional field, `detail?: string` (additive, mirroring the
existing `testId?` precedent from `tdd-cycle-void`; `code?`/
`requirementId?` already exist on `EvidenceOrderRecord`/`EvidenceOrderScope`
from the original `change-evidence-waiver` feature — only `detail` is new
for CHANGE-0012's REQ-CHANGE-EVIDENCE-WAIVER-016 scope key). Extend `EvidenceOrderScope` to
`{ code?: string; requirementId?: string; detail?: string; sequence?: number }`
(`sequence` is new for this feature: see below) and
`recordKey(kind, entityId, phase, scope?)` to append `scope.detail` (only
when present, after `scope.code`/`scope.requirementId`, in that fixed
field order, so key arrays remain deterministic) to the JSON key array —
every existing call site continues to omit `scope.detail` and therefore
computes byte-identical keys to today.
Because `validateEvidenceOrderLog`'s existing `EVIDENCE_ORDER_DUPLICATE`
check and `appendEvidenceOrder`'s existing "already present" rejection both
treat any two records sharing a `recordKey(...)` as illegally duplicated,
and REQ-CHANGE-EVIDENCE-WAIVER-006/010 deliberately allow more than one
`phase: 'waiver'` record to share the same `changeId`/`code`/
`requirementId`/`detail` scope over time (a stale waiver legitimately
superseded by a replacement), `recordKey` additionally appends
`scope.sequence` — but *only* when `phase === 'waiver'` — as the final key
element. `appendEvidenceOrder` computes this value as the new record's own
about-to-be-assigned `sequence` (`log.records.length + 1`, already computed
locally before the key check) only for `phase === 'waiver'` inputs, making
every waiver-phase order record's key unique by construction (since
`sequence` is strictly monotonic and never reused), and therefore never
flagged as a duplicate regardless of how many prior waiver records share
its `changeId`/`code`/`requirementId`/`detail`. For every other phase, the
key computation and duplicate behavior are unchanged (no `sequence`
element appended, byte-identical to today). This is the only field
`recordKey` derives from the record's own position rather than from
caller-supplied scope, and it is scoped strictly to `phase === 'waiver'`
so no existing non-waiver duplicate-detection behavior changes.
This design also moves `batchKey(requirementIds: string[]): string` (today
module-local/unexported in `change.ts`, at line 88) into
`change-evidence.ts`, exported from there (a pure relocation — its exact
`[...new Set(ids)].sort().join(',')` body is unchanged), and updates
`change.ts`'s every existing call site to import it from
`change-evidence.ts` instead of defining it locally. This relocation is
required, not cosmetic: `change.ts` already imports from
`change-evidence.ts` (`effectiveBatches`, `batchFor`,
`ChangePhaseEvidence`, etc.), so a `batchForKey` living in
`change-evidence.ts` cannot itself import `batchKey` from `change.ts`
without creating the exact module-dependency cycle `change-evidence.ts`'s
own header comment says it avoids; keeping the single canonical `batchKey`
definition in `change-evidence.ts` (the lower-level, dependency-free
module) and having `change.ts` depend on it — never the reverse — avoids
that cycle. This design then adds `batchForKey(batches: ChangeTddBatch[], key: string): ChangeTddBatch | undefined`
to `change-evidence.ts` alongside the relocated `batchKey`, returning
`batches.find((batch) => batchKey(batch.requirementIds) === key)` — the
direct-by-`detail`-value counterpart to the existing
`batchFor(batches, requirementId)` selector (already exported from
`change-evidence.ts` today, requiring no visibility change), used by DES-002's
batch-scoped snapshot payloads (`CHANGE_TESTS_UNCHANGED`,
`CHANGE_IMPLEMENTATION_UNCHANGED`, `CHANGE_TEST_CHANGED_AFTER_RED`, and the
batch component of `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`), none of
which have a `requirementId` alone sufficient to resolve the correct
batch.
`validateEvidenceOrderLog`'s existing per-record duplicate-key
reconstruction (which today re-derives each stored record's scope as
`{ code: record.code, requirementId: record.requirementId }` before
calling `recordKey` to populate its `records` map and detect
`EVIDENCE_ORDER_DUPLICATE`) must be extended to also include
`detail: record.detail` (when present, mirroring `code`/`requirementId`'s
existing conditional-spread pattern exactly), and, only when
`record.phase === 'waiver'`, `sequence: record.sequence` (the record's own
already-validated, already-stored `sequence` field — not a freshly
computed one, since this reconstruction runs after every record has
already been read, unlike `appendEvidenceOrder`'s use of a not-yet-pushed
`log.records.length + 1`). Without this exact change, `record.detail`
would silently be dropped from the reconstructed key, and multiple
distinct-`detail` waiver records sharing every other scope field would be
indistinguishable from `recordKey`'s perspective even before the
`sequence` fix is considered — this reconstruction is the second of two
places (alongside `appendEvidenceOrder`) that must independently compute
a matching key, and both must be kept in lockstep by this shared
`recordKey` function; the design would be incomplete, and
`EVIDENCE_ORDER_DUPLICATE` would still incorrectly fire for legitimately
superseded waivers, if only `appendEvidenceOrder` were updated. The
`records: Map<string, EvidenceOrderRecord>` returned by
`validateEvidenceOrderLog` therefore ends up holding one entry per
distinct `(kind, entityId, phase, code?, requirementId?, detail?,
sequence-if-waiver)` key, letting `evidenceOrderRecord`'s lookup (used by
`waiverLinkage`, passing `sequence: record.order`) resolve exactly one
specific waiver's own entry even when several waivers share every
non-`sequence` scope field. The schema-validity check (the block that
currently rejects a record for a malformed `code`/`requirementId`) is
similarly extended with a parallel `record.detail !== undefined &&
(typeof record.detail !== 'string' || !record.detail)` malformed-shape
condition, so an invalid `detail` value is caught by
`EVIDENCE_ORDER_SCHEMA` exactly like an invalid `code`/`requirementId`
today.
Add `ChangeWaiverRecord` (`changeId`, `code`, `requirementId?`, `detail?`,
`approver`, `reason`, `recordedAt`, `snapshotVersion`, `snapshotHash`,
`order`, `previousSha256`, `payloadSha256`) and `ChangeWaiverEvidence`
(`{ schemaVersion: 1; waivers: ChangeWaiverRecord[] }`) types in
`packages/analysis/src/change-waiver.ts`. Implement
`WAIVABLE_CODES = ['CHANGE_REQUIREMENTS_UNCHANGED', 'CHANGE_DESIGN_UNCHANGED', 'CHANGE_RED_UNPROVEN', 'CHANGE_GREEN_UNPROVEN', 'CHANGE_COMPLETENESS_TDD', 'CHANGE_RECORD_MISSING', 'CHANGE_PHASE_MISSING', 'CHANGE_ORDER_MIGRATION_REQUIRED', 'CHANGE_TESTS_UNCHANGED', 'CHANGE_IMPLEMENTATION_UNCHANGED', 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED', 'CHANGE_TEST_CHANGED_AFTER_RED'] as const`
(twelve entries, REQ-001) and its derived type
`type WaivableCode = typeof WAIVABLE_CODES[number]`, both exported from
`change-waiver.ts`. Replace the old single `CHANGE_LEVEL_CODES` set with
four disjoint, exhaustive `Set<WaivableCode>` constants implementing
REQ-CHANGE-EVIDENCE-WAIVER-004's scope-key regime matrix directly as data
(never as scattered per-code `if` branches):
`NEITHER_KEY_CODES = new Set(['CHANGE_REQUIREMENTS_UNCHANGED', 'CHANGE_DESIGN_UNCHANGED', 'CHANGE_RECORD_MISSING'])`,
`REQUIREMENT_ONLY_CODES = new Set(['CHANGE_RED_UNPROVEN', 'CHANGE_GREEN_UNPROVEN', 'CHANGE_COMPLETENESS_TDD'])`,
`DETAIL_ONLY_CODES = new Set(['CHANGE_PHASE_MISSING', 'CHANGE_ORDER_MIGRATION_REQUIRED', 'CHANGE_TESTS_UNCHANGED', 'CHANGE_IMPLEMENTATION_UNCHANGED', 'CHANGE_TEST_CHANGED_AFTER_RED'])`,
`BOTH_KEYS_CODES = new Set(['CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED'])`.
Implement `requiresRequirementId(code: WaivableCode): boolean` as
`REQUIREMENT_ONLY_CODES.has(code) || BOTH_KEYS_CODES.has(code)` and
`requiresDetail(code: WaivableCode): boolean` as
`DETAIL_ONLY_CODES.has(code) || BOTH_KEYS_CODES.has(code)`, both used by
every REQ-004 presence check in this feature (DES-001's CLI validation,
DES-002's `waiverLinkage`) so the four sets are the single source of
truth for the regime, never duplicated as inline boolean logic. Retain a
derived `CHANGE_LEVEL_CODES = NEITHER_KEY_CODES` export purely for
backward-compatible naming inside this module; no external consumer of
the old name exists outside this feature. CLI input for `<CODE>` remains a
plain `string` until validated against `WAIVABLE_CODES`, at which point it
is narrowed to `WaivableCode` for every subsequent call in this feature
(`recordChangeWaiver`, `snapshotPayload`, `waivedDiagnostic`); an
unrecognized `<CODE>` never reaches those functions; it hits the
`WAIVABLE_CODES` rejection check in `recordChangeWaiver` first.
Implement `canonicalJson(value: unknown): string`, a
small recursive serializer that sorts object keys, passes arrays through
in-order, and renders `undefined` object values as omitted keys (never as
`null` or the literal string `"undefined"`), used for every hash input in
this feature. `CURRENT_SNAPSHOT_VERSION = 1`.
Implement a discriminated `LoadedChangeWaiverEvidence` type —
`{ schemaVersion: 1; waivers: ChangeWaiverRecord[]; malformed?: false } | { schemaVersion: 1; waivers: []; malformed: true }`
— and `loadChangeWaiverEvidence(root): Promise<LoadedChangeWaiverEvidence | null>`
that returns `null` when the file is absent, and — unlike
`loadChangeEvidence`, which is allowed to throw on malformed JSON because
its caller already treats a throw as a fatal validator error — wraps its
`JSON.parse`/shape check in a `try`/`catch` and returns
`{ schemaVersion: 1, waivers: [], malformed: true }` on any parse or
top-level-shape failure, so `validateChangeEvidence` (DES-002) can always
convert it into a `CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic rather than
throwing out of `gate`. Every consumer of this loader (DES-001's
`recordChangeWaiver`, DES-004's `reportWaiverEvidenceDiagnostics`) checks
the `malformed` discriminant explicitly rather than inspecting `waivers`
directly for absence-of-shape.
Implement
`recordChangeWaiver(root, changeId, code, requirementId, detail, approver, reason): Promise<{ recorded: boolean; changeId: string; code: string; requirementId?: string; detail?: string }>`
(REQ-016 adds the new `detail` parameter alongside the existing
`requirementId` one; both are `string | undefined`): call
`loadChangeWaiverEvidence(root)`; when the result is `null` (file
absent), proceed as if `{ schemaVersion: 1, waivers: [] }` were loaded;
when the result's `malformed` discriminant is `true`, reject immediately
with no evidence written or modified (the file is left byte-for-byte
untouched) and no `appendEvidenceOrder`/`recordChangeWaiver` call
proceeds — this is the same rejection reported as
`CHANGE_WAIVER_EVIDENCE_MALFORMED` by `reportWaiverEvidenceDiagnostics`
(DES-004), never silently reinterpreted as an empty document to append
onto; otherwise (loaded, well-formed at the top level), additionally
require every existing `waivers[i]` to pass
`waiverRecordShapeValid(waivers[i])`, `waiverChainValid(waivers, i)`
(DES-002), and — once `evidence`/`order` are loaded further down this
same function — `(await waiverLinkage(root, evidence, order, waivers, i)).valid`; if
any existing record fails any of these three checks, reject immediately
with no evidence written or modified, exactly as in the malformed-file
case above (this is the same shape/chain/linkage validation DES-004's
`reportWaiverEvidenceDiagnostics` independently performs on every read
path, so `recordChangeWaiver` never appends a new, valid-looking record
onto a chain that already contains an invalid one). Only once the whole
existing chain passes does `recordChangeWaiver` proceed with its existing
`waivers` array. Once past that check, reject
with no evidence written when: `code` is not in `WAIVABLE_CODES` (REQ-001);
`requirementId` presence does not equal `requiresRequirementId(code)`, or
`detail` presence does not equal `requiresDetail(code)` (REQ-004); a
present `requirementId` does not name a requirement declared for
`changeId` (REQ-004); `approver`/`reason` are empty/whitespace-only
(REQ-003; `--confirm` is enforced at the CLI layer, matching `tdd void`);
re-running `validateChangeEvidence`/`validateChangeCompleteness` (this
function calls both, reusing their existing exported public APIs — whose
internal behavior is itself being extended by DES-004, so this call sees
any already-recorded waivers' effects too) does not currently report a
diagnostic with this exact `changeId`/`code`/`requirementId`/`detail`
structured target (added by DES-003), where a present `detail` must
equal the currently-reported diagnostic's own structured `detail` field
computed per REQ-016's grammar (DES-003b) (REQ-002, REQ-016); or an
existing waiver record for the identical
`changeId`/`code`/`requirementId`/`detail` is validly linked (DES-002)
and non-stale (DES-002's version+hash predicate) (REQ-010). Only once
every check passes: set `snapshotVersion` to `CURRENT_SNAPSHOT_VERSION`
and compute `snapshotPayload(...)` (DES-002) and its hash as
`snapshotHash`, call
`appendEvidenceOrder(root, { kind: 'change', entityId: changeId, phase: 'waiver', code, requirementId, detail })`
to obtain `order`, set `previousSha256` to the prior waiver's
`payloadSha256` (or `'0'.repeat(64)` when `waivers` is empty, per
REQ-015), compute `payloadSha256` as
`digest(canonicalJson((({ payloadSha256, ...rest }) => rest)(record)))`
(explicit destructure-omit, never a `payloadSha256: undefined` spread, so
the hashed shape never contains the key at all), push the record, and
`writeJson` the file. Add `export * from './change-waiver.js';` to
`packages/analysis/src/index.ts`'s existing barrel-export list (alongside
its existing `export * from './change.js';`/`'./order.js';` lines), so
every export this feature defines across DES-001 through DES-005
(`recordChangeWaiver`, `activeWaivers`, `waiverEvidenceDiagnostics`,
`WAIVABLE_CODES`, `WaivableCode`, `errorFor`, `diagnosticDetail`, and the
rest) is reachable the same way `packages/cli/src/main.ts` already
imports every other analysis API — from that one barrel, per its
existing import block, never via a direct `./change-waiver.js` path. Add
`change waiver record <CHANGE-ID> <CODE> [--requirement <REQ-ID>]
[--detail <value>] --reason <text> --approver <name> --confirm` to
`packages/cli/src/main.ts`, wired like `tdd void`: missing `--confirm`
rejects before calling `recordChangeWaiver`; the result is printed and a
nonzero exit code is set on rejection.
Interfaces: `recordChangeWaiver(root: string, changeId: string, code: string, requirementId: string | undefined, detail: string | undefined, approver: string, reason: string): Promise<{ recorded: boolean; changeId: string; code: string; requirementId?: string; detail?: string }>`;
`ChangeWaiverRecord`/`ChangeWaiverEvidence`/`LoadedChangeWaiverEvidence`/
`loadChangeWaiverEvidence` as above; `EvidenceOrderRecord`/
`EvidenceOrderScope` each gain `detail?: string` alongside the existing
`code?`/`requirementId?` fields, plus `EvidenceOrderScope` gains
`sequence?: number` (used only internally by `recordKey`/
`appendEvidenceOrder` for `phase === 'waiver'` records, never supplied by
any external caller directly); `recordKey`/`evidenceOrderRecord` accept
`detail` through the existing `scope` parameter, unchanged in arity.
`appendEvidenceOrder` keeps its existing
two-argument shape (`root`, `input`) and receives scope values only
through its extended `input` object type,
`Pick<EvidenceOrderRecord, 'kind' | 'entityId' | 'phase'> & Partial<Pick<EvidenceOrderRecord, 'testId' | 'code' | 'requirementId' | 'detail'>>`
— it never takes a separate third `scope` argument — and internally
forwards `{ code: input.code, requirementId: input.requirementId, detail:
input.detail, ...(input.phase === 'waiver' ? { sequence: log.records.length + 1 } : {}) }`
as `recordKey`'s new `scope` argument.
`recordKey(kind, entityId, phase, scope?)` appends `scope.code` then
`scope.requirementId` then `scope.detail` then, only when `phase ===
'waiver'` and `scope.sequence` is defined, `scope.sequence`, to its key
array, each only when defined — critically, it never appends a
placeholder `null`/`undefined` array element for an absent field, so
every existing call site (which passes no `scope` argument, or passes
`scope: {}`) computes a key array of the same length and same values as
today, and only a waiver's specific `scope` values (plus its own
`sequence`, for `phase: 'waiver'` only) change the key. `batchForKey` as
above, exported alongside `batchFor`/`effectiveBatches` from
`change-evidence.ts`. CLI: `change
waiver record <CHANGE-ID> <CODE> [--requirement <REQ-ID>] [--detail
<value>] --reason <text> --approver <name> --confirm`.
Constraints: Never mutate or remove any existing waiver record, order
record, or change/TDD evidence file. Never write partial evidence on any
rejection path — every check runs before `appendEvidenceOrder` or any
`change-waivers.json` write. Existing calls to `appendEvidenceOrder`/
`evidenceOrderRecord` that omit `code`/`requirementId`/`detail` must keep
producing identical keys/behavior to today, and every non-`waiver`-phase
call must keep computing a key with no `sequence` element, preserving
today's duplicate-detection behavior for every non-waiver phase exactly.
A newly recorded waiver's
`snapshotHash` must equal the value DES-004 would independently recompute
immediately afterward, so it starts non-stale. `NEITHER_KEY_CODES`/
`REQUIREMENT_ONLY_CODES`/`DETAIL_ONLY_CODES`/`BOTH_KEYS_CODES` must
partition `WAIVABLE_CODES` exactly (no code in zero or more than one set).
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-001, REQ-CHANGE-EVIDENCE-WAIVER-002, REQ-CHANGE-EVIDENCE-WAIVER-003, REQ-CHANGE-EVIDENCE-WAIVER-004, REQ-CHANGE-EVIDENCE-WAIVER-005, REQ-CHANGE-EVIDENCE-WAIVER-010, REQ-CHANGE-EVIDENCE-WAIVER-015, REQ-CHANGE-EVIDENCE-WAIVER-016
ADRs: ADR-0025

## DES-CHANGE-EVIDENCE-WAIVER-002: Snapshot payload definition, canonical `detail` grammar, and waiver linkage validation
Responsibilities: Implement
`snapshotPayload(root: string, evidence: ChangeEvidence | null, tdd: TddEvidence | null, order: Awaited<ReturnType<typeof inspectEvidenceOrder>>, changeId: string, code: WaivableCode, requirementId?: string, detail?: string): Promise<unknown | null>`
(now `async` and taking `root`, needed to read the change document's text
for `CHANGE_RECORD_MISSING` below; `evidence` is now nullable because
`CHANGE_RECORD_MISSING` fires even when `.musubix/evidence/changes.json`
does not exist at all — `loadChangeEvidence` returns `null` in that case,
per `change.ts`'s `!evidence?.changes.length` early-return branch — and a
waiver must still be recordable/verifiable against that state), returning
`null` only when `changeId`
names no change document at `.musubix/changes/<changeId>.md` on disk
(checked directly, via `exists`/`readText`, never via
`evidence?.changes` — `CHANGE_RECORD_MISSING` is specifically the state
where the document exists but either `evidence` is entirely absent or
`evidence.changes` does not name it, so a `null`-on-`evidence`-absence
rule would make this code unsnapshottable in either sub-case, exactly the
defect flagged in design review; every other code's
predicate additionally requires a non-null `evidence` with a matching
`evidence.changes` entry, checked inside that code's own branch below,
never inside this shared early return, and every other code's own
`snapshotPayload` branch below reads `evidence?.field` defensively and
resolves to `null` throughout when `evidence` is null — that code's own
diagnostic simply never fires in that state, so this defensive read is
never exercised in practice, but keeps the function total rather than
throwing).
For `CHANGE_REQUIREMENTS_UNCHANGED`: `{ impactRequirements: impact?.fingerprints.requirements ?? null, requirementsRequirements: requirements?.fingerprints.requirements ?? null, allowUnchanged: requirements?.allowUnchanged ?? null }`
(`impact`/`requirements` resolved from `evidence?.changes.find((c) => c.changeId === changeId)?.phases`, `null` throughout when that change has no chronology entry at all, or when `evidence` itself is null — this code's own diagnostic never fires in that case, so `snapshotPayload` need not special-case it beyond `?.`/`?? null` propagation).
For `CHANGE_DESIGN_UNCHANGED`: `{ requirementsDesign: requirements?.fingerprints.design ?? null, design: design?.fingerprints.design ?? null }`.
For `CHANGE_RED_UNPROVEN`/`CHANGE_GREEN_UNPROVEN`/`CHANGE_COMPLETENESS_TDD`
(identical shape for all three, since all three read the same
`validCycle`-style predicate against the same requirement, and — per
REQ-CHANGE-EVIDENCE-WAIVER-004's granularity rule, enforced by every
caller before `snapshotPayload` is invoked for these three codes —
`requirementId` is always defined here; if it is `undefined` for one of
these three codes, this is an internal-caller contract violation and
`snapshotPayload` throws rather than silently proceeding): resolve
`batch = batchFor(effectiveBatches(change), requirementId)` — `batchFor`
is currently module-local (unexported) in `change.ts`; this design adds
`export` to its existing declaration (a pure visibility change, no
behavior change) so `change-waiver.ts` can import the exact same
first-match selection the existing validator itself uses, with no new
selection rule); build
`{ requirementsOrder: change.phases.requirements?.order ?? null, red: batch?.red ? { fingerprints: batch.red.fingerprints, order: batch.red.order ?? null } : null, implementation: batch?.implementation ? { fingerprints: batch.implementation.fingerprints, order: batch.implementation.order ?? null } : null, green: batch?.green ? { fingerprints: batch.green.fingerprints, order: batch.green.order ?? null } : null, cycles: (tdd?.cycles ?? []).filter((c) => c.requirementId === requirementId).map((c) => ({ cycleId: c.cycleId, red: { valid: c.red.valid, order: c.red.order ?? null }, green: c.green ? { valid: c.green.valid, order: c.green.order ?? null } : null })).sort((a, b) => { const ao = a.red.order ?? Number.MAX_SAFE_INTEGER; const bo = b.red.order ?? Number.MAX_SAFE_INTEGER; return ao !== bo ? ao - bo : (a.cycleId < b.cycleId ? -1 : a.cycleId > b.cycleId ? 1 : 0); }).map(({ cycleId, ...rest }) => rest) }`
— every field explicitly present as `null` when the corresponding phase or
sub-field is absent (so a `CHANGE_RED_UNPROVEN` instance, which can fire
with `implementation`/`green` still unrecorded, always has a fully
constructible, deterministic payload), and `cycles` sorted by `red.order`
ascending per REQ-CHANGE-EVIDENCE-WAIVER-011's acceptance criteria, with
any cycle missing an `order` value sorted to the end
(`Number.MAX_SAFE_INTEGER` sentinel) and `cycleId` (always present and
unique) used only as the final deterministic tie-breaker for sort
ordering, never as the primary sort key and never included in the
serialized payload itself (`cycleId` is destructured off each entry
immediately after sorting) — REQ-011's acceptance criteria enumerate the
snapshot's contents as exactly each cycle's `red`/`green` `valid`/`order`
values, so a cycle's `cycleId` must influence only the payload's
deterministic order, not its hashed content, otherwise a benign
cycle-identity change with no predicate-relevant value change would
incorrectly stale an otherwise-untouched waiver.
For `CHANGE_RECORD_MISSING` (reachable in every case, since this
function's only early `null` return is document-absence, not chronology
absence): `{ documentDigest: digest(await readText(root, '.musubix/changes/' + changeId + '.md')), everRecorded: order.records.some((r) => r.kind === 'change' && r.entityId === changeId && r.phase !== 'waiver'), currentEntry: (() => { const entry = evidence?.changes.find((c) => c.changeId === changeId); return entry ? digest(canonicalJson(entry)) : null; })() }`
— `everRecorded` is the monotonic, append-only-log-derived sentinel
required to close the add-then-remove reactivation gap identified during
requirements review: because `order.json` records are never
modified/reordered/deleted (a pre-existing system invariant this feature
relies on but does not itself establish), `everRecorded` can only
transition `false → true`, never back, even after `currentEntry` reverts
to `null` following a `changes.json` entry's removal, so the combined
payload can never return to its exact original value once any
non-`waiver` `change`-kind order record for this `changeId` has ever been
appended. `currentEntry`'s digest additionally invalidates the waiver if
the entry's own content later changes without disappearing.
For `CHANGE_PHASE_MISSING`: resolve `item = change.phases[phaseNameFromDetail]` for the singular-phase names (`impact`/`requirements`/`design`/`quality`), or, for the TDD-batch-phase names (`red`/`implementation`/`green`), treat the phase as an aggregate with no single `item` (it is inherently multi-batch); build
`{ phasePresent: isTddBatchPhaseName(phaseNameFromDetail) ? null : item !== undefined, orderIsInteger: isTddBatchPhaseName(phaseNameFromDetail) ? null : Number.isInteger(item?.order), phaseOrder: isTddBatchPhaseName(phaseNameFromDetail) ? null : (Number.isInteger(item?.order) ? item.order : null), missingRequirementIds: isTddBatchPhaseName(phaseNameFromDetail) ? [...change.requirementIds].filter((id) => !effectiveBatches(change).some((b) => b[phaseNameFromDetail] && b.requirementIds.includes(id))).sort() : null }`
(`phaseNameFromDetail` parsed from the `phase:<name>` grammar below —
`CHANGE_PHASE_MISSING` has no `batch:` flavor: both its singular-phase
site — `impact`/`requirements`/`design`/`quality` — and its
`red`/`implementation`/`green` site report exactly one aggregate
diagnostic per phase name for the whole change, never per individual
batch, so `phase:<name>` alone is the complete, correct grammar for every
`CHANGE_PHASE_MISSING` instance; `isTddBatchPhaseName` distinguishes only
whether `missingRequirementIds`/per-item presence fields are meaningful,
never which grammar applies — for a TDD-batch-phase name, per
REQ-CHANGE-EVIDENCE-WAIVER-011's acceptance criteria the relevant state is
exactly `missingRequirementIds`, which already distinguishes every
requirement's covered/not-covered state across all batches, so
`phasePresent`/`orderIsInteger`/`phaseOrder` are `null` there rather than
duplicating information already captured; `phasePresent` and
`orderIsInteger` are kept as two explicit, independently significant
booleans — never collapsed into a single nullable `order` field — so a
change from "phase absent" to "phase present but not yet ordered" (both of
which keep `CHANGE_PHASE_MISSING` firing) still changes the payload,
closing the presence/order-integrality ambiguity flagged in design
review). For `CHANGE_ORDER_MIGRATION_REQUIRED` when `detail` has the
`phase:` prefix (the singular-phase flavor, `impact`/`requirements`/
`design`/`quality` lacking monotonic order): `{ phasePresent: change.phases[phaseNameFromDetail] !== undefined, orderIsInteger: Number.isInteger(change.phases[phaseNameFromDetail]?.order), phaseOrder: Number.isInteger(change.phases[phaseNameFromDetail]?.order) ? change.phases[phaseNameFromDetail]!.order : null }`
(this flavor only ever fires when the phase is present but its `order` is
not an integer, so `phasePresent` is always `true` when this diagnostic
fires — included anyway so the payload's shape is uniform with
`CHANGE_PHASE_MISSING`'s, and so a future evidence state transitioning
through "phase removed entirely" is still distinguishable from today's
"phase present, unordered" state, rather than both collapsing to the same
`null`).
For `CHANGE_ORDER_MIGRATION_REQUIRED` when `detail` has the `batch:`
prefix (the batch-phase-item flavor — a specific batch's `red`/
`implementation`/`green` item lacking monotonic order, genuinely one
instance per batch per phase name, unlike `CHANGE_PHASE_MISSING` above):
resolve `item = batchForKey(effectiveBatches(change), batchKeyFromDetail)?.[batchPhaseNameFromDetail]`, then
`{ phaseItemPresent: item != null, orderIsInteger: Number.isInteger(item?.order), phaseOrder: Number.isInteger(item?.order) ? item.order : null }`
(three explicit fields, not the single collapsed `phaseItemPresent`
boolean a prior draft used, which could not distinguish "item present but
unordered" — the exact firing condition — from "item present and now
correctly ordered", making a genuine repair invisible to a stale-waiver
check).
For `CHANGE_ORDER_MIGRATION_REQUIRED` when `detail` has the
`requirement:` prefix (the per-requirement TDD-cycle-order flavor): `{ cycles: (tdd?.cycles ?? []).filter((c) => c.requirementId === requirementIdFromDetail).map((c) => ({ redOrder: c.red.order ?? null, greenOrder: c.green?.order ?? null })).sort((a, b) => (a.redOrder ?? Number.MAX_SAFE_INTEGER) - (b.redOrder ?? Number.MAX_SAFE_INTEGER)) }`.
For `CHANGE_TESTS_UNCHANGED` (batch-scoped by bare `detail` as the batch
key): resolve `batch = batchForKey(effectiveBatches(change), detail)`
(DES-001's new selector — `batchFor`'s existing `requirementId` selector
cannot resolve a batch from a bare batch-key `detail` value alone), then
`{ designTests: change.phases.design?.fingerprints.tests ?? null, batchRedTests: batch?.red?.fingerprints.tests ?? null }`.
For `CHANGE_IMPLEMENTATION_UNCHANGED` (batch-scoped, same `batch`
resolution): `{ redImplementation: batch?.red?.fingerprints.implementation ?? null, implementationImplementation: batch?.implementation?.fingerprints.implementation ?? null }`.
For `CHANGE_TEST_CHANGED_AFTER_RED` (batch-scoped, same `batch`
resolution): `{ redTests: batch?.red?.fingerprints.tests ?? null, greenTests: batch?.green?.fingerprints.tests ?? null }`.
For `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED` (scoped by both
`requirementId` and `detail` as the batch key, same `batch` resolution):
`{ redRequirementImplementation: batch?.red?.fingerprints.requirementImplementations?.[requirementId] ?? null, implementationRequirementImplementation: batch?.implementation?.fingerprints.requirementImplementations?.[requirementId] ?? null }`.
Then
`digest(canonicalJson(await snapshotPayload(...)))`
combined with `CURRENT_SNAPSHOT_VERSION` is the snapshot identity used by
both DES-001 (at recording time) and DES-004 (at validation time) — the
two call sites never diverge because both call this one function and
compare against the same `CURRENT_SNAPSHOT_VERSION` constant. A waiver is
non-stale only when **both**
`record.snapshotVersion === CURRENT_SNAPSHOT_VERSION` **and**
`record.snapshotHash === digest(canonicalJson(await snapshotPayload(...)))`
hold; a future incompatible change to any code's payload definition
increments `CURRENT_SNAPSHOT_VERSION`, which alone makes every
previously recorded waiver stale (REQ-011's version-bump acceptance
criterion) regardless of whether its stored hash still happens to match
the newly shaped payload.
Implement `diagnosticDetail(code: WaivableCode, context): string | undefined`
(REQ-016), the single function computing the canonical `detail` grammar
both at emission time (DES-003, called from `change.ts`) and at
matching/snapshot time (here and DES-001's `recordChangeWaiver`), so the
two call sites never diverge on a `detail` value's exact string: for
`CHANGE_PHASE_MISSING` (both its singular-phase and its
`red`/`implementation`/`green` aggregate site) and the singular-phase
flavor of `CHANGE_ORDER_MIGRATION_REQUIRED`, `` `phase:${phaseName}` ``;
for the batch-phase-item flavor of `CHANGE_ORDER_MIGRATION_REQUIRED`
(one instance per batch per `red`/`implementation`/`green` name lacking
order), `` `batch:${batchPhaseName}:${batchKey(batch.requirementIds)}` ``
(reusing the existing `batchKey` helper's exact
`[...new Set(ids)].sort().join(',')` serialization, never a new one); for
the per-requirement TDD-cycle-order flavor of
`CHANGE_ORDER_MIGRATION_REQUIRED`, `` `requirement:${requirementId}` ``;
for `CHANGE_TESTS_UNCHANGED`/`CHANGE_IMPLEMENTATION_UNCHANGED`/
`CHANGE_TEST_CHANGED_AFTER_RED`/the batch component of
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, the bare `batchKey(batch.requirementIds)`
value (no prefix); `undefined` for every other code. `parseDetail(code,
detail): { kind: 'phase' | 'batch' | 'requirement' | 'batchKey'; phaseName?: string; batchKey?: string; requirementId?: string } | null`
is the inverse parser used by `snapshotPayload` above to recover
`phaseName`/`batchKey`/`requirementId` from a stored or supplied `detail`
string, returning `null` on any string not matching one of these four
grammars for that code.
Implement `loadChangeWaiverEvidence`'s companion validators:
`waiverRecordShapeValid(record: unknown): record is ChangeWaiverRecord`
checking every field's type explicitly (`changeId`/`code`/`approver`/
`reason`/`recordedAt` are non-empty strings, `requirementId`/`detail` are
non-empty strings or absent, `snapshotVersion`/`order` are positive
integers, `snapshotHash`/`payloadSha256` match `/^[a-f0-9]{64}$/i`,
`previousSha256` matches the same pattern or, for the first record,
equals `'0'.repeat(64)`);
`waiverChainValid(waivers, index)` checking
`waivers[index].previousSha256 === (index === 0 ? '0'.repeat(64) : waivers[index - 1].payloadSha256)`
and that `waivers[index].payloadSha256` equals the recomputed hash from
DES-001's exact destructure-omit rule. Implement
`waiverLinkage(root: string, evidence: ChangeEvidence | null, order: Awaited<ReturnType<typeof inspectEvidenceOrder>>, waivers: ChangeWaiverRecord[], index: number): Promise<{ valid: boolean; reason?: string }>`
(now takes `root` and is `async`, so it can perform the change-document
existence check itself rather than assuming a caller already did — a
prior draft incorrectly assumed the caller checked this) requiring,
beyond shape and chain validity: the change document
exists at `.musubix/changes/<record.changeId>.md` (checked here directly
via `exists(within(root, ...))`, not delegated to any caller); `record.code`
is in `WAIVABLE_CODES`; `record.requirementId` presence
equals `requiresRequirementId(record.code)` and `record.detail` presence
equals `requiresDetail(record.code)` (DES-001's four regime sets); when
`record.code === 'CHANGE_RECORD_MISSING'`,
`evidence === null || !evidence.changes.some((c) => c.changeId === record.changeId)` (the
change document exists — just checked above — but either the whole
chronology file is absent (`evidence === null`, exactly the state
`change.ts`'s `!evidence?.changes.length` early return produces) or it
exists with no entry for this `changeId`; this is the exact inverse of
every other code's existence rule, since the diagnostic itself only fires
in one of these two absence states, and this is the only place in
`waiverLinkage` where `evidence === null` is ever treated as satisfying a
condition rather than immediately failing linkage); for every other
code, `evidence !== null &&
evidence.changes.some((c) => c.changeId === record.changeId && (record.requirementId === undefined || c.requirementIds.includes(record.requirementId)))`
(every non-`CHANGE_RECORD_MISSING` code requires non-null `evidence` with
a matching entry, exactly as before — only `CHANGE_RECORD_MISSING`'s
branch above is exempt from requiring non-null `evidence`);
`order.valid === true` for the whole log; and exactly one
`order.records` entry exists via
`evidenceOrderRecord(order.records, 'change', record.changeId, 'waiver', { code: record.code, requirementId: record.requirementId, detail: record.detail, sequence: record.order })`
(DES-001's extended lookup, passing `sequence: record.order` so the
scope-keyed `Map` — which now discriminates waiver-phase entries by their
own `sequence`, per DES-001's duplicate-key fix — resolves to *this*
specific record's own order entry rather than any other validly-linked
record that happens to share the same `changeId`/`code`/`requirementId`/
`detail` scope) whose `sequence` equals `record.order` — this checks only
that *this* record's own `order` value has its matching log entry; more
than one validly linked waiver record may otherwise share the same
`changeId`/`code`/`requirementId`/`detail` scope across distinct `order`
values (e.g. a REQ-010-permitted replacement recorded after an earlier
one went stale), and DES-004/DES-005 select the validly linked record
with the greatest `order` for a given scope as authoritative for
staleness evaluation and for the `waivers`/gate-visibility output; a
superseded, still-validly-linked record is neither invalid nor
independently blocking. Any
failing condition returns `{ valid: false, reason: <specific failing
condition> }`.
Interfaces: `snapshotPayload(...)`, `diagnosticDetail(...)`,
`parseDetail(...)`, `waiverRecordShapeValid(...)`,
`waiverChainValid(...)`, `waiverLinkage(...)` exported from
`change-waiver.ts`.
Constraints: Must never report `valid: true` for a record failing any
shape, chain, allow-list, granularity, change/requirement-existence, or
order-linkage condition. Must use the exact same `snapshotPayload(...)`
and `diagnosticDetail(...)` functions at recording time, emission time,
and validation time — never independently reimplemented in more than one
place. `CHANGE_RECORD_MISSING`'s `everRecorded` sentinel must be derived
only from `order.json`'s already-validated, append-only record list,
never from any mutable/overwritable state.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-006, REQ-CHANGE-EVIDENCE-WAIVER-007, REQ-CHANGE-EVIDENCE-WAIVER-010, REQ-CHANGE-EVIDENCE-WAIVER-011, REQ-CHANGE-EVIDENCE-WAIVER-016
ADRs: ADR-0025

## DES-CHANGE-EVIDENCE-WAIVER-003: Structured `changeId`/`requirementId`/`detail`/`waiver` diagnostic fields across all twelve emission sites
Responsibilities: Add optional `changeId?: string`, `requirementId?:
string`, `detail?: string`, and `waiver?: { approver: string; reason:
string; recordedAt: string }` fields to the shared `Diagnostic` interface
in `packages/domain/src/types.ts` (additive; every existing `Diagnostic`
producer and consumer — including JSON serialization, `gate`'s console
printer, and other snapshot/golden tests — is unaffected, since all four
fields are optional and no existing code path sets them). In
`validateChangeEvidence`/`validateChangeCompleteness`
(`packages/analysis/src/change.ts`), replace every direct `error(code,
message)` call at the twelve allow-listed emission sites with a call
through `errorFor(code, message, target)` (a thin wrapper around the
existing `error(...)` helper that spreads `target` onto the returned
diagnostic, computing `target.detail` via DES-002's
`diagnosticDetail(code, context)` so the same function that defines the
grammar also stamps it, never a second, independently maintained
computation): `changeId` only, for `CHANGE_REQUIREMENTS_UNCHANGED`/
`CHANGE_DESIGN_UNCHANGED`/`CHANGE_RECORD_MISSING`; `changeId,
requirementId`, for `CHANGE_RED_UNPROVEN`/`CHANGE_GREEN_UNPROVEN`/
`CHANGE_COMPLETENESS_TDD` (and `CHANGE_COMPLETENESS_TDD` in
`validateChangeCompleteness`); `changeId, detail: diagnosticDetail(...)`,
for the singular-phase and batch-phase flavors of `CHANGE_PHASE_MISSING`
and the phase/batch flavors of `CHANGE_ORDER_MIGRATION_REQUIRED`, for
`CHANGE_TESTS_UNCHANGED`/`CHANGE_IMPLEMENTATION_UNCHANGED`/
`CHANGE_TEST_CHANGED_AFTER_RED` (each attached inside the existing `for
(const batch of batches)` loop, with `detail` computed from that specific
`batch`), and for the per-requirement TDD-cycle-order flavor of
`CHANGE_ORDER_MIGRATION_REQUIRED` (`detail` only, never `requirementId` —
REQ-004 classifies this flavor as detail-only, since its `detail` value
`requirement:<REQ-ID>` already carries the requirement identity, and
`requiresRequirementId(code)` is `false` for this code in every one of
its flavors); `changeId, requirementId, detail: diagnosticDetail(...)`,
for `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED` only (the sole
`BOTH_KEYS_CODES` member among these emission sites). `errorFor` is defined once,
exported from `change-waiver.ts` (not duplicated per module), so
DES-004's `waivedDiagnostic`/`reportWaiverEvidenceDiagnostics` — which
also live in `change-waiver.ts` — can call it directly without crossing a
module boundary; `change.ts` imports it alongside the other
`change-waiver.ts` exports. No other diagnostic code (e.g.
`CHANGE_COMPLETENESS_CODE`, kept deliberately outside the allow-list per
the requirements' scoping decision) gains these fields.
Interfaces: `Diagnostic` gains `changeId?: string; requirementId?: string;
detail?: string; waiver?: { approver: string; reason: string; recordedAt:
string }`. `errorFor(code: WaivableCode, message: string, target: {
changeId: string; requirementId?: string; detail?: string }): Diagnostic`,
exported from `change-waiver.ts`, used only at the twelve allow-listed
emission sites (directly by `change.ts`, and internally by
`waivedDiagnostic`) — each call site passes only the fields its code's
regime (`NEITHER_KEY_CODES`/`REQUIREMENT_ONLY_CODES`/`DETAIL_ONLY_CODES`/
`BOTH_KEYS_CODES`) actually requires, so the per-requirement
`CHANGE_ORDER_MIGRATION_REQUIRED` call site never passes
`requirementId`.
Constraints: Must not add `changeId`/`requirementId`/`detail` to any
diagnostic code outside the twelve allow-listed codes (in particular,
never to `CHANGE_COMPLETENESS_CODE`). Must not change any diagnostic's
`code`, `message`, `path`, or `line` values. `detail` must be present on a
diagnostic if and only if `requiresDetail(code)` (DES-001) is `true`, and
`requirementId` if and only if `requiresRequirementId(code)` is `true` —
the same regime the CLI/linkage layers enforce, so a diagnostic's own
target shape and a waiver's required scope keys can never disagree.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-013, REQ-CHANGE-EVIDENCE-WAIVER-016
ADRs: ADR-0025

## DES-CHANGE-EVIDENCE-WAIVER-004: Inline waiver-aware severity, malformed/stale reporting, and completeness recount
Responsibilities: Both `validateChangeEvidence` and
`validateChangeCompleteness` are restructured so their existing
`const tdd = await loadTddEvidence(root)` load (currently positioned
after each function's `!evidence?.changes.length` early return) moves to
occur immediately alongside `evidence`'s own load, before that early
return — both functions already compute `evidence` before the early
return today, so this only relocates the pre-existing `tdd` load earlier,
introducing no new I/O call and no behavior change to the load itself.
Immediately after both loads, each function calls a single new async
function, `buildWaiverContext(root: string, evidence: ChangeEvidence | null, tdd: TddEvidence | null): Promise<WaiverContext>`
(exported from `change-waiver.ts`; the only place any waiver-related I/O
or `await`-requiring computation happens — every other DES-004 function
below is deliberately synchronous, consulting only this precomputed
result, so `snapshotPayload`'s and `waiverLinkage`'s `async`ness from
DES-002 never needs to leak into `reportWaiverEvidenceDiagnostics`/
`waivedDiagnostic`, resolving the async/sync mismatch flagged in design
review). `buildWaiverContext` computes `loaded = await
loadChangeWaiverEvidence(root)`, `order = await inspectEvidenceOrder(root)`
(the existing exported async function already used elsewhere in
`change.ts` to load and validate `order.json` in one call — no new
order-log validation logic is introduced), and, only when `loaded` is
non-null and not malformed, iterates `loaded.waivers` once, computing for
each `index`: `linkage[index] = await waiverLinkage(root, evidence, order,
loaded.waivers, index)` (DES-002) and, only when `linkage[index].valid`,
`currentHash[index] = digest(canonicalJson(await snapshotPayload(root,
evidence, tdd, order, loaded.waivers[index].changeId,
loaded.waivers[index].code, loaded.waivers[index].requirementId,
loaded.waivers[index].detail)))` (`undefined` when linkage is invalid,
since a non-linked record's staleness is moot). The returned
`WaiverContext` is `{ loaded, order, linkage: Array<{ valid: boolean;
reason?: string }>, currentHash: Array<string | undefined> }`, fully
resolved (no remaining `Promise`s), so every function below can be a
plain synchronous function over this value.
Immediately compute
`const waiverDiagnostics = reportWaiverEvidenceDiagnostics(waiverContext, evidence, tdd)`
using this same, already-relocated `tdd` value (never a second,
separately timed load) and, on both the early-return path and the normal
path, append
`waiverDiagnostics` to the returned `diagnostics` array before computing
`valid` (so a malformed/stale/invalid waiver file is reported even when
there are zero change documents at all, resolving the prior early-return
bypass). `reportWaiverEvidenceDiagnostics(waiverContext: WaiverContext, evidence: ChangeEvidence | null, tdd: TddEvidence | null): Diagnostic[]`
is synchronous (all I/O and linkage/snapshot computation already happened
via `buildWaiverContext`): if
`waiverContext.loaded === null`, return `[]` (no file, nothing to report);
if `waiverContext.loaded.malformed`, return exactly one
`CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic naming the file and stop;
otherwise, for each waiver index failing
`waiverContext.linkage[index].valid`
(which is `false` for every waiver whenever `evidence === null` and its
code is not `CHANGE_RECORD_MISSING`, since `waiverLinkage` requires either
non-null `evidence` or, for `CHANGE_RECORD_MISSING` specifically, only
that the change document exists on disk — this is exactly the case where
the calling validator's own early return fires for every other code, so
every recorded non-`CHANGE_RECORD_MISSING` waiver is correctly reported
malformed/unlinked rather than silently skipped), push one
`CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic naming its
`changeId`/`code`/`requirementId`/`detail` and
`waiverContext.linkage[index].reason` (REQ-007); group the remaining,
validly linked waivers by their
`changeId`/`code`/`requirementId`/`detail` scope tuple and, within each
group, treat only the record with the greatest `order` as authoritative
(REQ-006's supersession rule — a group can legitimately contain more than
one validly linked record when REQ-010 permitted a replacement after an
earlier one went stale); for each group's authoritative record at index
`i`, when it is stale (`record.snapshotVersion !== CURRENT_SNAPSHOT_VERSION
|| record.snapshotHash !== waiverContext.currentHash[i]`, DES-002's
non-stale predicate evaluated against the precomputed
`waiverContext.currentHash[i]`), push one `CHANGE_WAIVER_STALE` diagnostic
naming its `changeId`/`code`/`requirementId`/`detail` (REQ-011) — this
pass runs independent of whether the original target diagnostic still
fires, so a stale waiver is always reported even after its underlying
condition is separately resolved, and never fabricates a resolved
`CHANGE_*`/`CHANGE_COMPLETENESS_*` diagnostic on its own; a non-authoritative
(superseded) record in a group is never itself reported stale or
malformed merely for having been superseded.
Separately, replace direct `error(code, message)` calls at the twelve
allow-listed emission sites (which only run on the normal, non-early-return
path, since they require an existing change, so `evidence` is always
non-null at these call sites) with a call through
`waivedDiagnostic(waiverContext: WaiverContext, code: WaivableCode, message: string, changeId: string, requirementId: string | undefined, detail: string | undefined): Diagnostic`
(synchronous — like `reportWaiverEvidenceDiagnostics`, it consults only
the precomputed `waiverContext`, never calling `snapshotPayload`/
`waiverLinkage` itself; defined once in `change-waiver.ts`, alongside and reusing `errorFor` from
DES-003): if `waiverContext.loaded` is
non-null, non-malformed, and contains at least one waiver matching
`changeId`/`code`/`requirementId`/`detail` exactly, select the matching
waiver with the greatest `order` (the same authoritative-record rule used
above), find its `index` within `waiverContext.loaded.waivers`; if
`waiverContext.linkage[index].valid` and (`record.snapshotVersion ===
CURRENT_SNAPSHOT_VERSION && record.snapshotHash ===
waiverContext.currentHash[index]`, DES-002's non-stale predicate
evaluated against the precomputed hash), return
`{ ...errorFor(code, message, { changeId, requirementId, detail }), severity: 'warning', waiver: { approver, reason, recordedAt } }`;
otherwise return the unmodified `errorFor(code, message, { changeId,
requirementId, detail })` at `severity: 'error'` (REQ-008, REQ-009). Because this
runs *inline*, at the exact point each diagnostic would otherwise be
pushed, `validateChangeCompleteness`'s existing
`checks.every(([present]) => present)`-style completeness accounting is
changed to also treat a `CHANGE_COMPLETENESS_TDD` check as satisfied
(counted toward `completeRequirements`) when `waivedDiagnostic(...)` for it
returns `severity: 'warning'`, resolving the current code's
"`hasTdd` false ⇒ never counted, regardless of downstream severity"
problem structurally, not via post-hoc reinterpretation of an
already-built diagnostics array (REQ-014's completeness half; the other
eleven waivable codes never participate in `completeRequirements`
counting, unchanged). Both new
diagnostic codes are `severity: 'error'`, added to the existing
`change-history`/`change-completeness` diagnostics arrays — no new gate
check, check-name configuration, or release-profile entry is introduced;
`CHANGE_WAIVER_EVIDENCE_MALFORMED`/`CHANGE_WAIVER_STALE` already block
release approval simply by being error-severity members of the
pre-existing required `change-history` check's diagnostics.
Interfaces: `type WaiverContext = { loaded: LoadedChangeWaiverEvidence | null; order: Awaited<ReturnType<typeof inspectEvidenceOrder>>; linkage: Array<{ valid: boolean; reason?: string }>; currentHash: Array<string | undefined> }`;
`buildWaiverContext(...)` (the sole async function in this component),
`waivedDiagnostic(...)` and `reportWaiverEvidenceDiagnostics(...)` as
above, both exported from `change-waiver.ts` and both synchronous (the one
`await loadChangeWaiverEvidence`/`await inspectEvidenceOrder` pair per
validator invocation lives only in `change.ts`, computed once into
`waiverContext` and threaded through every call site, so no emission site
or final pass performs its own I/O or repeats order-log validation).
Constraints: Must never downgrade a diagnostic whose code is outside the
twelve-code allow-list. Must never downgrade based on a waiver whose
`changeId`/`code`/`requirementId`/`detail` does not exactly match. Must
recompute staleness fresh from `waiverContext` on every call rather than
caching across invocations. Must select the greatest-`order` validly
linked record as authoritative whenever more than one shares a scope, and
must never report a non-authoritative (superseded) record as stale or
malformed in its own right. Must not change `completeRequirements`'s
counting for any check other than `CHANGE_COMPLETENESS_TDD` under an
active, non-stale waiver. Must report waiver-evidence-file diagnostics
(`malformed`/invalid linkage/stale) on every return path of both
validators, including the existing early-return path taken when no change
documents exist.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-006, REQ-CHANGE-EVIDENCE-WAIVER-007, REQ-CHANGE-EVIDENCE-WAIVER-008, REQ-CHANGE-EVIDENCE-WAIVER-009, REQ-CHANGE-EVIDENCE-WAIVER-010, REQ-CHANGE-EVIDENCE-WAIVER-011, REQ-CHANGE-EVIDENCE-WAIVER-014
ADRs: ADR-0025

## DES-CHANGE-EVIDENCE-WAIVER-005: Error-only validity semantics and gate/status waiver visibility
Responsibilities: Change `validateChangeEvidence`'s returned `valid` from
`!diagnostics.length` to `!diagnostics.some((d) => d.severity === 'error')`,
and `validateChangeCompleteness`'s top-level returned `valid` identically,
both computed after DES-004's inline waiver handling and final malformed/
stale pass have already contributed to the diagnostics array (REQ-014's
aggregate half). Change each per-change `ChangeCompleteness.valid` from
`diagnostics.length === diagnosticStart` to
`!diagnostics.slice(diagnosticStart).some((d) => d.severity === 'error') && completeRequirements === requirements`
— the existing `completeRequirements === requirements` condition is
preserved unchanged; `completeRequirements` itself already reflects DES-004's
waiver-aware recount, so a validly waived `CHANGE_COMPLETENESS_TDD` both
avoids an error-severity diagnostic in the slice and is counted toward
`completeRequirements`, letting this combined condition become `true`.
`packages/analysis/src/gate.ts`'s existing repo-wide branches
(`changes.valid`, `completeness.valid`) need no further code change beyond
consuming these corrected `valid` fields; its `featureDir` branch's
`countErrors(...) === 0` already matches this same error-only semantics
and is unaffected. Define two shared helpers in `change-waiver.ts`, both
taking only `root: string` and doing their own I/O (loading
`loadChangeWaiverEvidence`, `loadChangeEvidence`, `loadTddEvidence` from
`./tdd.js` — the same existing exported function `change.ts` itself
already calls — and `inspectEvidenceOrder` internally, then delegating to
the existing synchronous DES-002/DES-004 logic) so `gate.ts` never needs
to duplicate that loading sequence:
`activeWaivers(root): Promise<Array<{ changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string }>>`,
computing exactly the
`(await loadChangeWaiverEvidence(root))` (return `[]` immediately when
`null` or `malformed`) combined with `await loadChangeEvidence(root)`,
`await loadTddEvidence(root)`, and
`await inspectEvidenceOrder(root)`, filtered to those waivers whose index
`i` satisfies `waiverContext.linkage[i].valid`
(`waiverContext = await buildWaiverContext(root, evidence, tdd)`, DES-004's
sole async precomputation — reused here rather than reimplemented, so
`gate`'s validators, `activeWaivers`, and `waiverEvidenceDiagnostics` can
never diverge on any waiver's linkage/staleness classification), and
non-stale (`waivers[i].snapshotVersion === CURRENT_SNAPSHOT_VERSION &&
waivers[i].snapshotHash === waiverContext.currentHash[i]`, DES-002's
non-stale predicate evaluated against `buildWaiverContext`'s precomputed
hash, never a separately reimplemented staleness check), and
selected as the greatest-`order` record within each
`changeId`/`code`/`requirementId`/`detail` scope group (DES-004's
authoritative-record rule, so a superseded prior waiver is never listed
alongside its replacement), each
projected to exactly `changeId`, `code`, `requirementId`, `detail` (each
only when present), `approver`, `reason`, `recordedAt` (REQ-012); and
`waiverEvidenceDiagnostics(root): Promise<Diagnostic[]>`, an async wrapper
with the identical load set (`evidence`, `tdd`, `order`, `loaded`, and the
same `waiverContext = await buildWaiverContext(root, evidence, tdd)`) that
calls DES-004's synchronous
`reportWaiverEvidenceDiagnostics(waiverContext, evidence, tdd)` directly,
returning exactly the malformed/stale
diagnostics REQ-007/REQ-011 require (REQ-CHANGE-EVIDENCE-WAIVER-007's
"gate/status diagnostic" wording is satisfied by calling this same helper
from both places, not only from `gate`'s validators — and because both
helpers load `evidence`/`tdd`/`order`/`waiverContext` identically and both
delegate to DES-002/DES-004's shared logic, `gate`'s validators,
`activeWaivers`, and
`waiverEvidenceDiagnostics` can never diverge on any waiver's active/stale
classification). Call `activeWaivers(root)` and
`waiverEvidenceDiagnostics(root)` once each from `gate.ts` (`runGate`) —
though `runGate`'s `waivers`/diagnostics content is already implied by
`validateChangeEvidence`/`validateChangeCompleteness`'s own internal calls
to the same underlying logic, so `runGate` may reuse either its own
validator diagnostics or these helpers' output, provided the two never
diverge — to add a `waivers` array and ensure malformed/stale diagnostics
appear on the JSON report; and once each from `gate.ts`'s
`projectStatus(root)` (which already has `root` in scope, and does not
otherwise run `validateChangeEvidence`/`validateChangeCompleteness`) to
add the identical `waivers` array plus a `waiverDiagnostics` array to
`status --json`'s returned object, satisfying REQ-007's requirement that
malformed waiver evidence is reported via a `status` diagnostic too, not
only `gate`.
Interfaces: No signature change to `validateChangeEvidence`/
`validateChangeCompleteness`; `activeWaivers(root: string): Promise<Array<{ changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string }>>`
and `waiverEvidenceDiagnostics(root: string): Promise<Diagnostic[]>`, both
exported from `change-waiver.ts`; `GateReport` and `projectStatus`'s
return type both gain an additive `waivers?: Array<{ changeId: string;
code: string; requirementId?: string; detail?: string; approver: string;
reason: string; recordedAt: string }>` field and an additive
`waiverDiagnostics?: Diagnostic[]` field.
Constraints: Must not change `valid` semantics for any diagnostic outside
the twelve allow-listed codes. Must exclude stale or malformed waivers,
and every non-authoritative (superseded) record in a scope group, from
the `waivers` array. Must not change `gate.ts`'s existing `featureDir`
(`--feature`) branch behavior.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-006, REQ-CHANGE-EVIDENCE-WAIVER-012, REQ-CHANGE-EVIDENCE-WAIVER-014
ADRs: ADR-0025
