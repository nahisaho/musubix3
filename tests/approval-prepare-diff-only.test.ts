import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { install } from '../packages/cli/src/install.js';
import { fixture, project, repository } from './helpers.js';

const {
  approvalManifest, diffOnlyChangedFiles, loadConfig, readText, recordApproval, resolveNamedDomain, runProcess,
  writeJson, writeText,
} = analysis;

const cli = resolve('dist/packages/cli/src/main.js');

async function cliJson(root: string, args: string[]): Promise<{ stdout: string; exitCode: number | null }> {
  const result = await runProcess(process.execPath, [cli, ...args], { cwd: root, timeoutMs: 20_000 });
  return { stdout: result.stdout, exitCode: result.exitCode };
}

async function approve(root: string, stage: 'requirements' | 'design' | 'release', approver: string) {
  const manifest = await approvalManifest(root, stage);
  const config = await loadConfig(root);
  return recordApproval(root, stage, approver, manifest.artifactSha256, config.approval);
}

/** Adds a second feature to a `project()` fixture and configures two
 * `approval.domains` entries, mirroring `tests/approval-domain-scoping.test.ts`'s
 * `twoDomainProject()` helper. */
async function twoDomainProject(): Promise<string> {
  const root = await project();
  await install(root, repository, { feature: 'other' });
  const config = await loadConfig(root);
  config.approval = {
    mode: 'required',
    domains: [
      { name: 'domain-a', featureGlobs: ['example'] },
      { name: 'domain-b', featureGlobs: ['other'] },
    ],
  };
  await writeJson(root, '.musubix/config.json', config);
  return root;
}

async function approveDomain(root: string, stage: 'requirements' | 'design', domainName: string) {
  const config = await loadConfig(root);
  const domain = await resolveNamedDomain(root, config.approval, domainName);
  const manifest = await approvalManifest(root, stage, domain);
  return recordApproval(root, stage, `${domainName} reviewer`, manifest.artifactSha256, config.approval, domainName);
}

