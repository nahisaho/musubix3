import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  attestationSigningPayload, collectEvidenceHeads, createUnsignedAttestation, loadConfig,
  projectStatus, readText, runGate, runProcess, validatePerformanceEvidence, verifyEvidenceAttestation,
  writeJson, writeText, type AttestationConfig, type PerformanceEvidence, type Runner,
} from '../packages/analysis/src/index.js';
import { processResult, project, req } from './helpers.js';

const requirement = `${req('The system shall bound traversal work.', 'REQ-EXAMPLE-001')}Type: non-functional
Acceptance: TEST-EXAMPLE-001 reports at most 10 visitedNodes operations.
Performance: {"counter":"visitedNodes","max":10,"testId":"TEST-EXAMPLE-001"}
`;

function reportScript(status: string, value: number, exitCode = 0): string {
  return `const fs=require('fs'),p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({schemaVersion:1,executionNonce:require('crypto').randomUUID(),generatedAt:new Date().toISOString(),tests:[{id:'TEST-EXAMPLE-001',status:'${status}',operations:{visitedNodes:${value}}}]}));process.exit(${exitCode})`;
}

async function configurePerformance(root: string, status = 'passed', value = 8, exitCode = 0): Promise<void> {
  await writeText(root, '.musubix/features/example/requirements.md', requirement);
  const config = await loadConfig(root);
  config.commands[0]!.testReport = { format: 'musubix-json', path: '.musubix/evidence/test-results.json' };
  config.commands[0]!.args = ['-e', reportScript(status, value, exitCode), '{reportPath}'];
  await writeJson(root, '.musubix/config.json', config);
}

