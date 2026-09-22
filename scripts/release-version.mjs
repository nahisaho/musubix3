import {
  chmodSync, closeSync, existsSync, fsyncSync, lstatSync, openSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import {
  dirname, isAbsolute, relative, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION_SOURCE = '(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[A-Za-z-][0-9A-Za-z-]*)(?:\\.(?:0|[1-9][0-9]*|[A-Za-z-][0-9A-Za-z-]*))*)?';
const VERSION_PATTERN = new RegExp(`^${VERSION_SOURCE}$`);
const scriptRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function diagnostic(reason, path = null, location = null, expected = null, actual = null) {
  return { path, location, expected, actual, reason };
}

function compareNullable(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareCodePoints(left, right);
}

function compareCodePoints(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function sortDiagnostics(diagnostics) {
  return diagnostics.sort((left, right) =>
    compareNullable(left.path, right.path)
    || (left.path === null ? compareCodePoints(left.reason, right.reason) : 0)
    || compareLocations(left.location, right.location));
}

function compareLocations(left, right) {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  if (/^[1-9][0-9]*$/.test(left) && /^[1-9][0-9]*$/.test(right)) {
    return Number(left) - Number(right);
  }
  return compareCodePoints(left, right);
}

function invalidArguments() {
  return {
    valid: false,
    expectedVersion: null,
    diagnostics: [diagnostic('invalid-arguments')],
  };
}

export function parseReleaseVersionArguments(args) {
  if (args.length === 1 && VERSION_PATTERN.test(args[0])) {
    return { mode: 'update', expectedVersion: args[0] };
  }
  if (args.length === 2 && args[0] === '--check' && VERSION_PATTERN.test(args[1])) {
    return { mode: 'check', expectedVersion: args[1] };
  }
  return invalidArguments();
}

function pathName(root, absolute) {
  return relative(root, absolute).split(sep).join('/');
}

function readSource(root, path, diagnostics, missingReason = 'missing-file') {
  try {
    const absolute = resolve(root, path);
    const stat = lstatSync(absolute);
    if (!stat.isFile()) {
      diagnostics.push(diagnostic(missingReason, path));
      return null;
    }
    return {
      path, absolute, raw: readFileSync(absolute, 'utf8'), mode: stat.mode & 0o7777,
    };
  } catch {
    diagnostics.push(diagnostic(missingReason, path));
    return null;
  }
}

function parseJson(source, diagnostics) {
  if (!source) return null;
  try {
    return { ...source, value: JSON.parse(source.raw), ranges: jsonStringRanges(source.raw) };
  } catch {
    diagnostics.push(diagnostic('parse-error', source.path));
    return null;
  }
}

function jsonStringRanges(raw) {
  const ranges = new Map();
  let offset = 0;
  const skipWhitespace = () => {
    while (/\s/.test(raw[offset] ?? '')) offset += 1;
  };
  const parseString = () => {
    const start = offset;
    offset += 1;
    while (offset < raw.length && raw[offset] !== '"') {
      if (raw[offset] === '\\') offset += 1;
      offset += 1;
    }
    if (raw[offset] !== '"') throw new SyntaxError('unterminated JSON string');
    offset += 1;
    return {
      value: JSON.parse(raw.slice(start, offset)),
      index: start + 1,
      length: offset - start - 2,
    };
  };
  const pointerSegment = (value) => value.replaceAll('~', '~0').replaceAll('/', '~1');
  const addRange = (pointer, range) => {
    const existing = ranges.get(pointer) ?? [];
    existing.push(range);
    ranges.set(pointer, existing);
  };
  const parseValue = (pointer) => {
    skipWhitespace();
    if (raw[offset] === '"') {
      addRange(pointer, parseString());
      return;
    }
    if (raw[offset] === '{') {
      offset += 1;
      skipWhitespace();
      if (raw[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < raw.length) {
        skipWhitespace();
        const key = parseString().value;
        skipWhitespace();
        if (raw[offset] !== ':') throw new SyntaxError('invalid JSON object');
        offset += 1;
        parseValue(`${pointer}/${pointerSegment(key)}`);
        skipWhitespace();
        if (raw[offset] === '}') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new SyntaxError('invalid JSON object');
        offset += 1;
      }
      throw new SyntaxError('unterminated JSON object');
    }
    if (raw[offset] === '[') {
      offset += 1;
      skipWhitespace();
      if (raw[offset] === ']') {
        offset += 1;
        return;
      }
      let index = 0;
      while (offset < raw.length) {
        parseValue(`${pointer}/${index}`);
        index += 1;
        skipWhitespace();
        if (raw[offset] === ']') {
          offset += 1;
          return;
        }
        if (raw[offset] !== ',') throw new SyntaxError('invalid JSON array');
        offset += 1;
      }
      throw new SyntaxError('unterminated JSON array');
    }
    while (offset < raw.length && !/[\s,\]}]/.test(raw[offset])) offset += 1;
  };
  parseValue('');
  skipWhitespace();
  if (offset !== raw.length) throw new SyntaxError('trailing JSON content');
  return ranges;
}

function jsonValue(source, pointer, segments, expectedVersion, diagnostics) {
  let value = source.value;
  for (const segment of segments) {
    if (value === null || typeof value !== 'object' || !(segment in value)) {
      diagnostics.push(diagnostic('missing-location', source.path, pointer, expectedVersion));
      return null;
    }
    value = value[segment];
  }
  if (typeof value !== 'string') {
    diagnostics.push(diagnostic('missing-location', source.path, pointer, expectedVersion));
    return null;
  }
  const ranges = source.ranges.get(pointer) ?? [];
  if (ranges.length !== 1) {
    diagnostics.push(diagnostic(
      ranges.length === 0 ? 'missing-location' : 'occurrence-count',
      source.path,
      pointer,
      ranges.length === 0 ? expectedVersion : '1',
      ranges.length === 0 ? null : String(ranges.length),
    ));
    return null;
  }
  if (value !== expectedVersion) {
    diagnostics.push(diagnostic('version-mismatch', source.path, pointer, expectedVersion, value));
  }
  return {
    source, pointer, segments, actual: value, index: ranges[0].index, length: ranges[0].length,
  };
}

function workspacePaths(root, pkg, diagnostics) {
  const patterns = pkg.value.workspaces;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    diagnostics.push(diagnostic('workspace-resolution', 'package.json', '/workspaces'));
    return [];
  }
  const workspaces = [];
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !/^[^*]+\/\*$/.test(pattern) || pattern.includes('\\')) {
      diagnostics.push(diagnostic('workspace-resolution', 'package.json', '/workspaces', null, String(pattern)));
      continue;
    }
    const parent = pattern.slice(0, -2);
    const absoluteParent = resolve(root, parent);
    const relativeParent = relative(root, absoluteParent);
    if (
      parent.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
      || relativeParent === ''
      || relativeParent === '..'
      || relativeParent.startsWith(`..${sep}`)
      || isAbsolute(relativeParent)
    ) {
      diagnostics.push(diagnostic('workspace-resolution', 'package.json', '/workspaces', null, pattern));
      continue;
    }
    let entries;
    try {
      entries = readdirSync(absoluteParent, { withFileTypes: true }).sort(
        (left, right) => compareCodePoints(left.name, right.name),
      );
    } catch {
      diagnostics.push(diagnostic('workspace-resolution', 'package.json', '/workspaces', null, pattern));
      continue;
    }
    const directories = entries.filter((entry) => entry.isDirectory());
    for (const entry of entries.filter((item) => item.isSymbolicLink())) {
      try {
        if (!statSync(resolve(absoluteParent, entry.name)).isDirectory()) continue;
      } catch {
        // A broken link cannot be classified as a workspace candidate.
        continue;
      }
      diagnostics.push(diagnostic(
        'workspace-resolution', 'package.json', '/workspaces', null, `${parent}/${entry.name}`,
      ));
    }
    if (directories.length === 0) {
      diagnostics.push(diagnostic('workspace-resolution', 'package.json', '/workspaces', null, pattern));
      continue;
    }
    for (const entry of directories) workspaces.push(`${parent}/${entry.name}`);
  }
  return [...new Set(workspaces)].sort();
}

