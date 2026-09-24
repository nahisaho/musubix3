import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync, readFileSync, readdirSync,
} from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const stableTag = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const repositoryName = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const maxTarBytes = 64 * 1024 * 1024;
const verifiedAssetBytes = new WeakMap();

function codePointOrder(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export class ReleasePublishValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleasePublishValidationError';
    this.code = code;
  }
}

function reject(code, message) {
  throw new ReleasePublishValidationError(code, message);
}

function requireTrimmed(value, name) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    reject('RELEASE_PUBLISH_ARGUMENTS', `${name} must be a nonempty value without surrounding whitespace.`);
  }
  return value;
}

function requireRegularFile(path, code, name, inspect = lstatSync) {
  let status;
  try {
    status = inspect(path);
  } catch (cause) {
    const error = new ReleasePublishValidationError(code, `${name} is unavailable at ${path}.`);
    error.cause = cause;
    throw error;
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    reject(code, `${name} must be a regular non-symlink file at ${path}.`);
  }
}

/** @id CODE-RELEASE-ASSET-PUBLISHING-001
 * @implements REQ-RELEASE-ASSET-PUBLISHING-001
 * @design DES-RELEASE-ASSET-PUBLISHING-001
 */
export function parseReleasePublishArguments(
  args,
  cwd = process.cwd(),
  npmExecPath,
) {
  const verifyOnly = args[0] === '--verify-only';
  const offset = verifyOnly ? 1 : 0;
  if (args.length !== offset + 6
    || args[offset] !== '--tag'
    || args[offset + 2] !== '--repository'
    || args[offset + 4] !== '--directory') {
    reject(
      'RELEASE_PUBLISH_ARGUMENTS',
      'Use --verify-only? --tag <vMAJOR.MINOR.PATCH> --repository <owner/repo> --directory <path>.',
    );
  }
  const tag = requireTrimmed(args[offset + 1], '--tag');
  const repository = requireTrimmed(args[offset + 3], '--repository');
  const directoryValue = requireTrimmed(args[offset + 5], '--directory');
  const match = stableTag.exec(tag);
  if (!match) reject('RELEASE_PUBLISH_TAG', `Release tag must be stable vMAJOR.MINOR.PATCH: ${tag}`);
  const repositorySegments = repository.split('/');
  if (!repositoryName.test(repository)
    || repositorySegments.some((segment) => segment === '.' || segment === '..')) {
    reject('RELEASE_PUBLISH_REPOSITORY', `repository must be owner/repo: ${repository}`);
  }
  const cli = requireTrimmed(npmExecPath, 'npm_execpath');
  requireRegularFile(cli, 'RELEASE_PUBLISH_NPM_CLI', 'npm_execpath');
  if (!cli.endsWith('.js')) reject('RELEASE_PUBLISH_NPM_CLI', 'npm_execpath must reference a .js file.');
  return {
    verifyOnly,
    tag,
    version: tag.slice(1),
    repository,
    directory: resolve(cwd, directoryValue),
    npmExecPath: resolve(cli),
  };
}

function requireAssetDirectory(directory, inspect = lstatSync) {
  let status;
  try {
    status = inspect(directory);
  } catch (cause) {
    const error = new ReleasePublishValidationError(
      'RELEASE_PUBLISH_DIRECTORY',
      `Release asset directory is unavailable: ${directory}`,
    );
    error.cause = cause;
    throw error;
  }
  if (status.isSymbolicLink() || !status.isDirectory()) {
    reject('RELEASE_PUBLISH_DIRECTORY', `Release asset path must be a real directory: ${directory}`);
  }
}

function expectedAssetNames(version) {
  return [
    'SHA256SUMS',
    `musubix3-${version}.tgz`,
    'musubix3-attestation.json',
    'musubix3.cdx.json',
  ].sort(codePointOrder);
}

function parseChecksums(text, tarballName) {
  if (!text.endsWith('\n') || text.endsWith('\n\n') || text.includes('\r')) {
    reject('RELEASE_PUBLISH_CHECKSUMS', 'SHA256SUMS must end with exactly one LF newline.');
  }
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== 2) {
    reject('RELEASE_PUBLISH_CHECKSUMS', 'SHA256SUMS must contain exactly two entries.');
  }
  const expected = new Set([tarballName, 'musubix3.cdx.json']);
  const result = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/*\\][^/\\]*)$/.exec(line);
    if (!match || !expected.has(match[2])) {
      reject('RELEASE_PUBLISH_CHECKSUMS', `Invalid SHA256SUMS entry: ${line}`);
    }
    if (result.has(match[2])) {
      reject('RELEASE_PUBLISH_CHECKSUMS', `Duplicate SHA256SUMS entry: ${match[2]}`);
    }
    result.set(match[2], match[1]);
  }
  if (result.size !== expected.size) reject('RELEASE_PUBLISH_CHECKSUMS', 'SHA256SUMS entries are incomplete.');
  return result;
}

/** @id CODE-RELEASE-ASSET-PUBLISHING-002
 * @implements REQ-RELEASE-ASSET-PUBLISHING-002 REQ-RELEASE-ASSET-PUBLISHING-003
 * @design DES-RELEASE-ASSET-PUBLISHING-002
 */
