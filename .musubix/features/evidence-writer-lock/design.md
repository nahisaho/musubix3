# Fail-fast evidence writer coordination design

## DES-EVIDENCE-WRITER-LOCK-001: Atomic root-scoped lock lifecycle
Responsibilities: Add a low-level lock manager that resolves the project root
with `realpath`, creates `.musubix/evidence` when needed, constructs complete
owner metadata, writes and fsyncs a same-directory transaction-qualified
staging file, and publishes it without replacement by hard-linking it to
`.musubix/evidence/.writer-lock.json`. Interpret `EEXIST` as contention; map
other publication failures to `EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED`. Keep the
span from exclusive staging-file creation through file sync, hard-link
publication, and synchronous containing-directory synchronization await-free.
After a successful link and synchronization, unlink the staging name; every
losing or failed acquisition also removes only its own staging name in
`finally`. On
release at a zero reference count, re-open and validate the lock, require the
canonical root, transaction ID, and device/inode identity observed for that
opened file to remain unchanged immediately before unlink, unlink it, and
synchronize the evidence directory asynchronously.
Exclude the canonical lock and publication staging prefix from Git inputs,
approval manifests, attestation inputs, trace inputs, evidence hashes, and
generated-artifact scans.
Interfaces: `acquireEvidenceWriterLock(root: string, command: string,
dependencies?: EvidenceWriterLockDependencies): Promise<EvidenceWriterLease>`;
`EvidenceWriterLease.release(): Promise<void>`; `readEvidenceWriterLock(root:
string): Promise<EvidenceWriterLockState>`; metadata schema
`{ schemaVersion, canonicalRoot, command, pid, hostname, acquiredAt,
transactionId, processFingerprint }`; optional
`EvidenceWriterLockDependencies` members `platform?: () => NodeJS.Platform`,
`syncEvidenceDirectory?: (path: string, policy:
EvidenceDirectorySyncPolicy) => Promise<void>`, and
`syncEvidenceDirectorySync?: (path: string, policy:
EvidenceDirectorySyncPolicy) => void`, where `EvidenceDirectorySyncPolicy` is
`'allow-unsupported' | 'strict'`, in addition to release-time owner reads and
device/inode observations; private lease state
containing the device/inode identity captured from the published canonical lock
and booleans recording whether this acquisition created the project root,
`.musubix`, or `.musubix/evidence`. Production defaults are selected with `??`;
tests construct optional dependency objects with conditional spread rather than
passing explicit `undefined`.
Constraints: The lock manager uses direct private filesystem primitives and
must not call guarded evidence helpers. Publication must never expose a
zero-length or partially written canonical lock. The staging file and hard link
must be on the same filesystem. Unsupported hard-link or durability behavior is
an acquisition failure, not a fallback to non-atomic `open` plus `write`, except
that shared capability classification treats only Windows `EPERM`, `EINVAL`,
and `ENOTSUP` from syncing an already-open directory handle as unsupported.
`syncDirectory` and `syncDirectorySync` take one
`EvidenceDirectorySyncPolicy`; suppression is exactly
`policy === 'allow-unsupported'`, and the same policy value is forwarded to the
injected callback. The synchronous publication and asynchronous release call
sites pass `allow-unsupported`; recovery synchronization passes `strict`. The
helper never suppresses staging-file synchronization, directory open or close,
hard-link, metadata verification, unlink, non-Windows, or other filesystem-code
failures. The injected `platform`
governs directory-sync capability only; owner metadata and recovery support
continue to use the existing `processFingerprint` dependency.
Release never removes absent, unreadable, mismatched, malformed, or replaced
metadata. A release failure after successful work is primary; after failed work
it is attached as structured secondary context without replacing the operation
error.
An operation failure remains the primary error if release also fails; the
release failure is attached as structured secondary context instead of
replacing the original cause.
Publication staging names are exactly
`.musubix/evidence/.writer-lock.<transactionId>.json`. Abrupt termination before
publication can leave an unlinked staging file; it is harmless, excluded from
all scans, never interpreted as ownership, and deliberately not removed by
another process because that process cannot prove whether publication is still
in flight. Documentation permits targeted cleanup only after confirming no
related process is active. Acquisition errors retain the original Node/system
error as structured `cause`, including its filesystem error code.
After release or failed acquisition, remove only directory levels recorded as
created by that acquisition and only when empty. Cleanup is best-effort:
`ENOENT`, `ENOTEMPTY`, and permission failures do not replace the operation or
release result because the directories are not lock ownership state.
Requirements: REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-004
ADRs: ADR-0031

