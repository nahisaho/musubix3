import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  loadTddEvidence, readText, runProcess, writeJson, writeText, runTddPhase,
} from '../packages/analysis/src/index.js';
import { project, req, tddResultRunner } from './helpers.js';

const otherReqTestCode = `/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-002
 */
export function testOther() { return true; }
`;

/** @id TEST-TDD-ADOPTION-WARNING-001
 * @verifies REQ-TDD-ADOPTION-WARNING-001
 */
it('TEST-TDD-ADOPTION-WARNING-001 warns exactly once, listing other uncovered mandatory requirements, on the project-first Red', async () => {
  const root = await project();
  await writeText(root, '.musubix/features/example/requirements.md',
    `${req('The system shall report readiness.', 'REQ-EXAMPLE-001')}Acceptance: TEST-EXAMPLE-001 passes.\n`
    + `${req('The system shall report other status.', 'REQ-EXAMPLE-002')}Acceptance: TEST-EXAMPLE-002 passes.\n`);
  await writeText(root, 'src/other.test.ts', otherReqTestCode);

  const first = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));

  // Additive, never changing the phase's own valid outcome.
  expect(first.valid).toBe(true);
  expect(first.diagnostics).toHaveLength(0);
  expect(first.warnings).toHaveLength(1);
  const [warning] = first.warnings ?? [];
  if (!warning) throw new Error('expected exactly one warning entry');
  expect(warning.code).toBe('TDD_ADOPTION_PROJECT_WIDE');
  expect(warning.severity).toBe('warning');
  // Names the other uncovered mandatory requirement explicitly, not merely a count.
  expect(warning.message).toContain('REQ-EXAMPLE-002');
  // States that the just-recorded requirement itself remains uncovered until Green.
  expect(warning.message).toContain('REQ-EXAMPLE-001');
  // No `.musubix/config.json` requiredChecks/change documents here, so this call is
  // what makes the check required (not merely "already required").
  expect(warning.message).toMatch(/this call is what makes/);

  // A second Red call (project already has a cycle) never repeats the warning.
  await writeText(root, 'src/service2.ts', '// nothing, second cycle test does not need a source pair\n');
  const second = await runTddPhase(root, 'red', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  expect(second.warnings).toBeUndefined();
});

// Supporting regression check (not independently trace-tracked, matching the
// convention in tdd-green-requirement-scoping.test.ts): proves the N = 0 branch of
// REQ-TDD-ADOPTION-WARNING-001's acceptance still produces the warning entry.
it('still produces the warning, explicitly stating zero other uncovered requirements, when there are none', async () => {
  const root = await project();
  const first = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  expect(first.warnings).toHaveLength(1);
  const [warning] = first.warnings ?? [];
  if (!warning) throw new Error('expected exactly one warning entry');
  expect(warning.message).toMatch(/zero other uncovered/);
});

// Supporting regression check: an invalid first Red (wrong reported status)
// still persists the project's first cycle, so the warning must still fire,
// additive to (and independent of) the phase's own invalid outcome.
it('still warns when the first persisted Red is itself invalid', async () => {
  const root = await project();
  const first = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  expect(first.valid).toBe(false);
  expect(first.warnings).toHaveLength(1);
});

// Supporting regression check: when `tdd` is already required via
// `config.requiredChecks`, the wording states the check was already
// required, never that this call is what made it required.
it('states "already required" wording when tdd is already required via config', async () => {
  const root = await project();
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.requiredChecks = [...config.requiredChecks, 'tdd'];
  await writeJson(root, '.musubix/config.json', config);
  const first = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  const [warning] = first.warnings ?? [];
  if (!warning) throw new Error('expected exactly one warning entry');
  expect(warning.message).toMatch(/already required/);
});

// Supporting regression check: a `tdd red` call that throws before
// persisting any cycle (here, an unknown test ID) leaves the project's
// adoption state unchanged, so no warning can have been produced.
it('produces no warning and persists no cycle when the call throws before persistence', async () => {
  const root = await project();
  await expect(runTddPhase(root, 'red', 'TEST-DOES-NOT-EXIST', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }))).rejects.toThrow();
  const evidence = await loadTddEvidence(root);
  expect(evidence?.cycles.length ?? 0).toBe(0);
});

// Supporting regression check: the default (non-`--json`) CLI invocation
// prints the warning message in addition to the existing RED: PASS/FAIL
// summary line, without changing exitCode for an otherwise-valid Red.
it('prints the warning message via the default (non-JSON) CLI output without changing exit code', async () => {
  const root = await project();
  const cli = resolve('dist/packages/cli/src/main.js');
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.commands[0].args = [
    '-e',
    "const fs=require('fs'); const id=process.argv[1], report=process.argv[2]; const pass=fs.existsSync('implemented.flag'); fs.mkdirSync(require('path').dirname(report),{recursive:true}); fs.writeFileSync(report,JSON.stringify({schemaVersion:1,tests:[{id,status:pass?'passed':'failed'}]})); process.exit(pass ? 0 : 1)",
  ];
  await writeJson(root, '.musubix/config.json', config);
  const result = await runProcess(process.execPath, [
    cli, 'tdd', 'red', 'TEST-EXAMPLE-001', '--requirement', 'REQ-EXAMPLE-001', '--command', 'test',
  ], { cwd: root, timeoutMs: 20_000 });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('RED: PASS (TEST-EXAMPLE-001)');
  expect(result.stdout).toMatch(/this call is what makes/);
});

/** @id TEST-TDD-ADOPTION-WARNING-002
 * @verifies REQ-TDD-ADOPTION-WARNING-002
 */
it('TEST-TDD-ADOPTION-WARNING-002 documents the project-wide adoption semantics in --help and README', async () => {
  const root = await project();
  const cli = resolve('dist/packages/cli/src/main.js');
  const help = await runProcess(process.execPath, [cli, 'tdd', 'red', '--help'], {
    cwd: root,
    timeoutMs: 20_000,
  });
  expect(help.stdout).toMatch(/project-wide/i);
  expect(help.stdout).toContain('TDD_REQUIREMENT_UNCOVERED');
  expect(help.stdout).toContain('approval record release');
  expect(help.stdout).toContain('tdd migrate');

  const readme = await readFile(resolve('README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('`tdd red\\|green\\|refactor'));
  expect(section).toContain('project-wide');
  expect(section).toContain('TDD_REQUIREMENT_UNCOVERED');
  expect(section).toContain('approval record release');
  expect(section).toMatch(/tdd migrate.*only re-fingerprints a requirement that\s+already has a valid Green cycle/is);
});
