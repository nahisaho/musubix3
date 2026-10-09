---
schemaVersion: 1
id: CHANGE-0052
summary: Review a narrowly pinned js-yaml override to eliminate vulnerable sprintf-js tooling
status: staged
---
# CHANGE-0052: audit-override-contract

Requirements: REQ-AUDIT-OVERRIDE-CONTRACT-001 REQ-AUDIT-OVERRIDE-CONTRACT-002 REQ-AUDIT-OVERRIDE-CONTRACT-003 REQ-AUDIT-OVERRIDE-CONTRACT-004

## Intent and classification

Dependency-security / behavior change: replace the blanket override prohibition
in the audit-remediation checker with an exact reviewed override contract.
The approved scope will eliminate the development-only `sprintf-js` chain,
refresh real zero-finding audit evidence, and preserve production behavior.
This is not a version-bump change, release publication, or issue closure.

All four listed requirements are new obligations. Existing
REQ-NPM-AUDIT-REMEDIATION-001..004 remain unchanged; their reviewed Vitest
surface and living audit-evidence obligations are related impacts, not new
requirements in this change.

## Impact inspection

- `package.json` and npm-generated `package-lock.json`: review the single
  `js-yaml` override and non-breaking audit fixes; keep version `0.1.20`.
- `scripts/check-npm-audit-remediation.mjs`: the complete checker and
  `checkLock()` were inspected. `Object.hasOwn(packageJson, 'overrides')`
  currently rejects any override. Existing literal surface comparisons
  remain required; unreviewed override contents must fail closed.
- `tests/npm-audit-remediation.test.ts`: preserve all existing negative
  fixtures and add genuine requirement-linked Red/Green coverage.
- `.musubix/changes/CHANGE-0022.md`: update its one living audit
  timestamp/digest/summary, preserving the original advisory and historical
  verification account; link the new remediation history to CHANGE-0052.
  REQ-NPM-AUDIT-REMEDIATION-002 and ADR-0036 explicitly bind this evidence
  to the current lockfile, so a reference alone cannot replace those fields.
- `.musubix/features/npm-audit-remediation/design.md`: at the design phase,
  reconcile its blanket no-overrides wording with this narrow exception.
  ADR-0036's rejection of independently overriding version-coupled
  `@vitest/mocker` remains applicable.
- New requirements and, after approval, design/ADR artifacts will use
  `.musubix/features/audit-override-contract/`.
- The constitution was inspected: trace errors, failed commands, and skipped
  required commands must each be zero for readiness.

Inspection commands completed before implementation:

- `git fetch origin`; both `git log origin/main..HEAD` and
  `git log HEAD..origin/main` are empty at the initial inspection.
- `node dist/packages/cli/src/main.js trace impact REQ-NPM-AUDIT-REMEDIATION-003 --json`
  and `trace impact scripts/check-npm-audit-remediation.mjs --json`.
  Relevant direct trace impacts include the three audit designs, ADR-0036,
  all four existing audit requirements/tests, and portability tests.
  Transitive trace connectivity is conservative, not proof of runtime exposure.
- `node dist/packages/cli/src/main.js graph index --json` and
  `graph impact scripts/check-npm-audit-remediation.mjs --json`.
  The checker has no compiler-indexed importing consumer; shell-spawned tests
  are inspected separately because the graph does not prove their reachability.
- `graph impact packages/analysis/src/adapters.ts --json` confirms this adapter
  utility participates in CLI/gate/TDD report handling. Its Jest branches
  construct arguments and parse external reports; they do not import Jest.

## Confirmed investigation facts

- Fresh root `npm audit --json` reports info 0, low 0, moderate 19, high 2,
  critical 0, total 21. These are baseline findings, not remediation evidence.
  The 19 moderate entries propagate one `sprintf-js` advisory through its
  ancestors, rather than representing 19 independent vulnerabilities.
- The moderate source advisory is GHSA-hp3w-g68c-fv3c, concerning `sprintf-js`
  unbounded precision specifiers (CPU denial of service); its affected range
  is `<=1.1.3`. `npm view sprintf-js versions --json` lists no release beyond
  `1.1.3`, so no published fixed `sprintf-js` release is available.
- `npm ls js-yaml sprintf-js` confirms
  `jest@30.5.1 > @jest/core@30.5.1 > @jest/transform@30.5.1 >
  babel-plugin-istanbul@8.0.0 > @istanbuljs/load-nyc-config@1.1.0 >
  js-yaml@3.15.2 > argparse@1.0.10 > sprintf-js@1.0.3`.
