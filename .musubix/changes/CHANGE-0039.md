---
schemaVersion: 1
id: CHANGE-0039
summary: Verify acquisition rollback lock identity and durability
status: staged
---
# CHANGE-0039: evidence-writer-lock-acquisition-rollback

Source: GitHub Issue #41.

Requirements: REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-006 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001

## Intent

Prevent a failed writer-lock acquisition from removing a replacement lock or
silently losing the durability failure of its rollback.

## Classification

- Evidence writer-lock defect fix and error-reporting behavior change.

## Impact

- Capture the published lock's device/inode identity from the still-open
  staging descriptor immediately after hard-link publication and before
  directory synchronization, without resolving the canonical path again.
- Before acquisition rollback unlink, verify the canonical root, transaction
  ID, and device/inode identity against the failed acquisition.
- Synchronize the evidence directory after rollback unlink under the same
  platform policy as normal release.
- Keep the original acquisition failure primary and attach any rollback failure
  as structured secondary context.
- Normalize even an already-typed post-publication failure to
  `EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED` while retaining it as the cause.
- Surface the secondary rollback failure through the analysis error and CLI
  error output, including whether unlink completed, rather than silently
  suppressing it.
- Provide targeted inspection/removal guidance when rollback cannot prove that
  the canonical lock is absent or its removal is durable, including the live
  failed-acquirer, unavailable-owner, and foreign-replacement cases.
- After successful rollback, apply the existing best-effort cleanup only to
  directory levels created by the failed acquisition.
- Document the rollback failure code and recovery boundary in README.md,
  README-ja.md, command help, and the change/implementation/quality skills.
- Preserve REQ-EVIDENCE-WRITER-LOCK-006's existing fewer-than-80-lines limit by
  appending rollback semantics within existing lines rather than raising the
  measured line count.
- Add deterministic regression coverage for owner and identity replacement,
  missing published identity, absent/unreadable/malformed metadata, successful
  and vanished-lock completion, unlink and directory synchronization,
  created-directory cleanup, rollback synchronization failure, and JSON/human
  CLI rollback output.
- Add an injected rollback-unlink hook so non-`ENOENT` unlink failures are
  covered without permission-sensitive filesystem tests.

## Verification

- Validate the new EARS requirement and project constitution.
- Add authoritative acquisition-rollback tests before implementation and record
  a genuine Red/Green cycle.
- Extend the REQ-EVIDENCE-WRITER-LOCK-006 skill-content and installed-copy
  assertions without weakening their line or byte-equality contracts.
- Verify the skill edits append rollback guidance within existing lines because
  `text.split(/\r?\n/).length` reports 79 for the change and quality skills,
  leaving zero headroom under the unchanged `< 80` limit enforced by the source
  and package skill tests.
- Run focused tests, typecheck, build, full tests, strict trace, graph, changed
  gate, status, `npm run pack:check`, and `npm run pack:smoke`.

## Residual risks

- Filesystem replacement after the rollback identity observation remains
  bounded by the same path-based unlink limitation as normal release; initial
  published identity capture is descriptor-based and has no canonical-path
  lookup window.
- Windows may classify only the existing allowlisted directory-handle sync
  errors as unsupported; other rollback synchronization failures remain
  explicit.
- Empty-directory cleanup remains best-effort because those directories are not
  ownership state.
- Failure to capture the published identity deliberately retains the lock
  rather than falling back to the previous transaction-ID-only removal.
