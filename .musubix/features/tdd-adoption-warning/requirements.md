---
schemaVersion: 1
feature: tdd-adoption-warning
---
# Warn loudly, and document clearly, that recording the first `tdd` cycle makes gate's `tdd` check required project-wide

Source: GitHub issue #23 — the moment the first Red cycle is persisted in
`.musubix/evidence/tdd.json` (`evidence.cycles.length` becomes nonzero;
`packages/analysis/src/tdd.ts`'s `tdd.present` becomes true), this alone makes
`gate`'s `tdd` check `required` for the **entire** project, independently of
any other reason the check might already have been required (see
`packages/analysis/src/gate.ts`: `required: required('tdd') || tdd.present ||
hasChangeDocuments` — if `required('tdd')`/config or `hasChangeDocuments`
already made it required, persisting the first cycle changes nothing about
requiredness, but still activates the full-project coverage check below for
the first time). This holds even if that first Red is itself invalid or has
no Green phase yet. Once required, the full-project `gate`/`approval record
release` status depends on `tdd.valid`, which demands a valid Red-Green cycle
from an authoritative verifying test (this document calls such a requirement
"covered"; one with no such cycle is "uncovered") for *every* mandatory requirement in the trace graph
(`TDD_REQUIREMENT_UNCOVERED`), not just the ones touched by the current
change. There is no incremental/opt-in scoping and no bulk-onboarding tool for
requirements that never had TDD evidence (`tdd migrate` only re-fingerprints
requirements that already have a valid Green cycle). This is the same
"optional → required activates project-wide the instant ANY evidence exists"
pattern already accepted for the `workflow` and `change-history` gate checks
(`packages/analysis/src/gate.ts`), and this change keeps that existing,
intentional whole-project-consistency design unchanged. It instead makes the
one-way, project-wide consequence of persisting the *first* `tdd` cycle
impossible to trigger by surprise: a prominent CLI warning at the moment of
first adoption, and explicit documentation of the interaction with `gate` and
`approval record release`.

## REQ-TDD-ADOPTION-WARNING-001: Warn when a `tdd red` call will persist the project's first TDD cycle evidence while mandatory requirements remain uncovered
Priority: must
Type: functional
Pattern: event-driven
Statement: When `tdd red` reaches the point of persisting a Red cycle (whether that Red is itself valid or invalid) and the project's persisted TDD evidence had zero cycles immediately before that persistence, the system shall include a warning entry in that call's result listing every other uncovered mandatory requirement in the trace graph, and stating that this call activates gate's project-wide `tdd` coverage check (which becomes required for the whole project as of this call, if it was not already required for another configured reason).
Acceptance: Given a project whose `.musubix/evidence/tdd.json` has zero cycles (or is absent), calling `tdd red <TEST-ID> --requirement <REQ-ID> --command <name>` persists a cycle (this holds whether the recorded Red is valid or invalid) and its returned/printed result includes, in a `warnings` array separate from its `diagnostics` array, exactly one entry with code `TDD_ADOPTION_PROJECT_WIDE` and `severity: "warning"`. This warning entry is additive to, and never changes, the phase's own `valid` outcome (an otherwise-valid Red is still reported/recorded as valid; an otherwise-invalid Red is still reported/recorded as invalid, for its pre-existing reasons only). Given the trace graph has N (N >= 0) other mandatory requirements that are still uncovered, the warning entry's message always names all N such requirement IDs explicitly (never merely a count; N = 0 still produces the warning entry, explicitly stating there are zero other uncovered requirements), and separately states that the just-recorded requirement itself remains uncovered until it also has a valid Green phase. Given a project whose `.musubix/config.json` already configures `tdd` as required (or that already has change documents making it required), the warning entry's message still appears under the same zero-cycles-before-this-call trigger, but its wording states only that the project-wide coverage check is now active, without claiming this call is what made the check required. Given a `tdd red` call that throws before persisting any cycle (for example a missing design approval, a failed Red preflight command, an unknown test ID, or a test/requirement `@verifies` mismatch), no `TDD_ADOPTION_PROJECT_WIDE` warning entry is produced, since no evidence was persisted and the project's adoption state is unchanged. Given a project where at least one cycle already exists anywhere in persisted TDD evidence before this call, calling `tdd red` for a new/different test never includes a `TDD_ADOPTION_PROJECT_WIDE` warning entry in its result, since the project-wide activation already occurred on an earlier call and repeating the warning would not be actionable. The default (non-`--json`) CLI invocation of `tdd red` prints this warning entry's message to the console in addition to its existing `RED: PASS|FAIL` summary line; `--json` output includes it in a `warnings` array on the result, kept separate from the result's own `diagnostics` array (which continues, unaffected, to determine the recorded phase's `valid` outcome).

## REQ-TDD-ADOPTION-WARNING-002: Document the all-or-nothing project-wide semantics of `tdd` evidence adoption
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall document, in `tdd red`'s `--help` output and in the README's CLI command reference for `tdd red|green|refactor`, that recording the project's first TDD cycle makes gate's `tdd` check required for every mandatory requirement in the project (each surfaced as `TDD_REQUIREMENT_UNCOVERED` if it is uncovered), that `approval record release` always runs the full (non-`--changed`) project-wide gate and is therefore blocked by any resulting `TDD_REQUIREMENT_UNCOVERED` diagnostics, and that `tdd migrate` cannot be used to bulk-onboard previously-uncovered requirements because it only re-fingerprints an already-covered requirement (one with an existing valid Green cycle).
Acceptance: Running `npx musubix3 tdd red --help` prints text matching all of /project-wide/i, /TDD_REQUIREMENT_UNCOVERED/, /approval record release/, and /tdd migrate/. The README's `tdd red|green|refactor` reference row (or an adjacent paragraph it directly references) contains the substrings "project-wide", "TDD_REQUIREMENT_UNCOVERED", "approval record release", and a statement that "tdd migrate" applies only to a requirement that already has a valid Green cycle (not bulk onboarding of previously-uncovered requirements).