export function validateLocalReleaseAssets(request, dependencies = {}) {
  const inspect = dependencies.lstatSync ?? lstatSync;
  const enumerate = dependencies.readdirSync ?? readdirSync;
  const read = dependencies.readFileSync ?? readFileSync;
  requireAssetDirectory(request.directory, inspect);
  let observed;
  try {
    observed = enumerate(request.directory).sort(codePointOrder);
  } catch (cause) {
    const error = new ReleasePublishValidationError(
      'RELEASE_PUBLISH_DIRECTORY',
      `Cannot enumerate release asset directory: ${request.directory}`,
    );
    error.cause = cause;
    throw error;
  }
  const expected = expectedAssetNames(request.version);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    const tarballs = observed.filter((name) => name.endsWith('.tgz'));
    reject(
      'RELEASE_PUBLISH_ASSET_SET',
      `Expected assets ${expected.join(', ')}; observed tarballs ${tarballs.join(', ') || '(none)'}.`,
    );
  }
  const bytesByName = new Map();
  const assets = observed.map((name) => {
    const path = resolve(request.directory, name);
    requireRegularFile(path, 'RELEASE_PUBLISH_ASSET_FILE', name, inspect);
    const bytes = read(path);
    bytesByName.set(name, bytes);
    return { name, path, sha256: sha256(bytes) };
  });
  const tarballName = `musubix3-${request.version}.tgz`;
  const checksumBytes = bytesByName.get('SHA256SUMS');
  assert(checksumBytes, 'validated checksum asset is missing');
  const checksums = parseChecksums(
    checksumBytes.toString('utf8'),
    tarballName,
  );
  for (const name of [tarballName, 'musubix3.cdx.json']) {
    const actual = assets.find((asset) => asset.name === name)?.sha256;
    if (actual !== checksums.get(name)) {
      reject('RELEASE_PUBLISH_CHECKSUM_MISMATCH', `SHA256 mismatch for ${name}.`);
    }
  }
  const result = {
    request,
    tarball: resolve(request.directory, tarballName),
    assets,
  };
  verifiedAssetBytes.set(result, bytesByName);
  return result;
}

function parseGithubRelease(text, request, localAssets) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    const error = new ReleasePublishValidationError(
      'RELEASE_PUBLISH_GITHUB_SCHEMA',
      'GitHub Release query returned invalid JSON.',
    );
    error.cause = cause;
    throw error;
  }
  if (!value || typeof value !== 'object'
    || value.tagName !== request.tag
    || value.isDraft !== false
    || !Array.isArray(value.assets)) {
    reject('RELEASE_PUBLISH_GITHUB_SCHEMA', 'GitHub Release identity or draft state is invalid.');
  }
  const expected = expectedAssetNames(request.version);
  const observed = value.assets.map((asset) => asset?.name).sort(codePointOrder);
  if (observed.some((name) => typeof name !== 'string')
    || JSON.stringify(observed) !== JSON.stringify(expected)) {
    reject('RELEASE_PUBLISH_GITHUB_ASSETS', 'GitHub Release asset set does not match the required set.');
  }
  const seen = new Set();
  for (const asset of value.assets) {
    if (!asset || typeof asset !== 'object'
      || typeof asset.name !== 'string'
      || asset.state !== 'uploaded'
      || typeof asset.digest !== 'string'
      || !asset.digest.startsWith('sha256:')
      || !sha256Pattern.test(asset.digest.slice(7))
      || seen.has(asset.name)) {
      reject('RELEASE_PUBLISH_GITHUB_ASSETS', 'GitHub Release asset metadata is invalid.');
    }
    seen.add(asset.name);
    const local = localAssets.find((entry) => entry.name === asset.name);
    if (!local || local.sha256 !== asset.digest.slice(7)) {
      reject('RELEASE_PUBLISH_GITHUB_DIGEST', `GitHub Release digest mismatch for ${asset.name}.`);
    }
  }
}

