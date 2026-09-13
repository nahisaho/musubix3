# Workflow evidence waiver design

This design extends the audited waiver pattern shipped for
`change-evidence-waiver` (`packages/analysis/src/change-waiver.ts`,
ADR-0025) to the `workflow` check, per ADR-0026. It adds a new, parallel
module (`packages/analysis/src/workflow-waiver.ts`) rather than extending
`change-waiver.ts` directly, because the scope key
(`skill`/`phase`/`declarationRecordedAt`/`index`), snapshot payload
(declaration fields plus `workflowEvidenceHead(workflow)`), and linkage
source (`.musubix/evidence/workflow.json`'s declaration events, not
`changes.json`/`tdd.json`) are structurally different from
`change-evidence-waiver`'s domain — see ADR-0026's "Rejected alternatives"
for why a parallel module was chosen over a single generalized one. Only
the domain-independent primitives (`canonicalJson`, the append-only
hash-chain shape, and the authoritative-record-by-`sequence` supersession
rule) are structurally mirrored, not reused by import, since
`change-waiver.ts`'s own `canonicalJson` is already generic and is reused
verbatim by REQ-WORKFLOW-EVIDENCE-WAIVER-013 (imported, not reimplemented).

## DES-WORKFLOW-EVIDENCE-WAIVER-001: Waivable-code allow-list and evidence data model
Responsibilities: In the new module `packages/analysis/src/workflow-waiver.ts`,
declare `WORKFLOW_WAIVABLE_CODES = ['WORKFLOW_SKILL_NOT_INVOKED',
'WORKFLOW_INVOCATION_ORDER', 'WORKFLOW_INVOCATION_INCOMPLETE',
'WORKFLOW_INVOCATION_FAILED', 'WORKFLOW_INVOCATION_REUSED'] as const` (the
five REQ-WORKFLOW-EVIDENCE-WAIVER-001 allow-listed codes; the
`WORKFLOW_INVOCATION_REUSED` entry here always denotes the
declaration-scoped flavor — the tool-call-scoped flavor is never present
in this set and is rejected by name at the CLI/record layer per
DES-WORKFLOW-EVIDENCE-WAIVER-006) and its derived
`type WorkflowWaivableCode = typeof WORKFLOW_WAIVABLE_CODES[number]`, both
exported. Declare `export const CURRENT_SNAPSHOT_VERSION = 1`. Declare
`export interface WorkflowWaiverRecord { skill: string; phase: string;
declarationRecordedAt: string; index?: number; code: WorkflowWaivableCode;
approver: string; reason: string; waiverRecordedAt: string; sequence:
number; snapshotVersion: number; snapshotHash: string; previousSha256:
string; payloadSha256: string }` and `export interface
WorkflowWaiverEvidence { schemaVersion: 1; waivers: WorkflowWaiverRecord[] }`,
implementing REQ-WORKFLOW-EVIDENCE-WAIVER-013's schema exactly (`index`
present only when required by REQ-WORKFLOW-EVIDENCE-WAIVER-005's collision
rule; no other properties). Re-export `canonicalJson` from
`packages/analysis/src/change-waiver.ts` (imported, never reimplemented,
per REQ-WORKFLOW-EVIDENCE-WAIVER-013's explicit reuse requirement) as this
module's canonicalization primitive; do not import the differently
behaved private `canonical` function already defined in `workflow.ts`.
Interfaces: `WORKFLOW_WAIVABLE_CODES: readonly WorkflowWaivableCode[]`;
`type WorkflowWaivableCode`; `WorkflowWaiverRecord`; `WorkflowWaiverEvidence`;
`CURRENT_SNAPSHOT_VERSION: number`.
Constraints: `WORKFLOW_WAIVABLE_CODES` must contain exactly the five
allow-listed codes, in this fixed order, and no others; the module must
never export a set that includes `WORKFLOW_BINDING_MISSING` or either
flavor of a code not on this list as directly waivable.
This component also extends `packages/domain/src/types.ts`'s
`Diagnostic` interface (currently `{ code, severity, message, path?,
line?, changeId?, requirementId?, detail?, waiver?: { approver, reason,
recordedAt } }`) with four new optional fields required by
REQ-WORKFLOW-EVIDENCE-WAIVER-016: `skill?: string; phase?: string;
declarationRecordedAt?: string; index?: number` — additive only, no
existing field renamed or removed, so every existing `Diagnostic` producer
and consumer (`change.ts`, `change-waiver.ts`, `tdd.ts`, etc.) continues to
compile and behave identically. The existing `waiver?: { approver: string;
reason: string; recordedAt: string }` shape gains one additional optional
field, `waiverRecordedAt?: string`, populated only by workflow-waiver
diagnostics (every other existing producer — `change.ts`, `change-waiver.ts`,
`tdd.ts` — continues to omit it, which is valid since it is optional; no
existing consumer reads a field it did not already read, so this remains
a purely additive, non-breaking widening): a workflow waiver's own
persisted `waiverRecordedAt` field value is copied into *both* this
object's pre-existing `recordedAt` key *and* the new `waiverRecordedAt`
key at diagnostic-emission time (DES-WORKFLOW-EVIDENCE-WAIVER-005), so the
same value is available under either spelling — only the persisted
`WorkflowWaiverRecord` (this component) and the in-memory `Diagnostic`
(existing, extended only with the four scope fields above plus this one
`waiver.waiverRecordedAt` field) ever exist.
This resolves an apparent naming tension in
REQ-WORKFLOW-EVIDENCE-WAIVER-009's prose, which describes the emitted
`waiver` object as "containing the `approver`, `reason`, and
`waiverRecordedAt` of that authoritative waiver record": rather than
relying solely on an argument that this phrase names a source field
rather than a mandated key spelling (a reading an acceptance test could
reasonably reject), the emitted object is widened to expose the value
under the literal `waiverRecordedAt` key as well, so REQ-009's Acceptance
criterion is satisfied both by a test that checks for a `waiverRecordedAt`
key and by a test that continues to check the existing `recordedAt` key
that every other `Diagnostic.waiver` producer in the codebase already uses.
Finally, this component adds `export * from './workflow-waiver.js';` to
`packages/analysis/src/index.ts`'s existing barrel (alongside its current
`export * from './change-waiver.js';` entry), so
`packages/cli/src/main.ts`'s existing `from '../../analysis/src/index.js'`
import can resolve `recordWorkflowWaiver` (DES-006) without a separate
deep import path.
Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-001, REQ-WORKFLOW-EVIDENCE-WAIVER-005, REQ-WORKFLOW-EVIDENCE-WAIVER-013, REQ-WORKFLOW-EVIDENCE-WAIVER-016
ADRs: ADR-0026

