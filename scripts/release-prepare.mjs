import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

export function expectedReleaseTag(pkg) {
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'package.json has an invalid semver version');
  return `v${pkg.version}`;
}

export function verifyReleaseVersions(tag, directory = root) {
  const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(resolve(directory, 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(resolve(directory, '.github/plugin/marketplace.json'), 'utf8'));
  assert.equal(tag, expectedReleaseTag(pkg), `release tag ${tag} does not match package version ${pkg.version}`);
  assert.equal(plugin.version, pkg.version, 'plugin.json version does not match package.json');
  assert.equal(marketplace.metadata.version, pkg.version, 'marketplace metadata version does not match package.json');
  assert.equal(marketplace.plugins[0]?.version, pkg.version, 'marketplace plugin version does not match package.json');
  if (process.env.GITHUB_SHA) {
    const taggedSha = execFileSync('git', ['rev-list', '-n', '1', tag], {
      cwd: directory,
      encoding: 'utf8',
    }).trim().toLowerCase();
    assert.equal(taggedSha, process.env.GITHUB_SHA.toLowerCase(),
      `release tag ${tag} does not point to GITHUB_SHA`);
  }
  return pkg;
}

function npmInvocation(args) {
  const npmCli = process.env.npm_execpath;
  assert(npmCli, 'Run release preparation through npm so npm_execpath is available.');
  return [process.execPath, [npmCli, ...args]];
}

export function prepareRelease(tag, outputDirectory, directory = root) {
  verifyReleaseVersions(tag, directory);
  const output = resolve(directory, outputDirectory);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const [npm, packArgs] = npmInvocation([
    'pack', '--json', '--ignore-scripts', '--pack-destination', output,
  ]);
  const pack = JSON.parse(execFileSync(npm, packArgs, { cwd: directory, encoding: 'utf8' }))[0];
  const tarball = resolve(output, basename(pack.filename));
  const [npmForSbom, sbomArgs] = npmInvocation(['sbom', '--sbom-format', 'cyclonedx']);
  const sbom = execFileSync(npmForSbom, sbomArgs, {
    cwd: directory,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const sbomPath = resolve(output, 'musubix3.cdx.json');
  writeFileSync(sbomPath, sbom);

  const files = [tarball, sbomPath].sort();
  const sums = files.map((path) =>
    `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${basename(path)}`).join('\n');
  writeFileSync(resolve(output, 'SHA256SUMS'), `${sums}\n`);
  return { tarball, sbom: sbomPath, checksums: resolve(output, 'SHA256SUMS') };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = argument('--tag', process.env.RELEASE_TAG);
  const output = argument('--output', 'release-assets');
  assert(tag, 'provide --tag or RELEASE_TAG');
  console.log(JSON.stringify(prepareRelease(tag, output), null, 2));
}
