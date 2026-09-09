---
schemaVersion: 1
id: CHANGE-0006
summary: Reconcile Workflow declarations across multiple Copilot CLI session transcripts
status: in-progress
---
# CHANGE-0006: Multi-session Workflow declaration reconciliation

Requirements: REQ-WORKFLOW-MULTI-SESSION-001

## Intent

Resolve GitHub Issue #1 item 3: `workflow` gate check failed with
`WORKFLOW_INVOCATION_UNVERIFIED`. Investigation found the issue's stated
premise ("no usable Copilot session transcript (JSONL) exists") was
inaccurate for this environment — real per-session transcripts exist at
`~/.copilot/session-state/<uuid>/events.jsonl` — but the true root cause was
narrower and different: `workflow.json` accumulates Skill declarations across
the entire repository lifetime, spanning many distinct Copilot CLI sessions,
while `workflow-verify`/`verifyWorkflowLogFile` accepted only a single
transcript file. A declaration whose invocation occurred in an earlier
session could therefore never be reconciled against a later session's
transcript alone.

## Scope

- `REQ-WORKFLOW-MULTI-SESSION-001`: `workflow-verify`/`verifyWorkflowLogFile`
  accept one or more transcript file paths in compatible mode, concatenating
  them in ascending order of each file's earliest event timestamp (not
  command-line order) while preserving each file's own internal source order
  (needed for the existing non-monotonic-clock tolerance). A `toolCallId`
  appearing as a tool start in more than one supplied file is rejected.
  `--strict`/`--session-id` continue to require exactly one file, since
  strict mode's terminal-event contract (`REQ-WORKFLOW-SHUTDOWN-001`) is a
  single-session completeness proof.
- `ADR-0010` records the decision and rejected alternatives (automatic
  transcript discovery, expiring/grandfathering old declarations, extending
  strict mode to multiple sessions).
- README documents the new multi-file `workflow-verify` usage and the
  Copilot CLI transcript file location convention (noting it is an internal,
  version-dependent detail, not a musubix3-owned contract).

## Other impacts

- No existing requirement's behavior changed; single-file `workflow-verify`
  calls are unaffected (same byte stream, same `sourceSha256`).
- GitHub Issue #1 will be updated with the corrected root-cause finding once
  this change ships.

## Known evidence gap

`change-record` phases for this change were called in a single batch after
requirements, design, Red, and Green work were already complete, instead of
interleaved with each phase's real edits. `gate --changed` therefore reports
`CHANGE_RECORD_MISSING` for `CHANGE-0006` (no valid chronology recorded) —
this is disclosed rather than fabricated. The underlying requirements,
design, ADR, and TDD Red/Green evidence for `REQ-WORKFLOW-MULTI-SESSION-001`
are independently real and verified (see `tdd.json` cycle order 101/102 and
the approval records), but this change's staged-change chronology proof is
incomplete pending a properly interleaved `change-record` redo. The same
defect was independently found in the already-shipped `CHANGE-0005`
(commit `32fb816`), reported separately.