## DES-EVIDENCE-WRITER-LOCK-002: Async owner context and guarded access
Responsibilities: Add an `AsyncLocalStorage` owner context containing an
unforgeable symbol token and a canonical-root lease map. Provide one coordinator
that synchronously installs a root-keyed in-flight acquisition promise before
the first `await`, lets later same-token sibling requests await that promise,
increments a reference count for every successful reentrant/sibling lease, and
releases the filesystem lock only when the count reaches zero. Nested
`withEvidenceWriterLock` calls reuse the existing store and token; only a
top-level call creates a new store. Add guards for coordinated reads and
owner-required writes. Compose writer-lock checks before the existing
evidence-merge-ready check so contention has deterministic precedence. Require
protected evidence/order/workflow/report/trace/cache write choke points to find
the matching owner context; fail context loss before I/O.
Interfaces: `withEvidenceWriterLock<T>(root: string, command: string, operation:
() => Promise<T>, dependencies?: EvidenceWriterLockDependencies): Promise<T>`;
`assertEvidenceWriterOwned(root: string):
Promise<void>`; `assertCoordinatedEvidenceRead(root: string): Promise<void>`;
`assertProtectedPathReady(root: string, path: string, access: 'read' | 'write'):
Promise<void>`; internal `EvidenceWriterContext` and root-keyed
`EvidenceWriterLeaseState`.
Constraints: Tokens are never serialized or accepted from callers. Same-process
calls outside the active async context are unrelated contenders. Context loss
on an owner-required path reports `EVIDENCE_WRITER_CONTEXT_LOST`; it never
silently reacquires or bypasses the guard. Child processes and worker threads
do not inherit ownership. A different canonical root receives an independent
lease. Every guard canonicalizes its root through a shared positive `realpath`
cache scoped to the current owner/reader operation before comparing ownership;
the cache never stores failed lookups and is discarded when the operation
finishes, so a later symlink retarget is resolved again. Absolute-path guards derive the same
canonical root rather than slicing an unresolved path. The protected-path
predicate is `.musubix/evidence/**`, `.musubix/cache/**`,
`.musubix/features/*/trace.json`, and configured report paths explicitly
loaded from `.musubix/config.json` by the operation scope; requirements,
designs, ADRs, constitution, configuration, and skill source paths are not
protected merely because `writeText` writes them. Coordinated readers perform one lock check per
canonical root at operation entry, immediately before their first protected
read, and do not mutate or remove the lock; a coordinated read for a root
already owned by the active async context succeeds without self-contention.
Hot per-file reads reuse that
operation check instead of repeating `realpath` and lock I/O. If owner metadata
is unreadable during acquisition contention or a coordinated-reader entry
check, the operation performs at most one immediate re-read; a still unreadable lock reports
`EVIDENCE_WRITER_LOCKED` with unknown fields, while persistent malformed
metadata is left for explicit recovery.
An entry-check failure that does not establish an existing canonical lock maps
to `EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED` and preserves the underlying cause;
only a confirmed-existing but unreadable lock maps conservatively to
`EVIDENCE_WRITER_LOCKED`.
If the root's in-flight acquisition rejects, the coordinator removes that exact
promise entry before propagating the error; the stored promise has an attached
rejection handler from creation so an acquisition failure cannot poison later
calls or become an unhandled rejection.
Requirements: REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-003
ADRs: ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-001

