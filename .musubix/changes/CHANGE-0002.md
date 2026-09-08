---
schemaVersion: 1
id: CHANGE-0002
summary: Restart requirements elicitation for new development requests in an existing session
status: completed
---
# CHANGE-0002: Session-scoped development requests

Requirements: REQ-SESSION-SCOPED-DEVELOPMENT-001, REQ-SESSION-SCOPED-DEVELOPMENT-002

## Intent
Correct the workflow so a new program requested in an existing Copilot session cannot inherit prior requirements, approvals, TDD evidence, or change records.

## Scope
- Update the mandatory `sdd-change` entrypoint to distinguish new requests from explicit continuation.
- Update `sdd-requirements` to create a fresh feature context and treat natural-language development requests as elicitation triggers.
- Add regression assertions for the distributed Skill contracts.

## Other impacts
Documentation and Skill behavior only; no runtime API or dependency changes.

## Acceptance
- New natural-language development requests always enter a fresh requirements phase.
- Existing artifacts are reusable only when the user explicitly names the existing CHANGE ID.
- Skill distribution checks remain green and all Skill files stay under the repository line limit.
