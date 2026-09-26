import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { exists, readText, runProcess, writeJson, writeText } from '../packages/analysis/src/index.js';
import { caseSafeEnvironment, fixture, project } from './helpers.js';

// CHANGE-0050 strengthens the phase prerequisites and policy-failure controls.
const cli = resolve('dist/packages/cli/src/main.js');
const timeoutMarginChecker = resolve('scripts/check-gate-command-timeout-margin.mjs');
const repeatedMessage = /--requirement.*exactly one requirement.*separate Red\/Green cycle/is;

async function invoke(root: string, phase: 'red' | 'green' | 'refactor', args: string[] = []) {
  return runProcess(process.execPath, [
    cli, 'tdd', phase, 'TEST-EXAMPLE-001',
    '--requirement', 'REQ-EXAMPLE-002',
    '--requirement', 'REQ-EXAMPLE-001',
    '--command', 'test',
    ...args,
  ], { cwd: root, timeoutMs: 20_000 });
}

async function optionalText(root: string, path: string): Promise<string | null> {
  return await exists(resolve(root, path)) ? readText(root, path) : null;
}

async function configurePhaseCommand(root: string): Promise<void> {
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  const command = config.commands.find((entry: { name?: string }) => entry.name === 'test');
  if (!command) throw new Error('Expected the project fixture to configure the test command.');
  command.args = [
    '-e',
    "const fs=require('fs'),path=require('path'),id=process.argv[1],report=process.argv[2];"
    + "fs.writeFileSync('configured-command-ran.flag','ran');"
    + "const status=fs.existsSync('implemented.flag')?'passed':'failed';"
    + "fs.mkdirSync(path.dirname(report),{recursive:true});"
    + "fs.writeFileSync(report,JSON.stringify({schemaVersion:1,tests:[{id,status}]}));"
    + "process.exit(status==='passed'?0:1)",
  ];
  await writeJson(root, '.musubix/config.json', config);
}

async function preparePhaseProject(phase: 'red' | 'green' | 'refactor'): Promise<{
  root: string;
  tddBefore: string | null;
  orderBefore: string | null;
}> {
  const root = await project();
  await configurePhaseCommand(root);

  if (phase !== 'red') {
    const red = await runProcess(process.execPath, [
      cli, 'tdd', 'red', 'TEST-EXAMPLE-001',
      '--requirement', 'REQ-EXAMPLE-001',
      '--command', 'test',
      '--json',
    ], { cwd: root, timeoutMs: 20_000 });
    expect(red.exitCode, red.stdout).toBe(0);
    await writeText(root, 'implemented.flag', 'green\n');
    if (phase === 'refactor') {
      const green = await runProcess(process.execPath, [
        cli, 'tdd', 'green', 'TEST-EXAMPLE-001',
        '--requirement', 'REQ-EXAMPLE-001',
        '--command', 'test',
        '--json',
      ], { cwd: root, timeoutMs: 20_000 });
      expect(green.exitCode, green.stdout).toBe(0);
    }
    expect(await exists(resolve(root, 'configured-command-ran.flag'))).toBe(true);
  }

  await rm(resolve(root, 'configured-command-ran.flag'), { force: true });
  const tddBefore = await optionalText(root, '.musubix/evidence/tdd.json');
  const orderBefore = await optionalText(root, '.musubix/evidence/order.json');
  return { root, tddBefore, orderBefore };
}

/** @id TEST-TDD-REPEATED-REQUIREMENT-OPTION-001
 * @verifies REQ-TDD-REPEATED-REQUIREMENT-OPTION-001
 */
