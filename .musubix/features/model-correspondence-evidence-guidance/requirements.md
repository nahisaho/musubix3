---
schemaVersion: 1
feature: model-correspondence-evidence-guidance
---
# Make the `evidence refresh` prerequisite for `model-correspondence validate` discoverable

Source: GitHub issue #16 — a requirement with an explicit `Formal:` JSON block
requires `.musubix/evidence/model-correspondence.json` to exist before
`model-correspondence validate` can pass. That file is only produced by
`npx musubix3 evidence refresh`, but this ordering is documented only in the
README body, not in the tool's own `--help` output or in the
`MODEL_CORRESPONDENCE_MISSING` diagnostic message itself.

## REQ-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-001: Hint at `evidence refresh` in the missing-evidence diagnostic
Priority: should
Type: functional
Pattern: event-driven
Statement: When `model-correspondence validate` finds requirements with explicit Formal JSON but no `.musubix/evidence/model-correspondence.json` file, the system shall include in the MODEL_CORRESPONDENCE_MISSING diagnostic message an instruction to run `npx musubix3 evidence refresh` to generate it.
Acceptance: Given a project with at least one requirement carrying a `Formal:` JSON block and no `.musubix/evidence/model-correspondence.json` file, calling `validateModelCorrespondenceEvidence(root)` returns a diagnostics array whose MODEL_CORRESPONDENCE_MISSING entry's message contains the exact substring "npx musubix3 evidence refresh"; a project with zero such requirements continues to return an empty diagnostics array unchanged.

## REQ-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-002: Document the `evidence refresh` prerequisite in command help text
Priority: should
Type: functional
Pattern: ubiquitous
Statement: The `model-correspondence validate` CLI command shall have a description mentioning that `evidence refresh` must be run first to generate its evidence file.
Acceptance: Given the CLI is built, running `npx musubix3 model-correspondence validate --help` prints help text containing the substring "evidence refresh".
