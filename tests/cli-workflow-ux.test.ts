import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { configLint, files, indexGraph, requireApproval, runProcess, scaffoldCommands, writeText } from '../packages/analysis/src/index.js';
import { fixture, project } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');
async function invoke(root: string, args: string[]): Promise<Awaited<ReturnType<typeof runProcess>>> {
  return runProcess(process.execPath, [cli, ...args], { cwd: root, timeoutMs: 20_000 });
}

describe('cli workflow ux improvements (v0.1.9)', () => {
  /** @id TEST-CLI-WORKFLOW-UX-001
   * @verifies REQ-CLI-WORKFLOW-UX-001
   */
  it('TEST-CLI-WORKFLOW-UX-001 excludes nested MUSUBIX3 workspaces from ancestor scans', async () => {
    const root = await project();
    await writeText(root, 'nested-example/.musubix/marker.txt', 'nested workspace root');
    await writeText(root, 'nested-example/src/nested.ts', '/** @id CODE-NESTED-001\n * @implements REQ-NESTED-001\n */\nexport {};');
    const rootFiles = await files(root);
    expect(rootFiles.some((p) => p.startsWith('nested-example/'))).toBe(false);
    const graph = await indexGraph(root);
    expect(graph.files.some((f) => f.startsWith('nested-example/'))).toBe(false);

    const nestedFiles = await files(`${root}/nested-example`);
    expect(nestedFiles.some((p) => p === 'src/nested.ts')).toBe(true);
  });

  /** @id TEST-CLI-WORKFLOW-UX-002
   * @verifies REQ-CLI-WORKFLOW-UX-002
   */
  it('TEST-CLI-WORKFLOW-UX-002 states bidirectional candidate semantics for trace impact text output', async () => {
    const root = await project();
    await invoke(root, ['trace', 'build']);
    const text = await invoke(root, ['trace', 'impact', 'REQ-EXAMPLE-001']);
    expect(text.exitCode).toBe(0);
    expect(text.stdout).toContain('bidirectional');
    expect(text.stdout).toContain('candidate');
    const json = await invoke(root, ['trace', 'impact', 'REQ-EXAMPLE-001', '--json']);
    expect(JSON.parse(json.stdout)).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'CODE-EXAMPLE-001' })]));
  });

  /** @id TEST-CLI-WORKFLOW-UX-003
   * @verifies REQ-CLI-WORKFLOW-UX-003
   */
  it('TEST-CLI-WORKFLOW-UX-003 points a stale/missing approval error at approval validate', async () => {
    const root = await project();
    await expect(requireApproval(root, 'requirements', { mode: 'required' })).rejects.toThrow('approval validate');
  });

  /** @id TEST-CLI-WORKFLOW-UX-004
   * @verifies REQ-CLI-WORKFLOW-UX-004
   */
  it('TEST-CLI-WORKFLOW-UX-004 reports commands whose args reference nonexistent repository paths', async () => {
    const root = await project();
    const clean = await configLint(root);
    expect(clean.valid).toBe(true);
    expect(clean.diagnostics).toHaveLength(0);

    const { readText, writeJson } = await import('../packages/analysis/src/index.js');
    const config = JSON.parse(await readText(root, '.musubix/config.json'));
    config.commands.push({
      name: 'orphaned-tests',
      command: process.execPath,
      args: ['vitest', 'run', 'tests/does-not-exist.test.ts'],
      required: false,
      timeoutMs: 10_000,
    });
    await writeJson(root, '.musubix/config.json', config);

    const dirty = await configLint(root);
    expect(dirty.valid).toBe(false);
    expect(dirty.diagnostics.some((d) => d.message.includes('orphaned-tests') && d.message.includes('tests/does-not-exist.test.ts'))).toBe(true);
  });

  /** @id TEST-CLI-WORKFLOW-UX-005
   * @verifies REQ-CLI-WORKFLOW-UX-005
   */
  it('TEST-CLI-WORKFLOW-UX-005 scopes gate status to one feature, isolating unrelated failures', async () => {
    const root = await project();
    const { runGate, writeText: write } = await import('../packages/analysis/src/index.js');
    const full = await runGate(root);
    expect(full.status).toBe('pass');
    expect(full.mode).toBe('full');

    const scoped = await runGate(root, { feature: 'example' });
    expect(scoped.status).toBe('pass');
    expect(scoped.mode).toBe('feature');
    expect(scoped.feature).toBe('example');

    await write(root, '.musubix/features/broken/requirements.md', '## REQ-BROKEN-001: Broken\nPriority: invalid-priority\n');

    const brokenFull = await runGate(root);
    expect(brokenFull.status).toBe('fail');

    const stillScoped = await runGate(root, { feature: 'example' });
    expect(stillScoped.status).toBe('pass');
    expect(stillScoped.mode).toBe('feature');

    await expect(runGate(root, { feature: 'does-not-exist' })).rejects.toThrow('Unknown feature');
  });

  /** @id TEST-CLI-WORKFLOW-UX-006
   * @verifies REQ-CLI-WORKFLOW-UX-006
   */
  it('TEST-CLI-WORKFLOW-UX-006 proposes native commands per detected toolchain without writing config.json', async () => {
    const root = await project();
    await writeText(root, 'services/api/go.mod', 'module example.com/api\n\ngo 1.21\n');
    await writeText(root, 'services/worker/Cargo.toml', '[package]\nname = "worker"\nversion = "0.1.0"\n');
    const { readText } = await import('../packages/analysis/src/index.js');
    const before = await readText(root, '.musubix/config.json');

    const proposals = await scaffoldCommands(root);
    expect(proposals.some((p) => p.toolchain === 'go' && p.manifest === 'services/api/go.mod')).toBe(true);
    expect(proposals.some((p) => p.toolchain === 'cargo' && p.manifest === 'services/worker/Cargo.toml')).toBe(true);
    expect(proposals.every((p) => p.name && p.command && Array.isArray(p.args))).toBe(true);

    const after = await readText(root, '.musubix/config.json');
    expect(after).toBe(before);
  });
});
