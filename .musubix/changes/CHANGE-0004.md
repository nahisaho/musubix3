---
schemaVersion: 1
id: CHANGE-0004
summary: Accept routine Copilot session shutdown as strict workflow terminal evidence
status: in-progress
---
# CHANGE-0004: Copilot session shutdown workflow compatibility

Requirements: REQ-WORKFLOW-SHUTDOWN-001

## Intent

Correct strict workflow verification so it accepts the terminal event emitted by
current GitHub Copilot CLI sessions without weakening transcript integrity.

## Scope

- Accept exactly one final `session.shutdown` with `data.shutdownType: "routine"`.
- Bind its identity to the unique UUID declared by the session lifecycle.
- Preserve support for the existing final `result` event format.
- Reject abnormal, ambiguous, non-final, or identity-mismatched shutdowns.
- Cover verification and sanitization with deterministic regression tests.

## Other impacts

- CHANGE-0003 artifacts and chronology remain unchanged.
- The package behavior and distribution documentation require updating.
