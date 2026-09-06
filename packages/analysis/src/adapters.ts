import { dirname } from 'node:path';
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

function reportPath(commandName: string, testId?: string, adapter?: TestAdapter): string {
  const suffix = adapter === 'junit' ? '' : '.json';
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
  const entries = (await readdir(absolutePath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xml'))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!entries.length) return null;
  return (await Promise.all(entries.map((entry) => readFile(`${absolutePath}/${entry.name}`, 'utf8')))).join('\n');
}

function idOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /(?:^|[^A-Za-z0-9])(TEST[-_](?!TEST[-_])[A-Z0-9_-]*\d{3,})\b/i.exec(value);
  return match?.[1]?.toUpperCase().replaceAll('_', '-') ?? null;
}

function status(value: unknown): MusubixTestReport['tests'][number]['status'] {
  const normalized = String(value).toLowerCase();
  if (['pass', 'passed', 'success', 'ok'].includes(normalized)) return 'passed';
  if (['skip', 'skipped', 'pending', 'todo', 'ignored'].includes(normalized)) return 'skipped';
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
  } else {
    for (const match of text.matchAll(/<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g)) {
      const attributes = match[1] ?? match[3] ?? '';
      const id = idOf(/\b(?:name|classname)="([^"]*)"/.exec(attributes)?.[1]);
      if (!id) continue;
      const body = match[2] ?? '';
      tests.push({ id, status: /<(?:error)\b/.test(body) ? 'error' : /<failure\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed' });
    }
  }
  const normalized = unique(tests);
  const selected = targetTestId
    ? { ...normalized, tests: normalized.tests.filter((test) => test.id === targetTestId) }
    : normalized;
  if (!selected.tests.length) throw new Error(`No annotated TEST-* identities were found in the ${adapter} report.`);
  return selected;
}
