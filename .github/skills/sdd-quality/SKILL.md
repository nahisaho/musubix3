---
name: sdd-quality
description: "Use when deciding release readiness from actual checks, measurable policy, architecture and trace evidence, including incremental change checks. 品質ゲート・リリース判定時に使用。"
---
# Quality / 品質

Follow the user's input language (日本語 / English). Use native Copilot review and
security review for their specialist reasoning; this skill does not replace them.
After the work, run `npx musubix3 workflow-record sdd-quality complete --status
completed` exactly once.
1. Inspect `.musubix/config.json` and `.musubix/policy-baseline.json` before
   running commands. Only execute trusted project configuration. Commands are
   executable/argument arrays, not shell text. Never edit the baseline without
   explicit independent approval. Use only the exact `musubix3` CLI; never
   substitute similarly named npm packages.
2. Configure real tests/build/typecheck commands and timeouts. Use an explicit
   custom report or a built-in Vitest/Jest, pytest, Go test, Cargo or JUnit
   adapter. Require executable native adapter contracts in CI; JUnit targets use
   an exact `@Tag("TEST-*")`, and pytest requires `pytest-json-report`. Review
   `requiredChecks`, `qualityProfile`, coverage thresholds and architecture rules.
   Use `recommended` or `release` only when all profile requirements are
   intentionally configured; profile validation never invents missing evidence. Use strict
   `codeGraph.mode` when unresolved computed module loading must block release,
   and ensure the trusted baseline prevents downgrading it. Configure a
   fresh structured `testReport` for `test-identities`. Do not weaken policy.
3. Run `npx musubix3 gate --json` or `npx musubix3 gate --changed --json`.
   `evidence refresh --json` runs the same fail-closed pipeline. If `input-stability` fails,
   inspect its per-path added/modified/deleted diagnostics and stop generators
   or formatters before rerunning. Standard dependency/build directories,
   including manifest-scoped Cargo and Maven `target/` and conventional `.venv`
   or `venv` roots with a regular `pyvenv.cfg`, are excluded; arbitrary source
   directories and source-like generated inputs are not silently ignored.
   Changed mode reports Git changes and dependent files but conservatively runs
   all checks, including commands. It never treats unrun checks as successful.
   When `tdd` is required, confirm every command has test-scoped `tddArgs`, every
   cycle has a fresh structured `tddReport`, and a real failing Red is followed
   by a passing Green using the same command and unchanged test.
4. Inspect `.musubix/evidence/quality.json`: pass/fail/skipped, required flags,
   command exits/output, measured rules, preserved changed-run context and input
   fingerprints. Inspect `formal.json` and `workflow.json` when configured.
   Treat workflow records as declarations until `workflow-verify` binds each
   completed declaration to one distinct completed Copilot Skill tool call.
   In strict mode require one final successful result, matching session UUID,
   causal transcript order, policy-bounded concurrent-event clock skew, bounded
   freshness, complete tool lifecycles and canonical transcript hash. Ensure the
   baseline protects strict/session/freshness/event-skew policy.
   When `change-history` is required,
   confirm ordered checkpoints, chained TDD records, requirement-scoped Code
   Graph changes, exact CHANGE requirement enumeration, measurable Acceptance,
   concrete designs, authoritative tests and per-CHANGE artifact completeness.
   Enforce declared operation counters for deterministic performance budgets;
   wall-clock duration alone is insufficient. Confirm each observation's hashed
   gate run, exact command, fresh report, passing test, counter and exit provenance;
   duplicate sources, persisted stdout report changes and configuration drift
   invalidate it. Equivalent reruns may change provenance IDs without changing
   the signed semantic performance head.
   For explicit `Formal:` JSON, require model-correspondence evidence binding
   the current model and generated trace to an authoritative `TEST-*` passed by
   a fresh structured report. For release, set `mutation.mode` to `strict`,
   protect it and its command in the baseline, and require deterministic mutant
   identities bound to must functional requirements, current source/test
   fingerprints, operator/location, authoritative tests, and killed results.
   Reject survived, skipped, duplicate, conflicting, stale, or unlinked mutants.
   Run `mutation doctor` for language-aware local probes and remediation;
   musubix3 validates evidence and does not bundle a mutation engine.
   Missing required tools, commands, artifacts or evidence block readiness.
5. Use native review/security-review as needed, recording their findings
   separately from machine evidence. Never fabricate review or test results.
6. For static CI provenance, configure trusted Ed25519 public keys, freshness
   bounds and `ci-required`; sign `attestation payload` outside musubix3. For
   GitHub Actions identity, opt into strict `githubOidc`, derive the key-bound
   custom audience, obtain a short-lived token, and include only the public key
   and token in the payload. Verification must fetch issuer metadata/JWKS and
   check all configured claims; offline strict verification fails closed.
   Ensure the baseline protects CI-required mode, strict OIDC and key binding.
   Never store a private key or overstate OIDC as proof of arbitrary runner work.
7. Run `npx musubix3 status --json`; stale evidence must be refreshed. Report
   limitations and residual risks before handoff; no resident watcher or REPL.
