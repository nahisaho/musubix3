# CHANGE-0001: Human approval gates

Type: feature
Requirements: REQ-HUMAN-APPROVAL-GATES-001, REQ-HUMAN-APPROVAL-GATES-002, REQ-HUMAN-APPROVAL-GATES-003, REQ-HUMAN-APPROVAL-GATES-004, REQ-HUMAN-APPROVAL-GATES-005, REQ-HUMAN-APPROVAL-GATES-006, REQ-HUMAN-APPROVAL-GATES-007, REQ-HUMAN-APPROVAL-GATES-008

## Impact

Add artifact-bound requirements, design, and release approvals to configuration,
CLI transitions, quality gate/status reporting, installer defaults, Skills, and
English/Japanese documentation. Existing configs without approval policy remain
compatible.

## Acceptance

- Prepare displays an exact manifest/hash; recording requires that reviewed hash, `--confirm`, and approver identity.
- Relevant artifact changes, including ordinary JSONL project inputs, reject recording or make approval stale.
- Requirements approval gates design; design approval gates TDD Red.
- Release recording recomputes the real gate and cannot trust mutable cached quality evidence.
- New installs require all three approvals and trusted baselines prevent downgrade.
- Local records express intent but require protected review or CI attestation for authenticated release authorization.
