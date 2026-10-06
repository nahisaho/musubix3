import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  digest, readText, writeJson, writeText, type ApprovalConfig, type ApprovalManifest,
} from '../packages/analysis/src/index.js';
import { caseSafeEnvironment, fixture, repository } from './helpers.js';

type ReleaseApprovalDrift = {
  path: string;
  change: 'added' | 'modified' | 'deleted';
  approvedSha256: string | null;
  currentSha256: string | null;
};

type ReleaseApprovalReport = {
  valid: boolean;
  stage: 'release';
  status: 'approved' | 'missing' | 'stale';
  diagnostics: ReleaseApprovalDrift[];
};

type ReleaseApprovalApi = {
  approvalManifest(root: string, stage: 'release'): Promise<ApprovalManifest>;
  validateReleaseApprovalForTag(
    root: string,
    tag: string,
    config: ApprovalConfig,
    options?: { githubSha?: string },
  ): Promise<ReleaseApprovalReport>;
};

const required: ApprovalConfig = { mode: 'required', domains: [] };
const compatible: ApprovalConfig = { mode: 'compatible', domains: [] };

async function api(): Promise<ReleaseApprovalApi> {
  return import(pathToFileURL(resolve(repository, 'packages/analysis/src/index.ts')).href) as unknown as Promise<ReleaseApprovalApi>;
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function initGit(root: string): void {
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'Release Approval Test']);
  git(root, ['config', 'user.email', 'release-approval@example.invalid']);
}

async function recordReleaseApproval(root: string, artifacts: Record<string, string>): Promise<void> {
  await writeJson(root, '.musubix/evidence/approvals/release.json', {
    schemaVersion: 1,
    stage: 'release',
    artifacts,
    artifactSha256: digest(JSON.stringify({ stage: 'release', artifacts })),
    approver: 'release-approval-test',
    approvedAt: '2026-01-01T00:00:00.000Z',
  });
}

function commitAndTag(root: string, tag = 'v1.0.0'): void {
  git(root, ['add', '.']);
  git(root, ['commit', '--quiet', '-m', 'release candidate']);
  git(root, ['tag', tag]);
}

