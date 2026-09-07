import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateRequirements } from '../packages/domain/src/index.js';
import {
  adapterInvocation, attestationSigningPayload, createPerformanceExecution, createUnsignedAttestation, formalCheck, generateLean,
  generateSmt2, indexGraph, normalizeAdapterReport, parseConfig, parsePolicyBaseline, performanceEvidence, policyDiagnostics,
  recordWorkflow,
  readAdapterOutput, readText, mergeAdapterArgs,
  validateWorkflow, verifyEvidenceAttestation, verifyWorkflowLog,
  writeJson, writeText, type AttestationConfig, type Runner,
} from '../packages/analysis/src/index.js';
import { fixture, processResult, req } from './helpers.js';

function explicit(statement: string, id: string, formal: object): string {
  return `${req(statement, id)}Acceptance: A deterministic test verifies the declared constraint.\nFormal: ${JSON.stringify(formal)}\n`;
}

describe('P2 explicit formal semantics', () => {
  it('strictly parses and models conditional, numeric, temporal, and transition constraints', async () => {
    const text = [
      explicit('When a session is valid, the system shall grant access.', 'REQ-FORMAL-001',
        { kind: 'conditional', condition: 'session.valid', consequence: 'access.granted' }),
      explicit('The system shall limit attempts.', 'REQ-FORMAL-002',
        { kind: 'numeric', metric: 'attempts', operator: '<=', value: 3, unit: 'operations' }),
      explicit('When a request arrives, the system shall respond.', 'REQ-FORMAL-003',
        { kind: 'temporal', trigger: 'request.arrived', response: 'response.sent', withinMs: 5000 }),
      explicit('When processing starts, the system shall enter running state.', 'REQ-FORMAL-004',
        { kind: 'transition', from: 'idle', event: 'start', to: 'running' }),
    ].join('\n');
    const report = await formalCheck(text, await fixture(), 'none');
    expect(report.valid).toBe(true);
    expect(report.constraints).toHaveLength(4);
    expect(report.unsupported).toEqual([]);
    expect(generateSmt2(report)).toContain('(set-logic QF_UFLIA)');
    expect(generateSmt2(report)).toContain('(<= n');
    expect(generateLean(report)).toContain('def explicitObligations');
    expect(generateLean(report)).toContain('theorem explicit_constraints_consistent');
  });

  it('detects incompatible explicit bounds and rejects non-schema prose', async () => {
    const text = `${explicit('The system shall set a lower bound.', 'REQ-FORMAL-010',
      { kind: 'numeric', metric: 'workers', operator: '>=', value: 5 })}
${explicit('The system shall set an upper bound.', 'REQ-FORMAL-011',
      { kind: 'numeric', metric: 'workers', operator: '<=', value: 2 })}`;
    const report = await formalCheck(text, await fixture(), 'none');
    expect(report.consistency).toBe('inconsistent');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORMAL_NUMERIC_CONTRADICTION' }));
    expect(validateRequirements(`${req()}\nFormal: {"kind":"magic","claim":"anything"}\n`).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'REQ_FORMAL_SCHEMA' }));
    const transition = await formalCheck(`${explicit('When start occurs, the system shall enter running.', 'REQ-FORMAL-012',
      { kind: 'transition', from: 'idle', event: 'start', to: 'running' })}
${explicit('When start occurs, the system shall enter failed.', 'REQ-FORMAL-013',
      { kind: 'transition', from: 'idle', event: 'start', to: 'failed' })}`, await fixture(), 'none');
    expect(transition.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORMAL_TRANSITION_CONTRADICTION' }));
  });

  it('treats opposite condition branches as separate scenarios', async () => {
    const text = `${explicit('When a feature is enabled, the system shall allow access.', 'REQ-FORMAL-020',
      { kind: 'conditional', condition: 'feature.enabled', consequence: 'access.allowed', conditionValue: true })}
${explicit('When a feature is disabled, the system shall deny access.', 'REQ-FORMAL-021',
      { kind: 'conditional', condition: 'feature.enabled', consequence: 'access.allowed', conditionValue: false, consequenceValue: false })}`;
    const report = await formalCheck(text, await fixture(), 'none');
    expect(report.consistency).toBe('consistent');
    expect(report.solver.status).toBe('not-requested');
    const smt = generateSmt2(report);
    expect(smt).not.toContain('_condition)');
    expect(smt.match(/\(declare-fun q\d+ \(\) Bool\)/g)).toHaveLength(2);
  });
});

