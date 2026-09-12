---
schemaVersion: 1
feature: change-acceptance-heuristic
---
# Design: change completeness measurable-acceptance heuristic

## DES-CHANGE-ACCEPTANCE-HEURISTIC-001: Broadened measurable-acceptance predicate
Responsibilities: Compute the `measurableAcceptance` boolean used by `validateChangeEvidence`'s `CHANGE_COMPLETENESS_ACCEPTANCE` check in `packages/analysis/src/change.ts` (~line 571). Reject an `Acceptance:` value that is missing, empty after trimming, shorter than 8 characters after trimming, equal (case-insensitively) to the whole-value placeholders `TODO`, `TBD`, `N/A`, `none`, `未定`, or that begins (after trimming, case-insensitively) with one of those placeholder tokens immediately followed by optional whitespace and a `:`, `-`, or `—` separator. Otherwise accept the value as measurable when it contains at least one case-insensitive substring match for a digit or any of the extended keyword list.
Interfaces: A single expression assigned to the existing local `measurableAcceptance` constant inside `validateChangeEvidence`; no new exported function, type, or CLI surface. Two internal regex constants: `PLACEHOLDER_PREFIX_RE` (whole-value-or-prefixed placeholder rejection) and `MEASURABLE_KEYWORD_RE` (broadened keyword list), both module-scoped in `change.ts` so they are easy to locate and unit-test in isolation from the surrounding function.
Constraints: Must preserve exact current behavior for every value the current regex already accepts or rejects, except (a) any value that newly matches the broadened `MEASURABLE_KEYWORD_RE` and also still satisfies the unchanged length (>= 8 trimmed characters) and placeholder-prefix-rejection gates (confirmed by the 11 audited previously-false-negative cases, but not limited to only those 11 — any such value is intentionally, not incidentally, now measurable), and (b) any value newly matching the placeholder-prefix rejection rule of REQ-CHANGE-ACCEPTANCE-HEURISTIC-002 (e.g. `TODO: test passes` was previously accepted via the `test` keyword and must now be rejected as placeholder-prefixed, overriding any keyword match) — both (a) and (b) are intentional, requirement-mandated reclassifications, not regressions. Must not accept any value the current implementation already rejects as an exact whole-value placeholder. Must not introduce a new diagnostic code, change `CHANGE_COMPLETENESS_ACCEPTANCE`'s message text, or alter any other `CHANGE_COMPLETENESS_*` check. Pure/deterministic (no I/O, no async). Exact predicate structure (order of conjuncts matters — the placeholder-prefix test must be a negated conjunct applied to the trimmed value, separate from and evaluated before the keyword test):
```ts
const acceptance = requirement?.acceptance?.trim() ?? '';
const measurableAcceptance =
  acceptance.length >= 8 &&
  !PLACEHOLDER_PREFIX_RE.test(acceptance) &&
  MEASURABLE_KEYWORD_RE.test(acceptance);
```
`PLACEHOLDER_PREFIX_RE` matches, case-insensitively, a value that is exactly one of `TODO`, `TBD`, `N/A`, `none`, `未定`, or that starts with one of those tokens followed by optional whitespace and then `:`, `-`, or `—` (e.g. `/^(?:TODO|TBD|N\/A|none|未定)(?:\s*[:\-—].*)?$/i`).
Requirements: REQ-CHANGE-ACCEPTANCE-HEURISTIC-001 REQ-CHANGE-ACCEPTANCE-HEURISTIC-002
ADRs: ADR-0024
