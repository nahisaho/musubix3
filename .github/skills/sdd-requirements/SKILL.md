---
name: sdd-requirements
description: "Use when eliciting, refining, or validating EARS requirements and measurable constitution rules for specification-driven development. 要求定義・EARS検証・憲章策定に使用。"
---
# Requirements / 要求

Respond and generate guidance in the user's input language (日本語 / English).
Use Copilot's native planning, questions, research and editing; do not create an
interview engine or research agent framework.
After the work, run `npx musubix3 workflow-record sdd-requirements complete
--status completed` exactly once.

1. Inspect `.musubix/constitution.md` and the feature's existing requirements.
   If absent, preview `npx musubix3 init --dry-run` before installing.
2. Use native planning to clarify scope, stakeholders, measurable acceptance and
   failure behavior. Separate assumptions from confirmed requirements.
3. Edit `.musubix/features/<slug>/requirements.md` with headings
   `## REQ-FEATURE-001: Title`, `Priority: must|should|may`,
   `Type: functional|non-functional`, and `Statement: ...`. IDs are globally
   unique. Keep one obligation per entry; add `Acceptance: ...`.
   Acceptance must be non-placeholder and measurably testable. For semantics
   that must enter formal coverage, add strict one-line `Formal:` JSON using
   branch-scoped `conditional`, integer `numeric`, `temporal` with required
   `withinMs` and optional nonnegative `afterMs`, or deterministic `transition`.
   For numeric constraints, use compatible duration (`ms`/`s`/`min`) or size
   (`bytes`/`kib`/`mib`) units when conversion is intended; never translate
   arbitrary prose or incompatible dimensions by guesswork. A non-functional deterministic
   budget uses `Performance:` with `counter`, integer `max`, and `testId`.
4. Use all six controlled EARS forms as appropriate:
   - The system shall respond.
   - When an event occurs, the system shall respond.
   - While a state holds, the system shall respond.
   - If a fault occurs, then the system shall respond.
   - Where a feature is enabled, the system shall respond.
   - While a state holds, when an event occurs, the system shall respond.
   Japanese equivalents use `システムは…しなければならない。`, with
   `…とき、` / `…間、` / `もし…ならば、` / `…場合、` clauses.
5. Validate with `npx musubix3 requirements validate <file> --json` and
   `npx musubix3 constitution validate --json`. Rules use `PRINC-001`, `RULE-001`,
   a supported `Metric:` and numeric `Limit:`. Validation is not execution evidence.
6. Hand off confirmed IDs and unresolved assumptions to `sdd-design`; use native
   review for semantic completeness, not merely syntactic conformance.
