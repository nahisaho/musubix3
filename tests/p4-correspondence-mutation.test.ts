import { describe, expect, it } from 'vitest';
import {
  collectEvidenceHeads, defaultConfig, digest, loadConfig, mutationDoctor, mutationIdentity, policyDiagnostics,
  projectStatus, readText, runGate, validateModelCorrespondenceEvidence, validateMutationEvidence,
  writeJson, writeText, type MutationRecord, type Runner,
} from '../packages/analysis/src/index.js';
import { processResult, project } from './helpers.js';

const explicitRequirement = `---
schemaVersion: 1
feature: example
---
## REQ-EXAMPLE-001: Report readiness
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report its readiness.
Acceptance: TEST-EXAMPLE-001 checks readiness.
Formal: {"kind":"conditional","condition":"system.ready","consequence":"readiness.reported"}
`;

async function configureMutation(
  root: string,
  status: MutationRecord['status'] = 'killed',
  overrides: Partial<MutationRecord> = {},
  duplicate = false,
): Promise<void> {
  await writeText(root, '.musubix/features/example/requirements.md', explicitRequirement);
  const sourceSha256 = digest(await readText(root, 'src/service.ts'));
  const testSha256 = digest(await readText(root, 'src/service.test.ts'));
  const base = {
    requirementId: 'REQ-EXAMPLE-001',
    testId: 'TEST-EXAMPLE-001',
    sourcePath: 'src/service.ts',
    sourceSha256,
    testPath: 'src/service.test.ts',
    testSha256,
    operator: 'boolean-negation',
    location: { line: 5, column: 38 },
    status,
    ...overrides,
  };
  const mutant: MutationRecord = {
    ...base,
    id: mutationIdentity(base),
  };
  const report = { schemaVersion: 1, mutants: duplicate ? [mutant, mutant] : [mutant] };
  const config = await loadConfig(root);
  config.mutation = { mode: 'strict' };
  config.requiredChecks.push('mutation');
  config.commands.push({
    name: 'mutation',
    command: process.execPath,
    args: [
      '-e',
      `const fs=require('fs'),p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,${JSON.stringify(JSON.stringify(report))})`,
      '{reportPath}',
    ],
    mutationReport: { format: 'musubix-mutation-json', path: '.musubix/evidence/mutation-report.json' },
    required: true,
    timeoutMs: 10_000,
  });
  await writeJson(root, '.musubix/config.json', config);
}

