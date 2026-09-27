import { error, type Diagnostic } from '../../domain/src/index.js';
import { digest, exists, readText, within } from './files.js';
import type { TestAdapter } from './adapters.js';
import type { ProcessResult } from './process.js';
import type { MusubixTestReport } from './test-report.js';
import type { TraceGraph } from './trace.js';

type TestResult = MusubixTestReport['tests'][number];

export interface NativeTestEvidenceInput {
  path: string;
  sha256: string;
}

export interface NativeTestEvidence {
  schemaVersion: 1;
  commandName: string;
  commandSha256: string;
  inputFingerprint: string;
  inputs: NativeTestEvidenceInput[];
  adapter: TestAdapter;
  sourceKind: 'file' | 'directory' | 'stdout';
  reportPath: string;
  processStatus: ProcessResult['status'];
  exitCode: number | null;
  tests: TestResult[];
}

export interface NativeTestEvidencePassContext {
  contentSha256ByPath: Map<string, string>;
}

export interface NativeTestEvidenceExpected {
  commandName: string;
  commandSha256: string;
  adapter: TestAdapter;
  sourceKind: NativeTestEvidence['sourceKind'];
  reportPath: string;
}

export class NativeTestEvidenceError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((diagnostic) => diagnostic.message).join(' '));
  }
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareCodepoint(left, right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizedTests(tests: TestResult[]): TestResult[] {
  return tests.map((test) => ({
    id: test.id,
    status: test.status,
    ...(test.operations === undefined ? {} : {
      operations: Object.fromEntries(Object.entries(test.operations)
        .sort(([left], [right]) => compareCodepoint(left, right))),
    }),
  })).sort((left, right) => compareCodepoint(left.id, right.id));
}

function excludedInput(path: string): boolean {
  return path.startsWith('.musubix/evidence/')
    || path.startsWith('.musubix/cache/')
    || path.startsWith('.github/skills/')
    || path.endsWith('/trace.json')
    || path === 'trace.json'
    || /(?:^|\/)(?:logs?|coverage)(?:\/|$)/.test(path);
}

export function createNativeTestEvidencePassContext(): NativeTestEvidencePassContext {
  return { contentSha256ByPath: new Map() };
}

/** @id CODE-NATIVE-TEST-EVIDENCE-STABILITY-001
 * @implements REQ-NATIVE-TEST-EVIDENCE-STABILITY-001 REQ-NATIVE-TEST-EVIDENCE-STABILITY-002 REQ-NATIVE-TEST-EVIDENCE-STABILITY-003 REQ-NATIVE-TEST-EVIDENCE-STABILITY-004
 * @design DES-NATIVE-TEST-EVIDENCE-STABILITY-001 DES-NATIVE-TEST-EVIDENCE-STABILITY-002
 */
export function nativeTestCommandSha256(executable: string, args: string[]): string {
  return digest(canonical({ executable, arguments: args }));
}

export async function nativeTestInputSnapshot(
  root: string,
  trace: TraceGraph,
  tests: TestResult[],
  passContext: NativeTestEvidencePassContext,
): Promise<{ inputs: NativeTestEvidenceInput[]; inputFingerprint: string; diagnostics: Diagnostic[] }> {
  const paths = new Set<string>();
  for (const test of tests) {
    const testNode = trace.nodes.find((node) => node.kind === 'test' && node.id === test.id);
    if (!testNode) continue;
    paths.add(testNode.path);
    const requirementIds = trace.edges.filter((edge) =>
      edge.from === test.id && edge.relation === 'verifies').map((edge) => edge.to);
    const designIds = new Set(trace.edges.filter((edge) =>
      edge.relation === 'satisfies' && requirementIds.includes(edge.to)).map((edge) => edge.from));
    for (const edge of trace.edges) {
      if (edge.relation !== 'implements'
        || (!requirementIds.includes(edge.to) && !designIds.has(edge.to))) continue;
      const node = trace.nodes.find((candidate) => candidate.kind === 'code' && candidate.id === edge.from);
      if (node) paths.add(node.path);
    }
  }
  const diagnostics: Diagnostic[] = [];
  const inputs: NativeTestEvidenceInput[] = [];
  for (const path of [...paths].filter((entry) => !excludedInput(entry)).sort(compareCodepoint)) {
    if (!await exists(within(root, path))) {
      diagnostics.push(error('NATIVE_TEST_EVIDENCE_SOURCE_MISMATCH', `Trace-linked input is missing: ${path}.`, path));
      continue;
    }
    let sha256 = passContext.contentSha256ByPath.get(path);
    if (sha256 === undefined) {
      sha256 = digest(await readText(root, path));
      passContext.contentSha256ByPath.set(path, sha256);
    }
    inputs.push({ path, sha256 });
  }
  return { inputs, inputFingerprint: digest(JSON.stringify(inputs)), diagnostics };
}

export async function createNativeTestEvidence(
  root: string,
  trace: TraceGraph,
  context: {
    commandName: string;
    executable: string;
    args: string[];
    adapter: TestAdapter;
    sourceKind: NativeTestEvidence['sourceKind'];
    reportPath: string;
    processStatus: ProcessResult['status'];
    exitCode: number | null;
    tests: TestResult[];
    passContext?: NativeTestEvidencePassContext;
  },
): Promise<NativeTestEvidence> {
  const tests = normalizedTests(context.tests);
  const snapshot = await nativeTestInputSnapshot(
    root,
    trace,
    tests,
    context.passContext ?? createNativeTestEvidencePassContext(),
  );
  if (snapshot.diagnostics.length) throw new NativeTestEvidenceError(snapshot.diagnostics);
  return {
    schemaVersion: 1,
    commandName: context.commandName,
    commandSha256: nativeTestCommandSha256(context.executable, context.args),
    inputFingerprint: snapshot.inputFingerprint,
    inputs: snapshot.inputs,
    adapter: context.adapter,
    sourceKind: context.sourceKind,
    reportPath: context.reportPath,
    processStatus: context.processStatus,
    exitCode: context.exitCode,
    tests,
  };
}

export function serializeNativeTestEvidence(evidence: NativeTestEvidence | Record<string, unknown>): string {
  const value = evidence as NativeTestEvidence;
  return `${JSON.stringify({
    schemaVersion: value.schemaVersion,
    commandName: value.commandName,
    commandSha256: value.commandSha256,
    inputFingerprint: value.inputFingerprint,
    inputs: [...value.inputs].sort((left, right) => compareCodepoint(left.path, right.path)),
    adapter: value.adapter,
    sourceKind: value.sourceKind,
    reportPath: value.reportPath,
    processStatus: value.processStatus,
    exitCode: value.exitCode,
    tests: normalizedTests(value.tests),
  }, null, 2)}\n`;
}

function validTest(test: unknown): test is TestResult {
  if (!test || typeof test !== 'object' || Array.isArray(test)) return false;
  const value = test as Record<string, unknown>;
  const keys = Object.keys(value).sort(compareCodepoint);
  if (keys.join(',') !== (value.operations === undefined ? 'id,status' : 'id,operations,status')) return false;
  return typeof value.id === 'string'
    && ['passed', 'failed', 'skipped', 'error'].includes(String(value.status))
    && (value.operations === undefined || (!!value.operations && typeof value.operations === 'object'
      && !Array.isArray(value.operations)
      && Object.entries(value.operations).every(([name, count]) =>
        /^[\p{L}_][\p{L}\p{N}_.:-]{0,127}$/u.test(name)
        && Number.isSafeInteger(count) && Number(count) >= 0)));
}

function parseNativeTestEvidence(text: string): NativeTestEvidence | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const expectedKeys = [
    'schemaVersion', 'commandName', 'commandSha256', 'inputFingerprint', 'inputs',
    'adapter', 'sourceKind', 'reportPath', 'processStatus', 'exitCode', 'tests',
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null;
  if (record.schemaVersion !== 1 || typeof record.commandName !== 'string'
    || typeof record.commandSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(record.commandSha256)
    || typeof record.inputFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(record.inputFingerprint)
    || !Array.isArray(record.inputs) || !Array.isArray(record.tests)
    || !['vitest', 'jest', 'pytest', 'go-test', 'cargo', 'junit', 'dotnet'].includes(String(record.adapter))
    || !['file', 'directory', 'stdout'].includes(String(record.sourceKind))
    || typeof record.reportPath !== 'string'
    || !['completed', 'missing', 'timeout', 'error'].includes(String(record.processStatus))
    || (record.exitCode !== null && !Number.isInteger(record.exitCode))
    || !record.tests.every(validTest)) return null;
  const inputs = record.inputs as Array<Record<string, unknown>>;
  if (!inputs.every((input) => Object.keys(input).join(',') === 'path,sha256'
    && typeof input.path === 'string' && !input.path.includes('\\')
    && typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.sha256))) return null;
  return record as unknown as NativeTestEvidence;
}

