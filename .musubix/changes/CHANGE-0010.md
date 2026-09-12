---
schemaVersion: 1
id: CHANGE-0010
summary: Fail-fast unchanged-fingerprint detection in change-record
status: completed
---
# CHANGE-0010: change-record fail-fast unchanged-fingerprint detection

Requirements: REQ-CHANGE-RECORD-FAIL-FAST-001 REQ-CHANGE-RECORD-FAIL-FAST-002 REQ-CHANGE-RECORD-FAIL-FAST-003 REQ-CHANGE-RECORD-FAIL-FAST-004 REQ-CHANGE-RECORD-FAIL-FAST-005 REQ-CHANGE-RECORD-FAIL-FAST-006 REQ-CHANGE-RECORD-FAIL-FAST-007 REQ-CHANGE-RECORD-FAIL-FAST-008 REQ-CHANGE-RECORD-FAIL-FAST-009 REQ-CHANGE-RECORD-FAIL-FAST-010

## Intent

Resolve GitHub Issue #20: `change-record` unconditionally accepts and
durably persists every phase checkpoint, even when its fingerprint is
byte-identical to the immediately preceding phase's fingerprint (i.e., no
real edit happened between phases). This is only detected later, by `trace
check --strict`/`gate`, at which point `.musubix/evidence/changes.json`'s
append-only design (no phase reset/overwrite command exists) makes the
mistake permanent. This was independently reproduced in this repository's
own working history (`CHANGE-0009`, GitHub Issue #19) and reported twice in
`nahisaho/aira2` (`CHANGE-0001`, `CHANGE-0004`).

This change moves the five existing "unchanged" comparisons
(`CHANGE_REQUIREMENTS_UNCHANGED`, `CHANGE_DESIGN_UNCHANGED`,
`CHANGE_TESTS_UNCHANGED`, `CHANGE_IMPLEMENTATION_UNCHANGED`,
`CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED`) from validation-time-only to
also run inside `recordChangePhase`, before any evidence is written, for the
five phase transitions where an unchanged fingerprint is never legitimate.
It adds a `requirements`-only `--allow-unchanged` override (for the one
documented legitimate case: a defect fix that intentionally keeps its
requirement text unchanged) and a `--dry-run` preview mode, and documents
both in the CLI help and README. See `.musubix/decisions/ADR-0022.md` for
the full design rationale and alternatives considered.

A native `rubber-duck` review of the first requirements draft found
ambiguity in the `--allow-unchanged` override's persistence and later
suppression; a revision added a durable marker and a corresponding
requirement (REQ-CHANGE-RECORD-FAIL-FAST-008) for `validateChangeEvidence`
to honor it. The design review likewise found and fixed an ambiguity
between the full-set and per-requirement-batch fingerprint baselines, and
added an explicit persistence-ordering constraint guaranteeing
`appendEvidenceOrder`/`writeJson` are unreachable on any rejected or
dry-run call.
