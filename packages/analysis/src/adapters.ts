import { dirname, posix } from 'node:path';
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { exists } from './files.js';
import type { CommandConfig } from './config.js';
import type { MusubixTestReport } from './tdd.js';

export type TestAdapter = NonNullable<CommandConfig['adapter']>;

export interface AdapterInvocation {
  args: string[];
  reportPath: string;
  source: 'file' | 'directory' | 'stdout';
}

const goValueFlags = new Set([
  '-C', '-asmflags', '-bench', '-benchtime', '-blockprofile', '-blockprofilerate',
  '-buildmode', '-compiler',
  '-count', '-covermode', '-coverpkg', '-coverprofile', '-cpu', '-cpuprofile', '-exec',
  '-fuzz', '-fuzzminimizetime', '-fuzztime', '-gccgoflags', '-gcflags',
  '-installsuffix', '-ldflags', '-list', '-memprofile', '-memprofilerate',
  '-mod', '-modfile', '-mutexprofile',
  '-mutexprofilefraction', '-o', '-outputdir', '-overlay', '-p', '-parallel',
  '-pgo', '-pkgdir', '-run', '-shuffle', '-skip', '-tags', '-timeout', '-toolexec', '-trace',
  '-vet',
]);

function partitionGoArgs(args: string[]): {
  flags: string[];
  packages: string[];
  passthrough: string[];
  directory?: string;
} {
  const flags: string[] = [];
  const packages: string[] = [];
  let directory: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '-args') {
      return { flags, packages, passthrough: args.slice(index + 1), ...(directory ? { directory } : {}) };
    }
    if (arg.startsWith('-')) {
      flags.push(arg);
      const flag = arg.split('=', 1)[0]!;
      if (!arg.includes('=') && goValueFlags.has(flag) && args[index + 1] !== undefined) {
        const value = args[++index]!;
        flags.push(value);
        if (flag === '-C') directory = value;
      } else if (flag === '-C' && arg.includes('=')) {
        directory = arg.slice(arg.indexOf('=') + 1);
      }
    } else {
      packages.push(arg);
    }
  }
  return { flags, packages, passthrough: [], ...(directory ? { directory } : {}) };
}

export function mergeAdapterArgs(
  adapter: TestAdapter,
  configuredArgs: string[],
  invocationArgs: string[],
): string[] {
  if (adapter === 'cargo' && configuredArgs[0] === 'test' && invocationArgs[0] === 'test') {
    const configuredSeparator = configuredArgs.indexOf('--');
    const invocationSeparator = invocationArgs.indexOf('--');
    const configuredCommandArgs = configuredSeparator < 0 ? configuredArgs.slice(1) : configuredArgs.slice(1, configuredSeparator);
    const configuredHarnessArgs = configuredSeparator < 0 ? [] : configuredArgs.slice(configuredSeparator + 1);
    const invocationCommandArgs = invocationSeparator < 0 ? invocationArgs.slice(1) : invocationArgs.slice(1, invocationSeparator);
    const invocationHarnessArgs = invocationSeparator < 0 ? [] : invocationArgs.slice(invocationSeparator + 1);
    return [
      'test',
      ...configuredCommandArgs,
      ...invocationCommandArgs,
      ...(configuredHarnessArgs.length || invocationHarnessArgs.length
        ? ['--', ...configuredHarnessArgs, ...invocationHarnessArgs]
        : []),
    ];
  }
  if (adapter === 'go-test' && configuredArgs[0] === 'test' && invocationArgs[0] === 'test') {
    const configured = partitionGoArgs(configuredArgs.slice(1));
    const generatedPackage = invocationArgs[2]!;
    const targeted = invocationArgs.includes('-run');
    if (configured.directory && posix.isAbsolute(configured.directory)) {
      throw new Error('The go-test adapter requires a relative -C directory so it can preserve targeted package scope.');
    }
    const targetedPackage = configured.directory && generatedPackage.startsWith('./')
      ? posix.relative(configured.directory, generatedPackage.slice(2)) || '.'
      : generatedPackage;
    const packages = !targeted && configured.packages.length ? configured.packages : [targetedPackage];
    return [
      'test',
      ...configured.flags,
      '-json',
      ...packages,
      ...invocationArgs.slice(3),
      ...(configured.passthrough.length ? ['-args', ...configured.passthrough] : []),
    ];
  }
  if (adapter === 'dotnet' && configuredArgs[0] === 'test' && invocationArgs[0] === 'test') {
    const separator = configuredArgs.indexOf('--');
    const commandArgs = separator < 0 ? configuredArgs.slice(1) : configuredArgs.slice(1, separator);
    const runSettings = separator < 0 ? [] : configuredArgs.slice(separator + 1);
    return [
      'test',
      ...commandArgs,
      ...invocationArgs.slice(1),
      ...(separator < 0 ? [] : ['--', ...runSettings]),
    ];
  }
  return [...configuredArgs, ...invocationArgs];
}