## DES-EVIDENCE-WRITER-LOCK-003: Operation classification and entry integration
Responsibilities: Wrap every writer operation listed by
REQ-EVIDENCE-WRITER-LOCK-001 at its analysis-layer entry point so direct library
callers and CLI callers share the same coordination. Acquire before loading
evidence that informs a mutation, clearing configured reports, launching a
configured command, or touching output. Maintain one exhaustive CLI
classification registry, verified by a test that fails when a registered leaf
command is missing:

| Class | CLI leaf operations |
| --- | --- |
| Writer | `init`/`install` unless `--dry-run`; `upgrade` unless `--dry-run`; `trace build`; `graph index`, `graph gate`; `knowledge build`; `formal check`, `formal generate`; `gate`; `evidence refresh`; `evidence merge` except `--dry-run`, including `--recover`; `workflow-record`; `workflow-verify`; `workflow waiver record`, `record-all`; `change-record` except `--dry-run`; `change waiver record`; `approval record`; `tdd red`, `green`, `refactor`, `migrate`, `void` |
| Coordinated reader | `init`/`install --dry-run`; `upgrade --dry-run`; `design validate`, `design c4`; `trace check`, `trace impact`; `graph impact`, `graph cycles`; `knowledge query`; `evidence merge --dry-run`; `mutation validate`; `model-correspondence validate`; `attestation payload`, `attestation verify`; `change-record --dry-run`; `approval prepare`, `approval validate`; `tdd validate`; `status` |
| Exempt from project evidence coordination | help/version; `plugin-install`; `requirements validate`, `requirements scaffold`; `constitution validate`; `design scaffold`; `formal doctor`; `config lint`, `config scaffold`; `mutation doctor`, `mutation identity`; `workflow-sanitize`; `attestation oidc-audience`; `evidence unlock --recover` |

Add owner assertions to direct-I/O exceptions in install/upgrade, gate/TDD report
cleanup, native adapters, order append, workflow replacement, formal cache
generation, trace/graph/knowledge output, approval evidence,
mutation/performance/model-correspondence evidence, and evidence merge.
Maintain a separate exhaustive registry of exported analysis APIs with
project-artifact side effects and assert that each establishes a writer scope.
Interfaces: Existing public analysis functions retain their result types and
gain internal calls to `withEvidenceWriterLock`,
`assertEvidenceWriterOwned`, or `assertCoordinatedEvidenceRead`; configured
command/report helpers accept the canonical root or an owner-bound execution
context where needed.
Constraints: A rejected contender performs no project side effect, including
directory creation outside lock publication, report deletion, child-process
launch, cache replacement, or order append. Existing command semantics and
diagnostics remain unchanged when no contention exists. Operations that call
other protected operations rely on reentrancy rather than adding bypass flags.
Each CLI leaf action establishes one writer, coordinated-reader, or exempt
operation scope before invoking analysis code; analysis-layer entries reuse an
already-active matching scope and create one only for direct library callers.
The registry classifies every leaf and every resolved option-dependent mode
exactly once before invoking analysis code; any dry-run mode without
project-artifact side effects is a coordinated reader.
Commander or action-level option-validation failures occur before scope
establishment, acquire no lock, and are excluded from the valid-mode registry.
Commands exempt from evidence coordination may write only their named source
artifacts or explicitly caller-selected non-project outputs. An exempt command
with an output path loads `.musubix/config.json` only to resolve configured
report paths for this rejection check; this read is uncoordinated and acquires
no lock. A caller-selected output that
resolves inside the static protected paths or a configured report path is
rejected before writing with `EVIDENCE_PROTECTED_OUTPUT_REJECTED`; this is an
invalid output target, not lock contention. If an exempt path otherwise begins
reading or writing protected state, its classification test must be changed.
Only successful lock publication may create the lock container; coordinated
readers and losing contenders do not create it. Release removes directories
created solely for lock publication when they remain empty and leaves
pre-existing directories intact.
Requirements: REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-003
ADRs: ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-002

