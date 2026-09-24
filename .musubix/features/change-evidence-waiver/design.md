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
CHANGE-0029 owns the REQ-002/REQ-006 record-time and structural-linkage
deltas; CHANGE-0028 owns REQ-011 stale classification and severity while
CHANGE-0031 owns the corrective REQ-011 false-condition and duplicate-key
snapshot coverage; CHANGE-0032 owns document-absent snapshot compatibility,
shared batch predicate reuse, precise false-condition remediation, and
true/indeterminate cross-validator coverage; CHANGE-0033 owns the direct
batch-predicate, document-absence, and gate/status audit-count regression
fixtures plus the shared gate/status audit derivation required by the final
release review. All five changes share this integrated design.
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
`batchKey(requirementIds)`, `batchForKey(batches, key)`,
`batchFor(batches, requirementId)`, and
`currentRequirementIdsForBatch(...)` are already exported from
`change-evidence.ts`; add and export
`batchesForKey(batches, key)` beside them. Every change-waiver path imports them from that
lower-level module, never from `change.ts`, preserving the existing
cycle-free dependency direction. `batchesForKey` is the normative
direct-by-`detail` selector for batch-scoped waiver paths and returns every
matching effective batch. DES-002 uses its sole element for the existing flat
zero/single-match payload shape, preserving every existing unambiguous
snapshot hash, while `batchForKey` remains available for backward-compatible
callers outside this new aggregation.
`batchesForKey` is used by both
the standalone condition evaluator and snapshot computation. When duplicate
batch keys exist, snapshots include every matching batch in deterministic
effective-batch order (and, for the four bare-`batchKey` codes, each batch's
current owned requirement IDs) so a newly owning duplicate batch cannot reuse
an earlier batch's waiver without making the snapshot stale. The evaluator
aggregates all key matches under `currentRequirementIdsForBatch` ownership
rather than requiring a unique match.
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
(DES-002), and — once `evidence`, `tdd`, and `order` are loaded through
`loadChangeEvidence(root)`, `loadTddEvidence(root)`, and
`inspectEvidenceOrder(root)` in this same function —
`waiverLinkage(order, waivers, i).valid`; if
any existing record fails any of these three checks, reject immediately
with no evidence written or modified, exactly as in the malformed-file
case above (this is the same shape/chain/linkage validation DES-004's
`reportWaiverEvidenceDiagnostics` independently performs on every read
path, so `recordChangeWaiver` never appends a new, valid-looking record
onto a chain that already contains an invalid one). Only once the whole
existing chain passes does `recordChangeWaiver` proceed with its existing
`waivers` array. Once past that check, reject with no evidence written
when: `code` is not in `WAIVABLE_CODES` (REQ-001);
`requirementId` presence does not equal `requiresRequirementId(code)`, or
`detail` presence does not equal `requiresDetail(code)` (REQ-004); a
present `detail` does not parse according to REQ-016's grammar; or
`approver`/`reason` are empty/whitespace-only (REQ-003; `--confirm` is
enforced at the CLI layer, matching `tdd void`). Then evaluate DES-004's
shared `evaluateWaiverCondition(...)` for this exact scope before any
separate current change-entry, requirement-membership, or
exact-diagnostic-absence rejection; it acts in place of those separate
condition checks. Reject `indeterminate` with the
distinct error that the scope cannot be evaluated, and reject `false` as
no matching diagnostic; `true` proves the current structured target
diagnostic. Thus absent change documents/entries, undeclared requirements,
and syntactically valid absent batch keys follow the evaluator's
code-relative `true`/`indeterminate` rules rather than being relabeled as
linkage failures or collapsed into diagnostic absence (REQ-002, REQ-004,
REQ-011, REQ-016).
After the whole-chain precheck, build one `waiverContext`
from the already-loaded `loaded` waiver evidence, `evidence`, `tdd`, and
`order` via
`buildWaiverContext(root, evidence, tdd, { loaded, order })`; resolve the requested scope with
`authoritativeWaiverIndex(waiverContext, scope)`, and reject as a duplicate
only when the returned index is not `-1` and
`!isWaiverStale(waiverContext, index)` (DES-004, REQ-006, REQ-010). Only once
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
`sequence`, for `phase: 'waiver'` only) change the key. `batchForKey` and `batchesForKey` as
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
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-001, REQ-CHANGE-EVIDENCE-WAIVER-002, REQ-CHANGE-EVIDENCE-WAIVER-003, REQ-CHANGE-EVIDENCE-WAIVER-004, REQ-CHANGE-EVIDENCE-WAIVER-005, REQ-CHANGE-EVIDENCE-WAIVER-010, REQ-CHANGE-EVIDENCE-WAIVER-011, REQ-CHANGE-EVIDENCE-WAIVER-015, REQ-CHANGE-EVIDENCE-WAIVER-016
ADRs: ADR-0025