/** @id CODE-RELEASE-ASSET-PUBLISHING-003
 * @implements REQ-RELEASE-ASSET-PUBLISHING-003 REQ-RELEASE-ASSET-PUBLISHING-004
 * @design DES-RELEASE-ASSET-PUBLISHING-003
 */
export function bindGithubReleaseAssets(local, dependencies = {}) {
  const execute = dependencies.execFileSync ?? execFileSync;
  let output;
  try {
    output = execute('gh', [
      'release', 'view', local.request.tag,
      '--repo', local.request.repository,
      '--json', 'tagName,isDraft,assets',
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (cause) {
    const error = new ReleasePublishValidationError(
      'RELEASE_PUBLISH_GITHUB_QUERY',
      `Unable to query GitHub Release ${local.request.repository}@${local.request.tag}.`,
    );
    error.cause = cause;
    throw error;
  }
  const text = Buffer.isBuffer(output) ? output.toString('utf8') : String(output);
  parseGithubRelease(text, local.request, local.assets);
  return local;
}

function tarText(block, offset, length, field) {
  const bytes = block.subarray(offset, offset + length);
  const zero = bytes.indexOf(0);
  const slice = zero < 0 ? bytes : bytes.subarray(0, zero);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice);
  } catch (cause) {
    const error = new ReleasePublishValidationError(
      'RELEASE_PUBLISH_TAR_HEADER',
      `Tar ${field} is not valid UTF-8.`,
    );
    error.cause = cause;
    throw error;
  }
}

function tarOctal(block, offset, length, field) {
  const bytes = block.subarray(offset, offset + length);
  if ((bytes[0] ?? 0) & 0x80) reject('RELEASE_PUBLISH_TAR_HEADER', `Tar ${field} uses unsupported base-256 encoding.`);
  const text = bytes.toString('ascii').replace(/\0.*$/s, '').trim();
  if (!/^[0-7]+$/.test(text)) reject('RELEASE_PUBLISH_TAR_HEADER', `Tar ${field} is not octal.`);
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value)) reject('RELEASE_PUBLISH_TAR_HEADER', `Tar ${field} is out of range.`);
  return value;
}

function validateTarChecksum(block) {
  const expected = tarOctal(block, 148, 8, 'checksum');
  let actual = 0;
  for (let index = 0; index < 512; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : block[index];
  }
  if (actual !== expected) reject('RELEASE_PUBLISH_TAR_HEADER', 'Tar header checksum is invalid.');
}

function safeTarPath(name, prefix) {
  const path = prefix ? `${prefix}/${name}` : name;
  if (!path || isAbsolute(path) || path.startsWith('/') || path.includes('\\')
    || path.split('/').some((part) => part === '..')) {
    reject('RELEASE_PUBLISH_TAR_PATH', `Unsafe tar path: ${path}`);
  }
  return path;
}

function parseNpmManifest(tar, version) {
  let offset = 0;
  let zeroBlocks = 0;
  let manifest = null;
  let manifestSeen = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      offset += 512;
      if (zeroBlocks === 2) break;
      continue;
    }
    if (zeroBlocks !== 0) reject('RELEASE_PUBLISH_TAR_HEADER', 'Tar archive has a nonzero block after an end block.');
    validateTarChecksum(header);
    const name = tarText(header, 0, 100, 'name');
    const prefix = tarText(header, 345, 155, 'prefix');
    const path = safeTarPath(name, prefix);
    const typeByte = header[156] ?? 0;
    const type = typeByte === 0 ? '\0' : String.fromCharCode(typeByte);
    if (!['\0', '0', '5'].includes(type)) {
      reject('RELEASE_PUBLISH_TAR_TYPE', `Unsupported tar entry type ${JSON.stringify(type)} for ${path}.`);
    }
    const size = tarOctal(header, 124, 12, 'size');
    if (type === '5' && size !== 0) reject('RELEASE_PUBLISH_TAR_HEADER', `Tar directory ${path} has content.`);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) reject('RELEASE_PUBLISH_TAR_TRUNCATED', `Tar entry ${path} is truncated.`);
    if ((type === '\0' || type === '0') && path === 'package/package.json') {
      if (prefix || manifestSeen) {
        reject('RELEASE_PUBLISH_PACKAGE_MANIFEST', 'Tarball must contain one unprefixed package/package.json.');
      }
      manifestSeen = true;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(tar.subarray(dataStart, dataEnd));
        manifest = JSON.parse(text);
      } catch (cause) {
        const error = new ReleasePublishValidationError(
          'RELEASE_PUBLISH_PACKAGE_MANIFEST',
          'package/package.json is not valid UTF-8 JSON.',
        );
        error.cause = cause;
        throw error;
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  if (zeroBlocks !== 2) reject('RELEASE_PUBLISH_TAR_TRUNCATED', 'Tar archive is missing two end blocks.');
  if (tar.subarray(offset).some((byte) => byte !== 0)) {
    reject('RELEASE_PUBLISH_TAR_TRAILING', 'Tar archive has trailing nonzero data.');
  }
  if (!manifest || typeof manifest !== 'object'
    || manifest.name !== 'musubix3'
    || manifest.version !== version) {
    reject('RELEASE_PUBLISH_PACKAGE_IDENTITY', 'Tarball package name or version does not match the release tag.');
  }
}