describe('P2 built-in test adapters', () => {
  it('enforces explicit minimal, recommended, and release quality profiles', () => {
    expect(parseConfig({
      schemaVersion: 1,
      qualityProfile: 'minimal',
    }).qualityProfile).toBe('minimal');
    expect(() => parseConfig({
      schemaVersion: 1,
      qualityProfile: 'recommended',
    })).toThrow('requires checks');
    expect(() => parseConfig({
      schemaVersion: 1,
      qualityProfile: 'recommended',
      requiredChecks: [
        'requirements', 'design', 'constitution', 'trace', 'graph', 'commands',
        'test-identities', 'tdd',
      ],
    })).toThrow('codeGraph.mode strict');
    expect(() => parseConfig({
      schemaVersion: 1,
      qualityProfile: 'release',
      requiredChecks: [
        'requirements', 'design', 'constitution', 'trace', 'graph', 'formal',
        'model-correspondence', 'mutation', 'workflow', 'tdd', 'change-history',
        'change-completeness', 'performance', 'attestation', 'test-identities', 'commands',
      ],
      codeGraph: { mode: 'strict' },
      formal: { solver: 'z3', minModeledFraction: 0.5 },
      mutation: { mode: 'strict' },
      workflow: { mode: 'strict' },
      attestation: { mode: 'local' },
    })).toThrow('attestation.mode ci-required');
    expect(parseConfig({
      schemaVersion: 1,
      qualityProfile: 'release',
      requiredChecks: [
        'requirements', 'design', 'constitution', 'trace', 'graph', 'formal',
        'model-correspondence', 'mutation', 'workflow', 'tdd', 'change-history',
        'change-completeness', 'performance', 'attestation', 'test-identities', 'commands',
      ],
      codeGraph: { mode: 'strict' },
      formal: { solver: 'z3', minModeledFraction: 0.5 },
      mutation: { mode: 'strict' },
      workflow: { mode: 'strict' },
      attestation: { mode: 'ci-required' },
    }).qualityProfile).toBe('release');
    expect(parsePolicyBaseline({
      schemaVersion: 1,
      commands: [{ name: 'format', command: 'cargo', args: ['fmt'], required: false }],
      tdd: { redPreflightCommands: ['format'] },
    }).tdd.redPreflightCommands).toEqual(['format']);
  });

  it('protects quality profile, Red preflight, and workflow event skew baselines', () => {
    const baseline = parsePolicyBaseline({
      schemaVersion: 1,
      qualityProfile: 'release',
      commands: [{ name: 'format', command: 'cargo', args: ['fmt', '--all'], required: false }],
      requiredChecks: [
        'requirements', 'design', 'constitution', 'trace', 'graph', 'formal',
        'model-correspondence', 'mutation', 'workflow', 'tdd', 'change-history',
        'change-completeness', 'performance', 'attestation', 'test-identities', 'commands',
      ],
      codeGraph: { mode: 'strict' },
      formal: { solver: 'z3', minModeledFraction: 0.5 },
      mutation: { mode: 'strict' },
      tdd: { redPreflightCommands: ['format'] },
      workflow: { mode: 'strict', maxEventSkewMs: 1000 },
      attestation: { mode: 'ci-required' },
    });
    const weakened = parseConfig({
      schemaVersion: 1,
      qualityProfile: 'minimal',
      commands: [{ name: 'format', command: 'true', required: false }],
      tdd: { redPreflightCommands: ['format'] },
      workflow: { mode: 'strict', maxEventSkewMs: 2000 },
    });
    expect(policyDiagnostics(weakened, baseline).map((diagnostic) => diagnostic.code))
      .toEqual(expect.arrayContaining([
        'POLICY_QUALITY_PROFILE',
        'POLICY_TDD_PREFLIGHT',
        'POLICY_WORKFLOW_EVENT_SKEW',
      ]));
  });

  it('derives targeted arguments and normalizes common native reports', () => {
    expect(parseConfig({
      schemaVersion: 1,
      commands: [{ name: 'tests', command: 'npx', args: ['vitest'], adapter: 'vitest' }],
      attestation: { mode: 'local', trustedPublicKeys: [] },
    }).commands[0]?.adapter).toBe('vitest');
    expect(adapterInvocation('vitest', 'test', 'TEST-APP-001', 'src/app.test.ts').args)
      .toEqual(expect.arrayContaining(['src/app.test.ts', '-t', 'TEST-APP-001', '--reporter=json']));
    expect(adapterInvocation('go-test', 'test', 'TEST-APP-003', 'service/app_test.go').args)
      .toEqual(expect.arrayContaining(['test', '-json', './service', '-run', '/TEST-APP-003']));
    expect(adapterInvocation('cargo', 'test', 'TEST-APP-004').args)
      .toEqual(['test', 'test_app_004', '--', '--format', 'pretty']);
    expect(adapterInvocation('dotnet', 'test', 'TEST-APP-006').args)
      .toEqual([
        'test', '--logger', 'trx;LogFilePrefix=results',
        '--results-directory', '.musubix/evidence/native/test/TEST-APP-006',
        '--filter', 'DisplayName~TEST-APP-006|Name~TEST-APP-006',
      ]);
    expect(normalizeAdapterReport('jest', JSON.stringify({
      testResults: [{ assertionResults: [{ fullName: 'TEST-APP-001 does work', status: 'passed' }] }],
    })).tests).toEqual([{ id: 'TEST-APP-001', status: 'passed' }]);
    expect(normalizeAdapterReport('vitest', JSON.stringify({
      testResults: [{ assertionResults: [
        { fullName: 'TEST-APP-001 does work', status: 'passed' },
        { fullName: 'TEST-APP-002 unrelated', status: 'skipped' },
      ] }],
    }), 'TEST-APP-001').tests).toEqual([{ id: 'TEST-APP-001', status: 'passed' }]);
    expect(normalizeAdapterReport('pytest', JSON.stringify({
      tests: [{ nodeid: 'tests/test_app.py::test_TEST_APP_002', outcome: 'failed' }],
    })).tests[0]).toEqual({ id: 'TEST-APP-002', status: 'failed' });
    expect(() => normalizeAdapterReport('pytest', JSON.stringify({
      tests: [{ nodeid: 'tests/test_app.py::test_descriptive_name', outcome: 'passed' }],
    }), 'TEST-APP-002')).toThrow('test_TEST_APP_001');
    expect(normalizeAdapterReport('go-test', '{"Action":"pass","Test":"Test_TEST-APP-003"}\n').tests[0]?.status).toBe('passed');
    expect(normalizeAdapterReport('cargo', 'test tests::test_app_004 ... ok\n').tests[0]?.id).toBe('TEST-APP-004');
    expect(normalizeAdapterReport('junit', '<testsuite><testcase name="TEST-APP-005"><failure/></testcase></testsuite>').tests[0]?.status).toBe('failed');
    expect(normalizeAdapterReport('junit',
      '<testsuite><testcase classname="example.OrderedTest" name="TEST-APP-005 works"/></testsuite>',
    ).tests).toEqual([{ id: 'TEST-APP-005', status: 'passed' }]);
    expect(normalizeAdapterReport('junit', `<testsuite><testcase name="works()" classname="example.TaggedTest">
      <system-out><![CDATA[
unique-id: [engine:junit-jupiter]/[class:example.TaggedTest]/[method:works()]
display-name: TEST-APP-005 tagged behavior
]]></system-out>
    </testcase></testsuite>`).tests).toEqual([{ id: 'TEST-APP-005', status: 'passed' }]);
    expect(normalizeAdapterReport('dotnet',
      '<TestRun><Results><UnitTestResult testName="TEST-APP-006 works" outcome="Passed" /></Results></TestRun>',
    ).tests).toEqual([{ id: 'TEST-APP-006', status: 'passed' }]);
  });

  it('merges legacy test subcommands and rejects conflicting adapter-owned arguments', () => {
    const cargo = parseConfig({
      schemaVersion: 1,
      commands: [{ name: 'cargo-tests', command: 'cargo', args: ['test', '--quiet'], adapter: 'cargo' }],
    }).commands[0]!;
    expect(mergeAdapterArgs(cargo.adapter!, cargo.args, adapterInvocation('cargo', cargo.name).args))
      .toEqual(['test', '--quiet', '--', '--format', 'pretty']);
    expect(mergeAdapterArgs('cargo', ['test', '--quiet', '--', '--nocapture'],
      adapterInvocation('cargo', 'cargo-tests', 'TEST-APP-004').args))
      .toEqual(['test', '--quiet', 'test_app_004', '--', '--nocapture', '--format', 'pretty']);
    expect(mergeAdapterArgs('go-test', ['test', '-count=1', './...'],
      adapterInvocation('go-test', 'go-tests', 'TEST-APP-003', 'service/app_test.go').args))
      .toEqual(['test', '-count=1', '-json', './service', '-run', '/TEST-APP-003']);
    expect(mergeAdapterArgs('go-test', ['test', '-count=1', './pkg'],
      adapterInvocation('go-test', 'go-tests').args))
      .toEqual(['test', '-count=1', '-json', './pkg']);
    expect(mergeAdapterArgs('dotnet', ['test', 'FulfillmentHub.sln', '--no-restore'],
      adapterInvocation('dotnet', 'dotnet-tests', 'TEST-APP-006').args))
      .toEqual([
        'test', 'FulfillmentHub.sln', '--no-restore',
        '--logger', 'trx;LogFilePrefix=results',
        '--results-directory', '.musubix/evidence/native/dotnet-tests/TEST-APP-006',
        '--filter', 'DisplayName~TEST-APP-006|Name~TEST-APP-006',
      ]);
    expect(mergeAdapterArgs('dotnet',
      ['test', 'FulfillmentHub.sln', '--', 'MSTest.MapInconclusiveToFailed=True'],
      adapterInvocation('dotnet', 'dotnet-tests', 'TEST-APP-006').args))
      .toEqual([
        'test', 'FulfillmentHub.sln',
        '--logger', 'trx;LogFilePrefix=results',
        '--results-directory', '.musubix/evidence/native/dotnet-tests/TEST-APP-006',
        '--filter', 'DisplayName~TEST-APP-006|Name~TEST-APP-006',
        '--', 'MSTest.MapInconclusiveToFailed=True',
      ]);
    expect(mergeAdapterArgs('go-test', ['test', '-exec', './wrapper', './...'],
      adapterInvocation('go-test', 'go-tests', 'TEST-APP-003', 'service/app_test.go').args))
      .toEqual(['test', '-exec', './wrapper', '-json', './service', '-run', '/TEST-APP-003']);
    expect(mergeAdapterArgs('go-test', ['test', '-o', 'out.test', '-covermode', 'atomic', '-skip', 'Slow', './...', '-args', 'fixture'],
      adapterInvocation('go-test', 'go-tests', 'TEST-APP-003', 'service/app_test.go').args))
      .toEqual([
        'test', '-o', 'out.test', '-covermode', 'atomic', '-skip', 'Slow',
        '-json', './service', '-run', '/TEST-APP-003', '-args', 'fixture',
      ]);
    expect(mergeAdapterArgs('go-test', ['test', '-C', 'sub', '-buildmode', 'pie', '-compiler', 'gc', '-pgo', 'auto', './...'],
      adapterInvocation('go-test', 'go-tests', 'TEST-APP-003', 'service/app_test.go').args))
      .toEqual([
        'test', '-C', 'sub', '-buildmode', 'pie', '-compiler', 'gc', '-pgo', 'auto',
        '-json', '../service', '-run', '/TEST-APP-003',
      ]);
    expect(() => parseConfig({
      schemaVersion: 1,
      commands: [{ name: 'pytest-tests', command: 'python', args: ['-m', 'pytest', '--json-report'], adapter: 'pytest' }],
    })).toThrow('adapter-owned argument --json-report');
  });

  it('loads JUnit XML from the native report directory', async () => {
    const root = await fixture();
    const invocation = adapterInvocation('junit', 'test', 'TEST-APP-005');
    await writeText(root, `${invocation.reportPath}/TEST-junit-jupiter.xml`,
      '<testsuite><testcase name="test_app_005"/></testsuite>');
    const text = await readAdapterOutput(invocation, `${root}/${invocation.reportPath}`, '');
    expect(normalizeAdapterReport('junit', text ?? '', 'TEST-APP-005').tests)
      .toEqual([{ id: 'TEST-APP-005', status: 'passed' }]);
  });

  it('loads nested JUnit XML from multi-module report directories', async () => {
    const root = await fixture();
    const invocation = adapterInvocation('junit', 'test', 'TEST-APP-006');
    await writeText(root, `${invocation.reportPath}/application/target/TEST-application.xml`,
      '<testsuite><testcase name="test_app_006"/></testsuite>');
    const text = await readAdapterOutput(invocation, `${root}/${invocation.reportPath}`, '');
    expect(normalizeAdapterReport('junit', text ?? '', 'TEST-APP-006').tests)
      .toEqual([{ id: 'TEST-APP-006', status: 'passed' }]);
  });

  it('loads and normalizes .NET TRX results from the native report directory', async () => {
    const root = await fixture();
    const invocation = adapterInvocation('dotnet', 'test', 'TEST-APP-007');
    await writeText(root, `${invocation.reportPath}/results.trx`,
      '<TestRun><Results><UnitTestResult testName="TEST-APP-007 works" outcome="Passed" /></Results></TestRun>');
    const text = await readAdapterOutput(invocation, `${root}/${invocation.reportPath}`, '');
    expect(normalizeAdapterReport('dotnet', text ?? '', 'TEST-APP-007').tests)
      .toEqual([{ id: 'TEST-APP-007', status: 'passed' }]);
  });

  it('accepts only real .NET results under the TRX Results hierarchy', () => {
    expect(() => normalizeAdapterReport('dotnet',
      '<TestRun><Results><!-- <UnitTestResult testName="TEST-FAKE-001" outcome="Passed" /> --></Results></TestRun>',
    )).toThrow('No annotated TEST-* identities');
    expect(() => normalizeAdapterReport('dotnet',
      '<TestRun><Results><![CDATA[<UnitTestResult testName="TEST-FAKE-001" outcome="Passed" />]]></Results></TestRun>',
    )).toThrow('No annotated TEST-* identities');
    expect(() => normalizeAdapterReport('dotnet',
      '<TestRun><Results><UnitTestResult testName="TEST-APP-007" outcome="Passed" /></TestRun>',
    )).toThrow('mismatched XML element');
  });
});

