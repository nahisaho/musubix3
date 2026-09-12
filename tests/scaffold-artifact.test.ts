import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateDesign, validateRequirements } from '../packages/domain/src/index.js';
import { exists, readText, scaffoldDesign, scaffoldRequirements } from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

describe('scaffold-artifact', () => {
  /** @id TEST-REQUIREMENTS-DESIGN-SCAFFOLD-001
   * @verifies REQ-REQUIREMENTS-DESIGN-SCAFFOLD-001
   */
  it('TEST-REQUIREMENTS-DESIGN-SCAFFOLD-001 scaffolds a valid requirements.md placeholder', async () => {
    const root = await fixture();
    const path = await scaffoldRequirements(root, 'my-feature');
    expect(path).toBe('.musubix/features/my-feature/requirements.md');
    expect(await exists(resolve(root, path))).toBe(true);
    const content = await readText(root, path);
    const report = validateRequirements(content, path);
    expect(report.valid).toBe(true);
    expect(report.value).toHaveLength(1);
    expect(report.value[0]).toMatchObject({ id: 'REQ-MY-FEATURE-001', priority: 'must', type: 'functional', pattern: 'ubiquitous' });
    expect(report.value[0]?.statement).toContain('TODO:');
    expect(report.value[0]?.acceptance).toMatch(/^TODO:/);
  });

  /** @id TEST-REQUIREMENTS-DESIGN-SCAFFOLD-002
   * @verifies REQ-REQUIREMENTS-DESIGN-SCAFFOLD-002
   */
  it('TEST-REQUIREMENTS-DESIGN-SCAFFOLD-002 refuses to overwrite an existing requirements.md', async () => {
    const root = await fixture();
    await scaffoldRequirements(root, 'my-feature');
    const before = await readText(root, '.musubix/features/my-feature/requirements.md');
    await expect(scaffoldRequirements(root, 'my-feature')).rejects.toThrow('Refusing to overwrite existing file: .musubix/features/my-feature/requirements.md');
    expect(await readText(root, '.musubix/features/my-feature/requirements.md')).toBe(before);
  });

  /** @id TEST-REQUIREMENTS-DESIGN-SCAFFOLD-003
   * @verifies REQ-REQUIREMENTS-DESIGN-SCAFFOLD-003
   */
  it('TEST-REQUIREMENTS-DESIGN-SCAFFOLD-003 scaffolds a valid design.md placeholder linked to the matching requirement', async () => {
    const root = await fixture();
    await scaffoldRequirements(root, 'my-feature');
    const path = await scaffoldDesign(root, 'my-feature');
    expect(path).toBe('.musubix/features/my-feature/design.md');
    const content = await readText(root, path);
    const report = validateDesign(content, path, { requirementIds: new Set(['REQ-MY-FEATURE-001']) });
    expect(report.valid).toBe(true);
    expect(report.value).toHaveLength(1);
    expect(report.value[0]).toMatchObject({ id: 'DES-MY-FEATURE-001' });
    expect(report.value[0]?.requirements).toContain('REQ-MY-FEATURE-001');
  });

  /** @id TEST-REQUIREMENTS-DESIGN-SCAFFOLD-004
   * @verifies REQ-REQUIREMENTS-DESIGN-SCAFFOLD-004
   */
  it('TEST-REQUIREMENTS-DESIGN-SCAFFOLD-004 refuses to overwrite an existing design.md', async () => {
    const root = await fixture();
    await scaffoldRequirements(root, 'my-feature');
    await scaffoldDesign(root, 'my-feature');
    const before = await readText(root, '.musubix/features/my-feature/design.md');
    await expect(scaffoldDesign(root, 'my-feature')).rejects.toThrow('Refusing to overwrite existing file: .musubix/features/my-feature/design.md');
    expect(await readText(root, '.musubix/features/my-feature/design.md')).toBe(before);
  });

  /** @id TEST-REQUIREMENTS-DESIGN-SCAFFOLD-005
   * @verifies REQ-REQUIREMENTS-DESIGN-SCAFFOLD-005
   */
  it('TEST-REQUIREMENTS-DESIGN-SCAFFOLD-005 rejects unsafe or malformed slugs for both commands without touching the filesystem', async () => {
    const root = await fixture();
    await expect(scaffoldRequirements(root, '../../escape')).rejects.toThrow('Invalid feature slug "../../escape"');
    await expect(scaffoldRequirements(root, 'Foo_Bar')).rejects.toThrow('Invalid feature slug "Foo_Bar"');
    await expect(scaffoldDesign(root, '../../escape')).rejects.toThrow('Invalid feature slug "../../escape"');
    expect(await exists(resolve(root, '.musubix'))).toBe(false);
  });

  /** @id TEST-REQUIREMENTS-DESIGN-SCAFFOLD-006
   * @verifies REQ-REQUIREMENTS-DESIGN-SCAFFOLD-006
   */
  it('TEST-REQUIREMENTS-DESIGN-SCAFFOLD-006 uses a custom title and rejects invalid title values', async () => {
    const root = await fixture();
    const path = await scaffoldRequirements(root, 'my-feature', { title: 'Report readiness' });
    const content = await readText(root, path);
    expect(content).toContain('## REQ-MY-FEATURE-001: Report readiness');
    const other = await fixture();
    await expect(scaffoldRequirements(other, 'my-feature', { title: '  ' })).rejects.toThrow('Invalid --title');
    await expect(scaffoldRequirements(other, 'my-feature', { title: 'line1\nline2' })).rejects.toThrow('Invalid --title');
    expect(await exists(resolve(other, '.musubix/features/my-feature/requirements.md'))).toBe(false);
  });
});
