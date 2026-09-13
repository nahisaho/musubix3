---
schemaVersion: 1
id: CHANGE-0012
summary: Bulk workflow waiver command and documented release-flow reconciliation step
status: in-progress
---
# CHANGE-0012: workflow-waiver-bulk-recording

Requirements: REQ-WORKFLOW-WAIVER-BULK-001 REQ-WORKFLOW-WAIVER-BULK-002 REQ-WORKFLOW-WAIVER-BULK-003

## Intent

Resolve GitHub Issue #24: `workflow-verify`/waiver reconciliation has
repeatedly blocked release approval across Issues #21/#22/#23. Root cause is
twofold. First, `WORKFLOW_INVOCATION_UNVERIFIED` only fires when
`workflow-verify` was never invoked at all this session — it is not a
strict-mode/session-termination limitation, and the repo's configured
compatible mode does not require a terminated session; it can be run mid-session
against the live transcript. Second, the existing `workflow waiver record`
command (from Issue #1's `workflow-evidence-waiver` feature) only waives one
declaration-scoped diagnostic per invocation, which is impractical when many
diagnostics remain outstanding at once, and neither the waiver mechanism nor
this repeatable release-flow step were documented anywhere.

This change adds `workflow waiver record-all` (`packages/analysis/src/workflow.ts`'s
`recordAllWorkflowWaivers`, wired to a new CLI subcommand in
`packages/cli/src/main.ts`), which waives every currently outstanding waivable
declaration-scoped diagnostic in one all-or-nothing call, reusing the existing
`workflow-evidence-waiver` primitives (`WORKFLOW_WAIVABLE_CODES`,
`waiverRecordShapeValid`, `waiverChainValid`, `waiverLinkage`,
`authoritativeIndex`, `nonStale`, `scopeKey`, `snapshotHashFor`, `payloadShaOf`)
without altering their single-waiver behavior. It rejects (recording nothing)
if any bulk waiver precondition fails first — malformed evidence, an invalid
waiver chain, a blank `--approver`/`--reason`, or `WORKFLOW_INVOCATION_UNVERIFIED`
(which only `workflow-verify` actually running can resolve) — and succeeds
idempotently, recording nothing, when zero waivable candidates remain. A
waived declaration-scoped diagnostic's paired `WORKFLOW_BINDING_MISSING`
(sharing the same declaration scope) is downgraded together with it,
identically to the existing single-record command's inherited, unchanged
behavior.

`README.md`'s Command reference now documents both `workflow waiver record`
and `workflow waiver record-all` (previously entirely undocumented), and the
`sdd-change` skill's release-approval step now explicitly instructs running
`workflow-verify` in compatible mode against the current session's own live
transcript before evaluating the `workflow` gate check, using
`workflow waiver record-all` only for whatever declaration-scoped diagnostics
remain afterward — turning a step that was rediscovered ad hoc every change
into a documented, repeatable one.

Native `rubber-duck` reviews of the requirements (found and fixed: a
contradiction between `WORKFLOW_INVOCATION_UNVERIFIED` handling and the
zero-candidate success rule; an undefined CLI command contract; ambiguous
"precondition" language conflicting with per-candidate exclusion rules) and
design (found and fixed: an incorrect claim that `WORKFLOW_BINDING_MISSING`
is "unaffected" by bulk waiver, when it is actually paired/downgraded
together with its scope's primary diagnostic, inherited unchanged from the
single-record command) closed all reported issues before requirements and
design approval. See `.musubix/features/workflow-waiver-bulk-recording/requirements.md`
and `design.md`.

`REQ-WORKFLOW-WAIVER-BULK-004` (the documentation requirement) is verified by
its own TDD Red-Green cycle (`TEST-WORKFLOW-WAIVER-BULK-004`) but is
intentionally not listed above, consistent with this repository's existing
`REQ-ATTESTATION-EVIDENCE-STABILITY-004` precedent: both requirements are
linked, for `trace check --strict` coverage only, to a doc-comment on code
they merely describe (`main.ts`'s CLI registration here, `attestation.ts`
there) rather than to any distinct implementation logic of their own, and
neither has ever been listed in any `CHANGE-*.md` `Requirements:` line. Since
a doc-only requirement's "implementation" is really just README/SKILL prose,
batching it into `change-record`'s `implementation` phase would make that
phase's unchanged-detection vacuously pass or fail based on unrelated code in
the same file rather than on REQ-004 itself, so it is tracked through
`tdd validate` instead.