describe('P2 workflow one-to-one reconciliation', () => {
  it('requires distinct completed in-order Skill tool calls', async () => {
    const root = await fixture();
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'requirements', status: 'completed' });
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'design', status: 'completed' });
    const old = new Date(0).toISOString();
    await verifyWorkflowLog(root, [
      { type: 'tool.execution_start', timestamp: old, data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } } },
      { type: 'tool.execution_complete', timestamp: old, data: { toolCallId: 'call-1', success: true } },
    ].map((event) => JSON.stringify(event)).join('\n'));
    expect((await validateWorkflow(root)).diagnostics).toContainEqual(expect.objectContaining({ code: 'WORKFLOW_INVOCATION_REUSED' }));

    await verifyWorkflowLog(root, [
      { type: 'tool.execution_start', timestamp: old, data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } } },
      { type: 'tool.execution_complete', timestamp: old, data: { toolCallId: 'call-1', success: true } },
      { type: 'tool.execution_started', timestamp: old, data: { callId: 'call-2', name: 'skill', arguments: JSON.stringify({ skill: 'sdd-change' }) } },
      { type: 'tool.execution_completed', timestamp: old, data: { callId: 'call-2', success: true } },
    ].map((event) => JSON.stringify(event)).join('\n'));
    expect(await validateWorkflow(root)).toMatchObject({ verified: true });
  });
});

