---
schemaVersion: 1
id: CHANGE-0051
summary: Restore repository release readiness
status: staged
---
# CHANGE-0051: release-readiness-recovery

Requirements: REQ-DESIGN-ADR-NONE-EXEMPTION-004

## Intent

Restore repository-wide release readiness without weakening requirements,
quality gates, or evidence policy.

## Source

- Human request to make the repository release-ready after Issue #46.
- Current changed gate reports valid explicit ADR exemptions as missing ADR
  evidence and also reports historical chronology debt, stale waivers,
  unverified workflow evidence, and a stale release approval.

## Classification

- Defect correction for inconsistent ADR-exemption handling.
- Audited evidence maintenance for pre-existing historical debt.
- Only `REQ-DESIGN-ADR-NONE-EXEMPTION-004` carries design, code, test, and TDD
  evidence. Historical waiver, migration, workflow reconciliation, and release
  approval operations are non-requirement-bearing maintenance performed through
  existing audited commands.

## Impact

- Make change completeness recognize the same concrete `ADRs: none - reason`
  exemption already accepted by design validation.
- Amend and re-approve DES-DESIGN-ADR-NONE-EXEMPTION-001's interfaces and
  constraints with an exported optional parsed exemption result, amend and
  re-approve ADR-0017 to authorize downstream completeness use, and add a
  completeness-side component that owns
  REQ-DESIGN-ADR-NONE-EXEMPTION-004 and consumes that result rather than
  duplicating regular expressions.
- Add deterministic regression coverage proving that a valid exemption
  satisfies completeness for a multi-component requirement while empty,
  placeholder, unknown, and unrecognized ADR fields remain rejected.
- Regenerate trace and quality evidence after the implementation.
- Resolve historical change diagnostics only through existing migration or
  audited waiver commands; do not edit append-only evidence by hand.
- Strictly verify the completed prior-session transcript using the existing
  sanitize/verify process. Treat that transcript only as evidence for the two
  observed `sdd-change` invocations; it does not prove or bind older workflow
  declarations.
- Downgrade remaining historical declaration-scoped workflow diagnostics only
  through explicit audited waivers. The waivers are governance evidence, not
  behavioral proof or substitutes for transcript verification.
- Prepare a new release approval only after every non-approval gate check
  passes.

## Verification

- Record fresh Red/Green evidence for the completeness regression.
- Run typecheck, build, complete tests, package checks, TDD validation, strict
  trace, Code Graph, changed gate, and status.
- Require `status.gate.ready=true` after recording the exact reviewed release
  artifact hash.

## Residual risks

- Historical chronology debt remains visible as audited waiver evidence rather
  than being rewritten.
- Strict verification of session
  `4f771808-0f67-4b4d-a436-a376d931cf25` retained six lifecycle events and two
  `sdd-change` invocations. The current reconciliation has zero declaration
  bindings; only two invocation-ledger sources are strict-verified, while the
  remaining historical sources are compatible-mode evidence.
- The final reconciliation added 89 non-expiring audited workflow waivers for
  historical declaration-scoped diagnostics. At the release candidate, 120 of
  127 declarations depend on audited waivers and the waiver ledger contains
  2,279 non-expiring entries. These waivers suppress governance errors but do
  not establish that the historical activities occurred.
- Historical `CHANGE_WAIVER_STALE` warnings remain visible where their
  conditions are false; they are non-blocking and were not rewritten or removed.
- The gate and generated quality evidence are the same release-candidate
  snapshot, not independent corroborating runs.
- Before release approval, `APPROVAL_STALE` is expected and
  `status.gate.ready` remains false. Readiness must be demonstrated by rerunning
  gate and status after recording the exact reviewed release artifact hash.