/** @id CODE-RELEASE-ASSET-PUBLISHING-004
 * @implements REQ-RELEASE-ASSET-PUBLISHING-003 REQ-RELEASE-ASSET-PUBLISHING-004
 * @design DES-RELEASE-ASSET-PUBLISHING-004
 */
export function inspectNpmTarball(bound, dependencies = {}) {
  const unzip = dependencies.gunzipSync ?? gunzipSync;
  const tarballBytes = verifiedAssetBytes.get(bound)?.get(`musubix3-${bound.request.version}.tgz`);
  assert(tarballBytes, 'validated tarball bytes are missing');
  let tar;
  try {
    tar = unzip(tarballBytes, { maxOutputLength: maxTarBytes });
  } catch (cause) {
    const error = new ReleasePublishValidationError(
      'RELEASE_PUBLISH_GZIP',
      `Unable to decompress npm tarball within ${maxTarBytes} bytes.`,
    );
    error.cause = cause;
    throw error;
  }
  parseNpmManifest(tar, bound.request.version);
  return {
    valid: true,
    repository: bound.request.repository,
    tag: bound.request.tag,
    version: bound.request.version,
    tarball: bound.tarball,
    assets: bound.assets
      .map(({ name, sha256: digest }) => ({ name, sha256: digest }))
      .sort((left, right) => codePointOrder(left.name, right.name)),
  };
}

export function validateReleaseForPublish(request, dependencies = {}) {
  const local = validateLocalReleaseAssets(request, dependencies);
  const bound = bindGithubReleaseAssets(local, dependencies);
  return inspectNpmTarball(bound, dependencies);
}

/** @id CODE-RELEASE-ASSET-PUBLISHING-005
 * @implements REQ-RELEASE-ASSET-PUBLISHING-001 REQ-RELEASE-ASSET-PUBLISHING-003 REQ-RELEASE-ASSET-PUBLISHING-004
 * @design DES-RELEASE-ASSET-PUBLISHING-005 DES-RELEASE-ASSET-PUBLISHING-006
 */
export function publishReleaseAssets(request, environment = process.env, dependencies = {}) {
  const verification = validateReleaseForPublish(request, dependencies);
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_REPOSITORY !== request.repository) {
    reject('RELEASE_PUBLISH_CI_ONLY', 'Publishing requires matching GitHub Actions repository identity.');
  }
  const publishEnvironment = { ...environment };
  if (!publishEnvironment.NODE_AUTH_TOKEN) delete publishEnvironment.NODE_AUTH_TOKEN;
  const currentTarball = (dependencies.readFileSync ?? readFileSync)(verification.tarball);
  const verifiedTarball = verification.assets.find(({ name }) => name === `musubix3-${request.version}.tgz`);
  if (!verifiedTarball || sha256(currentTarball) !== verifiedTarball.sha256) {
    reject('RELEASE_PUBLISH_TARBALL_CHANGED', 'Validated npm tarball changed before publish.');
  }
  const execute = dependencies.execFileSync ?? execFileSync;
  execute(process.execPath, [
    request.npmExecPath,
    'publish',
    verification.tarball,
    '--provenance',
    '--access',
    'public',
  ], {
    stdio: 'inherit',
    env: publishEnvironment,
  });
  return verification;
}

export function runReleasePublish(args, environment = process.env, dependencies = {}) {
  const request = parseReleasePublishArguments(
    args,
    dependencies.cwd ?? process.cwd(),
    dependencies.npmExecPath ?? environment.npm_execpath,
  );
  if (!request.verifyOnly) return publishReleaseAssets(request, environment, dependencies);
  const verification = validateReleaseForPublish(request, dependencies);
  (dependencies.writeStdout ?? process.stdout.write.bind(process.stdout))(
    `${JSON.stringify(verification)}\n`,
  );
  return verification;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runReleasePublish(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ReleasePublishValidationError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}
