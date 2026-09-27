import { mkdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  adapterCommandArgs,
  adapterInvocation,
  buildTrace,
  digest,
  exists,
  normalizeAdapterReport,
  readText,
  runGate,
  writeJson,
  writeText,
  type MusubixTestReport,
  type TraceGraph,
} from '../packages/analysis/src/index.js';
import type { Diagnostic } from '../packages/domain/src/index.js';
import { processResult, project, fixture, repository } from './helpers.js';

interface NativeEvidenceModule {
  createNativeTestEvidence(
    root: string,
    trace: TraceGraph,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  createNativeTestEvidencePassContext(): { contentSha256ByPath: Map<string, string> };
  nativeTestCommandSha256(executable: string, args: string[]): string;
  nativeTestInputSnapshot(
    root: string,
    trace: TraceGraph,
    tests: MusubixTestReport['tests'],
    context: { contentSha256ByPath: Map<string, string> },
  ): Promise<{ inputs: Array<{ path: string; sha256: string }>; inputFingerprint: string; diagnostics: Diagnostic[] }>;
  serializeNativeTestEvidence(evidence: Record<string, unknown>): string;
  validateNativeTestEvidence(
    root: string,
    trace: TraceGraph,
    text: string,
    expected: Record<string, unknown>,
    context: { contentSha256ByPath: Map<string, string> },
  ): Promise<{ evidence: Record<string, unknown> | null; diagnostics: Diagnostic[] }>;
}

async function nativeEvidence(): Promise<NativeEvidenceModule> {
  const path = '../packages/analysis/src/native-test-evidence.js';
  return import(path) as Promise<NativeEvidenceModule>;
}

function emptyTrace(): TraceGraph {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    nodes: [],
    edges: [],
    diagnostics: [],
    fingerprints: {},
  };
}

/** @id TEST-NATIVE-TEST-EVIDENCE-STABILITY-001
 * @verifies REQ-NATIVE-TEST-EVIDENCE-STABILITY-001
 */
it('TEST-NATIVE-TEST-EVIDENCE-STABILITY-001 preserves durable bytes across volatile native reruns', async () => {
  const root = await project();
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.commands = [
    {
      name: 'native-file',
      command: 'vitest-fixture',
      args: [],
      adapter: 'vitest',
      required: true,
      timeoutMs: 10_000,
    },
    {
      name: 'native-stdout',
      command: 'go-fixture',
      args: ['test'],
      adapter: 'go-test',
      required: true,
      timeoutMs: 10_000,
    },
    {
      name: 'native-directory',
      command: 'junit-fixture',
      args: [],
      adapter: 'junit',
      required: true,
      timeoutMs: 10_000,
    },
  ];
  await writeJson(root, '.musubix/config.json', config);

  let run = 0;
  const runner = async (command: string, args: string[]) => {
    run++;
    if (command === 'vitest-fixture') {
      const output = args.find((arg) => arg.startsWith('--outputFile='));
      expect(output).toBeTruthy();
      await writeFile(resolve(root, output!.slice('--outputFile='.length)), JSON.stringify({
        startTime: run,
        testResults: [{
          name: `volatile-${run}.test.ts`,
          assertionResults: [{
            fullName: 'TEST-EXAMPLE-001',
            status: 'passed',
            duration: run,
          }],
        }],
      }));
      return processResult();
    }
    if (command === 'junit-fixture') {
      const reportArg = args.find((arg) => arg.startsWith('--reports-dir='));
      expect(reportArg).toBeTruthy();
      const reportDirectory = resolve(root, reportArg!.slice('--reports-dir='.length));
      await mkdir(reportDirectory, { recursive: true });
      await writeFile(
        resolve(reportDirectory, `results-${run}.xml`),
        `<testsuite timestamp="2026-01-01T00:00:0${run}Z" time="${run}"><testcase name="TEST-EXAMPLE-001" time="${run}" /></testsuite>`,
      );
      return processResult();
    }
    return processResult({
      stdout: `${JSON.stringify({
        Time: `2026-01-01T00:00:0${run}Z`,
        Action: 'pass',
        Test: 'TestReadiness/TEST-EXAMPLE-001',
        Elapsed: run,
      })}\n`,
    });
  };
  await runGate(root, { runner });
  const paths = [
    '.musubix/evidence/native/native-file/aggregate.json',
    '.musubix/evidence/native/native-stdout/aggregate.json',
    '.musubix/evidence/native/native-directory/aggregate',
  ];
  const first = await Promise.all(paths.map((path) => readText(root, path)));
  await runGate(root, { runner });
  const second = await Promise.all(paths.map((path) => readText(root, path)));

  expect(second).toStrictEqual(first);
  expect(JSON.parse(second[0]!)).toMatchObject({
    commandName: 'native-file',
    adapter: 'vitest',
    sourceKind: 'file',
  });
  expect(JSON.parse(second[1]!)).toMatchObject({
    schemaVersion: 1,
    commandName: 'native-stdout',
    adapter: 'go-test',
    sourceKind: 'stdout',
    processStatus: 'completed',
    exitCode: 0,
    tests: [{ id: 'TEST-EXAMPLE-001', status: 'passed' }],
  });
  expect(JSON.parse(second[2]!)).toMatchObject({
    commandName: 'native-directory',
    adapter: 'junit',
    sourceKind: 'directory',
  });
  expect(second.join('\n')).not.toContain('Time');
  expect(second.join('\n')).not.toContain('Elapsed');
  expect(second.join('\n')).not.toContain('duration');
  expect(second.join('\n')).not.toContain('timestamp');

  const repositoryTrace = await buildTrace(repository, false);
  expect(repositoryTrace.edges).toContainEqual({
    from: 'CODE-CLI-WORKFLOW-UX-005',
    to: 'REQ-NATIVE-TEST-EVIDENCE-STABILITY-001',
    relation: 'implements',
  });
});