function reportPath(commandName: string, testId?: string, adapter?: TestAdapter): string {
  const suffix = adapter === 'junit' || adapter === 'dotnet' ? '' : '.json';
  return testId
    ? `.musubix/evidence/native/${commandName}/${testId}${suffix}`
    : `.musubix/evidence/native/${commandName}/aggregate${suffix}`;
}

function identifier(testId: string): string {
  return testId.toLowerCase().replaceAll('-', '_');
}

export function adapterInvocation(
  adapter: TestAdapter,
  commandName: string,
  testId?: string,
  testPath?: string,
): AdapterInvocation {
  const path = reportPath(commandName, testId, adapter);
  if (adapter === 'vitest') {
    return {
      args: [...testPath ? [testPath] : [], ...testId ? ['-t', testId] : [], '--reporter=json', `--outputFile=${path}`],
      reportPath: path,
      source: 'file',
    };
  }
  if (adapter === 'jest') {
    return {
      args: [...testPath ? ['--runTestsByPath', testPath] : [], ...testId ? ['-t', testId] : [], '--json', `--outputFile=${path}`],
      reportPath: path,
      source: 'file',
    };
  }
  if (adapter === 'pytest') {
    return {
      args: [...testPath ? [testPath] : [], ...testId ? ['-k', identifier(testId)] : [], '--json-report', `--json-report-file=${path}`],
      reportPath: path,
      source: 'file',
    };
  }
  if (adapter === 'go-test') {
    const packagePath = testPath ? `./${dirname(testPath)}`.replace(/\/\.$/, '') : './...';
    return { args: ['test', '-json', packagePath, ...testId ? ['-run', `/${testId}`] : []], reportPath: path, source: 'stdout' };
  }
  if (adapter === 'cargo') {
    return { args: ['test', ...testId ? [identifier(testId)] : [], '--', '--format', 'pretty'], reportPath: path, source: 'stdout' };
  }
  if (adapter === 'dotnet') {
    return {
      args: [
        'test',
        '--logger', 'trx;LogFilePrefix=results',
        '--results-directory', path,
        ...testId ? ['--filter', `DisplayName~${testId}|Name~${testId}`] : [],
      ],
      reportPath: path,
      source: 'directory',
    };
  }
  return {
    args: [
      '--scan-class-path',
      ...testId ? [`--include-tag=${testId}`, '--fail-if-no-tests'] : [],
      `--reports-dir=${path}`,
    ],
    reportPath: path,
    source: 'directory',
  };
}

export async function clearAdapterOutput(invocation: AdapterInvocation, absolutePath: string): Promise<void> {
  if (await exists(absolutePath)) {
    if (invocation.source === 'directory') await rm(absolutePath, { recursive: true });
    else await unlink(absolutePath);
  }
  await mkdir(invocation.source === 'directory' ? absolutePath : dirname(absolutePath), { recursive: true });
}

