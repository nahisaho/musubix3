# Changelog

## Unreleased

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
