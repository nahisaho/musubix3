import { execFileSync } from 'node:child_process';
import {
  chmodSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import {
  readFile, readdir, rm, symlink,
} from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { digest, readText, writeJson, writeText } from '../packages/analysis/src/index.js';
import { fixture, repository } from './helpers.js';

type ReleaseVersionReport = {
  valid: boolean;
  expectedVersion: string | null;
  diagnostics: Array<{
    path: string | null;
    location: string | null;
    expected: string | null;
    actual: string | null;
    reason: string;
  }>;
};

type ReleaseVersionModule = {
  inspectReleaseVersionSurfaces(root: string, expectedVersion: string): {
    report: ReleaseVersionReport;
    snapshot: unknown;
  };
  planReleaseVersionUpdate(snapshot: unknown, expectedVersion: string): unknown[];
  commitReleaseVersionPlan(plan: unknown[], dependencies?: {
    writeFileSync?: typeof writeFileSync;
    renameSync?: typeof renameSync;
    openSync?: typeof openSync;
    rmSync?: typeof rmSync;
  }): ReleaseVersionReport;
  runReleaseVersion(args: string[], root: string, dependencies?: {
    writeFileSync?: typeof writeFileSync;
    renameSync?: typeof renameSync;
    openSync?: typeof openSync;
    rmSync?: typeof rmSync;
  }): ReleaseVersionReport;
};

async function releaseVersionModule(): Promise<ReleaseVersionModule> {
  return import(pathToFileURL(resolve(repository, 'scripts/release-version.mjs')).href) as Promise<ReleaseVersionModule>;
}

async function releaseFixture(version = '0.1.20'): Promise<string> {
  const root = await fixture();
  await writeJson(root, 'package.json', {
    name: 'musubix3',
    version,
    workspaces: ['packages/*'],
    scripts: { test: 'vitest run' },
    dependencies: { example: '^1.0.0' },
  });
  for (const workspace of ['analysis', 'cli', 'domain', 'extra']) {
    await writeJson(root, `packages/${workspace}/package.json`, {
      name: `@musubix3/${workspace}`,
      version,
      private: true,
    });
  }
  await writeJson(root, 'package-lock.json', {
    name: 'musubix3',
    version,
    lockfileVersion: 3,
    packages: {
      '': { name: 'musubix3', version, dependencies: { example: '^1.0.0' } },
      'packages/analysis': { name: '@musubix3/analysis', version },
      'packages/cli': { name: '@musubix3/cli', version },
      'packages/domain': { name: '@musubix3/domain', version },
      'packages/extra': { name: '@musubix3/extra', version },
      'node_modules/example': {
        version: '1.0.0',
        resolved: 'https://registry.example/example.tgz',
        integrity: 'sha512-example',
        cpu: ['x64'],
        os: ['linux'],
        libc: ['glibc'],
      },
    },
  });
  await writeJson(root, 'plugin.json', { name: 'musubix3', version, skills: '.github/skills/' });
  await writeJson(root, '.github/plugin/marketplace.json', {
    name: 'musubix3-marketplace',
    metadata: { version },
    plugins: [{ name: 'musubix3', source: '.', version }],
  });
  await writeText(root, 'packages/cli/src/main.ts',
    `const program = new Command().name('musubix3').version('${version}');\n`);
  await writeText(root, 'tests/cli-package.test.ts',
    `expect(version()).toBe('${version}');\nexpect(linked()).toBe('${version}');\n`);
  await writeText(root, 'README.md', `# musubix3\n\n**Latest release v${version} · test**\n`);
  await writeText(root, 'README-ja.md', `# musubix3\n\n**最新リリース v${version} · test**\n`);
  await writeText(root, 'CHANGELOG.md', `## ${version} - historical\n`);
  await writeText(root, '.musubix/evidence/example.json', `{"version":"${version}"}\n`);
  return root;
}

async function treeDigests(root: string): Promise<Record<string, { type: string; digest: string | null }>> {
  const result: Record<string, { type: string; digest: string | null }> = {};
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(resolve(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path);
      else result[path] = {
        type: entry.isFile() ? 'file' : entry.isSymbolicLink() ? 'symlink' : 'other',
        digest: entry.isFile() ? digest(await readFile(resolve(root, path))) : null,
      };
    }
  }
  await visit('');
  return result;
}

