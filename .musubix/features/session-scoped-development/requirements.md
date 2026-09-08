---
schemaVersion: 1
feature: session-scoped-development
---
# Session-scoped development requests

## REQ-SESSION-SCOPED-DEVELOPMENT-001: Restart requirements for new programs
Priority: must
Type: functional
Pattern: event-driven
Statement: When a user requests development of a new program or feature in an existing Copilot session, the system shall start a new change by eliciting requirements before design or implementation.
Acceptance: The number of design or code actions before creating a fresh feature slug and CHANGE artifact is 0; when required context is missing, each interaction asks exactly 1 highest-priority requirements question.

## REQ-SESSION-SCOPED-DEVELOPMENT-002: Require explicit continuation for reuse
Priority: must
Type: functional
Pattern: event-driven
Statement: When a user intends to continue an existing change, the system shall reuse its requirements, approvals, and evidence only when the user explicitly identifies that change.
Acceptance: Without an explicitly named existing `CHANGE-*` ID, the number of reused requirements, approvals, TDD cycles, and change records is 0; with that identifier, only the named change may be continued.