- `jest` is a root devDependency. Source inspection finds no production
  imports of Jest, `js-yaml`, or `sprintf-js`; `adapters.ts` handles Jest
  invocation/report protocols, while `tests/adapter-integration.test.ts`
  conditionally executes the installed Jest binary for native-adapter
  integration only when `MUSUBIX_RUN_NATIVE_ADAPTERS=1`; default test commands
  skip the native cases.
  The manifest's shipped file list excludes `node_modules` and tests.
  Actual archive inspection and adapter compatibility validation remain pending.
- The inspected installed `@istanbuljs/load-nyc-config/index.js` uses
  js-yaml's `.load()` on UTF-8 config text; its exact call site is recorded
  in the override assessment below.
  Registry metadata for `js-yaml@5.4.3` declares only
  `argparse: "^2.0.1"`; `argparse@2.0.1` has no dependencies.
  API compatibility will be exercised after approval, not assumed proven.
  The current lockfile has one js-yaml dependent,
  `@istanbuljs/load-nyc-config`, which declares `js-yaml: "^3.13.1"`.
  This is an intentional override outside its declared semver range; enumerate
  consumers again after installation to confirm the compatibility-test scope.
  Any additional consumer blocks readiness until equivalent YAML-call-site
  compatibility evidence is recorded here.
- Fresh high findings affect `brace-expansion` and `source-map-js`;
  the former includes GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, and
  GHSA-6j4f-fj2g-mc7p, and the latter is GHSA-68fv-2mgg-jv7q.
  npm reports non-breaking fixes available. Run `npm audit fix` without
  `--force` during the approved implementation phase before the override
  install, then assess any remaining findings explicitly.
  Reject and escalate any fix that changes direct manifest ranges, the
  reviewed Vitest constraint, or version; only compatible transitive
  lock-record changes are permitted.

## Decisions and outstanding verification

- Keep current lockfile-bound audit evidence in CHANGE-0022 and add the
  new advisory assessment/remediation history in CHANGE-0052.
- Before installation the root lockfile entry has no `overrides` field.
  After the approved `npm install`, observe its representation once and record
  the npm version under this document's `Verification evidence` heading. Pin only that
  observed representation: if npm omits it,
  require absence and reject any inserted field (including the reviewed
  object); if npm emits it, require the exact reviewed object and reject
  removal or alteration. Never accept both representations interchangeably.
  Preserve all existing root metadata comparisons and test deviations.
  An npm-version change requires re-observation and an explicit evidence
  update; a changed pinned representation requires renewed design review and
  human approval, never silent reinterpretation.
- Requirements were explicitly approved by `nahisaho` for manifest
  `9ff89491f0f1ea36a7e3fc29a18f7386cac6ca74d83691f56da7f45741760472`
  and recorded with the supplied CLI command.
  `approval validate --json` confirms requirements `approved` with no stage
  diagnostics. The supplied design approval command was also recorded for
  `fddba96c50446c790ccf6a735785c380e579589d1b977cc1b5db4e5cded85549`.
  Requirements/design validation and current approvals pass.
  Full-set Red/Implementation/Green is recorded and full tests pass.
  The human-approved restoration resolves the legacy TDD fingerprint.
  Quality is recorded; human-approved declaration-scoped waivers resolve the
  technical reconciliation check. Release approval and the documentary review
  corrections described below remain outstanding.

## Requirements self-check matrix

| Requirement | Classification | Measurable acceptance |
| --- | --- | --- |
| REQ-AUDIT-OVERRIDE-CONTRACT-001 | New dependency-security obligation | Exact override, offline checked stable 5.x/2.x dev-only graph, no sprintf-js; negative drift fixtures |
| REQ-AUDIT-OVERRIDE-CONTRACT-002 | New checker behavior | Accept reviewed value; reject missing, different, malformed, additional overrides; preserve existing pins |
| REQ-AUDIT-OVERRIDE-CONTRACT-003 | New security-evidence obligation | Real all-zero full audit, UTC time, actual lockfile bytes SHA-256 |
| REQ-AUDIT-OVERRIDE-CONTRACT-004 | New assessment/compatibility obligation | Advisory paths and preconditions documented; no runtime import/archive payload; YAML/Jest validation |

## Requirements validation and review evidence

- Requirements and constitution validation pass without diagnostics.
- Native rubber-duck round 1 found three blockers: missing offline graph
  enforcement, missing native-Jest opt-in, and ambiguous root-lock metadata
  representation. All were corrected together.
