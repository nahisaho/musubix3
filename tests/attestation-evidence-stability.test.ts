import { generateKeyPairSync, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attestationSigningPayload, collectEvidenceHeads, createUnsignedAttestation, digest, loadConfig,
  mutationEvidenceHead, mutationIdentity, readText, recordChangePhase, recordWorkflow, runGate, runProcess,
  runTddPhase, verifyEvidenceAttestation, verifyWorkflowLog, writeJson, writeText, type MutationEvidence,
  type MutationRecord, type Runner,
} from '../packages/analysis/src/index.js';
import { processResult, project } from './helpers.js';

const requirement = `---
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

const gitRunner: Runner = async (command, args, options) => command === 'git'
  ? processResult({ stdout: args[0] === 'config' ? 'owner/repository.git\n' : `${'a'.repeat(40)}\n` })
  : runProcess(command, args, options);

function mutant(
  overrides: Pick<MutationRecord, 'operator' | 'location'>,
  fingerprints: { sourceSha256: string; testSha256: string },
): MutationRecord {
  const base = {
    requirementId: 'REQ-EXAMPLE-001',
    testId: 'TEST-EXAMPLE-001',
    sourcePath: 'src/service.ts',
    sourceSha256: fingerprints.sourceSha256,
    testPath: 'src/service.test.ts',
    testSha256: fingerprints.testSha256,
    status: 'killed' as const,
    ...overrides,
  };
  return { ...base, id: mutationIdentity(base) };
}

describe('attestation evidence-head stability across no-op gate re-runs', () => {
  /** @id TEST-ATTESTATION-EVIDENCE-STABILITY-001
   * @verifies REQ-ATTESTATION-EVIDENCE-STABILITY-002
   */
  it('TEST-ATTESTATION-EVIDENCE-STABILITY-001 mutationEvidenceHead is invariant to mutant array order', () => {
    const fingerprints = { sourceSha256: 'a'.repeat(64), testSha256: 'b'.repeat(64) };
    const mutantA = mutant({ operator: 'boolean-negation', location: { line: 5, column: 38 } }, fingerprints);
    const mutantB = mutant({ operator: 'arithmetic-swap', location: { line: 6, column: 10 } }, fingerprints);
    const execution = {
      executionId: 'c'.repeat(64),
      commandName: 'mutation',
      commandSha256: 'd'.repeat(64),
      reportPath: '.musubix/evidence/mutation-report.json',
      reportSha256: 'e'.repeat(64),
      processStatus: 'completed' as const,
      exitCode: 0,
      recordSha256: 'f'.repeat(64),
    };
    const forward: MutationEvidence = {
      schemaVersion: 1, runId: '11111111-1111-4111-8111-111111111111', generatedAt: new Date(0).toISOString(),
      executions: [{ ...execution, mutants: [mutantA, mutantB] }],
    };
    const reversed: MutationEvidence = {
      schemaVersion: 1, runId: '22222222-2222-4222-8222-222222222222', generatedAt: new Date(1).toISOString(),
      executions: [{ ...execution, mutants: [mutantB, mutantA] }],
    };
    expect(mutationEvidenceHead(forward as unknown as Record<string, unknown>))
      .toBe(mutationEvidenceHead(reversed as unknown as Record<string, unknown>));

    const duplicated: MutationEvidence = {
      ...forward,
      executions: [{ ...execution, mutants: [mutantA, mutantB, mutantB] }],
    };
    expect(mutationEvidenceHead(duplicated as unknown as Record<string, unknown>))
      .not.toBe(mutationEvidenceHead(forward as unknown as Record<string, unknown>));

    const changedField: MutationEvidence = {
      ...forward,
      executions: [{ ...execution, mutants: [{ ...mutantA, status: 'survived' }, mutantB] }],
    };
    expect(mutationEvidenceHead(changedField as unknown as Record<string, unknown>))
      .not.toBe(mutationEvidenceHead(forward as unknown as Record<string, unknown>));
  });

  /** @id TEST-ATTESTATION-EVIDENCE-STABILITY-002
   * @verifies REQ-ATTESTATION-EVIDENCE-STABILITY-003
   */
  it('TEST-ATTESTATION-EVIDENCE-STABILITY-002 keeps a signed attestation valid across a no-op gate re-run with reordered mutants', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md', requirement);
    const fingerprints = {
      sourceSha256: digest(await readText(root, 'src/service.ts')),
      testSha256: digest(await readText(root, 'src/service.test.ts')),
    };

    const mutantX = mutant({ operator: 'boolean-negation', location: { line: 5, column: 38 } }, fingerprints);
    const mutantY = mutant({ operator: 'arithmetic-swap', location: { line: 6, column: 10 } }, fingerprints);
    const forwardMutants = JSON.stringify([mutantX, mutantY]);
    const reversedMutants = JSON.stringify([mutantY, mutantX]);
    const script = `const fs=require('fs'),path=require('path');`
      + `const reportPath=process.argv[1];`
      + `const counter=path.join('.musubix','evidence','mutation-order-counter.txt');`
      + `const seen=fs.existsSync(counter);`
      + `const mutants=seen?${reversedMutants}:${forwardMutants};`
      + `fs.mkdirSync(path.dirname(reportPath),{recursive:true});`
      + `fs.writeFileSync(reportPath,JSON.stringify({schemaVersion:1,mutants}));`
      + `fs.mkdirSync(path.dirname(counter),{recursive:true});`
      + `fs.writeFileSync(counter,'1');`;

    const config = await loadConfig(root);
    config.mutation = { mode: 'strict' };
    config.requiredChecks.push('mutation');
    config.commands.push({
      name: 'mutation',
      command: process.execPath,
      args: ['-e', script, '{reportPath}'],
      mutationReport: { format: 'musubix-mutation-json', path: '.musubix/evidence/mutation-report.json' },
      required: true,
      timeoutMs: 10_000,
    });
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    config.attestation = {
      mode: 'ci-required',
      repository: 'owner/repository',
      trustedPublicKeys: [{ id: 'ci-key', publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
      githubOidc: { mode: 'off' },
    };
    await writeJson(root, '.musubix/config.json', config);

    await runGate(root, { runner: gitRunner });
    const firstMutationHead = (await collectEvidenceHeads(root)).mutation;
    expect(firstMutationHead).toBeTruthy();

    const unsigned = await createUnsignedAttestation(root, { provider: 'github', runId: '123', keyId: 'ci-key' }, gitRunner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), privateKey).toString('base64'),
    });
    const environment = {
      GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'owner/repository', GITHUB_SHA: 'a'.repeat(40),
    };
    expect(await verifyEvidenceAttestation(root, config.attestation, gitRunner, environment))
      .toMatchObject({ valid: true, status: 'verified', diagnostics: [] });

    await runGate(root, { runner: gitRunner, environment });
    const secondMutationHead = (await collectEvidenceHeads(root)).mutation;
    expect(secondMutationHead).toBe(firstMutationHead);
    expect(await verifyEvidenceAttestation(root, config.attestation, gitRunner, environment))
      .toMatchObject({ valid: true, status: 'verified' });
  });

  /** @id TEST-ATTESTATION-EVIDENCE-STABILITY-003
   * @verifies REQ-ATTESTATION-EVIDENCE-STABILITY-001
   */
  it('TEST-ATTESTATION-EVIDENCE-STABILITY-003 keeps all ten evidenceHeads entries stable across full, --changed, and --feature no-op re-runs', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md', requirement);

    const reportScript = (status: string) => `const fs=require('fs'),path=require('path');`
      + `const p=process.argv[1];fs.mkdirSync(path.dirname(p),{recursive:true});`
      + `fs.writeFileSync(p,JSON.stringify({schemaVersion:1,executionNonce:require('crypto').randomUUID(),`
      + `generatedAt:new Date().toISOString(),tests:[{id:'TEST-EXAMPLE-001',status:'${status}'}]}));`;

    const mutantP = mutant({ operator: 'boolean-negation', location: { line: 5, column: 38 } }, {
      sourceSha256: digest(await readText(root, 'src/service.ts')),
      testSha256: digest(await readText(root, 'src/service.test.ts')),
    });
    const mutationScript = `const fs=require('fs'),path=require('path');`
      + `const reportPath=process.argv[1];`
      + `fs.mkdirSync(path.dirname(reportPath),{recursive:true});`
      + `fs.writeFileSync(reportPath,JSON.stringify({schemaVersion:1,mutants:${JSON.stringify([mutantP])}}));`;

    const config = await loadConfig(root);
    config.commands[0]!.testReport = { format: 'musubix-json', path: '.musubix/evidence/test-results.json' };
    config.commands[0]!.args = ['-e', reportScript('passed'), '{reportPath}'];
    config.mutation = { mode: 'strict' };
    config.requiredChecks.push('mutation');
    config.commands.push({
      name: 'mutation',
      command: process.execPath,
      args: ['-e', mutationScript, '{reportPath}'],
      mutationReport: { format: 'musubix-mutation-json', path: '.musubix/evidence/mutation-report.json' },
      required: true,
      timeoutMs: 10_000,
    });
    await writeJson(root, '.musubix/config.json', config);

    // Seed `workflow`: `verifyWorkflowLog` (not `recordWorkflow` alone) populates the
    // `verification` block `workflowEvidenceHead` requires.
    await recordWorkflow(root, { skill: 'attestation-evidence-stability', phase: 'requirements', status: 'completed' });
    const transcript = [
      {
        type: 'tool.execution_start', timestamp: '2020-01-01T00:00:01.000Z',
        data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'attestation-evidence-stability' } },
      },
      { type: 'tool.execution_complete', timestamp: '2020-01-01T00:00:02.000Z', data: { toolCallId: 'call-1', success: true } },
      { type: 'result', timestamp: '2020-01-01T00:00:03.000Z', sessionId: '123e4567-e89b-42d3-a456-426614174000', exitCode: 0 },
    ].map((event) => JSON.stringify(event)).join('\n');
    await verifyWorkflowLog(root, transcript, { mode: 'compatible' });

    // Seed `changes`.
    await writeText(root, '.musubix/changes/CHANGE-9001.md', '# CHANGE-9001\n\nRequirements: REQ-EXAMPLE-001\n');
    await recordChangePhase(root, 'CHANGE-9001', 'impact', ['REQ-EXAMPLE-001']);

    // Seed `tdd`: Red (failing, nonzero exit) then Green (passing, zero exit); the Red→Green
    // config edits below (reconfiguring the `test` command's args) themselves constitute the
    // non-test tracked-file change `runTddPhase`'s Green phase requires versus Red.
    const redConfig = await loadConfig(root);
    redConfig.commands[0]!.args = ['-e', `${reportScript('failed')}process.exit(1)`, '{reportPath}'];
    redConfig.commands[0]!.tddArgs = ['-e', `${reportScript('failed')}process.exit(1)`, '{reportPath}', '{testId}'];
    redConfig.commands[0]!.tddReport = { format: 'musubix-json', path: '.musubix/evidence/tdd-results-{testId}.json' };
    await writeJson(root, '.musubix/config.json', redConfig);
    const redResult = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test');
    expect(redResult.valid).toBe(true);

    const greenConfig = await loadConfig(root);
    greenConfig.commands[0]!.args = ['-e', reportScript('passed'), '{reportPath}'];
    greenConfig.commands[0]!.tddArgs = ['-e', reportScript('passed'), '{reportPath}', '{testId}'];
    greenConfig.commands[0]!.tddReport = { format: 'musubix-json', path: '.musubix/evidence/tdd-results-{testId}.json' };
    await writeJson(root, '.musubix/config.json', greenConfig);
    const greenResult = await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test');
    expect(greenResult.valid).toBe(true);

    // A single gate run populates `formal`/`performance`/`modelCorrespondence`/`quality`/`workspace`
    // unconditionally (see collectEvidenceHeads / gate.ts), so together with the five keys seeded
    // above, all ten entries are now present.
    await runGate(root);
    const heads = await collectEvidenceHeads(root);
    expect(Object.keys(heads).sort()).toEqual([
      'changes', 'formal', 'modelCorrespondence', 'mutation', 'order', 'performance', 'quality', 'tdd', 'workflow',
      'workspace',
    ].sort());

    const tenKeys = [
      'changes', 'formal', 'modelCorrespondence', 'mutation', 'order', 'performance', 'quality', 'tdd', 'workflow',
      'workspace',
    ].sort();
    for (const options of [{}, { changed: true }, { feature: 'example' }] as const) {
      await runGate(root, options);
      const beforeHeads = await collectEvidenceHeads(root);
      expect(Object.keys(beforeHeads).sort()).toEqual(tenKeys);
      await runGate(root, options);
      const afterHeads = await collectEvidenceHeads(root);
      expect(Object.keys(afterHeads).sort()).toEqual(tenKeys);
      expect(afterHeads).toEqual(beforeHeads);
    }
  });

  /** @id TEST-ATTESTATION-EVIDENCE-STABILITY-004
   * @verifies REQ-ATTESTATION-EVIDENCE-STABILITY-004
   */
  it('TEST-ATTESTATION-EVIDENCE-STABILITY-004 documents every collectEvidenceHeads key\'s exact retained/excluded fields in README.md', async () => {
    const readme = await readFile(resolve('README.md'), 'utf8');
    const heading = '#### Attestation evidence-head composition';
    const start = readme.indexOf(heading);
    expect(start).toBeGreaterThanOrEqual(0);
    const section = readme.slice(start, readme.indexOf('\n#### ', start + heading.length));

    for (const key of [
      'tdd', 'workflow', 'changes', 'order', 'formal', 'performance', 'mutation', 'modelCorrespondence',
      'quality', 'workspace',
    ]) {
      expect(section).toContain(`\`${key}\``);
    }

    // Chain-tip (not full-projection) heads.
    expect(section).toMatch(/`tdd`[\s\S]*chain-tip digest/);
    expect(section).toMatch(/`order`[\s\S]*chain-tip digest/);

    // `changes` is sourced from changes.json directly, not the CHANGE-*.md documents.
    expect(section).toMatch(/`changes`[\s\S]*changes\.json[\s\S]*not the `\.musubix\/changes\/\*\.md`/);

    // `workflow` excludes the raw events log and names its exact retained verification fields.
    expect(section).toContain('`eventsSha256`');
    expect(section).toContain('`invocations`');
    expect(section).toContain('excluded');

    // `performance` names its exact retained execution/observation/provenance fields.
    expect(section).toContain('`processStatus`');
    expect(section).toContain('`exitCode`');

    // `mutation` names its sorted nested `mutants` array (the DES-001 fix).
    expect(section).toMatch(/`mutation`[\s\S]*`mutants`[\s\S]*order-independently/);

    // `modelCorrespondence` names its exact retained/excluded test-projection fields.
    expect(section).toContain('`reportSha256`');
    expect(section).toContain('`provenanceSha256`');

    // `quality` names its exact excluded fields.
    expect(section).toMatch(/`quality`[\s\S]*excludes[\s\S]*`generatedAt`/);

    // `workspace` is explicitly labeled as a repository snapshot, not an evidence file.
    expect(section).toMatch(/`workspace`[\s\S]*not an evidence file/);
  });
});
