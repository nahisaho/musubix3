---
schemaVersion: 1
feature: workflow-waiver-bulk-recording
---
# Workflow waiver bulk recording (repeatable relief for many reconciliation diagnostics per session)

Source: GitHub Issue #24 (recurrence of the Issue #1 / `workflow-evidence-waiver`
symptom across Issues #21, #22, #23 within one long-running Copilot CLI
session).

`workflow waiver record <code> --skill --phase --recorded-at [--index]
--approver --reason --confirm` (`workflow-evidence-waiver`,
`recordWorkflowWaiver` in `packages/analysis/src/workflow.ts`) already lets a
human downgrade exactly one declaration-scoped workflow reconciliation
diagnostic from `error` to `warning`, audited and hash-chained in
`.musubix/evidence/workflow-waivers.json`. That command requires the
declaration's own `skill`/`phase`/`recordedAt` (and disambiguating `index`) to
be typed out per diagnostic. When a single `gate`/`status` run reports many
such diagnostics at once (the reproduction in Issue #24 shows 30), a
contributor must repeat that command, with different scope arguments copied
by hand from `gate --json` output, once per diagnostic in the same session —
a workflow that is technically possible but was not actually completed on
three consecutive occasions (#21, #22, #23), each deferring release approval
instead. Issue #24 also confirms the command already refuses to operate at
all while `WORKFLOW_INVOCATION_UNVERIFIED` is present (no waivable,
declaration-scoped diagnostic exists yet because `workflow-verify` was never
run this session) — that guard is correct and is unchanged by this feature;
this feature only reduces the repetition needed once `workflow-verify` has
actually produced per-declaration diagnostics.

This change adds one new command, `workflow waiver record-all --approver
<name> --reason <text> --confirm`, that waives every *currently reported*,
not-yet-actively-waived, declaration-scoped diagnostic in one human-approved
action, under the same audit and hash-chain guarantees already required for
a single waiver, and does not change the meaning, validity rules, or
gate/status computation of any existing single-diagnostic waiver record.

Defined term **bulk waiver preconditions** (all invocation-level, checked
once before any candidate is selected, exactly mirroring the existing
guard order in `recordWorkflowWaiver`): the existing
`.musubix/evidence/workflow-waivers.json` evidence, if present, is not
malformed and its existing chain is unbroken; `--confirm` is supplied;
`--approver` and `--reason` are both non-empty; and the workflow has already
been reconciled by `workflow-verify` this session, i.e. the raw diagnostics
contain no `WORKFLOW_INVOCATION_UNVERIFIED`. These are distinct from the
per-candidate exclusion rules in REQ-WORKFLOW-WAIVER-BULK-001, which apply
only after every bulk waiver precondition already holds, to select which of
the currently reported declaration-scoped diagnostics receive a new waiver
entry. Concurrent-invocation races are out of scope for this feature,
identically to the existing single-record command, which makes the same
read-then-write assumption of one human operator per repository checkout.

## REQ-WORKFLOW-WAIVER-BULK-001: Bulk waiver targets exactly the current unwaived declaration-scoped diagnostics
Priority: must
Type: functional
Statement: When a human invokes `workflow waiver record-all` while every bulk waiver precondition holds, the system shall record one new chained waiver evidence entry in `.musubix/evidence/workflow-waivers.json` for each currently reported not-yet-actively-waived declaration-scoped `WORKFLOW_WAIVABLE_CODES` diagnostic only.
Acceptance: Given N currently reported, distinct, not-yet-waived declaration-scoped diagnostics (keyed by the full `skill`/`phase`/`declarationRecordedAt`/`index` scope), one invocation appends exactly N new entries to `workflow-waivers.json`, each with the same `--approver`/`--reason`, each individually valid and chained per the existing `waiverChainValid`/`payloadSha256` rules, and each resolving (per `waivedWorkflowDiagnostic`) so its diagnostic's `severity`, and that of any `WORKFLOW_BINDING_MISSING` diagnostic already paired to the same scope, becomes `warning` on the next `gate`/`status` run — identically to what a single `workflow waiver record` call for that same scope already does today; a diagnostic already covered by a current active waiver, or the scope-independent `WORKFLOW_INVOCATION_UNVERIFIED`, receives no new entry and is unaffected.

## REQ-WORKFLOW-WAIVER-BULK-002: Bulk waiver is all-or-nothing and never partially applied
Priority: must
Type: functional
Statement: When any bulk waiver precondition is unmet, the system shall reject the entire `workflow waiver record-all` invocation before writing any part of `workflow-waivers.json`.
Acceptance: Given any one bulk waiver precondition failure (malformed or broken existing evidence, missing `--confirm`, empty `--approver`/`--reason`, or a present `WORKFLOW_INVOCATION_UNVERIFIED` diagnostic), the command exits with a non-zero status and an explanatory error, and the file's content and byte-for-byte hash chain are identical to their pre-invocation state; no partial subset of the candidate diagnostics is ever waived by a rejected invocation.

## REQ-WORKFLOW-WAIVER-BULK-003: Bulk waiver reports zero remaining candidates without error
Priority: must
Type: functional
Statement: When a human invokes `workflow waiver record-all` while every bulk waiver precondition holds and no currently reported diagnostic qualifies under REQ-WORKFLOW-WAIVER-BULK-001, the system shall report zero recorded waivers as a successful non-error result without writing to `workflow-waivers.json`.
Acceptance: Running the command a second time immediately after a successful run (with no further reconciliation change) reports 0 recorded waivers and exits successfully, and the file is byte-for-byte unchanged from the first run's result; this acceptance never applies when a bulk waiver precondition is unmet, which is governed exclusively by REQ-WORKFLOW-WAIVER-BULK-002 instead.

## REQ-WORKFLOW-WAIVER-BULK-004: Documented, repeatable release-flow step
Priority: must
Type: functional
Statement: The project's contributor documentation (`README.md`) and the `sdd-change` skill instructions shall describe, as an explicit repeatable step of the standard change flow, running `workflow-verify` in compatible mode against the current session's own transcript before requesting release approval and then using `workflow waiver record-all` for any remaining declaration-scoped diagnostics, rather than leaving this to be rediscovered per change.
Acceptance: `README.md` documents `workflow waiver record-all`'s syntax, its declaration-scoped-only reach, and its all-or-nothing semantics next to the existing single-waiver command, and states that `WORKFLOW_INVOCATION_UNVERIFIED` remains a blocker it cannot resolve while a paired `WORKFLOW_BINDING_MISSING` is downgraded together with its declaration scope's waived diagnostic, identically to the existing single-record command; the `sdd-change` skill's release-approval step references running `workflow-verify` (compatible mode, no `--strict`) against the live session's transcript before evaluating the `workflow` gate check, and references `workflow waiver record-all` only for the declaration-scoped diagnostics that remain after that reconciliation.