- Diff-only native rubber-duck round 2 confirmed those blockers closed and
  identified three remaining acceptance refinements plus a diagnostic-contract
  suggestion. The final correction batch binds coverage to every consumer,
  removes the undefined offline vulnerability predicate, names this document
  as the npm-observation evidence location, and specifies
  `LOCK_OVERRIDE_GRAPH` with a nonzero exit for replacement-graph drift.
  Diff-only native rubber-duck round 3 completed with no blocking issues.
  Its remaining suggestions were consumed without a fourth review: designate
  the verification-evidence destination, record the completed outcome, and
  assess the earlier phase fingerprints.
- Impact and requirements checkpoints are historical, once-per-phase
  chronology records; later review corrections are not silently substituted
  into those snapshots. The configured CLI rejects re-recording an existing
  phase (`CHANGE-0052:<phase> is already recorded`), and its checks compare
  requirement/design phase boundaries rather than requiring pre-review
  snapshots to equal the final approval bytes. Final current requirements and
  constitution validation are repeated before preparing approval; that
  independently reproduced approval manifest binds the reviewed current bytes.
  The later design checkpoint must be recorded only after its final review.
- The native round-2 JSONL includes `tool.execution_start` for
  `task` with `agent_type: "rubber-duck"` and an agent disclosure, retained
  locally in `.musubix/cache/change-0052-requirements-review-round2.jsonl`.
- Sanitizing the actual still-open parent Copilot transcript was attempted;
  it failed because no terminal result or routine shutdown lifecycle exists
  yet. No transcript was altered or truncated. Compatible `workflow-verify`
  of the actual live transcript succeeded and retained its invocation list.
  Strict sanitization/reconciliation remains deferred until a genuine terminal
  lifecycle is available; this is not claimed as passing final quality.

## Verification evidence

Override audit captured at: 2026-10-09T10:44:43Z.
Override lockfile SHA-256: `86bde77ee355b5e91db5ece80a43a1b76e4b2d2d4b76d704a624706578d3bf0f`.
Audit report SHA-256: `7b1b59d3542ad0bda8459610803e0a0ef29e700cbf81d2bb43c1e39cc0419651`.
Remediation history: CHANGE-0022 -> CHANGE-0052.
Js-yaml consumer inventory: [{"path":"node_modules/@istanbuljs/load-nyc-config","kind":"dependencies","range":"^3.13.1"}]

- Observations beginning with the reviewed install use that same lockfile digest;
  the audit command's before/after lockfile digests were equal.
- Pre-install baseline observations (not bound to the final lockfile digest):
  fresh pre-fix audit: exit 1; moderate 19, high 2, total 21.
  `npm audit fix` without `--force`: exit 1, with the unresolved sprintf-js
  chain still producing moderate 19; high findings fell to 0.
  It added 1, removed 3, and changed 43 packages within existing ranges.
  No manifest range/version change occurred.
- `npm install` with the exact reviewed override completed successfully.
  At `2026-10-07T09:24:25.809Z`, npm `11.19.0` generated root metadata
  with `Object.hasOwn(packages[""], "overrides") === false`, matching the
  approved planned pin. The checker rejects even an exact-value inserted field.
- `npm ls js-yaml argparse sprintf-js`: exit 0. The installed tree resolves
  Jest/@jest/core/@jest/transform 30.5.2, babel-plugin-istanbul 8.0.2,
  @istanbuljs/load-nyc-config 1.1.0, js-yaml 5.4.3 and argparse 2.0.1.
  There is no sprintf-js package in the tree or root/nested lock records.
- Real root `npm audit --json`: exit 0; info 0, low 0, moderate 0,
  high 0, critical 0, total 0. The unfiltered output is
  `.musubix/evidence/npm-audit/CHANGE-0052.json`; CHANGE-0022's one living
  audit summary binds the same bytes/capture.
- At `2026-10-07T09:28:02.597Z`, the installed consumer actually loaded
  `.nycrc.yaml` with boolean true, numeric 85, and `.ts`/`.js` extensions.
  camelCase/array normalization was checked. Raw observation is
  `.musubix/evidence/npm-audit/CHANGE-0052-yaml.json`.
- The exact opt-in native Jest command passed the named adapter case:
  1 passed; zero Jest skips. Five non-selected native cases were skipped,
  not counted as passing. The console output and additional JSON-report run
  are retained as `CHANGE-0052-native-jest.log` and
  `CHANGE-0052-native-jest.json` under `.musubix/evidence/npm-audit/`.
  This proves runner/adapter integration, not the coverage-disabled YAML path.