function textLocations(source, expression, expectedCount, expectedVersion, diagnostics, prefixLength = 0) {
  if (!source) return [];
  const matches = [...source.raw.matchAll(expression)];
  if (matches.length === 0) {
    diagnostics.push(diagnostic('missing-location', source.path, null, expectedVersion));
    return [];
  }

  if (matches.length !== expectedCount) {
    diagnostics.push(diagnostic('occurrence-count', source.path, null, String(expectedCount), String(matches.length)));
    return [];
  }
  return matches.map((match) => {
    const index = (match.index ?? 0) + prefixLength + match[0].indexOf(match[1]);
    const line = String(source.raw.slice(0, index).split('\n').length);
    if (match[1] !== expectedVersion) {
      diagnostics.push(diagnostic('version-mismatch', source.path, line, expectedVersion, match[1]));
    }
    return { source, index, length: match[1].length, line, actual: match[1] };
  });
}

export class ReleaseVersionValidationError extends Error {
  constructor(report) {
    super('Release version validation failed');
    this.name = 'ReleaseVersionValidationError';
    this.report = report;
  }
}

/** @id CODE-RELEASE-VERSION-SYNCHRONIZATION-001
 * @implements REQ-RELEASE-VERSION-SYNCHRONIZATION-001 REQ-RELEASE-VERSION-SYNCHRONIZATION-002 REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-005 REQ-RELEASE-VERSION-SYNCHRONIZATION-008
 * @design DES-RELEASE-VERSION-SYNCHRONIZATION-001 DES-RELEASE-VERSION-SYNCHRONIZATION-002
 */
