import { describe, expect, it, vi } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import type { Runner } from '../packages/analysis/src/index.js';

const {
  approvalManifest, collectEvidenceHeads, defaultConfig, evidenceSnapshot, loadApproval, loadConfig, parseConfig,
  policyDiagnostics, projectStatus, readText, recordApproval, runGate, runTddPhase, validateApprovals, writeJson, writeText,
} = analysis;
import { fixture, project, tddResultRunner } from './helpers.js';

async function approve(root: string, stage: 'requirements' | 'design' | 'release', approver: string) {
  const manifest = await approvalManifest(root, stage);
  return recordApproval(root, stage, approver, manifest.artifactSha256);
}

describe('artifact-bound approval evidence', () => {
  /** @id TEST-HUMAN-APPROVAL-GATES-001
   * @verifies REQ-HUMAN-APPROVAL-GATES-001
   */
  it('TEST-HUMAN-APPROVAL-GATES-001 records explicitly confirmed approval fields', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.approval = { mode: 'required' };
    await writeJson(root, '.musubix/config.json', config);

    const before = await approvalManifest(root, 'requirements');
    const evidence = await approve(root, 'requirements', 'Ada Reviewer');
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      stage: 'requirements',
      approver: 'Ada Reviewer',
      artifactSha256: before.artifactSha256,
      artifacts: before.artifacts,
    });
    expect(Date.parse(evidence.approvedAt)).not.toBeNaN();
    expect((await validateApprovals(root, config.approval)).stages[0]?.status).toBe('approved');

    const requirementPath = '.musubix/features/example/requirements.md';
    await writeText(root, requirementPath, `${await readText(root, requirementPath)}\n`);
    const validation = await validateApprovals(root, config.approval);
    expect(validation.valid).toBe(false);
    expect(validation.stages[0]).toMatchObject({ stage: 'requirements', status: 'stale' });
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({ code: 'APPROVAL_STALE' }));
  });

  /** @id TEST-HUMAN-APPROVAL-GATES-006
   * @verifies REQ-HUMAN-APPROVAL-GATES-006
   */
  it('TEST-HUMAN-APPROVAL-GATES-006 recomputes quality before release approval', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.approval = { mode: 'required' };
    await writeJson(root, '.musubix/config.json', config);
    await expect(approve(root, 'design', 'Designer')).rejects.toThrow('requirements approval is missing');

    await approve(root, 'requirements', 'Requirements Owner');
    await approve(root, 'design', 'Design Owner');
    const originalArgs = [...config.commands[0]!.args];
    config.commands[0]!.args = ['-e', 'process.exit(1)'];
    await writeJson(root, '.musubix/config.json', config);
    await writeJson(root, '.musubix/evidence/quality.json', {
      schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'pass',
      checks: [{ name: 'commands', required: true, status: 'pass', summary: 'forged' }],
      fingerprints: await evidenceSnapshot(root),
    });
    await expect(approve(root, 'release', 'Release Owner')).rejects.toThrow('non-approval quality checks');

    config.commands[0]!.args = originalArgs;
    await writeJson(root, '.musubix/config.json', config);
    const candidate = await runGate(root);
    expect(candidate.status).toBe('fail');
    expect(candidate.checks.find((check) => check.name === 'approval')).toMatchObject({ required: true, status: 'fail' });
    await approve(root, 'release', 'Release Owner');
    expect((await loadApproval(root, 'release'))?.approver).toBe('Release Owner');

    const final = await runGate(root);
    expect(final.status).toBe('pass');
    expect(final.checks.find((check) => check.name === 'approval')).toMatchObject({ required: true, status: 'pass' });
    expect((await projectStatus(root)).gate.ready).toBe(true);
  });

  /** @id TEST-HUMAN-APPROVAL-GATES-002
   * @verifies REQ-HUMAN-APPROVAL-GATES-002
   */
  it('TEST-HUMAN-APPROVAL-GATES-002 binds confirmation to the exact manifest hash', async () => {
    const root = await project();
    const shown = await approvalManifest(root, 'requirements');
    const requirementPath = '.musubix/features/example/requirements.md';
    await writeText(root, requirementPath, `${await readText(root, requirementPath)}\n`);
    await expect(recordApproval(root, 'requirements', 'Reviewer', shown.artifactSha256))
      .rejects.toThrow('Approval artifact manifest changed');
  });

  /** @id TEST-HUMAN-APPROVAL-GATES-003
   * @verifies REQ-HUMAN-APPROVAL-GATES-003
   */
  it('TEST-HUMAN-APPROVAL-GATES-003 binds ordinary JSONL inputs and detects staleness', async () => {
    const root = await project();
    await writeText(root, 'tests/cases.jsonl', '{"case":1}\n');
    await writeText(root, '.github/skills/example/SKILL.md', '# Example skill\n');
    const first = await approvalManifest(root, 'release');
    const workspaceHead = (await collectEvidenceHeads(root)).workspace;
    expect(first.artifacts).toHaveProperty('tests/cases.jsonl');
    expect(first.artifacts).toHaveProperty('.github/skills/example/SKILL.md');
    await writeText(root, 'tests/cases.jsonl', '{"case":2}\n');
    expect((await approvalManifest(root, 'release')).artifactSha256).not.toBe(first.artifactSha256);
    expect((await collectEvidenceHeads(root)).workspace).not.toBe(workspaceHead);
  });

  /** @id TEST-HUMAN-APPROVAL-GATES-004
   * @verifies REQ-HUMAN-APPROVAL-GATES-004
   */
  it('TEST-HUMAN-APPROVAL-GATES-004 blocks design approval before requirements approval', async () => {
    const root = await project();
    await expect(approve(root, 'design', 'Designer')).rejects.toThrow('requirements approval is missing');
    await approve(root, 'requirements', 'Requirements Owner');
    await expect(approve(root, 'design', 'Designer')).resolves.toMatchObject({ stage: 'design' });
  });

  /** @id TEST-HUMAN-APPROVAL-GATES-007
   * @verifies REQ-HUMAN-APPROVAL-GATES-007
   */
  it('TEST-HUMAN-APPROVAL-GATES-007 rejects invalid artifacts and reports malformed evidence', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.approval = { mode: 'required' };
    await writeJson(root, '.musubix/config.json', config);
    await writeText(root, '.musubix/features/example/requirements.md', '# invalid\n');
    await expect(approve(root, 'requirements', 'Reviewer'))
      .rejects.toThrow('valid requirements');

    await writeJson(root, '.musubix/evidence/approvals/requirements.json', {
      schemaVersion: 1, stage: 'requirements', approver: 'Reviewer', approvedAt: new Date().toISOString(),
      artifacts: { 'bad': 'not-a-hash' }, artifactSha256: '0'.repeat(64),
    });
    const malformed = await validateApprovals(root, config.approval);
    expect(malformed.diagnostics).toContainEqual(expect.objectContaining({ code: 'APPROVAL_SCHEMA' }));
    expect(malformed.stages[0]).toMatchObject({ present: true, status: 'stale' });

    config.approval = { mode: 'compatible' };
    await writeJson(root, '.musubix/config.json', config);
    expect((await runGate(root)).checks.find((check) => check.name === 'approval'))
      .toMatchObject({ required: true, status: 'fail' });
  });
});