## DES-WORKFLOW-EVIDENCE-WAIVER-002: Evidence loading, shape, and chain validation
Responsibilities: Implement `export type LoadedWorkflowWaiverEvidence =
{ schemaVersion: 1; waivers: unknown[]; malformed: false } |
{ schemaVersion: 1; waivers: []; malformed: true }` — note `waivers` holds
the **raw, not-yet-shape-validated** parsed array elements whenever
`malformed` is `false`; a document whose `schemaVersion`/top-level shape
is wrong, or whose `waivers` property is not itself an array, is the only
case that sets `malformed: true` (REQ-WORKFLOW-EVIDENCE-WAIVER-008's
whole-document malformation case) — an individual element's own shape
being invalid (including `null`, a scalar, or an object missing/misuting
required fields) never does, since REQ-008 requires exactly that case to
be reported per-element, not as a whole-document failure; that per-element
check is `waiverRecordShapeValid` below, always applied one element at a
time by its callers, never by `loadWorkflowWaiverEvidence` itself. Implement `export async
function loadWorkflowWaiverEvidence(root: string):
Promise<LoadedWorkflowWaiverEvidence | null>` reading
`.musubix/evidence/workflow-waivers.json`: return `null` when the file is
absent (REQ-WORKFLOW-EVIDENCE-WAIVER-006's fresh-genesis case); wrap
`JSON.parse`/shape checking in `try`/`catch` and return `{ schemaVersion:
1, waivers: [], malformed: true }` on any parse failure, a non-object
top-level value, a `schemaVersion` other than `1`, or a `waivers` property
that is not itself an array (REQ-WORKFLOW-EVIDENCE-WAIVER-008's
whole-document malformation case) — otherwise return `{ schemaVersion: 1,
waivers: <the parsed array, elements unvalidated>, malformed: false }`,
mirroring `loadChangeWaiverEvidence`'s exact control flow. Implement
`export function waiverRecordShapeValid(record: unknown): record is
WorkflowWaiverRecord` checking every REQ-WORKFLOW-EVIDENCE-WAIVER-013 field
constraint: non-empty-string `skill`/`phase`/`approver`/`reason`;
`declarationRecordedAt`/`waiverRecordedAt` each matching
`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/` and satisfying `new
Date(value).toISOString() === value`; `code` a member of
`WORKFLOW_WAIVABLE_CODES`; `index`, when present, a nonnegative integer
(absent is valid; `null` is not); `sequence`/`snapshotVersion` positive
integers; `snapshotHash`/`previousSha256`/`payloadSha256` each a
64-character lowercase hex string (`previousSha256` may additionally equal
the 64-`"0"` genesis value); no property outside this exact field set
(REQ-WORKFLOW-EVIDENCE-WAIVER-013's closed-schema rule — reject an object
carrying any additional key). Implement `export function
waiverChainValid(waivers: unknown[], index: number): boolean` mirroring
`change-waiver.ts`'s `waiverChainValid` exactly (that function likewise
never independently re-validates its predecessor's own shape — it only
reads the predecessor's stored `payloadSha256`/`sequence` fields
directly): first requiring `waiverRecordShapeValid(waivers[index])` (only
the record at `index` itself, so its own `previousSha256`/`sequence`/
`payloadSha256` can be safely read); then, treating `waivers[index - 1]`
as a plain, untyped value for field access only (never itself
shape-validated — an invalid or missing predecessor simply yields
`undefined` for these lookups, which can never equal a well-typed
`WorkflowWaiverRecord`'s own hex-string `previousSha256` or positive-
integer `sequence`, so chain validity still correctly fails without an
explicit predecessor shape check, exactly reproducing the precedent's
behavior rather than adding a new, asymmetric requirement), recompute
`payloadSha256` as `digest(canonicalJson({
...waivers[index], payloadSha256: undefined }))` (via a local
`payloadShaOf` helper that destructures out `payloadSha256` before
hashing) and compare, and verify `previousSha256` equals the genesis
value for `index === 0` or `(waivers[index - 1] as any)?.payloadSha256`
otherwise, and that `sequence` equals `1` for `index ===
0` or one greater than `(waivers[index - 1] as any)?.sequence` otherwise.
Interfaces: `LoadedWorkflowWaiverEvidence`;
`loadWorkflowWaiverEvidence(root: string): Promise<LoadedWorkflowWaiverEvidence | null>`;
`waiverRecordShapeValid(record: unknown): record is WorkflowWaiverRecord`;
`waiverChainValid(waivers: unknown[], index: number): boolean`.
Constraints: Must never throw out of `loadWorkflowWaiverEvidence` for a
malformed file; every malformation must resolve to the `malformed: true`
discriminant so callers can convert it into
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED` rather than crashing `gate`/`status`.
Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-006, REQ-WORKFLOW-EVIDENCE-WAIVER-008, REQ-WORKFLOW-EVIDENCE-WAIVER-013, REQ-WORKFLOW-EVIDENCE-WAIVER-017
ADRs: ADR-0026


## DES-WORKFLOW-EVIDENCE-WAIVER-003: Linkage resolution and authoritative-record selection
Responsibilities: Implement `export function waiverLinkage(workflow:
WorkflowManifest | null, waivers: unknown[], index: number):
{ valid: boolean; reason?: string }` (synchronous — no I/O; `workflow`,
loaded once by the caller, is the only external input) implementing
REQ-WORKFLOW-EVIDENCE-WAIVER-007's branching resolution rule exactly:
reject (with a reason) a record whose own shape or chain fails
DES-WORKFLOW-EVIDENCE-WAIVER-002's checks first (`waiverRecordShapeValid(waivers[index])`
and `waiverChainValid(waivers, index)`, both operating on the raw,
unvalidated element — only once both pass is `waivers[index]` treated as
a `WorkflowWaiverRecord` for the remainder of this function); otherwise find every
`status: "completed"` event in `workflow?.events ?? []` whose own
`skill`/`phase`/`recordedAt` equal the record's
`skill`/`phase`/`declarationRecordedAt`; when the record's `index` is
absent, require exactly one such event (the resolved event) and reject
(zero or two-or-more matches) otherwise; when `index` is present, require
two-or-more such events and that `index` equal one of their own zero-based
positions in `workflow.events` (the event at that position is the
resolved event), rejecting otherwise (including one match with `index`
present, or an `index` naming a non-matching or non-colliding position).
Linkage validity depends only on the record's own fields and `workflow`
(REQ-007's independence-from-other-records rule) — never on any other
waiver record's staleness or validity. Implement `function resolveEvent(
workflow: WorkflowManifest | null, skill: string, phase: string,
declarationRecordedAt: string, index: number | undefined):
WorkflowEvent | undefined` as the shared helper computing "the resolved
event" per the identical rule above, used by both `waiverLinkage` and
DES-WORKFLOW-EVIDENCE-WAIVER-004's `snapshotPayload`, so the two can never
diverge on which event a scope names. Implement `function scopeKey(
skill: string, phase: string, declarationRecordedAt: string, index:
number | undefined): string` as `JSON.stringify([skill, phase,
declarationRecordedAt, index ?? null])`, the grouping key used by
DES-WORKFLOW-EVIDENCE-WAIVER-005/006/007.
Implement `export interface WorkflowWaiverContext { loaded:
LoadedWorkflowWaiverEvidence | null; workflow: WorkflowManifest | null;
linkage: Array<{ valid: boolean; reason?: string }>; currentHash:
Array<string | undefined> }` and `export function
buildWorkflowWaiverContext(loaded: LoadedWorkflowWaiverEvidence | null,
workflow: WorkflowManifest | null, rawDiagnostics: Diagnostic[]):
WorkflowWaiverContext` — synchronous and pure, taking the already-loaded
evidence and the **complete set of raw, not-yet-waiver-transformed,
structured diagnostics** for the current `validateWorkflow` run (see
DES-WORKFLOW-EVIDENCE-WAIVER-005's two-phase pipeline, which is what
guarantees this set is complete and available before context-building
happens, resolving the evaluation-order problem a single-pass design
would otherwise have): when `loaded` is present and not malformed,
compute `linkage[i]` via `waiverLinkage(workflow, loaded.waivers, i)` and,
for each valid entry (whose element is therefore already confirmed to be
a `WorkflowWaiverRecord` by `waiverLinkage`'s own shape/chain check),
`currentHash[i]` via
DES-WORKFLOW-EVIDENCE-WAIVER-004's `snapshotHashFor(workflow,
rawDiagnostics, loaded.waivers[i] as WorkflowWaiverRecord)` (else
`undefined`) — this is the sole
precomputation, so every later function (`waivedWorkflowDiagnostic`,
`reportWorkflowWaiverEvidenceDiagnostics`) reads only these already-resolved
arrays, mirroring `change-waiver.ts`'s `buildWaiverContext` in spirit
(there, async because it must itself load change/TDD evidence; here,
synchronous because loading is already the caller's job — see
DES-WORKFLOW-EVIDENCE-WAIVER-005/007 for the two call sites that perform
that loading). Implement `function authoritativeIndex(context:
WorkflowWaiverContext, skill: string, phase: string, declarationRecordedAt:
string, index: number | undefined): number` returning the greatest-`sequence`
validly-linked record index sharing `scopeKey(skill, phase,
declarationRecordedAt, index)`, or `-1` if none — the sole selector
consulted by every staleness/downgrade/duplicate-rejection/visibility rule
per REQ-WORKFLOW-EVIDENCE-WAIVER-007's authoritative-record definition; a
non-authoritative validly-linked record is never independently
re-evaluated by any other function in this module.
Interfaces: `waiverLinkage(workflow, waivers, index)`;
`resolveEvent(workflow, skill, phase, declarationRecordedAt, index)`;
`scopeKey(skill, phase, declarationRecordedAt, index)`;
`WorkflowWaiverContext`; `buildWorkflowWaiverContext(loaded, workflow, rawDiagnostics)`;
`authoritativeIndex(context, skill, phase, declarationRecordedAt, index)`
(module-local, not exported — only this module's own consumers need it).
Constraints: Must never select a structurally invalid record as
authoritative, regardless of `sequence`; must never let one record's
staleness or validity affect another record's own linkage validity; must
perform no I/O itself (all loading happens in DES-WORKFLOW-EVIDENCE-WAIVER-005/007's callers).
`waiverChainValid` (DES-WORKFLOW-EVIDENCE-WAIVER-002), and therefore
`waiverLinkage`, deliberately checks only a record's own hash/chain fields
against its immediate predecessor's own *stored* `payloadSha256` field —
identically to `change-waiver.ts`'s existing, already-shipped
`waiverChainValid`/`waiverLinkage` — and does not itself recursively
require every earlier record in the chain to also be independently
chain-valid; REQ-WORKFLOW-EVIDENCE-WAIVER-017 already covers the write
path by rejecting a new append whenever any existing record fails
`waiverRecordShapeValid`/`waiverChainValid`/`waiverLinkage` (DES-006 step
4 iterates and checks every existing record, not just the most recent
one), so a tampered earlier record is caught at the next append attempt;
this design intentionally mirrors the precedent module's exact behavior
here rather than introducing new, asymmetric tamper-detection semantics
for the workflow domain alone.
Depends-On: DES-WORKFLOW-EVIDENCE-WAIVER-002
Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-005, REQ-WORKFLOW-EVIDENCE-WAIVER-007, REQ-WORKFLOW-EVIDENCE-WAIVER-013
ADRs: ADR-0026

## DES-WORKFLOW-EVIDENCE-WAIVER-004: Snapshot payload and staleness evaluation
Responsibilities: Implement `export function snapshotPayload(workflow:
WorkflowManifest | null, skill: string, phase: string,
declarationRecordedAt: string, index: number | undefined, code:
WorkflowWaivableCode | null): unknown` returning exactly the
REQ-WORKFLOW-EVIDENCE-WAIVER-012 canonical payload: the resolved
declaration event's (via `resolveEvent`, DES-WORKFLOW-EVIDENCE-WAIVER-003)
own `skill`/`phase`/`status`/`recordedAt`/`version`; its own
`commandSha256` when present or the literal `null` sentinel when absent;
`index ?? null`; `workflowEvidenceHead(workflow)` (imported from
`packages/analysis/src/workflow.ts`, reused verbatim, never reimplemented);
and `code` verbatim in that final position — `code` is `null` exactly
when no allow-listed reason diagnostic is currently raised for this exact
scope (REQ-012's explicit sentinel case), a decision made entirely by this
function's caller (`snapshotHashFor` below), never inferred internally
from a stored waiver record's own `code`. Implement `function
currentCodeFor(rawDiagnostics: Diagnostic[], skill: string, phase: string,
declarationRecordedAt: string, index: number | undefined):
WorkflowWaivableCode | null` scanning `rawDiagnostics` for an entry whose
`code` is a member of `WORKFLOW_WAIVABLE_CODES` and whose structured
`skill`/`phase`/`declarationRecordedAt`/`index` fields equal the given
scope, returning that `code` or `null` when none matches — this is the
**only** place REQ-012's "no diagnostic currently raised" case is decided,
and it always inspects the complete raw-diagnostic set
(DES-WORKFLOW-EVIDENCE-WAIVER-005's phase 1 output), never a partial or
in-progress one. Implement `function snapshotHashFor(workflow:
WorkflowManifest | null, rawDiagnostics: Diagnostic[], record:
WorkflowWaiverRecord): string` as `digest(canonicalJson(snapshotPayload(
workflow, record.skill, record.phase, record.declarationRecordedAt,
record.index, currentCodeFor(rawDiagnostics, record.skill, record.phase,
record.declarationRecordedAt, record.index))))` — note this **never**
falls back to `record.code`; when `currentCodeFor` returns `null` (no
diagnostic currently raised for the scope), the payload's `code` position
is `null`, exactly matching REQ-012's "resolves to no diagnostic at all"
acceptance case, which is what makes an old record correctly stale once
its scope's diagnostic disappears even though the record's own persisted
`code` field is untouched. A waiver record is non-stale exactly when
`record.snapshotVersion === CURRENT_SNAPSHOT_VERSION && record.snapshotHash
=== snapshotHashFor(workflow, rawDiagnostics, record)`.
Interfaces: `snapshotPayload(workflow, skill, phase, declarationRecordedAt, index, code)`;
`currentCodeFor(rawDiagnostics, skill, phase, declarationRecordedAt, index)`;
`snapshotHashFor(workflow, rawDiagnostics, record)` (module-local, not exported).
Constraints: Must use `workflowEvidenceHead` exactly as exported by
`workflow.ts` (no re-derivation of its hashing logic in this module); must
represent an absent `commandSha256`/`index`/current-code as the literal
`null` sentinel, never an omitted key, so two conforming implementations
of this payload always canonicalize identically; must never substitute a
stored record's own `code` for the result of `currentCodeFor`.
Depends-On: DES-WORKFLOW-EVIDENCE-WAIVER-003
Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-012
ADRs: ADR-0026

## DES-WORKFLOW-EVIDENCE-WAIVER-005: Two-phase diagnostic pipeline inside `validateWorkflow`
Responsibilities: `validateWorkflow(root, options)` (`packages/analysis/src/workflow.ts`)
currently loads its own `WorkflowManifest` internally via `loadWorkflow(root)`
as its very first step, before computing any diagnostic — there is
presently no way for a caller that has already loaded a manifest to reuse
it. Split the function in two so every caller that needs both "the loaded
manifest" and "diagnostics computed against that exact manifest" (DES-006,
DES-007) can guarantee they observe one consistent snapshot rather than
two independent loads that a concurrent write could make disagree:
`export async function validateLoadedWorkflow(root: string, workflow:
WorkflowManifest | null, options: WorkflowVerificationOptions = { mode:
'compatible' }, preloadedWaiverEvidence?: LoadedWorkflowWaiverEvidence |
null): Promise<{ present: boolean; verified: boolean; events:
number; skills: number; diagnostics: Diagnostic[]; workflowWaiverContext:
WorkflowWaiverContext }>` — `root` is
retained so phase 2 below can load
`.musubix/evidence/workflow-waivers.json` (a second, independent file this
function never previously touched) **when the caller has not already
loaded it**: the optional fourth parameter distinguishes "omitted"
(`undefined` — the common case; phase 2 calls `loadWorkflowWaiverEvidence(root)`
itself) from "explicitly supplied" (any value including `null`, meaning
the file is already known absent or already loaded — phase 2 uses that
exact value and performs no load of its own), which is precisely what
lets DES-WORKFLOW-EVIDENCE-WAIVER-006 pass through its own single,
already-performed load rather than triggering a second read of the same
file; the `workflow` manifest itself is
never re-read from disk here, only the caller-supplied value is used —
a new, non-manifest-loading export containing exactly `validateWorkflow`'s
current diagnostic-computation
body (identical `WORKFLOW_INVOCATION_UNVERIFIED`/strict-mode/
`WORKFLOW_VERIFICATION_STALE`/tool-call-scoped `WORKFLOW_INVOCATION_REUSED`/
five reason-code/`WORKFLOW_BINDING_MISSING` logic, unchanged severities,
message text, and ordering), restructured into two phases inside it so
waiver evaluation never races diagnostic emission (the pipeline hazard a
single interleaved pass would otherwise create, since a diagnostic being
downgraded and a diagnostic being scanned for `currentCodeFor` would then
be the same in-progress array). `export async function
validateWorkflow(root: string, options?: WorkflowVerificationOptions):
Promise<...>` becomes a thin, behavior-preserving wrapper: `const workflow
= await loadWorkflow(root); return validateLoadedWorkflow(root, workflow,
options);` — its return shape gains the same new `workflowWaiverContext`
field, purely additively (every existing consumer of
`present`/`verified`/`events`/`skills`/`diagnostics` — `gate.ts`'s
`runGate`, existing tests — continues to compile and behave identically,
since none of them read a field they didn't already read); only its
implementation is now a delegation. **Phase 1 (unchanged emission logic, plus structured
fields)** — compute `rawDiagnostics: Diagnostic[]` exactly as
`validateWorkflow` does today (identical `WORKFLOW_INVOCATION_UNVERIFIED`/
strict-mode/`WORKFLOW_VERIFICATION_STALE`/tool-call-scoped
`WORKFLOW_INVOCATION_REUSED`/five reason-code/`WORKFLOW_BINDING_MISSING`
logic, unchanged severities, unchanged message text, unchanged ordering),
except every one of the five reason-code and `WORKFLOW_BINDING_MISSING`
diagnostics additionally carries structured `skill`, `phase`,
`declarationRecordedAt: event.recordedAt`, and (per
REQ-WORKFLOW-EVIDENCE-WAIVER-005/016's collision rule: present only when
two-or-more `status: "completed"` events share that event's own
`skill`/`phase`/`recordedAt`, in which case it is that event's own
zero-based `events`-array position) `index` fields — this is purely
additive annotation of the existing diagnostics, not a behavior change.
**Phase 2 (waiver transformation)** — resolve
`loaded = preloadedWaiverEvidence !== undefined ? preloadedWaiverEvidence
: await loadWorkflowWaiverEvidence(root)` (one load when the parameter is
omitted/`undefined`, zero loads when a value including `null` was
explicitly supplied — see the Constraints paragraph below), then build one
`context = buildWorkflowWaiverContext(loaded, workflow, rawDiagnostics)`
(DES-WORKFLOW-EVIDENCE-WAIVER-003) using the now-complete `rawDiagnostics`
from phase 1 — this same `context` object becomes the function's returned
`workflowWaiverContext`, so any caller needing `workflowWaivers`/
`workflowWaiverDiagnostics` (DES-WORKFLOW-EVIDENCE-WAIVER-007) derives
them from this exact, already-computed context rather than triggering a
second load of either file; map `rawDiagnostics` to the function's final returned
`diagnostics` array via `export function waivedWorkflowDiagnostic(context:
WorkflowWaiverContext, diagnostic: Diagnostic): Diagnostic`: for a
diagnostic whose `code` is a member of `WORKFLOW_WAIVABLE_CODES` or is
`WORKFLOW_BINDING_MISSING` (both carry the structured fields from phase 1),
resolve `authoritativeIndex(context, diagnostic.skill!, diagnostic.phase!,
diagnostic.declarationRecordedAt!, diagnostic.index)`; when `-1`, return
the diagnostic unchanged; otherwise, when
`context.loaded && !context.loaded.malformed &&
context.currentHash[authoritative] === /* the record's own snapshotHash, version-checked */`
(i.e. non-stale per DES-WORKFLOW-EVIDENCE-WAIVER-004), return `{
...diagnostic, severity: 'warning', waiver: { approver: record.approver,
reason: record.reason, recordedAt: record.waiverRecordedAt,
waiverRecordedAt: record.waiverRecordedAt } }` (using the
widened `Diagnostic.waiver` shape from DES-WORKFLOW-EVIDENCE-WAIVER-001,
which populates both keys with the same value so REQ-009's Acceptance
criterion is satisfied under either key spelling);
otherwise return the diagnostic unchanged (error). For every other
diagnostic (`WORKFLOW_INVOCATION_UNVERIFIED`, strict-mode diagnostics,
`WORKFLOW_VERIFICATION_STALE`, tool-call-scoped `WORKFLOW_INVOCATION_REUSED`),
pass it through unchanged — never through `waivedWorkflowDiagnostic`, per
REQ-WORKFLOW-EVIDENCE-WAIVER-001's exclusion list. `validateWorkflow`'s
returned `verified`/`present`/`events`/`skills` fields are computed exactly
as today from the *final* (post-transformation) `diagnostics` array
(`verified: !diagnostics.length` is unaffected by this change — REQ-015's
status redefinition happens in `runGate`, DES-WORKFLOW-EVIDENCE-WAIVER-007,
not here, since `verified` itself is a separate, pre-existing "zero
diagnostics of any severity" signal this design does not repurpose).
Interfaces: `validateWorkflow(root, options?)` (unchanged signature;
return shape additively gains `workflowWaiverContext`);
`validateLoadedWorkflow(root: string, workflow: WorkflowManifest | null,
options?: WorkflowVerificationOptions, preloadedWaiverEvidence?:
LoadedWorkflowWaiverEvidence | null)` (new; the actual two-phase
implementation — the fourth parameter is optional and its two possible
states are distinguished by `undefined`-ness, not truthiness: omitted or
explicit `undefined` means "load `workflow-waivers.json` internally",
while any explicitly supplied value, including `null` for "file
confirmed absent", means "reuse this value verbatim, perform no load");
`waivedWorkflowDiagnostic(context, diagnostic)`.
Constraints: Must never downgrade a diagnostic whose code is outside
`WORKFLOW_WAIVABLE_CODES`/`WORKFLOW_BINDING_MISSING`, regardless of waiver
evidence content; must never change diagnostic ordering, message text, or
any non-waived diagnostic's severity; phase 2 must never re-run or
duplicate any phase-1 emission logic — it only transforms the array phase
1 already produced; `validateWorkflow` and `validateLoadedWorkflow` must
compute byte-identical diagnostics (and an equivalent `workflowWaiverContext`)
for the same manifest and options, so introducing the split is a pure,
additive refactor from every existing caller's perspective; each call
must load `.musubix/evidence/workflow-waivers.json` at most once, and the
exact count is contract, not incidental: `validateWorkflow(root, options)`
and any call to `validateLoadedWorkflow` that omits its fourth parameter
(or passes explicit `undefined`) load it exactly once inside phase 2;
a call to `validateLoadedWorkflow` that supplies an explicit
`preloadedWaiverEvidence` value (including `null`) loads it zero times,
reusing the supplied value as-is — in neither case may phase 2 load it
and then have a separate caller step load it again, which is precisely
why `workflowWaiverContext` is exposed on the
return value instead of being recomputed by callers (DES-WORKFLOW-EVIDENCE-WAIVER-007).
Depends-On: DES-WORKFLOW-EVIDENCE-WAIVER-002, DES-WORKFLOW-EVIDENCE-WAIVER-003, DES-WORKFLOW-EVIDENCE-WAIVER-004
Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-001, REQ-WORKFLOW-EVIDENCE-WAIVER-009, REQ-WORKFLOW-EVIDENCE-WAIVER-010, REQ-WORKFLOW-EVIDENCE-WAIVER-016
ADRs: ADR-0026

## DES-WORKFLOW-EVIDENCE-WAIVER-006: `workflow waiver record` command
Responsibilities: Implement `export async function recordWorkflowWaiver(
root: string, code: string, skill: string, phase: string, recordedAt:
string, index: number | undefined, approver: string, reason: string):
Promise<{ recorded: boolean; skill: string; phase: string;
declarationRecordedAt: string; index?: number; code: string }>` in
`workflow-waiver.ts`, mirroring `recordChangeWaiver`'s exact control-flow
shape: (1) reject `recordedAt` that is not parseable by `Date.parse`
(REQ-002's "before any diagnostic lookup is attempted" requirement — this
check runs first, before any file is loaded); (2) `const loaded = await
loadWorkflowWaiverEvidence(root)` (the single load of
`.musubix/evidence/workflow-waivers.json` used for every subsequent step
in this function — never reloaded; this exact `loaded` value is passed
through to step (7) below),
throwing `"... is malformed; regenerate or repair it before recording a
new waiver."` when `loaded?.malformed` (REQ-WORKFLOW-EVIDENCE-WAIVER-017, no
automated repair); (3) `loadWorkflow(root)` once to obtain the current
`WorkflowManifest | null` (the single load used for every subsequent step
in this function — never reloaded; passed explicitly into
`validateLoadedWorkflow`, DES-WORKFLOW-EVIDENCE-WAIVER-005, rather than
letting a second internal load occur, which is exactly what motivates
that component's `validateWorkflow`/`validateLoadedWorkflow` split); (3.5)
`const config = await loadConfig(root)` (`packages/analysis/src/config.ts`,
already imported by `gate.ts` the identical way) to obtain
`config.workflow: WorkflowConfig`, the same options object `runGate` already
passes to `validateWorkflow(root, config.workflow)` for its own `workflow`
check — reused here so `recordWorkflowWaiver`'s "currently present"
diagnostic check (step 7) evaluates the project's actual configured
`mode`/`maxAgeSeconds`/`maxFutureSkewSeconds`, never a hardcoded default
that could disagree with what `gate --json` itself would report; (4)
re-validate every existing record's shape/chain/linkage via
`waiverRecordShapeValid`/`waiverChainValid`/`waiverLinkage(workflow, ...)`
against that already-loaded manifest, throwing on the first invalid one
(REQ-017); (5) reject `code` outside `WORKFLOW_WAIVABLE_CODES`, naming the
five allowed codes in the error (REQ-001); (6) reject empty/whitespace
`approver`/`reason` (REQ-003); (7) call `validateLoadedWorkflow(root,
workflow, config.workflow, loaded)` — passing step (3.5)'s already-loaded
project configuration as the options argument and step (2)'s
already-loaded waiver
evidence as the fourth argument so phase 2 performs no second read of
`.musubix/evidence/workflow-waivers.json` (this is precisely why
`validateLoadedWorkflow` accepts that optional parameter) — and never
`validateWorkflow(root, ...)`, which would silently reload both files and
could observe different manifest/evidence snapshots under concurrent
writes — and reject when its
(pre-waiver-irrelevant, since `WORKFLOW_INVOCATION_UNVERIFIED` is never
waivable/transformed) diagnostics include `WORKFLOW_INVOCATION_UNVERIFIED`
(REQ-004); (8) resolve the target declaration event via `resolveEvent(
workflow, skill, phase, recordedAt, index)` (DES-WORKFLOW-EVIDENCE-WAIVER-003):
reject when it returns `undefined` per REQ-005's collision rule (zero or
unresolved-collision matches, a spurious `index` with no collision, or a
wrong `index` value); (9) reject when `validateLoadedWorkflow`'s
just-computed diagnostics do not include an entry whose `code` equals the
given `code` and whose structured `skill`/`phase`/`declarationRecordedAt`/
`index` equal this exact scope (REQ-002) — note the diagnostic search here
uses `validateLoadedWorkflow`'s already-waiver-aware output (so an
already-waived, still-currently-raised diagnostic still counts as
"currently present" for this check, since waiving only changes severity,
never removes the diagnostic; a downgraded diagnostic's `code` is
unchanged); (10) reject when the scope's current authoritative record (if
any) is already validly linked and non-stale, via
`authoritativeIndex`/`snapshotHashFor` against this same `workflow`
(REQ-011, "already has an active waiver"); (11) compute `snapshotHash` via
`snapshotHashFor(workflow, validateLoadedWorkflow's diagnostics, ...)` for
the about-to-be-created record's scope; append a new record with
`sequence` one greater than the last existing record's (or `1` for the
first), `previousSha256` equal to the last record's `payloadSha256` (or
genesis), `waiverRecordedAt: new Date().toISOString()`, and `payloadSha256`
computed over every other field via `canonicalJson`; (12) persist via
`writeJson` to `.musubix/evidence/workflow-waivers.json`, creating the `{
schemaVersion: 1, waivers: [] }` document first if absent (REQ-006); never
modify `.musubix/evidence/workflow.json` or any existing waiver record.
Every rejection in steps (1) and (4)–(10) leaves
`.musubix/evidence/workflow-waivers.json` byte-identical to its
pre-call state, since no write occurs before step (12).
Every rejection in steps (1) and (4)–(10) leaves
`.musubix/evidence/workflow-waivers.json` byte-identical to its
pre-call state, since no write occurs before step (12).
Add a `workflow` command group to `packages/cli/src/main.ts` mirroring the
existing `change waiver record` group exactly: `const workflow =
program.command('workflow').description(...)` (a new group; the existing
hyphenated `workflow-record`/`workflow-verify`/`workflow-sanitize`
top-level commands are unchanged and unaffected), `const waiver =
workflow.command('waiver').description(...)`, `common(waiver.command(
'record <code>')).requiredOption('--skill <skill>').requiredOption(
'--phase <phase>').requiredOption('--recorded-at
<timestamp>').option('--index <n>', 'disambiguating event index',
(value) => { const parsed = Number(value); if (!/^\d+$/.test(value) ||
!Number.isSafeInteger(parsed)) throw new InvalidArgumentError('--index
must be a nonnegative safe integer.'); return parsed; }).requiredOption(
'--approver
<name>').requiredOption('--reason <text>').option('--confirm', ..., false)`
(the `--index` parser rejects any non-digit-string input — including
negative numbers, decimals, and non-numeric text — and additionally
rejects an all-digit string that is not itself a JavaScript safe integer
once converted (e.g. an arbitrarily long digit string that would convert
to `Infinity` or lose precision), before
`recordWorkflowWaiver` ever sees it, so it always receives either
`undefined` or a genuine nonnegative safe-integer `number`, matching
`resolveEvent`'s and REQ-WORKFLOW-EVIDENCE-WAIVER-005's strict-integer
expectation; `commander`
already exports `InvalidArgumentError` from the `CommanderError`/`Command`
import `main.ts` uses — it is imported here for the first time in this
file, as the idiomatic Commander option-parser error type, rather than
inventing a new error class),
whose action throws `'Recording a workflow waiver requires --confirm.'`
when `--confirm` is absent (mirroring `change waiver record`'s identical
check) and otherwise calls `recordWorkflowWaiver` (imported via
`packages/analysis/src/index.ts`'s barrel, per
DES-WORKFLOW-EVIDENCE-WAIVER-001's added export).
Interfaces: `recordWorkflowWaiver(root, code, skill, phase, recordedAt, index, approver, reason)`;
new `workflow waiver record <code> --skill <skill> --phase <phase> --recorded-at <timestamp> [--index <n>] --approver <name> --reason <text> --confirm` CLI command.
Constraints: Must reject and record no evidence for every failure case in
steps (1), (4)–(10) above, leaving `.musubix/evidence/workflow-waivers.json`
byte-identical to its state before the call; must never accept `--index`
absent a collision or reject it present with one; must load
`workflow.json` exactly once per call, reusing that single snapshot for
every step, so a concurrent `workflow-record`/`workflow-verify` call
cannot make two steps within one `recordWorkflowWaiver` invocation observe
different states.
Depends-On: DES-WORKFLOW-EVIDENCE-WAIVER-001, DES-WORKFLOW-EVIDENCE-WAIVER-002, DES-WORKFLOW-EVIDENCE-WAIVER-003, DES-WORKFLOW-EVIDENCE-WAIVER-004, DES-WORKFLOW-EVIDENCE-WAIVER-005
Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-001, REQ-WORKFLOW-EVIDENCE-WAIVER-002, REQ-WORKFLOW-EVIDENCE-WAIVER-003, REQ-WORKFLOW-EVIDENCE-WAIVER-004, REQ-WORKFLOW-EVIDENCE-WAIVER-005, REQ-WORKFLOW-EVIDENCE-WAIVER-006, REQ-WORKFLOW-EVIDENCE-WAIVER-011, REQ-WORKFLOW-EVIDENCE-WAIVER-013, REQ-WORKFLOW-EVIDENCE-WAIVER-017
ADRs: ADR-0026

## DES-WORKFLOW-EVIDENCE-WAIVER-007: Gate/status visibility and `workflow` check status redefinition
Responsibilities: Implement `export function
deriveWorkflowWaiverAudit(context: WorkflowWaiverContext): {
workflowWaivers: Array<{ skill: string; phase: string;
declarationRecordedAt: string; index?: number; code: string; approver:
string; reason: string; waiverRecordedAt: string }>;
workflowWaiverDiagnostics: Diagnostic[] }` in `workflow-waiver.ts` as a
**synchronous, non-loading, pure** function operating only on an
already-built `WorkflowWaiverContext` (DES-WORKFLOW-EVIDENCE-WAIVER-003) —
deliberately not a new loading entry point, so it can never itself
duplicate the single load `validateWorkflow`/`validateLoadedWorkflow`
(DES-WORKFLOW-EVIDENCE-WAIVER-005) already performs and already exposes
via that function's own returned `workflowWaiverContext` field: every
caller below obtains its `context` from that one existing call, never
from a second, independent load of `workflow.json`/`workflow-waivers.json`.
It iterates distinct
`scopeKey(...)` groups over `context.loaded?.waivers ?? []` once to populate both
returned arrays together: `workflowWaivers` gets one entry
per scope for its authoritative, validly-linked, non-stale record only
(REQ-014's authoritative-only rule); `workflowWaiverDiagnostics` gets
`WORKFLOW_WAIVER_EVIDENCE_MALFORMED` for the whole document or any
individually invalidly-linked record — for a whole-document malformation
(unparseable JSON or wrong top-level shape) the diagnostic names only the
file, with no per-record fields (none are recoverable); for one
specific malformed/invalidly-linked element within an otherwise-parseable
`waivers` array, the diagnostic names that element's zero-based `waivers`
array position and additionally includes each of its own
`skill`/`phase`/`declarationRecordedAt`/`index`/`code` fields only when
that field is itself present on the element and independently
well-typed per REQ-WORKFLOW-EVIDENCE-WAIVER-013 (e.g. `skill` included
only if it is itself a string; a numeric `skill` or an entirely
non-object element contributes no recovered fields at all) — implemented
via a module-local `function recoverableScopeFields(record: unknown):
Partial<{ skill: string; phase: string; declarationRecordedAt: string;
index: number; code: string }>` that independently type-checks each field
in isolation (never assuming any other field's validity) and is used only
to enrich this diagnostic's own metadata; its output is never consulted by
`waiverLinkage`, `authoritativeIndex`, or any other structural/staleness
decision in this module, and `WORKFLOW_WAIVER_STALE` for each scope's stale authoritative
record (per REQ-012) — both diagnostics are computed purely from `context`
and have no other side effect; neither
is ever consulted by `aggregateStatus` or by this component's own `runGate`
status change below. Also implement thin convenience wrappers
`export async function activeWorkflowWaivers(root: string):
Promise<ReturnType<typeof deriveWorkflowWaiverAudit>['workflowWaivers']>`
and `export async function workflowWaiverEvidenceDiagnostics(root: string):
Promise<Diagnostic[]>`, each calling `validateWorkflow(root)` once (its own
single load of both files, via DES-005) and returning one field of
`deriveWorkflowWaiverAudit(result.workflowWaiverContext)` — kept only for
standalone callers (e.g. tests) that need just one array; `runGate` and
`projectStatus` below call `validateWorkflow`
(`runGate` already does, for its own `workflow` check;
`projectStatus` gains its own single call, purely to obtain
`workflowWaiverContext` — this is a read-only audit consult, exactly like
its existing independent `activeWaivers`/`waiverEvidenceDiagnostics` calls
for the change domain, and does not construct `checks` or otherwise
change `projectStatus`'s existing "read persisted `quality.json`" logic
for `gate.status`) and `deriveWorkflowWaiverAudit` directly themselves,
never through these two wrappers, so each of them performs exactly one
load of `workflow.json`/`workflow-waivers.json` for its own call, and
derives every one of `checks`/`diagnostics`/`workflowWaivers`/
`workflowWaiverDiagnostics` it needs from that single result.
Modify `packages/analysis/src/gate.ts`'s `runGate` function's existing
`workflow` check construction (the block that already calls
`validateWorkflow(root, config.workflow)` and pushes `checks.push({ name:
'workflow', ... })`) to change `status: !workflow.present ? 'skipped' :
workflow.verified ? 'pass' : 'fail'` to `status: !workflow.present ?
'skipped' : countErrors(workflow.diagnostics) === 0 ? 'pass' : 'fail'`
(reusing `runGate`'s existing local `countErrors` helper, identically to
how `tdd`/`change-history`/`change-completeness` already compute `status`
in this same function) — this is REQ-015's redefinition, made correct by
DES-005 already downgrading waived diagnostics' severity inside
`workflow.diagnostics` itself, so no additional waiver-aware branching is
needed at this call site beyond the existing `countErrors` pattern. Also
in `runGate`, since it already computes `const workflow =
await validateWorkflow(root, config.workflow)` for the check above, reuse
that exact same result — `const { workflowWaivers, workflowWaiverDiagnostics }
= deriveWorkflowWaiverAudit(workflow.workflowWaiverContext)` (a
synchronous derivation from data already in hand, never a second load of
either file) alongside `runGate`'s existing
`activeWaivers(root)`/`waiverEvidenceDiagnostics(root)` call, merging
`workflowWaiverDiagnostics` into the existing `waiverDiagnostics` array
(`[...waiverDiagnostics, ...workflowWaiverDiagnostics]`) and adding a new
top-level `workflowWaivers` field to `GateReport` (kept separate from the
existing, change-scoped `waivers` field, which is unchanged). Separately,
in `projectStatus` (which does **not** construct `checks` today, and this
design does not add that there — `checks` construction remains solely
`runGate`'s responsibility, and `projectStatus`'s aggregate `gate.status`
continues to be derived from the persisted `.musubix/evidence/quality.json`
snapshot that `runGate` already wrote, per its own existing, unmodified
logic), add `const workflow = await validateWorkflow(root)` (one new call,
exactly mirroring how `projectStatus` already independently calls
`activeWaivers(root)`/`waiverEvidenceDiagnostics(root)` today purely for
audit-array purposes, without constructing any check from their result)
followed by the identical synchronous
`deriveWorkflowWaiverAudit(workflow.workflowWaiverContext)` derivation
call alongside its own existing `activeWaivers(root)`/`waiverEvidenceDiagnostics(root)`
call, merging results into its own returned `waiverDiagnostics` and adding
the same new `workflowWaivers` field to its own return shape — so `status
--json` shows the identical audit data as `gate --json`, each function
performing exactly one `validateWorkflow` call of its own (`runGate`'s
existing call for its check; `projectStatus`'s new call solely for the
audit arrays) without either one reconstructing `workflow` check status
outside `runGate`.
Interfaces: `deriveWorkflowWaiverAudit(context)`; `activeWorkflowWaivers(root)`
and `workflowWaiverEvidenceDiagnostics(root)` (thin wrappers, each calling
`validateWorkflow(root)` once and returning one field of
`deriveWorkflowWaiverAudit(result.workflowWaiverContext)`, kept exported
for standalone callers — e.g. tests — that need only one of the two
arrays and have no already-computed context to reuse, mirroring
`activeWaivers`/`waiverEvidenceDiagnostics`'s existing external shape;
`runGate`/`projectStatus` themselves call `deriveWorkflowWaiverAudit`
directly against their own already-in-hand `workflowWaiverContext`, never
through these two wrappers, so neither issues a redundant second load);
`runGate`'s `GateReport` and `projectStatus`'s return shape both gain
`workflowWaivers: Array<{ skill: string; phase: string; declarationRecordedAt: string; index?: number; code: string; approver: string; reason: string; waiverRecordedAt: string }>`;
both functions' existing `waiverDiagnostics` field now also includes workflow-waiver diagnostics.
Constraints: Must not change `waivers`' existing (change-scoped) contents
or shape; must not let `WORKFLOW_WAIVER_EVIDENCE_MALFORMED`/
`WORKFLOW_WAIVER_STALE` affect the `workflow` check's `status` (they never
enter `workflow.diagnostics`, only the separate `waiverDiagnostics` array);
must require no change to `packages/analysis/src/approval-record.ts`;
`projectStatus` may add a `validateWorkflow(root)` call solely to obtain
`workflowWaiverContext` for the audit arrays, but must not add `checks`
construction, `workflow`-check-status computation, or any other
`aggregateStatus`-affecting logic there — that responsibility remains
exclusively `runGate`'s, unchanged by this addition.
Depends-On: DES-WORKFLOW-EVIDENCE-WAIVER-002, DES-WORKFLOW-EVIDENCE-WAIVER-003, DES-WORKFLOW-EVIDENCE-WAIVER-004, DES-WORKFLOW-EVIDENCE-WAIVER-005
Requirements: REQ-WORKFLOW-EVIDENCE-WAIVER-008, REQ-WORKFLOW-EVIDENCE-WAIVER-012, REQ-WORKFLOW-EVIDENCE-WAIVER-014, REQ-WORKFLOW-EVIDENCE-WAIVER-015
ADRs: ADR-0026
