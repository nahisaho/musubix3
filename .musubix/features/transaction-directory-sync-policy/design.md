---
schemaVersion: 1
feature: transaction-directory-sync-policy
---
# Transaction directory synchronization policy design

## DES-TRANSACTION-DIRECTORY-SYNC-POLICY-001: Shared directory-sync capability policy
Responsibilities: Add one analysis-layer module that owns the directory-sync
policy vocabulary, error classifier, minimal asynchronous handle contract, and
the asynchronous open/sync/close lifecycle used by Quality refresh and evidence
merge. Classify only Windows `EPERM`,
`EINVAL`, and `ENOTSUP` as unsupported capabilities. Suppress a classified
error only when the caller selects `allow-unsupported`; propagate it under
`strict`. Keep open and close outside the synchronization catch so they always
propagate.
Interfaces:
`DirectorySyncPolicy = 'allow-unsupported' | 'strict'`, with the existing
public name `EvidenceDirectorySyncPolicy` retained as an exported type alias;
`DirectorySyncErrorClassification = 'unsupported' | 'actionable'`;
`DirectorySyncHandle = { sync(): Promise<void>; close(): Promise<void> }`;
`DirectoryOpen = (path: string, flags: 'r') => Promise<DirectorySyncHandle>`;
`classifyDirectorySyncError(cause: unknown, platform: NodeJS.Platform):
DirectorySyncErrorClassification`;
`synchronizeDirectory(path: string, policy: DirectorySyncPolicy,
openDirectory?: DirectoryOpen, platform?: () => NodeJS.Platform):
Promise<void>`. Export the policy types and functions from
`packages/analysis/src/filesystem-durability.ts` and
`packages/analysis/src/index.ts`.
Constraints: The classifier reads an errno code only from an `Error` carrying a
`code` property; non-errors and missing or unknown codes are actionable.
`synchronizeDirectory` defaults to a narrow adapter around `node:fs/promises`
`open(path, 'r')` and `process.platform`. It opens before the synchronization
catch, catches only `handle.sync()`, and closes in `finally`; consequently close
remains primary if both sync and close fail. It never handles writable-file
sync, adds a `path`, wraps an error, or retries. Source annotations link the
module to REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001.
Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
ADRs: ADR-0039

## DES-TRANSACTION-DIRECTORY-SYNC-POLICY-002: Transaction helper integration and API compatibility
Responsibilities: Replace the Quality refresh and evidence merge inline
allowlists with delegation to the shared asynchronous lifecycle using
`allow-unsupported`. Refactor evidence writer-lock asynchronous and synchronous
helpers to import the shared policy and classifier while preserving its
existing policy assignments. Keep writable-file helpers local to Quality
refresh and evidence merge.
Interfaces:
`fsyncQualityRefreshDirectory(path: string, openDirectory?: DirectoryOpen,
platform?: () => NodeJS.Platform): Promise<void>`;
`fsyncEvidenceMergeDirectory(path: string, openDirectory?: DirectoryOpen,
platform?: () => NodeJS.Platform): Promise<void>`. The writer-lock module uses
the imported `DirectorySyncPolicy` internally and re-exports the exact
`EvidenceDirectorySyncPolicy` symbol with
`export type { EvidenceDirectorySyncPolicy } from
'./filesystem-durability.js'`; it does not create a local alias declaration,
second union, or allowlist. Its existing injected
`syncEvidenceDirectory(path, policy)` and
`syncEvidenceDirectorySync(path, policy)` callbacks remain unchanged.
Constraints: Existing two-argument callers remain source-compatible and a
typed package-export test assigns each helper to the pre-change two-argument
function shape. Quality
refresh and evidence merge pass `allow-unsupported` at journal publication,
replacement durability, commit-marker publication, rollback, roll-forward,
and cleanup boundaries. Writer-lock publication, acquisition rollback, and
release remain `allow-unsupported`; recovery remains `strict`. The synchronous
writer-lock helper retains `openSync`/`fsyncSync`/`closeSync`, catches only the
`fsyncSync` call, resolves the platform thunk to a `NodeJS.Platform` value
before classification, and asks the shared classifier whether the selected
policy may suppress the error. The asynchronous shared helper performs the
same thunk-to-value conversion. Writer-lock retains its separate lifecycle
because its existing injected synchronization callbacks receive the selected
policy. No module retains a duplicate errno allowlist.
Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
ADRs: ADR-0039
Depends-On: DES-TRANSACTION-DIRECTORY-SYNC-POLICY-001

