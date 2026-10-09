import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

const {
  approvalManifest, fastReapprovalEligibility, loadApproval, loadConfig, recordApproval, recordFastReapproval,
  runGate, runProcess, writeJson, writeText,
} = analysis;

const cli = resolve('dist/packages/cli/src/main.js');

async function cliJson(root: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const result = await runProcess(process.execPath, [cli, ...args], { cwd: root, timeoutMs: 20_000 });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

async function requiredApprovalProject(): Promise<string> {
  const root = await project();
  const config = await loadConfig(root);
  config.approval = { mode: 'required', domains: [] };
  await writeJson(root, '.musubix/config.json', config);
  return root;
}

async function approve(root: string, stage: 'requirements' | 'design' | 'release', approver: string) {
  const manifest = await approvalManifest(root, stage);
  return recordApproval(root, stage, approver, manifest.artifactSha256, (await loadConfig(root)).approval);
}

async function fastReapprove(
  root: string,
  stage: 'requirements' | 'design' | 'release',
  approver: string,
  ownFiles: string[],
) {
  const manifest = await approvalManifest(root, stage);
  return recordFastReapproval(root, stage, approver, manifest.artifactSha256, ownFiles, (await loadConfig(root)).approval);
}

const requirementPath = '.musubix/features/example/requirements.md';

describe('fastReapprovalEligibility (pure helper)', () => {
  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-001
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-001 is eligible when own files are unchanged, reporting only outside drift', () => {
    const previous = {
      schemaVersion: 1 as const, stage: 'requirements' as const, approver: 'Ada', approvedAt: new Date().toISOString(),
      artifactSha256: 'a'.repeat(64),
      artifacts: { 'a.md': '1'.repeat(64), 'b.md': '2'.repeat(64) },
    };
    const current = { artifacts: { 'a.md': '1'.repeat(64), 'b.md': '9'.repeat(64) } };
    const result = fastReapprovalEligibility(previous, current, ['a.md']);
    expect(result).toEqual({ eligible: true, outsideChanged: [{ path: 'b.md', change: 'modified', approvedSha256: '2'.repeat(64), currentSha256: '9'.repeat(64) }] });
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-002
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-002 rejects an empty own-files list before classifying drift', () => {
    const previous = {
      schemaVersion: 1 as const, stage: 'requirements' as const, approver: 'Ada', approvedAt: new Date().toISOString(),
      artifactSha256: 'a'.repeat(64), artifacts: { 'a.md': '1'.repeat(64) },
    };
    expect(fastReapprovalEligibility(previous, { artifacts: { 'a.md': '1'.repeat(64) } }, [])).toEqual({ eligible: false, reason: 'no-own-files' });
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-003
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-003 rejects an own-files path unknown to both manifests', () => {
    const previous = {
      schemaVersion: 1 as const, stage: 'requirements' as const, approver: 'Ada', approvedAt: new Date().toISOString(),
      artifactSha256: 'a'.repeat(64), artifacts: { 'a.md': '1'.repeat(64) },
    };
    const result = fastReapprovalEligibility(previous, { artifacts: { 'a.md': '1'.repeat(64) } }, ['missing.md']);
    expect(result).toEqual({ eligible: false, reason: 'unknown-own-files', paths: ['missing.md'] });
  });
});