describe('approval transition gates', () => {
  /** @id TEST-HUMAN-APPROVAL-GATES-005
   * @verifies REQ-HUMAN-APPROVAL-GATES-005
   */
  it('TEST-HUMAN-APPROVAL-GATES-005 blocks TDD Red until design approval is current', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.approval = { mode: 'required' };
    await writeJson(root, '.musubix/config.json', config);
    const runner = vi.fn<Runner>(tddResultRunner(root, 'failed', { exitCode: 1 }));

    await expect(runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', runner))
      .rejects.toThrow('design approval is missing');
    expect(runner).not.toHaveBeenCalled();

    await approve(root, 'requirements', 'Requirements Owner');
    await approve(root, 'design', 'Design Owner');
    expect((await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', runner)).valid).toBe(true);
    expect(runner).toHaveBeenCalledOnce();
  });
});

describe('approval configuration compatibility', () => {
  /** @id TEST-HUMAN-APPROVAL-GATES-008
   * @verifies REQ-HUMAN-APPROVAL-GATES-008
   */
  it('TEST-HUMAN-APPROVAL-GATES-008 preserves legacy configs and prevents policy downgrade', async () => {
    expect(parseConfig({ schemaVersion: 1 }).approval).toEqual({ mode: 'compatible' });
    expect(defaultConfig.approval).toEqual({ mode: 'required' });
    const baseline = { ...defaultConfig, requiredCommands: [] };
    const weakened = { ...defaultConfig, approval: { mode: 'compatible' as const } };
    expect(policyDiagnostics(weakened, baseline)).toContainEqual(expect.objectContaining({ code: 'POLICY_APPROVAL_MODE' }));

    const root = await fixture({ '.musubix/config.json': JSON.stringify({ schemaVersion: 1 }) });
    expect((await loadConfig(root)).approval).toEqual({ mode: 'compatible' });
    expect((await validateApprovals(root, { mode: 'compatible' })).valid).toBe(true);
  });
});
