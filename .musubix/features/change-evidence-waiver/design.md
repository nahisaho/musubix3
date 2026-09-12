# Change evidence waiver design

## DES-CHANGE-EVIDENCE-WAIVER-001: Order-log scoping fields and waiver evidence data model
Responsibilities: Extend `EvidenceOrderRecord` (`packages/analysis/src/order.ts`)
with two new optional fields, `code?: string` and `requirementId?: string`
(additive, mirroring the existing `testId?` precedent from
`tdd-cycle-void`). Extend `recordKey(kind, entityId, phase, scope?: { code?: string; requirementId?: string })`
to append `scope.code`/`scope.requirementId` (only each field that is
actually present, never a placeholder `null`/`undefined` element) to the
JSON key array, and update `validateEvidenceOrderLog`'s duplicate check and
both `appendEvidenceOrder`'s and `evidenceOrderRecord`'s signatures to pass
a `scope` object through to `recordKey` — every existing call site (change
phases, TDD batches, `void`) omits `scope` (or passes `scope: {}`) and
therefore computes byte-identical keys to today, so no existing record's
dedup behavior changes. This lets a waiver order record use the literal
`phase: 'waiver'` (matching REQ-CHANGE-EVIDENCE-WAIVER-005's exact wording)
while still being uniquely keyed per `changeId`/`code`/`requirementId`,
since `entityId` (the `changeId`) alone is not unique across the many
codes/requirements one change can waive.
Add `ChangeWaiverRecord` (`changeId`, `code`, `requirementId?`, `approver`,
`reason`, `recordedAt`, `snapshotVersion`, `snapshotHash`, `order`,
`previousSha256`, `payloadSha256`) and `ChangeWaiverEvidence`
(`{ schemaVersion: 1; waivers: ChangeWaiverRecord[] }`) types in a new
`packages/analysis/src/change-waiver.ts`. Implement
`WAIVABLE_CODES = ['CHANGE_REQUIREMENTS_UNCHANGED', 'CHANGE_DESIGN_UNCHANGED', 'CHANGE_RED_UNPROVEN', 'CHANGE_GREEN_UNPROVEN', 'CHANGE_COMPLETENESS_TDD'] as const`
and its derived type `type WaivableCode = typeof WAIVABLE_CODES[number]`,
both exported from `change-waiver.ts`, plus
`CHANGE_LEVEL_CODES = new Set(['CHANGE_REQUIREMENTS_UNCHANGED', 'CHANGE_DESIGN_UNCHANGED'])`
(REQ-001, REQ-004). CLI input for `<CODE>` remains a plain `string`
until validated against `WAIVABLE_CODES` (e.g. via
`(WAIVABLE_CODES as readonly string[]).includes(code)`), at which point it
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
`recordChangeWaiver(root, changeId, code, requirementId, approver, reason): Promise<{ recorded: boolean; changeId: string; code: string; requirementId?: string }>`:
call `loadChangeWaiverEvidence(root)`; when the result is `null` (file
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
same function — `waiverLinkage(evidence, order, waivers, i).valid`; if
any existing record fails any of these three checks, reject immediately
with no evidence written or modified, exactly as in the malformed-file
case above (this is the same shape/chain/linkage validation DES-004's
`reportWaiverEvidenceDiagnostics` independently performs on every read
path, so `recordChangeWaiver` never appends a new, valid-looking record
onto a chain that already contains an invalid one). Only once the whole
existing chain passes does `recordChangeWaiver` proceed with its existing
`waivers` array. Once past that check, reject
with no evidence written when: `code` is not in `WAIVABLE_CODES` (REQ-001);
`requirementId` presence does not match `CHANGE_LEVEL_CODES.has(code)`
(REQ-004); `approver`/`reason` are empty/whitespace-only (REQ-003;
`--confirm` is enforced at the CLI layer, matching `tdd void`); re-running
`validateChangeEvidence`/`validateChangeCompleteness` (this function calls
both, reusing their existing exported public APIs — whose internal
behavior is itself being extended by DES-004, so this call sees any
already-recorded waivers' effects too) does not
currently report a diagnostic with this exact `changeId`/`code`/
`requirementId` structured target (added by DES-003) (REQ-002); or an
existing waiver record for the identical `changeId`/`code`/`requirementId`
is validly linked (DES-002) and non-stale (DES-002's version+hash
predicate) (REQ-010). Only once
every check passes: set `snapshotVersion` to `CURRENT_SNAPSHOT_VERSION`
and compute `snapshotPayload(...)` (DES-002) and its hash as
`snapshotHash`, call
`appendEvidenceOrder(root, { kind: 'change', entityId: changeId, phase: 'waiver', code, requirementId })`
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
`WAIVABLE_CODES`, `WaivableCode`, `errorFor`, and the rest) is reachable
the same way `packages/cli/src/main.ts` already imports every other
analysis API — from that one barrel, per its existing import block, never
via a direct `./change-waiver.js` path. Add `change waiver record <CHANGE-ID> <CODE>
[--requirement <REQ-ID>] --reason <text> --approver <name> --confirm` to
`packages/cli/src/main.ts`, wired like `tdd void`: missing `--confirm`
rejects before calling `recordChangeWaiver`; the result is printed and a
nonzero exit code is set on rejection.
Interfaces: `recordChangeWaiver(root: string, changeId: string, code: string, requirementId: string | undefined, approver: string, reason: string): Promise<{ recorded: boolean; changeId: string; code: string; requirementId?: string }>`;
`ChangeWaiverRecord`/`ChangeWaiverEvidence`/`LoadedChangeWaiverEvidence`/
`loadChangeWaiverEvidence` as above; `EvidenceOrderRecord` gains `code?:
string; requirementId?: string`; `recordKey`/`evidenceOrderRecord` each
gain one new trailing parameter,
`scope?: { code?: string; requirementId?: string }` — never two bare
positional `code?`/`requirementId?` parameters, so a caller cannot
accidentally pass one without the other and so `recordKey` has a single
place to decide inclusion. `appendEvidenceOrder` keeps its existing
two-argument shape (`root`, `input`) and receives scope values only
through its extended `input` object type,
`Pick<EvidenceOrderRecord, 'kind' | 'entityId' | 'phase'> & Partial<Pick<EvidenceOrderRecord, 'testId' | 'code' | 'requirementId'>>`
— it never takes a separate third `scope` argument — and internally
forwards `{ code: input.code, requirementId:
input.requirementId }` as `recordKey`'s new `scope` argument.
`recordKey(kind, entityId, phase, scope?)` appends `scope.code` to its key
array only when `scope?.code !== undefined`, and likewise for
`scope?.requirementId`, each appended independently (a change-level code
has `requirementId` absent while `code` is present) — critically, it never
appends a placeholder `null`/`undefined` array element for an absent
field, so every existing call site (which passes no `scope` argument, or
passes `scope: {}`) computes a key array of the same length and same
values as today, and only a waiver's specific `scope` values change the
key. CLI: `change waiver record <CHANGE-ID> <CODE> [--requirement
<REQ-ID>] --reason <text> --approver <name> --confirm`.
Constraints: Never mutate or remove any existing waiver record, order
record, or change/TDD evidence file. Never write partial evidence on any
rejection path — every check runs before `appendEvidenceOrder` or any
`change-waivers.json` write. Existing calls to `appendEvidenceOrder`/
`evidenceOrderRecord` that omit `code`/`requirementId` must keep producing
identical keys/behavior to today. A newly recorded waiver's `snapshotHash`
must equal the value DES-004 would independently recompute immediately
afterward, so it starts non-stale.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-001, REQ-CHANGE-EVIDENCE-WAIVER-002, REQ-CHANGE-EVIDENCE-WAIVER-003, REQ-CHANGE-EVIDENCE-WAIVER-004, REQ-CHANGE-EVIDENCE-WAIVER-005, REQ-CHANGE-EVIDENCE-WAIVER-010, REQ-CHANGE-EVIDENCE-WAIVER-015
ADRs: ADR-0025

## DES-CHANGE-EVIDENCE-WAIVER-002: Snapshot payload definition and waiver linkage validation
Responsibilities: Implement
`snapshotPayload(evidence: ChangeEvidence, tdd: TddEvidence | null, changeId: string, code: WaivableCode, requirementId?: string): unknown | null`
returning `null` only when `changeId` names no change in `evidence.changes`
(a code can otherwise always be snapshotted whenever it can be emitted).
For `CHANGE_REQUIREMENTS_UNCHANGED`: `{ impactRequirements: impact?.fingerprints.requirements ?? null, requirementsRequirements: requirements?.fingerprints.requirements ?? null, allowUnchanged: requirements?.allowUnchanged ?? null }`.
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
incorrectly stale an otherwise-untouched waiver. Then
`digest(canonicalJson(snapshotPayload(...)))`
combined with `CURRENT_SNAPSHOT_VERSION` is the snapshot identity used by
both DES-001 (at recording time) and DES-004 (at validation time) — the
two call sites never diverge because both call this one function and
compare against the same `CURRENT_SNAPSHOT_VERSION` constant. A waiver is
non-stale only when **both**
`record.snapshotVersion === CURRENT_SNAPSHOT_VERSION` **and**
`record.snapshotHash === digest(canonicalJson(snapshotPayload(...)))`
hold; a future incompatible change to any code's payload definition
increments `CURRENT_SNAPSHOT_VERSION`, which alone makes every
previously recorded waiver stale (REQ-011's version-bump acceptance
criterion) regardless of whether its stored hash still happens to match
the newly shaped payload.
Implement `loadChangeWaiverEvidence`'s companion validators:
`waiverRecordShapeValid(record: unknown): record is ChangeWaiverRecord`
checking every field's type explicitly (`changeId`/`code`/`approver`/
`reason`/`recordedAt` are non-empty strings, `requirementId` is a non-empty
string or absent, `snapshotVersion`/`order` are positive integers,
`snapshotHash`/`payloadSha256` match `/^[a-f0-9]{64}$/i`, `previousSha256`
matches the same pattern or, for the first record, equals `'0'.repeat(64)`);
`waiverChainValid(waivers, index)` checking
`waivers[index].previousSha256 === (index === 0 ? '0'.repeat(64) : waivers[index - 1].payloadSha256)`
and that `waivers[index].payloadSha256` equals the recomputed hash from
DES-001's exact destructure-omit rule. Implement
`waiverLinkage(evidence: ChangeEvidence | null, order: Awaited<ReturnType<typeof inspectEvidenceOrder>>, waivers: ChangeWaiverRecord[], index: number): { valid: boolean; reason?: string }`
requiring, beyond shape and chain validity: `evidence !== null`;
`record.code` is in
`WAIVABLE_CODES`; `record.requirementId` presence matches
`CHANGE_LEVEL_CODES.has(record.code)`; `evidence.changes.some((c) => c.changeId === record.changeId && (record.requirementId === undefined || c.requirementIds.includes(record.requirementId)))`;
`order.valid === true` for the whole log; and exactly one
`order.records` entry exists via
`evidenceOrderRecord(order.records, 'change', record.changeId, 'waiver', { code: record.code, requirementId: record.requirementId })`
(DES-001's extended lookup, using the same `scope` object shape as
`recordKey`) whose `sequence` equals `record.order`. Any
failing condition returns `{ valid: false, reason: <specific failing
condition> }`.
Interfaces: `snapshotPayload(...)`, `waiverRecordShapeValid(...)`,
`waiverChainValid(...)`, `waiverLinkage(...)` exported from
`change-waiver.ts`.
Constraints: Must never report `valid: true` for a record failing any
shape, chain, allow-list, granularity, change/requirement-existence, or
order-linkage condition. Must use the exact same `snapshotPayload(...)`
function at recording time and validation time — never two independently
maintained implementations.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-006, REQ-CHANGE-EVIDENCE-WAIVER-007, REQ-CHANGE-EVIDENCE-WAIVER-011
ADRs: ADR-0025

## DES-CHANGE-EVIDENCE-WAIVER-003: Structured `changeId`/`requirementId`/`waiver` diagnostic fields
Responsibilities: Add optional `changeId?: string`, `requirementId?:
string`, and `waiver?: { approver: string; reason: string; recordedAt:
string }` fields to the shared `Diagnostic` interface in
`packages/domain/src/types.ts` (additive; every existing `Diagnostic`
producer and consumer — including JSON serialization, `gate`'s console
printer, and other snapshot/golden tests — is unaffected, since all three
fields are optional and no existing code path sets them). In
`validateChangeEvidence` (`packages/analysis/src/change.ts`), attach
`changeId: change.changeId` at the `CHANGE_REQUIREMENTS_UNCHANGED`/
`CHANGE_DESIGN_UNCHANGED` emission sites and `changeId: change.changeId,
requirementId` at the `CHANGE_RED_UNPROVEN`/`CHANGE_GREEN_UNPROVEN`
emission sites, via an `errorFor(code, message, target)` wrapper around
the existing `error(...)` helper that spreads `target` onto the returned
diagnostic. Apply the identical wrapper to `CHANGE_COMPLETENESS_TDD` in
`validateChangeCompleteness`. `errorFor` is defined once, exported from
`change-waiver.ts` (not duplicated per module), so DES-004's
`waivedDiagnostic`/`reportWaiverEvidenceDiagnostics` — which also live in
`change-waiver.ts` — can call it directly without crossing a module
boundary; `change.ts` imports it alongside the other `change-waiver.ts`
exports. No other diagnostic code gains these fields.
Interfaces: `Diagnostic` gains `changeId?: string; requirementId?: string;
waiver?: { approver: string; reason: string; recordedAt: string }`.
`errorFor(code: string, message: string, target: { changeId: string;
requirementId?: string }): Diagnostic`, exported from `change-waiver.ts`,
used only at the five allow-listed emission sites (directly by
`change.ts`, and internally by `waivedDiagnostic`).
Constraints: Must not add `changeId`/`requirementId` to any diagnostic
code outside the five allow-listed codes. Must not change any diagnostic's
`code`, `message`, `path`, or `line` values.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-013
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
Immediately after both loads, each function computes, once per invocation
(still before the early return, so waiver-evidence reporting never
depends on any change document existing), a shared `waiverContext`:
`{ loaded: await loadChangeWaiverEvidence(root), order: await inspectEvidenceOrder(root) }`
(`inspectEvidenceOrder` is the existing exported async function already
used elsewhere in `change.ts` to load and validate `order.json` in one
call — no new order-log validation logic is introduced; `order` has type
`Awaited<ReturnType<typeof inspectEvidenceOrder>>`, the same
already-validated structure `change.ts` uses today). Immediately compute
`const waiverDiagnostics = reportWaiverEvidenceDiagnostics(waiverContext, evidence, tdd)`
using this same, already-relocated `tdd` value (never a second,
separately timed load) and, on both the early-return path and the normal
path, append
`waiverDiagnostics` to the returned `diagnostics` array before computing
`valid` (so a malformed/stale/invalid waiver file is reported even when
there are zero change documents at all, resolving the prior early-return
bypass). `reportWaiverEvidenceDiagnostics(waiverContext, evidence: ChangeEvidence | null, tdd): Diagnostic[]`
is synchronous (all I/O already happened via `waiverContext`): if
`waiverContext.loaded === null`, return `[]` (no file, nothing to report);
if `waiverContext.loaded.malformed`, return exactly one
`CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic naming the file and stop;
otherwise, for each waiver failing
`waiverLinkage(evidence, waiverContext.order, waiverContext.loaded.waivers, index)`
(which is `false` for every waiver whenever `evidence === null`, since
`waiverLinkage` requires non-null evidence — this is exactly the case
where the calling validator's own early return fires, so every recorded
waiver is correctly reported malformed/unlinked rather than silently
skipped), push one `CHANGE_WAIVER_EVIDENCE_MALFORMED` diagnostic naming its
`changeId`/`code`/`requirementId` and the specific failure reason
(REQ-007); for each remaining, validly linked waiver that is stale per
DES-002's non-stale predicate (`snapshotVersion` mismatch or recomputed
hash mismatch), push one `CHANGE_WAIVER_STALE` diagnostic naming its
`changeId`/`code`/`requirementId` (REQ-011) — this pass runs independent
of whether the original target diagnostic still fires, so a stale waiver
is always reported even after its underlying condition is separately
resolved, and never fabricates a resolved
`CHANGE_*`/`CHANGE_COMPLETENESS_*` diagnostic on its own.
Separately, replace direct `error(code, message)` calls at the five
allow-listed emission sites (which only run on the normal, non-early-return
path, since they require an existing change, so `evidence` is always
non-null at these call sites) with a call through
`waivedDiagnostic(waiverContext: WaiverContext, evidence: ChangeEvidence, tdd: TddEvidence | null, code: WaivableCode, message: string, changeId: string, requirementId: string | undefined): Diagnostic`
(defined once in `change-waiver.ts`, alongside and reusing `errorFor` from
DES-003): if `waiverContext.loaded` is
non-null, non-malformed, and contains a waiver at some `index` matching
`changeId`/`code`/`requirementId` exactly for which
`waiverLinkage(evidence, waiverContext.order, waiverContext.loaded.waivers, index).valid`
and DES-002's non-stale predicate both hold, return
`{ ...errorFor(code, message, { changeId, requirementId }), severity: 'warning', waiver: { approver, reason, recordedAt } }`;
otherwise return the unmodified `errorFor(code, message, { changeId,
requirementId })` at `severity: 'error'` (REQ-008, REQ-009). Because this
runs *inline*, at the exact point each diagnostic would otherwise be
pushed, `validateChangeCompleteness`'s existing
`checks.every(([present]) => present)`-style completeness accounting is
changed to also treat a `CHANGE_COMPLETENESS_TDD` check as satisfied
(counted toward `completeRequirements`) when `waivedDiagnostic(...)` for it
returns `severity: 'warning'`, resolving the current code's
"`hasTdd` false ⇒ never counted, regardless of downstream severity"
problem structurally, not via post-hoc reinterpretation of an
already-built diagnostics array (REQ-014's completeness half). Both new
diagnostic codes are `severity: 'error'`, added to the existing
`change-history`/`change-completeness` diagnostics arrays — no new gate
check, check-name configuration, or release-profile entry is introduced;
`CHANGE_WAIVER_EVIDENCE_MALFORMED`/`CHANGE_WAIVER_STALE` already block
release approval simply by being error-severity members of the
pre-existing required `change-history` check's diagnostics.
Interfaces: `type WaiverContext = { loaded: LoadedChangeWaiverEvidence | null; order: Awaited<ReturnType<typeof inspectEvidenceOrder>> }`;
`waivedDiagnostic(...)` and `reportWaiverEvidenceDiagnostics(...)` as
above, both exported from `change-waiver.ts` and both synchronous (the one
`await loadChangeWaiverEvidence`/`await inspectEvidenceOrder` pair per
validator invocation lives only in `change.ts`, computed once into
`waiverContext` and threaded through every call site, so no emission site
or final pass performs its own I/O or repeats order-log validation).
Constraints: Must never downgrade a diagnostic whose code is outside the
five-code allow-list. Must never downgrade based on a waiver whose
`changeId`/`code`/`requirementId` does not exactly match. Must recompute
staleness fresh from `waiverContext` on every call rather than caching
across invocations. Must not change `completeRequirements`'s counting for
any check other than `CHANGE_COMPLETENESS_TDD` under an active, non-stale
waiver. Must report waiver-evidence-file diagnostics (`malformed`/invalid
linkage/stale) on every return path of both validators, including the
existing early-return path taken when no change documents exist.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-007, REQ-CHANGE-EVIDENCE-WAIVER-008, REQ-CHANGE-EVIDENCE-WAIVER-009, REQ-CHANGE-EVIDENCE-WAIVER-011, REQ-CHANGE-EVIDENCE-WAIVER-014
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
`activeWaivers(root): Promise<Array<{ changeId: string; code: string; requirementId?: string; approver: string; reason: string; recordedAt: string }>>`,
computing exactly the
`(await loadChangeWaiverEvidence(root))` (return `[]` immediately when
`null` or `malformed`) combined with `await loadChangeEvidence(root)`,
`await loadTddEvidence(root)`, and
`await inspectEvidenceOrder(root)`, filtered to those waivers passing
`waiverLinkage(evidence, order, loaded.waivers, index)`
(DES-002) and satisfying DES-002's non-stale predicate evaluated against
that same loaded `tdd` (`snapshotVersion === CURRENT_SNAPSHOT_VERSION` and
`snapshotHash === digest(canonicalJson(snapshotPayload(evidence, tdd, changeId, code, requirementId)))`
recomputed fresh — the identical `snapshotPayload(...)` call DES-002 and
DES-004 use, never a separately reimplemented staleness check), each
projected to exactly `changeId`, `code`, `requirementId`
(when present), `approver`, `reason`, `recordedAt` (REQ-012); and
`waiverEvidenceDiagnostics(root): Promise<Diagnostic[]>`, an async wrapper
with the identical load set (`evidence`, `tdd`, `order`, `loaded`) that
calls DES-004's synchronous
`reportWaiverEvidenceDiagnostics(waiverContext, evidence, tdd)` (with
`waiverContext = { loaded, order }` and `tdd` as the same freshly loaded
`TddEvidence | null` value) directly, returning exactly the malformed/stale
diagnostics REQ-007/REQ-011 require (REQ-CHANGE-EVIDENCE-WAIVER-007's
"gate/status diagnostic" wording is satisfied by calling this same helper
from both places, not only from `gate`'s validators — and because both
helpers load `evidence`/`tdd`/`order` identically and both delegate to
DES-002/DES-004's shared logic, `gate`'s validators, `activeWaivers`, and
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
`validateChangeCompleteness`; `activeWaivers(root: string): Promise<Array<{ changeId: string; code: string; requirementId?: string; approver: string; reason: string; recordedAt: string }>>`
and `waiverEvidenceDiagnostics(root: string): Promise<Diagnostic[]>`, both
exported from `change-waiver.ts`; `GateReport` and `projectStatus`'s
return type both gain an additive `waivers?: Array<{ changeId: string;
code: string; requirementId?: string; approver: string; reason: string;
recordedAt: string }>` field and an additive `waiverDiagnostics?:
Diagnostic[]` field.
Constraints: Must not change `valid` semantics for any diagnostic outside
the five allow-listed codes. Must exclude stale or malformed waivers from
the `waivers` array. Must not change `gate.ts`'s existing `featureDir`
(`--feature`) branch behavior.
Requirements: REQ-CHANGE-EVIDENCE-WAIVER-012, REQ-CHANGE-EVIDENCE-WAIVER-014
ADRs: ADR-0025
