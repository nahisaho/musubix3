---
schemaVersion: 1
feature: human-approval-gates
---
# Human approval gates

## REQ-HUMAN-APPROVAL-GATES-001: Require explicit human confirmation
Priority: must
Type: functional
Pattern: event-driven
Statement: When a user records an approval, the system shall require an approver name, the exact prepared artifact manifest SHA-256, and the explicit `--confirm` option.
Acceptance: `approval prepare <stage>` displays the review manifest/hash; `approval record <stage> --approver <name> --artifact-sha256 <hash> --confirm` records only while that exact hash remains current, and missing confirmation or a changed hash records nothing.

## REQ-HUMAN-APPROVAL-GATES-002: Bind approval to artifact content
Priority: must
Type: functional
Pattern: event-driven
Statement: When approval is recorded, the system shall store the stage, approver, approval time, relevant artifact SHA-256 values, and deterministic manifest SHA-256.
Acceptance: Each stage evidence file contains `stage`, `approver`, `approvedAt`, `artifacts`, and `artifactSha256`, and recomputing the canonical sorted manifest yields the stored hash.

## REQ-HUMAN-APPROVAL-GATES-003: Invalidate changed artifacts
Priority: must
Type: functional
Pattern: state-driven
Statement: While approval evidence exists, the system shall report it as stale when any relevant artifact is added, changed, or removed.
Acceptance: Changing a bound requirements, design, ADR, configuration, source, test (including ordinary JSONL data), or documentation artifact changes the applicable manifest and makes the corresponding approval stale; only recognized generated log/transcript locations are excluded.

## REQ-HUMAN-APPROVAL-GATES-004: Gate design on requirements approval
Priority: must
Type: functional
Pattern: state-driven
Statement: While requirements approval is configured as mandatory, the system shall block design validation until current requirements approval exists.
Acceptance: In required mode, `design validate` exits nonzero before requirements approval and exits 0 after current requirements approval is explicitly recorded.

## REQ-HUMAN-APPROVAL-GATES-005: Gate implementation on design approval
Priority: must
Type: functional
Pattern: state-driven
Statement: While design approval is configured as mandatory, the system shall block TDD Red until current design approval exists.
Acceptance: `tdd red` exits unsuccessfully without current design approval and reaches the configured test runner after current design approval is recorded.

## REQ-HUMAN-APPROVAL-GATES-006: Gate release after quality
Priority: must
Type: functional
Pattern: complex
Statement: While release approval is configured as mandatory, when non-approval quality checks pass, the system shall require current release approval before final readiness.
Acceptance: Release approval recomputes the shared gate and cannot be authorized by editing cached quality evidence; it records only when all required non-approval checks currently pass, after which a final gate can become ready.

## REQ-HUMAN-APPROVAL-GATES-007: Report approval state honestly
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report every configured approval stage as approved, missing, or stale without inferring approval from validation results or natural-language text.
Acceptance: `approval validate`, `gate`, and `status` expose all stage states and never convert a validator or quality success into approval evidence.

## REQ-HUMAN-APPROVAL-GATES-008: Preserve compatible existing configuration
Priority: must
Type: functional
Pattern: optional-feature
Statement: Where approval policy selection is required, the system shall use compatible mode for existing configurations that omit approval and required mode for newly initialized projects.
Acceptance: Parsing a schema-v1 config without `approval` selects compatible mode; `init` writes required approval mode to both config and trusted policy baseline, and policy diagnostics reject downgrading it.
