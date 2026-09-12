---
schemaVersion: 1
feature: change-record-fail-fast
---
# Fail-fast unchanged-fingerprint detection in change-record — design

## DES-CHANGE-RECORD-FAIL-FAST-001: Compute and compare "would be unchanged" before appending evidence
Responsibilities: In `packages/analysis/src/change.ts`, inside
`recordChangePhase`, after computing `currentFingerprints(...)` but strictly
before calling `appendEvidenceOrder` or mutating `evidence`/writing
`changes.json`, compare the newly computed fingerprint(s) against the
immediately preceding phase's stored fingerprint(s), using the SAME baseline
selection the existing full-set-vs-batch branching already uses (see
existing code around `packages/analysis/src/change.ts:150-206`; this design
adds no new branching concept, only a new check reusing the existing one):
- `requirements` (always full-set): vs.
  `change.phases.impact.fingerprints.requirements`.
- `design` (always full-set): vs.
  `change.phases.requirements.fingerprints.design`.
- `red`, full-set form (`requirementIds` equals the change's full declared
  set): tests fingerprint vs. `change.phases.design.fingerprints.tests`.
- `red`, subset-batch form: tests fingerprint vs.
  `change.phases.design.fingerprints.tests` (the batch's `design` baseline
  is always the change-level `design` phase — there is no per-batch
  `design` phase to diverge from; both forms compare against the same
  change-level `design` fingerprint).
- `implementation`, full-set form: aggregate implementation fingerprint vs.
  `change.phases.red.fingerprints.implementation` (the full-set `red` entry
  stored in `change.phases`), and per-requirement
  `requirementImplementations[id]` vs. the same `change.phases.red` entry's
  value, for each ID in `change.requirementIds`.
- `implementation`, subset-batch form: aggregate implementation fingerprint
  vs. the matching `change.tddBatches` entry's `red.fingerprints.implementation`
  (found via `batchFor`/`batchKey`, exactly as `validateChangeEvidence`
  already locates it), and per-requirement `requirementImplementations[id]`
  vs. that same batch entry's `red`, for each ID in the batch's
  `requirementIds`.

If a comparison predecessor phase is absent (should not happen given
existing prerequisite checks, but defensively), skip that specific
comparison rather than throwing a new, unrelated error — the existing
prerequisite-phase checks already cover a missing predecessor.
Interfaces: internal helper `unchangedRejection(phase, requirementIds,
current: ChangeFingerprints, baseline: ChangeFingerprints | undefined):
string | null`, returning a rejection message (embedding one of the
DES-002 diagnostic codes) or `null` when nothing is unchanged; called from
`recordChangePhase` strictly before `appendEvidenceOrder`, using whichever
baseline full-set-vs-batch resolution above applies to `phase`.
Constraints: Must run, and must complete (throw or return `null`), before
`appendEvidenceOrder` is called and before `changes.json` is written, so a
rejection consumes no evidence-order sequence number and leaves
`changes.json`/`order.json` byte-identical to their pre-call state. Must not
alter the shape or content of `currentFingerprints`'s existing return value.
The exact `recordChangePhase` execution order (also governs DES-004's
dry-run short-circuit) is: (1) existing format/ID/prerequisite/duplicate/
subset/quality-coverage validation (unchanged), (2) compute candidate
`currentFingerprints`, (3) resolve the baseline per the rules above and run
`unchangedRejection`, throwing on a hit, (4) build the in-memory candidate
`ChangePhaseEvidence`/`ChangeEvidence`, (5) if `options.dryRun`, return the
candidate `ChangeEvidence` here without calling `appendEvidenceOrder` or
`writeJson`, (6) otherwise call `appendEvidenceOrder`, assign the returned
`order.sequence`, and call `writeJson`. Steps (5)/(6) are the only points
that may call `appendEvidenceOrder`; every fail-fast rejection and every
dry-run call returns strictly before it.
Existing test fixtures that record `requirements` (or another guarded phase)
immediately after its predecessor with no real file edit between them (for
example the `impact`-then-`requirements` sequences in
`tests/change-requirement-batches.test.ts`) must be updated to either make a
genuine edit to the relevant file between phases, or pass
`{ allowUnchanged: true }` when the test is intentionally exercising a
no-op requirements checkpoint; this is a required part of this feature's own
test-suite maintenance, not a separate change.
Requirements: REQ-CHANGE-RECORD-FAIL-FAST-001 REQ-CHANGE-RECORD-FAIL-FAST-002 REQ-CHANGE-RECORD-FAIL-FAST-003 REQ-CHANGE-RECORD-FAIL-FAST-004 REQ-CHANGE-RECORD-FAIL-FAST-005 REQ-CHANGE-RECORD-FAIL-FAST-006
ADRs: ADR-0022