describe('P2 dynamic graph and manifest entrypoints', () => {
  it('resolves safe local cache-busting imports and package entrypoints without hiding arbitrary dynamics', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({ exports: { '.': './src/entry.js' } }),
      'src/entry.ts': 'export const value = 1;',
      'src/runner.ts': "const moduleUrl = new URL('./entry.js', import.meta.url).href;\nimport(`${moduleUrl}?fresh=${Date.now()}`);\nconst unknown = getPath(); import(unknown);",
    });
    const graph = await indexGraph(root);
    expect(graph.entrypoints).toContainEqual({ manifest: 'package.json', field: 'exports..', path: 'src/entry.ts' });
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/runner.ts', to: 'src/entry.ts', kind: 'dynamic' }));
    expect(graph.diagnostics.filter((diagnostic) => diagnostic.code === 'GRAPH_DYNAMIC')).toHaveLength(1);
  });
});

describe('P2 deterministic performance evidence', () => {
  it('requires passed structured operation counters and rejects wall-clock-only evidence', async () => {
    const root = await fixture({
      '.musubix/features/perf/requirements.md': `${req('The system shall bound traversal work.', 'REQ-PERF-001')}Type: non-functional
Acceptance: TEST-PERF-001 reports at most 10 visitedNodes operations.
Performance: {"counter":"visitedNodes","max":10,"testId":"TEST-PERF-001"}
`,
    });
    const requirements = validateRequirements(await readText(root, '.musubix/features/perf/requirements.md')).value;
    const runId = '123e4567-e89b-42d3-a456-426614174000';
    const missing = performanceEvidence(requirements, [], runId);
    expect(missing.observations[0]?.status).toBe('missing');
    const execution = createPerformanceExecution({
      runId,
      executionId: 'a'.repeat(64),
      commandName: 'test',
      commandSha256: 'b'.repeat(64),
      reportPath: 'results.json',
      sourceKind: 'file',
      reportSha256: 'c'.repeat(64),
      processStatus: 'completed',
      exitCode: 0,
      tests: [{ id: 'TEST-PERF-001', status: 'passed', operations: { visitedNodes: 8 } }],
    });
    const native = createPerformanceExecution({
      runId,
      executionId: 'd'.repeat(64),
      commandName: 'native-test',
      commandSha256: 'e'.repeat(64),
      reportPath: 'native.json',
      sourceKind: 'file',
      reportSha256: 'f'.repeat(64),
      processStatus: 'completed',
      exitCode: 0,
      tests: [{ id: 'TEST-PERF-001', status: 'passed' }],
    });
    expect(performanceEvidence(requirements, [native, execution], runId).observations[0]).toMatchObject({
      observed: 8,
      status: 'pass',
      provenance: { testStatus: 'passed', value: 8 },
    });
  });
});

