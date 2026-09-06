import { generateKeyPairSync } from 'node:crypto';
import { readdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import {
  githubOidcAudience, loadConfig, readText, runProcess, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { skillNames } from '../packages/cli/src/install.js';
import { fixture, project, repository, req } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');
async function invoke(root: string, args: string[]): Promise<Awaited<ReturnType<typeof runProcess>>> {
  return runProcess(process.execPath, [cli, ...args], { cwd: root, timeoutMs: 20_000 });
}

describe('CLI contracts', () => {
  it('prints version/help and JSON validation with nonzero failure', async () => {
    const root = await fixture({ 'requirements.md': req() });
    expect((await invoke(root, ['--version'])).stdout.trim()).toBe('0.1.0');
    expect((await invoke(root, ['--help'])).stdout).toContain('trace');
    const valid = await invoke(root, ['requirements', 'validate', 'requirements.md', '--json']);
    expect(valid.exitCode).toBe(0);
    expect(JSON.parse(valid.stdout).valid).toBe(true);
    await writeText(root, 'requirements.md', req('The system should work.'));
    const invalid = await invoke(root, ['requirements', 'validate', 'requirements.md', '--json']);
    expect(invalid.exitCode).toBe(1);
    expect(JSON.parse(invalid.stdout).valid).toBe(false);
  });

  it('returns structured errors for missing files, invalid solver and unknown commands', async () => {
    const root = await fixture();
    for (const args of [
      ['requirements', 'validate', 'missing.md', '--json'],
      ['formal', 'check', 'missing.md', '--solver', 'fake', '--json'],
      ['unexpected', '--json'],
    ]) {
      const result = await invoke(root, args);
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout).error.code).toBe('CLI_ERROR');
    }
  });

  it('supports init alias, dry-run, status and native-bin symlink invocation', async () => {
    const root = await fixture();
    const preview = await invoke(root, ['install', '--dry-run', '--json']);
    expect(JSON.parse(preview.stdout).dryRun).toBe(true);
    expect(await readdir(root)).toEqual([]);
    expect((await invoke(root, ['install', '--json'])).exitCode).toBe(0);
    const status = JSON.parse((await invoke(root, ['status', '--json'])).stdout);
    expect(status.initialized).toBe(true);
    expect(status.gate.ready).toBe(false);
    await symlink(cli, resolve(root, 'musubix3-bin'));
    const linked = await runProcess(process.execPath, [resolve(root, 'musubix3-bin'), '--version'], { cwd: root, timeoutMs: 10_000 });
    expect(linked.stdout.trim()).toBe('0.1.0');
  });

  it('runs full workflow and reports JSON evidence', async () => {
    const root = await project();
    const workflowTime = new Date(0).toISOString();
    await writeText(root, 'copilot.jsonl', `${JSON.stringify({
      type: 'tool.execution_start',
      timestamp: workflowTime,
      data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
    })}\n${JSON.stringify({
      type: 'tool.execution_complete',
      timestamp: workflowTime,
      data: { toolCallId: 'call-1', success: true },
    })}\n`);
    for (const args of [
      ['constitution', 'validate', '--json'],
      ['design', 'validate', '.musubix/features/example/design.md', '--json'],
      ['trace', 'build', '--json'],
      ['trace', 'check', '--strict', '--json'],
      ['trace', 'impact', 'REQ-EXAMPLE-001', '--json'],
      ['graph', 'index', '--json'],
      ['graph', 'impact', 'readiness', '--json'],
      ['graph', 'cycles', '--json'],
      ['graph', 'gate', '--json'],
      ['knowledge', 'build', '--json'],
      ['knowledge', 'query', 'readiness', '--json'],
      ['formal', 'generate', '.musubix/features/example/requirements.md', '--json'],
      ['formal', 'check', '.musubix/features/example/requirements.md', '--solver', 'none', '--json'],
      ['formal', 'doctor', '--json'],
      ['workflow-record', 'sdd-change', 'quality', '--status', 'completed', '--command', 'npm test', '--json'],
      ['workflow-verify', 'copilot.jsonl', '--json'],
      ['gate', '--json'],
    ]) {
      const result = await invoke(root, args);
      expect(result.exitCode, `${args.join(' ')}: ${result.stdout} ${result.stderr}`).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
    const diagram = await invoke(root, ['design', 'c4', '.musubix/features/example/design.md']);
    expect(diagram.stdout).toContain('flowchart LR');
    const workflow = await readText(root, '.musubix/evidence/workflow.json');
    expect(workflow).not.toContain('npm test');
    expect(JSON.parse(workflow).events[0]).toMatchObject({ skill: 'sdd-change', phase: 'quality', status: 'completed' });
    expect(JSON.parse((await invoke(root, ['status', '--json'])).stdout).gate.ready).toBe(true);
  }, 60_000);

  it('reports and enforces strict Code Graph mode through CLI gates and status', async () => {
    const root = await project();
    await writeText(root, 'src/dynamic.ts', 'const target = getTarget(); import(target);');
    const config = await loadConfig(root);
    config.codeGraph.mode = 'strict';
    await writeJson(root, '.musubix/config.json', config);
    const baseline = JSON.parse(await readText(root, '.musubix/policy-baseline.json'));
    baseline.codeGraph.mode = 'strict';
    await writeJson(root, '.musubix/policy-baseline.json', baseline);

    const graphGate = await invoke(root, ['graph', 'gate', '--json']);
    expect(graphGate.exitCode).toBe(1);
    expect(JSON.parse(graphGate.stdout).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'GRAPH_DYNAMIC', severity: 'error' }));
    const gate = await invoke(root, ['gate', '--json']);
    expect(gate.exitCode).toBe(1);
    expect(JSON.parse(gate.stdout).checks.find((check: { name: string }) => check.name === 'graph'))
      .toMatchObject({ required: true, status: 'fail' });
    expect(JSON.parse((await invoke(root, ['status', '--json'])).stdout))
      .toMatchObject({ codeGraph: { mode: 'strict' }, gate: { status: 'fail', ready: false } });
  });

  it('enforces strict workflow session identity from config and CLI', async () => {
    const root = await project();
    const sessionId = '123e4567-e89b-42d3-a456-426614174000';
    const config = await loadConfig(root);
    config.workflow = { mode: 'strict', expectedSessionId: sessionId };
    await writeJson(root, '.musubix/config.json', config);
    const terminalTime = Date.now();
    await writeText(root, 'copilot.jsonl', [
      {
        type: 'tool.execution_start',
        timestamp: new Date(terminalTime - 2_000).toISOString(),
        data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
      },
      {
        type: 'tool.execution_complete',
        timestamp: new Date(terminalTime - 1_000).toISOString(),
        data: { toolCallId: 'call-1', success: true },
      },
      { type: 'result', timestamp: new Date(terminalTime).toISOString(), sessionId, exitCode: 0 },
    ].map((event) => JSON.stringify(event)).join('\n'));
    expect((await invoke(root, [
      'workflow-record', 'sdd-change', 'complete', '--status', 'completed', '--json',
    ])).exitCode).toBe(0);
    const verified = await invoke(root, ['workflow-verify', 'copilot.jsonl', '--json']);
    expect(verified.exitCode, verified.stderr).toBe(0);
    expect(JSON.parse(verified.stdout).verification).toMatchObject({ mode: 'strict', sessionId, exitCode: 0 });
    const mismatch = await invoke(root, [
      'workflow-verify', 'copilot.jsonl', '--session-id', '123e4567-e89b-42d3-a456-426614174001', '--json',
    ]);
    expect(mismatch.exitCode).toBe(2);
    expect(JSON.parse(mismatch.stdout).error.message).toContain('does not match');
  });

  it('derives the configured GitHub OIDC audience without reading a private key', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.attestation = {
      mode: 'ci-required',
      repository: 'owner/repository',
      maxAgeSeconds: 600,
      maxFutureSkewSeconds: 30,
      trustedPublicKeys: [],
      githubOidc: {
        mode: 'strict',
        audience: 'https://musubix.dev/attestation',
        keyBinding: 'public-key',
      },
    };
    await writeJson(root, '.musubix/config.json', config);
    const { publicKey } = generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await writeText(root, 'public.pem', pem);
    const result = await invoke(root, [
      'attestation', 'oidc-audience', '--key-id', 'run-key', '--public-key-file', 'public.pem', '--json',
    ]);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      audience: githubOidcAudience('https://musubix.dev/attestation', 'public-key', 'run-key', pem),
      keyBinding: 'public-key',
    });
    expect(await readText(root, 'public.pem')).not.toContain('PRIVATE KEY');
  });

  it('records a staged change checkpoint through the CLI', async () => {
    const root = await project();
    await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\n');
    const result = await invoke(root, [
      'change-record', 'CHANGE-0001', 'impact', '--requirement', 'REQ-EXAMPLE-001', '--json',
    ]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).changes[0]).toMatchObject({
      changeId: 'CHANGE-0001',
      requirementIds: ['REQ-EXAMPLE-001'],
    });
    const gate = JSON.parse((await invoke(root, ['gate', '--json'])).stdout);
    expect(gate.checks.find((check: { name: string }) => check.name === 'change-history'))
      .toMatchObject({ required: true, status: 'fail' });
  });

  it('returns exit 1 for incomplete starter gates and contradictory requirements', async () => {
    const root = await fixture();
    await invoke(root, ['init', '--json']);
    const gate = await invoke(root, ['gate', '--json']);
    expect(gate.exitCode).toBe(1);
    expect(JSON.parse(gate.stdout).checks.some((c: { status: string }) => c.status === 'skipped')).toBe(true);
    await writeText(root, 'contradiction.md', req() + req('The system shall not report its readiness.', 'REQ-EXAMPLE-002'));
    const formal = await invoke(root, ['formal', 'check', 'contradiction.md', '--solver', 'none', '--json']);
    expect(formal.exitCode).toBe(1);
    expect(JSON.parse(formal.stdout).consistency).toBe('inconsistent');
    const timeout = await invoke(root, ['formal', 'check', 'contradiction.md', '--timeout', '1', '--json']);
    expect(timeout.exitCode).toBe(2);
    expect(JSON.parse(timeout.stdout).error.message).toContain('--timeout');
  });

  it('executes a complete CLI TDD cycle and exposes it to the gate', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.requiredChecks.push('tdd');
    config.commands[0]!.args = [
      '-e',
      "const fs=require('fs'); const id=process.argv[1], report=process.argv[2]; const pass=fs.existsSync('implemented.flag'); fs.mkdirSync(require('path').dirname(report),{recursive:true}); fs.writeFileSync(report,JSON.stringify({schemaVersion:1,tests:[{id,status:pass?'passed':'failed'}]})); process.exit(pass ? 0 : 1)",
    ];
    config.commands[0]!.tddArgs = ['{testId}', '{reportPath}'];
    config.commands[0]!.tddReport = { format: 'musubix-json', path: '.musubix/evidence/tdd-results/{testId}.json' };
    await writeJson(root, '.musubix/config.json', config);
    expect((await invoke(root, ['tdd', 'red', 'TEST-EXAMPLE-001', '--requirement', 'REQ-EXAMPLE-001', '--command', 'test', '--json'])).exitCode).toBe(0);
    await writeText(root, 'implemented.flag', 'green\n');
    expect((await invoke(root, ['tdd', 'green', 'TEST-EXAMPLE-001', '--requirement', 'REQ-EXAMPLE-001', '--command', 'test', '--json'])).exitCode).toBe(0);
    expect((await invoke(root, ['tdd', 'refactor', 'TEST-EXAMPLE-001', '--requirement', 'REQ-EXAMPLE-001', '--command', 'test', '--json'])).exitCode).toBe(0);
    const gate = JSON.parse((await invoke(root, ['gate', '--json'])).stdout);
    expect(gate.checks.find((check: { name: string }) => check.name === 'tdd')).toMatchObject({ required: true, status: 'pass' });
  });
});