describe('P4 model correspondence and mutation quality', () => {
  it('reports language-aware mutation engine probes and actionable recommendations', async () => {
    const root = await project();
    await writeText(root, 'package.json', '{"name":"fixture"}\n');
    await writeText(root, 'Cargo.toml', '[package]\nname = "fixture"\nversion = "0.1.0"\n');
    const runner: Runner = async (command) => command === 'cargo'
      ? processResult({ stdout: 'cargo-mutants 25.0.0' })
      : processResult({ status: 'missing', exitCode: null });
    const report = await mutationDoctor(root, runner);
    expect(report).toMatchObject({ available: true, configured: false });
    expect(report.engines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ecosystem: 'javascript',
        engine: 'StrykerJS',
        status: 'missing',
        attemptedCommands: ['npx --no-install stryker --version'],
      }),
      expect.objectContaining({
        ecosystem: 'rust',
        engine: 'cargo-mutants',
        status: 'available',
      }),
    ]));
    expect(report.engines.every((entry) => entry.recommendation.length > 0)).toBe(true);

    const config = await loadConfig(root);
    config.commands.push({
      name: 'mutation',
      command: 'missing-engine',
      args: ['--report', '{reportPath}'],
      mutationReport: {
        format: 'musubix-mutation-json',
        path: '.musubix/evidence/mutation-report.json',
      },
      required: true,
      timeoutMs: 10_000,
    });
    await writeJson(root, '.musubix/config.json', config);
    expect(await mutationDoctor(root, runner)).toMatchObject({
      available: false,
      configured: true,
      engines: [expect.objectContaining({
        engine: 'mutation',
        status: 'configured',
        recommendation: expect.stringContaining('run the gate'),
      })],
    });
  });

  it('proves explicit formal requirements through fresh trace and passing test reports', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md', explicitRequirement);
    const gate = await runGate(root);
    expect(gate.checks.find((check) => check.name === 'model-correspondence'))
      .toMatchObject({ required: true, status: 'pass' });
    expect(gate.metrics['modelCorrespondence.coveredRequirements']).toBe(1);
    expect(await validateModelCorrespondenceEvidence(root))
      .toMatchObject({ valid: true, requirements: 1, coveredRequirements: ['REQ-EXAMPLE-001'] });

    await writeJson(root, '.musubix/evidence/test-results.json', {
      schemaVersion: 1,
      tests: [{ id: 'TEST-EXAMPLE-001', status: 'failed' }],
    });
    expect((await validateModelCorrespondenceEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'MODEL_CORRESPONDENCE_TEST_NOT_PASSED' }));
    expect((await projectStatus(root)).gate).toMatchObject({ status: 'stale', ready: false });
  });

  it('fails closed when formal or generated trace evidence becomes stale', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md', explicitRequirement);
    await runGate(root);
    await writeText(root, '.musubix/features/example/requirements.md',
      explicitRequirement.replace('"readiness.reported"', '"readiness.available"'));
    expect((await validateModelCorrespondenceEvidence(root)).diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(expect.arrayContaining([
        'MODEL_CORRESPONDENCE_TRACE_STALE',
        'MODEL_CORRESPONDENCE_FORMAL_STALE',
        'MODEL_CORRESPONDENCE_MODEL_STALE',
      ]));
  });

  it('accepts current deterministic killed mutants and binds both evidence heads', async () => {
    const root = await project();
    await configureMutation(root);
    const gate = await runGate(root);
    expect(gate.checks.find((check) => check.name === 'mutation'))
      .toMatchObject({ required: true, status: 'pass' });
    expect(await validateMutationEvidence(root))
      .toMatchObject({ valid: true, requirements: 1, coveredRequirements: ['REQ-EXAMPLE-001'], mutants: 1 });
    const heads = await collectEvidenceHeads(root);
    expect(heads.mutation).toMatch(/^[a-f0-9]{64}$/);
    expect(heads.modelCorrespondence).toMatch(/^[a-f0-9]{64}$/);
    const mutationPath = '.musubix/evidence/mutation.json';
    const mutation = JSON.parse(await readText(root, mutationPath));
    mutation.executions[0].mutants[0].operator = 'tampered-operator';
    await writeJson(root, mutationPath, mutation);
    expect((await collectEvidenceHeads(root)).mutation).not.toBe(heads.mutation);

    const correspondencePath = '.musubix/evidence/model-correspondence.json';
    const correspondence = JSON.parse(await readText(root, correspondencePath));
    correspondence.entries[0].modelSha256 = '0'.repeat(64);
    await writeJson(root, correspondencePath, correspondence);
    expect((await collectEvidenceHeads(root)).modelCorrespondence).not.toBe(heads.modelCorrespondence);
  });

  it('fails closed when strict mode has no mutation report', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.mutation = { mode: 'strict' };
    await writeJson(root, '.musubix/config.json', config);
    const gate = await runGate(root);
    expect(gate.checks.find((check) => check.name === 'mutation'))
      .toMatchObject({ required: true, status: 'fail' });
    expect(gate.checks.find((check) => check.name === 'mutation')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'MUTATION_EVIDENCE_MISSING' }));
  });

  it('reports malformed mutation executions without throwing', async () => {
    const root = await project();
    await writeJson(root, '.musubix/evidence/mutation.json', {
      schemaVersion: 1,
      runId: '123e4567-e89b-42d3-a456-426614174000',
      generatedAt: new Date().toISOString(),
      executions: [null],
    });
    const result = await validateMutationEvidence(root);
    expect(result.valid).toBe(false);
    expect(result.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'MUTATION_PROVENANCE_SCHEMA' }));
  });

  it.each(['survived', 'skipped'] as const)('rejects %s mutants', async (status) => {
    const root = await project();
    await configureMutation(root, status);
    const gate = await runGate(root);
    expect(gate.status).toBe('fail');
    expect(gate.checks.find((check) => check.name === 'mutation')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'MUTATION_NOT_KILLED' }));
  });

  it('rejects duplicate, unlinked, and stale mutation evidence', async () => {
    const duplicateRoot = await project();
    await configureMutation(duplicateRoot, 'killed', {}, true);
    expect((await runGate(duplicateRoot)).checks.find((check) => check.name === 'mutation')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'MUTATION_DUPLICATE' }));

    const unlinkedRoot = await project();
    await configureMutation(unlinkedRoot, 'killed', { testId: 'TEST-OTHER-001' });
    expect((await runGate(unlinkedRoot)).checks.find((check) => check.name === 'mutation')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'MUTATION_TEST_UNLINKED' }));

    const staleRoot = await project();
    await configureMutation(staleRoot);
    await runGate(staleRoot);
    await writeText(staleRoot, 'src/service.ts', `${await readText(staleRoot, 'src/service.ts')}\nexport const changed = true;\n`);
    expect((await validateMutationEvidence(staleRoot)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'MUTATION_SOURCE_STALE' }));
  });

  it('prevents weakening strict mutation policy', () => {
    const baseline = {
      ...defaultConfig,
      mutation: { mode: 'strict' as const },
      requiredCommands: [],
    };
    expect(policyDiagnostics(defaultConfig, baseline).map((diagnostic) => diagnostic.code))
      .toContain('POLICY_MUTATION_MODE');
  });
});