function expectOrdered(text: string, values: string[]): void {
  let cursor = -1;
  for (const value of values) {
    const next = text.indexOf(value, cursor + 1);
    expect(next, `missing or out-of-order text: ${value}`).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe('release approval ordering', () => {
  /** @id TEST-RELEASE-APPROVAL-ORDERING-001
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-001 REQ-RELEASE-APPROVAL-ORDERING-002
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-001 binds the approved Git candidate to the clean tagged release manifest', async () => {
    const module = await api();
    expect(typeof module.validateReleaseApprovalForTag).toBe('function');

    const root = await fixture();
    initGit(root);
    await writeText(root, '.gitignore', '.test-tools/\nrelease-assets/\ndist/\n');
    await writeText(root, 'src/index.ts', 'export const value = 1;\n');
    await writeText(root, '.github/skills/example/SKILL.md', '# Example skill\n');
    await writeText(root, '.test-tools/tool.bin', 'ignored tool\n');
    await writeText(root, 'release-assets/SHA256SUMS', 'ignored output\n');
    await writeJson(root, 'examples/nested/.musubix/config.json', { schemaVersion: 1 });
    await writeText(root, 'examples/nested/src/index.ts', 'export const nested = true;\n');

    const approved = await module.approvalManifest(root, 'release');
    expect(Object.keys(approved.artifacts)).toContain('.github/skills/example/SKILL.md');
    expect(Object.keys(approved.artifacts)).not.toContain('.test-tools/tool.bin');
    expect(Object.keys(approved.artifacts)).not.toContain('release-assets/SHA256SUMS');
    expect(Object.keys(approved.artifacts)).not.toContain('examples/nested/src/index.ts');

    await recordReleaseApproval(root, approved.artifacts);
    commitAndTag(root);
    const githubSha = git(root, ['rev-parse', 'HEAD']);

    await expect(module.validateReleaseApprovalForTag(root, 'v1.0.0', required, { githubSha })).resolves.toEqual({
      valid: true,
      stage: 'release',
      status: 'approved',
      diagnostics: [],
    });

    await writeText(root, '.test-tools/runtime.bin', 'runner scratch\n');
    await expect(module.validateReleaseApprovalForTag(root, 'v1.0.0', required, { githubSha })).resolves.toMatchObject({
      valid: true,
      status: 'approved',
    });

    await writeText(root, 'src/uncommitted.ts', 'export const uncommitted = true;\n');
    await expect(module.validateReleaseApprovalForTag(root, 'v1.0.0', required, { githubSha })).resolves.toEqual({
      valid: false,
      stage: 'release',
      status: 'stale',
      diagnostics: [{
        path: 'src/uncommitted.ts',
        change: 'added',
        approvedSha256: null,
        currentSha256: digest('export const uncommitted = true;\n'),
      }],
    });
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-002
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-002 REQ-RELEASE-APPROVAL-ORDERING-003
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-002 reports missing and complete stale drift in Unicode code-point order', async () => {
    const module = await api();
    expect(typeof module.validateReleaseApprovalForTag).toBe('function');

    const root = await fixture();
    initGit(root);
    await writeText(root, '\uE000-added.txt', 'added\n');
    await writeText(root, '\u{10000}-modified.txt', 'current\n');
    commitAndTag(root);
    const githubSha = git(root, ['rev-parse', 'HEAD']);

    await expect(module.validateReleaseApprovalForTag(root, 'v1.0.0', required, { githubSha })).resolves.toEqual({
      valid: false,
      stage: 'release',
      status: 'missing',
      diagnostics: [],
    });
    await expect(module.validateReleaseApprovalForTag(root, 'v1.0.0', compatible, { githubSha })).resolves.toEqual({
      valid: true,
      stage: 'release',
      status: 'missing',
      diagnostics: [],
    });

    const approvedModified = '0'.repeat(64);
    const approvedDeleted = digest('deleted\n');
    await recordReleaseApproval(root, {
      'z-deleted.txt': approvedDeleted,
      '\u{10000}-modified.txt': approvedModified,
    });
    await expect(module.validateReleaseApprovalForTag(root, 'v1.0.0', required, { githubSha })).resolves.toEqual({
      valid: false,
      stage: 'release',
      status: 'stale',
      diagnostics: [
        {
          path: 'z-deleted.txt',
          change: 'deleted',
          approvedSha256: approvedDeleted,
          currentSha256: null,
        },
        {
          path: '\uE000-added.txt',
          change: 'added',
          approvedSha256: null,
          currentSha256: digest('added\n'),
        },
        {
          path: '\u{10000}-modified.txt',
          change: 'modified',
          approvedSha256: approvedModified,
          currentSha256: digest('current\n'),
        },
      ],
    });
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-005
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-002 REQ-RELEASE-APPROVAL-ORDERING-003
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-005 rejects internally inconsistent approval evidence', async () => {
    const module = await api();
    const root = await fixture();
    initGit(root);
    await writeText(root, 'src/index.ts', 'export const value = 1;\n');
    commitAndTag(root);
    const githubSha = git(root, ['rev-parse', 'HEAD']);
    const current = await module.approvalManifest(root, 'release');
    await writeJson(root, '.musubix/evidence/approvals/release.json', {
      schemaVersion: 1,
      stage: 'release',
      artifacts: current.artifacts,
      artifactSha256: '0'.repeat(64),
      approver: 'release-approval-test',
      approvedAt: '2026-01-01T00:00:00.000Z',
    });

    await expect(module.validateReleaseApprovalForTag(
      root, 'v1.0.0', required, { githubSha },
    )).rejects.toMatchObject({
      code: 'RELEASE_APPROVAL_SCHEMA',
    });
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-003
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-001 REQ-RELEASE-APPROVAL-ORDERING-003
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-003 fails the CLI with one JSON report before output mutation', async () => {
    const root = await fixture();
    await writeJson(root, 'package.json', { name: 'fixture', version: '1.0.0' });
    await writeText(root, 'release-assets/sentinel.txt', 'keep\n');
    await writeText(root, 'scripts/release-prepare.mjs',
      await readText(repository, 'scripts/release-prepare.mjs'));
    await writeText(root, 'scripts/release-version.mjs', `
export class ReleaseVersionValidationError extends Error {
  constructor(report) { super('invalid release version'); this.report = report; }
}
export function parseReleaseVersionArguments(args) {
  return args.length ? { expectedVersion: args[0] } : { valid: false, expectedVersion: null, diagnostics: [] };
}
export function inspectReleaseVersionSurfaces(_root, expectedVersion) {
  return { report: { valid: true, expectedVersion, diagnostics: [] }, snapshot: {} };
}
`);
    await writeText(root, 'dist/packages/analysis/src/index.js', `
export async function loadConfig() { return { approval: { mode: 'required', domains: [] } }; }
export async function validateReleaseApprovalForTag() {
  return { valid: false, stage: 'release', status: 'missing', diagnostics: [] };
}
`);
    await writeText(root, 'npm-cli.cjs', 'process.exit(0);\n');

    const result = spawnSync(process.execPath, [
      'scripts/release-prepare.mjs', '--tag', 'v1.0.0', '--output', 'release-assets',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: caseSafeEnvironment({
        npm_execpath: resolve(root, 'npm-cli.cjs'),
        GITHUB_SHA: '',
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(`${JSON.stringify({
      valid: false,
      stage: 'release',
      status: 'missing',
      diagnostics: [],
    })}\n`);
    expect(await readText(root, 'release-assets/sentinel.txt')).toBe('keep\n');
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-004
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-004
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-004 documents and wires the enforced release sequence in both languages', async () => {
    const [english, japanese, workflow] = await Promise.all([
      readText(repository, 'README.md'),
      readText(repository, 'README-ja.md'),
      readText(repository, '.github/workflows/release.yml'),
    ]);
    expectOrdered(english, [
      'final release metadata and `CHANGELOG.md`',
      'validation and build',
      'explicit release approval',
      'commit and create the unchanged `v<version>` tag',
      '`release:prepare`',
    ]);
    expectOrdered(japanese, [
      '最終リリースメタデータと `CHANGELOG.md`',
      '検証とビルド',
      '明示的な release 承認',
      'commit と変更されていない `v<version>` tag の作成',
      '`release:prepare`',
    ]);
    expect(english).toContain('requires renewed validation and release approval');
    expect(japanese).toContain('検証と release 承認をやり直す必要があります');
    expect(workflow).toContain('github.ref_type');
    expect(workflow).toContain('github.ref_name');
    expect(workflow).toContain('inputs.release_tag');
    expect(workflow).toContain('ref: ${{ github.ref }}');
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-006
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-002
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-006 isolates fixture tags from ambient CI identity and shell expressions', async () => {
    const module = await api();
    const root = await fixture();
    initGit(root);
    await writeText(root, 'src/index.ts', 'export const value = 1;\n');
    const approved = await module.approvalManifest(root, 'release');
    await recordReleaseApproval(root, approved.artifacts);
    commitAndTag(root);
    const fixtureSha = git(root, ['rev-parse', 'HEAD']);
    const previousSha = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = git(repository, ['rev-parse', 'HEAD']);
    try {
      await expect(module.validateReleaseApprovalForTag(
        root, 'v1.0.0', required, { githubSha: fixtureSha },
      )).resolves.toMatchObject({ valid: true, status: 'approved' });
    } finally {
      if (previousSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousSha;
    }

    const workflow = await readText(repository, '.github/workflows/release.yml');
    expect(workflow).toContain('REF_TYPE: ${{ github.ref_type }}');
    expect(workflow).toContain('REF_NAME: ${{ github.ref_name }}');
    expect(workflow).toContain('test \"$REF_TYPE\" = \"tag\"');
    expect(workflow).toContain('test \"$REF_NAME\" = \"$RELEASE_TAG\"');
    expect(workflow).not.toContain('test \"${{ github.ref_type }}\"');
    expect(workflow).not.toContain('test \"${{ github.ref_name }}\"');
    expect(workflow.indexOf('Verify manual release ref')).toBeLessThan(workflow.indexOf('actions/checkout@'));
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-007
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-001 REQ-RELEASE-APPROVAL-ORDERING-002
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-007 rebuilds approved sources before validation and packaging', async () => {
    const releaseModule = await import(pathToFileURL(resolve(repository, 'scripts/release-prepare.mjs')).href) as {
      prepareRelease(tag: string, output: string, directory: string, dependencies: {
        execFileSync: typeof execFileSync;
        npmExecPath: string;
        verifyReleaseVersions(): void;
        analysis: {
          loadConfig(): Promise<{ approval: ApprovalConfig }>;
          validateReleaseApprovalForTag(): Promise<ReleaseApprovalReport>;
        };
      }): Promise<unknown>;
    };
    const root = await fixture();
    await writeJson(root, 'package.json', { name: 'musubix3', version: '1.0.0' });
    const calls: string[][] = [];
    const execute = ((command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (args.includes('build')) return '';
      if (args.includes('pack')) {
        writeFileSync(resolve(root, 'release-assets/musubix3-1.0.0.tgz'), 'tarball\n');
        return JSON.stringify([{ filename: 'musubix3-1.0.0.tgz' }]);
      }
      if (args.includes('sbom')) return '{"bomFormat":"CycloneDX"}';
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }) as typeof execFileSync;
    await releaseModule.prepareRelease('v1.0.0', 'release-assets', root, {
      execFileSync: execute,
      npmExecPath: '/test/npm-cli.js',
      verifyReleaseVersions() {},
      analysis: {
        async loadConfig() { return { approval: required }; },
        async validateReleaseApprovalForTag() {
          expect(calls[0]).toEqual([process.execPath, '/test/npm-cli.js', 'run', 'build']);
          return { valid: true, stage: 'release', status: 'approved', diagnostics: [] };
        },
      },
    });
    expect(calls.map((call) => call.slice(1))).toEqual([
      ['/test/npm-cli.js', 'run', 'build'],
      ['/test/npm-cli.js', 'pack', '--json', '--ignore-scripts', '--pack-destination',
        resolve(root, 'release-assets')],
      ['/test/npm-cli.js', 'sbom', '--sbom-format', 'cyclonedx'],
    ]);
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-008
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-005
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-008 excludes the fixed scratch-file convention from the untracked release manifest only', async () => {
    const module = await api();
    const root = await fixture();
    initGit(root);
    await writeText(root, 'src/index.ts', 'export const value = 1;\n');
    commitAndTag(root);

    const baseline = await module.approvalManifest(root, 'release');
    expect(Object.keys(baseline.artifacts)).toEqual(['src/index.ts']);
    const baselineHash = baseline.artifactSha256;

    // An untracked scratch-directory file and an untracked *.scratch.<ext> file
    // must never appear in the manifest, and must never perturb its hash.
    await writeText(root, '.musubix/scratch/approval-prepare-release.json', '{"first":true}\n');
    await writeText(root, 'relcheck-1.scratch.json', '{"second":true}\n');
    const withScratch = await module.approvalManifest(root, 'release');
    expect(Object.keys(withScratch.artifacts)).toEqual(['src/index.ts']);
    expect(withScratch.artifactSha256).toBe(baselineHash);

    // Rewriting the scratch files' content still never changes the hash.
    await writeText(root, '.musubix/scratch/approval-prepare-release.json', '{"first":"changed"}\n');
    await writeText(root, 'relcheck-1.scratch.json', '{"second":"changed"}\n');
    const rewritten = await module.approvalManifest(root, 'release');
    expect(rewritten.artifactSha256).toBe(baselineHash);

    // Non-matching naming conventions (no extension, uppercase, multi-dot
    // extension) remain fully included, as ordinary untracked files.
    await writeText(root, 'foo.scratch', 'no extension\n');
    await writeText(root, 'foo.SCRATCH.JSON', 'wrong case\n');
    await writeText(root, 'foo.scratch.tar.gz', 'multi-dot extension\n');
    const nonMatching = await module.approvalManifest(root, 'release');
    expect(Object.keys(nonMatching.artifacts).sort()).toEqual([
      'foo.SCRATCH.JSON', 'foo.scratch', 'foo.scratch.tar.gz', 'src/index.ts',
    ]);
    expect(nonMatching.artifactSha256).not.toBe(baselineHash);

    // An ordinary untracked file (matching neither pattern) still participates
    // in the manifest and still changes the hash.
    await writeText(root, 'src/uncommitted.ts', 'export const uncommitted = true;\n');
    const withOrdinaryUntracked = await module.approvalManifest(root, 'release');
    expect(Object.keys(withOrdinaryUntracked.artifacts)).toContain('src/uncommitted.ts');
    expect(withOrdinaryUntracked.artifactSha256).not.toBe(nonMatching.artifactSha256);

    // A *tracked* (committed) file whose name matches either scratch pattern
    // is still included exactly like any other tracked release input.
    await writeText(root, 'notes.scratch.json', '{"tracked":true}\n');
    await writeText(root, '.musubix/scratch/README.md', '# tracked scratch doc\n');
    git(root, ['add', 'notes.scratch.json', '.musubix/scratch/README.md']);
    git(root, ['commit', '--quiet', '-m', 'commit scratch-named files']);
    const withTrackedScratch = await module.approvalManifest(root, 'release');
    expect(Object.keys(withTrackedScratch.artifacts)).toContain('notes.scratch.json');
    expect(Object.keys(withTrackedScratch.artifacts)).toContain('.musubix/scratch/README.md');
    // The still-untracked scratch-convention files remain excluded.
    expect(Object.keys(withTrackedScratch.artifacts)).not.toContain(
      '.musubix/scratch/approval-prepare-release.json',
    );
    expect(Object.keys(withTrackedScratch.artifacts)).not.toContain('relcheck-1.scratch.json');
  });

  /** @id TEST-RELEASE-APPROVAL-ORDERING-009
   * @verifies REQ-RELEASE-APPROVAL-ORDERING-005
   */
  it('TEST-RELEASE-APPROVAL-ORDERING-009 derives structural exclusion markers from the complete candidate set before removing scratch entries', async () => {
    const module = await api();
    const root = await fixture();
    initGit(root);
    await writeText(root, 'src/index.ts', 'export const value = 1;\n');
    commitAndTag(root);

    // "proj/app.scratch.csproj" matches BOTH the fixed scratch naming
    // convention (so it must itself be excluded from the manifest) AND the
    // existing .csproj marker pattern that marks "proj" as a .NET project
    // directory whose generated "bin"/"obj" output is structurally excluded.
    // The scratch exclusion must be applied only to the final output, after
    // that marker derivation runs against the complete (unfiltered)
    // candidate set — otherwise removing the scratch file first would also
    // silently un-mark "proj" as a .NET directory, incorrectly letting its
    // unrelated "bin"/"obj" build output back into the manifest.
    await writeText(root, 'proj/app.scratch.csproj', '<Project />\n');
    await writeText(root, 'proj/bin/output.dll', 'binary\n');
    await writeText(root, 'proj/obj/output.obj', 'binary\n');

    const manifest = await module.approvalManifest(root, 'release');
    expect(Object.keys(manifest.artifacts).sort()).toEqual(['src/index.ts']);
  });
});
