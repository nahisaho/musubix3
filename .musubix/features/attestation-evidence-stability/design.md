---
schemaVersion: 1
feature: attestation-evidence-stability
---
# Design: Attestation evidence-head stability across no-op `gate` re-runs

DES-001 fixes the actual root cause (order-dependent mutant-array
canonicalization in `mutationEvidenceHead`). DES-002 proves REQ-003 (a
signed attestation survives a no-op re-run once the fix is in place) with
an end-to-end sign/verify/gate-rerun test executed against the fixed
implementation only. DES-003 documents REQ-004. Every other
`collectEvidenceHeads` entry is already narrowly-projected and stable
across the no-op re-runs this fix targets (this is already satisfied by
the existing code for every entry except `mutation`, per the requirements
investigation); `workflow`'s `invocations` array is stored/retained in
recorded order rather than canonically sorted, but this does not affect
the no-op re-run scenario REQ-001/003 target, since a true no-op re-run
does not append or reorder invocation records. No further per-entry fix is
needed.
DES-004 adds the permanent three-mode regression test that REQ-001's
acceptance criteria require to prove this for `full`, `--changed`, and
`--feature` modes going forward, rather than relying on this design's
one-off manual confirmation.

## DES-ATTESTATION-EVIDENCE-STABILITY-001: Order-invariant mutant canonicalization in `mutationEvidenceHead`
Responsibilities: In `packages/analysis/src/mutation.ts`'s existing
exported `mutationEvidenceHead(evidence)` function, change the
`executions.map(...)` projection's `mutants: execution.mutants ?? []` line
to `mutants: [...(execution.mutants ?? [])].sort(compareCanonical)`, adding
a function-local `compareCanonical(a: unknown, b: unknown): number` helper in
`mutation.ts` that mirrors `performanceEvidenceHead`'s comparator
(`packages/analysis/src/performance.ts`) exactly: `const left =
canonical(a); const right = canonical(b); return left < right ? -1 : left
> right ? 1 : 0;` — a plain lexical `<`/`>` comparison, not
`String.prototype.localeCompare`, because `localeCompare` is
locale/collation-dependent and can report two distinct canonical strings as
equal under some collation settings, which would make the sort unstable
for those inputs and defeat the invariance this fix exists to provide. Use
the module-local `canonical()` function already defined at the top of
`mutation.ts` (the same one `mutationCommandSha256`/`mutationIdentity`
already call) inside the new comparator — do not import
`performanceEvidenceHead`'s comparator closure, since `mutation.ts` already
has its own equivalent `canonical()` in scope and introducing a
cross-module import would be an unjustified coupling for a four-line
helper. Each `MutationRecord` element is sorted by its own full
canonical-JSON serialization (`id`, `requirementId`, `testId`,
`sourcePath`, `sourceSha256`, `testPath`, `testSha256`, `operator`,
`location`, `status`), so two arrays containing the same multiset of
records in different orders canonicalize identically, while any actual
field/count difference still changes the sorted array's canonical form and
therefore the digest.
Interfaces: `mutationEvidenceHead(evidence: Record<string, unknown>): string`
(signature unchanged; only its internal mutants-ordering step changes).
Constraints: The existing top-level `executions.sort(...)` step (which
already sorts the outer executions array by full canonical content) is
unchanged and untouched; this design only adds a nested sort one level
deeper, inside each execution's `mutants` array, before that execution
object is itself canonicalized and compared for the outer sort — so the
outer sort's comparator now sees each execution's mutants pre-sorted,
which is required for the outer sort to also be insertion-order-invariant
when two executions differ only in their mutants' original order.
Requirements: REQ-ATTESTATION-EVIDENCE-STABILITY-002
ADRs: none — a four-line, non-architectural bug fix scoped to a single
existing function's internal canonicalization step.

