# Changelog

## Unreleased

## 0.1.12 - 2026-09-10

Fixes for every issue found while running real multi-language, large-scale
trial projects against musubix3@0.1.11, all filed and fixed since that
release (GitHub Issues #2, #3, #4, #5, #6, #7, #8, #9, #10, #11, #12, #13,
#14).

- TDD superseded-cycle scoping (#11): a recorded Red-Green cycle superseded
  by a later, fully valid cycle for the same test ID no longer raises
  `TDD_RED_MISSING`/`TDD_GREEN_MISSING`/`TDD_LEGACY_OR_UNSCOPED_EVIDENCE`.
- Per-requirement change batches (#12): `change-record`'s red/implementation/
  green phases can be recorded once per non-empty subset of a change's
  requirement IDs, enabling an interleaved per-requirement TDD loop across a
  multi-requirement change; recording the full requirement set at once
  remains fully compatible with previously recorded evidence.
- Scope Green/Refactor cycle matching by requirement ID and validate before
  order-log append (#14).
- More specific EARS/requirement-ID validation diagnostics: mixed clause
  forms, missing subject, and other classification failures now name the
  actual problem instead of a generic message; the `REQ_ID` diagnostic
  states the expected `REQ-<FEATURE>-<digits>` pattern (#2, #3, #4).
- Fix adapter test-ID recognition for Go/Rust-style names with a digit run
  followed by a descriptive suffix, and stop `config lint` from flagging a
  `go test ./...` package wildcard as a missing repository-relative path
  (#7, #9).
- Add an optional `cwd` field to a configured command in
  `.musubix/config.json`, so `gate`/`tdd red`/`tdd green`/`tdd refactor`
  run that command (including its Red preflight phase) from a
  project-root-relative subdirectory instead of always the project root.
  Supports polyglot monorepos with per-service toolchains. `config lint`
  reports a new `CONFIG_CWD_INVALID` diagnostic for a `cwd` that escapes
  the project root or does not exist, and scopes its `CONFIG_ORPHANED_PATH`
  argument check to that command's own `cwd`. Evidence/report paths and
  `.musubix/config.json` itself are unaffected and stay project-root
  relative (#6).
- `design validate` accepts an explicit `ADRs: none — <reason>` marker
  (case-insensitive, hyphen/en dash/em dash/colon separator) as satisfying
  the ADR requirement for a component with no architecturally significant
  decision, as long as the reason is concrete (not empty, not a
  `TODO`/`TBD`/`N/A`/`未定` placeholder). A bare `none` or a placeholder
  reason is now reported as `DES_ADR_EXEMPTION_REASON` instead of `DES_ADR`,
  so authors are told to justify the exemption rather than to add an ADR.
  An empty field, or a field with only unknown ADR references, still fails
  exactly as before (#5).
- Document the recommended practice for a requirement that a correct,
  general implementation already satisfies as a side effect of another
  requirement: temporarily and locally narrow the shared implementation to
  observe a genuine failing test, record `tdd red`, then restore the
  implementation and record `tdd green`. No `--already-satisfied-by`-style
  bypass was added: a human declaration that a requirement is "already
  satisfied elsewhere" is not measured evidence (#13).
- Document the two independent requirements for `tdd`'s test-ID discovery
  (a `@verifies`/`@id`-style doc-comment link from source to the
  requirement, and a structured test-runner report identifying the test by
  ID) next to the existing worked example, and add a per-adapter reference
  table (vitest/jest/pytest/go-test/cargo/junit/dotnet) with the exact
  declaration each adapter expects. Expand the `tdd` command's CLI help
  text to summarize the same dual requirement (#8, #10).
- Add the `sdd-issue-report` skill for recording a discovered defect as a
  GitHub Issue with reproduction evidence, and register it in the packaged
  skill list (it was initially missing from `plugin-install`/`pack:check`,
  so it did not install with the package until this release).

## 0.1.11 - 2026-09-10

- `workflow-verify`/`verifyWorkflowLogFile` now accept one or more Copilot
  CLI transcript files in compatible mode, reconciling Skill declarations
  recorded across multiple sessions (a `workflow.json` can accumulate
  declarations over a repository's whole lifetime, spanning many distinct
  sessions). Files are ordered by earliest event timestamp; a `toolCallId`
  appearing in more than one file is rejected. `--strict`/`--session-id`
  still require exactly one file. Single-file calls are byte-identical to
  before.
- Wire `tests/p3-workflow-provenance.test.ts` into structured test
  commands so `TEST-WORKFLOW-SHUTDOWN-001` is reported as passed by
  `gate`'s test-identities check.

Known open debt shipped with this release (see Issue #1, closed by explicit
user decision):
- `TEST-CLI-WORKFLOW-UX-001`..`005` carry a cosmetic `TDD_TEST_STALE`
  fingerprint drift from their original v0.1.9 authoring session; the
  underlying tests still pass and are not behaviorally stale.
- `CHANGE-0005`/`CHANGE-0006` cannot complete `change-record` chronology
  validation: their phases were recorded after all real work was already
  done, and the append-only order ledger cannot accept phase records
  retroactively. Both are documented in their respective change files.

`gate.ready` is `false` for these known, non-functional reasons; release
proceeds by explicit user decision.

## 0.1.10 - 2026-09-09

- Accept the current GitHub Copilot CLI terminal format in strict workflow
  verification: a unique session UUID followed by exactly one final
  `session.shutdown` with `data.shutdownType: "routine"`. Existing final
  `result` transcripts remain supported; ambiguous, abnormal, mixed, and
  non-final terminal events still fail closed.
- Fix a test-fixture isolation bug where `project()`'s Copilot CLI
  invocations could leak this repository's own (unbounded) Git history into
  `knowledge build` output, truncating structured JSON responses.

## 0.1.9 - 2026-09-09

- Exclude nested MUSUBIX3 workspaces (any descendant directory containing its
  own `.musubix`) from an ancestor repository's file scan, trace, and Code
  Graph, so a workspace nested inside another never pollutes the outer
  workspace's own gate.
- State in `trace impact` text output that the reported range is a
  bidirectional candidate-review set, not a list of required changes.
- Point stale/missing approval errors at `musubix3 approval validate` for a
  full per-stage status.
- Add `config lint` to report configured commands whose `args` reference
  repository-relative paths that do not exist.
- Add `gate --feature <name>` to scope requirements/design/trace/tdd/
  change-history/change-completeness checks to one feature; a diagnostic view
  only, never a substitute for the repository-wide gate.
- Add `config scaffold` to propose native test-command entries for detected
  Go/Rust/Maven/Python/Node toolchains without writing `.musubix/config.json`.

## 0.1.8 - 2026-09-09

- Treat every new natural-language development request as a fresh change, even within an existing Copilot session.
- Reuse requirements, approvals, TDD, and change evidence only when the user explicitly names the existing CHANGE ID and asks to continue it.
- Trace musubix3 Skill contracts without leaking installed Skill annotations into consumer project trace graphs.
- Add regression coverage for fresh-change routing and explicit continuation.

## 0.1.7 - 2026-09-08

- Add artifact-bound human approval gates for requirements, design, and release.
  `approval prepare` displays the exact review manifest/hash and `approval record`
  requires that still-current hash plus explicit confirmation. Requirements
  approval gates design validation, design approval gates TDD Red, and release
  recording recomputes all required non-approval checks instead of trusting cached
  quality evidence. Ordinary JSONL project inputs remain bound while recognized
  logs are excluded. Status exposes every stage, Skills stop for one native human
  decision, legacy configs remain compatible, and local approver text is documented
  as non-authenticated.
- Fix TDD test fingerprints for non-TypeScript sources: an indented single-line
  block annotation such as `  /* @id TEST-APP-001 */` hashed an empty slice, so
  test mutation after Red and `TDD_TEST_STALE` went undetected in PHP, Java, Go,
  Rust, Python and every other generic-comment language.
- Report the concrete cause of `REQ_FORMAL_SCHEMA` failures (unknown kind,
  unexpected keys, missing keys, or the invalid field with its expected type)
  instead of one opaque sentence.
- Explain in `REQ_EARS` when a statement declares more than one obligation, and
  list the valid pattern vocabulary in `REQ_PATTERN`.
- List the known keys when configuration rejects an unknown key.
- Add `mutation identity` so deterministic `MUT-*` values no longer require a
  two-pass gate-and-scrape workflow, and say where `mutation validate` looks for
  evidence instead of silently passing when none is present.
- Report `TDD_EVIDENCE_REUSED` from the structured report hash rather than console
  output, so quiet runners such as PHPUnit no longer produce false positives while
  genuinely duplicated reports are still rejected.
- Detect Composer projects in `mutation doctor` and recommend Infection together
  with the coverage driver it requires.
- Resolve PHP same-namespace trait composition and grouped `use A, B;` lists as
  internal imports instead of reporting external dependencies, and drop
  self-referencing trait edges.
- Name the concrete remedy in TDD legacy/Red/Green diagnostics: move
  `.musubix/evidence/tdd.json` aside and re-record every cycle; there is no
  partial prune and hand-editing is unsupported.
- Document the `musubix-json` report schema, that the `junit` adapter drives the
  Java JUnit Platform Console launcher and not JUnit-XML producers such as
  PHPUnit, and that PHP annotations must use `/* */` rather than PHPDoc because
  PHPDoc reserves `@implements`. Align the `sdd-requirements` Skill with the
  strict JSON `Formal:`/`Performance:` formats and their exact keys.

## 0.1.6 - 2026-09-08

- Make `sdd-change` the mandatory first Skill for natural-language software
  development requests, elicit missing context one question at a time, and
  require validated requirements and design before implementation may edit code.
- Parse Surefire/Failsafe `<testcase>` elements correctly when a self-closing
  entry precedes one with `<system-out>`/`<system-err>` children, so JUnit
  identities are no longer dropped or given a neighbouring test's status.
- Stop counting Java, Kotlin and Scala annotations as calls in Code Graph.
- Report the offending field and mutant index for invalid schema-v1 mutation
  reports instead of a single opaque message.
- Explain that superseded TDD cycles are still validated and must be archived
  and regenerated rather than replaced by a newer recording.
- Label `status` artifact counts as requirement and design files, and document
  the `musubix3/analysis` entry point for `mutationIdentity` plus the
  `.musubix/evidence/native/` location for command-generated reports.
- Name the configuration key that raises a rejected workflow transcript total or
  line size limit instead of only reporting the exceeded bound.

## 0.1.5 - 2026-09-08

- Accept causally ordered concurrent workflow events whose clocks are not
  monotonic by default, while preserving optional policy-bound timestamp skew.
- Add policy-protected `workflow.maxTranscriptBytes` and
  `workflow.maxTranscriptLineBytes` so streaming sanitization and verification
  can process large real Copilot transcripts without removing resource bounds.
- Fail structured required test commands that report zero executed tests or
  skipped tests even when the process exits successfully.
- Diagnose Python trace annotations hidden in docstrings and recommend
  bytecode-free Python mutation/test execution to prevent stale `.pyc` results.
- Guide broad SDD changes through short reviewable stages rather than requiring
  a single all-inclusive prompt.

## 0.1.4 - 2026-09-08

- Measure subprocess durations with a monotonic clock and reject negative or
  non-integer TDD execution durations with `TDD_DURATION_INVALID`.
- Add `tdd validate` for direct persisted-evidence diagnostics and provide
  safer regeneration guidance for invalid legacy order or duration records.
- Add `workflow-sanitize` to reduce Copilot JSONL logs to privacy-minimized
  Skill lifecycle and terminal events before strict verification.
- Accept explicit Japanese EARS subjects such as API/service names plus common
  `時` and `中` control markers, and report bilingual corrective examples.
- Explain pytest TEST ID naming/project-runner recovery and make policy baseline
  approval diagnostics actionable for new repositories.
- Document the natural-language-only TypeScript/Python/PostgreSQL experiment
  and its fail-closed repair workflow.

## 0.1.3 - 2026-09-08

- Add a built-in `dotnet` test adapter with xUnit `DisplayName` targeting and
  recursive TRX result normalization.
- Exclude manifest-scoped .NET `bin/` and `obj/` output plus the conventional
  project-local `.nuget/packages/` cache from snapshots and Code Graph indexing.
- Exclude Gradle `.gradle/`, Dart `.dart_tool/`, SwiftPM `.build/`, Zig
  `.zig-cache/`/`zig-out/`, and .NET `.dotnet/` CLI homes only when a nearby
  ecosystem manifest identifies them as generated project state.
- Detect C#/.NET projects in `mutation doctor` and safely probe a pinned local
  Stryker.NET tool manifest without installing or downloading tools.
- Add conservative Code Graph adapters for Kotlin, Ruby, Swift, Dart, Scala,
  Elixir, Haskell, Lua, Zig, Solidity, Objective-C/Objective-C++, F# and
  Visual Basic .NET, including local dependencies, declarations and direct calls.
- Add Haskell, Lua, and Visual Basic trace-comment extraction with string
  masking, and expose annotated/executed test identity counts as constitution
  metrics.
- Reduce native Code Graph false positives and improve Scala, Visual Basic,
  Julia, PHP, Swift, Dart, Haskell, and Objective-C resolution precision.
- Normalize JUnit identities from `system-out` display names independently of
  XML attribute order, and recognize nested F# `(* ... *)` trace comments.
- Validate large applications across all 23 supported language groups: 475
  authored implementation files and 345 traced native tests, all gate-ready.

## 0.1.2 - 2026-09-07

- Exclude conventional `.venv` and `venv` Python environments identified by a
  regular `pyvenv.cfg` file from project snapshots and Code Graph indexing,
  without allowing the marker to hide arbitrary source directories.
- Add configurable `tdd.redPreflightCommands` so formatters and other plain
  preflight commands complete before a Red test fingerprint is captured.
- Add explicit `custom`, `minimal`, `recommended`, and `release` quality
  profiles with fail-closed requirements for stronger profiles.
- Accept bounded timestamp skew for causally ordered concurrent Copilot tool
  events in strict workflow verification, with a policy-protected
  `workflow.maxEventSkewMs` limit.
- Add `mutation doctor` with language-aware local engine probes, attempted
  commands, and actionable configuration recommendations.

## 0.1.1 - 2026-09-07

- Preserve fail-closed input-stability checks while reporting every added,
  modified, or deleted path with before/after SHA-256 fingerprints.
- Exclude standard Cargo and Maven `target/` build output from project input
  snapshots without ignoring source-like generated inputs.
- Merge legacy Cargo/Go `test` subcommands without producing duplicated commands
  such as `cargo test test`, and reject conflicting adapter-owned report flags.
- Discover JUnit XML recursively so nested multi-module report directories can
  be normalized.
- Add `evidence refresh` as an explicit entry point for the deterministic
  evidence and quality-gate pipeline.
- Extend `formal doctor` with every attempted solver command and actionable
  installation/configuration recommendations.
- Clarify Skill guidance to format tests before recording Red and to investigate
  per-path input-stability diagnostics without weakening quality policy.

## 0.1.0 - 2026-09-07

- Add SHA-pinned cross-platform CI, reproducible native/formal toolchains, and
  release automation for version checks, package/SBOM/checksum artifacts,
  strict GitHub OIDC-bound ephemeral-key attestations, GitHub Releases, and
  separately approved npm provenance publishing.
- Stream workflow transcript verification with fail-closed total-byte,
  per-line-byte, and event-count limits while preserving raw and canonical
  transcript hashes.
- Add P4 fail-closed model-to-implementation correspondence evidence connecting
  each explicit Formal JSON requirement through fresh generated trace evidence
  to an authoritative test passed by a fresh structured command report.
- Add dependency-free schema-v1 requirement-scoped mutation evidence with
  deterministic identities, source/test fingerprints, operator/location,
  command/report provenance, strict policy protection, attestation heads, CLI
  validation, and adversarial tamper/staleness coverage.
- Stabilize signed performance evidence across equivalent repeated gate runs by
  hashing normalized semantic results while retaining volatile run, execution,
  timestamp, report-hash, and provenance fields in `performance.json`.
- Extend trusted policy baselines to prevent weakening strict workflow session
  and freshness constraints or CI-required/strict-OIDC attestation identity and
  key binding.
- Replace change/TDD wall-clock ordering with a shared SHA-256-linked monotonic
  order ledger and explicit migration diagnostics for legacy chronology.
- Bind stable non-attestation quality verdicts and widened formal solver,
  coverage, consistency, and artifact fields into attestations without a
  circular dependency.
- Persist stdout-native adapter reports for freshness/tamper validation, add
  strict transcript freshness bounds, collision-safe formal grouping, explicit
  OIDC signature/algorithm/key negative coverage, and failed/missing reporting
  for absent CI-required attestations.
- Add configurable attestation age/future-skew enforcement and an opt-in,
  fail-closed GitHub Actions OIDC mode that verifies issuer metadata/JWKS,
  JWT signatures and identity claims, and authorizes either an ephemeral
  Ed25519 public key or a statically trusted key ID through a bound audience.
- Bind every deterministic performance observation to a gate-generated run and
  tamper-evident command/report provenance record, rejecting altered or duplicate
  reports, failed/skipped test counters, configuration drift, and untraceable
  observations while extending completeness, freshness, and attestation heads.
- Strengthen explicit formal constraints with temporal lower bounds and interval
  conflicts, exact integer normalization for compatible duration and size units,
  branch-consistent conditional consequences, faithful transition obligations,
  scalable explicit-witness Lean proofs, and native Z3/Lean mixed-model tests.
- Add an opt-in strict Code Graph mode that upgrades unresolved computed
  imports/requires from compatibility warnings to gate-blocking errors, protects
  the setting in policy baselines, and preserves safe cache-busting resolution.
- Add opt-in strict Copilot JSONL workflow verification with terminal session
  identity, successful result enforcement, causal timestamp/tool lifecycle
  checks, canonical transcript hashing, expected-session matching, and
  Ed25519-bound workflow evidence heads without claiming GitHub/OIDC origin.
- Add executable CI integration contracts for every built-in test adapter
  (Vitest, Jest, pytest, Go test, Cargo and JUnit), including unrelated failing
  tests that prove target isolation and authentic native-report normalization.
- Create native report parent directories before execution so Jest and other
  file reporters can write fresh evidence, and replace the unsupported JUnit
  method-name option with exact `@Tag("TEST-*")` selection plus no-test failure.
- Add strict optional `Formal:` JSON constraints for conditional implications,
  integer bounds, bounded response time, and state transitions, with deterministic
  coverage plus SMT-LIB2 and Lean translations.
- Add fail-closed Ed25519 CI evidence attestations bound to repository, commit,
  CI provider/run ID, and deterministic evidence heads; private keys remain
  outside musubix3.
- Add Vitest/Jest, pytest, Go test, Cargo and JUnit adapters for targeted TDD
  arguments and native-result normalization while preserving custom reports;
  filter unrelated skipped tests and use runner-valid identifier conventions.
- Require one distinct, completed, ordered Copilot Skill tool call for every
  completed workflow declaration, with one final declaration per Skill invocation.
- Resolve package-manifest entrypoints and safe local cache-busting dynamic
  imports while retaining warnings for arbitrary computed loading.
- Strengthen staged-change completeness with measurable Acceptance criteria,
  concrete design fields, authoritative test declarations, exact CHANGE
  requirement enumeration, and deterministic operation-budget evidence.
- Chain every TDD phase into an append-only SHA-256 ledger and reject missing,
  reordered, altered, duplicate, or orphaned phase records.
- Scope staged implementation fingerprints to each changed requirement's linked
  code and Code Graph dependencies, so unrelated source edits cannot satisfy it.
- Replace `test-identities` output substring matching with fresh structured
  command reports that prove every annotated test actually passed.
- Add functional/non-functional requirement classification and an automatic
  per-CHANGE completeness gate for requirements, design, ADR, code, tests, TDD,
  and trace evidence.
- Automatically require workflow and TDD validation whenever their evidence is
  present, and require TDD for every staged change document.
- Require test-scoped `tddArgs`, target-specific failed/passed output, and a
  non-test source change between Red and Green.
- Require a fresh structured per-test JSON report; missing, malformed, skipped,
  errored, or multi-test reports cannot satisfy a TDD phase.
- Reject legacy/unscoped TDD evidence and identical phase output reused across
  different tests.
- Fingerprint the annotated JS/TS test declaration instead of the entire test
  file, so adding an unrelated test does not invalidate existing TDD cycles.
- Preserve repeated TDD cycles append-only so later reruns cannot erase the
  historical Red/Green evidence referenced by staged changes.
- Add `workflow-verify` to reconcile declarations with actual Copilot JSONL
  Skill invocation events and invalidate verification after declaration changes.
- Add ordered `change-record` checkpoints and a `change-history` gate for
  requirements, design, test, implementation, and TDD chronology.
- Require a one-to-one match between `CHANGE-*.md` documents and chronology
  records; an unrecorded document or orphan record blocks readiness.
- Require each affected requirement's Red after the requirements checkpoint and
  its matching Green after the implementation checkpoint, preventing reuse of
  pre-change TDD cycles.
- Require every mandatory requirement to have a valid Red-Green cycle from an
  authoritative verifying test when the TDD gate is enabled.
- Prohibit Skills from substituting `musubix`, `musubix2`, or other similarly
  named packages when the exact `musubix3` CLI is unavailable.
- Added `sdd-change`, an integrated feature/change/fix workflow that propagates
  observable behavior through requirements, design, implementation, tests,
  traceability, graph evidence, and the final quality gate.
- Added reproducible SMT-LIB2 and Lean artifact generation with SHA-256 metadata.
- Added `formal doctor`, configurable solver executables, Lake fallback, versions,
  execution duration, and configurable timeouts.
- Replaced Lean's concrete assignment check with decidable satisfiability and
  unsatisfiability theorems for the documented Boolean abstraction.
- Added Japanese unconditional obligation/prohibition normalization so bilingual
  requirements can participate in formal consistency checks.
- Added authoritative comment-trace scanning for Rust, Python, Go, Java/Kotlin,
  C/C++, C#, Ruby, PHP and Swift, with string-literal masking.
- Prohibited synthetic trace proxy files in the implementation, traceability and
  integrated change Skills.
- Added explicit `GRAPH_UNSUPPORTED_LANGUAGE` evidence for non-JS/TS sources.
- Excluded transient logs, JSONL sessions and installed Skill copies from quality
  evidence freshness fingerprints.
- Added native Rust, Python, Go, Java, C/C++, C#, PHP, R and Julia
  import/module/include/source, symbol and direct-call graph indexing.
- Added optional formal and executed-test-identity quality gates with persisted
  formal coverage evidence.
- Added a trusted policy baseline, preserved changed-run context, workflow event
  manifests with command hashes, N/A link coverage, and duplicate requirement
  statement detection.
- Added verified TDD evidence commands for Red, Green and Refactor phases,
  requiring linked requirement/test IDs, observed test IDs, expected exit states,
  stable test fingerprints and consistent command hashes.

## 0.1.0-rc.1

- Clean TypeScript ESM workspaces for domain checks, analysis and the `musubix3` CLI.
- Seven bilingual GitHub Copilot CLI skills; root plugin and native marketplace.
- Preservation-first npm installer with dry-run and injectable native plugin install.
- Six controlled EARS patterns, versioned measurable constitution, explicit designs.
- Generated trace graphs, bidirectional impact and coverage/staleness diagnostics.
- Compiler-based JS/TS dependency indexing, reverse impact, cycles and architecture rules.
- Local TF-IDF retrieval with bounded Git co-change/contribution evidence.
- Conservative deterministic consistency checks and optional real Z3/Lean adapters.
- Actual command quality gates with pass/fail/skipped, changed-file context and status.
- Tests, Node 20/24 CI and npm package-content verification.

This is a new artifact schema. No musubix2 migration or compatibility is provided.
