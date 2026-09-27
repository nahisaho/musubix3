---
schemaVersion: 1
feature: native-test-evidence-stability
---
# Design: Stable durable native test evidence

The implementation separates volatile adapter output from durable semantic
evidence. Full-command adapter invocations write raw output below
`.musubix/cache/native/**`; successful normalization produces one canonical
record at the existing `.musubix/evidence/native/<command>/aggregate*` path.
Targeted TDD invocations keep their current paths and raw-report digest
contract.

## DES-NATIVE-TEST-EVIDENCE-STABILITY-001: Canonical aggregate schema and codec
Responsibilities: Add `packages/analysis/src/native-test-evidence.ts` with the
versioned `NativeTestEvidence` schema, deterministic serializer, strict parser,
and typed diagnostics. The record contains only `schemaVersion`,
`commandName`, `commandSha256`, `inputFingerprint`, sorted `inputs` path/hash
entries, `adapter`, `sourceKind`, `reportPath`, `processStatus`, `exitCode`,
and normalized tests sorted by ID. Export a shared
`nativeTestCommandSha256(executable, args)` so creation and downstream command
validation use one canonical command digest.
Interfaces: `createNativeTestEvidence(root, trace, context):
Promise<NativeTestEvidence>`; `serializeNativeTestEvidence(evidence): string`;
`validateNativeTestEvidence(root, trace, text, expected, passContext):
Promise<{ evidence: NativeTestEvidence | null; diagnostics: Diagnostic[] }>`;
`nativeTestCommandSha256(executable, args): string`;
`NativeTestEvidencePassContext` owns a validation-pass-scoped
`Map<relativePath, contentSha256>`.
Constraints: Schema validation is fail-closed and reports
`NATIVE_TEST_EVIDENCE_SCHEMA`; expected command mismatch reports
`NATIVE_TEST_EVIDENCE_COMMAND_MISMATCH`. The `expected` value contains
`commandName`, `commandSha256`, `adapter`, `sourceKind`, and `reportPath`.
`tests` preserve optional deterministic `operations` counters. Validation
digests the exact disk bytes, requires those bytes to equal
`serializeNativeTestEvidence(parsed)`, and rejects unknown keys or alternate
field ordering instead of silently canonicalizing tampering. The serialized
form uses fixed field order, two-space JSON indentation, and one trailing
newline. Tests sort by codepoint-ascending `id` and inputs sort by
codepoint-ascending `path`, using direct string comparison rather than
locale-sensitive `localeCompare`. It contains no timestamp, duration, stdout,
stderr, raw filename, or raw-report digest.
Requirements: REQ-NATIVE-TEST-EVIDENCE-STABILITY-001 REQ-NATIVE-TEST-EVIDENCE-STABILITY-002 REQ-NATIVE-TEST-EVIDENCE-STABILITY-003 REQ-NATIVE-TEST-EVIDENCE-STABILITY-004
ADRs: ADR-0042
Depends-On: none

## DES-NATIVE-TEST-EVIDENCE-STABILITY-002: Trace-linked input fingerprint
Responsibilities: For each normalized TEST ID with a trace test node,
include its test path and follow its `verifies` edges to requirements. Include
code-node paths whose `implements` edges target either those requirements
directly or design nodes whose `satisfies` edges target those requirements.
Reported TEST IDs without a trace node remain in canonical results but
contribute no input path. Build sorted `{ path, sha256 }` entries from current
file content and digest their canonical JSON as `inputFingerprint`. Recompute
the same projection when validating a persisted canonical record. Within one
validation pass, memoize path-to-content-SHA-256 results so paths shared by
multiple command aggregates are read and hashed once.
Creation uses a fresh context for each completed child-process execution.
No digest cache crosses a child-process execution or the boundary from
canonical creation to downstream reread; a downstream validation pass allocates
its own fresh context and shares it only among aggregate rereads performed
without an intervening command execution.
Interfaces: `nativeTestInputSnapshot(root, trace, tests, passContext):
Promise<{ inputs: NativeTestEvidenceInput[]; inputFingerprint: string;
diagnostics: Diagnostic[] }>` uses the same `NativeTestEvidencePassContext`
passed by its caller.
Constraints: `buildTrace` already collapses duplicate IDs while emitting
`TRACE_DUPLICATE`; this component uses the retained node and does not implement
a second duplicate detector. Missing or changed listed input content, a changed trace-derived
path set, or a different recomputed digest reports
`NATIVE_TEST_EVIDENCE_SOURCE_MISMATCH` with deterministic added, removed, and
modified path details. Existing trace validation remains the
authority for duplicate and malformed annotations. Paths under
`.musubix/evidence/**`, generated trace files, caches, logs,
`.github/skills/**`, and unrelated nodes are never included. An empty resolved
input set is represented by the canonical digest of an empty array, not a
missing or invented path.
Requirements: REQ-NATIVE-TEST-EVIDENCE-STABILITY-002 REQ-NATIVE-TEST-EVIDENCE-STABILITY-004
ADRs: ADR-0042
Depends-On: DES-NATIVE-TEST-EVIDENCE-STABILITY-001

