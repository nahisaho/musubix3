---
schemaVersion: 1
id: CHANGE-0017
summary: Fail fast when evidence writers overlap
status: in-progress
---
# CHANGE-0017: evidence-writer-lock

Requirements: REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-003 REQ-EVIDENCE-WRITER-LOCK-004 REQ-EVIDENCE-WRITER-LOCK-005

## Intent

Implement Issue #28 phase 3. Prevent concurrent musubix3 commands from
interleaving evidence, generated trace/cache, configured report, or installed
managed-artifact writes under one canonical project root, or observing a
partially updated multi-file evidence state.

## Impact

- Add one project-wide evidence-writer lock acquired atomically for each
  canonical project root by
  evidence-mutating operations.
- Reject contending writers immediately with stable owner diagnostics rather
  than waiting.
- Classify commands as lock-owning writers, fail-fast coordinated readers, or
  source-only/recovery exemptions, while allowing owner-context nested access.
- Add an explicit recovery command for a stale lock whose same-host owner
  process identity is demonstrably no longer alive, without force stealing.
- Preserve the evidence-merge journal as a separate transaction/recovery
  mechanism beneath the general writer lock.
- Add CLI help plus English/Japanese operator documentation for lock conflicts,
  recovery ordering, unsafe recovery, and manual remediation.
- Exclude transient lock state from Git, manifests, attestations, hashes, traces,
  and generated-artifact scans.

## Verification

Pending requirements/design approval and Red/Green evidence.
