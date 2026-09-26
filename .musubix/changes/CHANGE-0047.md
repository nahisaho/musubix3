---
schemaVersion: 1
id: CHANGE-0047
summary: Use Node.js 24 for primary GitHub Actions jobs
status: staged
---
# CHANGE-0047: github-actions-project-node24

Requirements: REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002 REQ-GITHUB-ACTIONS-PROJECT-NODE24-001 REQ-GITHUB-ACTIONS-PROJECT-NODE24-002 REQ-GITHUB-ACTIONS-PROJECT-NODE24-003 REQ-NPM-AUDIT-REMEDIATION-002

## Intent

Move the repository's primary CI, release, attestation, and npm publication
execution from Node.js 22 to Node.js 24 while retaining the Node.js 20
compatibility-floor job.

## Source

- User instruction: use Node.js 24 for GitHub Actions.

## Classification

- Observable CI and release behavior change.

## Impact

- Update the `core-portability` job label and setup-node input from Node.js 22
  to Node.js 24.
- Update all setup-node inputs in release, attestation, and npm publication
  jobs from Node.js 22 to Node.js 24.
- Preserve the `node-compatibility` matrix as exactly `[20, 24]` and preserve
  the existing Node.js 24 settings in `native-adapters`, `formal-solvers`, and
  `dependency-audit`.
- Amend the protected-workflow requirement and design only to delegate these
  exact runtime transitions while preserving every other protected value.
- Amend the npm-audit remediation requirement, design, checker, and mutation
  fixtures so the documented active CI lines are Node.js 20 and 24 and the
  checker still detects altered or duplicated setup-node steps.
- Update English and Japanese documentation to state Node.js 24 core
  portability and Node.js 20/24 compatibility without changing the Node.js 20
  package support floor.
- Preserve reviewed pre-change publishing workflow bytes, SHA-256 digests,
  commit and blob provenance, then prove the current sources differ only at
  the three release and one npm-publish Node.js version lines.
- Record ADR-0040 for offline prior/current workflow correspondence and staged
  operational evidence rather than depending on retained Git refs or
  manufacturing release executions.
- Amend ADR-0036's consequence statement so active CI samples Node.js 20 and
  24 while Vitest's reviewed upstream engine range still includes Node.js 22.
- Extend deterministic workflow, documentation, provenance, and operational
  evidence checks before implementation.

## Other impacted requirements

- `REQ-RELEASE-ASSET-PUBLISHING-004` remains unchanged. Its protected release
  hand-off is revalidated because the shared workflow checker and publishing
  baseline are updated, but the artifact set, digest binding, archive
  inspection, and publication behavior do not change.
- `REQ-NPM-AUDIT-REMEDIATION-003` remains unchanged. Its existing test and
  distribution behavior is revalidated while the CI runtime literal in its
  shared checker/test surfaces changes.
- `REQ-GITHUB-ACTIONS-NODE24-RUNTIME-001` remains unchanged. Its action-runtime
  lock and CHANGE-0021 operational evidence checks remain enforced.
- `REQ-GITHUB-ACTIONS-NODE24-RUNTIME-003` remains unchanged. Its floating
  hosted-runner policy remains in force while the documented project runtime
  changes from Node.js 22 to Node.js 24.

## Verification

- Record current requirements and design approvals before Red.
- Record a real failing Red for the deterministic workflow, documentation,
  provenance, npm-audit checker, and operational-evidence contracts before
  changing workflow or README behavior.
- Record Green after the exact Node.js 22-to-24 updates, then run typecheck,
  build, the complete test suite, package checks, strict trace, Code Graph, and
  the changed quality gate.
- Keep exact operational evidence anchors in this document. Before the first
  merged run they remain explicitly pending; before this change is marked
  complete, replace the post-merge pending values with the first CI run URL
  and all three `core-portability` conclusions.
- Record release and npm-publish results when those workflows next execute;
  do not trigger publication solely to manufacture deferred evidence.

## Operational evidence

- Post-merge CI run: pending until the first merged CI execution.
- Core ubuntu-latest conclusion: pending.
- Core windows-latest conclusion: pending.
- Core macos-latest conclusion: pending.
- Deferred release evidence: pending until the next natural release execution.
- Deferred npm-publish evidence: pending until the next natural publication.

## Baseline correspondence evidence

- `git rev-parse 46edcde9209cc2708c5d6669c98af9e55aa7c7cb:.github/workflows/release.yml`
  returned `a0013a4f5530c84f812242664523ea965dd67306`.
- `git show 46edcde9209cc2708c5d6669c98af9e55aa7c7cb:.github/workflows/release.yml | sha256sum`
  returned `30aaa213cf5ed8158e374f5e9b71ac8dd3a7eb1c0551d5e274b9e6f8b3183f6a`.
- `git rev-parse 46edcde9209cc2708c5d6669c98af9e55aa7c7cb:.github/workflows/npm-publish.yml`
  returned `ccb30e3b980a93fa9c323fb81944e5253257f2d7`.
- `git show 46edcde9209cc2708c5d6669c98af9e55aa7c7cb:.github/workflows/npm-publish.yml | sha256sum`
  returned `4ccb354eb54c11ac9e8bf9b7d7925aad95d78292f985cad5e57367108733e616`.
- At review time the commit was reachable from
  `origin/copilot/issue-43-directory-sync`; deterministic tests do not depend
  on that ref and recompute provenance from the retained prior source bytes.

## Residual risks

- GitHub-hosted runner image changes remain governed by the existing floating
  runner policy.
- Node.js 22 remains within the declared `engines.node >=20` package support
  range but no longer has a dedicated CI execution after this change; the
  compatibility boundary is sampled at Node.js 20 and 24 to cover the declared
  floor and current even-numbered runtime. Reintroduce a dedicated Node.js 22
  job if a Node.js 22-specific defect is reported.
- Post-merge CI evidence cannot exist before merge and therefore remains
  explicitly pending while this change is staged.
- Release and npm-publish operational evidence remains deferred until those
  workflows execute naturally.
