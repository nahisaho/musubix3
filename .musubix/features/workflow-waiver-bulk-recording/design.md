# Workflow waiver bulk recording design

This design adds one new function and one new CLI subcommand alongside the
existing single-diagnostic workflow waiver path
(`recordWorkflowWaiver` in `packages/analysis/src/workflow.ts`,
`workflow waiver record <code>` in `packages/cli/src/main.ts`), reusing every
existing validation/linkage/chain primitive from
`packages/analysis/src/workflow-waiver.ts` (`WORKFLOW_WAIVABLE_CODES`,
`waiverRecordShapeValid`, `waiverChainValid`, `waiverLinkage`,
`authoritativeIndex`, `nonStale`, `scopeKey`, `snapshotHashFor`,
`payloadShaOf`) and `validateLoadedWorkflow` unchanged. No existing exported
function's signature or behavior changes.

## DES-WORKFLOW-WAIVER-BULK-001: `recordAllWorkflowWaivers` bulk-recording function
Responsibilities: Add `export async function recordAllWorkflowWaivers(root:
string, approver: string, reason: string): Promise<{ recorded: number;
waivers: Array<{ skill: string; phase: string; declarationRecordedAt:
string; index?: number; code: string }> }>` to
`packages/analysis/src/workflow.ts`, placed next to `recordWorkflowWaiver`.
It performs, in order, exactly the bulk waiver preconditions from
REQ-WORKFLOW-WAIVER-BULK-002, each identical to `recordWorkflowWaiver`'s
existing corresponding check (throwing the same message shape on failure,
so CLI error text stays consistent for contributors already familiar with
the single-record command): (1) load
`.musubix/evidence/workflow-waivers.json` via `loadWorkflowWaiverEvidence`
and throw if malformed; (2) walk every existing waiver record with
`waiverRecordShapeValid`/`waiverChainValid`/`waiverLinkage` and throw on
the first invalid one, identically to `recordWorkflowWaiver`'s existing
loop; (3) throw if `approver.trim()` or `reason.trim()` is empty; (4) call
`validateLoadedWorkflow(root, workflow, config.workflow, loaded)` and throw
if its `diagnostics` contain `WORKFLOW_INVOCATION_UNVERIFIED`. Only after
all four hold does it compute candidates (REQ-WORKFLOW-WAIVER-BULK-001):
filter `validated.diagnostics` to entries whose `code` is in
`WORKFLOW_WAIVABLE_CODES` and which carry `skill`/`phase`/
`declarationRecordedAt` (the same guard `waivedWorkflowDiagnostic` already
applies before treating a diagnostic as declaration-scoped), deduplicate by
`scopeKey(skill, phase, declarationRecordedAt, index)` since
`WORKFLOW_INVOCATION_ORDER`/`WORKFLOW_INVOCATION_INCOMPLETE` etc. can only
ever report once per declaration in practice but deduplication keeps the
function correct even if a future diagnostic code reports more than one
entry per declaration, exclude any whose `authoritativeIndex` in
`validated.workflowWaiverContext` resolves to a `nonStale` active record,
then sort the remainder by `skill`, then `phase`, then
`declarationRecordedAt`, then `index` (`undefined` sorts before any defined
value) for deterministic, reviewable output and a deterministic hash
chain. If the candidate list is empty, return `{ recorded: 0, waivers: [] }`
without any file write (REQ-WORKFLOW-WAIVER-BULK-003) — this is a normal,
successful return, not a thrown error. Otherwise, starting from the
existing evidence's current tail (`sequence`/`payloadSha256`, or the
genesis values `recordWorkflowWaiver` already uses when the file is
absent/empty), build one `WorkflowWaiverRecord` per candidate in sorted
order, each one's `previousSha256`/`sequence` chained onto the
immediately preceding record already built in this same call (never
re-reading the file mid-loop), each with the shared `approver`/`reason`
and its own `waiverRecordedAt` timestamp (`new Date().toISOString()`,
called once per record so entries are not artificially forced to an
identical timestamp), each `snapshotHash` computed by the existing
`snapshotHashFor(workflow, validated.diagnostics, draftRecord)` (the same
pre-loop `validated.diagnostics`, since no waiver written earlier in this
call changes any other candidate's underlying diagnostic), and each
`payloadSha256` computed by the existing `payloadShaOf`. Write the full
existing-plus-new array in exactly one `writeJson(root,
WORKFLOW_WAIVER_PATH, { schemaVersion: 1, waivers: [...existing.waivers,
...newRecords] })` call (REQ-WORKFLOW-WAIVER-BULK-002's all-or-nothing
requirement: every precondition and every candidate is fully computed in
memory before this single write, so a thrown error before this point
leaves the file provably untouched), then return `{ recorded:
newRecords.length, waivers: newRecords.map(...) }` in the same shape
`recordWorkflowWaiver` already returns per record.
Interfaces: `recordAllWorkflowWaivers(root, approver, reason)`.
Constraints: Must not duplicate `WORKFLOW_WAIVABLE_CODES`,
`waiverRecordShapeValid`, `waiverChainValid`, `waiverLinkage`,
`authoritativeIndex`, `nonStale`, `scopeKey`, `snapshotHashFor`, or
`payloadShaOf`; must import and reuse each verbatim from
`workflow-waiver.ts` exactly as `recordWorkflowWaiver` already does. Must
never write `workflow-waivers.json` when any precondition fails or when
zero candidates are found. Must never select `WORKFLOW_INVOCATION_UNVERIFIED`
as a candidate code, and must never create a waiver entry whose own `code`
is `WORKFLOW_BINDING_MISSING` (it is never a member of
`WORKFLOW_WAIVABLE_CODES`); a `WORKFLOW_BINDING_MISSING` diagnostic sharing
a waived declaration's scope is downgraded to `warning` only as an
unchanged, pre-existing consequence of `waivedWorkflowDiagnostic` already
pairing it with that scope's primary waiver entry — identical to what a
single `workflow waiver record` call for that same scope already does
today, not a new effect introduced by this feature. Must not change
`recordWorkflowWaiver`, `deriveWorkflowWaiverAudit`, `waivedWorkflowDiagnostic`,
or any `gate`/`status` computation — a mix of bulk- and single-recorded
entries in the same evidence file must remain indistinguishable to every
existing consumer, since `WorkflowWaiverRecord`'s shape is unchanged.
Requirements: REQ-WORKFLOW-WAIVER-BULK-001, REQ-WORKFLOW-WAIVER-BULK-002, REQ-WORKFLOW-WAIVER-BULK-003
ADRs: none — this component makes no new architectural decision; it is a batch wrapper that composes ADR-0026's already-decided waiver evidence model, chain, and validation primitives verbatim, adding only candidate selection and looped record construction.

## DES-WORKFLOW-WAIVER-BULK-002: `workflow waiver record-all` CLI subcommand
Responsibilities: In `packages/cli/src/main.ts`, next to the existing
`workflowWaiver.command('record <code>')` registration, add
`workflowWaiver.command('record-all')` with `.requiredOption('--approver
<name>', ...)`, `.requiredOption('--reason <text>', ...)`, and `.option(
'--confirm', ..., false)`, mirroring the existing command's own option
descriptions and `--confirm` gate (`if (!options.confirm) throw new
Error('Recording a workflow waiver requires --confirm.')`, the identical
message the single-record command already uses, so scripts/documentation
can treat both commands' confirmation error uniformly). Its action calls
`recordAllWorkflowWaivers(resolve(options.root), options.approver,
options.reason)` and passes the result to the existing `output(...)`
helper with a summary message reporting the count, e.g. \`WAIVER: PASS
(${result.recorded} recorded)\`.
Interfaces: CLI `workflow waiver record-all --approver <name> --reason
<text> --confirm [--root <path>] [--json]`.
Constraints: Must not add a `<code>` positional argument (bulk selection is
implicit, per REQ-WORKFLOW-WAIVER-BULK-001); must not change the existing
`record <code>` subcommand's options, behavior, or help text.
Requirements: REQ-WORKFLOW-WAIVER-BULK-001, REQ-WORKFLOW-WAIVER-BULK-002, REQ-WORKFLOW-WAIVER-BULK-003
ADRs: none — this component only wires an existing CLI command pattern (already established for `workflow waiver record <code>` under ADR-0026) to a new function; it introduces no new CLI/architecture decision.

## DES-WORKFLOW-WAIVER-BULK-003: Documentation of the repeatable release-flow step
Responsibilities: In `README.md`'s CLI command reference table (next to the
existing `workflow waiver record <code> ...` row) and its workflow-waiver
prose section, document `workflow waiver record-all --approver <name>
--reason <text> --confirm`: it waives every currently reported,
not-yet-actively-waived declaration-scoped `WORKFLOW_WAIVABLE_CODES`
diagnostic in one all-or-nothing, hash-chained action, downgrading any
paired `WORKFLOW_BINDING_MISSING` for the same declaration scope exactly
as a single `record` call already does today; it never affects
`WORKFLOW_INVOCATION_UNVERIFIED`, which remains a blocker requiring
`workflow-verify` (compatible mode) to have reconciled the session's
transcript first. In
`.github/skills/sdd-change/SKILL.md`'s release-approval step (the existing
line referencing `workflow-sanitize`/`workflow-verify`), add that
`workflow-verify` should be run in compatible mode (no `--strict`) against
the current session's own transcript (`~/.copilot/session-state/<sessionId
>/events.jsonl`, already documented in `README.md` as an internal Copilot
CLI detail) before evaluating the `workflow` gate check, and that
`workflow waiver record-all` is the documented, repeatable step for any
declaration-scoped diagnostics that remain afterward — so this is no
longer rediscovered per change.
Interfaces: None (documentation only).
Constraints: Must not alter any other `SKILL.md` instruction's meaning or
ordering; must not claim bulk waiver resolves `WORKFLOW_INVOCATION_UNVERIFIED`
or any other non-declaration-scoped diagnostic.
Requirements: REQ-WORKFLOW-WAIVER-BULK-004
ADRs: none — this component is documentation only; it records no new architectural decision beyond ADR-0026's already-decided waiver model.

Depends-On: DES-WORKFLOW-EVIDENCE-WAIVER-001, DES-WORKFLOW-EVIDENCE-WAIVER-002, DES-WORKFLOW-EVIDENCE-WAIVER-003, DES-WORKFLOW-EVIDENCE-WAIVER-004, DES-WORKFLOW-EVIDENCE-WAIVER-005, DES-WORKFLOW-EVIDENCE-WAIVER-006