## DES-CHANGE-EVIDENCE-WAIVER-002: Snapshot payload definition, canonical `detail` grammar, and waiver linkage validation
Responsibilities: Implement
`snapshotPayload(root: string, evidence: ChangeEvidence | null, tdd: TddEvidence | null, order: Awaited<ReturnType<typeof inspectEvidenceOrder>>, changeId: string, code: WaivableCode, requirementId?: string, detail?: string): Promise<unknown | null>`
(now `async` and taking `root`, needed to read the change document's text
for `CHANGE_RECORD_MISSING` below; `evidence` is now nullable because
`CHANGE_RECORD_MISSING` fires even when `.musubix/evidence/changes.json`
does not exist at all — `loadChangeEvidence` returns `null` in that case,
per `change.ts`'s `!evidence?.changes.length` early-return branch — and a
waiver must still be recordable/verifiable against that state). The only
state-dependent `null` is returned by the `CHANGE_RECORD_MISSING` branch when
`changeId` names no change
document at `.musubix/changes/<changeId>.md` on disk (checked directly, via
`exists`/`readText`, never via `evidence?.changes`); the other eleven codes
compute from chronology/TDD/order state even while the independent change
document is absent, so their snapshots remain hash-sensitive in that state.
Other `null` returns are internal-contract guards for invalid grammar or
missing required scope keys and are unreachable for validly linked records.
The former shared `null` result was an invalid sentinel rather than one of
those eleven code-specific canonical payload shapes, so replacing it with the
already-defined null/false/empty field derivations keeps
`CURRENT_SNAPSHOT_VERSION` unchanged. Document-present payloads remain
byte-identical; document-absent historical waivers become stale by hash
mismatch.
When the change-evidence entry is absent, the eleven branches return these
exact canonical payloads:
- `CHANGE_REQUIREMENTS_UNCHANGED`:
  `{ impactRequirements: null, requirementsRequirements: null, allowUnchanged: null }`.
- `CHANGE_DESIGN_UNCHANGED`:
  `{ requirementsDesign: null, design: null }`.
- `CHANGE_RED_UNPROVEN`/`CHANGE_GREEN_UNPROVEN`/
  `CHANGE_COMPLETENESS_TDD`: `{ requirementsOrder: null, red: null,
  implementation: null, green: null, cycles }`, where `cycles` still derives
  from matching TDD evidence and `voidedCycleOrders` is omitted.
- `CHANGE_PHASE_MISSING`: aggregate TDD phases use
  `{ phasePresent: null, orderIsInteger: null, phaseOrder: null,
  missingRequirementIds: null }`; singular phases use
  `{ phasePresent: false, orderIsInteger: false, phaseOrder: null,
  missingRequirementIds: null }`.
- `CHANGE_ORDER_MIGRATION_REQUIRED`: `phase:` uses
  `{ phasePresent: false, orderIsInteger: false, phaseOrder: null }`;
  `batch:` uses `{ phaseItemPresent: false, orderIsInteger: false,
  phaseOrder: null }`; `requirement:` retains TDD-derived `cycles` and omits
  `voidedCycleOrders`.
- `CHANGE_TESTS_UNCHANGED`: `{ designTests: null, batchRedTests: null }`.
- `CHANGE_IMPLEMENTATION_UNCHANGED`:
  `{ redImplementation: null, implementationImplementation: null }`.
- `CHANGE_TEST_CHANGED_AFTER_RED`: `{ redTests: null, greenTests: null }`.
- `CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`:
  `{ redRequirementImplementation: null,
  implementationRequirementImplementation: null }`.