export function inspectReleaseVersionSurfaces(root, expectedVersion) {
  if (!VERSION_PATTERN.test(expectedVersion)) return { report: invalidArguments(), snapshot: null };
  const diagnostics = [];
  const sources = new Map();
  const json = (path) => {
    const parsed = parseJson(readSource(root, path, diagnostics), diagnostics);
    if (parsed) sources.set(path, parsed);
    return parsed;
  };
  const text = (path) => {
    const source = readSource(root, path, diagnostics);
    if (source) sources.set(path, source);
    return source;
  };

  const pkg = json('package.json');
  const lock = json('package-lock.json');
  const plugin = json('plugin.json');
  const marketplace = json('.github/plugin/marketplace.json');
  const locations = [];

  if (pkg) locations.push(jsonValue(pkg, '/version', ['version'], expectedVersion, diagnostics));
  const workspaces = pkg ? workspacePaths(root, pkg, diagnostics) : [];
  for (const workspace of workspaces) {
    const manifestPath = `${workspace}/package.json`;
    const manifest = parseJson(readSource(root, manifestPath, diagnostics, 'workspace-resolution'), diagnostics);
    if (manifest) sources.set(manifestPath, manifest);
    if (manifest) locations.push(jsonValue(manifest, '/version', ['version'], expectedVersion, diagnostics));
  }
  if (lock) {
    locations.push(jsonValue(lock, '/version', ['version'], expectedVersion, diagnostics));
    locations.push(jsonValue(lock, '/packages//version', ['packages', '', 'version'], expectedVersion, diagnostics));
    for (const workspace of workspaces) {
      locations.push(jsonValue(
        lock,
        `/packages/${workspace.replaceAll('~', '~0').replaceAll('/', '~1')}/version`,
        ['packages', workspace, 'version'],
        expectedVersion,
        diagnostics,
      ));
    }
  }
  if (plugin) locations.push(jsonValue(plugin, '/version', ['version'], expectedVersion, diagnostics));
  if (marketplace) {
    locations.push(jsonValue(marketplace, '/metadata/version', ['metadata', 'version'], expectedVersion, diagnostics));
    if (!Array.isArray(marketplace.value.plugins) || marketplace.value.plugins.length !== 1) {
      diagnostics.push(diagnostic(
        marketplace.value.plugins?.length ? 'occurrence-count' : 'missing-location',
        marketplace.path,
        '/plugins',
        '1',
        Array.isArray(marketplace.value.plugins) ? String(marketplace.value.plugins.length) : null,
      ));
    } else {
      locations.push(jsonValue(
        marketplace, '/plugins/0/version', ['plugins', '0', 'version'], expectedVersion, diagnostics,
      ));
    }
  }

  const main = text('packages/cli/src/main.ts');
  const tests = text('tests/cli-package.test.ts');
  const readme = text('README.md');
  const readmeJa = text('README-ja.md');
  locations.push(...textLocations(
    main, new RegExp(`\\.version\\('(${VERSION_SOURCE})'\\)`, 'g'), 1, expectedVersion, diagnostics,
  ));
  locations.push(...textLocations(
    tests, new RegExp(`toBe\\('(${VERSION_SOURCE})'\\)`, 'g'), 2, expectedVersion, diagnostics,
  ));
  locations.push(...textLocations(
    readme, new RegExp(`^\\*\\*Latest release v(${VERSION_SOURCE})`, 'gm'), 1, expectedVersion, diagnostics,
  ));
  locations.push(...textLocations(
    readmeJa, new RegExp(`^\\*\\*最新リリース v(${VERSION_SOURCE})`, 'gm'), 1, expectedVersion, diagnostics,
  ));

  const report = {
    valid: diagnostics.length === 0,
    expectedVersion,
    diagnostics: sortDiagnostics(diagnostics),
  };
  return {
    report,
    snapshot: {
      root,
      expectedVersion,
      sources,
      locations: locations.filter(Boolean),
    },
  };
}