it('TEST-TDD-REPEATED-REQUIREMENT-OPTION-001 rejects repeated requirements before any TDD phase side effect', async () => {
  const positiveRed = await project();
  await configurePhaseCommand(positiveRed);
  const positiveRedResult = await runProcess(process.execPath, [
    cli, 'tdd', 'red', 'TEST-EXAMPLE-001',
    '--requirement', 'REQ-EXAMPLE-001',
    '--command', 'test',
    '--json',
  ], { cwd: positiveRed, timeoutMs: 20_000 });
  expect(positiveRedResult.exitCode, positiveRedResult.stdout).toBe(0);
  expect(await exists(resolve(positiveRed, 'configured-command-ran.flag'))).toBe(true);

  const positiveGreen = await preparePhaseProject('green');
  const positiveGreenResult = await runProcess(process.execPath, [
    cli, 'tdd', 'green', 'TEST-EXAMPLE-001',
    '--requirement', 'REQ-EXAMPLE-001',
    '--command', 'test',
    '--json',
  ], { cwd: positiveGreen.root, timeoutMs: 20_000 });
  expect(positiveGreenResult.exitCode, positiveGreenResult.stdout).toBe(0);
  expect(await exists(resolve(positiveGreen.root, 'configured-command-ran.flag'))).toBe(true);

  const positiveRefactor = await preparePhaseProject('refactor');
  const positiveRefactorResult = await runProcess(process.execPath, [
    cli, 'tdd', 'refactor', 'TEST-EXAMPLE-001',
    '--requirement', 'REQ-EXAMPLE-001',
    '--command', 'test',
    '--json',
  ], { cwd: positiveRefactor.root, timeoutMs: 20_000 });
  expect(positiveRefactorResult.exitCode, positiveRefactorResult.stdout).toBe(0);
  expect(await exists(resolve(positiveRefactor.root, 'configured-command-ran.flag'))).toBe(true);

  for (const phase of ['red', 'green', 'refactor'] as const) {
    const { root, tddBefore, orderBefore } = await preparePhaseProject(phase);
    const result = await invoke(root, phase, ['--json']);
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      error: { code: 'CLI_ERROR', message: expect.stringMatching(repeatedMessage) },
    });
    expect(await exists(resolve(root, 'configured-command-ran.flag'))).toBe(false);
    expect(await optionalText(root, '.musubix/evidence/tdd.json')).toBe(tddBefore);
    expect(await optionalText(root, '.musubix/evidence/order.json')).toBe(orderBefore);
  }

  const emptyFirst = await project();
  const emptyResult = await runProcess(process.execPath, [
    cli, 'tdd', 'red', 'TEST-EXAMPLE-001',
    '--requirement', '',
    '--requirement', 'REQ-EXAMPLE-001',
    '--command', 'test',
    '--json',
  ], { cwd: emptyFirst, timeoutMs: 20_000 });
  expect(emptyResult.exitCode).toBe(2);
  expect(JSON.parse(emptyResult.stdout).error.message).toMatch(repeatedMessage);

  const human = await preparePhaseProject('red');
  const humanResult = await invoke(human.root, 'red');
  expect(humanResult.exitCode).toBe(2);
  expect(humanResult.stderr).toMatch(repeatedMessage);

  const single = await project();
  const singleResult = await runProcess(process.execPath, [
    cli, 'tdd', 'red', 'TEST-EXAMPLE-001',
    '--requirement', 'REQ-EXAMPLE-001',
    '--command', 'missing-command',
    '--json',
  ], { cwd: single, timeoutMs: 20_000 });
  expect(singleResult.exitCode).toBe(2);
  expect(JSON.parse(singleResult.stdout).error.message).not.toMatch(repeatedMessage);
}, 30_000);

/** @id TEST-TDD-REPEATED-REQUIREMENT-OPTION-002
 * @verifies REQ-TDD-REPEATED-REQUIREMENT-OPTION-002
 */