export async function readAdapterOutput(invocation: AdapterInvocation, absolutePath: string, stdout: string): Promise<string | null> {
  if (invocation.source === 'stdout') {
    if (stdout) {
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, stdout);
      return stdout;
    }
    return await exists(absolutePath) ? readFile(absolutePath, 'utf8') : null;
  }
  if (!await exists(absolutePath)) return null;
  if (invocation.source === 'file') return readFile(absolutePath, 'utf8');
  async function xmlFiles(directory: string): Promise<string[]> {
    const found: string[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) found.push(...await xmlFiles(path));
      else if (entry.isFile() && (entry.name.endsWith('.xml') || entry.name.endsWith('.trx'))) found.push(path);
    }
    return found;
  }
  const entries = await xmlFiles(absolutePath);
  if (!entries.length) return null;
  return (await Promise.all(entries.map((entry) => readFile(entry, 'utf8')))).join('\n');
}

function idOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /(?:^|[^A-Za-z0-9])(TEST[-_](?!TEST[-_])[A-Z0-9_-]*\d{3,})\b/i.exec(value);
  return match?.[1]?.toUpperCase().replaceAll('_', '-') ?? null;
}

function status(value: unknown): MusubixTestReport['tests'][number]['status'] {
  const normalized = String(value).toLowerCase();
  if (['pass', 'passed', 'success', 'ok'].includes(normalized)) return 'passed';
  if (['skip', 'skipped', 'pending', 'todo', 'ignored', 'notexecuted'].includes(normalized)) return 'skipped';
  if (['error', 'errored'].includes(normalized)) return 'error';
  return 'failed';
}