- `npm run typecheck`, `npm run build`, `npm run pack:check`, and
  `npm run pack:smoke` passed. Actual archive inspection found 137 files,
  9 skills, and no node_modules/tests/Jest/js-yaml/argparse/sprintf-js payload.
  Raw package metadata/archive file list is
  `.musubix/evidence/npm-audit/CHANGE-0052-package.json`.
- At `2026-10-07T09:29:46.681Z`, 117 production source/built JS files
  were inspected with zero imports of Jest/js-yaml/sprintf-js. The record is
  `.musubix/evidence/npm-audit/CHANGE-0052-source.json`.
- A later lockfile-byte change invalidates these observations and requires
  re-install, tree/root re-observation, re-audit, and compatibility re-execution.

## Override advisory assessment

Advisory: GHSA-hp3w-g68c-fv3c.
Dependency path: `jest@30.5.1 > @jest/core@30.5.1 > @jest/transform@30.5.1 > babel-plugin-istanbul@8.0.0 > @istanbuljs/load-nyc-config@1.1.0 > js-yaml@3.15.2 > argparse@1.0.10 > sprintf-js@1.0.3`.
Impact: CPU denial of service through attacker-controlled unbounded precision specifiers.
Fixed sprintf-js release: none published; affected <=1.1.3.
Exposure: development-only Jest tooling; production source does not import Jest/js-yaml/sprintf-js and the package archive contains none of this dependency chain.
Decision: remove sprintf-js through the reviewed js-yaml override, not accept it as harmless.
Consumer: @istanbuljs/load-nyc-config declares js-yaml "^3.13.1"; the override deliberately exceeds that range.
Call site: `require('js-yaml').load(await readFile(configFile, 'utf8'))`.
Limits: no universal unreachability claim; compatibility is not inferred solely from an unchanged method name.
Residual risk: future advisories or future attacker-controlled developer input remain possible; recurring weekly/manual audit monitoring and release-time review remain required.

The path above is the observed vulnerable baseline, not a claim that its
versions remain installed. The post-remediation tree and consumer inventory
are recorded in Verification evidence. Current local Jest adapter tests do
not supply hostile formatter input; a future developer/third-party workflow
could, so dev-only exposure was not accepted instead of dependency removal.

## Implementation and integration checkpoint

- The four immutable new tests each have a real failing Red and passing Green.
  Full-set Red order: 1813; implementation order: 1814; individual Green
  orders: 1815–1818; full-set Green order: 1819.
  All four authoritative implementation fingerprints are
  `19b03bb6b964883046c6ff7d1ba0db5f8ec41a4cf3a161c06ebd1de873e54216`.
- Focused new/existing audit suite: 9 passed, 0 failed.
  Complete `npm test`: exit 0, 619 passed, 0 failed, 8 skipped/pending
  (627 total). The actual JSON/console reports are retained locally at
  `.musubix/cache/change-0052-full-test.{json,log}`.
  The separately selected opt-in native Jest case passed as recorded above.
- `tdd validate` reports `TDD_TEST_STALE` for the historical
  `TEST-NPM-AUDIT-REMEDIATION-001`. Follow-up inspection corrects the initial
  shared-module diagnosis: the current algorithm fingerprints the individual
  nested test declaration, and its directory-creation statement was changed
  from `mkdtempSync(join(tmpdir(), ...))` to `fixtureDirectory(...)`.
  Its existing assertions still pass, but that is not fresh TDD evidence.
- A legitimate `tdd refactor` refresh was attempted without changing the test.
  The CLI rejected it with
  `The test changed after Red; run the Red phase again.`
  No successful refactor or additional Red was recorded. Historical evidence
  was not hand-edited, archived, waived, or falsely marked current.
- This unplanned evidence-policy blocker requires human direction before
  broadening the approved four-requirement batch with a legacy regression
  cycle or recording an explicitly reviewed archival action. No artificial
  failure, policy relaxation, or self-approval is used to obtain readiness.
  Quality recording, release-candidate review, final gates and
  `approval prepare release` have not been reached.
- Human follow-up requested a corrective legacy cycle and CHANGE-0052 batch.
  A side-effect-free `change-record CHANGE-0052 red --requirement
  REQ-NPM-AUDIT-REMEDIATION-001 --dry-run --json` rejected that foreign
  requirement with the full CLI error:
  `A requirement batch must use a non-empty subset of the change requirement IDs.`
  No passing test was run as a false Red, and no checkpoint was appended.