## DES-EVIDENCE-WRITER-LOCK-004: Safe stale-lock recovery and merge ordering
Responsibilities: Implement explicit recovery with injectable host identity,
process fingerprint, and liveness probes. On Linux, record boot identity and
the process start-time field and PID-namespace identity used to distinguish PID
reuse and container namespaces. On platforms where equivalent fingerprint data
is unavailable, record that limitation and refuse automatic removal when it
prevents a conclusive match. Recovery and lock inspection use DES-001's direct
private filesystem primitives and never invoke the merge-ready/path guards, so
a pending merge journal cannot mask lock recovery. Recovery opens and reads the
lock with `fstat`, classifies no-lock/live/dead/unsafe outcomes, requires a final
`lstat` device/inode and transaction-ID match immediately before removal, and
returns structured owner and guidance fields. Integrate evidence merge so
normal merge and merge recovery first acquire the destination lock, while
dry-run merge first coordinated-read-checks the destination. Every mode then
checks the incoming root as a coordinated reader before loading it. Keep
writer-lock recovery independent of merge-journal files.
Interfaces: `recoverEvidenceWriterLock(root: string, dependencies?:
EvidenceWriterRecoveryDependencies): Promise<EvidenceWriterRecoveryReport>`;
`EvidenceWriterRecoveryReport` actions `nothing-to-recover | recovered`;
stable errors `EVIDENCE_WRITER_LOCKED`,
`EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`; existing
`mergeEvidenceHistories`/`recoverEvidenceMerge` call the coordinator in the
required order. Linux production dependencies provide boot-ID, process-start,
PID-namespace, and liveness probes; other platforms return an unsupported
fingerprint and cannot automatically recover.
Constraints: Recovery has no force mode and never evaluates a remote PID.
Different hostname/boot identity/PID namespace, PID reuse, malformed metadata,
unavailable required fingerprint data, indeterminate liveness, changed
transaction ID, or changed device/inode causes no mutation. Linux recovery uses
hostname, `/proc/sys/kernel/random/boot_id`, `/proc/<pid>/stat` process start,
and `/proc/<pid>/ns/pid` identity. A matching boot/PID namespace with an absent
PID is recoverable; when the PID is alive its start identity must match to be
reported live, and a mismatch is PID reuse and unsafe. macOS and Windows report
automatic recovery unsupported until equivalent boot, process-start, and PID
namespace/session probes exist; they provide inspection guidance without
mutation. Guidance names only the exact canonical lock path and requires
inspection before targeted removal. A writer-lock conflict wins over
`EVIDENCE_MERGE_RECOVERY_REQUIRED`; after safe lock recovery, merge recovery
retains all ADR-0030 semantics. A merge-recovery contender rejected by the
writer lock performs no merge-journal read, rewrite, staging scan, or cleanup,
so the journal remains byte-identical.
Requirements: REQ-EVIDENCE-WRITER-LOCK-004 REQ-EVIDENCE-WRITER-LOCK-005
ADRs: ADR-0030 ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-001 DES-EVIDENCE-WRITER-LOCK-002

