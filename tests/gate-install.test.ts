import { mkdir, readdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  aggregateStatus, changedFiles, defaultConfig, exists, loadConfig, loadTddEvidence, parseConfig, projectStatus, readText,
  recordChangePhase, recordWorkflow, runGate, runProcess, runTddPhase, validateChangeCompleteness, validateChangeEvidence, validateTddEvidence,
  verifyWorkflowLog, writeJson, writeText, type Runner,
} from '../packages/analysis/src/index.js';
import { install, pluginInstall, skillNames } from '../packages/cli/src/install.js';
import { code, fixture, missingRunner, processResult, project, repository, tddResultRunner, testCode } from './helpers.js';

describe('installer', () => {
  it('dry-run leaves even a nonexistent target untouched', async () => {
    const root = resolve(await fixture(), 'new-project');
    const report = await install(root, repository, { dryRun: true });
    expect(await exists(root)).toBe(false);
    expect(report.dryRun).toBe(true);
    expect(report.actions.filter((a) => a.path.startsWith('.github/skills'))).toHaveLength(skillNames.length);
  });

  it('installs all assets, generates trace and is idempotent', async () => {
    const root = await fixture();
    const first = await install(root, repository);
    expect(first.actions.every((a) => a.action === 'create')).toBe(true);
    expect(await readdir(resolve(root, '.github/skills'))).toEqual([...skillNames].sort());
    const trace = await readText(root, '.musubix/features/example/trace.json');
    expect(JSON.parse(trace).nodes).toHaveLength(3);
    const again = await install(root, repository);
    expect(again.actions.every((a) => ['unchanged', 'preserve'].includes(a.action))).toBe(true);
    expect(await readText(root, '.musubix/features/example/trace.json')).toBe(trace);
    expect((await readText(root, '.gitignore')).match(/\/\.musubix\/cache\//g)).toHaveLength(1);
  });

  it('preserves user files by default and force touches only bundled paths', async () => {
    const root = await fixture({
      '.github/skills/sdd-quality/SKILL.md': 'custom skill',
      '.github/skills/custom/SKILL.md': 'unmanaged',
      '.github/copilot-instructions.md': 'user instructions',
      '.musubix/config.json': '{"custom":true}',
      '.gitignore': 'node_modules/\n# user comment',
    });
    const report = await install(root, repository);
    expect(report.actions.find((a) => a.path.endsWith('sdd-quality/SKILL.md'))?.action).toBe('preserve');
    expect(await readText(root, '.musubix/config.json')).toBe('{"custom":true}');
    expect(await readText(root, '.gitignore')).toContain('node_modules/\n# user comment\n');
    await install(root, repository, { force: true });
    expect(await readText(root, '.github/skills/sdd-quality/SKILL.md')).toContain('name: sdd-quality');
    expect(await readText(root, '.github/skills/custom/SKILL.md')).toBe('unmanaged');
    expect(await readText(root, '.github/copilot-instructions.md')).toBe('user instructions');
  });

  it('gives distinct feature IDs and rejects unsafe slugs', async () => {
    const root = await fixture();
    await install(root, repository, { feature: 'login-flow' });
    expect(await readText(root, '.musubix/features/login-flow/requirements.md')).toContain('REQ-LOGIN-FLOW-001');
    await expect(install(root, repository, { feature: '../../escape' })).rejects.toThrow('slug');
  });

  it('refuses symlink destinations before writing any assets', async () => {
    const root = await fixture();
    const outside = await fixture();
    await mkdir(resolve(root, '.github'));
    await symlink(outside, resolve(root, '.github/skills'));
    await expect(install(root, repository)).rejects.toThrow('symbolic link');
    expect(await readdir(outside)).toEqual([]);
    expect(await exists(resolve(root, '.musubix'))).toBe(false);
  });

  it('delegates native plugin installation via an injectable runner', async () => {
    const runner = vi.fn<Runner>(async () => processResult());
    await pluginInstall(repository, runner);
    expect(runner).toHaveBeenCalledWith('copilot', ['plugin', 'install', repository], { cwd: repository, timeoutMs: 120_000 });
  });
});

describe('quality semantics', () => {
  it.each([
    ['pass', true, 'pass'], ['fail', true, 'fail'], ['skipped', true, 'fail'],
    ['pass', false, 'pass'], ['fail', false, 'pass'], ['skipped', false, 'pass'],
  ] as const)('%s required=%s aggregates to %s', (status, required, expected) => {
    expect(aggregateStatus([{ name: 'check', status, required, summary: '' }])).toBe(expected);
  });

  it('runs actual commands and persists freshness-aware successful evidence', async () => {
    const root = await project();
    const report = await runGate(root);
    expect(report.status).toBe('pass');
    expect(report.checks.find((c) => c.name === 'command:test')).toMatchObject({ status: 'pass', exitCode: 0, stdout: 'real-check\n' });
    expect(JSON.parse(await readText(root, '.musubix/evidence/quality.json'))).toEqual(report);
    expect((await projectStatus(root)).gate.ready).toBe(true);
    await writeText(root, 'logs/copilot-session.jsonl', '{"type":"log"}\n');
    expect((await projectStatus(root)).gate.ready).toBe(true);
    await writeText(root, 'src/new.ts', 'export {};');
    expect((await projectStatus(root)).gate).toMatchObject({ ready: false, status: 'stale' });
  });

  it('uses a monotonic clock for process durations', async () => {
    const wallClock = vi.spyOn(Date, 'now').mockReturnValueOnce(5_000).mockReturnValue(1_000);
    try {
      const result = await runProcess(process.execPath, ['-e', ''], { cwd: repository, timeoutMs: 10_000 });
      expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(wallClock).not.toHaveBeenCalled();
    } finally {
      wallClock.mockRestore();
    }
  });

  it('supports a required formal gate with persisted modeled coverage', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.requiredChecks.push('formal');
    config.formal = { solver: 'none', minModeledFraction: 1, timeoutMs: 12_000 };
    await writeJson(root, '.musubix/config.json', config);
    const report = await runGate(root);
    expect(report.checks.find((check) => check.name === 'formal')).toMatchObject({ status: 'pass', required: true });
    expect(report.metrics['formal.modeledFraction']).toBe(1);
    expect(JSON.parse(await readText(root, '.musubix/evidence/formal.json'))).toMatchObject({
      totalRequirements: 1,
      modeledRequirements: 1,
      modeledFraction: 1,
      result: { consistency: 'consistent' },
    });
  });

  it('requires annotated test IDs to pass in a fresh structured command report', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.requiredChecks.push('test-identities');
    config.commands[0]!.testReport = { format: 'musubix-json', path: '.musubix/evidence/test-results.json' };
    config.commands[0]!.args = [
      '-e',
      "const fs=require('fs'),p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({schemaVersion:1,tests:[{id:'TEST-EXAMPLE-001',status:'passed'}]}));console.log('different output')",
      '{reportPath}',
    ];
    await writeJson(root, '.musubix/config.json', config);
    const passed = await runGate(root);
    expect(passed.checks.find((check) => check.name === 'test-identities')).toMatchObject({ status: 'pass', required: true });
    config.commands[0]!.args = [
      '-e',
      "const fs=require('fs'),p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({schemaVersion:1,tests:[{id:'TEST-OTHER-001',status:'passed'}]}));console.log('TEST-EXAMPLE-001')",
      '{reportPath}',
    ];
    await writeJson(root, '.musubix/config.json', config);
    const failed = await runGate(root);
    expect(failed.status).toBe('fail');
    expect(failed.checks.find((check) => check.name === 'test-identities')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TEST_ID_NOT_PASSED' }));
  });

  it('records a verified Red-Green-Refactor cycle without allowing test mutation', async () => {
    const root = await project();
    const red = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    expect(red.valid).toBe(true);
    await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
    const green = await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    expect(green.valid).toBe(true);
    const refactor = await runTddPhase(root, 'refactor', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    expect(refactor.valid).toBe(true);
    expect(await validateTddEvidence(root)).toMatchObject({ present: true, valid: true, cycles: 1 });
    expect((await runGate(root)).checks.find((check) => check.name === 'tdd')).toMatchObject({ required: true, status: 'pass' });
    await writeText(root, 'src/service.test.ts', `${testCode}
/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-001
 */
export function anotherTest() { return true; }
`);
    expect(await validateTddEvidence(root)).toMatchObject({ valid: true });
    await writeText(root, 'src/service.test.ts', testCode.replace("throw new Error('not ready')", "throw new Error('changed test')"));
    expect(await validateTddEvidence(root)).toMatchObject({ valid: false });
  });

  it('runs configured formatter preflights before capturing the Red test fingerprint', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.commands.unshift({
      name: 'format',
      command: 'formatter',
      args: ['--write'],
      required: true,
      timeoutMs: 10_000,
    });
    config.tdd.redPreflightCommands = ['format'];
    await writeJson(root, '.musubix/config.json', config);
    const calls: string[] = [];
    const runner: Runner = async (command, args) => {
      calls.push(command);
      if (command === 'formatter') {
        await writeText(root, 'src/service.test.ts', testCode.replace('export function testReadiness()', 'export function testReadiness() '));
        return processResult();
      }
      return tddResultRunner(root, 'failed', { exitCode: 1 })(command, args, {
        cwd: root,
        timeoutMs: 10_000,
      });
    };
    const red = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', runner);
    expect(red.valid).toBe(true);
    expect(calls).toEqual(['formatter', process.execPath]);

    config.commands[0]!.command = 'missing-formatter';
    await writeJson(root, '.musubix/config.json', config);
    await expect(runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      async (command, args, options) => command === 'missing-formatter'
        ? processResult({ status: 'missing', exitCode: null })
        : tddResultRunner(root, 'failed', { exitCode: 1 })(command, args, options)))
      .rejects.toThrow('preflight command format failed');
  });

  it('chains immutable TDD phase records and detects mutation, deletion and reordering', async () => {
    const root = await project();
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
    await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    await runTddPhase(root, 'refactor', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));

    const evidence = await loadTddEvidence(root);
    expect(evidence?.chain).toHaveLength(3);
    if (!evidence?.chain) throw new Error('Expected chained TDD evidence.');
    expect(evidence.chain.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(evidence.chain[1]?.previousSha256).toBe(evidence.chain[0]?.recordSha256);
    expect(await validateTddEvidence(root)).toMatchObject({ valid: true });

    const originalOutputSha256 = evidence.cycles[0]!.red.outputSha256;
    evidence.cycles[0]!.red.outputSha256 = 'tampered';
    await writeJson(root, '.musubix/evidence/tdd.json', evidence);
    expect((await validateTddEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TDD_CHAIN_PAYLOAD_MISMATCH' }));

    evidence.cycles[0]!.red.outputSha256 = originalOutputSha256;
    evidence.chain.splice(1, 1);
    await writeJson(root, '.musubix/evidence/tdd.json', evidence);
    const deleted = await validateTddEvidence(root);
    expect(deleted.valid).toBe(false);
    expect(deleted.diagnostics.some((diagnostic) =>
      ['TDD_CHAIN_SEQUENCE', 'TDD_CHAIN_LINK', 'TDD_CHAIN_PHASE_MISSING'].includes(diagnostic.code))).toBe(true);

    [evidence.chain[0], evidence.chain[1]] = [evidence.chain[1]!, evidence.chain[0]!];
    await writeJson(root, '.musubix/evidence/tdd.json', evidence);
    expect((await validateTddEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TDD_CHAIN_SEQUENCE' }));
  });

  it('rejects Green without Red and Red without a target failure result', async () => {
    const root = await project();
    await expect(runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'))).rejects.toThrow('Red');
    const red = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed', { exitCode: 1 }));
    expect(red.valid).toBe(false);
    expect(red.diagnostics).toContainEqual(expect.objectContaining({ code: 'TDD_TARGET_RESULT' }));
  });

  it('rejects negative TDD execution durations', async () => {
    const root = await project();
    const red = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1, durationMs: -1 }));
    expect(red.valid).toBe(false);
    expect(red.diagnostics).toContainEqual(expect.objectContaining({ code: 'TDD_DURATION_INVALID' }));
    expect((await validateTddEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TDD_DURATION_INVALID' }));
  });

  it('requires a Red-Green cycle for every mandatory requirement', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md',
      `${await readText(root, '.musubix/features/example/requirements.md')}
## REQ-EXAMPLE-002: Additional behavior
Priority: must
Statement: The system shall report additional behavior.
`);
    await writeText(root, 'src/service.test.ts', `${testCode}
/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-002
 */
export function additionalTest() { return true; }
`);
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
    await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    expect((await validateTddEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TDD_REQUIREMENT_UNCOVERED', message: expect.stringContaining('REQ-EXAMPLE-002') }));
  });

  it('proves staged change order with artifact fingerprints and TDD evidence', async () => {
    const root = await project();
    await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
    await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
    await writeText(root, '.musubix/features/example/requirements.md',
      `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
    await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
    await writeText(root, '.musubix/features/example/design.md',
      `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
    await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);
    await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior\n`);
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
    await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
    await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
    await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']);
    await recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001']);
    expect(await validateChangeEvidence(root)).toMatchObject({ present: true, valid: true, changes: 1 });
    expect(await validateChangeCompleteness(root)).toMatchObject({
      present: true,
      valid: true,
      changes: [expect.objectContaining({
        changeId: 'CHANGE-0001',
        functionalRequirements: 1,
        nonFunctionalRequirements: 0,
      })],
    });
    const requirementsText = await readText(root, '.musubix/features/example/requirements.md');
    await writeText(root, '.musubix/features/example/requirements.md', requirementsText.replace(/^Acceptance:.*$/m, 'Acceptance: TODO'));
    expect((await validateChangeCompleteness(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_COMPLETENESS_ACCEPTANCE' }));
    await writeText(root, '.musubix/features/example/requirements.md', requirementsText);
    await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-999\n');
    expect((await validateChangeCompleteness(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_REQUIREMENTS_MISMATCH' }));
    await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
    const design = await readText(root, '.musubix/features/example/design.md');
    await writeText(root, '.musubix/features/example/design.md', design.replace('ADR-0001', 'ADR-9999'));
    expect((await validateChangeCompleteness(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_COMPLETENESS_ADR' }));
    await writeText(root, '.musubix/features/example/design.md', design);

    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    await writeText(root, 'src/service.ts', code);
    await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    expect((await loadTddEvidence(root))?.cycles).toHaveLength(2);
    expect(await validateChangeEvidence(root)).toMatchObject({ valid: true });

    const config = await loadConfig(root);
    config.requiredChecks.push('change-history');
    await writeJson(root, '.musubix/config.json', config);
    expect((await runGate(root)).checks.find((check) => check.name === 'change-history'))
      .toMatchObject({ required: true, status: 'pass' });
    const tddEvidence = await loadTddEvidence(root);
    tddEvidence!.cycles[0]!.red.recordedAt = new Date(0).toISOString();
    tddEvidence!.cycles[0]!.green!.recordedAt = new Date(0).toISOString();
    await writeJson(root, '.musubix/evidence/tdd.json', tddEvidence);
    expect(await validateChangeEvidence(root)).toMatchObject({ valid: true });
    delete tddEvidence!.cycles[0]!.red.order;
    await writeJson(root, '.musubix/evidence/tdd.json', tddEvidence);
    expect((await validateChangeEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_ORDER_MIGRATION_REQUIRED' }));
    await writeText(root, '.musubix/changes/CHANGE-0002.md', '# CHANGE-0002\nRequirements: REQ-EXAMPLE-001\n');
    const missingRecord = await validateChangeEvidence(root);
    expect(missingRecord.valid).toBe(false);
    expect(missingRecord.diagnostics).toContainEqual(expect.objectContaining({ code: 'CHANGE_RECORD_MISSING' }));
  });

  it('rejects unrelated source changes as implementation evidence for a requirement', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md',
      `${await readText(root, '.musubix/features/example/requirements.md')}
## REQ-EXAMPLE-002: Unrelated behavior
Priority: should
Statement: The system should expose unrelated behavior.
`);
    await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
    await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
    await writeText(root, '.musubix/features/example/requirements.md',
      `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: scoped implementation evidence.\n`);
    await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
    await writeText(root, '.musubix/features/example/design.md',
      `${await readText(root, '.musubix/features/example/design.md')}\nChange: scoped implementation design.\n`);
    await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);
    await writeText(root, 'src/service.test.ts', `${testCode}\n// scoped failing behavior\n`);
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
    await writeText(root, 'src/unrelated.ts', `/** @id CODE-EXAMPLE-002
 * @implements REQ-EXAMPLE-002
 */
export const unrelated = false;
`);
    await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
    await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']);
    await recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001']);

    expect((await validateChangeEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED' }));
  });

  it('rejects unscoped commands, unchanged Green sources and reused cross-test output', async () => {
    const root = await project();
    const config = await loadConfig(root);
    delete config.commands[0]!.tddArgs;
    delete config.commands[0]!.tddReport;
    await writeJson(root, '.musubix/config.json', config);
    await expect(runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test')).rejects.toThrow('tddArgs');

    config.commands[0]!.tddArgs = ['--test', '{testId}', '{reportPath}'];
    config.commands[0]!.tddReport = { format: 'musubix-json', path: '.musubix/evidence/tdd-results/{testId}.json' };
    await writeJson(root, '.musubix/config.json', config);
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    const green = await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    expect(green.diagnostics).toContainEqual(expect.objectContaining({ code: 'TDD_GREEN_WITHOUT_SOURCE_CHANGE' }));
  });

  it('rejects reused TDD output and reconciles required workflow with actual Skill calls', async () => {
    const root = await project();
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
    await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
    evidence.cycles.push({
      ...evidence.cycles[0],
      testId: 'TEST-EXAMPLE-002',
      red: { ...evidence.cycles[0].red },
      green: { ...evidence.cycles[0].green },
    });
    await writeJson(root, '.musubix/evidence/tdd.json', evidence);
    expect((await validateTddEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TDD_EVIDENCE_REUSED' }));

    await recordWorkflow(root, { skill: 'sdd-change', phase: 'quality', status: 'completed' });
    const unverified = await runGate(root);
    expect(unverified.checks.find((check) => check.name === 'workflow')).toMatchObject({ required: true, status: 'fail' });
    const workflowTime = new Date(0).toISOString();
    await verifyWorkflowLog(root, `${JSON.stringify({
      type: 'tool.execution_start',
      timestamp: workflowTime,
      data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
    })}\n${JSON.stringify({
      type: 'tool.execution_complete',
      timestamp: workflowTime,
      data: { toolCallId: 'call-1', success: true },
    })}\n`);
    const verified = await runGate(root);
    expect(verified.checks.find((check) => check.name === 'workflow')).toMatchObject({ required: true, status: 'pass' });
  });

  it('fails a required formal gate below the modeled fraction threshold', async () => {
    const root = await project();
    await writeText(root, '.musubix/features/example/requirements.md',
      '## REQ-EXAMPLE-001: Event\nPriority: must\nStatement: When an event occurs, the system shall report readiness.\n');
    const config = await loadConfig(root);
    config.requiredChecks.push('formal');
    config.formal = { solver: 'none', minModeledFraction: 1, timeoutMs: 12_000 };
    await writeJson(root, '.musubix/config.json', config);
    const report = await runGate(root);
    expect(report.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'formal')?.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORMAL_COVERAGE' }));
  });

  it('fails missing required commands, while retaining skipped status', async () => {
    const root = await project();
    const report = await runGate(root, { runner: missingRunner });
    expect(report.status).toBe('fail');
    expect(report.checks.find((c) => c.name === 'command:test')?.status).toBe('skipped');
    expect(report.checks.find((c) => c.name === 'constitution:RULE-003')?.status).toBe('fail');
  });

  it('does not call absent commands or missing artifact checks passed', async () => {
    const root = await fixture();
    await writeJson(root, '.musubix/config.json', defaultConfig);
    const report = await runGate(root);
    expect(report.status).toBe('fail');
    expect(report.checks.filter((c) => c.status === 'skipped').map((c) => c.name)).toEqual(expect.arrayContaining(['commands', 'requirements', 'design', 'trace', 'graph', 'constitution']));
  });

  it('fails real nonzero exits and timeouts', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.commands[0]!.args = ['-e', 'process.exit(7)'];
    await writeJson(root, '.musubix/config.json', config);
    const failed = await runGate(root);
    expect(failed.status).toBe('fail');
    expect(failed.checks.find((c) => c.name === 'command:test')?.exitCode).toBe(7);
    const timedOut = await runGate(root, { runner: async () => processResult({ status: 'timeout', exitCode: null }) });
    expect(timedOut.status).toBe('fail');
    expect(timedOut.checks.find((c) => c.name === 'command:test')?.status).toBe('fail');
  });

  it('uses coverage thresholds without disguising missing coverage', async () => {
    const root = await project();
    await writeText(root, 'src/service.test.ts', 'export {};');
    const config = await loadConfig(root);
    config.thresholds.tests = 0;
    await writeJson(root, '.musubix/config.json', config);
    const baseline = JSON.parse(await readText(root, '.musubix/policy-baseline.json'));
    baseline.thresholds.tests = 0;
    await writeJson(root, '.musubix/policy-baseline.json', baseline);
    const report = await runGate(root);
    expect(report.status).toBe('pass');
    expect(report.metrics['coverage.tests']).toBe(0);
    expect(report.checks.find((c) => c.name === 'trace')?.diagnostics?.some((d) => d.code === 'TRACE_UNCOVERED')).toBe(true);
  });

  it('rejects quality policy weakening against the trusted baseline', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.requiredChecks = config.requiredChecks.filter((name) => name !== 'graph');
    config.thresholds.tests = 0;
    await writeJson(root, '.musubix/config.json', config);
    const report = await runGate(root);
    expect(report.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'policy')?.diagnostics?.map((diagnostic) => diagnostic.code))
      .toEqual(expect.arrayContaining(['POLICY_REQUIRED_CHECK', 'POLICY_THRESHOLD']));
  });

  it('requires independent approval when the policy baseline changes', async () => {
    const root = await project();
    const runner = vi.fn<Runner>(async (command, args) =>
      command === 'git' && args[0] === 'status'
        ? processResult({ stdout: ' M .musubix/policy-baseline.json\0' })
        : processResult());
    const report = await runGate(root, { changed: true, runner });
    expect(report.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'policy')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'POLICY_APPROVAL_REQUIRED' }));
  });

  it('does not convert unavailable metrics to successful policy checks', async () => {
    const root = await fixture();
    await writeJson(root, '.musubix/config.json', defaultConfig);
    await writeText(root, '.musubix/constitution.md', '---\nversion: 1.0.0\n---\n## PRINC-001: Evidence\n### RULE-001: No missing trace\nMetric: trace.errors\nLimit: 100');
    const report = await runGate(root);
    expect(report.checks.find((c) => c.name === 'constitution:RULE-001')?.status).toBe('skipped');
    expect(report.status).toBe('fail');
  });

  it('fails if verification mutates its own input snapshot', async () => {
    const root = await project();
    const runner: Runner = async () => {
      await writeText(root, 'generated.md', 'new input');
      return processResult();
    };
    const report = await runGate(root, { runner });
    expect(report.checks.find((c) => c.name === 'input-stability')).toMatchObject({
      status: 'fail',
      diagnostics: [
        expect.objectContaining({
          code: 'INPUT_ADDED',
          path: 'generated.md',
          message: expect.stringContaining('after='),
        }),
      ],
    });
  });

  it('ignores standard Cargo and Maven target output without weakening source stability', async () => {
    const root = await project();
    await writeText(root, 'Cargo.toml', '[package]\nname = "fixture"\nversion = "0.1.0"\n');
    const runner: Runner = async () => {
      await writeText(root, 'target/generated/report.txt', 'build output');
      return processResult();
    };
    const report = await runGate(root, { runner });
    expect(report.checks.find((c) => c.name === 'input-stability')).toBeUndefined();
    expect(report.status).toBe('pass');
  });

  it('keeps source directories named target inside the stability snapshot', async () => {
    const root = await project();
    await writeText(root, 'src/target/tracked.ts', 'export const value = 1;');
    const runner: Runner = async () => {
      await writeText(root, 'src/target/tracked.ts', 'export const value = 2;');
      return processResult();
    };
    const report = await runGate(root, { runner });
    expect(report.checks.find((c) => c.name === 'input-stability')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'INPUT_MODIFIED', path: 'src/target/tracked.ts' }));
  });

  it('ignores manifest-scoped .NET bin and obj output without hiding source directories', async () => {
    const root = await project();
    await writeText(root, 'src/service/Service.csproj', '<Project Sdk="Microsoft.NET.Sdk" />\n');
    await writeText(root, 'src/service/obj/generated.cs', 'internal class Generated {}\n');
    await writeText(root, 'src/obj/tracked.cs', 'internal class Tracked {}\n');
    const runner: Runner = async () => {
      await writeText(root, 'src/service/bin/Debug/net8.0/service.dll', 'binary');
      await writeText(root, 'src/service/obj/generated.cs', 'internal class Changed {}\n');
      await writeText(root, 'src/obj/tracked.cs', 'internal class Changed {}\n');
      return processResult();
    };
    expect((await runGate(root, { runner })).checks.find((c) => c.name === 'input-stability')?.diagnostics)
      .toEqual([expect.objectContaining({ code: 'INPUT_MODIFIED', path: 'src/obj/tracked.cs' })]);
  });

  it('ignores manifest-scoped ecosystem caches without hiding same-named source directories', async () => {
    const root = await project();
    const generated = [
      ['gradle/build.gradle', 'gradle/.gradle/generated.ts'],
      ['dart/pubspec.yaml', 'dart/.dart_tool/generated.dart'],
      ['swift/Package.swift', 'swift/.build/generated.swift'],
      ['zig/build.zig', 'zig/.zig-cache/generated.zig'],
      ['zig/build.zig', 'zig/zig-out/generated.zig'],
      ['Root.sln', '.dotnet/generated.cs'],
    ] as const;
    const tracked = [
      'src/cache-names/.gradle/tracked.ts',
      'src/cache-names/.dart_tool/tracked.dart',
      'src/cache-names/.build/tracked.swift',
      'src/cache-names/.zig-cache/tracked.zig',
      'src/cache-names/zig-out/tracked.zig',
      'src/cache-names/.dotnet/tracked.cs',
    ];
    for (const [manifest, path] of generated) {
      await writeText(root, manifest, manifest.endsWith('pubspec.yaml') ? 'name: example\n' : 'manifest\n');
      await writeText(root, path, 'before\n');
    }
    for (const path of tracked) await writeText(root, path, 'before\n');
    const runner: Runner = async () => {
      for (const [, path] of generated) await writeText(root, path, 'after\n');
      for (const path of tracked) await writeText(root, path, 'after\n');
      return processResult();
    };
    const diagnostics = (await runGate(root, { runner })).checks
      .find((check) => check.name === 'input-stability')?.diagnostics;
    expect(diagnostics?.map((diagnostic) => diagnostic.path).sort()).toEqual(tracked.sort());
  });

  it('ignores the conventional project-local NuGet package cache', async () => {
    const root = await project();
    await writeText(root, '.nuget/packages/example/1.0.0/library.dll', 'before');
    await writeText(root, '.nuget/NuGet.Config', 'before');
    const runner: Runner = async () => {
      await writeText(root, '.nuget/packages/example/1.0.0/library.dll', 'after');
      await writeText(root, '.nuget/NuGet.Config', 'after');
      return processResult();
    };
    expect((await runGate(root, { runner })).checks.find((c) => c.name === 'input-stability')?.diagnostics)
      .toEqual([expect.objectContaining({ code: 'INPUT_MODIFIED', path: '.nuget/NuGet.Config' })]);
  });

  it('ignores Python virtual environments identified by pyvenv.cfg without hiding similarly named source', async () => {
    const root = await project();
    await writeText(root, '.venv/pyvenv.cfg', 'home = /usr/bin\n');
    await writeText(root, '.venv/lib/python3.12/site-packages/dependency.py', 'VALUE = 1\n');
    await writeText(root, 'src/venv/service.py', 'VALUE = 1\n');
    const runner: Runner = async () => {
      await writeText(root, '.venv/lib/python3.12/site-packages/dependency.py', 'VALUE = 2\n');
      await writeText(root, 'src/venv/service.py', 'VALUE = 2\n');
      return processResult();
    };
    const report = await runGate(root, { runner });
    expect(report.checks.find((c) => c.name === 'input-stability')?.diagnostics)
      .toEqual([expect.objectContaining({ code: 'INPUT_MODIFIED', path: 'src/venv/service.py' })]);
  });

  it('does not exclude a source tree when pyvenv.cfg is not a regular file', async () => {
    const root = await project();
    await mkdir(resolve(root, 'src/application/pyvenv.cfg'), { recursive: true });
    await writeText(root, 'src/application/service.py', 'VALUE = 1\n');
    const runner: Runner = async () => {
      await writeText(root, 'src/application/service.py', 'VALUE = 2\n');
      return processResult();
    };
    expect((await runGate(root, { runner })).checks.find((c) => c.name === 'input-stability')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'INPUT_MODIFIED', path: 'src/application/service.py' }));
  });

  it('does not exclude an arbitrary source tree with a regular pyvenv.cfg marker', async () => {
    const root = await project();
    await writeText(root, 'src/application/pyvenv.cfg', 'home = /usr/bin\n');
    await writeText(root, 'src/application/service.py', 'VALUE = 1\n');
    const runner: Runner = async () => {
      await writeText(root, 'src/application/service.py', 'VALUE = 2\n');
      return processResult();
    };
    expect((await runGate(root, { runner })).checks.find((c) => c.name === 'input-stability')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'INPUT_MODIFIED', path: 'src/application/service.py' }));
  });

  it('changed mode captures changes and still runs actual commands', async () => {
    const root = await project();
    const runner = vi.fn<Runner>(async (command, args) => command === 'git' && args[0] === 'status' ? processResult({ stdout: ' M src/service.ts\0' }) : processResult());
    const report = await runGate(root, { changed: true, runner });
    expect(report.changed).toEqual(['src/service.ts']);
    expect(report.impacted).toEqual(['src/service.test.ts', 'src/service.ts']);
    expect(report.mode).toBe('changed');
    expect(report.lastChangeAnalysis).toMatchObject({ baseline: 'HEAD', changed: ['src/service.ts'] });
    expect(runner.mock.calls.some((call) => call[0] === process.execPath)).toBe(true);
    expect(report.status).toBe('pass');
  });

  it('preserves the latest changed-run evidence across a later full gate', async () => {
    const root = await project();
    const runner = vi.fn<Runner>(async (command, args) => {
      if (command === 'git' && args[0] === 'status') return processResult({ stdout: ' M src/service.ts\0' });
      if (command === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return processResult({ stdout: 'abc123\n' });
      return processResult();
    });
    await runGate(root, { changed: true, runner });
    const full = await runGate(root);
    expect(full.mode).toBe('full');
    expect(full.changed).toEqual(['src/service.ts']);
    expect(full.lastChangeAnalysis).toMatchObject({ baseline: 'HEAD', head: 'abc123', changed: ['src/service.ts'] });
  });

  it('handles Git renames and NUL-delimited spaced paths', async () => {
    const runner: Runner = async (_command, args) => processResult({ stdout: args[0] === 'status' ? 'R  new name.ts\0old name.ts\0?? new-file.ts\0 D deleted.ts\0' : '' });
    expect(await changedFiles(await fixture(), runner)).toEqual(['deleted.ts', 'new name.ts', 'new-file.ts', 'old name.ts'].sort());
    await expect(changedFiles(await fixture(), missingRunner)).rejects.toThrow('Cannot determine');
  });

  it('scopes real Git changes to a project nested inside a repository', async () => {
    const root = await fixture({ 'outside.md': 'outside', 'nested/source.ts': 'export {};' });
    const initialized = await runProcess('git', ['init', '-q'], { cwd: root, timeoutMs: 10_000 });
    expect(initialized.exitCode).toBe(0);
    expect(await changedFiles(resolve(root, 'nested'))).toEqual(['source.ts']);
  });
});