## DES-TRANSACTION-DIRECTORY-SYNC-POLICY-003: Transaction diagnostics and recovery safety
Responsibilities: Preserve helper-level original filesystem errors while
mapping failures at transaction boundaries to their established recovery
contracts. A normal transaction failure after journal publication reports
recovery-required and leaves the journal and transaction-owned files in their
actual post-failure state. An actionable rollback or roll-forward recovery
directory-sync failure reports unsafe recovery with the original message,
journal path, recovery-entry owned-path inventory, and manual verification
guidance.
Interfaces: Add private Quality refresh and evidence merge error constructors
that accept `unknown` cause and produce
`CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED`,
`EVIDENCE_MERGE_RECOVERY_REQUIRED`,
`CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE`, or
`EVIDENCE_MERGE_RECOVERY_UNSAFE` messages at the corresponding boundary.
Keep the existing context-free Quality refresh `unsafe(reason)` formatter for
pre-inventory failures and add a separate
`unsafeRecovery(reason, inventory)` formatter parallel to evidence merge for
rollback/roll-forward durability failures. The new formatter includes
`.musubix/evidence/.quality-refresh-transaction.json`, the recovery-entry
staging/temporary path inventory, and manual remediation. Add optional
test-only directory synchronization dependencies to the normal and recovery
transaction internals; production defaults call the exported helpers. A
deterministic injected callback rejects on a selected invocation count so tests
can distinguish journal publication, replacement, commit marker, rollback, and
cleanup boundaries without adding production fault branches.
Constraints: Journal publication synchronization is included in the normal
transaction recovery-required catch. A pre-publication file or link failure
retains its existing behavior. Non-injected filesystem failures never enter the
normal catch's existing rollback branch; they remain recovery-required. That
rollback branch remains restricted to the existing test-only injected operation
failures while the in-memory journal state is prepared. If directory
synchronization then fails inside that injected rollback, the rollback failure
is mapped to the transaction's unsafe-recovery diagnostic because restoration
durability is uncertain, and its owned-path snapshot is derived from the
in-memory canonical journal path and target temporary paths. Prepared-journal
recovery rollback and committed-journal
roll-forward both use the same unsafe durability boundary. Existing malformed
journal, coexistence, validation, digest, and non-directory file-I/O
diagnostics keep their current formatter regardless of inventory availability;
only directory-sync durability failures use `unsafeRecovery`. Directory synchronization around
target replacement, journal removal, and owned-file cleanup is included in the
recovery unsafe boundary. Recovery does not attempt rollback or retry after an
actionable durability failure because target or cleanup mutations may already
have occurred. Error text includes the original filesystem message, but the
transaction diagnostic remains the public primary error. Inventory is
snapshotted at recovery entry from the canonical journal, staging prefix, and
journal target temporary paths and is labeled as owned paths, not current
existence; removed files are not recreated. Optional dependency properties are
omitted with conditional spread when absent and are never assigned explicit
`undefined` under `exactOptionalPropertyTypes`.
Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
ADRs: ADR-0039
Depends-On: DES-TRANSACTION-DIRECTORY-SYNC-POLICY-002

## DES-TRANSACTION-DIRECTORY-SYNC-POLICY-004: Deterministic portability and transaction evidence
Responsibilities: Add focused test evidence for the complete platform matrix,
helper lifecycle, transaction diagnostics, and real-filesystem integration.
TEST-001 has a persisted Red/Green cycle; TEST-002 through TEST-004 provide
current passing coverage without individual persisted cycles. Replace the two
Windows portability tests that currently accept directory-open `EPERM` with
already-open-handle sync failures. Update English and Japanese durability
documentation. Writer-lock regression and the additional recovery branches are
covered by TEST-005, whose persisted Red/Green cycle is introduced in
DES-TRANSACTION-DIRECTORY-SYNC-POLICY-006.
Interfaces: Add
`TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-001` for classifier and strict-policy
behavior;
`TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-002` for both transaction helpers'
open/sync/close and original-error boundaries;
`TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-003` for normal recovery-required,
prepared-journal rollback unsafe diagnostics and observed recovery artifacts;
`TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-004` for both production helpers on a
real runner-local temporary directory. TEST-005, introduced by
DES-TRANSACTION-DIRECTORY-SYNC-POLICY-006, provides writer-lock policy
assignments, injected normal-catch rollback unsafe, and committed-journal
roll-forward unsafe evidence. Update
TEST-WINDOWS-CORE-PORTABILITY-003 and
TEST-WINDOWS-CORE-PORTABILITY-004 to verify Windows `EPERM` sync suppression
through injected handles and an explicit `() => 'win32'` platform callback
while retaining their existing requirement links and adding
REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001.
Constraints: Matrix tests include Windows `EPERM`, `EINVAL`, `ENOTSUP`,
`EISDIR`, `EACCES`, and unknown codes plus Linux and macOS representatives.
Tests assert open invocation, sync count, close count, primary error identity,
error fields that originally exist, policy forwarding, journal or owned-path
reporting, actual path existence after failure, and no retry. Typed imports
exercise the package index, the legacy `EvidenceDirectorySyncPolicy` alias, and
the prior two-argument helper shape. The real-directory test claims only current
runner-local filesystem integration. README.md and README-ja.md state the
Windows-only exception and direct operators on non-Windows or unsupported
filesystems to storage that supports directory synchronization.
The dedicated `transaction-directory-sync-policy-tests` command remains
optional. The required full `test` command executes this test file, and the
current constitution's zero command-failure rule makes an optional command
failure gate-blocking.
Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
ADRs: ADR-0039
Depends-On: DES-TRANSACTION-DIRECTORY-SYNC-POLICY-001 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-002 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-003