## DES-ATTESTATION-EVIDENCE-STABILITY-002: Sign/verify/no-op-rerun regression test for REQ-003
Responsibilities: Add a test modeled directly on
`tests/p3-performance-provenance.test.ts`'s "keeps semantic performance and
quality heads stable across gate-sign-gate runs" test, reusing its exact
shape: generate an Ed25519 keypair with `generateKeyPairSync('ed25519')`,
configure `config.attestation = { mode: 'ci-required', repository,
trustedPublicKeys, githubOidc: { mode: 'off' } }`, stub a git-aware
`Runner` (forwarding its `options` parameter through to `runProcess`), call
`createUnsignedAttestation(root, { provider: 'github', runId, keyId },
runner)`, sign `attestationSigningPayload(unsigned)` with the private key,
write the signed attestation, then call `runGate(root, { runner })` once to
establish a baseline mutation execution and confirm
`verifyEvidenceAttestation(root, config.attestation, runner, environment)`
reports `{ valid: true, status: 'verified' }`. The mutation command
configured for this test is a small script maintaining its own runtime
counter file under `.musubix/evidence/` (excluded from `files()`'s tracked
walk, so reading/writing it never perturbs `heads.workspace` or requires a
config/source edit between runs) that alternates emitting its two mutant
records in forward order on odd invocations and reversed order on even
invocations; the two mutant records must have distinct `{requirementId,
sourcePath, operator, location}` tuples so reordering them is a genuine,
observable array-order change rather than a no-op on identical records. Run
`runGate(root, { runner })` a second time (the counter file causes this
second invocation's mutation command to emit the reversed order with no
other tracked change), snapshot `evidenceHeads.mutation` after each run,
and assert that, against the fixed (post-DES-001) implementation, the two
mutation heads are identical and `verifyEvidenceAttestation` after the
second run still reports `{ valid: true, status: 'verified' }`. This test
runs only against the fixed implementation — it does not itself execute or
emulate the pre-fix, order-dependent canonicalization; the historical
defect (differing heads and an invalidated attestation) is the bug this
change fixes, reproduced during investigation prior to the DES-001 fix,
not a counterfactual branch this regression test asserts on both sides of.
Interfaces: no new exported interfaces; reuses `createUnsignedAttestation`,
`attestationSigningPayload`, `verifyEvidenceAttestation`, and `runGate`,
all already exported from `packages/analysis/src/index.ts`.
Constraints: Must not edit `.musubix/config.json` or any other tracked
file between the two `runGate` calls in the pair being compared — the
mutation command's own runtime counter file under `.musubix/evidence/` is
the only state that varies the emitted order, so the pair of `runGate`
calls constitutes a genuine no-op re-run from the tracked-workspace
perspective.
Requirements: REQ-ATTESTATION-EVIDENCE-STABILITY-003
ADRs: none — a regression test exercising already-decided attestation and
gate mechanics; no new architectural decision.

