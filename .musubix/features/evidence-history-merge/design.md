# Deterministic evidence-history merge design

## DES-EVIDENCE-HISTORY-MERGE-001: Input normalization and merge planning
Responsibilities: Add an analysis-layer merge planner that resolves the current
root and incoming real paths through
`resolveEvidenceWriterCanonicalRoot`, loads each evidence history without mutation,
performs input-local structural validation, and normalizes order records and
their dependent TDD phase, change phase/batch, and waiver payloads into source-
qualified entries. Pair payloads by their pre-merge `order` and the matching
order record's pre-merge `sequence`. Compute non-waiver order identity from
`kind`, `entityId`, `phase`, optional `testId`, and optional scope fields;
reject matching `kind`/`entityId`/`phase` records with different `testId` as
`EVIDENCE_MERGE_CONFLICT` even when both are unpaired. Compute waiver-payload
identity from its full approved semantic fields; deduplicate equivalent paired
waiver order/payload entries to the base pair; preserve only unpaired waiver
order records as sequence-distinct entries. Merge base entries first, then
incoming entries, producing a base and incoming old-sequence-to-new-sequence
map. Reuse a base non-waiver order record for an equivalent incoming identity
regardless of which side has a payload, retain the one existing payload when
only one side has one, and require canonical payload equivalence when both
exist. Reject any
incoming mapping that is not strictly increasing in incoming source order.
Interfaces: `planEvidenceMerge(root: string, incoming: string):
Promise<EvidenceMergePlan>`; shared
`resolveEvidenceWriterCanonicalRoot(root: string): string` from the writer-lock
module; `EvidenceMergePlan` contains normalized source
summaries, old-to-new order maps, merged payload arrays, diagnostics,
`preserved`/`deduplicated`/`appended` order-record counts, per-file change
status, and a revalidation-required flag.
Constraints: The incoming path is read-only and must be real-path-disjoint from
the current root. Canonical comparison removes only reconstructed sequence,
order, and hash-link fields and preserves all other known and unknown
properties. Existing base entries and unpaired order records do not create new
worktree-presence obligations. The planner owns the fatal
`EVIDENCE_MERGE_WORKTREE_INCOMPLETE` check for newly introduced incoming change
and waiver payloads, using their source provenance before entity union.
`preserved` counts every retained base order record, including records reused
for deduplication; `appended` counts incoming order records assigned new
sequences; `deduplicated` is a subset of `preserved`; and `preserved +
appended` equals the merged order-record count. Retaining any incoming payload,
even when its order record deduplicates to a base sequence, or appending any
incoming order record sets the revalidation-required flag because array-
position or latest-selection behavior can change.
Requirements: REQ-EVIDENCE-HISTORY-MERGE-001 REQ-EVIDENCE-HISTORY-MERGE-003 REQ-EVIDENCE-HISTORY-MERGE-005
ADRs: ADR-0029