## DES-NATIVE-TEST-EVIDENCE-STABILITY-003: Raw-output isolation and durable lifecycle
Responsibilities: Extend aggregate `AdapterInvocation` values with a raw output
path below `.musubix/cache/native/<command>/aggregate*`, while retaining the
existing `.musubix/evidence/native/<command>/aggregate*` as the durable path.
Pass the raw path to Vitest, Jest, pytest, Go, Cargo, JUnit, and dotnet;
normalize raw file, stdout, or directory content; create and atomically write
the canonical record after the process completes with exit zero and native
normalization and canonicalization succeed. Normalized fail, skip, or error
test statuses remain in that record for policy and downstream validators to
reject; they are not treated as canonicalization failures. Remove the raw cache
output after processing. Before execution,
remove any prior raw output and prior durable aggregate; after any
non-completed process, non-zero exit, normalization failure, or canonicalization
failure, remove both so raw output
cannot remain at the tracked path.
If canonical creation fails after an exit-zero process, attach its diagnostics
to `command:<name>`, copy them to required `testReportDiagnostics`, do not add
the execution to `performanceExecutions` or `structuredTests`, and remove both
raw and durable paths so test-identity checks remain fail-closed.
Interfaces: `AdapterInvocation` adds `rawReportPath`; aggregate invocations use
distinct raw/durable paths, while targeted invocations set both paths to the
existing `<testId>*` path. A shared `adapterCommandArgs(root, command,
invocation)` helper constructs the complete adapter argument vector for gate,
performance, and model-correspondence. It replaces configured `{reportPath}`
tokens, rewrites the raw path embedded in generated invocation arguments, and
merges adapter arguments identically before command hashing. For adapter
commands the helper expresses the project-root-resolved raw path relative to
`commandCwd` using
POSIX separators, so a configured subdirectory `command.cwd` writes to the
intended project cache without embedding an absolute checkout path in the
command digest. With no configured `command.cwd`, the argument remains exactly
`.musubix/cache/native/<command>/aggregate*`. Raw cleanup follows `sourceKind`
(file/stdout unlink, directory recursive removal and recreation); durable
cleanup removes either a legacy directory recursively or a file, leaves the
path absent, and never creates a directory. Atomic canonical replacement occurs
only after that durable path is absent. Durable cleanup retains
`assertAbsoluteEvidencePathReady` merge-journal recovery protection in addition
to evidence-writer locking. `readAdapterOutput`
reads only the raw path. `runGate` consumes raw output and persists canonical
aggregate evidence through DES-001; `runTddPhase` behavior is unchanged.
Constraints: Directory adapters transition from a raw cache directory to one
durable canonical file without treating the durable file as a report directory.
Their existing extensionless `aggregate` durable path is retained deliberately
to avoid changing recorded report-path identity.
Evidence-writer locking, path safety, and atomic JSON replacement remain
mandatory. Raw and durable filesystem targets are always resolved from the
project root; only the raw runner argument is expressed relative to
`commandCwd`. Canonical `inputs[].path` values also always use POSIX separators.
Existing legacy raw aggregate evidence is not
interpreted as canonical; the next successful gate run replaces it, while
standalone validation before refresh may additionally report
`NATIVE_TEST_EVIDENCE_SCHEMA`, `PERFORMANCE_COMMAND_MISMATCH`, or
`MODEL_CORRESPONDENCE_TEST_NOT_PASSED`.
Requirements: REQ-NATIVE-TEST-EVIDENCE-STABILITY-001 REQ-NATIVE-TEST-EVIDENCE-STABILITY-003 REQ-NATIVE-TEST-EVIDENCE-STABILITY-004
ADRs: ADR-0042
Depends-On: DES-NATIVE-TEST-EVIDENCE-STABILITY-001 DES-NATIVE-TEST-EVIDENCE-STABILITY-002