describe('release version synchronization', () => {
  /** @id TEST-RELEASE-VERSION-SYNCHRONIZATION-001
   * @verifies REQ-RELEASE-VERSION-SYNCHRONIZATION-001 REQ-RELEASE-VERSION-SYNCHRONIZATION-002 REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-005 REQ-RELEASE-VERSION-SYNCHRONIZATION-008
   */
  it('TEST-RELEASE-VERSION-SYNCHRONIZATION-001 synchronizes and checks every declared surface deterministically', async () => {
    const root = await releaseFixture();
    const module = await releaseVersionModule();
    const beforeLock = JSON.parse(await readText(root, 'package-lock.json')) as Record<string, unknown>;
    const changelogBefore = await readText(root, 'CHANGELOG.md');
    const evidenceBefore = await readText(root, '.musubix/evidence/example.json');

    expect(module.runReleaseVersion(['1.2.3-rc.1'], root)).toEqual({
      valid: true,
      expectedVersion: '1.2.3-rc.1',
      diagnostics: [],
    });
    expect(JSON.parse(await readText(root, 'package.json')).version).toBe('1.2.3-rc.1');
    for (const workspace of ['analysis', 'cli', 'domain', 'extra']) {
      expect(JSON.parse(await readText(root, `packages/${workspace}/package.json`)).version).toBe('1.2.3-rc.1');
    }
    const lock = JSON.parse(await readText(root, 'package-lock.json')) as typeof beforeLock;
    expect(lock).toMatchObject({
      version: '1.2.3-rc.1',
      packages: {
        '': { version: '1.2.3-rc.1' },
        'packages/analysis': { version: '1.2.3-rc.1' },
        'packages/cli': { version: '1.2.3-rc.1' },
        'packages/domain': { version: '1.2.3-rc.1' },
        'packages/extra': { version: '1.2.3-rc.1' },
        'node_modules/example': (beforeLock.packages as Record<string, unknown>)['node_modules/example'],
      },
    });
    expect(await readText(root, 'packages/cli/src/main.ts')).toContain(".version('1.2.3-rc.1')");
    expect((await readText(root, 'tests/cli-package.test.ts')).match(/toBe\('1\.2\.3-rc\.1'\)/g)).toHaveLength(2);
    expect(await readText(root, 'README.md')).toContain('Latest release v1.2.3-rc.1');
    expect(await readText(root, 'README-ja.md')).toContain('最新リリース v1.2.3-rc.1');
    expect(await readText(root, 'CHANGELOG.md')).toBe(changelogBefore);
    expect(await readText(root, '.musubix/evidence/example.json')).toBe(evidenceBefore);

    const synchronized = await treeDigests(root);
    expect(module.runReleaseVersion(['1.2.3-rc.1'], root)).toEqual({
      valid: true,
      expectedVersion: '1.2.3-rc.1',
      diagnostics: [],
    });
    expect(await treeDigests(root)).toEqual(synchronized);
    expect(module.runReleaseVersion(['--check', '1.2.3-rc.1'], root)).toEqual({
      valid: true,
      expectedVersion: '1.2.3-rc.1',
      diagnostics: [],
    });

    await writeJson(root, 'plugin.json', { name: 'musubix3', version: '9.9.9', skills: '.github/skills/' });
    const divergent = await treeDigests(root);
    expect(module.runReleaseVersion(['--check', '1.2.3-rc.1'], root)).toEqual({
      valid: false,
      expectedVersion: '1.2.3-rc.1',
      diagnostics: [{
        path: 'plugin.json',
        location: '/version',
        expected: '1.2.3-rc.1',
        actual: '9.9.9',
        reason: 'version-mismatch',
      }],
    });
    expect(await treeDigests(root)).toEqual(divergent);
    for (const args of [
      ['v1.2.3'], [], ['1.2.3+build.1'], ['1.2'], ['01.2.3'], ['1.2.3-01'],
      ['1.2.3-'], [' 1.2.3'], ['1.2.3', 'extra'], ['--'], ['--check', '--check', '1.2.3'],
      ['1.2.3', '--check'],
    ]) {
      expect(module.runReleaseVersion(args, root)).toEqual({
        valid: false,
        expectedVersion: null,
        diagnostics: [{
          path: null,
          location: null,
          expected: null,
          actual: null,
          reason: 'invalid-arguments',
        }],
      });
    }

    const cliRoot = await releaseFixture();
    await writeText(
      cliRoot,
      'scripts/release-version.mjs',
      readFileSync(resolve(repository, 'scripts/release-version.mjs'), 'utf8'),
    );
    const cliStdout = execFileSync(
      process.execPath,
      ['scripts/release-version.mjs', '1.2.3'],
      { cwd: cliRoot, encoding: 'utf8' },
    );
    const cliReport = JSON.parse(cliStdout) as ReleaseVersionReport;
    expect(cliReport).toEqual({ valid: true, expectedVersion: '1.2.3', diagnostics: [] });
    expect(await readText(cliRoot, 'package.json')).toContain('"version": "1.2.3"');
    const cliPackage = JSON.parse(await readText(cliRoot, 'package.json')) as {
      scripts: Record<string, string>;
    };
    cliPackage.scripts['release:version'] = 'node scripts/release-version.mjs';
    await writeJson(cliRoot, 'package.json', cliPackage);
    const npmInvocation = process.env.npm_execpath
      ? { command: process.execPath, args: [process.env.npm_execpath] }
      : { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] };
    const directCheckStdout = execFileSync(
      process.execPath,
      ['scripts/release-version.mjs', '--check', '1.2.3'],
      { cwd: cliRoot, encoding: 'utf8' },
    );
    const npmCheckStdout = execFileSync(
      npmInvocation.command,
      [...npmInvocation.args, 'run', '--silent', 'release:version', '--', '--check', '1.2.3'],
      { cwd: cliRoot, encoding: 'utf8' },
    );
    expect(npmCheckStdout).toBe(directCheckStdout);
    expect(JSON.parse(npmCheckStdout)).toEqual({ valid: true, expectedVersion: '1.2.3', diagnostics: [] });

    const npmUpdateRoot = await releaseFixture();
    await writeText(
      npmUpdateRoot,
      'scripts/release-version.mjs',
      readFileSync(resolve(repository, 'scripts/release-version.mjs'), 'utf8'),
    );
    const npmUpdatePackage = JSON.parse(await readText(npmUpdateRoot, 'package.json')) as {
      scripts: Record<string, string>;
    };
    npmUpdatePackage.scripts['release:version'] = 'node scripts/release-version.mjs';
    await writeJson(npmUpdateRoot, 'package.json', npmUpdatePackage);
    const npmUpdateStdout = execFileSync(
      npmInvocation.command,
      [...npmInvocation.args, 'run', '--silent', 'release:version', '--', '1.2.3'],
      { cwd: npmUpdateRoot, encoding: 'utf8' },
    );
    expect(npmUpdateStdout).toBe(cliStdout);
    expect(JSON.parse(npmUpdateStdout)).toEqual({ valid: true, expectedVersion: '1.2.3', diagnostics: [] });

    const documentedReleaseOrder = {
      'README.md': [
        'The release order is version synchronization',
        'authored `CHANGELOG.md` review',
        '`npm run build`',
        'package validation',
        'commit',
        'matching `v<version>`',
      ],
      'README-ja.md': [
        'リリース順序は version 同期',
        '`CHANGELOG.md` の内容レビュー',
        '`npm run build`',
        'package 検査',
        'commit',
        '一致する `v<version>`',
      ],
    } as const;
    for (const readme of ['README.md', 'README-ja.md'] as const) {
      const documentation = readFileSync(resolve(repository, readme), 'utf8');
      for (const command of [
        'npm run --silent release:version -- 1.2.3',
        'npm run --silent release:version -- --check 1.2.3',
        'node scripts/release-version.mjs 1.2.3',
        'node scripts/release-version.mjs --check 1.2.3',
      ]) expect(documentation).toContain(command);
      let previous = -1;
      for (const step of documentedReleaseOrder[readme]) {
        const position = documentation.indexOf(step, previous + 1);
        expect(position).toBeGreaterThan(previous);
        previous = position;
      }
    }
    const cliPaths = Object.keys(await treeDigests(cliRoot));
    expect(cliPaths.some((path) => path.startsWith('node_modules/'))).toBe(false);
    expect(cliPaths.some((path) => path.startsWith('dist/'))).toBe(false);
  });

  /** @id TEST-RELEASE-VERSION-SYNCHRONIZATION-002
   * @verifies REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004
   */
  it('TEST-RELEASE-VERSION-SYNCHRONIZATION-002 rejects stale plans and rolls back staged and partial commits', async () => {
    const module = await releaseVersionModule();

    for (const failure of ['write', 'rename'] as const) {
      const root = await releaseFixture();
      const before = await treeDigests(root);
      let writes = 0;
      let renames = 0;
      const report = module.runReleaseVersion(['1.2.3'], root, {
        writeFileSync(path, data, options) {
          writes += 1;
          if (failure === 'write' && writes === 2) throw new Error('injected staged-write failure');
          writeFileSync(path, data, options);
        },
        renameSync(oldPath, newPath) {
          renames += 1;
          if (failure === 'rename' && renames === 3) throw new Error('injected partial-commit failure');
          renameSync(oldPath, newPath);
        },
      });
      expect(report.valid).toBe(false);
      expect(report.diagnostics[0]).toMatchObject({ reason: 'write-error' });
      expect(await treeDigests(root)).toEqual(before);
    }

    const rollbackFailureRoot = await releaseFixture();
    const rollbackInspection = module.inspectReleaseVersionSurfaces(rollbackFailureRoot, '1.2.3');
    const rollbackPlan = module.planReleaseVersionUpdate(rollbackInspection.snapshot, '1.2.3');
    let rollbackRenames = 0;
    const rollbackFailure = module.commitReleaseVersionPlan(rollbackPlan, {
      renameSync(oldPath, newPath) {
        rollbackRenames += 1;
        if (rollbackRenames === 3 || rollbackRenames === 4) {
          throw new Error('injected commit or rollback failure');
        }
        renameSync(oldPath, newPath);
      },
    });
    expect(rollbackFailure.diagnostics[0]).toMatchObject({
      expected: '1.2.3',
      reason: 'write-error',
    });
    expect(rollbackFailure.diagnostics.slice(1)).toEqual([
      expect.objectContaining({
        location: null,
        expected: null,
        actual: null,
        reason: 'write-error',
      }),
    ]);

    const staleRoot = await releaseFixture();
    const inspected = module.inspectReleaseVersionSurfaces(staleRoot, '1.2.3');
    expect(inspected.snapshot).not.toBeNull();
    const plan = module.planReleaseVersionUpdate(inspected.snapshot, '1.2.3');
    await writeText(staleRoot, 'README.md', '# externally changed\n');
    const staleBefore = await treeDigests(staleRoot);
    expect(module.commitReleaseVersionPlan(plan)).toMatchObject({
      valid: false,
      expectedVersion: '1.2.3',
      diagnostics: [expect.objectContaining({ path: 'README.md', reason: 'write-error' })],
    });
    expect(await treeDigests(staleRoot)).toEqual(staleBefore);

    const structuralFaults: Array<{
      reason: string;
      mutate(root: string): Promise<void>;
    }> = [
      {
        reason: 'missing-file',
        mutate: async (root) => rm(resolve(root, 'README.md')),
      },
      {
        reason: 'parse-error',
        mutate: async (root) => writeText(root, 'package-lock.json', '{invalid\n'),
      },
      {
        reason: 'workspace-resolution',
        mutate: async (root) => {
          await writeText(root, 'packages/unmanifested/README.md', 'missing manifest\n');
        },
      },
      {
        reason: 'missing-location',
        mutate: async (root) => {
          const lock = JSON.parse(await readText(root, 'package-lock.json')) as {
            packages: Record<string, unknown>;
          };
          delete lock.packages['packages/extra'];
          await writeJson(root, 'package-lock.json', lock);
        },
      },
      {
        reason: 'occurrence-count',
        mutate: async (root) => {
          await writeText(
            root,
            'packages/cli/src/main.ts',
            "new Command().version('0.1.20');\nnew Command().version('0.1.20');\n",
          );
        },
      },
    ];
    for (const fault of structuralFaults) {
      const invalidRoot = await releaseFixture();
      await fault.mutate(invalidRoot);
      const invalidBefore = await treeDigests(invalidRoot);
      expect(module.runReleaseVersion(['1.2.3'], invalidRoot)).toMatchObject({
        valid: false,
        diagnostics: expect.arrayContaining([expect.objectContaining({ reason: fault.reason })]),
      });
      expect(await treeDigests(invalidRoot)).toEqual(invalidBefore);
    }
  });

  /** @id TEST-RELEASE-VERSION-SYNCHRONIZATION-003
   * @verifies REQ-RELEASE-VERSION-SYNCHRONIZATION-006 REQ-RELEASE-VERSION-SYNCHRONIZATION-007
   */
  it('TEST-RELEASE-VERSION-SYNCHRONIZATION-003 shares validation and protects release output before mutation', async () => {
    const root = await releaseFixture();
    await writeJson(root, 'plugin.json', { name: 'musubix3', version: '9.9.9', skills: '.github/skills/' });
    await writeText(root, 'release-assets/sentinel.txt', 'keep\n');
    const outputBefore = await treeDigests(resolve(root, 'release-assets'));
    const versionModule = await releaseVersionModule();
    const checkModule = await import(pathToFileURL(resolve(repository, 'scripts/check-package.mjs')).href) as {
      checkPackage(directory: string): unknown;
    };
    const releaseModule = await import(pathToFileURL(resolve(repository, 'scripts/release-prepare.mjs')).href) as {
      verifyReleaseVersions(tag: string, directory: string): unknown;
      prepareRelease(tag: string, output: string, directory: string): unknown;
    };
    const expected = versionModule.runReleaseVersion(['--check', '0.1.20'], root);

    for (const invoke of [
      () => checkModule.checkPackage(root),
      () => releaseModule.verifyReleaseVersions('v0.1.20', root),
      () => releaseModule.prepareRelease('v0.1.20', 'release-assets', root),
    ]) {
      expect(invoke).toThrowError(expect.objectContaining({ report: expected }));
    }
    expect(await treeDigests(resolve(root, 'release-assets'))).toEqual(outputBefore);

    for (const tag of ['0.1.20', 'vv0.1.20', 'refs/tags/v0.1.20', 'v01.2.3']) {
      expect(() => releaseModule.prepareRelease(tag, 'release-assets', root)).toThrowError(
        expect.objectContaining({
          report: expect.objectContaining({
            expectedVersion: null,
            diagnostics: [expect.objectContaining({ reason: 'invalid-arguments' })],
          }),
        }),
      );
      expect(await treeDigests(resolve(root, 'release-assets'))).toEqual(outputBefore);
    }

    const gitRoot = await releaseFixture();
    execFileSync('git', ['init', '--quiet'], { cwd: gitRoot });
    execFileSync('git', ['config', 'user.name', 'Release Test'], { cwd: gitRoot });
    execFileSync('git', ['config', 'user.email', 'release@example.invalid'], { cwd: gitRoot });
    execFileSync('git', ['add', '.'], { cwd: gitRoot });
    execFileSync('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: gitRoot });
    execFileSync('git', ['tag', 'v0.1.20'], { cwd: gitRoot });
    const previousSha = process.env.GITHUB_SHA;
    process.env.GITHUB_SHA = '0000000000000000000000000000000000000000';
    try {
      expect(() => releaseModule.verifyReleaseVersions('v0.1.20', gitRoot)).toThrow(
        'release tag v0.1.20 does not point to GITHUB_SHA',
      );
    } finally {
      if (previousSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousSha;
    }
  });

  /** @id TEST-RELEASE-VERSION-SYNCHRONIZATION-004
   * @verifies REQ-RELEASE-VERSION-SYNCHRONIZATION-003
   */
  it('TEST-RELEASE-VERSION-SYNCHRONIZATION-004 restores every target after cleanup faults and rejects escaping workspaces', async () => {
    const module = await releaseVersionModule();
    const cleanupRoot = await releaseFixture();
    const cleanupBefore = await treeDigests(cleanupRoot);
    let backupRemovals = 0;
    const cleanupReport = module.runReleaseVersion(['1.2.3'], cleanupRoot, {
      rmSync(path, options) {
        if (String(path).includes('.backup')) {
          backupRemovals += 1;
          if (backupRemovals === 2) throw new Error('injected backup cleanup failure');
        }
        rmSync(path, options);
      },
    });
    expect(cleanupReport).toMatchObject({
      valid: false,
      diagnostics: [expect.objectContaining({ reason: 'write-error' })],
    });
    expect(await treeDigests(cleanupRoot)).toEqual(cleanupBefore);

    const windowsRoot = await releaseFixture();
    expect(module.runReleaseVersion(['1.2.3'], windowsRoot, {
      openSync(path, flags, mode) {
        if (String(path).includes('.stage') && flags !== 'r+') {
          const error = new Error('write access required for FlushFileBuffers') as NodeJS.ErrnoException;
          error.code = 'EPERM';
          throw error;
        }
        return openSync(path, flags, mode);
      },
    })).toEqual({ valid: true, expectedVersion: '1.2.3', diagnostics: [] });

    const escapingRoot = await releaseFixture();
    await writeJson(escapingRoot, 'package.json', {
      name: 'musubix3',
      version: '0.1.20',
      workspaces: ['../*'],
    });
    expect(module.runReleaseVersion(['1.2.3'], escapingRoot)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([{
        path: 'package.json',
        location: '/workspaces',
        expected: null,
        actual: '../*',
        reason: 'workspace-resolution',
      }]),
    });
  });

  /** @id TEST-RELEASE-VERSION-SYNCHRONIZATION-005
   * @verifies REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-008
   */
  it('TEST-RELEASE-VERSION-SYNCHRONIZATION-005 orders diagnostics and plans by code point and runs core checks offline', async () => {
    const module = await releaseVersionModule();
    const root = await releaseFixture();
    const inspected = module.inspectReleaseVersionSurfaces(root, '1.2.3');
    expect(inspected.snapshot).not.toBeNull();
    const plan = module.planReleaseVersionUpdate(inspected.snapshot, '1.2.3') as Array<{ path: string }>;
    expect(plan.map((entry) => entry.path)).toEqual(
      plan.map((entry) => entry.path).sort((left, right) => left < right ? -1 : left > right ? 1 : 0),
    );
    expect(module.runReleaseVersion(['1.2.3'], root)).toEqual({
      valid: true,
      expectedVersion: '1.2.3',
      diagnostics: [],
    });

    await writeJson(root, 'package.json', {
      name: 'musubix3',
      version: '9.9.9',
      workspaces: ['packages/*'],
      scripts: { test: 'vitest run' },
      dependencies: { example: '^1.0.0' },
    });
    await writeJson(root, '.github/plugin/marketplace.json', {
      name: 'musubix3-marketplace',
      metadata: { version: '8.8.8' },
      plugins: [{ name: 'musubix3', source: '.', version: '7.7.7' }],
    });
    await writeText(root, 'README.md', '# musubix3\n\n**Latest release v6.6.6 · test**\n');
    await writeText(root, 'README-ja.md', '# musubix3\n\n**最新リリース v5.5.5 · test**\n');
    expect(module.runReleaseVersion(['--check', '1.2.3'], root).diagnostics).toEqual([
      {
        path: '.github/plugin/marketplace.json',
        location: '/metadata/version',
        expected: '1.2.3',
        actual: '8.8.8',
        reason: 'version-mismatch',
      },
      {
        path: '.github/plugin/marketplace.json',
        location: '/plugins/0/version',
        expected: '1.2.3',
        actual: '7.7.7',
        reason: 'version-mismatch',
      },
      {
        path: 'README-ja.md',
        location: '3',
        expected: '1.2.3',
        actual: '5.5.5',
        reason: 'version-mismatch',
      },
      {
        path: 'README.md',
        location: '3',
        expected: '1.2.3',
        actual: '6.6.6',
        reason: 'version-mismatch',
      },
      {
        path: 'package.json',
        location: '/version',
        expected: '1.2.3',
        actual: '9.9.9',
        reason: 'version-mismatch',
      },
    ]);

    const offlineRoot = await releaseFixture('1.2.3');
    const require = createRequire(import.meta.url);
    const childProcess = require('node:child_process') as typeof import('node:child_process');
    const net = require('node:net') as typeof import('node:net');
    const originalExecFileSync = childProcess.execFileSync;
    const originalConnect = net.connect;
    Object.assign(childProcess, {
      execFileSync: () => {
        throw new Error('child process access is forbidden');
      },
    });
    Object.assign(net, {
      connect: () => {
        throw new Error('network access is forbidden');
      },
    });
    syncBuiltinESMExports();
    try {
      expect(module.runReleaseVersion(['--check', '1.2.3'], offlineRoot)).toEqual({
        valid: true,
        expectedVersion: '1.2.3',
        diagnostics: [],
      });
    } finally {
      Object.assign(childProcess, { execFileSync: originalExecFileSync });
      Object.assign(net, { connect: originalConnect });
      syncBuiltinESMExports();
    }
  });

  /** @id TEST-RELEASE-VERSION-SYNCHRONIZATION-006
   * @verifies REQ-RELEASE-VERSION-SYNCHRONIZATION-002 REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-005
   */
  it('TEST-RELEASE-VERSION-SYNCHRONIZATION-006 preserves undeclared JSON bytes and modes without phantom rollback', async () => {
    const module = await releaseVersionModule();
    const formattingRoot = await releaseFixture();
    const pluginBefore = '{\n  "name": "musubix3",\n  "author": { "name": "example" },\n  "version": "0.1.20",\n  "skills": ".github/skills/"\n}\n';
    const marketplaceBefore = '{\n  "name": "musubix3-marketplace",\n  "owner": { "name": "example" },\n  "metadata": { "version": "0.1.20" },\n  "plugins": [{ "name": "musubix3", "source": ".", "version": "0.1.20" }]\n}\n';
    await writeText(formattingRoot, 'plugin.json', pluginBefore);
    await writeText(formattingRoot, '.github/plugin/marketplace.json', marketplaceBefore);
    const sameVersionBefore = await treeDigests(formattingRoot);
    expect(module.runReleaseVersion(['0.1.20'], formattingRoot)).toEqual({
      valid: true,
      expectedVersion: '0.1.20',
      diagnostics: [],
    });
    expect(await treeDigests(formattingRoot)).toEqual(sameVersionBefore);
    expect(module.runReleaseVersion(['1.2.3'], formattingRoot)).toEqual({
      valid: true,
      expectedVersion: '1.2.3',
      diagnostics: [],
    });
    expect(await readText(formattingRoot, 'plugin.json')).toBe(
      pluginBefore.replace('"version": "0.1.20"', '"version": "1.2.3"'),
    );
    expect(await readText(formattingRoot, '.github/plugin/marketplace.json')).toBe(
      marketplaceBefore.replaceAll('"version": "0.1.20"', '"version": "1.2.3"'),
    );

    const modeRoot = await releaseFixture();
    chmodSync(resolve(modeRoot, 'README.md'), 0o444);
    expect(module.runReleaseVersion(['1.2.3'], modeRoot, {
      writeFileSync(path, data, options) {
        if (
          String(path).includes('.stage')
          && typeof options === 'object'
          && options !== null
          && ((typeof options.mode === 'number' ? options.mode : 0) & 0o200) === 0
        ) {
          const error = new Error('staging requires a writable mode') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
        writeFileSync(path, data, options);
      },
    })).toEqual({ valid: true, expectedVersion: '1.2.3', diagnostics: [] });
    expect(statSync(resolve(modeRoot, 'README.md')).mode & 0o7777).toBe(0o444);

    const staleRoot = await releaseFixture();
    const inspected = module.inspectReleaseVersionSurfaces(staleRoot, '1.2.3');
    const plan = module.planReleaseVersionUpdate(inspected.snapshot, '1.2.3');
    await rm(resolve(staleRoot, 'plugin.json'));
    expect(module.commitReleaseVersionPlan(plan)).toEqual({
      valid: false,
      expectedVersion: '1.2.3',
      diagnostics: [{
        path: 'plugin.json',
        location: null,
        expected: '1.2.3',
        actual: null,
        reason: 'write-error',
      }],
    });

    const symlinkRoot = await releaseFixture();
    await writeJson(symlinkRoot, 'linked-source/package.json', {
      name: '@musubix3/linked',
      version: '0.1.20',
      private: true,
    });
    await symlink('../linked-source', resolve(symlinkRoot, 'packages/linked'));
    expect(module.runReleaseVersion(['1.2.3'], symlinkRoot)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({
        path: 'package.json',
        location: '/workspaces',
        reason: 'workspace-resolution',
      })]),
    });
  });

  /** @id TEST-RELEASE-VERSION-SYNCHRONIZATION-007
   * @verifies REQ-RELEASE-VERSION-SYNCHRONIZATION-006 REQ-RELEASE-VERSION-SYNCHRONIZATION-007
   */
  it('TEST-RELEASE-VERSION-SYNCHRONIZATION-007 validates tag wiring and prerequisites before release output mutation', async () => {
    const versionModule = await releaseVersionModule();
    const releaseModule = await import(pathToFileURL(resolve(repository, 'scripts/release-prepare.mjs')).href) as {
      verifyReleaseVersions(tag: string, directory: string): unknown;
      prepareRelease(tag: string, output: string, directory: string, dependencies?: {
        execFileSync?: typeof execFileSync;
        npmExecPath?: string;
      }): {
        tarball: string;
        sbom: string;
        checksums: string;
      };
    };

    const symlinkRoot = await releaseFixture();
    await writeText(symlinkRoot, 'shared-config.json', '{}\n');
    await symlink('../shared-config.json', resolve(symlinkRoot, 'packages/shared-config.json'));
    expect(versionModule.runReleaseVersion(['--check', '0.1.20'], symlinkRoot)).toEqual({
      valid: true,
      expectedVersion: '0.1.20',
      diagnostics: [],
    });

    const mismatchRoot = await releaseFixture();
    expect(() => releaseModule.verifyReleaseVersions('v9.9.9', mismatchRoot)).toThrowError(
      expect.objectContaining({
        report: expect.objectContaining({
          expectedVersion: '9.9.9',
          diagnostics: expect.arrayContaining([{
            path: 'package.json',
            location: '/version',
            expected: '9.9.9',
            actual: '0.1.20',
            reason: 'version-mismatch',
          }]),
        }),
      }),
    );

    const prerequisiteRoot = await releaseFixture();
    await writeText(prerequisiteRoot, 'release-assets/sentinel.txt', 'keep\n');
    const outputBefore = await treeDigests(resolve(prerequisiteRoot, 'release-assets'));
    const previousNpmExecPath = process.env.npm_execpath;
    const previousPrerequisiteSha = process.env.GITHUB_SHA;
    delete process.env.npm_execpath;
    delete process.env.GITHUB_SHA;
    try {
      expect(() => releaseModule.prepareRelease(
        'v0.1.20', 'release-assets', prerequisiteRoot,
      )).toThrow('Run release preparation through npm so npm_execpath is available.');
    } finally {
      if (previousNpmExecPath === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = previousNpmExecPath;
      if (previousPrerequisiteSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousPrerequisiteSha;
    }
    expect(await treeDigests(resolve(prerequisiteRoot, 'release-assets'))).toEqual(outputBefore);

    const successRoot = await releaseFixture();
    const invocations: string[][] = [];
    const execute = ((command: string, args: string[]) => {
      invocations.push([command, ...args]);
      if (args.includes('pack')) {
        writeFileSync(resolve(successRoot, 'release-assets/musubix3-0.1.20.tgz'), 'tarball');
        return JSON.stringify([{ filename: 'musubix3-0.1.20.tgz' }]);
      }
      if (args.includes('sbom')) return '{"bomFormat":"CycloneDX"}';
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    }) as typeof execFileSync;
    const previousSuccessSha = process.env.GITHUB_SHA;
    delete process.env.GITHUB_SHA;
    try {
      const prepared = releaseModule.prepareRelease(
        'v0.1.20',
        'release-assets',
        successRoot,
        { execFileSync: execute, npmExecPath: '/test/npm-cli.js' },
      );
      expect(prepared.tarball).toMatch(/\.tgz$/);
      expect(prepared.sbom).toMatch(/musubix3\.cdx\.json$/);
      expect(prepared.checksums).toMatch(/SHA256SUMS$/);
      expect(await readText(successRoot, 'release-assets/SHA256SUMS')).toContain('musubix3-0.1.20.tgz');
      expect(invocations).toEqual([
        [process.execPath, '/test/npm-cli.js', 'pack', '--json', '--ignore-scripts', '--pack-destination',
          resolve(successRoot, 'release-assets')],
        [process.execPath, '/test/npm-cli.js', 'sbom', '--sbom-format', 'cyclonedx'],
      ]);
    } finally {
      if (previousSuccessSha === undefined) delete process.env.GITHUB_SHA;
      else process.env.GITHUB_SHA = previousSuccessSha;
    }
  });
});
