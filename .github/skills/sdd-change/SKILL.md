---
name: sdd-change
description: "Use for feature additions, behavior changes, bug fixes, refactoring with observable impact, or any request that must propagate through requirements, design, code, tests, traceability, and quality evidence. 機能追加・仕様変更・バグ修正を一貫して反映するときに使用。"
---
# Integrated change workflow / 統合変更ワークフロー
Follow the user's input language (日本語 / English). Use Copilot's native
planning, editing, research, review, security review and subagents where useful.
This skill coordinates SDD artifacts and checks; it is not another agent runtime.
Record exactly one final invocation outcome with `npx musubix3 workflow-record
sdd-change complete --status <status>`; `change-record` separately proves phases.
Run `workflow-sanitize <copilot.jsonl> <safe.jsonl>` before review when needed,
then `workflow-verify <safe.jsonl>`; sanitization strictly validates the source.
For strict evidence, set an expected UUID or pass `--strict --session-id <uuid>`;
this checks lifecycles; GitHub origin needs strict OIDC with key-bound claims.
Never record multiple declarations per invocation; use only the configured CLI.
For a staged change, run `change-record <CHANGE-ID> <phase> --requirement
<REQ-ID...>` after each phase in this exact order: `impact`, `requirements`,
`design`, `red`, `implementation`, `green`, `quality`.
List only requirements whose statement or acceptance changes, classify each as
functional/non-functional, and document other impacts separately. Each listed
requirement needs fresh Red after `requirements` and Green after `implementation`.
The CHANGE document must contain `Requirements:` with exactly those normative IDs.
Persisted monotonic order, not wall-clock time, proves these phase boundaries.
## 1. Classify and inspect / 分類と事前確認
1. Classify the request as a feature, behavior change, defect correction,
   refactoring, or documentation-only change.
2. Read the constitution and relevant requirements, designs, ADRs, code and tests.
3. Run `npx musubix3 trace impact <id-or-path> --json` and, when code exists,
   `graph index` plus `graph impact <symbol-or-path> --json`.
4. Separate confirmed intent, assumptions and open questions. Ask only questions
   that materially affect observable behavior, safety or compatibility.

## 2. Update specifications first / 仕様を先に更新
1. For new or changed observable behavior, add or revise EARS requirements and
   measurable acceptance criteria before implementation. Preserve stable IDs
   when meaning remains the same; create new IDs when obligations are distinct.
2. For a bug where implementation violates an existing requirement, keep that
   requirement and record that no specification change is needed. Never rewrite
   a requirement merely to make incorrect behavior appear compliant.
3. Update design responsibilities, interfaces, constraints and requirement links.
   Add or supersede an ADR only for a real architectural or trade-off decision.
4. Run requirements, constitution and design validation. Stop on invalid
   artifacts instead of continuing with unapproved assumptions.
## 3. Implement and prove coverage / 実装と網羅性
1. For observable behavior changes and defect fixes, write the smallest meaningful
   test first. Include its `TEST-*` ID in the test name/output and link it to the
   requirement with `@verifies`. Configure the command's `tddArgs` with
   `{testId}` or `{testPath}` so only that test is selected. Configure
   `tddReport` and make the runner write a fresh `musubix-json` result containing
   exactly the target test with `failed` or `passed` status, or select a built-in
   test adapter. For deterministic performance requirements, use a passing
   instrumented `operations` report with command/report/run/exit provenance;
   native adapters cannot emit app counters, and elapsed time is insufficient.
2. Run `npx musubix3 tdd red <TEST-ID> --requirement <REQ-ID> --command <name>`.
   Do not edit implementation code until this records the expected failing test.
3. Implement the smallest complete change, preserving the test, then run
   `tdd green` with the same IDs and command. Refactor only after Green and record
   `tdd refactor` after the refactored code passes.
4. Maintain unique `CODE-*` / `TEST-*` IDs and `@implements`, `@design`,
   `@verifies` annotations in the authoritative implementation and test files.
   Never create proxy or placeholder source files solely to satisfy trace coverage.
   Links are evidence locations, not proof by themselves.
5. Run focused tests during implementation, then the configured typecheck,
   build and complete test commands.
Documentation, formatting and prototypes may omit TDD unless policy requires it;
record the reason and never exempt observable behavior changes.
## 4. Rebuild evidence and finish / 根拠更新と完了
1. Run `trace build`, `trace check --strict`, `graph index`, and `graph gate`.
2. Run `formal check` when changed requirements fit its documented abstraction;
   use strict `Formal:` JSON for explicit conditional, numeric, temporal or
   transition semantics; report unsupported prose rather than claiming proof.
   A required `formal` check enforces modeled fraction and configured solver.
3. Run `gate --changed --json` and `status --json`. Repair failures, dangling
   links and stale evidence; never weaken requirements or policy to obtain green.
4. Complete only when required checks pass and `status.gate.ready` is true.
   Otherwise report the exact blocker and which artifacts remain incomplete.
If the user limits the task to one phase, state which downstream work remains;
never treat an implementation-only change as a complete SDD change.
