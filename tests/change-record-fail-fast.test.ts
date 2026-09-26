import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  appendEvidenceOrder, loadChangeEvidence, readText, recordChangePhase, runProcess, runTddPhase,
  validateChangeEvidence, voidTddCycle, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { code, project, recordTddRed, tddResultRunner, testCode } from './helpers.js';

async function addSecondRequirement(root: string): Promise<void> {
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}
## REQ-EXAMPLE-002: Report secondary readiness
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report its secondary readiness.
Acceptance: A test checks the reported secondary readiness against the configured checks.
`);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}
## DES-EXAMPLE-002: Secondary readiness component
Responsibilities: Aggregate explicit secondary readiness evidence without inventing success.
Interfaces: reportSecondaryReadiness() returns pass, fail, or skipped evidence.
Constraints: Missing required evidence cannot count as success.
Requirements: REQ-EXAMPLE-002
ADRs: ADR-0001
Depends-On: none
`);
  await writeText(root, 'src/second.ts', `/** @id CODE-EXAMPLE-002
 * @implements REQ-EXAMPLE-002
 * @design DES-EXAMPLE-002
 */
export function secondaryReadiness() { return true; }
`);
  await writeText(root, 'src/second.test.ts', `import { secondaryReadiness } from './second.js';
/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-002
 */
export function testSecondaryReadiness() { if (!secondaryReadiness()) throw new Error('not ready'); }
`);
}

async function snapshotEvidence(root: string): Promise<{ changes: string; order: string }> {
  return {
    changes: await readText(root, '.musubix/evidence/changes.json'),
    order: await readText(root, '.musubix/evidence/order.json'),
  };
}

async function prepareMultiRequirementChange(root: string): Promise<void> {
  await addSecondRequirement(root);
  await writeText(root, '.musubix/changes/CHANGE-0001.md',
    '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
}

async function appendPersistedFullSetPhase(
  root: string,
  phase: 'red' | 'implementation',
): Promise<void> {
  const evidence = await loadChangeEvidence(root);
  const change = evidence?.changes.find((entry) => entry.changeId === 'CHANGE-0001');
  if (!evidence || !change) throw new Error('Expected the staged change fixture.');
  const baseline = phase === 'red' ? change.phases.design : change.phases.red;
  if (!baseline) throw new Error(`Expected the preceding phase for ${phase}.`);
  const order = await appendEvidenceOrder(root, { kind: 'change', entityId: change.changeId, phase });
  change.phases[phase] = {
    phase,
    order: order.sequence,
    recordedAt: new Date().toISOString(),
    fingerprints: structuredClone(baseline.fingerprints),
  };
  await writeJson(root, '.musubix/evidence/changes.json', evidence);
}

async function addThirdRequirement(root: string): Promise<void> {
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}
## REQ-EXAMPLE-003: Report tertiary readiness
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report its tertiary readiness.
Acceptance: A test checks the reported tertiary readiness against the configured checks.
`);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}
## DES-EXAMPLE-003: Tertiary readiness component
Responsibilities: Aggregate explicit tertiary readiness evidence without inventing success.
Interfaces: reportTertiaryReadiness() returns pass, fail, or skipped evidence.
Constraints: Missing required evidence cannot count as success.
Requirements: REQ-EXAMPLE-003
ADRs: ADR-0001
Depends-On: none
`);
  await writeText(root, 'src/third.ts', `/** @id CODE-EXAMPLE-003
 * @implements REQ-EXAMPLE-003
 * @design DES-EXAMPLE-003
 */
export function tertiaryReadiness() { return true; }
`);
  await writeText(root, 'src/third.test.ts', `import { tertiaryReadiness } from './third.js';
/** @id TEST-EXAMPLE-003
 * @verifies REQ-EXAMPLE-003
 */
export function testTertiaryReadiness() { if (!tertiaryReadiness()) throw new Error('not ready'); }
`);
}

/** @id TEST-CHANGE-RECORD-TDD-PREFLIGHT-001
 * @verifies REQ-CHANGE-RECORD-TDD-PREFLIGHT-001
 */
