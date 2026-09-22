---
schemaVersion: 1
id: CHANGE-0019
summary: Enforce final release approval at the tagged release boundary
status: completed
---
# CHANGE-0019: release-approval-ordering

Requirements: REQ-RELEASE-APPROVAL-ORDERING-001 REQ-RELEASE-APPROVAL-ORDERING-002 REQ-RELEASE-APPROVAL-ORDERING-003 REQ-RELEASE-APPROVAL-ORDERING-004

## Intent

Implement GitHub Issue #30. Make release preparation enforce the sequence
final release inputs, validation, explicit release approval, and an unchanged
tag target rather than relying on operator procedure.

## Impact

- Add release-bound approval validation that can be reused by release tooling.
- Reject missing, stale, or tag-mismatched release approval before output
  directories or packaged assets are changed.
- Report deterministic per-artifact drift for stale approval evidence.
- Cover local and GitHub Actions release preparation and document the enforced
  sequence.
- After final release metadata, CHANGELOG, implementation, and tests are settled,
  run validation/build and record release approval before creating the unchanged
  release commit/tag boundary used by preparation.

## Verification

- Requirements and design validation passed with explicit human approvals.
- Seven authoritative `TEST-RELEASE-APPROVAL-ORDERING-*` tests have complete
  requirement-scoped Red/Green evidence.
- Strict trace coverage is design 1.0, implementation 1.0, and tests 1.0.
- `npm run typecheck`, `npm run build`, the full 522-passed/8-skipped test
  suite, `npm run pack:check`, and all 39 configured quality commands passed.
- Changed gate checks for policy, requirements, design, constitution, trace,
  graph, formal evidence, workflow, change history, commands, and deterministic
  test identities passed; release approval is the only remaining gate.
- Native implementation review found one approval-manifest digest integrity
  gap; `TEST-RELEASE-APPROVAL-ORDERING-005` reproduced it and the validator now
  rejects inconsistent evidence as a typed schema failure.
- Release evidence review added `TEST-RELEASE-APPROVAL-ORDERING-006` for ambient
  CI identity and workflow shell safety, and `TEST-RELEASE-APPROVAL-ORDERING-007`
  for rebuild-before-approval ordering.
- After those corrective batches reached Green, a new authoritative Quality
  checkpoint was appended; the earlier checkpoint remains immutable in
  `qualityHistory`.

## Residual risks

- Local approval identity remains self-reported as defined by ADR-0002.
- Release approval binds source inputs rather than `dist/`; release preparation
  mitigates stale or hand-modified build output by rebuilding `dist/` from the
  checked-out source tree before approval validation and packaging.
- Git release inventory detects nested workspaces from tracked or non-ignored
  `.musubix` marker paths, while non-Git fallback can also observe empty or
  fully ignored marker directories.
- The four new requirements are explicitly unsupported by the current Boolean
  formal abstraction; no SAT or behavior-proof claim is made.
- Thirty-six historical workflow declarations required bounded, human-approved
  reconciliation waivers because their original Skill events span prior
  sessions and cannot be reconstructed from the current active transcript. The
  latest bounded waiver records approved during CHANGE-0019 are authoritative;
  earlier records remain immutable audit history.
- One earlier dangling Red cycle for
  `TEST-RELEASE-APPROVAL-ORDERING-007` remains immutable because `tdd void`
  intentionally targets only the latest cycle for a test ID, and that latest
  cycle has a valid Green. Current-window TDD selection excludes the superseded
  cycle, and `tdd validate` passes.