## DES-TRANSACTION-DIRECTORY-SYNC-POLICY-005: Corrective portability TDD evidence
Responsibilities: Repair immutable CHANGE-0042 test chronology with a separate
reviewed change that strengthens the two modified Windows portability tests and
records a genuine corrective Red/Green cycle without changing approved runtime
behavior.
Interfaces: CHANGE-0043 extends
TEST-WINDOWS-CORE-PORTABILITY-003 and
TEST-WINDOWS-CORE-PORTABILITY-004 with an injected Linux `EPERM` rejection
assertion. It records a separate corrective cycle for each of those two test
IDs so their current fingerprints become authoritative and their stale-test
diagnostics clear. The corrective Red temporarily reenacts the previous
cross-platform suppression in the Quality refresh and evidence merge helper
path while preserving the current helper signatures; Green restores delegation
to DES-TRANSACTION-DIRECTORY-SYNC-POLICY-001 as required by
DES-TRANSACTION-DIRECTORY-SYNC-POLICY-002 and records the focused tests.
Constraints: The temporary implementation reenactment is used only to execute
the corrective Red command and is not retained as an artifact or described as
the original development order. The corrective design phase is recorded before
either portability test is edited; the tests are then finalized before
corrective Red and remain byte-identical through both corrective Green cycles.
The reenacted source preserves the current three-argument signatures and
requirement/design trace annotations and copies only the old combined catch
predicate from base commit `83544c3`. Both test Red phases are recorded before
one byte-exact implementation restoration and both Green phases; after Green,
the restored implementation
fingerprint must equal CHANGE-0042's Quality implementation fingerprint.
CHANGE-0042 evidence remains immutable. After CHANGE-0043 reaches Quality, a bounded waiver may cover only
CHANGE-0042's `CHANGE_TEST_CHANGED_AFTER_RED`; it does not waive stale tests,
failed behavior, missing Red/Green evidence, or any CHANGE-0043 diagnostic.
The waiver is scoped to CHANGE-0042's whole
REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001 batch record rather than specific test
IDs and is therefore broader than CHANGE-0043's corrective cycles for only
TEST-WINDOWS-CORE-PORTABILITY-003 and TEST-WINDOWS-CORE-PORTABILITY-004.
Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
ADRs: ADR-0039
Depends-On: DES-TRANSACTION-DIRECTORY-SYNC-POLICY-004

## DES-TRANSACTION-DIRECTORY-SYNC-POLICY-006: Release-review corrective forwarding and coverage
Responsibilities: Correct the transaction helper wrappers so the optional
`platform` callback retains its third-parameter position when callers
explicitly omit `openDirectory`. Add authoritative evidence for the writer-lock
policy assignments and transaction recovery branches that the original
acceptance text named without executing.
Interfaces: Both exported wrappers call
`synchronizeDirectory(path, 'allow-unsupported', openDirectory, platform)`
positionally and rely on the shared helper's defaults. The test binds
`analysis.fsyncQualityRefreshDirectory` and
`analysis.fsyncEvidenceMergeDirectory` directly, without casts, to the current
three-argument and legacy two-argument function shapes. Module-level
`qualityDirectorySync` and `mergeDirectorySync` constants use those direct
typed assignments outside every `TEST-*` fingerprint span. Add
`TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-005` for calls shaped as
`helper(path, undefined, platform)`, with third-slot classification behavior
remaining covered by TEST-WINDOWS-CORE-PORTABILITY-003 and
TEST-WINDOWS-CORE-PORTABILITY-004. TEST-005 observes writer-lock publication
through `syncEvidenceDirectorySync` and acquisition rollback, release, and
recovery through `syncEvidenceDirectory`; it also covers injected prepared-state
normal-catch rollback failure and committed-journal roll-forward unsafe recovery
in Quality refresh and evidence merge.
Constraints: The classifier and policy assignments do not change. The Red must
fail because the platform callback is shifted into the `openDirectory` slot,
not because of an unrelated fixture failure. The test remains unchanged through
Green. Recovery assertions include the original error, canonical journal,
owned-path inventory, committed-state fixture, and single-attempt behavior.
The package-index signature assignments contain no `as DirectorySync` cast;
transaction-internal API casts remain outside this compatibility assertion.
TEST-001 through TEST-004 remain byte-identical. Current and legacy function
shape assignments used as assertions are placed inside TEST-005, not the frozen
TEST-002 block. The evidence-merge committed roll-forward fixture uses
`faultAt: 'cleanup'`, leaves target digests already matching, and injects the
failure at one of the two deterministic final directory synchronization calls.
CHANGE-0044 also carries a requirement-batch-scoped
`CHANGE_TEST_CHANGED_AFTER_RED` waiver because its fingerprint-external local
project fixture was completed after Red; TEST-005's authoritative test
fingerprint remains identical from Red through Green.
Requirements: REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
ADRs: ADR-0039
Depends-On: DES-TRANSACTION-DIRECTORY-SYNC-POLICY-002 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-003 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-004
