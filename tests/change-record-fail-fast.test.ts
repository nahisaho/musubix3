import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  loadChangeEvidence, readText, recordChangePhase, runProcess, runTddPhase,
  validateChangeEvidence, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { code, project, tddResultRunner, testCode } from './helpers.js';

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