describe('recordFastReapproval', () => {
  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-004
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-001
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-004 records a new approval for the current manifest hash when own files are unchanged', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    // Rebase-only drift: a sibling feature's requirements.md changes, this change's own file does not.
    await writeText(root, '.musubix/features/other/requirements.md', req('The system shall log sibling events.', 'REQ-OTHER-001'));
    const evidence = await fastReapprove(root, 'requirements', 'Ada Reviewer', [requirementPath]);
    expect(evidence.approver).toBe('Ada Reviewer');
    const manifest = await approvalManifest(root, 'requirements');
    expect(evidence.artifactSha256).toBe(manifest.artifactSha256);
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-005
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-005 rejects when an own file was modified, naming it, without writing evidence', async () => {
    const root = await requiredApprovalProject();
    const priorEvidence = await approve(root, 'requirements', 'Ada Reviewer');
    const priorBytes = JSON.stringify(await loadApproval(root, 'requirements'));
    await writeText(root, requirementPath, `${await readFile(resolve(root, requirementPath), 'utf8')}\nExtra line.\n`);
    await expect(fastReapprove(root, 'requirements', 'Ada Reviewer', [requirementPath]))
      .rejects.toThrow(/own file\(s\) changed.*example\/requirements\.md \(modified\)/s);
    expect(JSON.stringify(await loadApproval(root, 'requirements'))).toBe(priorBytes);
    expect(priorEvidence.approver).toBe('Ada Reviewer');
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-006
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-006 rejects when an own file was added, naming it as added', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    const newPath = '.musubix/features/other/requirements.md';
    await writeText(root, newPath, req('The system shall log sibling events.', 'REQ-OTHER-007'));
    await expect(fastReapprove(root, 'requirements', 'Ada Reviewer', [newPath]))
      .rejects.toThrow(/own file\(s\) changed.*other\/requirements\.md \(added\)/s);
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-007
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-007 rejects when an own file was removed, naming it as removed', async () => {
    const root = await requiredApprovalProject();
    const ownPath = '.musubix/features/other/requirements.md';
    await writeText(root, ownPath, req('The system shall log sibling events.', 'REQ-OTHER-008'));
    await approve(root, 'requirements', 'Ada Reviewer');
    await rm(resolve(root, ownPath));
    await expect(fastReapprove(root, 'requirements', 'Ada Reviewer', [ownPath]))
      .rejects.toThrow(/own file\(s\) changed.*other\/requirements\.md \(removed\)/s);
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-008
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-003
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-008 requires the original approver', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    await writeText(root, '.musubix/features/other/requirements.md', req('The system shall log sibling events.', 'REQ-OTHER-002'));
    await expect(fastReapprove(root, 'requirements', 'Different Reviewer', [requirementPath]))
      .rejects.toThrow('Fast re-approval requires the original approver (Ada Reviewer).');
    const manifest = await approvalManifest(root, 'requirements');
    const evidence = await recordFastReapproval(root, 'requirements', 'Ada Reviewer', manifest.artifactSha256, [requirementPath], (await loadConfig(root)).approval);
    expect(evidence.approver).toBe('Ada Reviewer');
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-009
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-009 rejects when no prior approval exists', async () => {
    const root = await requiredApprovalProject();
    await expect(fastReapprove(root, 'requirements', 'Ada Reviewer', [requirementPath]))
      .rejects.toThrow('No prior requirements approval exists to fast-reapprove against.');
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-010
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-010 rejects an empty own-files list', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    const manifest = await approvalManifest(root, 'requirements');
    await expect(recordFastReapproval(root, 'requirements', 'Ada Reviewer', manifest.artifactSha256, [], (await loadConfig(root)).approval))
      .rejects.toThrow('--own-files must list at least one path.');
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-011
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-011 rejects an own-files path unknown to both the prior and current manifest', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    await expect(fastReapprove(root, 'requirements', 'Ada Reviewer', ['.musubix/features/example/never-existed.md']))
      .rejects.toThrow(/unrecognized path.*never-existed\.md/s);
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-012
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-005
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-012 rejects a stale --artifact-sha256 exactly as the non-fast path does', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    const staleHash = 'f'.repeat(64);
    await expect(recordFastReapproval(root, 'requirements', 'Ada Reviewer', staleHash, [requirementPath], (await loadConfig(root)).approval))
      .rejects.toThrow('Approval artifact manifest changed');
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-013
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-005
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-013 writes the same artifactSha256/artifacts a non-fast approval would have written', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    await writeText(root, '.musubix/features/other/requirements.md', req('The system shall log sibling events.', 'REQ-OTHER-003'));
    const manifestBeforeFast = await approvalManifest(root, 'requirements');
    const fastEvidence = await fastReapprove(root, 'requirements', 'Ada Reviewer', [requirementPath]);
    expect(fastEvidence.artifactSha256).toBe(manifestBeforeFast.artifactSha256);
    expect(fastEvidence.artifacts).toEqual(manifestBeforeFast.artifacts);
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-014
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-006
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-014 persists fastReapproval/priorArtifactSha256 only for the fast path', async () => {
    const root = await requiredApprovalProject();
    const prior = await approve(root, 'requirements', 'Ada Reviewer');
    expect(prior.fastReapproval).toBeUndefined();
    expect(prior.priorArtifactSha256).toBeUndefined();
    await writeText(root, '.musubix/features/other/requirements.md', req('The system shall log sibling events.', 'REQ-OTHER-004'));
    const fastEvidence = await fastReapprove(root, 'requirements', 'Ada Reviewer', [requirementPath]);
    expect(fastEvidence.fastReapproval).toBe(true);
    expect(fastEvidence.priorArtifactSha256).toBe(prior.artifactSha256);
    expect(await loadApproval(root, 'requirements')).toMatchObject({ fastReapproval: true, priorArtifactSha256: prior.artifactSha256 });
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-015
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-007
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-015 applies the same approver/hash-format preconditions as the non-fast path', async () => {
    const root = await requiredApprovalProject();
    await approve(root, 'requirements', 'Ada Reviewer');
    await expect(recordFastReapproval(root, 'requirements', '   ', 'a'.repeat(64), [requirementPath], (await loadConfig(root)).approval))
      .rejects.toThrow('Approver must be a nonempty name');
    await expect(recordFastReapproval(root, 'requirements', 'Ada Reviewer', 'not-a-hash', [requirementPath], (await loadConfig(root)).approval))
      .rejects.toThrow('64 lowercase hexadecimal characters');
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-016
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-007
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-016 applies release-stage requirements/design/gate preconditions unchanged', async () => {
    const root = await requiredApprovalProject();
    const manifest = await approvalManifest(root, 'release');
    await expect(recordFastReapproval(root, 'release', 'Release Owner', manifest.artifactSha256, ['src/service.ts'], (await loadConfig(root)).approval))
      .rejects.toThrow('design approval is missing');
    await approve(root, 'requirements', 'Requirements Owner');
    await approve(root, 'design', 'Design Owner');
    // Settle gate-triggered evidence writes before computing the manifest hash
    // a human will approve, matching the existing non-fast release-approval flow.
    await runGate(root);
    await approve(root, 'release', 'Release Owner');
    // Rebase-only drift outside the change's own files: a sibling feature
    // fully introduced and traced (requirements, design, code, test) so
    // release-stage trace/constitution checks still pass, per REQ-007's
    // promise that gate/trace preconditions apply unchanged. Requirements
    // and then design are each fast-reapproved first — each stage's own
    // preconditions, including design's "requirements must be approved"
    // check, still apply unchanged to those fast-reapprove calls too.
    await writeText(root, '.musubix/features/other/requirements.md', req('The system shall log sibling events.', 'REQ-OTHER-005'));
    await writeText(root, '.musubix/features/other/design.md', [
      '---', 'schemaVersion: 1', 'feature: other', '---', '# Design',
      '', '## DES-OTHER-001: Describe the component',
      'Responsibilities: Logs sibling events.',
      'Interfaces: none',
      'Constraints: none',
      'Requirements: REQ-OTHER-005',
      'ADRs: none — not applicable to this test fixture.',
      'Depends-On: none',
      '',
    ].join('\n'));
    await writeText(root, 'src/other.ts', [
      '/** @id CODE-OTHER-001',
      ' * @implements REQ-OTHER-005',
      ' * @design DES-OTHER-001',
      ' */',
      'export function logSiblingEvent() { return true; }',
      '',
    ].join('\n'));
    await writeText(root, 'src/other.test.ts', [
      "import { logSiblingEvent } from './other.js';",
      '/** @id TEST-OTHER-001',
      ' * @verifies REQ-OTHER-005',
      ' */',
      "export function testLogSiblingEvent() { if (!logSiblingEvent()) throw new Error('not logged'); }",
      '',
    ].join('\n'));
    await runGate(root);
    const requirementsManifest = await approvalManifest(root, 'requirements');
    await recordFastReapproval(
      root, 'requirements', 'Requirements Owner', requirementsManifest.artifactSha256,
      [requirementPath], (await loadConfig(root)).approval);
    const designManifest = await approvalManifest(root, 'design');
    await recordFastReapproval(
      root, 'design', 'Design Owner', designManifest.artifactSha256,
      ['.musubix/features/example/design.md'], (await loadConfig(root)).approval);
    await runGate(root);
    const releaseManifest = await approvalManifest(root, 'release');
    const releaseEvidence = await recordFastReapproval(
      root, 'release', 'Release Owner', releaseManifest.artifactSha256, ['src/service.ts'], (await loadConfig(root)).approval);
    expect(releaseEvidence.fastReapproval).toBe(true);
  });
});