it('TEST-CHANGE-RECORD-TDD-PREFLIGHT-001 rejects a multi-requirement Red append unless every requirement has eligible pending Red evidence', async () => {
  const root = await project();
  await prepareMultiRequirementChange(root);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior for requirement A\n`);
  await writeText(root, 'src/second.test.ts',
    `${await readText(root, 'src/second.test.ts')}\n// staged failing behavior for requirement B\n`);
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));

  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-002', 'REQ-EXAMPLE-001']))
    .rejects.toMatchObject({
      code: 'CHANGE_RED_TDD_PREFLIGHT_FAILED',
      phase: 'red',
      uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
    });
  expect(await snapshotEvidence(root)).toEqual(before);
});

/** @id TEST-CHANGE-RECORD-TDD-PREFLIGHT-002
 * @verifies REQ-CHANGE-RECORD-TDD-PREFLIGHT-002
 */
it('TEST-CHANGE-RECORD-TDD-PREFLIGHT-002 rejects Implementation when the persisted batch has bounded pending Red evidence for only its final requirement', async () => {
  const root = await project();
  await prepareMultiRequirementChange(root);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior for requirement A\n`);
  await writeText(root, 'src/second.test.ts',
    `${await readText(root, 'src/second.test.ts')}\n// staged failing behavior for requirement B\n`);
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await appendPersistedFullSetPhase(root, 'red');

  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  await writeText(root, 'src/second.ts',
    (await readText(root, 'src/second.ts')).replace('return true', 'return false'));
  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'implementation',
    ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002'])).rejects.toMatchObject({
    code: 'CHANGE_IMPLEMENTATION_TDD_PREFLIGHT_FAILED',
    phase: 'implementation',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
  });
  expect(await snapshotEvidence(root)).toEqual(before);
});

/** @id TEST-CHANGE-RECORD-TDD-PREFLIGHT-003
 * @verifies REQ-CHANGE-RECORD-TDD-PREFLIGHT-003
 */
it('TEST-CHANGE-RECORD-TDD-PREFLIGHT-003 rejects Green when only the final requirement has Green evidence after Implementation', async () => {
  const root = await project();
  await prepareMultiRequirementChange(root);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior for requirement A\n`);
  await writeText(root, 'src/second.test.ts',
    `${await readText(root, 'src/second.test.ts')}\n// staged failing behavior for requirement B\n`);
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await appendPersistedFullSetPhase(root, 'red');
  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  await writeText(root, 'src/second.ts',
    (await readText(root, 'src/second.ts')).replace('return true', 'return false'));
  await appendPersistedFullSetPhase(root, 'implementation');
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'passed'));

  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'green',
    ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002'])).rejects.toMatchObject({
    code: 'CHANGE_GREEN_TDD_PREFLIGHT_FAILED',
    phase: 'green',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
  });
  expect(await snapshotEvidence(root)).toEqual(before);
});

/** @id TEST-CHANGE-RECORD-TDD-PREFLIGHT-004
 * @verifies REQ-CHANGE-RECORD-TDD-PREFLIGHT-004
 */
