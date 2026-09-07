# musubix3

**Development v0.1.1 · Latest published v0.1.0 · GitHub Copilot CLI only · Node.js ≥20 · TypeScript · MIT**

[日本語](README-ja.md)

[What changed from musubix2 to musubix3 (Japanese)](MUSUBIX2-TO-MUSUBIX3.md)

Specification-driven development (SDD) skills backed by deterministic checks:
requirements → constitution → design/ADRs → implementation → traceability →
quality evidence. Optional formal consistency, compiler dependency analysis and
local knowledge retrieval support the workflow.

Learned from [musubix2](https://github.com/nahisaho/musubix2)'s concepts, rebuilt
cleanly in three workspaces. No artifact compatibility or migration is promised.
This repository does **not** guarantee correctness simply because IDs are linked
or requirements are satisfiable.

## Quick start

Run the published package from the target project:

```sh
npx musubix3@0.1.0 --version
npx musubix3@0.1.0 init --dry-run
npx musubix3@0.1.0 init
copilot
```

For a reproducible project-local installation:

```sh
npm install --save-dev --save-exact musubix3@0.1.0
npx --no-install musubix3 --version
npx --no-install musubix3 init --dry-run
npx --no-install musubix3 init
```

To build the repository itself:

```sh
git clone https://github.com/nahisaho/musubix3.git
cd musubix3
npm install
npm run build
node dist/packages/cli/src/main.js --help
```

Ask Copilot: “Use sdd-change to add this feature and propagate it through the
specification, implementation, traceability, and quality gate.”
All eight skills instruct Copilot to follow your input language (English/Japanese).

`init` (`install` alias) copies repository-local skills and creates starter SDD
artifacts. It preserves existing files, merges a cache ignore rule, and is
idempotent. `--force` replaces only named bundled/managed paths; it does not
delete unrelated files. Review its dry-run first. No Copilot global settings,
MCP, LSP, hooks, or project instructions are overwritten. Symbolic-link write
targets and paths escaping the project are refused.

The starter is deliberately **not release-ready**: replace its example, implement
and test it, and configure real check commands before expecting the gate to pass.

## Distribution options

Choose one skill-loading route to avoid duplicate skill names.

### Native plugin (direct)

```sh
copilot plugin install ./musubix3            # built/local clone, from its parent
copilot plugin install nahisaho/musubix3     # published GitHub repository
```

`plugin.json` at the repository root is the source of truth and references
`.github/skills/`. The plugin contains skills, not an agent runtime or background
services. Git installs do not compile/install the npm engine: build the clone or
install the npm package separately when running `npx musubix3` commands.

From an installed npm package, `npx musubix3 plugin-install` delegates directly to
`copilot plugin install <absolute-package-root>`. It does not edit Copilot
internals. For a durable local plugin path, prefer `npm install --save-dev musubix3`
and `npx --no-install musubix3 plugin-install` over an ephemeral npx cache.

### Native marketplace

```sh
copilot plugin marketplace add nahisaho/musubix3
copilot plugin install musubix3@musubix3-marketplace
# Local development:
copilot plugin marketplace add ./musubix3
```

The catalog is `.github/plugin/marketplace.json`; its plugin source is `.`.
These flows use the [native plugin interface](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).

### Repository-local skills / npm installer

Run `npx musubix3 init` in the target repository, or copy `.github/skills/sdd-*`
there yourself. Start Copilot in that trusted project. `init --root <dir>` targets
another project; `--feature <slug>` changes the starter directory and ID prefix.
Installing another feature does not reset existing configuration.

## Skills and native boundaries

| Skill | Purpose |
|---|---|
| `sdd-change` | End-to-end feature/change/fix propagation and completion gate |
| `sdd-requirements` | Six controlled EARS forms and measurable constitution |
| `sdd-design` | Explicit responsibilities/interfaces/constraints, ADRs, diagrams |
| `sdd-implementation` | Native editing with requirement-linked code and tests |
| `sdd-traceability` | Generated coverage, dangling links, bidirectional impact |
| `sdd-quality` | Actual verification commands, policy, readiness evidence |
| `sdd-knowledge` | Local artifact/Git retrieval, not conversational memory |
| `sdd-formal-codegraph` | Optional consistency checks, compiler graph, architecture |

Use **native Copilot** for planning, editing, research, review, security review,
memory, code navigation/LSP, MCP management, and subagent/fleet/task coordination.
musubix3 does not implement those services, generic code/test generation,
orchestration, a scheduler, MCP server, Claude support, an interactive REPL, or a
resident watcher. `status`, `query`, `impact` and `--changed` provide one-shot value.
Skills may combine neural proposals from Copilot with symbolic checks; there is
no separate “neurosymbolic AI” model or claims of learned verification.

## Workflow

For normal feature additions, behavior changes and bug fixes, use `sdd-change`.
It coordinates the complete workflow below and refuses to call an
implementation-only change complete while required artifacts remain stale.

1. Use native planning/research to establish intent and measurable acceptance.
2. Record `change-record CHANGE-ID impact`, then edit/validate requirements and
   record the `requirements` checkpoint.
3. Design explicit components, record trade-offs in ADRs, then record `design`.
4. Write an annotated behavior test, record a structured failing `tdd red`, then
   record the change `red` checkpoint.
5. Implement the minimum change, record `implementation`, run passing `tdd green`,
   then record `green` and refactor.
6. Add trace annotations, build graphs, inspect impact and fix missing coverage.
7. Configure real checks, run `gate --changed`, use native review/security review,
   and inspect status before release. Do not weaken policy simply to pass.

```sh
npx musubix3 requirements validate .musubix/features/example/requirements.md --json
npx musubix3 constitution validate --json
npx musubix3 design validate .musubix/features/example/design.md --json
npx musubix3 design c4 .musubix/features/example/design.md
npx musubix3 change-record CHANGE-0001 design --requirement REQ-EXAMPLE-001
npx musubix3 tdd red TEST-EXAMPLE-001 --requirement REQ-EXAMPLE-001 --command test
# Implement the minimum behavior without changing the test.
npx musubix3 tdd green TEST-EXAMPLE-001 --requirement REQ-EXAMPLE-001 --command test
npx musubix3 tdd refactor TEST-EXAMPLE-001 --requirement REQ-EXAMPLE-001 --command test
npx musubix3 trace build
npx musubix3 trace check --strict --json
npx musubix3 graph index
npx musubix3 graph impact src/service.ts
npx musubix3 gate --changed --json
npx musubix3 status --json
```

## Command reference

All analysis commands accept `--root <directory>` and `--json`. Files resolve
relative to that root; access outside it is refused. `plugin-install` uses the
installed package root. Exit codes: **0** successful operation, **1** rejected
validation/gate or requested solver failure, **2** usage, I/O or malformed config.
`status` is informational (exit 0 even if not ready); inspect `gate.ready`.

| Command | Behavior |
|---|---|
| `init [--dry-run] [--force] [--feature slug]` | Preserve-first skills/artifacts installation; `install` alias |
| `plugin-install` | Invoke native Copilot installer (no internal config edits) |
| `requirements validate <file>` | IDs, priorities, declared/detected EARS pattern |
| `constitution validate [file]` | Versioned principles and measurable rule definitions |
| `design validate <file>` | Fields, global requirement IDs, existing ADR references |
| `design c4 <file>` | Mermaid component/dependency diagram from explicit fields |
| `trace build` | Generate global trace snapshot and feature copies |
| `trace check [--strict]` | Dangling IDs, stale inputs/paths, mandatory coverage |
| `trace impact <id-or-path>` | Bidirectional breadth-first traversal with explanation paths |
| `graph index [--changed]` | Compiler imports, declarations and best-effort call targets |
| `graph impact <symbol-or-path>` | Conservative reverse-import closure; `path#name` disambiguates |
| `graph cycles` | Strongly connected components; exit 1 when cycles exist |
| `graph gate` | Fresh index + architecture rule/cycle checks |
| `knowledge build` | Markdown and bounded Git evidence index |
| `knowledge query <text> [--limit 10]` | Deterministic TF-IDF/cosine results and staleness flag |
| `formal generate <file> [--format both\|smt2\|lean]` | Reproducible solver inputs with SHA-256 evidence |
| `formal doctor` | Probe Z3, Lean, and `lake env lean` availability and versions |
| `formal check <file> [--solver auto\|none\|z3\|lean]` | Check the explicit Boolean/conditional/numeric/temporal/transition model |
| `model-correspondence validate` | Revalidate Formal JSON → generated trace → authoritative passing test evidence |
| `evidence refresh [--changed]` | Regenerate derived evidence through the same fail-closed gate pipeline |
| `mutation validate` | Revalidate requirement-scoped schema-v1 killed-mutant evidence |
| `tdd red\|green\|refactor <TEST-ID> --requirement <REQ-ID> --command <name>` | Execute and record a verified TDD phase |
| `workflow-record <skill> <phase> --status <status>` | Record a compact self-reported workflow declaration |
| `workflow-verify <copilot.jsonl> [--strict] [--session-id <uuid>]` | Reconcile Skill events; optionally require a complete successful session transcript |
| `attestation oidc-audience --key-id <id> [--public-key-file <pem>]` | Derive the GitHub custom audience that authorizes a signing key |
| `attestation payload --provider <name> --run-id <id> --key-id <id> [--public-key-file <pem>] [--github-oidc-token-file <jwt>]` | Emit canonical unsigned CI payload for external signing |
| `attestation verify` | Verify static-key or GitHub OIDC-authorized Ed25519 provenance |
| `change-record <CHANGE-ID> <phase> --requirement <REQ-ID...>` | Record ordered artifact/TDD fingerprints for a staged change |
| `gate [--changed]` | Fresh full checks plus actual configured commands; persist evidence |
| `status` | Artifact counts and readiness/staleness summary |

`--changed` reads staged, unstaged, untracked and renamed/deleted paths from Git.
It reports affected files but **conservatively recomputes all deterministic checks
and executes all configured commands**. This avoids unsafe incremental skips.
There is no daemon, polling loop or background service.
Workflow evidence automatically requires `workflow`. TDD evidence automatically
requires `tdd`; a `.musubix/changes/CHANGE-*.md` document additionally requires
`tdd`, `change-history`, and `change-completeness`, even when omitted from
`requiredChecks`.

## Artifact schema (v1)

```text
.github/skills/sdd-*/SKILL.md
.musubix/
  config.json
  constitution.md
  features/<slug>/
    requirements.md
    design.md
    trace.json                 # generated; never hand-edit
  decisions/ADR-0001.md
  evidence/
    quality.json                # actual gate report, initially skipped
    workflow.json               # declarations plus optional strict transcript/session evidence
    tdd.json                    # append-only phase hash chain and TDD cycles
    changes.json                # staged change checkpoints
    order.json                  # shared monotonic TDD/change chronology ledger
    performance.json            # deterministic operation-budget observations
    model-correspondence.json   # Formal model → trace → fresh passing test proof
    mutation.json               # fresh requirement-scoped mutation executions
    attestation.json            # optional externally signed CI provenance
  cache/                       # ignored; generated indexes and solver inputs
```

### Requirements and design

```markdown
---
schemaVersion: 1
feature: auth
---
## REQ-AUTH-001: Reject expired sessions
Priority: must
Type: functional
Pattern: event-driven
Statement: When a session expires, the system shall reject the request.
Acceptance: An expired-session request produces HTTP 401.
Formal: {"kind":"conditional","condition":"session.expired","consequence":"request.rejected"}

## DES-AUTH-001: Session guard
Responsibilities: Reject requests whose session has expired.
Interfaces: guard(request) returns a principal or HTTP 401.
Constraints: Do not log session tokens.
Requirements: REQ-AUTH-001
ADRs: ADR-0001
Depends-On: DES-AUTH-002
```

Put these entries in their respective `requirements.md` / `design.md`; declare
every dependency as another component. Each requirement has one controlled
statement. Accepted priorities are `must` (default), `should`, `may`.
Requirement types are `functional` (default) and `non-functional`.
`Formal:` is optional strict single-line JSON. Supported kinds are `conditional`,
`numeric` (integer comparison), `temporal` (`withinMs` plus optional nonnegative
`afterMs`), and `transition` (`from`/`event`/`to`). Numeric units `ms`/`s`/`min`
share an exact duration dimension, while `bytes`/`kib`/`mib` share an exact size
dimension. Other units and incompatible dimensions remain separate. It models
only the declared fields. A non-functional
requirement may also declare
`Performance: {"counter":"visitedNodes","max":100,"testId":"TEST-AUTH-002"}`;
the named passing test must report that integer operation counter.
IDs use uppercase `REQ-`, `DES-`, `CODE-`, `TEST-`, a feature prefix, and ≥3 digits.
ADRs use `ADR-` plus ≥4 digits. IDs must be globally unique.

Six EARS patterns: “The system shall …”; “When …, the system shall …”;
“While …, …”; “If …, then …”; “Where …, …”; combined distinct
Where/While/When clauses. Japanese controlled forms are documented in
[README-ja.md](README-ja.md). These are syntax checks, not natural-language
understanding; arbitrary prose is deliberately rejected.

Source/test trace annotations are read from comments in JS/TS, Rust, Python, Go,
Java/Kotlin, C/C++, C#, Ruby, PHP and Swift. JS/TS parsing excludes string
literals; other languages require line or block comments:

```ts
/** @id CODE-AUTH-001
 * @implements REQ-AUTH-001
 * @design DES-AUTH-001
 */
export function guard() { /* actual implementation */ }

/** @id TEST-AUTH-001
 * @verifies REQ-AUTH-001
 */
// Real behavior test follows.
```

One block comment per entity; comma/space-separated targets. `@design` is optional.
Mandatory implementation coverage may be direct or through a linked design;
tests must directly verify a requirement. Links alone are not semantic proof.
Each feature's `trace.json` holds the complete repository snapshot, including
cross-feature edges and input SHA-256 fingerprints; copies intentionally agree.
The cache is preferred when present; feature snapshots support cache-free checks.
Rebuild when inputs change; stale impact queries are rejected.

### Constitution and configuration

```markdown
---
version: 1.0.0
---
## PRINC-001: Evidence first
### RULE-001: No missing trace coverage
Metric: trace.errors
Limit: 0
```

Supported metrics are `requirements.errors`, `design.errors`, `trace.errors`,
`graph.violations`, `formal.errors`, `formal.modeledFraction`,
`tests.annotatedIds`, `tests.executedIds`, `commands.failures` and
`commands.skipped`. Every rule declares a nonnegative numeric upper bound.
`constitution validate` checks the definition; only `gate` measures it.
Unavailable evidence is skipped, never a measured zero.

Example `.musubix/config.json` (adapt command arguments to your own project):

```json
{
  "schemaVersion": 1,
  "language": "auto",
  "commands": [
    { "name": "typecheck", "command": "npm", "args": ["run", "typecheck"], "required": true, "timeoutMs": 120000 },
    {
      "name": "test",
      "command": "npm",
      "args": ["test", "--"],
      "adapter": "vitest",
      "required": true,
      "timeoutMs": 120000
    }
  ],
  "requiredChecks": ["requirements", "design", "constitution", "trace", "graph", "commands"],
  "thresholds": { "design": 1, "implementation": 1, "tests": 1 },
  "formal": { "solver": "none", "minModeledFraction": 0, "timeoutMs": 12000 },
  "mutation": { "mode": "compatible" },
  "workflow": {
    "mode": "compatible",
    "maxAgeSeconds": 3600,
    "maxFutureSkewSeconds": 60
  },
  "attestation": {
    "mode": "local",
    "maxAgeSeconds": 3600,
    "maxFutureSkewSeconds": 60,
    "trustedPublicKeys": [],
    "githubOidc": { "mode": "off" }
  },
  "codeGraph": { "mode": "compatible" },
  "architecture": {
    "forbidCycles": true,
    "rules": [
      { "name": "domain-isolation", "from": "src/domain/**", "disallow": ["src/ui/**", "npm:express"] }
    ]
  }
}
```

Config is validated strictly; misspelled keys, invalid bounds and duplicate
commands fail closed. Globs support `*`, `**`, `?`; external imports use `npm:`.
`codeGraph.mode` defaults to `compatible`, where unresolved computed
`import()`/`require()` calls remain warnings. Set it to `strict` to make those
diagnostics gate-blocking errors. A trusted strict policy baseline prevents
downgrading the project back to compatible mode.
Coverage bounds are fractions [0,1] of mandatory requirements. Bare `trace check
--strict` always requires full coverage; the aggregate gate uses config thresholds.
The reported value is **link coverage**, not proof; with zero mandatory
requirements it is `null` (not applicable). Add `test-identities` to
`requiredChecks` to require every annotated `TEST-*` ID to be reported `passed`
by a fresh structured report from a successful configured command.
Add `formal` to enforce the configured solver and minimum modeled fraction.
Every requirement containing explicit `Formal:` JSON automatically requires
`model-correspondence`: its current formal constraint and generated trace must
lead to at least one authoritative `TEST-*` that passed in a fresh structured
command report. Missing, changed, unlinked, or stale evidence fails closed.
Add `tdd` to require complete Red-Green cycles. Red must be an observed nonzero
test result; Green/Refactor must pass with the same configured command and
unchanged test file. Test names/output must contain their `TEST-*` ID.
`language` records project preference; skills follow input language. Machine
diagnostic codes are stable English; human status labels include Japanese.

`.musubix/policy-baseline.json` records minimum required checks, coverage,
architecture, formal policy, mutation mode, workflow strict/session/freshness settings,
CI-required attestation and strict OIDC identity/key binding, and required
command names. Weakening is rejected; changing the baseline in `gate --changed`
requires independent approval. Protect the baseline with review/CODEOWNERS.

**Only run trusted configuration**: gates execute its commands with inherited
environment, no shell interpretation and bounded time/output. Required command
failure or skip blocks readiness regardless of `requiredChecks.commands`.
Optional command failures are nonblocking unless a constitution rule rejects the
measured count. No configured commands is skipped, not passed.
TDD commands require either command-specific `tddArgs` plus a `tddReport`, or a
built-in `vitest`, `jest`, `pytest`, `go-test`, `cargo`, or `junit` adapter.
Explicit custom configuration takes precedence. Adapters derive targeted
arguments and normalize native JSON/JSONL/XML into `musubix-json`. Vitest/Jest
reports may contain unrelated skipped tests; targeted TDD selects only the
requested ID. pytest requires the JSON-report plugin and underscore-form test
names such as `test_TEST_APP_001`. Go uses a `TEST-*` subtest name, Cargo uses a
Rust identifier such as `test_app_001`. JUnit methods must carry an exact
`@Tag("TEST-APP-001")`; keep the underscore-form ID in the method name so it is
recoverable from the launcher's XML report. Before each phase, musubix3 deletes
the previous report, creates any required report parent directory, and requires a fresh
`musubix-json` document containing exactly the selected test. Its status must be
`failed` during Red and `passed` during Green/Refactor; `skipped`, `error`,
missing and malformed reports fail. A non-test project input must change before
Green. Identical phase output reused by different tests is rejected.
Every phase is also appended to a SHA-256-linked immutable record chain. TDD and
change checkpoints additionally share a persisted monotonic order ledger, which
is authoritative for Red/Green boundaries; wall-clock timestamps are
informational. Legacy chronology without order evidence fails with an explicit
migration diagnostic. Missing, reordered, altered or orphaned records invalidate
the evidence.

CI executes isolated native contracts for all six adapters: Vitest, Jest,
pytest with `pytest-json-report`, Go test, Cargo test, and the pinned JUnit
Platform Console. Each fixture contains an unrelated failing test, proving that
the generated selector executes only the requested identity and that the real
native report normalizes correctly. Jest is development-only; the Python,
Go/Rust, and Java/JUnit tooling is provisioned only in CI and is not shipped as
a package runtime dependency.

Change checkpoints fingerprint only implementation files linked to each changed
requirement, plus their Code Graph dependencies. An unrelated source change
cannot satisfy the implementation phase. The automatic `change-completeness`
gate checks each CHANGE-ID for classified functional/non-functional requirements,
measurable Acceptance criteria, concrete design responsibilities/interfaces/
constraints, an existing ADR, linked code, authoritative annotated tests,
bounded TDD and trace edges. Each CHANGE document must contain a `Requirements:`
line enumerating exactly the chronology's normative requirement IDs.

Structured test results may add
`"operations":{"visitedNodes":42}`. A declared deterministic performance budget
automatically requires the `performance` gate; elapsed time alone cannot satisfy it.
For every observation, `performance.json` records a gate-generated run identity
and SHA-256-linked provenance covering the configured command name, executable
and rendered arguments, report path/source, fresh report bytes, test ID/status,
counter/value, and process status/exit code. Validation re-reads persisted
file, directory, and captured stdout reports and rejects missing or altered
reports, record mutation, configuration drift, duplicate counter sources,
non-passing tests, and results not produced by a successful configured command.
The signed performance head hashes stable semantic fields while the JSON retains
run/execution IDs, timestamps, report hashes, and chained provenance, so an
equivalent gate can be rerun after signing without invalidating the signature.
This provenance also gates CHANGE completeness and status freshness.
Native runner reports do not expose application operation counters, so projects
with such budgets must also configure an instrumented `musubix-json` report.
Native adapters and custom reports can coexist; only the instrumented report that
actually emits the named operation counter can prove the performance budget.

Mutation evidence uses a configured command with
`"mutationReport":{"format":"musubix-mutation-json","path":"..."}`. Each fresh
schema-v1 mutant record carries a deterministic `MUT-<hash>` identity (derivable
with the exported `mutationIdentity` helper), must-functional requirement ID,
authoritative test ID, source/test paths and SHA-256 fingerprints, operator,
one-based line/column, and `killed|survived|skipped|error` status. The gate adds
command, rendered-argument, report, process, and exit provenance to
`mutation.json`. Supplied evidence must cover every must functional requirement
with a current linked killed mutant. Duplicate/conflicting, non-killed, stale,
unlinked, altered-report, and configuration-drift evidence is rejected.
`mutation.mode` defaults to `compatible` (absence is allowed); set it to
`strict` and protect it plus the mutation command in the policy baseline for
release. No mutation engine dependency is bundled. Mutation and model-
correspondence semantic heads are included in attestations and their underlying
provenance is revalidated.

Quality evidence records required flags, actual exits/output, metrics,
timestamps and input fingerprints. Changed-run paths, HEAD and impacts survive a
later full gate. `workflow-record` stores a self-reported Skill/phase/status and
optional command SHA-256 without storing command text. `workflow-verify` imports
only Skill invocation metadata from a Copilot JSONL log and binds every completed
declaration one-to-one, in order, to a distinct completed successful tool call.
Each Skill invocation must therefore record exactly one final workflow outcome;
multi-phase chronology belongs in `change-record`, not duplicate workflow events.
Incomplete, failed, reused, out-of-order and stale bindings fail.
Set `"workflow":{"mode":"strict"}` or pass `--strict` to additionally require
valid JSON on every nonempty line, valid event timestamps, consistent one-to-one
tool start/completion lifecycles, and exactly one final `result` with `exitCode: 0`.
The terminal `sessionId`, exit code, event count, terminal timestamp, raw source
hash and canonical transcript hash are persisted. `workflow.expectedSessionId`
or `--session-id` rejects substitution with a different caller-declared session.
Strict verification also bounds terminal transcript age and future clock skew
with `workflow.maxAgeSeconds` and `workflow.maxFutureSkewSeconds`.
Unrelated concurrent events may be emitted out of timestamp order, so strict mode
checks causal tool/result ordering rather than imposing a global timestamp sort.
If project inputs change while a gate is running, `input-stability` reports each
added, modified, or deleted path with before/after SHA-256 values. Standard
Cargo/Maven `target/` output is excluded, but source-like generated inputs remain
fail-closed. Built-in adapters own their targeting and report arguments. A
legacy leading Cargo/Go `test` subcommand is merged safely; conflicting report
flags such as `--json-report` are rejected.
Changes during a gate fail input stability; later source/config changes make
`status` stale. Attestations older than `maxAgeSeconds`, or issued farther in the
future than `maxFutureSkewSeconds`, fail. Local mode explicitly reports unsigned
evidence.

`ci-required` supports two deliberately distinct trust models:

- **Static trusted-key mode** (`githubOidc.mode: "off"`): `keyId` must select a
  configured Ed25519 public key. The signature covers repository, Git HEAD, CI
  provider/run ID, evidence heads, and the non-generated workspace snapshot.
- **GitHub OIDC strict mode**: configure `githubOidc.mode: "strict"` and a custom
  audience base. The verifier discovers GitHub's issuer metadata and JWKS,
  verifies the RS256 JWT, and checks issuer, bound audience, `exp`/`nbf`/`iat`,
  repository, commit `sha`, and `run_id`, plus optional `workflow` and `ref`.
  `keyBinding: "public-key"` authorizes an attestation-carried ephemeral
  Ed25519 public key by its SPKI SHA-256 in the custom audience.
  `keyBinding: "key-id"` instead adds OIDC authorization to a statically trusted
  key ID. If metadata/JWKS cannot be fetched, strict verification fails closed.

Evidence heads also bind stable non-attestation quality verdicts and formal
solver status, total requirements, modeled count/fraction, consistency, and
artifact identity. Excluding the attestation check from the quality head avoids
a circular signature dependency. A missing `ci-required` attestation is reported
as a failed/missing check, never as skipped local evidence.

Example strict configuration:

```json
{
  "attestation": {
    "mode": "ci-required",
    "repository": "owner/repository",
    "maxAgeSeconds": 600,
    "maxFutureSkewSeconds": 30,
    "trustedPublicKeys": [],
    "githubOidc": {
      "mode": "strict",
      "audience": "https://example.invalid/musubix3",
      "keyBinding": "public-key",
      "workflow": "release.yml",
      "ref": "refs/heads/main"
    }
  }
}
```

Generate an Ed25519 key outside musubix3, pass only its public PEM to
`attestation oidc-audience`, request the GitHub Actions OIDC token with that exact
audience, then pass the public PEM and JWT files to `attestation payload` and sign
the emitted payload externally. musubix3 never reads or stores a private key.
The short-lived JWT is included in the signed attestation and is intentionally
checked for current expiration, so verification must occur within its validity
window. This establishes that GitHub's OIDC identity authorized the signing key
and stated claims; it does not prove arbitrary runner behavior or the semantic
correctness of the workflow. The workflow evidence head separately binds
transcript/session fields into the Ed25519 signature.

## Formal methods, codegraph and retrieval limitations

- Deterministic formal checking works without external solvers. Controlled
  unconditional English/Japanese obligations retain the Boolean abstraction;
  strict `Formal:` JSON additionally models branch-scoped conditional truth,
  exact integer bounds with documented compatible units, intersected
  `afterMs`/`withinMs` response-delay intervals, and deterministic
  from-state/event targets. Arbitrary natural language, synonyms, scheduling,
  liveness, undocumented unit conversions, domain axioms and implementation
  behavior are not proven.
- `consistent` means the **modeled subset** is consistent; inspect `unsupported`.
  An empty subset reports `unknown` and exits nonzero. `valid` only indicates a
  nonempty modeled subset with no detected violation or requested execution error,
  **not** comprehensive proof. `none` skips solver
  execution; `auto` probes installed Z3 then Lean and tolerates missing tools.
  Explicit missing Z3/Lean, unknown, timeout or tool error returns nonzero.
- `formal generate` writes reproducible SMT-LIB2 and Lean inputs with SHA-256
  metadata without requiring either tool. `formal doctor` reports executable,
  version, timeout, missing and error states.
- Z3 receives actual QF_UFLIA SMT-LIB with named assertions and `check-sat`.
  Lean checks satisfiability or contradiction theorems over translated Boolean,
  integer, temporal, conditional-scenario and transition propositions. It is
  **not** a general SMT solver or proof of
  application correctness. `auto` also detects `lake env lean`. Use `--z3-command`,
  `--lean-command`, `MUSUBIX3_Z3`, or `MUSUBIX3_LEAN` for nonstandard paths.
  Generated inputs stay in the ignored cache.
- CI pins Lean through `lean-toolchain` and runs both native Z3 and Lean
  integrations, including consistent and inconsistent mixed models. Generated
  Lean satisfiability proofs provide explicit witnesses rather than searching
  Boolean assignments. Local installations may use another compatible version, but
  their exact version is retained in each solver report.
- The JS/TS compiler graph handles imports, re-exports, import-equals, literal
  `require`/dynamic imports, package manifest entrypoints, safe local URL/template
  cache-busting imports, and nearest `tsconfig.json` resolution. Calls are
  best-effort; symbol impact conservatively expands at **file** level. Nonliteral
  loading is a compatibility warning unless `codeGraph.mode` is `strict`, when
  it blocks graph gates; unresolved external packages remain warnings and
  unresolved local imports are errors. Bundler-specific resolution, reflection and other
  Rust, Python, Go, Java, C/C++, C#, PHP, R and Julia have conservative native
  adapters for local imports/modules/includes, declarations and direct calls.
  Other languages are reported as unsupported. Ignored
  build/cache/dependency directories and
  symlinks are not indexed; custom `.gitignore` rules are not a scan filter.
- Trace annotations support all languages listed above. Do not create JS/TS
  proxy files for another language.
- Knowledge ranking is **TF-IDF/cosine, not GraphRAG** or semantic reasoning.
  Japanese uses character bigrams. Git co-change and author-directory counts
  cover at most 100 commits/30 files per commit; they indicate correlation and
  contribution, not causality or expertise. No Git history is explicitly skipped.
  Indexing is local; nothing is sent to a service.
- Core CI covers Node 22 on Linux, Windows, and macOS, with additional Node 20
  and Node 24 Linux compatibility checks. Native adapters and formal solvers run
  once on Linux with pinned toolchains.
  No formatting/lint framework is bundled; strict TypeScript and tests are used.

## Development and release checks

```sh
npm install
npm run typecheck
npm run build
npm test
npm pack --dry-run
npm run pack:check
npm run pack:smoke
```

Workspaces: `packages/domain` (pure validators), `packages/analysis` (evidence,
compiler and filesystem services), `packages/cli` (thin command/installation layer).
One build emits `dist/packages/**`. Published contents explicitly include hidden
skills, native manifests, built CLI/modules and assets. CI checks Node 20/24;
tests cover unit behavior, CLI exits, installer preservation and packaging.
`pack:smoke` installs the real tarball into an isolated `.test-work/` consumer,
checks its executable, ESM exports and installer, then removes the fixture.
Attestation APIs are available from both `musubix3/analysis` and the focused
`musubix3/attestation` export.

Tags matching `v*` run `.github/workflows/release.yml`. The workflow requires
the tag to equal `v` plus the package/plugin versions, runs the full Linux
native/formal suite, creates the npm tarball, CycloneDX `npm sbom`, SHA256SUMS,
and a GitHub Release. A separate protected `npm-publish` environment gates
`npm publish --provenance --access public`; npm Trusted Publishing is preferred,
while an optional `NPM_TOKEN` environment secret remains supported. A pending or
failed npm publish does not prevent creation of the GitHub Release.
For manual dispatch, select the release tag as the workflow ref and provide the
same value as `release_tag`; the workflow rejects tags that do not point to the
OIDC-bound `GITHUB_SHA`.

The release attestation uses a real GitHub Actions OIDC token whose custom
audience binds an ephemeral Ed25519 public key. Its signature covers repository,
Git commit, run ID, workflow/ref identity, current workspace snapshot, and any
musubix evidence heads present in the release runner. It verifies those bindings
and GitHub's live issuer/JWKS before upload; it does not claim that the signature
alone proves test semantics. Tests and solver checks are enforced separately by
the prerequisite release-validation job. The private key exists only under the
ignored `.test-work` directory for signing and is deleted before verification;
only the signed attestation is uploaded.
See [CONTRIBUTING.md](CONTRIBUTING.md) and [CHANGELOG.md](CHANGELOG.md).
