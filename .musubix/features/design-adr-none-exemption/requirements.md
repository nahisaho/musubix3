---
schemaVersion: 1
feature: design-adr-none-exemption
---
# Explicit "no ADR needed" exemption for design components

Source: GitHub Issue #5, found during a real multi-language trial project
against musubix3@0.1.11. `design validate` requires every `DES-*` component
to reference at least one ADR (`DES_ADR`). Some components genuinely have no
architecturally significant decision to record (e.g. a thin pass-through
component whose only responsibility is delegating to an already-decided
component), and today the only way to pass validation is to fabricate a
low-value ADR just to satisfy the check, which pollutes the decision log with
non-decisions instead of increasing traceability. Writing `ADRs: none` is
rejected identically to omitting the field entirely, so there is no
lightweight, explicit way to record and justify the exemption.

## REQ-DESIGN-ADR-NONE-EXEMPTION-001: Accept an explicit ADR exemption with a reason
Priority: must
Type: functional
Pattern: event-driven
Statement: When a design component's ADRs field is the literal word "none" followed by a dash and a non-empty reason, the system shall accept that component as satisfying the ADR requirement without an ADR reference.
Acceptance: Given a `DES-*` component whose `ADRs` field is `none — this component only forwards calls to DES-FOO-001, which already documents the routing decision`, `design validate` reports no `DES_ADR` diagnostic for that component.

## REQ-DESIGN-ADR-NONE-EXEMPTION-002: Reject a "none" exemption without a concrete reason
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a design component's ADRs field is the literal word "none" with no reason, or with only a placeholder reason such as TODO, TBD, N/A or 未定, then the system shall reject that component with a diagnostic stating that an ADR exemption requires a concrete reason.
Acceptance: Given a `DES-*` component whose `ADRs` field is exactly `none`, `design validate` reports a diagnostic naming that component and requiring a concrete exemption reason. Given a component whose `ADRs` field is `none — TBD`, `design validate` reports the same diagnostic.

## REQ-DESIGN-ADR-NONE-EXEMPTION-003: Preserve the existing requirement outside the exemption
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall continue to require every design component to reference at least one valid ADR or declare a valid "none" exemption, rejecting a component whose ADRs field is empty, unrecognized, or references only unknown/invalid ADR IDs.
Acceptance: Given a `DES-*` component with an empty `ADRs` field, `design validate` still reports `DES_ADR` exactly as before this change. Given a component whose `ADRs` field references only an ADR ID absent from the known ADR set, `design validate` still reports `DES_ADR_LINK` exactly as before this change.