- Computing the authoritative test-declaration fingerprint from HEAD and a
  proposed restoration of that one directory-creation statement produces
  `40c91e0b0d244828c07a630cc83314825fc3713ffb05abb9d8b763e3e4adf79d`,
  exactly the stored legacy passing fingerprint. The current changed
  declaration instead produces
  `3c73c3ef32014180093fb884bb064c0e3a9544b9eebcd0630a6d335d924c0b4b`.
  The four new test fingerprints are identical before/after this proposed
  restoration. The comparison is retained locally in
  `.musubix/cache/change-0052-legacy-fingerprint-diagnosis.json`.
  Restoring the old statement and its `node:os` import, while retaining the
  approved project-local TMPDIR/TMP/TEMP environment, would avoid both
  artificial Red and foreign requirement enumeration. This alternative
  was approved by the human follow-up and applied. `tdd validate` now returns
  `valid:true, diagnostics:[]` without migration, artificial Red, or a foreign
  requirement batch. TMPDIR/TMP/TEMP remain project-local.

## Quality checkpoint

- Full-set quality is recorded at order 1820, after the actual configured
  checks ran. Strict trace has design/implementation/test link coverage 1.0
  for all 213 mandatory requirements. Graph gate passes with 10 documented
  nonliteral-loading warnings; no architecture cycles.
- All 46 configured commands executed successfully, including typecheck,
  build, complete npm test, pack check/smoke and the audit-remediation suite.
  The actual full command output reports 56 test files passed, 1 skipped;
  619 tests passed, 8 skipped, 0 failed, 627 total.
  Latest candidate command exits/stdout are retained in
  `.musubix/evidence/quality.json`; its overall failure is the disclosed
  pending release approval, not a command failure. The phase chronology at
  order 1820 is retained in `.musubix/evidence/changes.json`, with the original
  trace/graph check outputs in `.musubix/cache/change-0052-quality-trace-check.json`
  and `.musubix/cache/change-0052-quality-graph-gate.json`.
- Fresh audit at the capture above exits 0 with all six severity values 0,
  unchanged before/after lock digest, and the same raw report digest.
- Optional formal inspection reports all four new requirements unsupported,
  consistency unknown, and no solver run; no formal behavior proof is claimed.
  The configured graph/formal compatible policy and baseline were not weakened.
- The first changed gate's technical commands/TDD/coverage passed. Its missing
  quality checkpoint was then recorded. Release approval is intentionally stale
  until the forthcoming human-reviewed release manifest.
- Actual parent transcript sanitization rejects the open transcript with:
  `Strict workflow verification requires exactly one terminal result format or a routine shutdown lifecycle.`
  No transcript was truncated, edited, or given an invented terminal event.
  The prescribed compatible verification consumes the real parent transcript,
  but reconciliation still reports 94 `WORKFLOW_SKILL_NOT_INVOKED`,
  97 `WORKFLOW_BINDING_MISSING`, and 3 `WORKFLOW_INVOCATION_ORDER` errors.
  These are declaration-scoped diagnostics; 95 exact diagnostic scopes have
  older human waiver records, while the remaining 99 do not.
  They include the earlier requirements/design invocation ordering, not
  dependency, test, audit, or root metadata failures.
- Bulk waiver recording required an explicitly confirmed approver. The human
  independently reviewed all 194 diagnostics and supplied the exact
  `workflow waiver record-all --approver nahisaho` command/reason/confirmation.
  That exact command recorded 97 declaration-scope waivers and resolved the
  194 related diagnostics. `WORKFLOW_INVOCATION_UNVERIFIED` was absent and
  was not waived. No dependency, behavior, TDD, or approval check was waived.
- The second changed gate confirms requirements/design/constitution/trace/
  graph/TDD/change-history and all 46 commands pass. The only failing checks
  are the 194 reconciliation diagnostics above and the intentionally stale
  release approval. Its full npm test again reports 619 passed, 8 skipped,
  0 failed (627 total). `status.gate.ready` remains false. No full gate or
  release manifest preparation was used to bypass these failures.

## Release-candidate evidence summary

The changed gate after the authorized waiver operation has only the
expected stale release-approval failure. All other required checks pass;
requirements/design approvals remain current. Final readiness remains false
until the human approves the prepared release manifest.