it('TEST-CHANGE-RECORD-TDD-PREFLIGHT-004 returns deterministic structured CLI Red diagnostics with dry-run parity and no writes', async () => {
  const root = await project();
  await addSecondRequirement(root);
  await addThirdRequirement(root);
  const requirementIds = ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002', 'REQ-EXAMPLE-003'];
  await writeText(root, '.musubix/changes/CHANGE-0001.md',
    `# CHANGE-0001\nRequirements: ${requirementIds.join(' ')}\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'impact', requirementIds);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', requirementIds);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', requirementIds);
  await writeText(root, 'src/third.test.ts',
    `${await readText(root, 'src/third.test.ts')}\n// staged failing behavior for requirement C\n`);
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-003', 'REQ-EXAMPLE-003', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));

  const cli = resolve('dist/packages/cli/src/main.js');
  const args = [
    cli, 'change-record', 'CHANGE-0001', 'red',
    '--requirement', ...requirementIds,
    '--json',
  ];
  const before = await snapshotEvidence(root);
  const dryRun = await runProcess(process.execPath, [...args, '--dry-run'], { cwd: root, timeoutMs: 20_000 });
  const afterDryRun = await snapshotEvidence(root);
  const recorded = await runProcess(process.execPath, args, { cwd: root, timeoutMs: 20_000 });
  const afterRecorded = await snapshotEvidence(root);

  expect(dryRun.exitCode).toBe(2);
  expect(recorded.exitCode).toBe(2);
  const dryRunError = JSON.parse(dryRun.stdout).error;
  const recordedError = JSON.parse(recorded.stdout).error;
  expect(dryRunError).toEqual(recordedError);
  expect(recordedError).toMatchObject({
    code: 'CHANGE_RED_TDD_PREFLIGHT_FAILED',
    phase: 'red',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002'],
    rejections: [
      { requirementId: 'REQ-EXAMPLE-001', categories: expect.any(Array) },
      { requirementId: 'REQ-EXAMPLE-002', categories: expect.any(Array) },
    ],
  });
  expect(recordedError.rejections).toHaveLength(2);
  expect(recordedError.rejections.every((entry: { categories: unknown[] }) => entry.categories.length > 0)).toBe(true);
  expect(afterDryRun).toEqual(before);
  expect(afterRecorded).toEqual(before);
}, 30_000);

/** @id TEST-CHANGE-RECORD-TDD-PREFLIGHT-005
 * @verifies REQ-CHANGE-RECORD-TDD-PREFLIGHT-004
 * @design DES-CHANGE-RECORD-TDD-PREFLIGHT-004
 */
it('TEST-CHANGE-RECORD-TDD-PREFLIGHT-005 renders stable non-JSON recovery guidance without writes', async () => {
  const root = await project();
  await prepareMultiRequirementChange(root);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior for requirement A\n`);
  await writeText(root, 'src/second.test.ts',
    `${await readText(root, 'src/second.test.ts')}\n// staged failing behavior for requirement B\n`);
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));

  const before = await snapshotEvidence(root);
  const cli = resolve('dist/packages/cli/src/main.js');
  const result = await runProcess(process.execPath, [
    cli, 'change-record', 'CHANGE-0001', 'red',
    '--requirement', 'REQ-EXAMPLE-001', 'REQ-EXAMPLE-002',
  ], { cwd: root, timeoutMs: 20_000 });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toMatch(/^musubix3: CHANGE_RED_TDD_PREFLIGHT_FAILED:/);
  expect(result.stderr).toContain('REQ-EXAMPLE-001');
  expect(result.stderr).toContain('tdd red -> change-record red');
  expect(await snapshotEvidence(root)).toEqual(before);
}, 30_000);