## DES-ATTESTATION-EVIDENCE-STABILITY-003: `evidenceHeads` field documentation
Responsibilities: Add a new subsection to `README.md` (placed near existing
attestation-related documentation, if any, otherwise appended under a
clearly named heading such as "Attestation evidence-head composition")
listing all ten `collectEvidenceHeads` keys (`tdd`, `workflow`, `changes`,
`order`, `formal`, `performance`, `mutation`, `modelCorrespondence`,
`quality`, `workspace`), each naming its direct input/projection precisely
enough to match `packages/analysis/src/attestation.ts`'s
`collectEvidenceHeads` and the per-entry head functions it delegates to:
`tdd`: the last entry's `recordSha256` from `.musubix/evidence/tdd.json`'s
hash chain (not a projection over every recorded phase field); `workflow`:
`workflowEvidenceHead`'s projection of `.musubix/evidence/workflow.json`'s
`verification` block only (`eventsSha256`, `sourceSha256`,
`transcriptSha256`, `mode`, `sessionId`, `exitCode`, `terminalAt`,
`eventCount`, `sourceBytes`, `maxTranscriptBytes`, `maximumLineBytes`,
`maxTranscriptLineBytes`, and `invocations` (each entry's
`skill`/`toolCallId`/`invokedAt`/`completedAt`/`status`, unsorted/
order-sensitive as stored), or just `eventsSha256`/`sourceSha256` when
`mode`/`transcriptSha256`/`sessionId` are all absent), excluding the raw
`events` log itself;
`changes`: a canonical digest of `.musubix/evidence/changes.json`'s
`changes` array directly (not the `.musubix/changes/*.md` documents
themselves, which are a separate upstream input to that evidence); `order`:
the last entry's `recordSha256` from `.musubix/evidence/order.json`'s
records (not a projection over every recorded declaration); `formal`:
retains only `fingerprints`/`totalRequirements`/`modeledRequirements`/
`modeledFraction`/the solver's `artifact`/`status`/`result.consistency`
from `.musubix/evidence/formal.json`, excluding `generatedAt` and every
other `result` field such as solver duration, diagnostics, literals, and
constraints; `performance`: `performanceEvidenceHead`'s projection of
`.musubix/evidence/performance.json` retaining, per execution,
`commandName`/`commandSha256`/`reportPath`/`sourceKind`/`processStatus`/
`exitCode`/a canonically-sorted `tests` array (each test entry kept in
full), and per observation,
`requirementId`/`testId`/`counter`/`observed`/`maximum`/`status`/an
optional `provenance` object retaining exactly
`commandName`/`commandSha256`/`reportPath`/`sourceKind`/`testId`/
`testStatus`/`counter`/`value`/`processStatus`/`exitCode`, with both the
`executions` and `observations` arrays canonically sorted
(order-independent); `mutation`:
`mutationEvidenceHead`'s equivalent projection of
`.musubix/evidence/mutation.json` retaining, per execution,
`commandName`/`commandSha256`/`reportPath`/`processStatus`/`exitCode`/a
canonically-sorted `mutants` array (each mutant's full record), with both
the `executions` and nested `mutants` arrays canonically sorted
(order-independent, per DES-001); `modelCorrespondence`:
`modelCorrespondenceEvidenceHead`'s projection of
`.musubix/evidence/model-correspondence.json` retaining `schemaVersion`,
`formalEvidenceSha256`, `traceEvidenceSha256`, and a canonically-sorted
`entries` array (each retaining `requirementId`/`requirementPath`/
`formalSha256`/`modelSha256`/`traceSha256`/a canonically-sorted `tests`
array retaining exactly `testId`/`testPath`/`testSha256`/`commandName`/
`commandSha256`/`reportPath`, excluding `reportSha256`/`provenanceSha256`),
excluding any other stored run metadata; `quality`: retains
`schemaVersion`, `mode`, a derived pass/fail `status`, and each non-
`attestation` check's `name`/`required`/`status`/a narrow `diagnostics`
projection (`code`/`severity`/`path`/`line`), plus `metrics` with the
`attestation.errors` entry excluded — excluding `generatedAt`, `durationMs`,
`stdout`/`stderr`, the `attestation` check itself, and the
`attestation.errors` metric; `workspace`: not an evidence file at all — a
content digest of the non-evidence repository file set returned by
`files(root)` filtered by `evidenceInputPaths`, explicitly noting
`.musubix/evidence/**` is excluded from that walk.
Interfaces: none (documentation only).
Constraints: Must not restate implementation details already covered
verbatim elsewhere in a way that risks drifting out of sync silently, but
must be exact enough (naming the specific retained fields or specific
excluded fields per key, and explicitly labeling chain-tip-hash and
whole-snapshot entries as such rather than implying a broader per-field
evidence-file projection) that a reader cannot mistake a retained field
(e.g. `performance`/`mutation`'s `processStatus`/`exitCode`) for an
excluded one; point to `packages/analysis/src/attestation.ts`'s
`collectEvidenceHeads` for the authoritative implementation.
Requirements: REQ-ATTESTATION-EVIDENCE-STABILITY-004
ADRs: none — documentation-only addition; no new architectural decision.

## DES-ATTESTATION-EVIDENCE-STABILITY-004: Three-mode evidence-head stability regression test for REQ-001
Responsibilities: Add a permanent test proving all ten
`collectEvidenceHeads` entries are simultaneously present and stable across
a no-op `gate` re-run, independently for each of the `full`, `--changed`,
and `--feature` modes, since REQ-001's acceptance is broader than DES-002
alone produces. Concretely, build one fixture project (`tests/helpers.ts`'s
`project()`), then, before the two-runs-per-mode comparison, populate the
conditional keys that `runGate` does not already produce unconditionally
(`formal`, `performance`, `modelCorrespondence`, `quality`, and `workspace`
are already written by every `runGate` call and need no separate seeding)
directly with this repository's own exported evidence-writer functions
(all already barrel-exported from `packages/analysis/src/index.ts`), each
called once with the minimal valid input its own signature requires:
`recordChangePhase`/`runTddPhase` already call `appendEvidenceOrder`
internally with valid `kind`s, so `order` gets populated as a side effect
of those two calls alone (do not call `appendEvidenceOrder` directly with
an invalid `kind` such as `'requirement'`; `EvidenceOrderKind` is strictly
`'change' | 'tdd'`); `recordWorkflow(root, { skill:
'attestation-evidence-stability', phase: 'requirements', status: 'passed'
})` followed by `verifyWorkflowLog(root, transcript, { mode: 'compatible'
})` (a minimal synthetic tool-invocation-then-`result` transcript) for
`workflow`, since `workflowEvidenceHead` requires the `verification` block
that only `verifyWorkflowLog` populates, not `recordWorkflow` alone; a
stub `.musubix/changes/CHANGE-9001.md` file followed by
`recordChangePhase(root, 'CHANGE-9001', 'impact', ['<REQ-ID>'])` for
`changes`; and for `tdd`, configure the fixture's `test` command with
`tddArgs`/`tddReport` pointing at a script parameterized by an
environment/argument switch (mirroring
`tests/p3-performance-provenance.test.ts`'s `configurePerformance`
parameterized-script pattern rather than reusing `project()`'s fixed
always-`passed`/exit-0 script verbatim; `tddArgs` must literally contain
the substring `{testId}` or `{testPath}` for config validation even though
the report is fully inline), call `runTddPhase(root, 'red', testId,
requirementId, 'test', runner)` with that script configured to report
`status: 'failed'` with a non-zero exit code, assert the returned phase
record is `valid === true`; then reconfigure the script to report `status:
'passed'` with exit code `0` and call `runTddPhase(root, 'green', testId,
requirementId, 'test', runner)`, again asserting `valid === true` — the
`.musubix/config.json` edit made to reconfigure the script between Red and
Green already constitutes Green's required non-test tracked-file change
since Red, so no additional edit to an actual source file (e.g.
`src/service.ts`) is needed, and making one would be actively harmful here
since it would invalidate a mutant's `sourceSha256` computed from that
file's content before the edit. `formal`/`performance`/
`modelCorrespondence`/`quality`/`workspace` need no manual writer calls:
the fixture's requirement carries a `Formal:` constraint (reusing this
repository's own explicit-requirement fixture pattern from
`tests/p4-correspondence-mutation.test.ts`) so `runGate`'s own internal
`formal check`/`writePerformanceEvidence`/`writeModelCorrespondenceEvidence`
calls populate those five keys unconditionally on the first `runGate`
call below. Once `collectEvidenceHeads(root)` returns all ten keys (assert
`Object.keys(heads).sort()` equals the fixed ten-key list before proceeding,
so a future change to any of these prerequisites is caught immediately
instead of silently narrowing coverage), run the three-mode comparison:
for each of `runGate(root, { runner })` / `runGate(root, { runner, changed:
true })` / `runGate(root, { runner, feature: '<slug>' })`, call it twice in
immediate succession with no further tracked change between the two calls
in that pair, snapshot `collectEvidenceHeads(root)` after each call, assert
each of the two snapshots in the pair independently has exactly the fixed
ten-key set (`Object.keys(snapshot).sort()` equals the ten-key list for
both the first and second snapshot, not only checked once before the mode
loop), and assert the first and second snapshot are deeply equal
(`toEqual`) for that mode; repeat independently for all three modes within
the same test (or three `it` cases sharing a `describe.each`-style table),
so a regression in any future evidence-head function is caught regardless
of which mode a project's CI happens to invoke `gate` with, and regardless
of which of the ten entries the regression affects, and so a mode that
silently drops one or more keys on both runs (which would otherwise still
satisfy a bare deep-equality check) is also caught.
Interfaces: no new exported interfaces; reuses the same barrel-exported
`runGate`/`collectEvidenceHeads` and `tests/helpers.ts`'s `project()`.
Constraints: Must assert the fixed ten-key set on every individual
snapshot compared (both the first and second `runGate` call in each
mode's pair), not only a deep-equality check between the pair, since a
mode that dropped the same key(s) on both runs would otherwise pass
deep-equality while violating REQ-001's populated-key requirement; must
not touch `.musubix/config.json` or any other tracked file between the
two `runGate` calls in each mode's pair (the mutation command's own
runtime counter file under `.musubix/evidence/`, per DES-002, is the only
thing that may legitimately vary between the pair).
Requirements: REQ-ATTESTATION-EVIDENCE-STABILITY-001
ADRs: none — a regression test exercising already-decided gate and
evidence-writer mechanics; no new architectural decision.