function unique(tests: MusubixTestReport['tests']): MusubixTestReport {
  const byId = new Map<string, MusubixTestReport['tests'][number]>();
  for (const test of tests) {
    const previous = byId.get(test.id);
    if (!previous || previous.status === 'skipped' || test.status === 'error' || test.status === 'failed') byId.set(test.id, test);
  }
  return { schemaVersion: 1, tests: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

function xmlAttribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("[^"]*"|'[^']*')`, 'i').exec(attributes);
  if (!match?.[1]) return undefined;
  return match[1].slice(1, -1)
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function dotnetResults(text: string): MusubixTestReport['tests'] {
  const tests: MusubixTestReport['tests'] = [];
  const stack: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) break;
    if (text.startsWith('<!--', start)) {
      const end = text.indexOf('-->', start + 4);
      if (end < 0) throw new Error('Malformed dotnet TRX: unterminated XML comment.');
      cursor = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', start)) {
      const end = text.indexOf(']]>', start + 9);
      if (end < 0) throw new Error('Malformed dotnet TRX: unterminated CDATA section.');
      cursor = end + 3;
      continue;
    }
    if (text.startsWith('<?', start)) {
      const end = text.indexOf('?>', start + 2);
      if (end < 0) throw new Error('Malformed dotnet TRX: unterminated processing instruction.');
      cursor = end + 2;
      continue;
    }
    if (text.startsWith('<!', start)) throw new Error('Malformed dotnet TRX: unsupported declaration.');
    let end = start + 1;
    let quote = '';
    for (; end < text.length; end++) {
      const character = text[end]!;
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    if (end >= text.length) throw new Error('Malformed dotnet TRX: unterminated XML element.');
    const token = text.slice(start + 1, end).trim();
    cursor = end + 1;
    if (!token) throw new Error('Malformed dotnet TRX: empty XML element.');
    if (token.startsWith('/')) {
      const name = token.slice(1).trim().split(/\s/, 1)[0]?.split(':').at(-1);
      if (!name || stack.pop()?.toLowerCase() !== name.toLowerCase()) {
        throw new Error('Malformed dotnet TRX: mismatched XML element.');
      }
      continue;
    }
    const selfClosing = token.endsWith('/');
    const element = selfClosing ? token.slice(0, -1).trim() : token;
    const qualifiedName = element.split(/\s/, 1)[0];
    if (!qualifiedName) throw new Error('Malformed dotnet TRX: missing XML element name.');
    const name = qualifiedName?.split(':').at(-1);
    if (!name) throw new Error('Malformed dotnet TRX: missing XML element name.');
    const attributes = element.slice(qualifiedName.length);
    const hierarchy = [...stack, name].map((part) => part.toLowerCase());
    if (name.toLowerCase() === 'unittestresult'
      && hierarchy.at(-2) === 'results'
      && hierarchy.includes('testrun')) {
      const id = idOf(xmlAttribute(attributes, 'testName'));
      if (id) tests.push({ id, status: status(xmlAttribute(attributes, 'outcome')) });
    }
    if (!selfClosing) stack.push(name);
  }
  if (stack.length) throw new Error('Malformed dotnet TRX: unclosed XML element.');
  return tests;
}

export function normalizeAdapterReport(adapter: TestAdapter, text: string, targetTestId?: string): MusubixTestReport {
  const tests: MusubixTestReport['tests'] = [];
  if (adapter === 'vitest' || adapter === 'jest') {
    const value = JSON.parse(text) as Record<string, unknown>;
    const suites = Array.isArray(value.testResults) ? value.testResults : [];
    for (const suite of suites as Array<Record<string, unknown>>) {
      const assertions = Array.isArray(suite.assertionResults) ? suite.assertionResults : [];
      for (const assertion of assertions as Array<Record<string, unknown>>) {
        const id = idOf(assertion.fullName) ?? idOf(assertion.title);
        if (id) tests.push({ id, status: status(assertion.status) });
      }
    }
  } else if (adapter === 'pytest') {
    const value = JSON.parse(text) as Record<string, unknown>;
    for (const test of (Array.isArray(value.tests) ? value.tests : []) as Array<Record<string, unknown>>) {
      const id = idOf(test.nodeid) ?? idOf(test.name);
      if (id) tests.push({ id, status: status(test.outcome) });
    }
  } else if (adapter === 'go-test') {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const event = JSON.parse(line) as Record<string, unknown>;
      if (!['pass', 'fail', 'skip'].includes(String(event.Action)) || typeof event.Test !== 'string') continue;
      const id = idOf(event.Test);
      if (id) tests.push({ id, status: status(event.Action) });
    }
  } else if (adapter === 'cargo') {
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)\s*$/.exec(line);
      const id = idOf(match?.[1]);
      if (id) tests.push({ id, status: status(match?.[2]) });
    }
  } else if (adapter === 'dotnet') {
    tests.push(...dotnetResults(text));
  } else {
    for (const match of text.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g)) {
      const attributes = match[1] ?? match[3] ?? '';
      const body = match[2] ?? '';
      const identityText = /\bname="([^"]*)"/.exec(attributes)?.[1]
        ?? /\bclassname="([^"]*)"/.exec(attributes)?.[1];
      const displayName = /<system-out\b[^>]*>[\s\S]*?(?:^|\r?\n)\s*display-name:\s*([^\r\n<]+)/m.exec(body)?.[1];
      const id = idOf(identityText) ?? idOf(displayName);
      if (!id) continue;
      tests.push({ id, status: /<(?:error)\b/.test(body) ? 'error' : /<failure\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed' });
    }
  }
  const normalized = unique(tests);
  const selected = targetTestId
    ? { ...normalized, tests: normalized.tests.filter((test) => test.id === targetTestId) }
    : normalized;
  if (!selected.tests.length) {
    const guidance = adapter === 'pytest'
      ? ' Pytest node IDs must include the normalized TEST ID (for example test_TEST_APP_001), or configure a project-local musubix-json runner.'
      : '';
    throw new Error(`No annotated TEST-* identities were found in the ${adapter} report.${guidance}`);
  }
  return selected;
}