describe('P3 deterministic performance provenance', () => {
  it('binds every observation to the exact successful command and fresh report', async () => {
    const root = await project();
    await configurePerformance(root);
    const gate = await runGate(root);
    expect(gate.checks.find((check) => check.name === 'performance')).toMatchObject({ status: 'pass' });

    const evidence = JSON.parse(await readText(root, '.musubix/evidence/performance.json')) as PerformanceEvidence;
    expect(evidence).toMatchObject({
      schemaVersion: 2,
      runId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      observations: [{
        requirementId: 'REQ-EXAMPLE-001',
        testId: 'TEST-EXAMPLE-001',
        counter: 'visitedNodes',
        observed: 8,
        status: 'pass',
        provenance: {
          commandName: 'test',
          commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          reportPath: '.musubix/evidence/test-results.json',
          sourceKind: 'file',
          reportSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          testId: 'TEST-EXAMPLE-001',
          testStatus: 'passed',
          counter: 'visitedNodes',
          value: 8,
          processStatus: 'completed',
          exitCode: 0,
          executionId: expect.stringMatching(/^[a-f0-9]{64}$/),
          recordSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      }],
    });
    expect(await validatePerformanceEvidence(root)).toMatchObject({ valid: true, budgets: 1 });
  });

  it('detects report tampering and makes prior quality status stale', async () => {
    const root = await project();
    await configurePerformance(root);
    await runGate(root);
    await writeJson(root, '.musubix/evidence/test-results.json', {
      schemaVersion: 1,
      tests: [{ id: 'TEST-EXAMPLE-001', status: 'passed', operations: { visitedNodes: 9 } }],
    });
    expect((await validatePerformanceEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_REPORT_TAMPERED' }));
    expect((await projectStatus(root)).gate).toMatchObject({ status: 'stale', ready: false });
  });

  it('rejects duplicate counter reports and counters from failed or skipped tests', async () => {
    const duplicateRoot = await project();
    await configurePerformance(duplicateRoot);
    const duplicateConfig = await loadConfig(duplicateRoot);
    duplicateConfig.commands.push({
      ...duplicateConfig.commands[0]!,
      name: 'test-copy',
      testReport: { format: 'musubix-json', path: '.musubix/evidence/test-results-copy.json' },
    });
    await writeJson(duplicateRoot, '.musubix/config.json', duplicateConfig);
    const duplicate = await runGate(duplicateRoot);
    expect(duplicate.checks.find((check) => check.name === 'performance')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_REPORT_CONFLICT' }));

    for (const status of ['failed', 'skipped'] as const) {
      const root = await project();
      await configurePerformance(root, status);
      const gate = await runGate(root);
      expect(gate.checks.find((check) => check.name === 'performance')?.diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_COUNTER_TEST_STATUS' }));
    }
  });

  it('rejects failed executions, missing provenance, and configuration drift', async () => {
    const failedRoot = await project();
    await configurePerformance(failedRoot, 'passed', 8, 1);
    const failed = await runGate(failedRoot);
    expect(failed.checks.find((check) => check.name === 'performance')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_PROVENANCE_MISSING' }));

    const root = await project();
    await configurePerformance(root);
    await runGate(root);
    const evidencePath = '.musubix/evidence/performance.json';
    const evidence = JSON.parse(await readText(root, evidencePath)) as PerformanceEvidence;
    delete evidence.observations[0]!.provenance;
    await writeJson(root, evidencePath, evidence);
    expect((await validatePerformanceEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_PROVENANCE_MISSING' }));

    await runGate(root);
    const mismatched = JSON.parse(await readText(root, evidencePath)) as PerformanceEvidence;
    mismatched.observations[0]!.observed = 7;
    await writeJson(root, evidencePath, mismatched);
    expect((await validatePerformanceEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_PROVENANCE_MISMATCH' }));

    await runGate(root);
    const config = await loadConfig(root);
    config.commands[0]!.args[1] = `${config.commands[0]!.args[1]} `;
    await writeJson(root, '.musubix/config.json', config);
    expect((await validatePerformanceEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_COMMAND_MISMATCH' }));
  });

  it('binds semantic provenance records into the attestation performance head', async () => {
    const root = await project();
    await configurePerformance(root);
    await runGate(root);
    const before = (await collectEvidenceHeads(root)).performance;
    const path = '.musubix/evidence/performance.json';
    const evidence = JSON.parse(await readText(root, path)) as PerformanceEvidence;
    evidence.observations[0]!.provenance!.value = 9;
    await writeJson(root, path, evidence);
    expect((await collectEvidenceHeads(root)).performance).not.toBe(before);
  });

  it('keeps semantic performance and quality heads stable across gate-sign-gate runs', async () => {
    const root = await project();
    await configurePerformance(root);
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const config = await loadConfig(root);
    config.attestation = {
      mode: 'ci-required',
      repository: 'owner/repository',
      maxAgeSeconds: 600,
      maxFutureSkewSeconds: 30,
      trustedPublicKeys: [{ id: 'ci-key', publicKey: publicKeyPem }],
      githubOidc: { mode: 'off' },
    };
    await writeJson(root, '.musubix/config.json', config);
    const runner: Runner = async (command, args, options) => command === 'git'
      ? processResult({ stdout: args[0] === 'config' ? 'owner/repository.git\n' : `${'a'.repeat(40)}\n` })
      : runProcess(command, args, options);

    await runGate(root, { runner });
    const firstEvidence = JSON.parse(await readText(root, '.musubix/evidence/performance.json')) as PerformanceEvidence;
    const firstHeads = await collectEvidenceHeads(root);
    const unsigned = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '123',
      keyId: 'ci-key',
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), privateKey).toString('base64'),
    });

    const gate = await runGate(root, {
      runner,
      environment: {
        GITHUB_ACTIONS: 'true',
        GITHUB_RUN_ID: '123',
        GITHUB_REPOSITORY: 'owner/repository',
        GITHUB_SHA: 'a'.repeat(40),
      },
    });
    const secondEvidence = JSON.parse(await readText(root, '.musubix/evidence/performance.json')) as PerformanceEvidence;
    const secondHeads = await collectEvidenceHeads(root);
    expect(secondEvidence.runId).not.toBe(firstEvidence.runId);
    expect(secondEvidence.executions[0]?.executionId).not.toBe(firstEvidence.executions[0]?.executionId);
    expect(secondEvidence.executions[0]?.reportSha256).not.toBe(firstEvidence.executions[0]?.reportSha256);
    expect(secondHeads.performance).toBe(firstHeads.performance);
    expect(secondHeads.quality).toBe(firstHeads.quality);
    expect(gate.checks.find((check) => check.name === 'attestation')).toMatchObject({ status: 'pass' });
    expect(await verifyEvidenceAttestation(root, config.attestation, runner, {
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '123',
      GITHUB_REPOSITORY: 'owner/repository',
      GITHUB_SHA: 'a'.repeat(40),
    })).toMatchObject({ valid: true, status: 'verified' });
  });

  it('attests stable quality verdicts and widened formal verdict fields', async () => {
    const root = await project();
    await runGate(root);
    const first = await collectEvidenceHeads(root);
    const qualityPath = '.musubix/evidence/quality.json';
    const quality = JSON.parse(await readText(root, qualityPath));
    quality.generatedAt = new Date(0).toISOString();
    quality.checks.find((check: { name: string }) => check.name === 'commands').durationMs = 999999;
    await writeJson(root, qualityPath, quality);
    expect((await collectEvidenceHeads(root)).quality).toBe(first.quality);
    quality.checks.find((check: { name: string }) => check.name === 'commands').status = 'fail';
    await writeJson(root, qualityPath, quality);
    expect((await collectEvidenceHeads(root)).quality).not.toBe(first.quality);

    const formalPath = '.musubix/evidence/formal.json';
    const formal = JSON.parse(await readText(root, formalPath));
    const formalHead = (await collectEvidenceHeads(root)).formal;
    formal.result.solver.status = formal.result.solver.status === 'missing' ? 'error' : 'missing';
    await writeJson(root, formalPath, formal);
    expect((await collectEvidenceHeads(root)).formal).not.toBe(formalHead);
    const solverHead = (await collectEvidenceHeads(root)).formal;
    formal.totalRequirements += 1;
    await writeJson(root, formalPath, formal);
    expect((await collectEvidenceHeads(root)).formal).not.toBe(solverHead);
    const totalHead = (await collectEvidenceHeads(root)).formal;
    formal.modeledFraction = 0.123;
    await writeJson(root, formalPath, formal);
    expect((await collectEvidenceHeads(root)).formal).not.toBe(totalHead);
  });

  it('persists stdout adapter reports and detects later tampering', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md', requirement);
    const config = await loadConfig(root);
    config.commands[0] = {
      name: 'test',
      command: 'cargo',
      args: [],
      adapter: 'cargo',
      required: true,
      timeoutMs: 10_000,
    };
    await writeJson(root, '.musubix/config.json', config);
    const runner: Runner = async () => processResult({
      stdout: 'test TEST-EXAMPLE-001 ... ok\n',
    });
    await runGate(root, { runner });
    const reportPath = '.musubix/evidence/native/test/aggregate.json';
    expect(await readText(root, reportPath)).toContain('TEST-EXAMPLE-001');
    await writeText(root, reportPath, 'test TEST-EXAMPLE-001 ... FAILED\n');
    expect((await validatePerformanceEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'PERFORMANCE_REPORT_TAMPERED' }));
  });

  it('fails attestation verification when the bound report is changed after signing', async () => {
    const root = await project();
    await configurePerformance(root);
    await runGate(root);
    const runner: Runner = async (_command, args) => processResult({
      stdout: args[0] === 'config' ? 'owner/repository.git\n' : `${'a'.repeat(40)}\n`,
    });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const unsigned = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '123',
      keyId: 'ci-key',
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), privateKey).toString('base64'),
    });
    await writeJson(root, '.musubix/evidence/test-results.json', {
      schemaVersion: 1,
      tests: [{ id: 'TEST-EXAMPLE-001', status: 'passed', operations: { visitedNodes: 9 } }],
    });
    const config: AttestationConfig = {
      mode: 'ci-required',
      repository: 'owner/repository',
      trustedPublicKeys: [{ id: 'ci-key', publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
    };
    expect((await verifyEvidenceAttestation(root, config, runner, {
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '123',
    })).diagnostics).toContainEqual(expect.objectContaining({ code: 'ATTESTATION_PERFORMANCE_PROVENANCE' }));
  });
});
