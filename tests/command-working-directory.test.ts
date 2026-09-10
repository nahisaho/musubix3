import { expect, it } from 'vitest';
import { configLint, readText, runGate, writeJson, writeText } from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

/** @id TEST-COMMAND-WORKING-DIRECTORY-001
 * @verifies REQ-COMMAND-WORKING-DIRECTORY-001
 */
it('TEST-COMMAND-WORKING-DIRECTORY-001 runs a configured command with its own working directory', async () => {
  const root = await project();
  await writeText(root, 'services/route/.keep', '');
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.requiredChecks.push('commands');
  config.commands.push({
    name: 'route-cwd-check',
    command: process.execPath,
    args: ['-e', "process.exit(process.cwd().endsWith(require('path').join('services','route')) ? 0 : 1)"],
    cwd: 'services/route',
    required: true,
    timeoutMs: 10_000,
  });
  config.commands.push({
    name: 'root-cwd-check',
    command: process.execPath,
    args: ['-e', 'process.exit(require("fs").existsSync(".musubix") ? 0 : 1)'],
    required: true,
    timeoutMs: 10_000,
  });
  await writeJson(root, '.musubix/config.json', config);

  const report = await runGate(root);
  const commands = report.checks.find((c) => c.name === 'commands');
  expect(commands?.status).toBe('pass');
});

/** @id TEST-COMMAND-WORKING-DIRECTORY-002
 * @verifies REQ-COMMAND-WORKING-DIRECTORY-002
 */
it('TEST-COMMAND-WORKING-DIRECTORY-002 reports CONFIG_CWD_INVALID for an escaping or missing cwd', async () => {
  const root = await project();
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.commands.push({
    name: 'escaping-cwd',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    cwd: '../outside',
    required: false,
    timeoutMs: 10_000,
  });
  config.commands.push({
    name: 'missing-cwd',
    command: process.execPath,
    args: ['-e', 'process.exit(0)'],
    cwd: 'services/does-not-exist',
    required: false,
    timeoutMs: 10_000,
  });
  await writeJson(root, '.musubix/config.json', config);

  const report = await configLint(root);
  expect(report.diagnostics.some((d) => d.code === 'CONFIG_CWD_INVALID' && d.message.includes('escaping-cwd') && d.message.includes('../outside'))).toBe(true);
  expect(report.diagnostics.some((d) => d.code === 'CONFIG_CWD_INVALID' && d.message.includes('missing-cwd') && d.message.includes('services/does-not-exist'))).toBe(true);
});

/** @id TEST-COMMAND-WORKING-DIRECTORY-003
 * @verifies REQ-COMMAND-WORKING-DIRECTORY-003
 */
it('TEST-COMMAND-WORKING-DIRECTORY-003 checks path arguments relative to the command\'s own working directory', async () => {
  const root = await project();
  await writeText(root, 'services/route/data/local-only.txt', 'present\n');
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.commands.push({
    name: 'route-path-check',
    command: process.execPath,
    args: ['-e', 'process.exit(0)', 'data/local-only.txt', 'data/still-missing.txt'],
    cwd: 'services/route',
    required: false,
    timeoutMs: 10_000,
  });
  await writeJson(root, '.musubix/config.json', config);

  const report = await configLint(root);
  expect(report.diagnostics.some((d) => d.code === 'CONFIG_ORPHANED_PATH' && d.message.includes('data/local-only.txt'))).toBe(false);
  expect(report.diagnostics.some((d) => d.code === 'CONFIG_ORPHANED_PATH' && d.message.includes('data/still-missing.txt'))).toBe(true);
});
