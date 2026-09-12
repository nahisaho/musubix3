---
schemaVersion: 1
id: CHANGE-0011
summary: Human-audited tdd void command for a dangling invalid trailing TDD cycle
status: in-progress
---
# CHANGE-0011: tdd-cycle-void

Requirements: REQ-TDD-CYCLE-VOID-001 REQ-TDD-CYCLE-VOID-002 REQ-TDD-CYCLE-VOID-003 REQ-TDD-CYCLE-VOID-004 REQ-TDD-CYCLE-VOID-005 REQ-TDD-CYCLE-VOID-006 REQ-TDD-CYCLE-VOID-007 REQ-TDD-CYCLE-VOID-008 REQ-TDD-CYCLE-VOID-009 REQ-TDD-CYCLE-VOID-010 REQ-TDD-CYCLE-VOID-011 REQ-TDD-CYCLE-VOID-012 REQ-TDD-CYCLE-VOID-013

## Intent

Resolve item 1 of the reopened GitHub Issue #1 (recurrence observed during
Issue #20/CHANGE-0010): `tdd-superseded-cycle-scoping` (Issue #11) only
suppresses an *earlier* incomplete/invalid TDD cycle for a test ID when a
*later* cycle for that same test ID has both a valid Red and a valid Green.
It does not cover the reverse ordering — a genuinely valid Red-Green cycle
followed by a *later*, dangling, invalid trailing cycle for the same test ID
(for example an accidental `tdd red <test-id>` re-invocation after the
feature was already Green). Because supersession requires a later cycle
with both phases valid, such a trailing invalid cycle is never superseded
and permanently raises `TDD_RED_MISSING`/`TDD_GREEN_MISSING`/
`TDD_LEGACY_OR_UNSCOPED_EVIDENCE`. `.musubix/evidence/tdd.json` is
append-only and hand-editing is unsupported; the only previously
tool-supported remedy was moving the entire evidence file aside and
re-recording every cycle in the repository, which is disproportionate for a
project with many already-shipped, passing tests.

This change adds an explicit, human-approved `tdd void <test-id>` command
(`--approver`, `--reason`, `--confirm`) that marks a single, verified-dangling
trailing cycle as voided via an appended, hash-chained, order-logged record
(never a deletion or edit of any existing evidence), so `gate`/`tdd validate`
treat it the same way an earlier-cycle supersession is already treated,
without touching any other test's or cycle's evidence. See
`.musubix/decisions/ADR-0023.md` for the full design rationale and rejected
alternatives (hand-editing, archive-and-regenerate, silently extending
supersession, a general-purpose override command).

Native `rubber-duck` reviews of the requirements and design (multiple
rounds) found and closed: an under-specified multi-cycle/re-void interaction
risking transitive suppression; an earlier cycle carrying its own void
marker not being excluded as a fallback; `tdd migrate`'s interaction with a
voided latest cycle being unaddressed; the void record itself not being as
tamper-evident/validator-enforced as the phase evidence it suppresses; a
missing `testId` field on the order-log record described by the literal
requirement wording; an ambiguous `tdd validate --json` void payload shape;
and two linkage-validation gaps that could bless a cryptographically
corrupt-but-present order/chain record. All were fixed before requirements
and design approval (see `.musubix/features/tdd-cycle-void/requirements.md`
and `design.md`).
