---
schemaVersion: 1
feature: sdd-change-ops-improvements
---
# Design: sdd-change operational guidance improvements

## DES-SDD-CHANGE-OPS-IMPROVEMENTS-001: Implementation-ordering and parallel-worktree guidance
Responsibilities: Revise `.github/skills/sdd-change/SKILL.md`'s
classification/inspection and implementation/TDD sections so the
documentation-only workflow still makes the strict evidence-order discipline
unmissable: classify documentation-only changes explicitly, direct
contributors in long-lived or parallel worktrees to `git fetch`, inspect
divergence in both directions against `origin/main`, and rebase periodically
onto `origin/main` especially around other in-flight merges, and replace the
current generic TDD prose with an explicit six-step checklist
`tdd red` → `change-record red` → implementation edit →
`change-record implementation` → `tdd green` → `change-record green`
including a warning that Green must never be batched ahead of the
implementation record.
Interfaces: `.github/skills/sdd-change/SKILL.md` section 1
("Classify and inspect") and section 3 ("Implement and prove coverage").
Constraints: Must remain documentation-only: no new CLI, gate, or runtime
diagnostic is added in this change. The guidance must not contradict the
existing documented exemption that documentation-only changes may omit TDD
when policy allows; instead it must explain the strict order for changes that
do execute Red/Implementation/Green while separately preserving the
documentation-only exemption path.
Requirements: REQ-SDD-CHANGE-OPS-IMPROVEMENTS-001 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-002
ADRs: none - documentation-only workflow guidance; no new architectural decision or tradeoff worth recording as a decision record is introduced by this change.

## DES-SDD-CHANGE-OPS-IMPROVEMENTS-002: Bounded rubber-duck review protocol
Responsibilities: Rewrite `.github/skills/sdd-change/SKILL.md`'s
requirements/design/release review instructions so the mandated native
rubber-duck loop is bounded and convergent: instruct contributors to run
automated validators first, review related requirement/design/ADR artifacts
together when appropriate, scope the review request to logical contradictions
and acceptance/consistency issues, build a requirement-to-design
traceability/self-check table before review, pre-state known constraints and
prior decisions, batch-fix each round's findings before re-review, embed the
capped stop condition directly in the review request, use a full-artifact
first review followed only by diff-only second/third rounds, and stop after
round three to summarize unresolved findings for human decision instead of
looping indefinitely.
Interfaces: `.github/skills/sdd-change/SKILL.md` section 2
("Update specifications first") and section 4
("Rebuild evidence and finish").
Constraints: Must preserve the repository's requirement that AI-generated
documentation be reviewed before human approval, but must remove or qualify
otherwise-unbounded "repeat until zero issues remain" wording for the same
artifact set so the three-round cap governs the documented process.
Requirements: REQ-SDD-CHANGE-OPS-IMPROVEMENTS-003 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-004
ADRs: none - documentation-only workflow guidance; no new architectural decision or tradeoff worth recording as a decision record is introduced by this change.

## DES-SDD-CHANGE-OPS-IMPROVEMENTS-003: Quality-phase checklist and documentation-only evidence note
Responsibilities: Update `.github/skills/sdd-change/SKILL.md`'s quality and
release-candidate guidance so intermediate iterations prefer
`gate --changed --json`, the first otherwise-passing changed-scope gate is
treated as the release-candidate checkpoint, the full `gate --json` run is
reserved for final confirmation before release approval, and the quality
checklist explicitly confirms that `CHANGELOG.md` was updated. Update
`.musubix/changes/CHANGE-0045.md` to record that this feature is
documentation-only and therefore omits TDD/runtime-code phases by policy,
while still requiring impact/requirements/design/quality evidence for the
guide change itself.
Interfaces: `.github/skills/sdd-change/SKILL.md` section 4
("Rebuild evidence and finish"); `.musubix/changes/CHANGE-0045.md`.
Constraints: Must not claim that `gate --changed --json` replaces the final
full gate, and must not claim that the optional early-detection diagnostic is
implemented. The CHANGE document must clearly state the TDD omission reason so
later quality review can distinguish this documentation-only exemption from
missing evidence.
Requirements: REQ-SDD-CHANGE-OPS-IMPROVEMENTS-005 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-006
ADRs: none - documentation-only workflow guidance; no new architectural decision or tradeoff worth recording as a decision record is introduced by this change.
