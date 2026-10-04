import { describe, expect, it } from 'vitest';
import { validateDesign } from '../packages/domain/src/index.js';
import { readText, recordChangePhase, validateChangeCompleteness, writeText } from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

const base = (adrs: string): string =>
  `## DES-EXAMPLE-001: Example\nResponsibilities: Delegates to DES-OTHER-001.\nInterfaces: none exposed.\nConstraints: none.\nRequirements: REQ-EXAMPLE-001\nADRs: ${adrs}\n`;

const context = { requirementIds: new Set(['REQ-EXAMPLE-001']), adrIds: new Set(['ADR-0001']), designIds: new Set(['DES-OTHER-001']) };

describe('design ADR none-exemption', () => {
  /** @id TEST-DESIGN-ADR-NONE-EXEMPTION-001
   * @verifies REQ-DESIGN-ADR-NONE-EXEMPTION-001
   */
  it('TEST-DESIGN-ADR-NONE-EXEMPTION-001 accepts a none marker with a concrete reason', () => {
    const report = validateDesign(base('none — this component only forwards calls to DES-OTHER-001, which already documents the routing decision'), 'design.md', context);
    expect(report.diagnostics.map((d) => d.code)).not.toContain('DES_ADR');
    expect(report.value[0]?.decisions).toEqual([]);
  });

  /** @id TEST-DESIGN-ADR-NONE-EXEMPTION-002
   * @verifies REQ-DESIGN-ADR-NONE-EXEMPTION-002
   */
  it('TEST-DESIGN-ADR-NONE-EXEMPTION-002 rejects a none marker with no reason or a placeholder reason', () => {
    const bare = validateDesign(base('none'), 'design.md', context);
    expect(bare.diagnostics.map((d) => d.code)).toContain('DES_ADR_EXEMPTION_REASON');
    expect(bare.diagnostics.map((d) => d.code)).not.toContain('DES_ADR');

    const placeholder = validateDesign(base('none — TBD'), 'design.md', context);
    expect(placeholder.diagnostics.map((d) => d.code)).toContain('DES_ADR_EXEMPTION_REASON');
  });

  /** @id TEST-DESIGN-ADR-NONE-EXEMPTION-003
   * @verifies REQ-DESIGN-ADR-NONE-EXEMPTION-003
   */
  it('TEST-DESIGN-ADR-NONE-EXEMPTION-003 keeps requiring a real ADR or exemption for every other case', () => {
    const empty = validateDesign(base(''), 'design.md', context);
    expect(empty.diagnostics.map((d) => d.code)).toContain('DES_ADR');

    const unknown = validateDesign(base('ADR-9999'), 'design.md', context);
    expect(unknown.diagnostics.map((d) => d.code)).toContain('DES_ADR_LINK');

    const valid = validateDesign(base('ADR-0001'), 'design.md', context);
    expect(valid.diagnostics.map((d) => d.code)).not.toContain('DES_ADR');
    expect(valid.diagnostics.map((d) => d.code)).not.toContain('DES_ADR_EXEMPTION_REASON');
  });

  /** @id TEST-DESIGN-ADR-NONE-EXEMPTION-004
   * @verifies REQ-DESIGN-ADR-NONE-EXEMPTION-004
   */
  it('TEST-DESIGN-ADR-NONE-EXEMPTION-004 propagates the none exemption into the change-completeness gate', async () => {
    const root = await project();
    await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
    await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
    const design = await readText(root, '.musubix/features/example/design.md');

    // A valid "none — <reason>" exemption satisfies the ADR obligation without a real ADR edge.
    await writeText(root, '.musubix/features/example/design.md',
      design.replace('ADRs: ADR-0001', 'ADRs: none — this component only forwards to an already-decided component'));
    expect((await validateChangeCompleteness(root)).diagnostics)
      .not.toContainEqual(expect.objectContaining({ code: 'CHANGE_COMPLETENESS_ADR' }));

    // An invalid "none" exemption (no concrete reason) still fails, exactly as before this change.
    await writeText(root, '.musubix/features/example/design.md', design.replace('ADRs: ADR-0001', 'ADRs: none'));
    expect((await validateChangeCompleteness(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_COMPLETENESS_ADR' }));

    // A real ADR reference still passes exactly as before this change (unaffected regression check).
    await writeText(root, '.musubix/features/example/design.md', design);
    expect((await validateChangeCompleteness(root)).diagnostics)
      .not.toContainEqual(expect.objectContaining({ code: 'CHANGE_COMPLETENESS_ADR' }));

    // An unknown ADR reference (no real edge, no exemption) still fails, exactly as before this change.
    await writeText(root, '.musubix/features/example/design.md', design.replace('ADR-0001', 'ADR-9999'));
    expect((await validateChangeCompleteness(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_COMPLETENESS_ADR' }));

    // When the requirement is satisfied by two components and only one is validly exempt
    // (the other has no real ADR edge and no valid exemption), the requirement still fails:
    // every satisfying component must be linked or exempt, not merely one of them.
    await writeText(root, '.musubix/features/example/design.md', `${design.replace('ADRs: ADR-0001', 'ADRs: none — this component only forwards to an already-decided component')}
## DES-EXAMPLE-002: Secondary readiness component
Responsibilities: Aggregate explicit secondary readiness evidence without inventing success.
Interfaces: reportSecondaryReadiness() returns pass, fail, or skipped evidence.
Constraints: Missing required evidence cannot count as success.
Requirements: REQ-EXAMPLE-001
ADRs: none
Depends-On: none
`);
    expect((await validateChangeCompleteness(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_COMPLETENESS_ADR' }));

    await writeText(root, '.musubix/features/example/design.md', design);
  });
});
