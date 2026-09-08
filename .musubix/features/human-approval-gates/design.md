---
schemaVersion: 1
feature: human-approval-gates
---
# Human approval gate design

## DES-APPROVAL-001: Approval manifest service
Responsibilities: Select stage-relevant project artifacts, hash each artifact with SHA-256, and hash the canonical sorted manifest.
Interfaces: approvalManifest(root, stage) returns artifact paths, per-artifact SHA-256 values, and artifactSha256.
Constraints: Approval evidence and other generated evidence are excluded from bound inputs; identical content produces an identical manifest hash.
Requirements: REQ-HUMAN-APPROVAL-GATES-002, REQ-HUMAN-APPROVAL-GATES-003
ADRs: ADR-0002
Depends-On: none

## DES-APPROVAL-002: Approval evidence service
Responsibilities: Record explicit confirmed approvals, validate ordering and freshness, and expose approved, missing, or stale stage states.
Interfaces: recordApproval(root, stage, approver, expectedArtifactSha256), validateApprovals(root, config), and requireApproval(root, stage).
Constraints: Recording requires explicit CLI confirmation and the exact hash returned by approvalManifest; design requires current requirements approval; release recomputes the shared gate and requires current design approval plus passing required non-approval checks.
Requirements: REQ-HUMAN-APPROVAL-GATES-001, REQ-HUMAN-APPROVAL-GATES-002, REQ-HUMAN-APPROVAL-GATES-003, REQ-HUMAN-APPROVAL-GATES-006, REQ-HUMAN-APPROVAL-GATES-007
ADRs: ADR-0002
Depends-On: DES-APPROVAL-001

## DES-APPROVAL-003: CLI and gate integration
Responsibilities: Provide approval prepare/record/validate commands, enforce phase transitions, add approval evidence to gate/status, and install strict approval policy for new projects.
Interfaces: `approval prepare`, `approval record --artifact-sha256`, `approval validate`, design validation, TDD Red, gate, and status.
Constraints: Existing configuration files without an approval key parse in compatible mode; policy baselines prevent weakening required approval mode.
Requirements: REQ-HUMAN-APPROVAL-GATES-004, REQ-HUMAN-APPROVAL-GATES-005, REQ-HUMAN-APPROVAL-GATES-006, REQ-HUMAN-APPROVAL-GATES-007, REQ-HUMAN-APPROVAL-GATES-008
ADRs: ADR-0002
Depends-On: DES-APPROVAL-002
