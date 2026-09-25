---
schemaVersion: 1
feature: evidence-writer-lock-recovery-durability
---
# Accurate post-unlink recovery durability reporting design

## DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001: Split recovery removal from durability reporting
Responsibilities: Keep recovery verification and unlink failure handling on the
existing fail-closed unsafe path, but move strict evidence-directory
synchronization into a separate post-unlink error boundary. Construct one typed
durability error only after unlink returns successfully so callers can
distinguish a retained or unverified lock from a currently absent lock whose
directory entry may not survive a crash.
Interfaces: Add
`EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED` to
`EvidenceWriterLockErrorCode`; add a private
`recoveryDurabilityFailed(path, owner, cause): EvidenceWriterLockError` factory
that sets `lockPath`, `owner`, `cause`, `lockRemoved: true`, and targeted
guidance. `recoverEvidenceWriterLock` keeps its success result type unchanged
and continues using the injected `syncEvidenceDirectory` dependency with the
`strict` policy.
Constraints: The unlink call remains inside the pre-existing identity-verified
recovery sequence. Any verification or unlink failure continues to use
`recoveryUnsafe` and must not be reclassified as a durability failure. Only a
failure after successful unlink uses the new code. The new message states that
the canonical path is absent now while crash durability is uncertain; it never
claims unlink failed or recommends deleting an absent lock. Recovery never
suppresses Windows directory synchronization errors. Successful synchronization
still returns the existing recovered report.
Requirements: REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
ADRs: none — this narrows the existing ADR-0031 recovery error boundary without
changing the selected coordination or filesystem strategy.
Depends-On: DES-EVIDENCE-WRITER-LOCK-004

## DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-002: Preserve structured CLI contracts
Responsibilities: Serialize and render the new top-level recovery durability
state without changing existing writer-lock error output. Keep machine-readable
and human guidance aligned with the analysis error.
Interfaces: Extend `serializeLockError` so it conditionally includes
`lockRemoved` only when defined, after the existing optional `guidance` field.
The existing explicit nested rollback assignment remains so its value and key
position stay compatible. Extend `renderEvidenceWriterLockError` so only
`EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED` appends
`musubix3: EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED (lockRemoved: true)`
and each guidance item after the existing primary stderr line. Preserve the
existing nested rollback serialization and rendering. Update README.md,
README-ja.md, and the `evidence unlock --recover` help block with the same
pre-unlink versus post-unlink distinction.
Constraints: JSON places the new state at `error.lockRemoved`; undefined values
remain omitted under `exactOptionalPropertyTypes`. The existing
`error.rollbackError.lockRemoved` field and human output for all other lock
codes remain byte-for-byte compatible. Documentation names the stable code and
does not weaken strict recovery synchronization or permit automatic retry,
force stealing, or blind deletion. The three SDD skills are not changed by this
change: they govern `EVIDENCE_WRITER_LOCKED`,
`EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`, and acquisition rollback automation,
while the new code is emitted only after explicit recovery has already removed
the lock and carries its complete retry guidance in the error itself.
Requirements: REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
ADRs: none — the existing CLI error envelope is extended conditionally.
Depends-On: DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001

## DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-003: Deterministic regression evidence
Responsibilities: Prove the filesystem state and every observable diagnostic
surface with injected synchronization failure rather than permission-sensitive
filesystem setup.
Interfaces: Add
`TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001` to the analysis lock tests
for successful unlink followed by injected strict-sync failure, asserting
`ENOENT`, the stable code, `lockRemoved: true`, owner, cause, and guidance. Add
`TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-002` to CLI integration coverage
for JSON and human rendering. Add
`TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-003` for a deterministic
pre-unlink unsafe refusal that asserts the canonical lock remains present and
unchanged. Update existing `TEST-EVIDENCE-WRITER-LOCK-026` so its injected
post-unlink `EPERM` expects the new durability code while preserving the exact
`['allow-unsupported', 'allow-unsupported', 'strict']` policy observation.
Add the new requirement annotation to TEST-026 and the existing writer-lock
documentation coverage test, then extend that documentation test to assert the stable code and
post-unlink guidance in README.md, README-ja.md, and command help. Retain the
existing successful recovery coverage.
Constraints: The Red test targets only the analysis behavior and fails against
the current combined unlink/sync catch. Tests assert the stable code and
structured fields, not only prose. The pre-unlink test compares the lock bytes
before and after the unsafe outcome. Source annotations link the error factory,
recovery branch, CLI renderer, and tests to the requirement and design IDs.
Requirements: REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
ADRs: none — test injection reuses the existing dependency seam.
Depends-On: DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001 DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-002

## DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-004: Corrective TDD lineage
Responsibilities: Add an independent assertion that the canonical lock remains
absent after the post-unlink durability failure, then record that changed
existing recovery-policy test in a fresh corrective Red/Green sequence without
changing the approved runtime behavior. Because CHANGE-0040 history is
immutable, retain its historical sequencing diagnostic and waive only that
diagnostic after CHANGE-0041 supplies the missing proof.
Interfaces: `CHANGE-0041` reuses
`REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001`, updates the focused
TEST-EVIDENCE-WRITER-LOCK-026 assertion after its design checkpoint to verify
the lock path is absent, temporarily exercises the old combined recovery error
boundary to obtain Red, then restores
DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001 and records Green. After
CHANGE-0041 reaches Quality, `change waiver record` documents that
CHANGE-0040's immutable `CHANGE_TEST_CHANGED_AFTER_RED` reflects the late
addition now covered by CHANGE-0041.
Constraints: The corrective Red is an explicit reenactment using a temporary
implementation revert, not a claim that the original implementation followed
test-first chronology. The Red is caused by the durability-code and structured
state expectations already added for CHANGE-0040; the new lock-absence
assertion is a non-discriminating invariant that passes on both the old and new
error boundaries and does not independently establish Red. No other test file
changes between corrective Red and Green. The waiver is limited to
CHANGE-0040's historical sequencing diagnostic; it does not waive failed
behavior, missing test evidence, or any CHANGE-0041 diagnostic. Full Quality
evidence is refreshed afterward.
Requirements: REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
ADRs: none — this is evidence chronology correction, not an architecture decision.
Depends-On: DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-003