| Requirement | Authoritative implementation/test | Additional real evidence |
| --- | --- | --- |
| REQ-AUDIT-OVERRIDE-CONTRACT-001 | CODE-AUDIT-OVERRIDE-CONTRACT-001 / TEST-AUDIT-OVERRIDE-CONTRACT-001 | current installed tree; no root/nested sprintf-js |
| REQ-AUDIT-OVERRIDE-CONTRACT-002 | CODE-AUDIT-OVERRIDE-CONTRACT-002 / TEST-AUDIT-OVERRIDE-CONTRACT-002 | npm 11.19.0; observed root overrides absent |
| REQ-AUDIT-OVERRIDE-CONTRACT-003 | CODE-AUDIT-OVERRIDE-CONTRACT-003 / TEST-AUDIT-OVERRIDE-CONTRACT-003 | real full audit exit 0; current lock/raw report digests; CHANGE-0022 living evidence |
| REQ-AUDIT-OVERRIDE-CONTRACT-004 | CODE-AUDIT-OVERRIDE-CONTRACT-004 / TEST-AUDIT-OVERRIDE-CONTRACT-004 | direct YAML consumer; selected native Jest; archive/source inspection; all 46 quality commands |

The actual inspected final documentation-bearing archive contains 137 files;
SHA-256: `600b407dc964685e291b03a24cdab2e5aed97be0677de38912493f2cd98df9a3`.
Its retained report is `CHANGE-0052-package.json`; the generated archive was
removed after inspection. Version remains 0.1.20; no publication, commit,
push, PR, or merge has occurred.

Native bounded release/quality/CHANGE reviews and their corrections are
described below. The final full gate confirms the resulting candidate before
`approval prepare release`. No release approval will be inferred from
approval of the workflow waivers.

## Release review corrections

Native rubber-duck round 1 found three non-blocking issues and no blocking
issues. All three were corrected in one batch: explicit invalid/non-string
inventory kind/range fixtures, precise pre-install versus final-lock evidence
binding, and separation of the historical phase checkpoint from the latest
candidate output.

The fixture correction supplements coverage of unchanged REQ-004 behavior:
the existing backend already rejected malformed entries. To refresh the
immutable TEST-004 declaration honestly, its original pre-change absence of
assessment integration was replayed by temporarily omitting only that call.
The same final test, with all ten new kind/range cases, recorded a real
failing test execution at Red order 1821. Its summary does not retain the
individual failing assertion, so no exact failure-stack claim is made.
No assertion, test title, YAML API, or runner result was altered between
that recorded Red and Green.
The reviewed call was then restored after Red/checkpoint; the backend's final
byte SHA-256 remains the original `19b03bb6b964883046c6ff7d1ba0db5f8ec41a4cf3a161c06ebd1de873e54216`.
Corrective REQ-004 checkpoints are Red 1822, Implementation 1823, Green 1825;
the real passing test execution is Green 1824. `tdd validate` passes.
Full-set quality refresh order 1826 retains original order 1820 in
`qualityHistory`; approved requirements/design and the other test declarations
are unchanged. These fresh executions supplement rather than backdate the
original full-set batch.

This is a new corrective subset, not a rewrite of the immutable original
full-set batch. The original task requires fixing every review finding, and
the prescribed sdd-change post-Quality protocol requires a fresh corrective
subset and full quality refresh; the already-approved DES-004 requires these
fixtures. No requirement/design or acceptance rule was changed. No separate
human approval of TEST-004 reopening was requested or inferred.

The post-correction quality refresh and real compatible verification were
followed by the human's second exact waiver command at
2026-10-07T10:53:17.924Z (latest waiver record). It again recorded the same
97 declaration scopes covering 194 diagnostics. The resulting reviewed gate
is `.musubix/cache/change-0052-gate-reviewed.json`, generated at
2026-10-07T11:03:52.845Z, after the corrective fixtures and quality order 1826.
Its actual complete `command:test` record is retained separately in
`.musubix/evidence/npm-audit/CHANGE-0052-full-tests.json`, including the
source gate SHA-256, test-source SHA-256, exit 0, and original stdout:
619 passed, 8 skipped (627 total). This is post-correction evidence, not a
count inferred from the historical order-1820 checkpoint.

The fixture-only `.musubix/evidence/npm-audit/CHANGE-0052-inventory-probe.json`
also retains actual independent checker executions against cloned inputs:
baseline valid/exit 0, then ten separate mutations changing only kind or range.
Each exits 1 with exactly one AUDIT_OVERRIDE_ASSESSMENT diagnostic at the
mutated CHANGE path. The probe is explicitly isolated fixture evidence, not
an npm audit or a replacement TDD result, and its directory was removed.

