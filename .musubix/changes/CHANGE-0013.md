---
schemaVersion: 1
id: CHANGE-0013
summary: Accept routine shutdown and resume episodes in strict workflow verification
status: in-progress
---
# CHANGE-0013: workflow-resumed-session-shutdown

Requirements: REQ-WORKFLOW-SHUTDOWN-001

## Intent

Resolve GitHub Issue #26. A single Copilot CLI session transcript can contain
one or more routine `session.shutdown` events followed by `session.resume` when
the conversation is resumed. Strict workflow verification must accept those
intermediate lifecycle boundaries while retaining fail-closed validation for
the final terminal event, session identity, shutdown type, and terminal-format
exclusivity. Sanitization must preserve the resume events required to verify
that each non-final shutdown is immediately followed by a matching resume.

## Impact

- Requirement and design: revise the existing workflow shutdown contract to
  distinguish intermediate shutdown/resume episodes from the final shutdown in
  `.musubix/features/workflow-session-shutdown/requirements.md` and
  `.musubix/features/workflow-session-shutdown/design.md`.
- Implementation: update strict transcript lifecycle validation and sanitized
  event retention in `packages/analysis/src/workflow.ts`; sanitized output gains
  the retained `session.resume` lifecycle event and fails closed on invalid
  shutdown/resume adjacency.
- Tests: retain `TEST-WORKFLOW-SHUTDOWN-001` for the existing terminal contract
  and add `TEST-WORKFLOW-SHUTDOWN-RESUME-001`,
  `TEST-WORKFLOW-SHUTDOWN-RESUME-002`, and
  `TEST-WORKFLOW-SHUTDOWN-RESUME-003` for accepted resumed transcripts,
  rejected lifecycle sequences in both verify and sanitize paths, and successful
  sanitized transcript verification. Existing sanitizer output assertions and
  documentation are reviewed for the newly retained resume/intermediate
  shutdown events.
- Documentation: update the strict workflow terminal-format description in
  `README.md`, `README-ja.md`, and `CHANGELOG.md`.

## Implementation

`verifyWorkflowChunks` now separates result-format cardinality from the
shutdown lifecycle. For shutdown transcripts it tracks `before-start`,
`active`, and `awaiting-resume` states, accepts any number of matched routine
shutdown/resume episodes, validates optional lifecycle UUIDs against the single
start UUID, and normalizes only the final routine shutdown.

`sanitizeWorkflowLogFile` continues to validate the unmodified source first and
now retains `session.resume` plus optional lifecycle UUIDs. Replacement session
IDs are applied consistently to every retained lifecycle identity.

## Verification

- `TEST-WORKFLOW-SHUTDOWN-RESUME-001`: resumed strict transcript accepted.
- `TEST-WORKFLOW-SHUTDOWN-RESUME-002`: invalid lifecycle sequences rejected by
  verification and sanitization.
- `TEST-WORKFLOW-SHUTDOWN-RESUME-003`: sanitized resumed transcript preserves
  boundaries and passes strict re-verification with replacement identity.
- `npx vitest run tests/p3-workflow-provenance.test.ts`: passed, 14 tests.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm test`: passed, 463 tests passed and 8 skipped.
- `npm run pack:check`: passed, package contents verified.