/** @id TEST-NATIVE-TEST-EVIDENCE-STABILITY-002
 * @verifies REQ-NATIVE-TEST-EVIDENCE-STABILITY-002
 */
it('TEST-NATIVE-TEST-EVIDENCE-STABILITY-002 canonicalizes semantic provenance and trace-linked inputs', async () => {
  const root = await fixture({
    'tests/a-b.test.ts': 'export const proof = true;\n',
    'src/a-b.ts': 'export const direct = true;\n',
    'src/ab.ts': 'export const mediated = true;\n',
  });
  const trace: TraceGraph = {
    ...emptyTrace(),
    nodes: [
      { id: 'REQ-NATIVE-TEST-EVIDENCE-STABILITY-002', kind: 'requirement', path: 'requirements.md', line: 1, mandatory: true },
      { id: 'DES-NATIVE-TEST-EVIDENCE-STABILITY-002', kind: 'design', path: 'design.md', line: 1 },
      { id: 'TEST-NATIVE-TEST-EVIDENCE-STABILITY-002', kind: 'test', path: 'tests/a-b.test.ts', line: 1 },
      { id: 'CODE-DIRECT-002', kind: 'code', path: 'src/a-b.ts', line: 1 },
      { id: 'CODE-MEDIATED-002', kind: 'code', path: 'src/ab.ts', line: 1 },
    ],
    edges: [
      { from: 'TEST-NATIVE-TEST-EVIDENCE-STABILITY-002', to: 'REQ-NATIVE-TEST-EVIDENCE-STABILITY-002', relation: 'verifies' },
      { from: 'CODE-DIRECT-002', to: 'REQ-NATIVE-TEST-EVIDENCE-STABILITY-002', relation: 'implements' },
      { from: 'DES-NATIVE-TEST-EVIDENCE-STABILITY-002', to: 'REQ-NATIVE-TEST-EVIDENCE-STABILITY-002', relation: 'satisfies' },
      { from: 'CODE-MEDIATED-002', to: 'DES-NATIVE-TEST-EVIDENCE-STABILITY-002', relation: 'implements' },
    ],
  };
  const module = await nativeEvidence();
  const snapshot = await module.nativeTestInputSnapshot(root, trace, [
    { id: 'TEST-UNTRACED-002', status: 'passed' },
    { id: 'TEST-NATIVE-TEST-EVIDENCE-STABILITY-002', status: 'passed' },
  ], module.createNativeTestEvidencePassContext());

  expect(snapshot.diagnostics).toEqual([]);
  expect(snapshot.inputs).toEqual([
    { path: 'src/a-b.ts', sha256: digest('export const direct = true;\n') },
    { path: 'src/ab.ts', sha256: digest('export const mediated = true;\n') },
    { path: 'tests/a-b.test.ts', sha256: digest('export const proof = true;\n') },
  ]);
  expect(snapshot.inputFingerprint).toBe(digest(JSON.stringify(snapshot.inputs)));
  expect(snapshot.inputs.some((input) => input.path.includes('UNTRACED'))).toBe(false);
});