Diff-only round 2 produced no blocking findings. The host invoked rubber-duck
twice for that round: the first returned findings after reading additional
interpretation context, and the second repeated the review within the exact
authorized input list. Together with round 1, three substantive native review
calls have occurred. No further automatic review is run beyond the cap.

One substantive scope-description issue needed human disposition: the earlier
human-provided waiver reason says "Sept 9-12" and "predating CHANGE-0052",
but 73 of the 97 scopes lie outside those dates. The three invocation-order
scopes are sdd-design at 2026-10-05T11:39:35.102Z and sdd-change at
2026-10-07T07:05:04.473Z / 2026-10-07T07:50:53.081Z; the latter two are this
change's earlier requirements/design declarations. This actual scope is
disclosed rather than relabeled as wholly pre-change. The agent has not
silently altered the supplied human reason or self-approved a replacement.
The other findings are addressed by the precise evidence/authorization
distinctions above. No post-correction clean native-review result is claimed;
three substantive calls have exhausted the conservative review cap.

### Human disposition and final candidate confirmation

The human explicitly authorized a replacement reason distinguishing all three
categories, and instructed continuation to the release approval checkpoint.
The exact supplied `workflow waiver record-all` command recorded 97 scopes at
2026-10-07T11:38:28.423Z. Its reason is retained verbatim in the append-only
waiver ledger, not substituted by an agent-authored reason:

- 94 historical `WORKFLOW_SKILL_NOT_INVOKED` declarations and their paired
  binding diagnostics. The authorized date window is September 9–October 7;
  the actual declaration dates for these 94 are September 9–October 4.
- One prior-session `sdd-design` invocation-order declaration on October 5.
- Two current-change `sdd-change` invocation-order declarations at the
  requirements/design checkpoints on October 7. The actual parent invocation
  indices 36/38 precede nested indices 37/39, but the nested completion
  declarations were recorded first. The global index constraint therefore
  rejects the later parent declarations despite completed native calls.

The separately recorded human requirements/design approvals remain current.
The waiver does not establish binding completeness, change declarations or
approval records, or alter REQ-to-CODE-to-TEST links. It downgrades the 194
diagnostics to accepted warnings; it does not erase them. The changed gate
retained in `.musubix/cache/change-0052-gate-authorized.json` confirms workflow
PASS, zero workflow errors, all four diagnostics associated with the two
current declarations at warning severity, and no invocation-unverified
diagnostic. All other non-release checks pass, including all 46 commands;
the only failure is the intentionally pending release approval.

The final live audit is retained locally as
`.musubix/cache/change-0052-final-audit.json`: exit 0 and all six vulnerability
counts zero. Its raw SHA-256 is
`7b1b59d3542ad0bda8459610803e0a0ef29e700cbf81d2bb43c1e39cc0419651`,
identical to the retained audit observation above. Before/after lock SHA-256
remains `ee6bbf3ea0bd21f66baa5eeb61f5d95100127506c16d475304ac9a1699150014`.
Origin was fetched before final confirmation; HEAD and origin/main have zero
divergence. No fourth automatic native review is performed. The last native
reviews reported zero blockers; final corrections and this explicit human
disposition are disclosed for independent release-manifest review rather than
misrepresented as a new zero-findings native review.

After recording this continuation's single completed `sdd-change` outcome at
2026-10-07T11:51:44.126Z, actual live compatible verification was refreshed at
2026-10-07T11:51:45.228Z. The new declaration introduces no diagnostic. The
same explicitly approved command then refreshed the same 97 waiver scopes
against that snapshot at 2026-10-07T11:52:18.404Z; no new scope or reason was
introduced. Final full-gate/status outputs are retained locally as
`.musubix/cache/change-0052-gate-final.json` and
`.musubix/cache/change-0052-status-final.json`. They must be inspected before
preparing the human release approval; a candidate lacking release approval
is not final readiness.

## 設計フェーズの方針

- 承認済み要件本文を維持し、新しい `design.md` と ADR-0044 を作成する。
  既存 npm-audit-remediation 設計の blanket 禁止だけを狭い例外に整合化し、
  ADR-0036 の version-coupled @vitest/mocker override 却下は維持する。
- npm 11.19.0 / override 追加前 root metadata の不在は再確認済み。
  設計の予定 pin は root overrides 不在だが、追加後結果は未観測。
  install 後に一致すれば pin を実装し、違えば設計修正・再承認で停止する。