## DES-NATIVE-TEST-EVIDENCE-STABILITY-004: Downstream canonical reread
Responsibilities: Update performance and model-correspondence report rereads
for adapter aggregate paths to call the canonical validator instead of
re-parsing native runner syntax. Store `reportSha256` from the canonical
serialized bytes and keep normalized tests, command provenance, report path,
source kind, process status, exit code, deterministic operation counters, and
test fingerprints under their existing evidence contracts. Map canonical
diagnostics directly into validation results before existing
`PERFORMANCE_REPORT_TAMPERED`, `PERFORMANCE_REPORT_MISMATCH`, and
`MODEL_CORRESPONDENCE_TEST_NOT_PASSED` checks.
Interfaces: `validatePerformanceEvidence` and
`validateModelCorrespondenceEvidence` add an optional `{ trace?: TraceGraph }`
argument without changing existing callers; gate passes its already-built trace,
while standalone validation lazily builds one non-persisted trace graph on the
first canonical aggregate reread and reuses it for every remaining canonical
aggregate. The validation-pass context also reuses DES-002's path-to-content
digest cache across those aggregates. Each public validation invocation creates
that context once after command execution has ended; it is passed explicitly
through canonical validation, never reused from canonical creation, and never
stored in a module-global or cross-pass cache. Cached trace loaded by existing
model-correspondence staleness checks
remains unchanged, but it is not used for the canonical input-fingerprint
projection because it may be absent or stale. `performanceCommandSha256` and
model-correspondence's command-digest calculation both delegate to
`nativeTestCommandSha256`.
Constraints: No validator catches a canonical diagnostic and converts it to a
passing or missing result. Custom `command.testReport` and mutation-report
paths retain their current parsers. Elapsed duration remains absent from
deterministic performance observations and budgets. When canonical evidence is
consumed, an omitted optional trace triggers one current non-persisted build; it
never disables fingerprint validation. A pass with no canonical aggregate to
reread does not build an unused trace. Callers that invoke performance and
model-correspondence validation in one status, attestation, change, or gate pass
build or retain one current trace and pass it to both validators so they observe
the same worktree graph and do not duplicate the build. Gate commands must not
mutate trace-linked source or test inputs between the gate's trace build and
downstream canonical reread; such a mutation fails closed with the changed-path
details from `NATIVE_TEST_EVIDENCE_SOURCE_MISMATCH` so the mutating command can
be identified instead of treating the record as current.
Requirements: REQ-NATIVE-TEST-EVIDENCE-STABILITY-002 REQ-NATIVE-TEST-EVIDENCE-STABILITY-003 REQ-NATIVE-TEST-EVIDENCE-STABILITY-004
ADRs: ADR-0042
Depends-On: DES-NATIVE-TEST-EVIDENCE-STABILITY-001 DES-NATIVE-TEST-EVIDENCE-STABILITY-002 DES-NATIVE-TEST-EVIDENCE-STABILITY-003

## DES-NATIVE-TEST-EVIDENCE-STABILITY-005: Regression and operational documentation
Responsibilities: Add authoritative tests
`TEST-NATIVE-TEST-EVIDENCE-STABILITY-001` through `004`. Test 001 runs fixture
gate commands for file, stdout, and directory adapter sources twice with
volatile raw telemetry and filenames and compares durable bytes. Test 002
asserts the complete canonical schema, deterministic ordering, trace-linked
path/content fingerprint, and semantic-field sensitivity. Test 003 proves
timing fields never enter canonical bytes and deterministic performance still
requires operation counters. Test 004 exercises unresolved TEST IDs, schema,
command and source mismatches, downstream fail-closed rereads, and unsuccessful
command cleanup. It proves that an exit-zero normalized report containing
failed, skipped, or error tests is persisted canonically and then rejected by
policy and downstream validation. It also starts with a legacy directory-shaped durable
aggregate for a directory adapter and proves the next successful gate removes
that directory before writing the single canonical file. Document the canonical
aggregate format, migration-by-next-gate
behavior, stable diagnostic codes, and aggregate-only scope in `README.md` and
`README-ja.md`. The documentation also states that, for full-command aggregate
invocations, configured `{reportPath}` tokens and generated report-path
arguments denote the cwd-relative `.musubix/cache/native/**` raw path during
execution. This migration changes command digests only for commands whose
arguments contain that report path, until one successful gate refreshes
performance and model-correspondence provenance; stdout-only Go and Cargo
adapter digests and targeted TDD report paths and digests remain unchanged.
Interfaces: New test file
`tests/native-test-evidence-stability.test.ts` and required configured command
`native-test-evidence-stability-tests`.
Constraints: The two-run test must compare actual tracked durable bytes, not
only parsed objects or hashes. It must not edit a related trace-linked input
between the paired unchanged runs. It runs in a temporary fixture workspace so
the repository's own writer lock and aggregate evidence cannot interfere.
Include one reported TEST ID without a trace annotation and prove it remains in
results while contributing no input path. Include a duplicate annotated TEST ID
fixture and prove global trace validation still reports `TRACE_DUPLICATE`.
Include direct-REQ and DES-mediated implementation edges in the fingerprint
fixture. Targeted TDD reports are not reformatted by these tests.
Include punctuation-sensitive test IDs and paths that prove canonical sorting
uses codepoint order rather than locale collation. Include an adapter command
whose `command.cwd` is a subdirectory and prove gate, performance, and
model-correspondence construct the same cwd-relative raw argument and command
digest. A second validation pass in the same process after editing a linked
input must bypass the prior pass's digest cache and report
`NATIVE_TEST_EVIDENCE_SOURCE_MISMATCH`.
Include a gate fixture whose later command mutates an earlier command's
trace-linked input and prove the gate fails closed with deterministic changed
path details because reread recomputes with a fresh context rather than reusing
creation-time digests.
Requirements: REQ-NATIVE-TEST-EVIDENCE-STABILITY-001 REQ-NATIVE-TEST-EVIDENCE-STABILITY-002 REQ-NATIVE-TEST-EVIDENCE-STABILITY-003 REQ-NATIVE-TEST-EVIDENCE-STABILITY-004
ADRs: ADR-0042
Depends-On: DES-NATIVE-TEST-EVIDENCE-STABILITY-001 DES-NATIVE-TEST-EVIDENCE-STABILITY-002 DES-NATIVE-TEST-EVIDENCE-STABILITY-003 DES-NATIVE-TEST-EVIDENCE-STABILITY-004
