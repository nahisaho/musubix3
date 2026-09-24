---
schemaVersion: 1
id: CHANGE-0028
summary: Stop resolved stale waivers from permanently blocking release gates
status: staged
---
# CHANGE-0028: resolved-stale-waiver-severity

Requirements: REQ-CHANGE-EVIDENCE-WAIVER-011

## Intent

Fix #44 by preserving fail-closed stale-waiver handling while preventing an
obsolete waiver from permanently blocking a gate after its exact underlying
diagnostic has been resolved by real evidence.

## Classification

- Behavior correction and specification refinement: distinguish a stale waiver
  whose targeted diagnostic still exists from one whose targeted diagnostic no
  longer exists.

## Impact

- Keep `CHANGE_WAIVER_STALE` as an error when the standalone condition
  predicate is `true` or `indeterminate`.
- Report the stale waiver as an audit warning only when the standalone
  tri-state condition predicate evaluates `false` for the exact scope;
  `true` and `indeterminate` remain errors.
- Update the change-evidence-waiver design so stale severity is derived from
  the code-specific condition predicate rather than from whichever validator
  happens to be assembling diagnostics.
- Preserve append-only waiver history, authoritative-record selection, and
  active-waiver reporting.
- Reuse one precomputed waiver context across status helpers; for gate reports,
  derive report-level waiver diagnostics from already-computed change-history
  diagnostics without a second diagnostic load or duplicate check entries.
- Add regression coverage for unresolved (`true`), resolved (`false`), and
  unevaluable (`indeterminate`) stale scopes, including evaluator/validator
  equivalence. Companion CHANGE-0029 covers record-time condition gating and
  structural linkage.

## Verification

- Cover `true`, `false`, and `indeterminate` stale classifications in both
  change validators, including severity and remediation text.
- Current `CHANGE-0026` resolved stale scopes are expected to become warnings.
  Current `CHANGE-0016` scopes whose debt still evaluates `true` are expected
  to remain errors until separately approved replacement waivers are recorded;
  CHANGE-0028 does not by itself clear those intentional fail-closed errors.

## Residual risks

- This does not delete or rewrite waiver evidence. Staleness is evaluated from
  current condition/snapshot state; if mutable evidence later returns exactly
  to the originally approved state, the waiver can become active again.
- A resolved stale waiver intentionally remains as a persistent warning and
  append-only evidence record; this change does not introduce retirement.
- An `indeterminate` stale waiver remains fail-closed until its scope is made
  evaluable again; restore the referenced change/requirement/batch state, then
  resolve the debt or record an allowed replacement.