## DES-EVIDENCE-HISTORY-MERGE-002: Deterministic evidence reconstruction
Responsibilities: Materialize an `EvidenceMergePlan` into four in-memory
candidates. Rebuild `order.json` with consecutive sequence numbers and the
repository's existing order-record property order and hash function. Rewrite
all retained TDD/change/waiver payload `order` fields through their source map.
Merge TDD entities by `cycleId`: require equal header fields, retain the base
array position, and union Red/Green/Refactor/Migrate/Void phases by their logical
phase identity. Merge change entities by `changeId`: require equal top-level
requirement IDs, retain the base array position, union singular phases, merge
persisted `tddBatches` by sorted requirement-batch key only when that key is
unique within each input, and union phases within each matched batch. The
synthesized legacy full-set batch from `change.phases` does not participate in
persisted-batch matching. If either side has multiple persisted batches for a
key that must be matched, fail with `EVIDENCE_MERGE_CONFLICT` naming
`<changeId>:<batchKey>`. Retained base batches keep their array positions and
distinct incoming batches append in incoming relative order. Reject duplicate
cycle/change IDs within either input or the merged candidate. Rebuild TDD
`phaseEvidenceSha256` and chain sequence/link/hash fields in base chain order
followed by distinct incoming chain order, where chain identity is
`(cycleId, phase)` and exactly one chain record must correspond to every
retained phase. Reject missing, extra, or duplicate chain identities instead of
silently regenerating them. Rebuild waiver payload sequence/link/hash fields in
stable base-first order while preserving
approver, reason, `recordedAt`, snapshot version, and `snapshotHash`. Rewrite
values in place so every untouched parsed base object's original key order and
hash remain unchanged; use the repository's documented property order only for
newly constructed objects. Preserve unknown properties and their relative
property order. Run dedicated structural candidate checks for the diagnostic
families enumerated by the requirements. Treat the planner's newly introduced
incoming-payload worktree check as fatal; derive stale-waiver and other
pre-existing worktree-dependent reports, plus waiver conditions that the merge
itself resolves (including `CHANGE_RECORD_MISSING` superseded by merged
chronology), as non-fatal follow-up diagnostics.
Interfaces: `buildEvidenceMergeCandidates(plan: EvidenceMergePlan):
EvidenceMergeCandidateResult`, where the result contains `candidates` and
`candidateDiagnostics: Array<{ code: string; file: string; identity: string;
message: string }>`; pure structural helpers extracted from existing
order, TDD, change, and waiver validation modules accept in-memory candidates
rather than rereading the worktree;
`evaluateMergedWaiverState(root: string, base: EvidenceHistory,
candidates: EvidenceMergeCandidates): Promise<{ stale:
EvidenceMergeStaleWaiver[]; supersededScopes: EvidenceMergeWaiverScope[];
followUpDiagnostics: Diagnostic[] }>`
combines read-only worktree context with base and merged in-memory evidence and
is consumed identically by dry-run and real merge.
Constraints: Candidate construction is deterministic for byte-identical inputs
and must complete before transaction creation. It must not use `recordedAt` to
order records or recompute approval-bearing waiver snapshots. Fixed
serialization order applies only to newly constructed known fields; every other
field is copied verbatim. When an incoming history contributes no new order
record or payload, the four base target byte strings and hashes remain
byte-identical and every per-file summary is `unchanged`. When base
`change-waivers.json` is absent and the merged waiver set is empty, the target
remains absent, no waiver candidate is applied, and its summary is `unchanged`;
a non-empty merged waiver set creates the file and records original absence in
the transaction. Candidate structural validation additionally checks, within
each retained change, that Quality is after every persisted-batch Red and
Implementation order, emitting `EVIDENCE_MERGE_QUALITY_ORDER` for each
offending `<changeId>:<phase>`; existing `CHANGE_PHASE_ORDER` remains the sole
Quality-versus-Green diagnostic.
Requirements: REQ-EVIDENCE-HISTORY-MERGE-002 REQ-EVIDENCE-HISTORY-MERGE-003 REQ-EVIDENCE-HISTORY-MERGE-005
ADRs: ADR-0029
Depends-On: DES-EVIDENCE-HISTORY-MERGE-001

## DES-EVIDENCE-HISTORY-MERGE-003: Journaled apply and explicit recovery
Responsibilities: Add an evidence merge transaction manager. Transaction file
durability uses a dedicated writable-handle `fsyncFile` helper while directory
durability remains a separate read-only-handle `fsyncDirectory` helper. After planning
and candidate validation, create `.musubix/evidence/.merge-transaction.json`
through an atomically published, exclusively linked prepared-journal file with
schema version, transaction ID, `prepared` state, target existence, original
and candidate bytes encoded losslessly, original/candidate hashes, and
temporary sibling paths. Fsync the prepared journal and evidence directory
before writing targets. Write and fsync every temporary candidate, replace each
target, fsync `.musubix/evidence`, then update and fsync the journal and
directory with a `committed` marker containing every candidate digest before
cleanup. On handled failure, restore original bytes or absence and remove owned
temporary files. `--recover` rolls back a prepared journal; for a committed
journal it structurally validates the journaled candidate bytes, verifies every
target against the marker digest, and rewrites any missing/mismatched target
from those bytes before fsync, revalidation, and cleanup. A recoverable write
failure preserves the journal for retry. An interrupted unpublished journal-
staging file implies no target mutation and is removed only by `--recover`;
normal merge and dry-run report `EVIDENCE_MERGE_RECOVERY_REQUIRED`. An invalid
published journal reports
`EVIDENCE_MERGE_RECOVERY_UNSAFE` with the journal path, merge-owned file
inventory, and manual backup/restore/quarantine/revalidation procedure without
guessing or mutating recovery state. Structurally invalid journaled candidate
bytes or verification that still fails after rewrite uses the same unsafe
recovery path rather than retrying; only transient I/O/write failures are
retryable. Enforce the pending-journal guard in
shared analysis I/O choke points
for reads/writes under `.musubix/evidence` (including `readText`/`writeText` and
audited direct-I/O exceptions in workflow append/replace, gate/TDD cleanup,
native adapter report handling, attestation, and approval evidence paths), with
private unguarded primitives used only by planning, transaction, and recovery
internals. Evidence-touching CLI actions also invoke the guard at action entry
to prevent non-evidence side effects before the I/O backstop runs.
Evidence-directory enumerators ignore merge-owned journal staging and temporary
files.
Interfaces: `applyEvidenceMerge(root: string, candidates:
EvidenceMergeCandidates): Promise<void>`; `recoverEvidenceMerge(root: string):
Promise<EvidenceMergeRecoveryReport>`; `assertEvidenceMergeReady(root: string):
Promise<void>` checks only the canonical published journal for general evidence
I/O; `assertEvidenceMergeStartable(root: string): Promise<void>` checks both the
canonical journal and unpublished staging for normal merge and dry-run entry.
Recovery bypasses both guards and interprets the recovery files directly.
Internal tests may inject failures at journal staging, publication, directory
fsync, every temporary write, target replace, commit-marker, roll-forward
verification, and cleanup boundaries.
Constraints: `fsyncFile` opens already-written journal, candidate, and recovery
staging files with `r+`, syncs, and closes without error suppression.
`fsyncDirectory` never delegates to `fsyncFile`; it retains the existing
platform/error policy, whose broader correction is tracked by #43.
Deterministic transaction tests inject file- and directory-sync recorders,
assert every expected file sync, and assert directory sync remains invoked
after the helper split rather than merely observing overall success. Dry-run never creates a journal or temporary file. Candidate
validation cannot run after the transaction begins through guarded public
loaders; transaction internals operate only on already-built bytes and explicit
paths. Journal creation uses exclusive creation to avoid two merge transactions
claiming the same recovery state, without generalizing this phase into the
separate concurrent-writer locking work planned later in Issue #28.
Requirements: REQ-EVIDENCE-HISTORY-MERGE-004 REQ-EVIDENCE-HISTORY-MERGE-005
ADRs: ADR-0030
Depends-On: DES-EVIDENCE-HISTORY-MERGE-002

