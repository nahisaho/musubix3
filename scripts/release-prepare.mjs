import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  inspectReleaseVersionSurfaces,
  parseReleaseVersionArguments,
  ReleaseVersionValidationError,
} from './release-version.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseStage = 'release';

export class ReleaseApprovalValidationError extends Error {
  constructor(report) {
    super(`release approval is ${report.status}`);
    this.name = 'ReleaseApprovalValidationError';
    this.report = report;
  }
}

async function releaseApprovalApi(directory) {
  const path = resolve(directory, 'dist/packages/analysis/src/index.js');
  try {
    return await import(pathToFileURL(path).href);
  } catch (cause) {
    const error = new Error(`Built release approval API is unavailable at ${path}. Run npm run build before release preparation.`);
    error.code = 'RELEASE_APPROVAL_BUILD_MISSING';
    error.cause = cause;
    throw error;
  }
}

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

function caseInsensitiveEnvironmentValue(environment, name) {
  if (environment[name]) return environment[name];
  const match = Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase());
  return match ? environment[match] : undefined;
}

function npmInvocation(args, npmCli = caseInsensitiveEnvironmentValue(process.env, 'npm_execpath')) {
  assert(npmCli, 'Run release preparation through npm so npm_execpath is available.');
  return [process.execPath, [npmCli, ...args]];
}

/** @id CODE-RELEASE-APPROVAL-ORDERING-003
 * @implements REQ-RELEASE-APPROVAL-ORDERING-001 REQ-RELEASE-APPROVAL-ORDERING-002 REQ-RELEASE-APPROVAL-ORDERING-003 REQ-RELEASE-APPROVAL-ORDERING-004
 * @design DES-RELEASE-APPROVAL-ORDERING-002 DES-RELEASE-APPROVAL-ORDERING-003
 */
export async function verifyReleaseApproval(tag, directory = root, dependencies = {}) {
  const analysis = dependencies.analysis ?? await releaseApprovalApi(directory);
  const config = dependencies.approvalConfig ?? (await analysis.loadConfig(directory)).approval;
  return analysis.validateReleaseApprovalForTag(directory, tag, config);
}

export async function prepareRelease(tag, outputDirectory, directory = root, dependencies = {}) {
  (dependencies.verifyReleaseVersions ?? verifyReleaseVersions)(tag, directory);
  const execute = dependencies.execFileSync ?? execFileSync;
  const [npmForBuild, buildArgs] = npmInvocation(['run', 'build'], dependencies.npmExecPath);
  execute(npmForBuild, buildArgs, { cwd: directory, encoding: 'utf8' });
  const approval = await verifyReleaseApproval(tag, directory, dependencies);
  if (!approval.valid) throw new ReleaseApprovalValidationError(approval);
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
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...args) => {
    const options = args[0];
    const code = typeof options === 'object' && options !== null ? options.code : args[1];
    if (code !== 'MODULE_TYPELESS_PACKAGE_JSON') emitWarning(warning, ...args);
  };
  const main = async () => {
    const tag = argument('--tag', process.env.RELEASE_TAG);
    const output = argument('--output', 'release-assets');
    assert(tag, 'provide --tag or RELEASE_TAG');
    const prepared = await prepareRelease(tag, output);
    process.stdout.write(`${JSON.stringify(prepared, null, 2)}\n`);
  };
  await main().catch((error) => {
    if (error instanceof ReleaseVersionValidationError || error instanceof ReleaseApprovalValidationError) {
      process.stderr.write(`${JSON.stringify(error.report)}\n`);
      process.exitCode = 1;
      return;
    }
    if (error && typeof error === 'object' && typeof error.code === 'string'
      && error.code.startsWith('RELEASE_APPROVAL_')) {
      process.stderr.write(`${JSON.stringify({
        valid: false,
        stage: releaseStage,
        error: { code: error.code, message: error.message },
      })}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}
