---
schemaVersion: 1
feature: design-adr-none-exemption
---
# Explicit "no ADR needed" exemption for design components design

## DES-DESIGN-ADR-NONE-EXEMPTION-001: Recognize and validate an explicit "none — <reason>" ADRs marker
Responsibilities: In `validateDesign()` (`packages/domain/src/design.ts`), after computing a component's `decisions` list via `references(field(s.body, 'ADRs|ADR|決定'), 'ADR')`, also inspect the raw `ADRs` field text captured by `field()` for the exemption marker: the text trimmed matches `/^none(?:\s*[-–—:]\s*(.*))?$/i` (case-insensitive, allowing a hyphen, en dash, em dash or colon separator). When the marker matches and the captured reason (trimmed) is non-empty and is not a placeholder (`TODO`, `TBD`, `N/A`, `未定`, case-insensitive, matched as the whole trimmed reason), treat the component as exempt: skip the existing `DES_ADR` check for that component even though `decisions` is empty. When the marker matches but the reason is missing or is a placeholder, push a new `DES_ADR_EXEMPTION_REASON` diagnostic instead of `DES_ADR`.
Interfaces: `validateDesign(text: string, path?: string, context?: DesignContext): Validation<Component[]>` (exported signature unchanged). New diagnostic code `DES_ADR_EXEMPTION_REASON`. `Component.decisions` remains `string[]` and stays empty (`[]`) for an exempt component; no new field is added to `Component`.
Constraints: Must not change behavior for any component whose `ADRs` field already contains at least one recognized `ADR-*` reference (the existing `DES_ADR`/`DES_ADR_LINK` checks and their diagnostics are unaffected). Must not accept `none` as a value that also contains an `ADR-*` reference elsewhere in the same field (mixing the exemption marker with a real ADR reference is not a supported pattern; if `references()` finds at least one `ADR-*` id, the exemption marker is ignored and existing behavior applies unchanged). Must reject an entirely empty `ADRs` field exactly as before (`DES_ADR`), since an empty field does not match the `none` marker pattern.
Requirements: REQ-DESIGN-ADR-NONE-EXEMPTION-001 REQ-DESIGN-ADR-NONE-EXEMPTION-002 REQ-DESIGN-ADR-NONE-EXEMPTION-003
ADRs: ADR-0017