function updateJson(source, locations, expectedVersion) {
  return updateText(source, locations, expectedVersion);
}

function updateText(source, locations, expectedVersion) {
  const replacements = locations
    .filter((item) => item.source.path === source.path && item.index !== undefined)
    .sort((left, right) => right.index - left.index);
  let result = source.raw;
  for (const replacement of replacements) {
    result = `${result.slice(0, replacement.index)}${expectedVersion}${result.slice(replacement.index + replacement.length)}`;
  }
  return result;
}

export function planReleaseVersionUpdate(snapshot, expectedVersion) {
  if (!snapshot || snapshot.expectedVersion !== expectedVersion) {
    throw new TypeError('Release version snapshot does not match the expected version');
  }
  const plan = [];
  for (const source of snapshot.sources.values()) {
    const after = 'value' in source
      ? updateJson(source, snapshot.locations, expectedVersion)
      : updateText(source, snapshot.locations, expectedVersion);
    if (after !== source.raw) {
      plan.push({
        path: source.path,
        absolute: source.absolute,
        before: source.raw,
        after,
        kind: 'value' in source ? 'json' : 'text',
        permissionMode: source.mode,
        expectedVersion,
      });
    }
  }
  plan.sort((left, right) => compareCodePoints(left.path, right.path));
  Object.defineProperty(plan, 'expectedVersion', { value: expectedVersion });
  return plan;
}

let transactionSequence = 0;

function syncFile(path, operations, flags = 'r+') {
  let descriptor;
  try {
    descriptor = operations.openSync(path, flags);
    operations.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) operations.closeSync(descriptor);
  }
}

function syncDirectory(path, operations) {
  try {
    syncFile(path, operations, 'r');
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EBADF', 'EISDIR', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
  }
}

function writeError(path, expectedVersion = null) {
  return diagnostic('write-error', path, null, expectedVersion, null);
}

/** @id CODE-RELEASE-VERSION-SYNCHRONIZATION-003
 * @implements REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004
 * @design DES-RELEASE-VERSION-SYNCHRONIZATION-003
 */
