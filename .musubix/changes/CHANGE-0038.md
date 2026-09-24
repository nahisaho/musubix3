---
schemaVersion: 1
id: CHANGE-0038
summary: Document safe evidence writer lock recovery in SDD skills
status: staged
---
# CHANGE-0038: evidence-writer-lock-skill-guidance

Source: GitHub Issue #33.

Requirements: REQ-EVIDENCE-WRITER-LOCK-006

## Intent

Ensure an agent that encounters `EVIDENCE_WRITER_LOCKED` during an SDD workflow
receives the same fail-closed recovery guidance already provided by the CLI and
README.

## Classification

- Distributed skill documentation behavior change.

## Impact

- Add concise, consistent recovery guidance to the change, implementation, and
  quality skills.
- Permit a blocked command to be retried only after owner release, successful
  automatic recovery, or completed operator-reviewed manual remediation.
- Preserve the existing writer-lock implementation and CLI behavior.
- Add `DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001` through
  `DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-003`, trace annotations for the
  three skill files and package smoke implementation, and an authoritative
  verifying test.
- Combine direct source-guidance assertions with installed-copy byte equality
  to prove that the packaged copies contain the required guidance.
- Keep the existing 80-line limit for every distributed skill.
- Preserve the existing distribution-contract literals and behavior verified by
  `TEST-SESSION-SCOPED-DEVELOPMENT-001` and
  `TEST-SESSION-SCOPED-DEVELOPMENT-002` while compacting prose as needed.
- Keep the other SDD skills out of scope because Issue #33 names the change,
  implementation, and quality workflow surfaces; those skills retain the
  general recovery guidance in the CLI and README.

## Verification

- Validate the new EARS requirement and project constitution.
- Add the skill-content test before editing the distributed skills and record a
  genuine Red/Green cycle.
- Extend the installed-tarball smoke test and remove its temporary package
  workspace through the existing cleanup path.
- Apply the package-smoke implementation after Red and before Green so the TDD
  source fingerprint changes even though skill files are excluded inputs.
- Run focused tests, typecheck, build, full tests, package checks, strict trace,
  graph, changed gate, and status.

## Residual risks

- Manual removal on unsupported platforms remains operator-reviewed because
  musubix3 cannot conclusively prove owner death there.
- Linux recovery can also return `EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`; that
  result requires the same operator-reviewed manual escalation.
- Existing initialized projects require the established `musubix3 upgrade`
  flow to receive updated bundled skill content.
- The guidance cannot prevent an external operator from ignoring the documented
  safety procedure.