describe('distribution contracts', () => {
  it('validates all eight concise bilingual skill frontmatters', async () => {
    expect((await readdir(resolve(repository, '.github/skills'))).sort()).toEqual([...skillNames].sort());
    for (const name of skillNames) {
      const text = await readText(repository, `.github/skills/${name}/SKILL.md`);
      const yaml = /^---\r?\n([\s\S]+?)\r?\n---/.exec(text)?.[1];
      expect(yaml).toBeDefined();
      const document = parseDocument(yaml!);
      expect(document.errors).toEqual([]);
      expect(document.toJSON()).toMatchObject({ name, description: expect.stringContaining('Use') });
      expect(text).toContain('input language');
      expect(text).toMatch(/[一-龠ぁ-んァ-ン]/);
      expect(text).toContain('native');
      expect(text.split(/\r?\n/).length).toBeLessThan(80);
    }
  });

  it('validates native manifests and packed hidden skills/built engine/assets', async () => {
    const pkg = JSON.parse(await readText(repository, 'package.json'));
    const plugin = JSON.parse(await readText(repository, 'plugin.json'));
    const marketplace = JSON.parse(await readText(repository, '.github/plugin/marketplace.json'));
    expect(plugin).toMatchObject({ name: pkg.name, version: pkg.version, skills: '.github/skills/' });
    expect(marketplace.plugins[0]).toMatchObject({ name: pkg.name, version: pkg.version, source: '.' });
    const checked = await runProcess(process.execPath, ['scripts/check-package.mjs'], { cwd: repository, timeoutMs: 20_000 });
    expect(checked.exitCode, checked.stderr).toBe(0);
    expect(checked.stdout).toContain('8 skills');
  });
});