## DES-EVIDENCE-WRITER-LOCK-005: CLI diagnostics, tests, and operator contract
Responsibilities: Add `evidence unlock --recover`, JSON and human renderers for
lock owner/recovery results, and command help. Add deterministic process tests
using a barrier-controlled helper process, plus unit tests with injected
identity/liveness, release metadata-read/device-inode, and acquisition-fault
probes, including unsupported-platform fingerprint refusal. Platform
classification and synchronous/asynchronous evidence-directory synchronization
are also injectable. Cover Windows publication and release
directory-sync `EPERM`, `EINVAL`, and `ENOTSUP` as successful unsupported-
capability outcomes; cover every other platform/code and every file-sync,
open/close, link, metadata, and unlink failure as fail-closed. Cover exhaustive
CLI leaf/mode classification, one-winner contention,
zero loser side effects, `status` coordinated-reader rejection, `graph gate`
ownership before codegraph replacement, same-token reentrancy
and concurrent siblings, context loss, handled-failure release, independent
roots, atomic metadata visibility, acquisition failures, safe dead-owner
recovery on Linux, live/PID-reused/cross-host/malformed/indeterminate refusal,
zero-reference release, release mismatch after successful and failed work,
final transaction-ID/device-inode rechecks, incoming-root contention, and
lock/journal precedence. Also cover exempt protected-output rejection and
foreign-lock behavior for `requirements validate`, `workflow-sanitize` to an
unprotected output, and `evidence unlock --recover`, with
`EVIDENCE_WRITER_LOCKED` on recovery-capable platforms and
`EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE` on macOS and Windows before liveness
classification. The injected unsupported-platform test is the deterministic
proof; TEST-EVIDENCE-WRITER-LOCK-017 retains a platform-conditional real-CLI
assertion only as platform confirmation.
Add a deterministic policy-observation test proving publication and release
pass `allow-unsupported`, recovery passes `strict`, and a hypothetical Windows
`EPERM` at the recovery synchronization site remains fail-closed as
`EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`; assert the stable code rather than the
pre-existing post-unlink narrative, and do not imply that production Windows
recovery can pass fingerprint validation.
Update README.md, README-ja.md, and `.gitignore`; the ignore rules cover the
canonical lock, transaction-qualified lock-publication temporaries, and merge
transaction staging files.
Interfaces: `musubix3 evidence unlock --recover [--json]`; structured errors
carry `code`, `lockPath`, readable owner fields or explicit `unknown` values,
and a structured underlying `cause` for acquisition failures; test-only
dependencies are supplied through analysis APIs rather than environment-
variable timing sleeps. Bare `evidence unlock` is rejected by Commander as a
missing required recovery mode and performs no inspection or mutation.
Add a documentation-coverage test annotated
`@verifies REQ-EVIDENCE-WRITER-LOCK-001` that asserts the Windows durability and
inspection-only recovery boundary in README.md, README-ja.md, and
`evidence unlock --help`.
Constraints: Tests synchronize with IPC or filesystem barriers and do not use
elapsed-time races as correctness evidence. Human output never recommends
force stealing. Documentation states the exact lock path, command
classification, fail-fast behavior, filesystem atomicity assumption,
the Windows directory-entry durability boundary and inspection-only automatic
recovery behavior, external-command limitation,
exact unlock-then-merge recovery order, unsafe cross-host/malformed/PID-reuse
handling, targeted manual remediation, and abandoned publication-staging-file
semantics. It also states the Linux-only automatic
recovery capability, the inspection-only behavior on unsupported platforms, and
the coordinated-reader limitation: a reader fails when a writer already owns
the lock but does not prevent a writer from starting after the reader's single
entry check. Documentation also warns that configured commands launched by a
lock-owning gate/TDD operation run in child processes without owner context; a
configured command that recursively invokes a musubix3 writer or coordinated
reader against the same root fails with `EVIDENCE_WRITER_LOCKED` and must be
reconfigured. The formal checker's unsupported result for these concurrency
requirements is reported as skipped/unsupported, never as a behavioral proof.
The CLI defines a typed writer-lock error recognized by the top-level handler;
JSON output preserves its stable `code`, `lockPath`, owner fields, and
structured cause instead of rewriting it as generic `CLI_ERROR`. Invalid exempt
outputs use `EVIDENCE_PROTECTED_OUTPUT_REJECTED` and do not claim an owner
conflict. Existing tests that seed protected files through `writeText` or
`writeJson` are migrated to a shared test fixture helper that performs seeding
inside `withEvidenceWriterLock`; production guards are not disabled and no
public bypass flag is added. Release scripts that write attestation evidence
through raw filesystem APIs remain external/uncoordinated and are called out by
the existing external-command limitation rather than represented as a CLI
writer.
Requirements: REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-003 REQ-EVIDENCE-WRITER-LOCK-004 REQ-EVIDENCE-WRITER-LOCK-005
ADRs: ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-003 DES-EVIDENCE-WRITER-LOCK-004