- 4 要件が同じ checker を変更するため、全 4 個別 Red を先に記録し、
  full-set `change-record red` → 全 implementation 編集と実証拠生成 →
  full-set `change-record implementation` → 全 4 個別 `tdd green` →
  full-set `change-record green` の順を守る。
  Green 後の後続 checker 編集による fingerprint drift を避ける。
- 新しい raw audit JSON は既存 `.musubix/evidence/` に保持する。
  registry 実行を unit tests に入れず、保存証拠の整合検査と実コマンド
  終了の観測を区別する。runtime dependency manager/evidence store は追加しない。
- `design validate`、構成図生成、generated trace を実施し、未実装の
  code/test coverage を成功とは主張しない。レビュー後にのみ design phase
  checkpoint を記録し、design approval hash を準備する。
- native Jest は runner/adapter 統合だけを確認する。coverage 無効の case が
  override 対象 js-yaml をロードするとは主張せず、YAML callsite の互換性は
  installed consumer の `loadNycConfig` 実行が所有する。これらと archive の
  実行証拠は install 後に取得し、実 audit と同じ current lockfile digest と
  取得順/保存場所を `Verification evidence` に記録する。

## 設計段階の検証実績

- 新旧 design の `design validate --json` は各 valid=true / diagnostics 0。
- `design c4` は宣言された 4 component と依存関係から構成図を生成した。
  保存先は `.musubix/cache/change-0052-design-c4.mmd`。
- `trace build` は初回の並行 writer 衝突を serialized 再実行で解消し、
  手編集や lock 削除なしで graph を再生成した。
- 非 strict `trace check --json` は valid=true、design coverage 1.0。
  未実装 4 要件の code/test 不足 8 件と aggregate coverage 警告 2 件、
  合計 10 warnings。implementation/tests coverage は各
  `0.9812206572769953` であり、strict/full quality 成功とは主張しない。
- native rubber-duck round 1 の 3 blocker と関連指摘を一括修正した。
  runner と YAML owner の区別、install 後 digest binding、全 doc acceptance
  ownership、識別可能な診断と fixture precedence、pack:smoke、
  将来の別 consumer の escalation を設計/ADR に明記した。
  修正後は diff-only review を行い、最大 3 rounds で停止する。
- native rubber-duck diff-only round 2 は round 1 の blocker 解消を確認した。
  残る tree/metadata digest binding、記録項目の網羅性、fixture path 宣言、
  lockfile-derived inventory 比較、TEST-004 Red の帰属を一括修正した。
  round 3 は最終の diff-only review とする。
- native review の実 JSONL は
  `.musubix/cache/change-0052-design-review-round1.jsonl` と
  `.musubix/cache/change-0052-design-review-round2.jsonl` に保持する。
  いずれも `task` の `agent_type: "rubber-duck"` invocation を含む。
- native diff-only round 3 FINAL は blocking 0 と報告した。
  残る non-blocking 2 項目は、その具体的修正案どおり inventory 行の
  exactly-one/順序/重複/negative fixtures と ADR の digest ごとの観測を
  一括補正した。第 4 review は行わない。この補正を含む最終設計の
  明示的人間承認を待つ。round 3 の実行 JSONL は
  `.musubix/cache/change-0052-design-review-round3.jsonl` に保持する。

## Downstream quality checklist

- Fresh requirements, design, and release approvals with independently
  reproduced hashes; ordered phase evidence for the full requirement set.
- Requirement-linked real Red/Implementation/Green batches, then full-set quality.
- `npm run typecheck`, `npm run build`, full `npm test`,
  `npm run pack:check`, `npm run pack:smoke`, and
  `MUSUBIX_RUN_NATIVE_ADAPTERS=1 npm run test:adapters -- -t "executes and normalizes a targeted Jest test"`;
  retain evidence that the named Jest case passed with zero Jest skips.
- Actual zero-finding `npm audit --json`, `npm ls js-yaml sprintf-js`,
  and current lockfile SHA-256 evidence.
- `trace build`, `trace check --strict`, `graph index`, `graph gate`,
  applicable formal abstraction checks without claiming behavior proof.
- `gate --changed --json`, `status --json`, and final full `gate --json`.
- CHANGELOG entry before release-candidate approval; bounded rubber-duck
  review of requirements, design/ADR, and release/quality/CHANGE artifacts.
- No release version change, publication, self-approval, or PR merge.
