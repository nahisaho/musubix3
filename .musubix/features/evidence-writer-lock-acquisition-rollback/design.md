# Safe evidence writer-lock acquisition rollback design

## DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001: Verified acquisition rollback
Responsibilities: Capture the published canonical lock's device/inode identity
immediately after hard-link publication and before directory synchronization.
If any post-publication acquisition step fails, normalize the primary error to
`EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED`, then run one fail-closed rollback that
re-reads owner metadata, re-observes device/inode identity, and unlinks only
when canonical root, transaction ID, device, and inode all match. Treat absent
metadata and `ENOENT` from unlink as completed rollback. After a successful
unlink, synchronize the evidence directory with the existing
`allow-unsupported` release policy. Track `publicationRemoved` separately from
the existing `published` flag so created-directory cleanup can run without
changing staging-unlink error precedence. Set `publicationRemoved` only when
rollback is completed: the lock was already absent, vanished with `ENOENT` at
unlink, or was unlinked and the required directory sync succeeded. It remains
false after post-unlink sync failure even though that rollback error reports
`lockRemoved: true`.
Interfaces: Extend `EvidenceWriterLockDependencies` with
`publishedLockIdentity?: (descriptor: number) => EvidenceWriterLockIdentity`
and `rollbackUnlink?: (path: string) => Promise<void>` for deterministic
capture and rollback tests; add a private
`rollbackPublishedLock(path, directory, expectedCanonicalRoot,
expectedTransactionId, publishedIdentity: EvidenceWriterLockIdentity |
undefined,
dependencies): Promise<{ completed: true } | { completed: false;
error: EvidenceWriterLockError }>` helper. The helper uses the existing
`observeLock` helper, whose production default uses one atomic open-handle
observation and whose injected path uses the existing
`lockOwner`/`lockIdentity` pair, plus `platform`, `syncEvidenceDirectory`, and
the production `unlink` default.
`acquireEvidenceWriterLock` keeps the staging descriptor open through hard-link
publication, captures identity from that descriptor before publication sync,
preserves the original failure as the primary cause, and passes any rollback
failure to the error component. When published identity capture fails, rollback
still attempts an owner-only read for reporting: a matching canonical
root/transaction uses own-acquirer guidance, a mismatch uses foreign-replacement
guidance, and an unreadable owner uses unavailable-metadata guidance. The
existing `removeOwnPublishedLock` helper is removed.
Constraints: Descriptor-based capture relies on the hard link and staging path
referring to the same inode and avoids a second canonical-path resolution.
Missing published identity is a rollback failure and never permits
transaction-ID-only removal. Existing metadata must parse completely.
Verification requires canonical root, transaction ID, device, and inode.
`ENOENT` during verification or unlink is success without directory sync.
Other metadata, identity, and unlink failures retain the lock and report
`lockRemoved: false`. A post-unlink sync failure reports `lockRemoved: true`
without claiming crash durability. Only the existing Windows `EPERM`, `EINVAL`,
and `ENOTSUP` directory-handle sync errors are suppressible. Empty-directory
cleanup remains best-effort and only removes levels recorded as created by this
acquisition. Identity capture is deliberately before publication-directory sync
so the common sync-failure path remains safely removable; the second identity
observation is the rollback verification observation, and stateful test
dependencies may return a replacement identity for it.
Requirements: REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
ADRs: ADR-0031

## DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-002: Structured rollback failure reporting
Responsibilities: Preserve every post-publication acquisition failure as one
primary `EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED` error while attaching at most one
typed rollback failure. Expose rollback state consistently to analysis callers,
JSON CLI callers, and human CLI callers without changing successful acquisition
or rollback output.
Interfaces: Add `EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED` to
`EvidenceWriterLockErrorCode`. Extend `ErrorOptions` and
`EvidenceWriterLockError` with public
`rollbackError?: EvidenceWriterLockError` and `lockRemoved?: boolean`, while
the class declares `readonly rollbackError: EvidenceWriterLockError |
undefined` and `readonly lockRemoved: boolean | undefined` for
`exactOptionalPropertyTypes`. A dedicated rollback-error factory requires
`lockRemoved: boolean`; primary errors set `rollbackError` only when rollback is
incomplete. JSON output adds
`error.rollbackError` with `code`, `message`, `lockPath`, `lockRemoved`,
optional `owner`, projected `cause`, and optional `guidance`. Human output keeps
the existing primary stderr line and appends rollback code, message,
lock-removed state, and each guidance line to stderr.
Constraints: The primary error cause is the original post-publication failure,
including an already typed lock error. An Error cause projects to
`{ name, message, code? }`; another defined value projects to `{ message }`.
Pre-unlink failures state that the lock may remain and include any readable
replacement owner. Post-unlink sync failures state that the path is absent now
but crash durability is unconfirmed. Successful rollback has no
`rollbackError`. Error rendering must not recurse through nested rollback
errors. The existing non-enumerable `evidenceWriterReleaseError` convention is
intentionally unchanged by this defect fix.
Requirements: REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
ADRs: ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001

## DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-003: Operator and agent recovery guidance
Responsibilities: Document how an operator or SDD agent responds to
`EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED` using its exact lock path and
`lockRemoved` state. Keep source documentation, command help, distributed
skills, and installed package copies consistent.
Interfaces: Update README.md, README-ja.md, the `evidence unlock --recover`
help block in `packages/cli/src/main.ts`, and the rollback-error guidance
constructed in `packages/analysis/src/evidence-writer-lock.ts`,
`.github/skills/sdd-change/SKILL.md`,
`.github/skills/sdd-implementation/SKILL.md`, and
`.github/skills/sdd-quality/SKILL.md`. Extend the authoritative skill-content
test and package smoke byte-equality coverage. Distribution verification runs
`npm run pack:check` for the packaged file set and `npm run pack:smoke` for
installed byte equality; a dry-run file list alone is not packed-copy proof.
Constraints: For `lockRemoved: false`, guidance distinguishes the failed
acquisition's own readable owner, which may be a failed acquirer with no lease
and will not release the retained lock, from unavailable owner metadata that
requires direct inspection of the exact path, and from a readable
root/transaction/device/inode mismatch that identifies a foreign replacement
lock which must not be removed as failed-acquirer cleanup. Automatic
`evidence unlock --recover` is preferred after the failed acquirer exits. While
it remains live, or when automatic recovery is unsafe,
operator review must first confirm no related acquisition is active before
targeted manual removal of only the exact reported path. For
`lockRemoved: true`, inspect only the exact path because current absence is
known but crash durability is not. Guidance never permits blind deletion,
force stealing, polling, or automatic retry loops. Each distributed skill
remains below its existing 80-line limit by appending rollback semantics within
existing lines so the measured line count remains unchanged; the limit is not
raised. Installed copies remain byte-identical to source.
Requirements: REQ-EVIDENCE-WRITER-LOCK-006 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
ADRs: ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-002