`CHANGE_RECORD_MISSING` is specifically the state
where the document exists but either `evidence` is entirely absent or
`evidence.changes` does not name it, so a `null`-on-`evidence`-absence
rule would make this code unsnapshottable in either sub-case, exactly the
defect flagged in design review. For every other code,
`evaluateWaiverCondition`, not `snapshotPayload`, enforces the non-null
current-entry precondition before applying its code-specific predicate. Define
`change = evidence?.changes.find((candidate) => candidate.changeId === changeId)`
once. Every formula below is total over `change === undefined`: phase reads
use `change?.phases`, `effectiveBatches(change)` is evaluated only when
`change` exists and otherwise means `[]`, `change.requirementIds` otherwise
means no declaration and produces the exact `null`/empty value fixed in the
table above, and current-window void orders otherwise mean `[]`.
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
`batch = change ? batchFor(effectiveBatches(change), requirementId) : undefined` using the
existing export from `change-evidence.ts`, so `change-waiver.ts` consumes
the validator's ownership selector: greatest integer `red.order`, falling
back to the first applicable batch when none has an integer Red order); build
`{ requirementsOrder, red, implementation, green, cycles:
sortedCyclesForSnapshot(...).map(({ cycleId, ...rest }) => rest),
...(voidedCycleOrders.length ? { voidedCycleOrders } : {}) }`
— every field explicitly present as `null` when the corresponding phase or
sub-field is absent (so a `CHANGE_RED_UNPROVEN` instance, which can fire
with `implementation`/`green` still unrecorded, always has a fully
constructible, deterministic payload), and `cycles` sorted by one shared `sortedCyclesForSnapshot(items,
orderSelector, idSelector, serializedSelector)` helper operating on raw cycle
objects before absent values are normalized: integer selected orders
ascending, then present non-integer orders by canonical JSON, then absent
orders; ties use the selected ID (absent as `""`) ascending and then canonical
JSON of the selected serialized object. `cycleId` is removed after sorting and
is never hashed. The TDD-code flavor selects `red.order`; the
`requirement:` flavor selects `redOrder`. New tie-break behavior can change
hashes only for previously ambiguous equal/non-integer/absent-order lists and
does not increment `CURRENT_SNAPSHOT_VERSION`; ordinary ordered payloads stay
byte-identical. Quality verification recomputes every currently stored waiver
payload and treats any unexpected hash drift outside these previously
ambiguous tie cases and the intentional document-absent correction as a
release blocker; an affected true-condition scope requires an explicitly
approved replacement waiver. When
`voidedCycleOrdersInCurrentWindow(...)` is non-empty, also include
`voidedCycleOrders` as its already-sorted integer array; omit the key when
empty to preserve existing hashes.
For `CHANGE_RECORD_MISSING` (reachable in every case, since this
function's only early `null` return is document-absence, not chronology
absence): `{ documentDigest: digest(await readText(root, '.musubix/changes/' + changeId + '.md')), everRecorded: [...order.records.values()].some((r) => r.kind === 'change' && r.entityId === changeId && r.phase !== 'waiver'), currentEntry: change ? digest(canonicalJson(change)) : null }`
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
For `CHANGE_PHASE_MISSING`: resolve `item = change?.phases[phaseNameFromDetail]` for the singular-phase names (`impact`/`requirements`/`design`/`quality`), or, for the TDD-batch-phase names (`red`/`implementation`/`green`), treat the phase as an aggregate with no single `item` (it is inherently multi-batch); build
`{ phasePresent: isTddBatchPhaseName(phaseNameFromDetail) ? null : item !== undefined, orderIsInteger: isTddBatchPhaseName(phaseNameFromDetail) ? null : Number.isInteger(item?.order), phaseOrder: isTddBatchPhaseName(phaseNameFromDetail) ? null : (Number.isInteger(item?.order) ? item.order : null), missingRequirementIds: isTddBatchPhaseName(phaseNameFromDetail) ? (change ? [...change.requirementIds].filter((id) => !effectiveBatches(change).some((b) => b[phaseNameFromDetail] && b.requirementIds.includes(id))).sort() : null) : null }`
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
`design` lacking monotonic order): `{ phasePresent: change?.phases[phaseNameFromDetail] !== undefined, orderIsInteger: Number.isInteger(change?.phases[phaseNameFromDetail]?.order), phaseOrder: Number.isInteger(change?.phases[phaseNameFromDetail]?.order) ? change!.phases[phaseNameFromDetail]!.order : null }`.
`phase:quality` is invalid for this code, because quality lineage has its own
malformed-history diagnostic and never emits
`CHANGE_ORDER_MIGRATION_REQUIRED`
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
resolve `batches = change ? effectiveBatches(change) : []` and all
`matches = batchesForKey(batches, batchKeyFromDetail)`. With zero or one
match, retain the existing flat payload
from `item = matches[0]?.[batchPhaseNameFromDetail]`:
`{ phaseItemPresent: item != null, orderIsInteger: Number.isInteger(item?.order), phaseOrder: Number.isInteger(item?.order) ? item.order : null }`
(three explicit fields, not the single collapsed `phaseItemPresent`
boolean a prior draft used, which could not distinguish "item present but
unordered" — the exact firing condition — from "item present and now
correctly ordered", making a genuine repair invisible to a stale-waiver
check). With multiple matches, instead return
`{ matchingBatches: matches.map((batch) => ({ phaseItemPresent,
orderIsInteger, phaseOrder })) }` in effective-batch order.
For `CHANGE_ORDER_MIGRATION_REQUIRED` when `detail` has the
`requirement:` prefix (the per-requirement TDD-cycle-order flavor): use the
same `sortedCyclesForSnapshot` helper over `{ cycleId, redOrder, greenOrder }`,
remove `cycleId` after sorting, and return
`{ cycles, ...(voidedCycleOrders.length ? { voidedCycleOrders } : {}) }`.
For the four bare-batch-key codes below, resolve
`batches = change ? effectiveBatches(change) : []` and
`matches = batchesForKey(batches, detail)`. With zero or one
match, preserve the existing flat payload exactly. With multiple matches,
return a root object containing `matchingBatches:
matches.map((batch) => ({ ownedRequirementIds:
change ? currentRequirementIdsForBatch(batches, batch, change.requirementIds).sort() : [],
...codeSpecificBatchFields }))` in effective-batch order. For
`CHANGE_TESTS_UNCHANGED`, the root additionally retains `designTests` and
`codeSpecificBatchFields` is `{ batchRedTests }`; for
`CHANGE_IMPLEMENTATION_UNCHANGED`, it is
`{ redImplementation, implementationImplementation }`; for
`CHANGE_TEST_CHANGED_AFTER_RED`, it is `{ redTests, greenTests }`; and for
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, it is
`{ redRequirementImplementation, implementationRequirementImplementation }`.
REQ-016's “batch phase source” grammar clause applies to the
`CHANGE_ORDER_MIGRATION_REQUIRED` batch flavor; `CHANGE_PHASE_MISSING`
continues to use `phase:<phaseName>` for its aggregate TDD-batch phases, as
specified by its diagnostic sites and REQ-011 payload above.
Then
`digest(canonicalJson(await snapshotPayload(...)))`
combined with `CURRENT_SNAPSHOT_VERSION` is the snapshot identity used by
both DES-001 (at recording time) and DES-004 (at validation time) — the
two call sites never diverge because both call this one function and
compare against the same `CURRENT_SNAPSHOT_VERSION` constant. The
snapshot component is current only when **both**
`record.snapshotVersion === CURRENT_SNAPSHOT_VERSION` **and**
`record.snapshotHash === digest(canonicalJson(await snapshotPayload(...)))`
hold; DES-004 combines this snapshot component with the tri-state condition
through `isWaiverStale(...)`. A future incompatible change to any code's payload definition
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
grammars for that code. It is the sole code-aware grammar authority: enforce
the per-code phase-name allow-lists, accept `batch:` only for
`CHANGE_ORDER_MIGRATION_REQUIRED`, reject `phase:quality` for that code, and
accept a batch key only when it is non-empty, comma-separated, duplicate-free,
and already sorted by `batchKey`'s comparator. DES-001 validates supplied
details through this function before evaluation, and `waiverLinkage` requires
stored details to parse successfully.
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
`waiverLinkage(order: Awaited<ReturnType<typeof inspectEvidenceOrder>>, waivers: ChangeWaiverRecord[], index: number): { valid: boolean; reason?: string }`
requiring, beyond shape and chain validity: `record.code`
is in `WAIVABLE_CODES`; `record.requirementId` presence
equals `requiresRequirementId(record.code)` and `record.detail` presence
equals `requiresDetail(record.code)` (DES-001's four regime sets); a present
detail parses under that code's REQ-016 grammar; and no other waiver record
claims the same stored `order` sequence.
Current chronology membership, current requirement declaration, and whether
the waived predicate still holds are deliberately not linkage conditions:
they are mutable condition state evaluated by
`evaluateWaiverCondition(...)`. This separation keeps a structurally valid
historical waiver linked after its debt is resolved (including
`CHANGE_RECORD_MISSING` after a chronology entry appears, or a
requirement-scoped waiver after that requirement is removed), allowing the
snapshot to become stale and the tri-state evaluator to classify the result
as `false` or `indeterminate` instead of misreporting immutable evidence as
malformed.
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
shape, chain, allow-list, granularity, or
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
existing `error(...)` helper that spreads the already-computed structured
target onto the returned diagnostic). Each detail-bearing call site computes
`target.detail` through DES-002's `diagnosticDetail(code, context)`, so the
same function stamps every emitted detail and no second grammar exists: `changeId` only, for `CHANGE_REQUIREMENTS_UNCHANGED`/
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
`requirementId`. Preserve each emission site's existing control flow and
batch object, but replace duplicated inline predicate logic with the same
exported total boolean condition helpers used by DES-004's standalone
evaluator. Emission remains driven by those helpers against the exact
in-scope change/requirement/batch object, never by key-based re-resolution;
therefore waiver-free diagnostics remain byte-compatible and duplicate batch
keys do not redirect an emission to a different batch. An authoritative stale
waiver whose standalone scope is `indeterminate` is blocked by the separate
error-severity `CHANGE_WAIVER_STALE` diagnostic from DES-004, not by
fabricating or suppressing a target; independently applicable upstream
diagnostics such as `CHANGE_IMPLEMENTATION_SCOPE_MISSING` remain unchanged.
Constraints: Must not add `changeId`/`requirementId`/`detail` to any
diagnostic code outside the twelve allow-listed codes (in particular,
never to `CHANGE_COMPLETENESS_CODE`), except that the non-waivable audit codes
`CHANGE_WAIVER_STALE` and `CHANGE_WAIVER_EVIDENCE_MALFORMED` may carry those
fields solely to identify the affected waiver scope. Must not change any diagnostic's
`code`, `message`, `path`, or `line` values. `detail` must be present on a
diagnostic for the twelve waivable codes if and only if
`requiresDetail(code)` (DES-001) is `true`, and `requirementId` if and only if
`requiresRequirementId(code)` is `true` —
the same regime the CLI/linkage layers enforce, so a diagnostic's own
target shape and a waiver's required scope keys can never disagree. The two
audit diagnostics mirror the affected waiver record's optional scope fields
without calling these `WaivableCode` predicates on their own audit code.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-011, REQ-CHANGE-EVIDENCE-WAIVER-013, REQ-CHANGE-EVIDENCE-WAIVER-016
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
function, `buildWaiverContext(root: string, evidence: ChangeEvidence | null, tdd: TddEvidence | null, precomputed?: { loaded?: LoadedChangeWaiverEvidence | null; order?: Awaited<ReturnType<typeof inspectEvidenceOrder>> }): Promise<WaiverContext>`
(exported from `change-waiver.ts`; it centralizes waiver-file/order loading
and per-record snapshot computation. `evaluateWaiverCondition` remains async
for its change-document existence check and is awaited only by
`buildWaiverContext`, `recordChangeWaiver`, and existing candidate emission
branches; `reportWaiverEvidenceDiagnostics` and `waivedDiagnostic` remain
synchronous over the precomputed context). `buildWaiverContext` uses the supplied `loaded`/`order` values
when present and otherwise computes `loaded = await
loadChangeWaiverEvidence(root)`, `order = await inspectEvidenceOrder(root)`
(the existing exported async function already used elsewhere in
`change.ts` to load and validate `order.json` in one call — no new
order-log validation logic is introduced), and, only when `loaded` is
non-null and not malformed, iterates `loaded.waivers` once, computing for
each `index`: `linkage[index] = waiverLinkage(order, loaded.waivers, index)`
(DES-002) and, only when `linkage[index].valid`,
`currentHash[index] = digest(canonicalJson(await snapshotPayload(root,
evidence, tdd, order, loaded.waivers[index].changeId,
loaded.waivers[index].code, loaded.waivers[index].requirementId,
loaded.waivers[index].detail)))` (`undefined` when linkage is invalid,
since a non-linked record's staleness is moot), and
`condition[index] = await evaluateWaiverCondition(..., { changeId, code:
record.code as WaivableCode, requirementId, detail })` only when linkage is
valid (linkage has already proven the code is allow-listed; use `undefined`
otherwise, preserving exact index alignment with `loaded.waivers`). The returned
`WaiverContext` is `{ loaded, order, linkage: Array<{ valid: boolean;
reason?: string }>, currentHash: Array<string | undefined>, condition:
Array<WaiverCondition | undefined> }`, fully
resolved (no remaining `Promise`s), so every function below can be a
plain synchronous function over this value.
Immediately compute
`const waiverDiagnostics = reportWaiverEvidenceDiagnostics(waiverContext)`
using this same, already-relocated `tdd` value (never a second,
separately timed load) and, on both the early-return path and the normal
path, append
`waiverDiagnostics` to the returned `diagnostics` array before computing
`valid` (so a malformed/stale/invalid waiver file is reported even when
there are zero change documents at all, resolving the prior early-return
bypass). `reportWaiverEvidenceDiagnostics(waiverContext: WaiverContext): Diagnostic[]`
is synchronous (all I/O and linkage/snapshot computation already happened
via `buildWaiverContext`): if
`waiverContext.loaded === null`, return `[]` (no file, nothing to report);
if `waiverContext.loaded.malformed`, return exactly one
`CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic naming the file and stop;
otherwise, for each waiver index failing
`waiverContext.linkage[index].valid`, push one
`CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic naming its
`changeId`/`code`/`requirementId`/`detail` and
`waiverContext.linkage[index].reason` (REQ-007). Process the waiver array in
one ascending-index pass. For a valid record, derive its scope tuple; only
when this is the first array index carrying that scope, use
`authoritativeWaiverIndex(waiverContext, scope)` to select the validly linked
record with greatest `order`. The selector returns `-1` when none exists.
When the authoritative record at index `i` is stale, push exactly one
`CHANGE_WAIVER_STALE` diagnostic naming its
`changeId`/`code`/`requirementId`/`detail` and condition value. Its message
uses the normative assertion substrings `target code is no longer reported`
and `replacement waiver is not required` for `false`, without claiming all
related debt is resolved; `condition still exists` for `true`, with direction
to resolve it or record an allowed replacement; and `cannot be evaluated` for
`indeterminate`/`undefined`, with direction to restore an evaluable
change/requirement/batch scope before rerunning validation (REQ-011).
Set its severity from `waiverContext.condition[i]`: `false` produces
`severity: 'warning'`; `true` or `indeterminate` produces `severity: 'error'`.
`buildWaiverContext` computes this tri-state once per validly linked record
through `evaluateWaiverCondition(...)`, never by inspecting either caller's
locally assembled diagnostics. The evaluator reuses the same code-specific
condition implementation used by `recordChangeWaiver` and stale-waiver
classification. The twelve structured diagnostic emission sites retain their
existing `qualityHistory` and `currentRequirementIdsForBatch` guards and exact
batch objects, while calling the same total boolean predicate helpers; they do
not key-resolve through this evaluator. The shared evaluator
semantics are:
`CHANGE_REQUIREMENTS_UNCHANGED` and `CHANGE_DESIGN_UNCHANGED` map their
existing predicates directly; `CHANGE_RED_UNPROVEN` and
`CHANGE_GREEN_UNPROVEN` return `false` when `qualityHistory` is non-empty and
otherwise map their existing predicates; `CHANGE_COMPLETENESS_TDD` maps its
existing predicate; `CHANGE_RECORD_MISSING` awaits
`recordMissingCondition` after independently checking that the change document
exists (document absence is `indeterminate` at both record and read time; a
present document plus a present chronology entry maps to
`false`). Evaluate in this order: reject/return `indeterminate` for grammar
failure; then apply scope preconditions (current change entry, declared
`requirementId`, declared requirement encoded by `requirement:<REQ-ID>`, and
at least one matching batch for batch-key scopes); then apply ownership; then
the code helper. The current-change-entry precondition excludes
`CHANGE_RECORD_MISSING`, for which a present document plus absent entry is the
defining `true` condition. `CHANGE_PHASE_MISSING` maps an absent singular
phase or uncovered aggregate TDD requirement to `true`, and a present singular
phase or complete aggregate coverage to `false`. The
`CHANGE_ORDER_MIGRATION_REQUIRED` `phase:` flavor maps a present
non-integer-order phase to `true`, and an absent or integer-ordered phase to
`false`. `CHANGE_RECORD_MISSING` alone requires its change document to exist;
the other eleven codes evaluate from chronology/TDD/order state even when the
document is absent, preserving existing validator behavior alongside the
separate `CHANGE_DOCUMENT_MISSING` diagnostic. The four bare-`batchKey`
codes (`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`,
`CHANGE_TEST_CHANGED_AFTER_RED`, and
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`) resolve all effective batches
matching the key and return `indeterminate` when none match. When one or more
match, apply `currentRequirementIdsForBatch` to each: return `false` when no
matching batch currently owns any requirement in the scope (or, for
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, when none owns the named
`requirementId`); otherwise return `true` when any currently owned matching
batch's total tests/implementation predicate is true (for that code, only
when the named requirement is currently owned and its helper is true), or
`false` when none are true. The
`CHANGE_ORDER_MIGRATION_REQUIRED` `batch:` flavor also resolves all key
matches but applies no ownership filter. Add
`orderMigrationRequiredBatchItemCondition(batch, phase): boolean`, returning
whether that exact phase item is present with a non-integer order; use it in
both validator emission and the evaluator, while
`orderMigrationRequiredBatchCondition(change, batchPhaseName, key)`
aggregates it across matching batches. The evaluator's batch-scope
precondition handles zero matches as `indeterminate` before calling the
boolean aggregate helper; with at least one match it returns `true` when any
match satisfies the item predicate and `false` otherwise. For
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`, absent or empty
requirement-implementation fingerprints map through the existing total helper
to `false`; the independent upstream `CHANGE_IMPLEMENTATION_SCOPE_MISSING`
diagnostic remains the fail-closed error. A missing change
or undeclared requirement is `indeterminate`. All boolean predicate results
map `true`/`false` directly. Both
`validateChangeEvidence` and `validateChangeCompleteness` call this same
reporting pass and therefore each emit exactly one identically classified
stale diagnostic per authoritative linked stale scope. A non-authoritative
(superseded) record in a group is never itself reported stale or malformed
merely for having been superseded.
Corrective coverage uses one fixture whose condition becomes `false` without
changing its snapshot hash and asserts identical warning classification in
both validators, absence of the resolved target diagnostic, and exactly one
stale diagnostic per validator, both normative `false` remediation
substrings, and no claim that all related debt is resolved; one fixture that appends a later duplicate-key
batch and asserts the prior single-match waiver becomes stale while the target
remains error-severity; and one hash-preservation fixture that proves the
single-match flat snapshot hash remains equal while the false condition alone
makes the waiver stale.
CHANGE-0032 adds hash-drifted `true` and `indeterminate`
`CHANGE_COMPLETENESS_TDD` fixtures that each assert exactly one
error-severity stale diagnostic and the normative remediation substring in
both validators; a document-present before/after fixture that proves canonical
payload/hash byte equality; and a retained document-absent historical-waiver
fixture that proves hash drift and tri-state-classified stale reporting.
`TEST-CHANGE-EVIDENCE-WAIVER-028` covers the shared batch order-migration predicate across absent,
present-with-integer-order, present-with-non-integer-order, zero-match,
single-match, and multi-match fixtures, asserting evaluator/emission parity,
document-present hash stability, historical document-absent hash drift, and
the gate/status report-level single audit entry while gate's validator check
arrays retain their own copies.
It also writes valid waiver evidence with an empty/missing change chronology
that produces at least one authoritative indeterminate stale entry, and proves
full, `--changed`, and `--feature` gate modes expose the same non-empty
change-waiver audit subset as `projectStatus`, while both commands leave
change/TDD/order/waiver evidence byte-identical. The full/`--changed` gate
check arrays retain their validator copies; feature-scoped check arrays follow
REQ-011's feature filter while the top-level subset remains repository-wide.
The all-integer fixture asserts condition `false`, warning severity, and the
`target code is no longer reported`/`replacement waiver is not required`
message substrings. The zero-match fixture asserts `indeterminate`, error
severity, and `cannot be evaluated`; non-integer single/multi-match fixtures
assert `true` exactly when the target diagnostic is emitted. The audit-count
assertion traces to REQ-011's cross-validator/report-level count paragraph.
Separately, replace direct `error(code, message)` calls at the twelve
allow-listed emission sites with a call through
`waivedDiagnostic(waiverContext: WaiverContext, code: WaivableCode, message: string, changeId: string, requirementId: string | undefined, detail: string | undefined): Diagnostic`
(synchronous — like `reportWaiverEvidenceDiagnostics`, it consults only
the precomputed `waiverContext`, never calling `snapshotPayload`/
`waiverLinkage` itself; defined once in `change-waiver.ts`, alongside and reusing `errorFor` from
DES-003): if `waiverContext.loaded` is
non-null, non-malformed, and contains at least one waiver matching
`changeId`/`code`/`requirementId`/`detail` exactly, obtain the index through
the same `authoritativeWaiverIndex(waiverContext, scope)` selector used
above. If it returns `-1`, return the unmodified `errorFor(...)` result at
`severity: 'error'`; otherwise, if
`waiverContext.linkage[index].valid` and
`!isWaiverStale(waiverContext, index)`, return
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
counting, unchanged). `CHANGE_WAIVER_EVIDENCE_MALFORMED` remains
`severity: 'error'`. `CHANGE_WAIVER_STALE` is an error for `true` or
`indeterminate` conditions and an audit warning only for deterministically
resolved (`false`) conditions. Both diagnostics stay in the existing
`change-history`/`change-completeness` diagnostics arrays — no new gate
check, check-name configuration, or release-profile entry is introduced.
`CHANGE_RECORD_MISSING` uses this same waiver-aware path both in the
zero/absent-evidence early return and in the normal document scan.
Interfaces: `type WaiverCondition = 'true' | 'false' | 'indeterminate'`;
`type WaiverScope = { changeId: string; code: WaivableCode; requirementId?: string; detail?: string }`;
`type WaiverContext = { loaded: LoadedChangeWaiverEvidence | null; order: Awaited<ReturnType<typeof inspectEvidenceOrder>>; linkage: Array<{ valid: boolean; reason?: string }>; currentHash: Array<string | undefined>; condition: Array<WaiverCondition | undefined> }`;
`authoritativeWaiverIndex(waiverContext: WaiverContext, scope: WaiverScope): number`
(greatest-order validly linked index, or `-1` when none exists);
`isWaiverStale(waiverContext: WaiverContext, index: number): boolean`
(true when version/hash differs or the current `condition[index]` is `false`,
`indeterminate`, or `undefined`; this is a stateless current-state predicate,
so an exact return to the originally approved snapshot/`true` condition can
make the waiver active again, while invalid linkage is handled separately and
never passed as an active waiver);
`evaluateWaiverCondition(root: string, evidence: ChangeEvidence | null, tdd: TddEvidence | null, order: Awaited<ReturnType<typeof inspectEvidenceOrder>>, scope: WaiverScope): Promise<WaiverCondition>`;
`buildWaiverContext(...)`,
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
documents exist. Must return `indeterminate`, never `false`, when a
code-specific scope tuple cannot be resolved. For every fully evaluable exact scope,
a currently emitted structured target diagnostic must correspond to evaluator
`true`, and evaluator `false` must correspond to no emitted target diagnostic;
`indeterminate` never fabricates the target diagnostic.
`recordChangeWaiver` must accept only evaluator `true`; evaluator `false` or
`indeterminate` rejects without writing evidence. A stored record whose code
cannot narrow to `WaivableCode` is invalidly linked and never evaluated.
`condition[i] === undefined` is fail-closed and maps to error if encountered.
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
taking `root: string` plus an optional precomputed `WaiverContext`; only
when no context is supplied do they perform their own I/O (loading
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
`await inspectEvidenceOrder(root)`, grouping scopes and selecting each
scope's index through DES-004's shared
`authoritativeWaiverIndex(waiverContext, scope)`, then retaining that record
only when the index is not `-1` and non-stale
(`!isWaiverStale(waiverContext, i)`, never a separately reimplemented
staleness check). When a context argument is supplied, use it directly;
otherwise build exactly one context from the loaded evidence before grouping.
Project each retained record
projected to exactly `changeId`, `code`, `requirementId`, `detail` (each
only when present), `approver`, `reason`, `recordedAt` (REQ-012); and
`waiverEvidenceDiagnostics(root, waiverContext?)`, an async wrapper that uses
the supplied context directly, or only when absent loads `evidence`, `tdd`,
`order`, and `loaded` and builds one context, then calls DES-004's synchronous
`reportWaiverEvidenceDiagnostics(waiverContext)` directly,
returning exactly the malformed/stale diagnostics REQ-007/REQ-011 require.
In `runGate`, load change/TDD/order/waiver evidence once to build one
`WaiverContext`, then pass that context to `activeWaivers` and
`waiverEvidenceDiagnostics`; use the latter directly for the report-level
change-waiver subset instead of filtering `changes.diagnostics`, and
concatenate it before `workflowWaiverDiagnostics`. The validators'
diagnostics remain the sole source for the
`change-history` and `change-completeness` check arrays, while
the shared derivation populates only the report-level `waiverDiagnostics`
audit array and is never appended into either check a second time — adding a
`waivers` array and ensuring malformed/stale diagnostics appear on the JSON
report without gate-level duplication.
The exactly-once guarantee applies to `report.waiverDiagnostics`; the two
per-check arrays intentionally retain their respective validator copies so
each validator remains independently blockable.
Because the report-level derivation is independent of
`scopedToFeature`-filtered check arrays, change-level stale diagnostics are
not lost from `gate --feature`'s report-level audit field. Call `activeWaivers(root)` and
`waiverEvidenceDiagnostics(root)` once each from `gate.ts`'s
`projectStatus(root)` with one shared precomputed `WaiverContext` passed to
both helpers (status already has `root` in scope and does not
otherwise run `validateChangeEvidence`/`validateChangeCompleteness`) to
add the identical `waivers` array plus a `waiverDiagnostics` array to
`status --json`'s returned object, satisfying REQ-007's requirement that
malformed waiver evidence is reported via a `status` diagnostic too, not
only `gate`.
Interfaces: No signature change to `validateChangeEvidence`/
`validateChangeCompleteness`; `activeWaivers(root: string, waiverContext?: WaiverContext): Promise<Array<{ changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string }>>`
and `waiverEvidenceDiagnostics(root: string, waiverContext?: WaiverContext): Promise<Diagnostic[]>`, both
exported from `change-waiver.ts`; `GateReport` and `projectStatus`'s
return type both gain an additive `waivers?: Array<{ changeId: string;
code: string; requirementId?: string; detail?: string; approver: string;
reason: string; recordedAt: string }>` field and an additive
`waiverDiagnostics?: Diagnostic[]` field.
For `projectStatus(root)`, load `evidence`/`tdd` and build one
`WaiverContext`, then pass that same context to both helpers through optional
precomputed-context parameters so status performs linkage, snapshot hashing,
and condition evaluation only once.
Constraints: Must not change `valid` semantics for any diagnostic outside
the twelve allow-listed codes. Must exclude stale or malformed waivers,
and every non-authoritative (superseded) record in a scope group, from
the `waivers` array. Must not change `gate.ts`'s existing `featureDir`
(`--feature`) branch behavior.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-006, REQ-CHANGE-EVIDENCE-WAIVER-012, REQ-CHANGE-EVIDENCE-WAIVER-014
ADRs: ADR-0025