/** @id TEST-NATIVE-TEST-EVIDENCE-STABILITY-003
 * @verifies REQ-NATIVE-TEST-EVIDENCE-STABILITY-003
 */
it('TEST-NATIVE-TEST-EVIDENCE-STABILITY-003 excludes timing while preserving deterministic operations', async () => {
  const module = await nativeEvidence();
  const first = normalizeAdapterReport('vitest', JSON.stringify({
    startTime: 1,
    testResults: [{
      assertionResults: [{
        fullName: 'TEST-NATIVE-TEST-EVIDENCE-STABILITY-003',
        status: 'passed',
        duration: 1,
      }],
    }],
  }));
  const second = normalizeAdapterReport('vitest', JSON.stringify({
    startTime: 999,
    testResults: [{
      assertionResults: [{
        fullName: 'TEST-NATIVE-TEST-EVIDENCE-STABILITY-003',
        status: 'passed',
        duration: 999,
      }],
    }],
  }));
  const base = {
    schemaVersion: 1,
    commandName: 'native',
    commandSha256: module.nativeTestCommandSha256('node', ['test']),
    inputFingerprint: digest('[]'),
    inputs: [],
    adapter: 'vitest',
    sourceKind: 'file',
    reportPath: '.musubix/evidence/native/native/aggregate.json',
    processStatus: 'completed',
    exitCode: 0,
  };
  const firstBytes = module.serializeNativeTestEvidence({
    ...base,
    tests: first.tests.map((test) => ({ ...test, operations: { visits: 3 } })),
  });
  const secondBytes = module.serializeNativeTestEvidence({
    ...base,
    tests: second.tests.map((test) => ({ ...test, operations: { visits: 3 } })),
  });

  expect(secondBytes).toBe(firstBytes);
  expect(secondBytes).toContain('"operations"');
  expect(secondBytes).not.toContain('duration');
  expect(secondBytes).not.toContain('startTime');

  const invalid = JSON.stringify({ ...JSON.parse(firstBytes), durationMs: 1 }, null, 2) + '\n';
  const validation = await module.validateNativeTestEvidence(
    await fixture(),
    emptyTrace(),
    invalid,
    {
      commandName: 'native',
      commandSha256: base.commandSha256,
      adapter: 'vitest',
      sourceKind: 'file',
      reportPath: base.reportPath,
    },
    module.createNativeTestEvidencePassContext(),
  );
  expect(validation.diagnostics).toContainEqual(expect.objectContaining({
    code: 'NATIVE_TEST_EVIDENCE_SCHEMA',
  }));
});

/** @id TEST-NATIVE-TEST-EVIDENCE-STABILITY-004
 * @verifies REQ-NATIVE-TEST-EVIDENCE-STABILITY-004
 */
