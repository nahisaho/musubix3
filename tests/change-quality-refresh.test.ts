import { expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { project } from './helpers.js';
import { recordTddGreen, recordTddRed } from './helpers.js';

type QualityRefreshApi = {
  recoverQualityRefresh(root: string): Promise<{
    recovered: boolean;
    action: 'nothing-to-recover' | 'rolled-back' | 'rolled-forward';
  }>;
};

const qualityRefreshApi = analysis as unknown as QualityRefreshApi;
const requirements = ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002'];

async function addSecondRequirement(root: string): Promise<void> {
  await analysis.writeText(root, '.musubix/features/example/requirements.md',
    `${await analysis.readText(root, '.musubix/features/example/requirements.md')}
## REQ-EXAMPLE-002: Secondary readiness
Priority: must
Statement: The system shall report secondary readiness.
`);
  await analysis.writeText(root, '.musubix/features/example/design.md',
    `${await analysis.readText(root, '.musubix/features/example/design.md')}
## DES-EXAMPLE-002: Secondary readiness
Responsibilities: Report secondary readiness.
Interfaces: secondaryReadiness() returns a boolean.
Constraints: The result is deterministic.
Requirements: REQ-EXAMPLE-002
ADRs: ADR-0001
Depends-On: none
`);
  await analysis.writeText(root, 'src/second.ts', `/** @id CODE-EXAMPLE-002
 * @implements REQ-EXAMPLE-002
 * @design DES-EXAMPLE-002
 */
export function secondaryReadiness() { return true; }
`);
  await analysis.writeText(root, 'src/second.test.ts', `/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-002
 */
export function testSecondaryReadiness() { return true; }
`);
}

async function stageInitialQuality(root: string): Promise<void> {
  await addSecondRequirement(root);
  await analysis.writeText(root, '.musubix/changes/CHANGE-0001.md',
    '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'impact', requirements);
  await analysis.writeText(root, '.musubix/features/example/requirements.md',
    `${await analysis.readText(root, '.musubix/features/example/requirements.md')}\nAcceptance: Both readiness checks are required.\n`);
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'requirements', requirements);
  await analysis.writeText(root, '.musubix/features/example/design.md',
    `${await analysis.readText(root, '.musubix/features/example/design.md')}\nConstraints: Both components are quality-gated.\n`);
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'design', requirements);
  await analysis.writeText(root, 'src/service.test.ts',
    `${await analysis.readText(root, 'src/service.test.ts')}\n// initial quality red\n`);
  await analysis.writeText(root, 'src/second.test.ts',
    `${await analysis.readText(root, 'src/second.test.ts')}\n// initial quality red\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddRed(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'red', requirements);
  await analysis.writeText(root, 'src/service.ts',
    `${await analysis.readText(root, 'src/service.ts')}\n// initial quality implementation\n`);
  await analysis.writeText(root, 'src/second.ts',
    `${await analysis.readText(root, 'src/second.ts')}\n// initial quality implementation\n`);
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'implementation', requirements);
  await recordTddGreen(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddGreen(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'green', requirements);
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'quality', requirements);
}

async function stageCorrectiveBatches(root: string): Promise<void> {
  for (const [index, requirementId] of requirements.entries()) {
    const testPath = index === 0 ? 'src/service.test.ts' : 'src/second.test.ts';
    const sourcePath = index === 0 ? 'src/service.ts' : 'src/second.ts';
    await analysis.writeText(root, testPath,
      `${await analysis.readText(root, testPath)}\n// corrective ${requirementId} red\n`);
    await recordTddRed(root, index === 0 ? 'TEST-EXAMPLE-001' : 'TEST-EXAMPLE-002', requirementId);
    await analysis.recordChangePhase(root, 'CHANGE-0001', 'red', [requirementId]);
    await analysis.writeText(root, sourcePath,
      `${await analysis.readText(root, sourcePath)}\n// corrective ${requirementId} implementation\n`);
    await analysis.recordChangePhase(root, 'CHANGE-0001', 'implementation', [requirementId]);
    await recordTddGreen(root, index === 0 ? 'TEST-EXAMPLE-001' : 'TEST-EXAMPLE-002', requirementId);
    await analysis.recordChangePhase(root, 'CHANGE-0001', 'green', [requirementId]);
  }
}

/** @id TEST-CHANGE-QUALITY-REFRESH-001
 * @verifies REQ-CHANGE-QUALITY-REFRESH-001
 */
it('TEST-CHANGE-QUALITY-REFRESH-001 appends a current Quality checkpoint and retains immutable history', async () => {
  const root = await project();
  await stageInitialQuality(root);
  const before = await analysis.loadChangeEvidence(root);
  await stageCorrectiveBatches(root);

  const refreshed = await analysis.recordChangePhase(root, 'CHANGE-0001', 'quality', requirements);
  const change = refreshed.changes[0]!;

  expect(refreshed.schemaVersion).toBe(2);
  expect(change.qualityHistory).toEqual([before!.changes[0]!.phases.quality]);
  expect(change.phases.quality!.order).toBeGreaterThan(change.qualityHistory![0]!.order!);
  await expect(analysis.validateChangeEvidence(root)).resolves.toMatchObject({ valid: true });
});

/** @id TEST-CHANGE-QUALITY-REFRESH-002
 * @verifies REQ-CHANGE-QUALITY-REFRESH-002
 */
it('TEST-CHANGE-QUALITY-REFRESH-002 rejects unnecessary refreshes and projects dry-run without reserving order', async () => {
  const root = await project();
  await stageInitialQuality(root);
  await stageCorrectiveBatches(root);
  await analysis.recordChangePhase(root, 'CHANGE-0001', 'quality', requirements);
  const orderBefore = await analysis.readText(root, '.musubix/evidence/order.json');
  const changesBefore = await analysis.readText(root, '.musubix/evidence/changes.json');

  await expect(analysis.recordChangePhase(root, 'CHANGE-0001', 'quality', requirements))
    .rejects.toThrow('CHANGE_QUALITY_REFRESH_NOT_NEEDED');
  await expect(analysis.recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001'], { dryRun: true }))
    .rejects.toThrow(/same requirement IDs/i);
  expect(await analysis.readText(root, '.musubix/evidence/order.json')).toBe(orderBefore);
  expect(await analysis.readText(root, '.musubix/evidence/changes.json')).toBe(changesBefore);
});

/** @id TEST-CHANGE-QUALITY-REFRESH-003
 * @verifies REQ-CHANGE-QUALITY-REFRESH-003
 */
it('TEST-CHANGE-QUALITY-REFRESH-003 validates versioned lineage and exposes deterministic recovery', async () => {
  const root = await project();
  await stageInitialQuality(root);
  const evidence = (await analysis.loadChangeEvidence(root))!;
  const change = evidence.changes[0]!;
  await analysis.writeJson(root, '.musubix/evidence/changes.json', {
    schemaVersion: 2,
    changes: [{
      ...change,
      qualityHistory: [change.phases.quality],
    }],
  });

  const validation = await analysis.validateChangeEvidence(root);
  expect(validation.diagnostics).toContainEqual(expect.objectContaining({
    code: 'CHANGE_QUALITY_HISTORY_MALFORMED',
  }));
  await expect(qualityRefreshApi.recoverQualityRefresh(root))
    .resolves.toEqual({ recovered: false, action: 'nothing-to-recover' });
});