## DES-EVIDENCE-HISTORY-MERGE-004: CLI, diagnostics, and operator report
Responsibilities: Register `evidence merge` with mutually exclusive normal
`--incoming <directory>` and recovery `--recover` modes plus `--dry-run` for
normal mode. Normal and dry-run modes invoke the same planner and candidate
builder; only normal mode applies the transaction. Render stable JSON and human
reports containing order-record counts, per-file changed status, conflict
identity, worktree-incomplete details, candidate-invalid underlying diagnostics,
non-fatal follow-up diagnostics, stale-waiver entries, affected waiver-
supersession scopes, transaction recovery result, and
`EVIDENCE_MERGE_REVALIDATION_REQUIRED` whenever an incoming order record is
appended or an incoming payload is retained. Document the
contract and recovery procedure in CLI help, `README.md`, and `README-ja.md`.
Document that stale waiver snapshots are expected after many real merges, make
their formerly waived errors active again, and require normal waiver
re-approval before release readiness. Document that workflow, approval,
quality, formal, mutation, correspondence, performance, attestation, native
test-report, and other evidence files outside the four merge targets are not
merged and require their existing regeneration or conflict-resolution
workflows. CLI help and both READMEs explicitly cover canonical duplicate
comparison, stable base-first ordering, possible `recordedAt` warnings,
dry-run usage, stale-waiver behavior, post-merge revalidation, recovery, and
unsafe manual remediation.
Interfaces: `musubix3 evidence merge --incoming <directory> [--dry-run]`;
`musubix3 evidence merge --recover`; JSON result types
`EvidenceMergeReport | EvidenceMergeRecoveryReport`.
Constraints: Conflicts, incomplete worktree inputs, and candidate-invalid
results exit nonzero without creating transaction files. Candidate-invalid
report entries carry `{ code, file, identity, message }` for every underlying
diagnostic. Human output must never claim release readiness;
it directs the operator to rerun normal gate/status validation and explicitly
re-approve any stale waiver, and notes that missing incoming test/source files
can surface only during post-merge validation. `--recover` rejects `--incoming`
and `--dry-run`; normal mode requires exactly one `--incoming`. Recovery with
no journal or staging file exits successfully with a deterministic
`nothing-to-recover` report; staging-only recovery sets
`discardedStaging: true`, while normal merge reports recovery-required and does
not remove another transaction's unpublished staging. Dry-run uses the same
recovery-required/no-write result for canonical-journal or staging-only states.
Help and both READMEs
include candidate-invalid Quality-order remediation and the unsafe-journal
manual remediation procedure required by REQ-EVIDENCE-HISTORY-MERGE-004.
Requirements: REQ-EVIDENCE-HISTORY-MERGE-001 REQ-EVIDENCE-HISTORY-MERGE-004 REQ-EVIDENCE-HISTORY-MERGE-005
ADRs: ADR-0029 ADR-0030
Depends-On: DES-EVIDENCE-HISTORY-MERGE-001 DES-EVIDENCE-HISTORY-MERGE-002 DES-EVIDENCE-HISTORY-MERGE-003