describe('P2 Ed25519 evidence attestation', () => {
  it('binds repository, commit, CI run, evidence heads, and trusted key without private-key storage', async () => {
    const root = await fixture();
    await writeJson(root, 'src-state.json', { value: 1 });
    await writeJson(root, '.musubix/evidence/performance.json', {
      schemaVersion: 2,
      runId: '123e4567-e89b-42d3-a456-426614174000',
      generatedAt: new Date(0).toISOString(),
      executions: [],
      observations: [],
    });
    const runner: Runner = async (_command, args) => processResult({
      stdout: args[0] === 'config' ? 'owner/repository.git\n' : `${'a'.repeat(40)}\n`,
    });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsigned = await createUnsignedAttestation(root, { provider: 'github', runId: '123', keyId: 'ci-key' }, runner);
    const signature = sign(null, Buffer.from(attestationSigningPayload(unsigned)), privateKey).toString('base64');
    await writeJson(root, '.musubix/evidence/attestation.json', { ...unsigned, signature });
    const config: AttestationConfig = {
      mode: 'ci-required',
      repository: 'owner/repository',
      trustedPublicKeys: [{ id: 'ci-key', publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
    };
    expect(await verifyEvidenceAttestation(root, config, runner, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123' }))
      .toMatchObject({ valid: true, status: 'verified' });
    expect(await verifyEvidenceAttestation(root, config, runner, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: 'other' }))
      .toMatchObject({ valid: false, status: 'invalid' });
    await writeJson(root, 'src-state.json', { value: 2 });
    expect((await verifyEvidenceAttestation(root, config, runner, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123' })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'ATTESTATION_EVIDENCE_HEAD' }));
    expect(await readText(root, '.musubix/evidence/attestation.json')).not.toContain('PRIVATE KEY');
  });
});
