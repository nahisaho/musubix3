---
schemaVersion: 1
feature: model-correspondence-evidence-guidance
---
# Surface the `evidence refresh` prerequisite in the diagnostic message and CLI help

## DES-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-001: Append an `evidence refresh` hint to the MODEL_CORRESPONDENCE_MISSING message
Responsibilities: In `packages/analysis/src/model-correspondence.ts`'s `validateModelCorrespondenceEvidence()`, when `.musubix/evidence/model-correspondence.json` does not exist and there are one or more explicit-Formal-JSON requirements, change the `MODEL_CORRESPONDENCE_MISSING` diagnostic's message text to additionally instruct running `npx musubix3 evidence refresh` to generate the missing file.
Interfaces: `validateModelCorrespondenceEvidence(root: string)` — exported signature and return shape (`{ present, valid, requirements, coveredRequirements, diagnostics }`) unchanged; only the `message` string of the existing `MODEL_CORRESPONDENCE_MISSING` diagnostic entry changes.
Constraints: Must not change the returned diagnostic `code`, `path`, or the `present`/`valid`/`requirements`/`coveredRequirements` fields. Must not add a diagnostic when there are zero explicit-Formal-JSON requirements (diagnostics stays an empty array in that case, unchanged from current behavior).
Requirements: REQ-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-001
ADRs: none — a diagnostic-message text change with no new architectural boundary
Depends-On: none

## DES-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-002: Document the prerequisite on the CLI command itself
Responsibilities: In `packages/cli/src/main.ts`, add a `.description(...)` to the `model-correspondence validate` subcommand (currently has none) stating that `npx musubix3 evidence refresh` must be run first to generate `.musubix/evidence/model-correspondence.json`.
Interfaces: Commander.js `.command('validate')` chain under the existing `model-correspondence` command group; no change to the command's options, arguments, or action handler behavior.
Constraints: Must not alter the `validate` command's accepted options (`--root`, `--json`) or its runtime behavior — this is help-text metadata only. The added description text must contain the substring "evidence refresh" so it is verifiable via `--help` output.
Requirements: REQ-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-002
ADRs: none — CLI help-text addition, no new architectural boundary
Depends-On: none
