---
name: sdd-implementation
description: "Use when implementing approved SDD requirements and designs with explicit code/test trace annotations and real verification evidence. 設計に基づく実装・テスト時に使用。"
---
# Implementation / 実装

/* @id CODE-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-002
 * @implements REQ-EVIDENCE-WRITER-LOCK-006 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 * @design DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001 DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-003
 */
Follow the user's input language (日本語 / English). Use Copilot's native planning, editing and subagents for implementation; do not introduce code generators, generic test generators or a second orchestration/task system.
Run only the repository's exact `musubix3` CLI. Never fall back to similarly named npm packages; report a blocker if the executable is unavailable. After the work, run `npx musubix3 workflow-record sdd-implementation complete --status completed` exactly once.
If `EVIDENCE_WRITER_LOCKED` blocks a command, stop the blocked command and inspect its reported owner metadata and exact canonical `.musubix/evidence/.writer-lock.json` path. On Linux, only after confirming the recorded owner is no longer active, run `npx musubix3 evidence unlock --recover`. For `EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED`, inspect `lockRemoved`: false may be a live failed acquirer with no lease or owner metadata may be unavailable, so automatic recovery is preferred after it exits; a mismatched readable owner is a replacement lock that must not be removed. True means absent now but crash durability is unconfirmed, so inspect only the exact reported path before retrying.
Never blindly delete the lock, force-steal it, poll, or start automatic retry loops. If recovery returns `EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`, including on Linux, or required probes are unavailable on macOS/Windows, stop automation: operator review must confirm no related process is active before targeted manual removal of only the exact reported path.
Retry only after the active owner releases the lock, recovery succeeds, or the reviewed manual procedure completes.

1. Before editing implementation code, verify that approved requirements and
   design artifacts exist, both validators pass, and `approval validate` reports
   current requirements and design approval. If either is absent, stale, or invalid,
   stop and return to `sdd-change`, invoking `sdd-requirements` and `sdd-design`
   as needed. `tdd red` also enforces design approval. Do not infer approval from
   validation or a natural-language request such as
   "develop", "build", 「開発」, 「作成」, or 「実装」.
2. For behavior changes and bug fixes, write a meaningful failing test before
   implementation. Configure the selected command with `tddArgs` containing
   `{testId}` or `{testPath}` and a `tddReport`, or use a built-in runner adapter.
   Follow its native identity contract: pytest/Cargo use underscore names, Go
   uses a `TEST-*` subtest, JUnit uses an exact `@Tag("TEST-*")`, and xUnit uses
   a `Fact` `DisplayName` containing the exact ID.
   Run the repository formatter before recording Red. Formatting is part of the
   test fingerprint: after Red, do not edit or reformat the authoritative test
   until the matching Green has been recorded.
   Make the runner emit a fresh
   `musubix-json` report containing only the selected test (plus declared
   deterministic `operations` counters when applicable) and run
   `npx musubix3 tdd red <TEST-ID> --requirement <REQ-ID> --command <name>` with exactly one requirement per invocation; when a test verifies multiple requirements, record a separate Red/Green cycle for each requirement, collecting every Red in the batch unlike variadic `change-record --requirement <REQ-ID...>`. Immediately record the matching `change-record <CHANGE-ID> red --requirement <REQ-ID...>` batch before implementation or any TDD Green.
3. Implement only enough code to pass, preserving the test unchanged, record
   `change-record <CHANGE-ID> implementation --requirement <REQ-ID...>`, then run
   `tdd green` and record `change-record <CHANGE-ID> green --requirement <REQ-ID...>`.
   This exact order avoids `green-already-recorded`; preflight rejection uses stable
   `CHANGE_*_TDD_PREFLIGHT_FAILED` codes, emits deterministic JSON details, and
   performs no evidence write or order allocation. Refactor only after Green and record `tdd refactor`.
   Use `tdd validate` to inspect persisted order, fingerprints, durations and
   hash-chain evidence before claiming the cycle is complete.
4. Add one block comment per trace entity:
   ```ts
   /** @id CODE-FEATURE-001
    * @implements REQ-FEATURE-001
    * @design DES-FEATURE-001
    */
   ```
   Tests use a separate block:
   ```ts
   /** @id TEST-FEATURE-001
    * @verifies REQ-FEATURE-001
    */
   ```
   IDs are globally unique. Multiple targets are comma/space-separated.
   Put annotations in the authoritative source and test files, including
   supported non-JS/TS files. In Python, use consecutive `#` comment lines;
   annotations inside docstrings are ignored and diagnosed. Never add a proxy file just to increase coverage.
   An annotation establishes a link, not proof that code or tests are correct.
5. Before recording Red, run every configured `tdd.redPreflightCommands`
   formatter/check and let musubix3 enforce that preflight. Then run the
   project's actual focused tests/typecheck/build; fix failures.
   When mutation evidence is required, use the project's existing lightweight
   mutation mechanism to emit schema-v1 deterministic identities, requirement/
   test linkage, source/test SHA-256, operator/location, and killed status.
   Never fabricate results or add a large mutation dependency. Use
   `npx musubix3 mutation doctor --json` to inspect locally available engines
   and configuration recommendations. Before Python mutation runs, remove
   existing `__pycache__` directories, then use `-B` for mutation and test
   commands so stale bytecode is absent and no new `.pyc` files are created.
6. Regenerate `npx musubix3 trace build`, check `trace check --strict`, then
   `npx musubix3 gate --changed`. Configure real command/argument arrays first.
7. Use Copilot's native review and security-review capabilities when appropriate.
   Report executed evidence separately from review advice and skipped work.