/** @id TEST-CHANGE-RECORD-FAIL-FAST-001
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-001 REQ-CHANGE-RECORD-FAIL-FAST-006
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-001 rejects an unchanged requirements phase at record time, leaving evidence untouched', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);

  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD/);
  const after = await snapshotEvidence(root);
  expect(after).toEqual(before);

  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  const evidence = await loadChangeEvidence(root);
  expect(evidence?.changes[0]?.phases.requirements).toBeDefined();
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-002
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-002 REQ-CHANGE-RECORD-FAIL-FAST-006
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-002 rejects an unchanged design phase at record time, leaving evidence untouched', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);

  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/CHANGE_DESIGN_UNCHANGED_AT_RECORD/);
  const after = await snapshotEvidence(root);
  expect(after).toEqual(before);

  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);
  const evidence = await loadChangeEvidence(root);
  expect(evidence?.changes[0]?.phases.design).toBeDefined();
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-003
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-003 REQ-CHANGE-RECORD-FAIL-FAST-006
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-003 rejects an unchanged tests fingerprint at Red record time, leaving evidence untouched', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);

  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/CHANGE_TESTS_UNCHANGED_AT_RECORD/);
  const after = await snapshotEvidence(root);
  expect(after).toEqual(before);

  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  const evidence = await loadChangeEvidence(root);
  expect(evidence?.changes[0]?.phases.red).toBeDefined();
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-004
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-004 REQ-CHANGE-RECORD-FAIL-FAST-006
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-004 rejects an unchanged implementation fingerprint at Implementation record time, leaving evidence untouched', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);

  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/CHANGE_IMPLEMENTATION_UNCHANGED_AT_RECORD/);
  const after = await snapshotEvidence(root);
  expect(after).toEqual(before);

  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
  const evidence = await loadChangeEvidence(root);
  expect(evidence?.changes[0]?.phases.implementation).toBeDefined();
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-005
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-005 REQ-CHANGE-RECORD-FAIL-FAST-006
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-005 rejects an unchanged per-requirement relevant-implementation fingerprint, naming the unchanged requirement', async () => {
  const root = await project();
  await addSecondRequirement(root);
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// batch staged failing behavior\n`);
  await writeText(root, 'src/second.test.ts', `${await readText(root, 'src/second.test.ts')}\n// batch staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddRed(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);

  // Only REQ-EXAMPLE-001's implementation changes; REQ-EXAMPLE-002's is untouched.
  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  const before = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']))
    .rejects.toThrow(/CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED_AT_RECORD.*REQ-EXAMPLE-002/);
  const after = await snapshotEvidence(root);
  expect(after).toEqual(before);

  await writeText(root, 'src/second.ts', (await readText(root, 'src/second.ts')).replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-011
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-006
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-011 leaves both changes.json and order.json byte-identical across every rejection kind, including the evidence-order sequence', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);

  // Each of the five fail-fast rejection kinds must consume no evidence-order
  // sequence number, so a chain of rejected attempts leaves order.json (not
  // just changes.json) exactly as it was before the very first attempt.
  const initial = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD/);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001'], { dryRun: true }))
    .rejects.toThrow(/CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD/);
  expect(await snapshotEvidence(root)).toEqual(initial);

  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  const afterRequirements = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/CHANGE_DESIGN_UNCHANGED_AT_RECORD/);
  expect(await snapshotEvidence(root)).toEqual(afterRequirements);
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-006
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-007
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-006 allows an explicitly overridden unchanged requirements phase and persists the marker', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);

  await expect(recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD/);

  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001'], { allowUnchanged: true });
  const evidence = await loadChangeEvidence(root);
  expect(evidence?.changes[0]?.phases.requirements?.allowUnchanged).toBe(true);
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-007
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-008
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-007 suppresses only CHANGE_REQUIREMENTS_UNCHANGED for a marked override, not the other unchanged diagnostics', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001'], { allowUnchanged: true });

  const marked = await validateChangeEvidence(root);
  expect(marked.diagnostics.some((d) => d.code === 'CHANGE_REQUIREMENTS_UNCHANGED')).toBe(false);

  // Directly simulate historical evidence (predating this feature, so it
  // could never have been fail-fast-rejected) whose design phase is
  // unchanged and unmarked, mirroring this codebase's existing convention
  // of constructing historical evidence states directly for validation
  // tests (see tests/tdd-fingerprint-migration.test.ts).
  const raw = JSON.parse(await readText(root, '.musubix/evidence/changes.json'));
  const change = raw.changes[0];
  change.phases.design = { ...change.phases.requirements, phase: 'design', order: change.phases.requirements.order + 1000 };
  await writeJson(root, '.musubix/evidence/changes.json', raw);

  const withUnmarkedDesign = await validateChangeEvidence(root);
  expect(withUnmarkedDesign.diagnostics.some((d) => d.code === 'CHANGE_REQUIREMENTS_UNCHANGED')).toBe(false);
  expect(withUnmarkedDesign.diagnostics.some((d) => d.code === 'CHANGE_DESIGN_UNCHANGED')).toBe(true);
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-008
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-009
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-008 previews a phase recording with --dry-run without persisting it, in both outcomes', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);

  const beforeRejected = await snapshotEvidence(root);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001'], { dryRun: true }))
    .rejects.toThrow(/CHANGE_REQUIREMENTS_UNCHANGED_AT_RECORD/);
  expect(await snapshotEvidence(root)).toEqual(beforeRejected);

  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  const beforeSuccess = await snapshotEvidence(root);
  const preview = await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001'], { dryRun: true });
  expect(preview.changes[0]?.phases.requirements).toBeDefined();
  expect(await snapshotEvidence(root)).toEqual(beforeSuccess);

  // A real (non-dry-run) call with the same arguments still succeeds and persists.
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  const evidence = await loadChangeEvidence(root);
  expect(evidence?.changes[0]?.phases.requirements).toBeDefined();
});

/** @id TEST-CHANGE-RECORD-FAIL-FAST-009
 * @verifies REQ-CHANGE-RECORD-FAIL-FAST-010
 */