export async function validateNativeTestEvidence(
  root: string,
  trace: TraceGraph,
  text: string,
  expected: NativeTestEvidenceExpected | Record<string, unknown>,
  passContext: NativeTestEvidencePassContext,
): Promise<{ evidence: NativeTestEvidence | null; diagnostics: Diagnostic[] }> {
  const evidence = parseNativeTestEvidence(text);
  if (!evidence || serializeNativeTestEvidence(evidence) !== text) {
    return {
      evidence: null,
      diagnostics: [error('NATIVE_TEST_EVIDENCE_SCHEMA', 'Native test evidence is not valid canonical schema.', String(expected.reportPath ?? ''))],
    };
  }
  const diagnostics: Diagnostic[] = [];
  if (evidence.commandName !== expected.commandName
    || evidence.commandSha256 !== expected.commandSha256
    || evidence.adapter !== expected.adapter
    || evidence.sourceKind !== expected.sourceKind
    || evidence.reportPath !== expected.reportPath) {
    diagnostics.push(error(
      'NATIVE_TEST_EVIDENCE_COMMAND_MISMATCH',
      `${evidence.commandName} does not match the configured native test command.`,
      evidence.reportPath,
    ));
  }
  if (evidence.processStatus !== 'completed' || evidence.exitCode !== 0) {
    diagnostics.push(error(
      'TEST_REPORT_INVALID',
      `${evidence.commandName} canonical evidence records an unsuccessful process result.`,
      evidence.reportPath,
    ));
  }
  for (const test of evidence.tests) {
    if (test.status === 'skipped') {
      diagnostics.push(error('TEST_ID_SKIPPED', `${test.id} was reported as skipped, not executed.`, evidence.reportPath));
    } else if (test.status === 'failed' || test.status === 'error') {
      diagnostics.push(error('TEST_ID_NOT_PASSED', `${test.id} reported ${test.status}.`, evidence.reportPath));
    }
  }
  const current = await nativeTestInputSnapshot(root, trace, evidence.tests, passContext);
  diagnostics.push(...current.diagnostics);
  const recorded = new Map(evidence.inputs.map((input) => [input.path, input.sha256]));
  const recomputed = new Map(current.inputs.map((input) => [input.path, input.sha256]));
  const added = current.inputs.filter((input) => !recorded.has(input.path)).map((input) => input.path);
  const removed = evidence.inputs.filter((input) => !recomputed.has(input.path)).map((input) => input.path);
  const modified = current.inputs.filter((input) =>
    recorded.has(input.path) && recorded.get(input.path) !== input.sha256).map((input) => input.path);
  if (evidence.inputFingerprint !== current.inputFingerprint || added.length || removed.length || modified.length) {
    diagnostics.push(error(
      'NATIVE_TEST_EVIDENCE_SOURCE_MISMATCH',
      `Native test inputs changed (added: ${added.join(', ') || 'none'}; removed: ${removed.join(', ') || 'none'}; modified: ${modified.join(', ') || 'none'}).`,
      evidence.reportPath,
    ));
  }
  return { evidence, diagnostics };
}
