import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exists, readText } from '../packages/analysis/src/index.js';
import { skillNames, upgradeSkills } from '../packages/cli/src/install.js';
import { fixture, repository } from './helpers.js';

// @id CODE-UPGRADE-WORKFLOW-TESTS
describe('upgradeSkills', () => {
  /** @id TEST-UPGRADE-WORKFLOW-001
   * @verifies REQ-UPGRADE-WORKFLOW-001
   */
  it('TEST-UPGRADE-WORKFLOW-001 replaces only stale bundled skill files and leaves user-owned artifacts untouched', async () => {
    const root = await fixture({
      '.github/skills/sdd-change/SKILL.md': 'stale content',
      '.musubix/config.json': '{"custom":true}',
      '.musubix/policy-baseline.json': '{"custom":true}',
      '.musubix/constitution.md': '# my constitution',
      '.musubix/features/example/requirements.md': 'custom requirements',
      '.musubix/features/example/design.md': 'custom design',
    });
    const report = await upgradeSkills(root, repository);
    expect(report.dryRun).toBe(false);
    const changeAction = report.actions.find((a) => a.path === '.github/skills/sdd-change/SKILL.md');
    expect(changeAction?.action).toBe('replace');
    expect(await readText(root, '.github/skills/sdd-change/SKILL.md')).toBe(
      await readText(repository, '.github/skills/sdd-change/SKILL.md'),
    );
    // Every bundled skill directory is present and matches the package copy.
    for (const name of skillNames) {
      const path = `.github/skills/${name}/SKILL.md`;
      expect(await readText(root, path)).toBe(await readText(repository, path));
    }
    // User-owned artifacts must never be created/replaced/deleted by upgrade.
    expect(await readText(root, '.musubix/config.json')).toBe('{"custom":true}');
    expect(await readText(root, '.musubix/policy-baseline.json')).toBe('{"custom":true}');
    expect(await readText(root, '.musubix/constitution.md')).toBe('# my constitution');
    expect(await readText(root, '.musubix/features/example/requirements.md')).toBe('custom requirements');
    expect(await readText(root, '.musubix/features/example/design.md')).toBe('custom design');
    expect(await exists(resolve(root, '.musubix/decisions'))).toBe(false);

    // Re-running reports every bundled skill file as unchanged.
    const again = await upgradeSkills(root, repository);
    expect(again.actions.every((a) => a.action === 'unchanged')).toBe(true);
  });

  /** @id TEST-UPGRADE-WORKFLOW-002
   * @verifies REQ-UPGRADE-WORKFLOW-002
   */
  it('TEST-UPGRADE-WORKFLOW-002 dry-run reports planned replace without writing', async () => {
    const root = await fixture({
      '.github/skills/sdd-quality/SKILL.md': 'stale quality skill',
    });
    const report = await upgradeSkills(root, repository, { dryRun: true });
    expect(report.dryRun).toBe(true);
    const action = report.actions.find((a) => a.path === '.github/skills/sdd-quality/SKILL.md');
    expect(action?.action).toBe('replace');
    expect(await readText(root, '.github/skills/sdd-quality/SKILL.md')).toBe('stale quality skill');
  });
});
