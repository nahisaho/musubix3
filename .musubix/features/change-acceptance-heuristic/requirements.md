---
schemaVersion: 1
feature: change-acceptance-heuristic
---
# Change completeness: measurable-acceptance heuristic false negatives

Source: GitHub Issue #1 (reopened; recurrence during Issue #19/#20,
CHANGE-0009/CHANGE-0010).

`validateChangeEvidence`'s `CHANGE_COMPLETENESS_ACCEPTANCE` diagnostic
(`packages/analysis/src/change.ts`) treats a requirement's `Acceptance:`
text as "measurable" only when it is non-placeholder, at least 8 characters
long, and matches the regex
`/(?:\d|test|check|verif|assert|given|when|then|return|status|pass|fail|テスト|確認|検証|以下|以上)/i`.
An audit of every `Acceptance:` block in `.musubix/features/*/requirements.md`
found 11 requirements (`REQ-APPROVAL-DOMAIN-SCOPING-002/003/005/009/011/013/015/020`,
`REQ-CLI-WORKFLOW-UX-002/003`, `REQ-TDD-CYCLE-VOID-003`) whose Acceptance
text describes a concrete, testable, human-reviewed and approved observable
outcome (e.g. "reports an error naming the feature directory", "exits
nonzero listing the configured domain names", "output contains exactly
that domain's requirements/design entries") but contains none of the
recognized keywords, so the check reports `CHANGE_COMPLETENESS_ACCEPTANCE`
as a false negative. Fixing the wording to add a recognized keyword would
re-open the requirement text and invalidate its already-current,
human-approved `requirements` stage approval — a disproportionate cost for
a heuristic gap, not a real content defect. This feature extends the
keyword vocabulary so genuinely measurable, already-approved acceptance
text is recognized, without weakening detection of placeholder or
non-substantive acceptance text.

## REQ-CHANGE-ACCEPTANCE-HEURISTIC-001: Recognize observable-outcome vocabulary as measurable
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall treat an `Acceptance:` value that passes all rejection conditions of REQ-CHANGE-ACCEPTANCE-HEURISTIC-002 (i.e., is not rejected as empty, too short, or placeholder-prefixed) as measurable when it contains at least one case-insensitive substring match for a digit or any of `test`, `check`, `verif`, `assert`, `given`, `when`, `then`, `return`, `status`, `pass`, `fail`, `report`, `error`, `reject`, `contain`, `unaffected`, `unchanged`, `invalid`, `missing`, `stale`, `silently`, `substring`, `naming`, `configur`, `exit`, `omit`, `affect`, `raise`, `テスト`, `確認`, `検証`, `以下`, or `以上` (substring matching, not whole-word matching).
Acceptance: Given the 11 currently-approved requirements whose Acceptance text was audited and found to lack a previously-recognized keyword (`REQ-APPROVAL-DOMAIN-SCOPING-002`, `-003`, `-005`, `-009`, `-011`, `-013`, `-015`, `-020`; `REQ-CLI-WORKFLOW-UX-002`, `-003`; `REQ-TDD-CYCLE-VOID-003`), running `gate --changed --json` after this change reports zero `CHANGE_COMPLETENESS_ACCEPTANCE` diagnostics for those 11 requirement IDs.

## REQ-CHANGE-ACCEPTANCE-HEURISTIC-002: Preserve existing placeholder and length rejection
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If an `Acceptance:` value is missing, empty after trimming, shorter than 8 characters after trimming, equals one of the placeholder values `TODO`, `TBD`, `N/A`, `none`, or `未定` (case-insensitive) as its entire trimmed value, or begins (after trimming, ignoring case) with one of those placeholder values immediately followed by optional whitespace and a `:`, `-`, or `—` separator, then the system shall report `CHANGE_COMPLETENESS_ACCEPTANCE` for that requirement regardless of the broadened keyword vocabulary in REQ-CHANGE-ACCEPTANCE-HEURISTIC-001.
Acceptance: Each of the following synthetic Acceptance values still produces `CHANGE_COMPLETENESS_ACCEPTANCE` after this change: exactly `TBD`; exactly `未定`; an empty string; a 7-character or shorter non-placeholder string; `TODO: configure later`; `TBD - error handling`; `  todo : configure later` (leading whitespace, extra spaces, lowercase); `TbD—error handling` (mixed case, em dash, no space); and `未定 — 後で設定` (Japanese placeholder with em dash separator); none of these is suppressed by the broadened keyword list from REQ-CHANGE-ACCEPTANCE-HEURISTIC-001.