describe('approval prepare diff-only output', () => {
  /** @id TEST-APPROVAL-PREPARE-DIFF-ONLY-001
   * @verifies REQ-APPROVAL-PREPARE-DIFF-ONLY-001
   */
  it('TEST-APPROVAL-PREPARE-DIFF-ONLY-001 adds changedFiles only when --diff-only is passed', async () => {
    const root = await project();
    const without = await cliJson(root, ['approval', 'prepare', 'requirements', '--json']);
    expect(without.exitCode).toBe(0);
    const withoutParsed = JSON.parse(without.stdout) as Record<string, unknown>;
    expect(withoutParsed).not.toHaveProperty('changedFiles');

    const diffOnly = await cliJson(root, ['approval', 'prepare', 'requirements', '--json', '--diff-only']);
    expect(diffOnly.exitCode).toBe(0);
    const diffOnlyParsed = JSON.parse(diffOnly.stdout) as { changedFiles?: unknown };
    expect(Array.isArray(diffOnlyParsed.changedFiles)).toBe(true);
  });

  /** @id TEST-APPROVAL-PREPARE-DIFF-ONLY-002
   * @verifies REQ-APPROVAL-PREPARE-DIFF-ONLY-002
   */
  it('TEST-APPROVAL-PREPARE-DIFF-ONLY-002 never changes artifactSha256/artifacts', async () => {
    const root = await project();
    const without = JSON.parse((await cliJson(root, ['approval', 'prepare', 'requirements', '--json'])).stdout) as {
      artifactSha256: string; artifacts: Record<string, string>;
    };
    const withDiffOnly = JSON.parse((await cliJson(root, ['approval', 'prepare', 'requirements', '--json', '--diff-only'])).stdout) as {
      artifactSha256: string; artifacts: Record<string, string>;
    };
    expect(withDiffOnly.artifactSha256).toBe(without.artifactSha256);
    expect(withDiffOnly.artifacts).toEqual(without.artifacts);
  });

  /** @id TEST-APPROVAL-PREPARE-DIFF-ONLY-003
   * @verifies REQ-APPROVAL-PREPARE-DIFF-ONLY-003
   */
  it('TEST-APPROVAL-PREPARE-DIFF-ONLY-003 reports added, modified and removed paths against the last recorded approval', () => {
    const previous = {
      schemaVersion: 1 as const,
      stage: 'release' as const,
      approver: 'Reviewer',
      approvedAt: new Date().toISOString(),
      artifacts: {
        'a.txt': 'a'.repeat(64),
        'b.txt': 'b'.repeat(64),
        'c.txt': 'c'.repeat(64),
      },
      artifactSha256: 'd'.repeat(64),
    };
    const manifest = {
      stage: 'release' as const,
      artifacts: {
        'a.txt': 'a'.repeat(64),
        'b.txt': 'B'.repeat(64),
        'd.txt': 'd'.repeat(64),
      },
      artifactSha256: 'e'.repeat(64),
    };
    const { changedFiles, diffOnlyBaseline } = diffOnlyChangedFiles(manifest, previous);
    expect(diffOnlyBaseline).toBe('approved');
    expect(changedFiles).toEqual(['b.txt', 'c.txt', 'd.txt']);
  });

  /** @id TEST-APPROVAL-PREPARE-DIFF-ONLY-004
   * @verifies REQ-APPROVAL-PREPARE-DIFF-ONLY-004
   */
  it('TEST-APPROVAL-PREPARE-DIFF-ONLY-004 reports every current path when no prior approval exists', async () => {
    const root = await project();
    const result = await cliJson(root, ['approval', 'prepare', 'requirements', '--json', '--diff-only']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { changedFiles: string[]; diffOnlyBaseline: string; artifacts: Record<string, string> };
    expect(parsed.diffOnlyBaseline).toBe('none');
    expect(parsed.changedFiles.sort()).toEqual(Object.keys(parsed.artifacts).sort());
  });

  /** @id TEST-APPROVAL-PREPARE-DIFF-ONLY-005
   * @verifies REQ-APPROVAL-PREPARE-DIFF-ONLY-005
   */
  it('TEST-APPROVAL-PREPARE-DIFF-ONLY-005 scopes the diff-only comparison to the requested domain', async () => {
    const root = await twoDomainProject();
    await approveDomain(root, 'requirements', 'domain-a');
    await approveDomain(root, 'requirements', 'domain-b');

    const otherRequirements = '.musubix/features/other/requirements.md';
    await writeText(root, otherRequirements, `${await readText(root, otherRequirements)}\nChange: domain-b only.\n`);

    const domainA = await cliJson(root, ['approval', 'prepare', 'requirements', '--domain', 'domain-a', '--json', '--diff-only']);
    expect(domainA.exitCode).toBe(0);
    const domainAParsed = JSON.parse(domainA.stdout) as { changedFiles: string[] };
    expect(domainAParsed.changedFiles).toEqual([]);

    const domainB = await cliJson(root, ['approval', 'prepare', 'requirements', '--domain', 'domain-b', '--json', '--diff-only']);
    expect(domainB.exitCode).toBe(0);
    const domainBParsed = JSON.parse(domainB.stdout) as { changedFiles: string[] };
    expect(domainBParsed.changedFiles).toEqual([otherRequirements]);
  });

  /** @id TEST-APPROVAL-PREPARE-DIFF-ONLY-006
   * @verifies REQ-APPROVAL-PREPARE-DIFF-ONLY-006
   */
  it('TEST-APPROVAL-PREPARE-DIFF-ONLY-006 prints only changed files, a baseline note and the full hash in the non-JSON summary', async () => {
    const root = await project();
    await approve(root, 'requirements', 'Reviewer');
    const requirementPath = '.musubix/features/example/requirements.md';
    await writeText(root, requirementPath, `${await readText(root, requirementPath)}\nChange: one clarifying note.\n`);

    const fullManifest = JSON.parse((await cliJson(root, ['approval', 'prepare', 'requirements', '--json'])).stdout) as {
      artifactSha256: string; artifacts: Record<string, string>;
    };
    const otherArtifactPaths = Object.keys(fullManifest.artifacts).filter((path) => path !== requirementPath);
    expect(otherArtifactPaths.length).toBeGreaterThan(0);

    const summary = await cliJson(root, ['approval', 'prepare', 'requirements', '--diff-only']);
    expect(summary.exitCode).toBe(0);
    expect(summary.stdout).toContain(fullManifest.artifactSha256);
    expect(summary.stdout).toContain(requirementPath);
    expect(summary.stdout.toLowerCase()).toContain('previously recorded approval');
    for (const path of otherArtifactPaths) expect(summary.stdout).not.toContain(path);
  });

  /** @id TEST-APPROVAL-PREPARE-DIFF-ONLY-007
   * @verifies REQ-APPROVAL-PREPARE-DIFF-ONLY-007
   */
  it('TEST-APPROVAL-PREPARE-DIFF-ONLY-007 fails fast on corrupted prior approval evidence instead of treating it as none', async () => {
    const root = await project();
    await approve(root, 'requirements', 'Reviewer');
    await writeJson(root, '.musubix/evidence/approvals/requirements.json', { schemaVersion: 1, stage: 'requirements' });

    const result = await cliJson(root, ['approval', 'prepare', 'requirements', '--json', '--diff-only']);
    expect(result.exitCode).not.toBe(0);
    const parsed = JSON.parse(result.stdout) as { error?: { code?: string; message?: string } };
    expect(parsed.error?.code).toBe('CLI_ERROR');
    expect(parsed.error?.message).toBe('Invalid requirements approval evidence.');
  });
});