## DES-CHANGE-RECORD-FAIL-FAST-002: Stable record-time diagnostic codes distinct from validation-time codes
Responsibilities: When `unchangedRejection` (DES-001) detects a no-op
fingerprint, throw an `Error` (matching this codebase's existing
`recordChangePhase` error-handling convention: all its current guard clauses
`throw new Error(...)`, caught and surfaced by the CLI as a non-zero exit) whose
message embeds one of the five new stable codes —
`CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD`,
`CHANGE_DESIGN_UNCHANGED_AT_RECORD`, `CHANGE_TESTS_UNCHANGED_AT_RECORD`,
`CHANGE_IMPLEMENTATION_UNCHANGED_AT_RECORD`,
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED_AT_RECORD` — plus the change ID,
and, for the relevant-implementation case, the unchanged requirement ID(s).
These five codes are net-new; the five pre-existing validation-time codes in
`validateChangeEvidence` (`CHANGE_REQUIREMENTS_UNCHANGED`, etc.) are
unmodified and keep firing for historical evidence that predates this
feature or was produced by a CLI version without these guards.
Interfaces: no new public type; the thrown `Error.message` format is
`"${code}: ${changeId} ..."`, consistent with how the CLI already surfaces
`recordChangePhase` errors (`packages/cli/src/main.ts`'s `change-record`
action has no special-case catch; the message reaches the user/`--json`
error envelope as-is).
Constraints: The five new codes must never be emitted by
`validateChangeEvidence`, and the five old codes must never be thrown by
`recordChangePhase`.
Requirements: REQ-CHANGE-RECORD-FAIL-FAST-001 REQ-CHANGE-RECORD-FAIL-FAST-002 REQ-CHANGE-RECORD-FAIL-FAST-003 REQ-CHANGE-RECORD-FAIL-FAST-004 REQ-CHANGE-RECORD-FAIL-FAST-005
ADRs: ADR-0022

## DES-CHANGE-RECORD-FAIL-FAST-003: `--allow-unchanged` override marker for the requirements phase
Responsibilities: Add an `allowUnchanged?: boolean` field to
`ChangePhaseEvidence` (used only by the `requirements` phase). Add a CLI
`--allow-unchanged` boolean flag to `change-record`, and thread an
`allowUnchanged` boolean parameter through `recordChangePhase`. When `phase
=== 'requirements'` and `allowUnchanged` is true, skip the
`CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD` comparison from DES-001 and
persist `phases.requirements.allowUnchanged = true` in the written evidence.
When `allowUnchanged` is omitted/false, or `phase` is anything other than
`requirements`, behave exactly as DES-001/DES-002 (the parameter has no
effect on other phases; passing it for a non-`requirements` phase is a
no-op, not an error, to keep the CLI surface simple).
In `validateChangeEvidence`, before evaluating the existing
`CHANGE_REQUIREMENTS_UNCHANGED` comparison, skip it when
`change.phases.requirements?.allowUnchanged === true`; every other
`*_UNCHANGED` comparison is unaffected by this field.
Interfaces: `recordChangePhase(root, changeId, phase, requirementIds,
options?: { allowUnchanged?: boolean; dryRun?: boolean })` (new optional
5th argument; all four existing 4-argument call sites in
`packages/cli/src/main.ts` and `tests/*.test.ts` keep compiling and behaving
unchanged, since the parameter is optional and defaults to `{}`).
In `packages/cli/src/main.ts`'s `change-record` command, add:
```ts
.option('--allow-unchanged', 'Record requirements even if unchanged since impact (defect fixes only)')
.option('--dry-run', 'Preview the outcome without recording it')
```
and extend the action's options type with `allowUnchanged?: boolean;
dryRun?: boolean`, forwarding `{ allowUnchanged: options.allowUnchanged,
dryRun: options.dryRun }` as `recordChangePhase`'s 5th argument.
Constraints: `allowUnchanged` must never be inferred implicitly — it is
recorded only when the CLI flag is explicitly passed. `ChangePhaseEvidence`
gaining this field is a purely additive schema change: existing loaded
`.musubix/evidence/changes.json` entries that omit `allowUnchanged` must be
treated as `false` with no rewrite, migration, or mutation of historical
evidence on load; add a regression test that loads/validates an evidence
fixture predating this field and confirms `CHANGE_REQUIREMENTS_UNCHANGED`
still fires exactly as before.
Requirements: REQ-CHANGE-RECORD-FAIL-FAST-007 REQ-CHANGE-RECORD-FAIL-FAST-008
ADRs: ADR-0022

## DES-CHANGE-RECORD-FAIL-FAST-004: `--dry-run` preview covering all existing and new validation
Responsibilities: When `options.dryRun` is true, `recordChangePhase` follows
the exact execution order fixed in DES-001's Constraints (steps 1-5), so
every existing check (change ID format, phase name, requirement ID
validity, staged-document existence for `impact`, duplicate-phase/batch
checks, prerequisite-phase checks, full-set vs. batch-subset validation,
Quality Green-coverage check) plus the new DES-001/DES-002/DES-003
fail-fast checks run and can throw exactly as in a real invocation, but
step (6) (`appendEvidenceOrder`/`writeJson`) never executes for a dry-run
call, in either the success or the rejection path. On a dry-run success,
`recordChangePhase` returns the in-memory candidate `ChangeEvidence` it
would have persisted (with no `order` field set on the new phase entry,
since no sequence was assigned). The CLI reports
`Would record ${changeId}:${phase}.` for a dry-run success instead of
`Recorded ${changeId}:${phase}.`, and surfaces the identical thrown error
unmodified for a dry-run rejection (same message/code as a non-dry-run
call would produce).
Interfaces: `recordChangePhase(..., { dryRun: true })`; CLI wiring per
DES-003 (`--dry-run` shares the same options object as `--allow-unchanged`).
Constraints: A `dryRun: true` call must produce a byte-identical
`.musubix/evidence/changes.json` and `.musubix/evidence/order.json` before
and after, in both the success and rejection cases — this is the same
appendEvidenceOrder-comes-last invariant DES-001 already establishes, so
DES-004 introduces no new ordering rule of its own.
Requirements: REQ-CHANGE-RECORD-FAIL-FAST-009
ADRs: ADR-0022

## DES-CHANGE-RECORD-FAIL-FAST-005: Documentation
Responsibilities: Update `change-record`'s Commander.js command description
and option help text in `packages/cli/src/main.ts` to mention the fail-fast
rejection, `--allow-unchanged`, and `--dry-run`. Add a paragraph to
`README.md`'s existing `change-record` documentation section describing the
same three concepts in prose (not only inside
`.github/skills/sdd-change/SKILL.md`).
Interfaces: none (documentation only).
Constraints: Must not duplicate or contradict the `sdd-change` skill's
existing prose; cross-reference it rather than restate its full workflow.
Requirements: REQ-CHANGE-RECORD-FAIL-FAST-010
ADRs: ADR-0022