describe('approval record <stage> --fast-reapprove (CLI)', () => {
  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-017
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-001
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-017 succeeds end-to-end via the CLI and leaves non-fast usage unaffected', async () => {
    const root = await requiredApprovalProject();
    const prepared = await approvalManifest(root, 'requirements');
    const first = await cliJson(root, [
      'approval', 'record', 'requirements', '--approver', 'Ada Reviewer',
      '--artifact-sha256', prepared.artifactSha256, '--confirm', '--json',
    ]);
    expect(first.exitCode).toBe(0);

    await writeText(root, '.musubix/features/other/requirements.md', req('The system shall log sibling events.', 'REQ-OTHER-006'));
    const manifest = await approvalManifest(root, 'requirements');
    const fast = await cliJson(root, [
      'approval', 'record', 'requirements', '--approver', 'Ada Reviewer',
      '--artifact-sha256', manifest.artifactSha256, '--confirm', '--json',
      '--fast-reapprove', '--own-files', requirementPath,
    ]);
    expect(fast.exitCode).toBe(0);
    const parsed = JSON.parse(fast.stdout) as { fastReapproval?: boolean; artifactSha256: string };
    expect(parsed.fastReapproval).toBe(true);
    expect(parsed.artifactSha256).toBe(manifest.artifactSha256);
  });

  /** @id TEST-APPROVAL-REBASE-FAST-REAPPROVAL-018
   * @verifies REQ-APPROVAL-REBASE-FAST-REAPPROVAL-001
   */
  it('TEST-APPROVAL-REBASE-FAST-REAPPROVAL-018 rejects --own-files without --fast-reapprove', async () => {
    const root = await requiredApprovalProject();
    const manifest = await approvalManifest(root, 'requirements');
    const result = await cliJson(root, [
      'approval', 'record', 'requirements', '--approver', 'Ada Reviewer',
      '--artifact-sha256', manifest.artifactSha256, '--confirm', '--own-files', requirementPath,
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/--own-files requires --fast-reapprove/);
  });
});

function req(statement: string, id: string): string {
  return `## ${id}: Example\nPriority: must\nStatement: ${statement}\n`;
}