describe('strict config and real process runner', () => {
  it.each([
    { ...defaultConfig, schemaVersion: 2 },
    { ...defaultConfig, typo: true },
    { ...defaultConfig, thresholds: { tests: 2 } },
    { ...defaultConfig, thresholds: { typo: 1 } },
    { ...defaultConfig, commands: [{ name: 'bad', command: 'node', args: 'wrong' }] },
    { ...defaultConfig, commands: [{ name: 'bad', command: 'node', args: [], testReport: { format: 'junit', path: 'results.json' } }] },
    { ...defaultConfig, commands: [{ name: 'bad', command: 'node', args: [], testReport: { format: 'musubix-json', path: '/results.json' } }] },
    { ...defaultConfig, commands: [{ name: 'bad', command: 'node', args: [], testReport: { format: 'musubix-json', path: 'results/{testId}.json' } }] },
    { ...defaultConfig, requiredChecks: ['unknown'] },
    { ...defaultConfig, formal: { solver: 'invalid' } },
    { ...defaultConfig, formal: { minModeledFraction: 2 } },
    { ...defaultConfig, formal: { timeoutMs: 1 } },
    { ...defaultConfig, codeGraph: { mode: 'invalid' } },
    { ...defaultConfig, architecture: { forbidCycles: 'yes' } },
    { ...defaultConfig, commands: null },
    { ...defaultConfig, requiredChecks: null },
    { ...defaultConfig, architecture: { rules: null } },
    { ...defaultConfig, thresholds: { tests: null } },
  ])('rejects malformed configuration', (value) => {
    expect(() => parseConfig(value)).toThrow();
  });

  it('reports process missing, exit code, input, timeout and bounded output', async () => {
    const root = await fixture();
    const missing = await runProcess('musubix3-nonexistent-executable-1234', [], { cwd: root, timeoutMs: 1000 });
    expect(missing.status).toBe('missing');
    const completed = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout);'], { cwd: root, timeoutMs: 1000, input: 'hello' });
    expect(completed).toMatchObject({ status: 'completed', stdout: 'hello', exitCode: 0 });
    const timeout = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: root, timeoutMs: 100 });
    expect(timeout.status).toBe('timeout');
  });
});
