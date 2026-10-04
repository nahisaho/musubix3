# CHANGE-0041: Recognize the ADR "none" exemption in the change-completeness gate

Requirements: REQ-DESIGN-ADR-NONE-EXEMPTION-004

## Summary
`design validate` accepts a design component's `ADRs` field value of
`none — <concrete reason>` as satisfying the ADR-evidence obligation
(REQ-DESIGN-ADR-NONE-EXEMPTION-001/002/003). The `change-completeness` gate
check (`CHANGE_COMPLETENESS_ADR`) was never updated to recognize this
exemption, requiring a real `decides` trace edge from an ADR node instead.
This blocks any change whose design legitimately uses the "none" exemption
(e.g. CHANGE-0039 / GitHub Issue #50) from ever passing the completeness
gate. This change adds `Component.adrExempt` and extends the gate's `hasAdr`
computation to accept the exemption, without weakening the existing
real-ADR-edge path. See GitHub Issue #52.

Note: an earlier attempt used id CHANGE-0040 but its `impact` phase was
mistakenly recorded against already-edited requirements/design content; that
record was removed from `.musubix/evidence/changes.json` (a stray
order-log entry for CHANGE-0040 may remain as an audit artifact) and the
work continues here under CHANGE-0041 with a correctly pre-edit impact
baseline.
