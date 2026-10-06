---
schemaVersion: 1
feature: sdd-change-ops-improvements
---
# Requirements: sdd-change operational guidance improvements

Source: GitHub Issue #61.

This is a documentation-only change to the contributor workflow guidance in
`.github/skills/sdd-change/SKILL.md`. The issue is not requesting a new runtime
behavior change. The optional early-detection diagnostic for a `tdd green`
recorded before `change-record implementation` is explicitly out of scope for
this feature unless taken up by a separate change.

## REQ-SDD-CHANGE-OPS-IMPROVEMENTS-001: Document the strict TDD/change-record ordering checklist
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The project's `sdd-change` skill instructions shall include an implementation/TDD checklist that requires contributors to follow `tdd red` → `change-record red` → implementation edit → `change-record implementation` → `tdd green` → `change-record green` in strict order.
Acceptance: `.github/skills/sdd-change/SKILL.md`'s implementation/TDD guidance itself names all six ordered steps above in that order, uses wording equivalent to "strict order" or "do not reorder", explicitly warns not to run `tdd green` before `change-record implementation` or to batch Green calls ahead of the implementation record, and contains no contradictory sequencing guidance for the same workflow.

## REQ-SDD-CHANGE-OPS-IMPROVEMENTS-002: Document parallel worktree freshness checks
Priority: must
Type: functional
Pattern: event-driven
Statement: When long-lived or parallel worktree development is in scope, the `sdd-change` skill instructions shall direct contributors to periodically refresh against `origin/main` and inspect divergence before release time.
Acceptance: `.github/skills/sdd-change/SKILL.md` explicitly instructs contributors in parallel or long-running worktrees to run `git fetch` plus `git log origin/main..HEAD` and `git log HEAD..origin/main` (or an equivalent symmetric divergence check), and to rebase onto `origin/main` periodically, especially around other in-flight changes merging to `main`.

## REQ-SDD-CHANGE-OPS-IMPROVEMENTS-003: Cap rubber-duck review loops and escalate unresolved findings
Priority: must
Type: functional
Pattern: event-driven
Statement: When a contributor completes a rubber-duck review round for an `sdd-change` artifact set, the skill instructions shall stop automated re-review after the third round and escalate unresolved findings for human decision.
Acceptance: Given `.github/skills/sdd-change/SKILL.md` after this change, the review guidance for one artifact set states a maximum of `3` rounds total, states that rounds `2-3` are follow-up rounds under the same cap, directs contributors after round `3` to summarize unresolved findings and ask a human whether to continue with fixes or proceed as-is, and leaves zero same-loop instructions that permit an automatic fourth-or-later re-review for that artifact set.

## REQ-SDD-CHANGE-OPS-IMPROVEMENTS-004: Document concrete review-convergence techniques
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The `sdd-change` skill instructions shall document concrete review-convergence techniques that reduce unnecessary rubber-duck iterations without removing the required logic/consistency review scope.
Acceptance: `.github/skills/sdd-change/SKILL.md`'s review guidance includes all of the following: run automated validators before review; review related requirements/design/ADR documents together when appropriate; scope the review prompt to logic, contradiction, acceptance, and consistency issues rather than style; fix one round's findings in one batch before re-review; pre-state known constraints and prior decisions in the review request; explicitly state the capped stop condition in the rubber-duck request itself; use a full-artifact review for the first round and only diff-only follow-up review for the second and third rounds within the three-round cap; and stop after the third round for human escalation if findings remain.

## REQ-SDD-CHANGE-OPS-IMPROVEMENTS-005: Confirm CHANGELOG updates during quality
Priority: must
Type: functional
Pattern: event-driven
Statement: When the `sdd-change` skill describes the Quality or release-readiness checklist, the skill instructions shall require confirming that `CHANGELOG.md` has been updated for the change before release approval is requested.
Acceptance: `.github/skills/sdd-change/SKILL.md`'s Quality or release-readiness checklist explicitly includes confirming that a `CHANGELOG.md` entry was added before the change is treated as release-ready.

## REQ-SDD-CHANGE-OPS-IMPROVEMENTS-006: Prefer changed-scope gate runs until final release-candidate confirmation
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The `sdd-change` skill instructions shall guide contributors to use `gate --changed --json` for intermediate confidence during implementation and quality iterations and to reserve the full `gate --json` run for the final release-candidate confirmation.
Acceptance: Given `.github/skills/sdd-change/SKILL.md` after this change, the quality/release guidance names `gate --changed --json` as the intermediate iteration gate, treats the first otherwise-passing changed-scope gate as the release-candidate checkpoint, reserves the full `gate --json` run for the final confirmation before release approval, and leaves `0` instructions that call for repeated full-gate reruns during intermediate implementation or quality iterations.