it('TEST-CHANGE-RECORD-FAIL-FAST-009 documents the fail-fast rejection, --allow-unchanged, and --dry-run in --help', async () => {
  const root = await project();
  const cli = resolve('dist/packages/cli/src/main.js');
  const result = await runProcess(process.execPath, [cli, 'change-record', '--help'], {
    cwd: root,
    timeoutMs: 20_000,
  });
  expect(result.stdout).toMatch(/unchanged/i);
  expect(result.stdout).toContain('--allow-unchanged');
  expect(result.stdout).toContain('--dry-run');

  const readme = await readFile(resolve('README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('`change-record <CHANGE-ID>'));
  expect(section).toMatch(/unchanged/i);
  expect(section).toContain('--allow-unchanged');
  expect(section).toContain('--dry-run');
});

/** @id TEST-CHANGE-RECORD-TDD-PREFLIGHT-006
 * @verifies REQ-CHANGE-RECORD-TDD-PREFLIGHT-004
 * @design DES-CHANGE-RECORD-TDD-PREFLIGHT-004
 */
it('TEST-CHANGE-RECORD-TDD-PREFLIGHT-006 rejects high-risk persisted TDD states with canonical ordered diagnostics and no writes', async () => {
  type PreflightError = {
    code: string;
    phase: string;
    uncoveredRequirementIds: string[];
    rejections: Array<{
      requirementId: string;
      categories: Array<{ category: string; details: string[] }>;
    }>;
  };

  const rejectionFrom = async (operation: Promise<unknown>): Promise<PreflightError> => {
    try {
      await operation;
    } catch (error) {
      return error as PreflightError;
    }
    throw new Error('Expected change-record TDD preflight rejection.');
  };

  const missingOrderRoot = await project();
  await prepareMultiRequirementChange(missingOrderRoot);
  await writeText(missingOrderRoot, 'src/service.test.ts', `${testCode}\n// missing-order red\n`);
  await recordTddRed(missingOrderRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  const corruptedOrder = JSON.parse(await readText(missingOrderRoot, '.musubix/evidence/order.json'));
  const redOrderRecord = corruptedOrder.records.find((record: { kind: string; phase: string }) =>
    record.kind === 'tdd' && record.phase === 'red');
  if (!redOrderRecord) throw new Error('Expected persisted TDD Red order evidence.');
  redOrderRecord.entityId = 'CORRUPTED-CYCLE-LINK';
  await writeJson(missingOrderRoot, '.musubix/evidence/order.json', corruptedOrder);
  const missingOrderBefore = await snapshotEvidence(missingOrderRoot);
  const missingOrderError = await rejectionFrom(recordChangePhase(
    missingOrderRoot,
    'CHANGE-0001',
    'red',
    ['REQ-EXAMPLE-001'],
  ));
  expect(missingOrderError).toMatchObject({
    code: 'CHANGE_RED_TDD_PREFLIGHT_FAILED',
    phase: 'red',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
    rejections: [{
      requirementId: 'REQ-EXAMPLE-001',
      categories: [{ category: 'missing-order', details: expect.any(Array) }],
    }],
  });
  expect(missingOrderError.rejections[0]!.categories[0]!.details.length).toBeGreaterThan(0);
  expect(await snapshotEvidence(missingOrderRoot)).toEqual(missingOrderBefore);

  const wrongRequirementRoot = await project();
  await prepareMultiRequirementChange(wrongRequirementRoot);
  await writeText(wrongRequirementRoot, 'src/service.test.ts', `${testCode}\n// wrong-requirement red\n`);
  await recordTddRed(wrongRequirementRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  const wrongRequirementEvidence = JSON.parse(
    await readText(wrongRequirementRoot, '.musubix/evidence/tdd.json'),
  );
  wrongRequirementEvidence.cycles[0].requirementId = 'REQ-EXAMPLE-002';
  await writeJson(wrongRequirementRoot, '.musubix/evidence/tdd.json', wrongRequirementEvidence);
  const wrongRequirementBefore = await snapshotEvidence(wrongRequirementRoot);
  const wrongRequirementError = await rejectionFrom(recordChangePhase(
    wrongRequirementRoot,
    'CHANGE-0001',
    'red',
    ['REQ-EXAMPLE-001'],
  ));
  expect(wrongRequirementError).toMatchObject({
    code: 'CHANGE_RED_TDD_PREFLIGHT_FAILED',
    phase: 'red',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
    rejections: [{
      requirementId: 'REQ-EXAMPLE-001',
      categories: [{ category: 'wrong-requirement', details: expect.any(Array) }],
    }],
  });
  expect(wrongRequirementError.rejections[0]!.categories[0]!.details).toHaveLength(1);
  expect(await snapshotEvidence(wrongRequirementRoot)).toEqual(wrongRequirementBefore);

  const validlyVoidedRoot = await project();
  await prepareMultiRequirementChange(validlyVoidedRoot);
  await writeText(validlyVoidedRoot, 'src/service.test.ts', `${testCode}\n// fallback cycle red\n`);
  await recordTddRed(validlyVoidedRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await writeText(validlyVoidedRoot, 'src/service.ts', `${code}\n// fallback cycle implementation\n`);
  await runTddPhase(validlyVoidedRoot, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(validlyVoidedRoot, 'passed'));
  await writeText(validlyVoidedRoot, 'src/service.test.ts',
    `${await readText(validlyVoidedRoot, 'src/service.test.ts')}\n// dangling cycle red\n`);
  await recordTddRed(validlyVoidedRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  const voidResult = await voidTddCycle(
    validlyVoidedRoot,
    'TEST-EXAMPLE-001',
    'nahisaho',
    'Exercise validly voided preflight diagnostics.',
  );
  expect(voidResult.voided).toBe(true);
  const validlyVoidedBefore = await snapshotEvidence(validlyVoidedRoot);
  const validlyVoidedError = await rejectionFrom(recordChangePhase(
    validlyVoidedRoot,
    'CHANGE-0001',
    'red',
    ['REQ-EXAMPLE-001'],
  ));
  expect(validlyVoidedError).toMatchObject({
    code: 'CHANGE_RED_TDD_PREFLIGHT_FAILED',
    phase: 'red',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
    rejections: [{
      requirementId: 'REQ-EXAMPLE-001',
      categories: [
        { category: 'validly-voided', details: expect.any(Array) },
        { category: 'green-already-recorded', details: expect.any(Array) },
      ],
    }],
  });
  expect(await snapshotEvidence(validlyVoidedRoot)).toEqual(validlyVoidedBefore);

  const completedCycleRoot = await project();
  await prepareMultiRequirementChange(completedCycleRoot);
  await writeText(completedCycleRoot, 'src/service.test.ts', `${testCode}\n// completed-cycle red\n`);
  await recordTddRed(completedCycleRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await writeText(completedCycleRoot, 'src/service.ts', `${code}\n// completed-cycle implementation\n`);
  await runTddPhase(completedCycleRoot, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(completedCycleRoot, 'passed'));
  const completedCycleBefore = await snapshotEvidence(completedCycleRoot);
  const completedCycleError = await rejectionFrom(recordChangePhase(
    completedCycleRoot,
    'CHANGE-0001',
    'red',
    ['REQ-EXAMPLE-001'],
  ));
  expect(completedCycleError).toMatchObject({
    code: 'CHANGE_RED_TDD_PREFLIGHT_FAILED',
    phase: 'red',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
    rejections: [{
      requirementId: 'REQ-EXAMPLE-001',
      categories: [{ category: 'green-already-recorded', details: expect.any(Array) }],
    }],
  });
  expect(completedCycleError.rejections[0]!.categories[0]!.details).toHaveLength(1);
  expect(await snapshotEvidence(completedCycleRoot)).toEqual(completedCycleBefore);

  const supersededImplementationRoot = await project();
  await prepareMultiRequirementChange(supersededImplementationRoot);
  await writeText(supersededImplementationRoot, 'src/service.test.ts', `${testCode}\n// older batch red\n`);
  await recordTddRed(supersededImplementationRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(supersededImplementationRoot, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await writeText(supersededImplementationRoot, 'src/service.ts', `${code}\n// older batch implementation\n`);
  await runTddPhase(supersededImplementationRoot, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(supersededImplementationRoot, 'passed'));
  await writeText(supersededImplementationRoot, 'src/service.test.ts',
    `${await readText(supersededImplementationRoot, 'src/service.test.ts')}\n// superseding batch red\n`);
  await writeText(supersededImplementationRoot, 'src/second.test.ts',
    `${await readText(supersededImplementationRoot, 'src/second.test.ts')}\n// superseding batch red\n`);
  await recordTddRed(supersededImplementationRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddRed(supersededImplementationRoot, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(supersededImplementationRoot, 'CHANGE-0001', 'red',
    ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  const duplicatedEvidence = JSON.parse(
    await readText(supersededImplementationRoot, '.musubix/evidence/tdd.json'),
  );
  const completedCycle = duplicatedEvidence.cycles.find((cycle: { requirementId: string; green?: unknown }) =>
    cycle.requirementId === 'REQ-EXAMPLE-001' && cycle.green);
  if (!completedCycle?.cycleId) throw new Error('Expected completed persisted TDD cycle evidence.');
  duplicatedEvidence.cycles.push(structuredClone(completedCycle));
  await writeJson(supersededImplementationRoot, '.musubix/evidence/tdd.json', duplicatedEvidence);
  const supersededImplementationBefore = await snapshotEvidence(supersededImplementationRoot);
  const supersededImplementationError = await rejectionFrom(recordChangePhase(
    supersededImplementationRoot,
    'CHANGE-0001',
    'implementation',
    ['REQ-EXAMPLE-001'],
  ));
  expect(supersededImplementationError).toMatchObject({
    code: 'CHANGE_IMPLEMENTATION_TDD_PREFLIGHT_FAILED',
    phase: 'implementation',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
    rejections: [{ requirementId: 'REQ-EXAMPLE-001' }],
  });
  const implementationCategories = supersededImplementationError.rejections[0]!.categories;
  expect(implementationCategories).toEqual([
    { category: 'superseded-batch', details: ['REQ-EXAMPLE-001,REQ-EXAMPLE-002'] },
    { category: 'outside-window', details: expect.any(Array) },
    { category: 'green-already-recorded', details: [completedCycle.cycleId] },
  ]);
  expect(implementationCategories.map(({ category }) => category)).toEqual(
    [...new Set(implementationCategories.map(({ category }) => category))],
  );
  for (const { details } of implementationCategories) {
    expect(details).toEqual([...new Set(details)].sort());
  }
  expect(await snapshotEvidence(supersededImplementationRoot)).toEqual(supersededImplementationBefore);

  const supersededGreenRoot = await project();
  await prepareMultiRequirementChange(supersededGreenRoot);
  await writeText(supersededGreenRoot, 'src/service.test.ts', `${testCode}\n// older Green batch red\n`);
  await recordTddRed(supersededGreenRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(supersededGreenRoot, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await writeText(supersededGreenRoot, 'src/service.ts', `${code}\n// older Green batch implementation\n`);
  await recordChangePhase(supersededGreenRoot, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
  await runTddPhase(supersededGreenRoot, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(supersededGreenRoot, 'passed'));
  await writeText(supersededGreenRoot, 'src/service.test.ts',
    `${await readText(supersededGreenRoot, 'src/service.test.ts')}\n// newer overlapping red\n`);
  await writeText(supersededGreenRoot, 'src/second.test.ts',
    `${await readText(supersededGreenRoot, 'src/second.test.ts')}\n// newer overlapping red\n`);
  await recordTddRed(supersededGreenRoot, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddRed(supersededGreenRoot, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(supersededGreenRoot, 'CHANGE-0001', 'red',
    ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  const supersededGreenBefore = await snapshotEvidence(supersededGreenRoot);
  const supersededGreenError = await rejectionFrom(recordChangePhase(
    supersededGreenRoot,
    'CHANGE-0001',
    'green',
    ['REQ-EXAMPLE-001'],
  ));
  expect(supersededGreenError).toMatchObject({
    code: 'CHANGE_GREEN_TDD_PREFLIGHT_FAILED',
    phase: 'green',
    uncoveredRequirementIds: ['REQ-EXAMPLE-001'],
    rejections: [{
      requirementId: 'REQ-EXAMPLE-001',
      categories: [
        {
          category: 'superseded-batch',
          details: ['REQ-EXAMPLE-001,REQ-EXAMPLE-002'],
        },
        {
          category: 'invalid-result',
          details: expect.any(Array),
        },
      ],
    }],
  });
  expect(await snapshotEvidence(supersededGreenRoot)).toEqual(supersededGreenBefore);
}, 120_000);