export function commitReleaseVersionPlan(plan, dependencies = {}) {
  const operations = {
    chmodSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync,
    ...dependencies,
  };
  const expectedVersion = plan.expectedVersion ?? plan[0]?.expectedVersion ?? null;
  const suffix = `.musubix-release-version-${process.pid}-${transactionSequence += 1}`;
  const states = plan.map((entry) => ({
    entry,
    stage: `${entry.absolute}${suffix}.stage`,
    backup: `${entry.absolute}${suffix}.backup`,
    targetMoved: false,
  }));
  let failedPath = null;

  try {
    for (const state of states) {
      failedPath = state.entry.path;
      if (operations.readFileSync(state.entry.absolute, 'utf8') !== state.entry.before) {
        throw new Error('stale release version plan');
      }
    }
    for (const state of states) {
      failedPath = state.entry.path;
      operations.writeFileSync(state.stage, state.entry.after, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      syncFile(state.stage, operations);
      operations.chmodSync(state.stage, state.entry.permissionMode);
    }
    for (const state of states) {
      failedPath = state.entry.path;
      operations.renameSync(state.entry.absolute, state.backup);
      state.targetMoved = true;
      operations.renameSync(state.stage, state.entry.absolute);
      operations.chmodSync(state.entry.absolute, state.entry.permissionMode);
      syncDirectory(dirname(state.entry.absolute), operations);
    }
    for (const state of states) {
      failedPath = state.entry.path;
      operations.rmSync(state.backup);
    }
    return { valid: true, expectedVersion, diagnostics: [] };
  } catch {
    const rollbackDiagnostics = [];
    for (const state of [...states].reverse()) {
      try {
        if (state.targetMoved) {
          if (operations.existsSync(state.backup)) {
            if (operations.existsSync(state.entry.absolute)) operations.rmSync(state.entry.absolute);
            operations.renameSync(state.backup, state.entry.absolute);
          } else {
            operations.writeFileSync(state.entry.absolute, state.entry.before, 'utf8');
          }
          operations.chmodSync(state.entry.absolute, state.entry.permissionMode);
          syncDirectory(dirname(state.entry.absolute), operations);
        }
        if (operations.existsSync(state.stage)) operations.rmSync(state.stage);
        if (operations.existsSync(state.backup)) operations.rmSync(state.backup);
      } catch {
        rollbackDiagnostics.push(writeError(state.entry.path));
      }
    }
    rollbackDiagnostics.sort((left, right) => compareNullable(left.path, right.path));
    return {
      valid: false,
      expectedVersion,
      diagnostics: [writeError(failedPath, expectedVersion), ...rollbackDiagnostics],
    };
  }
}

/** @id CODE-RELEASE-VERSION-SYNCHRONIZATION-002
 * @implements REQ-RELEASE-VERSION-SYNCHRONIZATION-001 REQ-RELEASE-VERSION-SYNCHRONIZATION-002 REQ-RELEASE-VERSION-SYNCHRONIZATION-003 REQ-RELEASE-VERSION-SYNCHRONIZATION-004 REQ-RELEASE-VERSION-SYNCHRONIZATION-005 REQ-RELEASE-VERSION-SYNCHRONIZATION-008
 * @design DES-RELEASE-VERSION-SYNCHRONIZATION-002 DES-RELEASE-VERSION-SYNCHRONIZATION-003 DES-RELEASE-VERSION-SYNCHRONIZATION-004
 */
export function runReleaseVersion(args, root = scriptRoot, dependencies = {}) {
  const parsed = parseReleaseVersionArguments(args);
  if ('valid' in parsed) return parsed;
  const inspected = inspectReleaseVersionSurfaces(root, parsed.expectedVersion);
  if (parsed.mode === 'check') return inspected.report;
  const blocking = inspected.report.diagnostics.filter((item) => item.reason !== 'version-mismatch');
  if (blocking.length > 0 || !inspected.snapshot) {
    return { ...inspected.report, diagnostics: blocking };
  }
  const plan = planReleaseVersionUpdate(inspected.snapshot, parsed.expectedVersion);
  if (plan.length === 0) return { valid: true, expectedVersion: parsed.expectedVersion, diagnostics: [] };
  return commitReleaseVersionPlan(plan, dependencies);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runReleaseVersion(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.valid) process.exitCode = 1;
}
