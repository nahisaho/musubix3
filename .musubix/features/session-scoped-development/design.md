---
schemaVersion: 1
feature: session-scoped-development
---
# Session-scoped development request design

## DES-SESSION-SCOPED-DEVELOPMENT-001: New-change classifier
Responsibilities: Classify each natural-language development request as new or explicit continuation before selecting downstream Skills.
Interfaces: sdd-change entrypoint and native session context.
Constraints: Same-session history, prior approvals, and completed workflow records are never continuation signals; only an explicit existing CHANGE ID permits reuse.
Requirements: REQ-SESSION-SCOPED-DEVELOPMENT-001, REQ-SESSION-SCOPED-DEVELOPMENT-002
ADRs: ADR-0003
Depends-On: none

## DES-SESSION-SCOPED-DEVELOPMENT-002: Fresh elicitation handoff
Responsibilities: Route new requests to a fresh feature slug and requirements artifact, then ask one highest-priority question at a time until blockers are resolved.
Interfaces: sdd-requirements Skill and `.musubix/features/<slug>/requirements.md`.
Constraints: Prior artifacts may be inspected as context but cannot satisfy current requirements or approval gates.
Requirements: REQ-SESSION-SCOPED-DEVELOPMENT-001, REQ-SESSION-SCOPED-DEVELOPMENT-002
ADRs: ADR-0003
Depends-On: DES-SESSION-SCOPED-DEVELOPMENT-001