it('TEST-TDD-REPEATED-REQUIREMENT-OPTION-002 documents one requirement per TDD invocation', async () => {
  const root = await project();
  for (const phase of ['red', 'green', 'refactor']) {
    const help = await runProcess(process.execPath, [cli, 'tdd', phase, '--help'], {
      cwd: root,
      timeoutMs: 20_000,
    });
    expect(help.stdout).toMatch(/--requirement[\s\S]*exactly\s+one\s+requirement[\s\S]*separate\s+Red\/Green\s+cycle/i);
  }

  const files = await Promise.all([
    'README.md',
    'README-ja.md',
    '.github/skills/sdd-change/SKILL.md',
    '.github/skills/sdd-implementation/SKILL.md',
  ].map((path) => readFile(resolve(path), 'utf8')));
  for (const text of files) {
    expect(text).toMatch(/exactly one requirement|1つのrequirement|1 requirement/i);
    expect(text).toMatch(/separate Red\/Green cycle|個別のRed\/Green cycle/i);
    expect(text).toMatch(/change-record[\s\S]*--requirement <(?:ids|REQ-ID)\.\.\.>/i);
  }
});

/** @id TEST-TDD-REPEATED-REQUIREMENT-OPTION-003
 * @verifies REQ-TDD-REPEATED-REQUIREMENT-OPTION-002
 */
it('TEST-TDD-REPEATED-REQUIREMENT-OPTION-003 keeps the dedicated documentation contract test required by policy', async () => {
  const config = JSON.parse(await readFile(resolve('.musubix/config.json'), 'utf8'));
  expect(config.commands).toContainEqual(expect.objectContaining({
    name: 'tdd-repeated-requirement-option-tests',
    required: true,
  }));
  const current = await runProcess(process.execPath, [timeoutMarginChecker], {
    cwd: resolve('.'),
    timeoutMs: 20_000,
    env: caseSafeEnvironment({ GATE_COMMAND_TIMEOUT_MARGIN_ROOT: resolve('.') }),
  });
  expect(current.exitCode, current.stdout).toBe(0);

  const withoutCommand = {
    ...config,
    commands: config.commands.filter(
      (command: { name?: string }) => command.name !== 'tdd-repeated-requirement-option-tests',
    ),
  };
  const root = await fixture({
    '.musubix/config.json': `${JSON.stringify(withoutCommand, null, 2)}\n`,
    '.musubix/constitution.md': await readFile(resolve('.musubix/constitution.md'), 'utf8'),
    'vitest.config.ts': await readFile(resolve('vitest.config.ts'), 'utf8'),
  });
  const missing = await runProcess(process.execPath, [timeoutMarginChecker], {
    cwd: root,
    timeoutMs: 20_000,
    env: caseSafeEnvironment({ GATE_COMMAND_TIMEOUT_MARGIN_ROOT: root }),
  });
  expect(missing.exitCode).toBe(1);
  expect(JSON.parse(missing.stdout).diagnostics).toContainEqual(expect.objectContaining({
    code: 'GATE_COMMAND_TIMEOUT_MARGIN',
    message: 'The required command-name set changed.',
  }));

  const retargetedRoot = await fixture({
    '.musubix/config.json': `${JSON.stringify({
      ...config,
      commands: config.commands.map((command: { name?: string; args?: string[] }) =>
        command.name === 'tdd-repeated-requirement-option-tests'
          ? { ...command, args: ['vitest', 'run', 'tests/domain.test.ts'] }
          : command),
    }, null, 2)}\n`,
    '.musubix/constitution.md': await readFile(resolve('.musubix/constitution.md'), 'utf8'),
    'vitest.config.ts': await readFile(resolve('vitest.config.ts'), 'utf8'),
  });
  const retargeted = await runProcess(process.execPath, [timeoutMarginChecker], {
    cwd: retargetedRoot,
    timeoutMs: 20_000,
    env: caseSafeEnvironment({ GATE_COMMAND_TIMEOUT_MARGIN_ROOT: retargetedRoot }),
  });
  expect(retargeted.exitCode).toBe(1);
  const retargetedDiagnostics = JSON.parse(retargeted.stdout).diagnostics;
  expect(retargetedDiagnostics).toHaveLength(1);
  expect(retargetedDiagnostics).toContainEqual(expect.objectContaining({
    code: 'GATE_COMMAND_TIMEOUT_MARGIN',
    message: expect.stringContaining('tdd-repeated-requirement-option-tests command must remain required'),
  }));
});