it('TEST-NATIVE-TEST-EVIDENCE-STABILITY-004 migrates directory evidence and cleans failed executions', async () => {
  const root = await project();
  const commandName = 'native-directory';
  const durablePath = `.musubix/evidence/native/${commandName}/aggregate`;
  const rawPath = `.musubix/cache/native/${commandName}/aggregate`;
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.commands = [{
    name: commandName,
    command: 'java',
    args: [],
    adapter: 'junit',
    required: true,
    timeoutMs: 10_000,
  }];
  await writeJson(root, '.musubix/config.json', config);
  await mkdir(resolve(root, durablePath), { recursive: true });
  await writeFile(resolve(root, durablePath, 'legacy.xml'), '<testsuite />');

  let outcome: 'passed' | 'failed' | 'process-failed' = 'passed';
  const runner = async (_command: string, args: string[]) => {
    if (outcome === 'process-failed') return processResult({ exitCode: 1 });
    const reportArg = args.find((arg) => arg.startsWith('--reports-dir='));
    expect(reportArg).toBeTruthy();
    const reportDirectory = resolve(root, reportArg!.slice('--reports-dir='.length));
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(
      resolve(reportDirectory, 'results.xml'),
      `<testsuite><testcase name="TEST-EXAMPLE-001">${outcome === 'failed' ? '<failure />' : ''}</testcase></testsuite>`,
    );
    return processResult();
  };

  await runGate(root, { runner });
  expect((await stat(resolve(root, durablePath))).isFile()).toBe(true);
  expect(JSON.parse(await readText(root, durablePath))).toMatchObject({
    tests: [{ id: 'TEST-EXAMPLE-001', status: 'passed' }],
  });
  expect(await exists(resolve(root, rawPath))).toBe(false);

  outcome = 'failed';
  await runGate(root, { runner });
  expect(JSON.parse(await readText(root, durablePath))).toMatchObject({
    tests: [{ id: 'TEST-EXAMPLE-001', status: 'failed' }],
  });

  outcome = 'process-failed';
  await runGate(root, { runner });
  expect(await exists(resolve(root, durablePath))).toBe(false);
  expect(await exists(resolve(root, rawPath))).toBe(false);

  const validationRoot = await fixture({
    'requirements.md': 'REQ\n',
    'src/proof.ts': 'export const proof = true;\n',
    'tests/proof.test.ts': 'export const test = true;\n',
  });
  const trace: TraceGraph = {
    ...emptyTrace(),
    nodes: [
      { id: 'REQ-PROOF-001', kind: 'requirement', path: 'requirements.md', line: 1, mandatory: true },
      { id: 'CODE-PROOF-001', kind: 'code', path: 'src/proof.ts', line: 1 },
      { id: 'TEST-PROOF-001', kind: 'test', path: 'tests/proof.test.ts', line: 1 },
    ],
    edges: [
      { from: 'CODE-PROOF-001', to: 'REQ-PROOF-001', relation: 'implements' },
      { from: 'TEST-PROOF-001', to: 'REQ-PROOF-001', relation: 'verifies' },
    ],
  };
  const module = await nativeEvidence();
  const commandSha256 = module.nativeTestCommandSha256('proof-runner', ['test']);
  const evidence = await module.createNativeTestEvidence(validationRoot, trace, {
    commandName: 'proof',
    executable: 'proof-runner',
    args: ['test'],
    adapter: 'vitest',
    sourceKind: 'file',
    reportPath: '.musubix/evidence/native/proof/aggregate.json',
    processStatus: 'completed',
    exitCode: 0,
    tests: [{ id: 'TEST-PROOF-001', status: 'passed' }],
  });
  const text = module.serializeNativeTestEvidence(evidence);
  const expected = {
    commandName: 'proof',
    commandSha256,
    adapter: 'vitest',
    sourceKind: 'file',
    reportPath: '.musubix/evidence/native/proof/aggregate.json',
  };
  expect((await module.validateNativeTestEvidence(
    validationRoot,
    trace,
    text,
    { ...expected, commandSha256: module.nativeTestCommandSha256('proof-runner', ['changed']) },
    module.createNativeTestEvidencePassContext(),
  )).diagnostics).toContainEqual(expect.objectContaining({
    code: 'NATIVE_TEST_EVIDENCE_COMMAND_MISMATCH',
  }));
  expect((await module.validateNativeTestEvidence(
    validationRoot,
    trace,
    text,
    expected,
    module.createNativeTestEvidencePassContext(),
  )).diagnostics).toEqual([]);
  await writeText(validationRoot, 'src/proof.ts', 'export const proof = false;\n');
  expect((await module.validateNativeTestEvidence(
    validationRoot,
    trace,
    text,
    expected,
    module.createNativeTestEvidencePassContext(),
  )).diagnostics).toContainEqual(expect.objectContaining({
    code: 'NATIVE_TEST_EVIDENCE_SOURCE_MISMATCH',
    message: expect.stringContaining('modified: src/proof.ts'),
  }));

  await mkdir(resolve(validationRoot, 'services/proof'), { recursive: true });
  const cwdInvocation = adapterInvocation('vitest', 'cwd-proof');
  const cwdArgs = adapterCommandArgs(validationRoot, {
    name: 'cwd-proof',
    command: 'proof-runner',
    args: ['--configured={reportPath}'],
    cwd: 'services/proof',
    adapter: 'vitest',
    required: true,
    timeoutMs: 10_000,
  }, cwdInvocation);
  expect(cwdArgs).toContain('--configured=../../.musubix/cache/native/cwd-proof/aggregate.json');
  expect(cwdArgs).toContain('--outputFile=../../.musubix/cache/native/cwd-proof/aggregate.json');
  expect(module.nativeTestCommandSha256('proof-runner', cwdArgs))
    .toBe(module.nativeTestCommandSha256('proof-runner', [...cwdArgs]));

  const implementationTrace = await buildTrace(repository, false);
  expect(implementationTrace.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'CODE-NATIVE-TEST-EVIDENCE-STABILITY-003', path: 'packages/analysis/src/performance.ts' }),
    expect.objectContaining({ id: 'CODE-NATIVE-TEST-EVIDENCE-STABILITY-004', path: 'packages/analysis/src/model-correspondence.ts' }),
  ]));
});
