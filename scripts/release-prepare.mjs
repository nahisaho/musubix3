import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectReleaseVersionSurfaces,
  parseReleaseVersionArguments,
  ReleaseVersionValidationError,
} from './release-version.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** @id CODE-RELEASE-VERSION-SYNCHRONIZATION-005
 * @implements REQ-RELEASE-VERSION-SYNCHRONIZATION-006 REQ-RELEASE-VERSION-SYNCHRONIZATION-007
 * @design DES-RELEASE-VERSION-SYNCHRONIZATION-004
 */
export function verifyReleaseVersions(tag, directory = root) {
  const tagMatch = /^v(.+)$/.exec(tag ?? '');
  const parsed = parseReleaseVersionArguments(tagMatch ? [tagMatch[1]] : []);
  if (!tagMatch || 'valid' in parsed) {
    const invalid = parseReleaseVersionArguments([]);
    throw new ReleaseVersionValidationError(invalid);
  }
  const inspected = inspectReleaseVersionSurfaces(directory, parsed.expectedVersion);
  if (!inspected.report.valid) throw new ReleaseVersionValidationError(inspected.report);
  if (process.env.GITHUB_SHA) {
    const taggedSha = execFileSync('git', ['rev-list', '-n', '1', tag], {
      cwd: directory,
      encoding: 'utf8',
    }).trim().toLowerCase();
    assert.equal(taggedSha, process.env.GITHUB_SHA.toLowerCase(),
      `release tag ${tag} does not point to GITHUB_SHA`);
  }
  return JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
}

function npmInvocation(args, npmCli = process.env.npm_execpath) {
  assert(npmCli, 'Run release preparation through npm so npm_execpath is available.');
  return [process.execPath, [npmCli, ...args]];
}

export function prepareRelease(tag, outputDirectory, directory = root, dependencies = {}) {
  verifyReleaseVersions(tag, directory);
  const execute = dependencies.execFileSync ?? execFileSync;
  const [npm, packArgs] = npmInvocation([
    'pack', '--json', '--ignore-scripts', '--pack-destination', resolve(directory, outputDirectory),
  ], dependencies.npmExecPath);
  const [npmForSbom, sbomArgs] = npmInvocation([
    'sbom', '--sbom-format', 'cyclonedx',
  ], dependencies.npmExecPath);
  const output = resolve(directory, outputDirectory);
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const pack = JSON.parse(execute(npm, packArgs, {
    cwd: directory, encoding: 'utf8',
  }))[0];
  const tarball = resolve(output, basename(pack.filename));
  const sbom = execute(npmForSbom, sbomArgs, {
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
  try {
    console.log(JSON.stringify(prepareRelease(tag, output), null, 2));
  } catch (error) {
    if (!(error instanceof ReleaseVersionValidationError)) throw error;
    process.stderr.write(`${JSON.stringify(error.report)}\n`);
    process.exitCode = 1;
  }
}
