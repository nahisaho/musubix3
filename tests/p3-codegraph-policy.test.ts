import { describe, expect, it } from 'vitest';
import {
  defaultConfig, graphGate, indexGraph, loadConfig, parsePolicyBaseline, policyDiagnostics,
  projectStatus, readText, runGate, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { fixture, project } from './helpers.js';

describe('P3 unresolved dynamic module loading policy', () => {
  it('keeps unresolved computed imports and requires as compatible warnings by default', async () => {
    const root = await fixture({
      'main.ts': 'const target = getTarget(); import(target); require(target);',
    });

    describe('P3 trusted workflow and attestation policy', () => {
      it('protects strict workflow identity and freshness bounds from weakening', () => {
        const expectedSessionId = '123e4567-e89b-42d3-a456-426614174000';
        const baseline = parsePolicyBaseline({
          schemaVersion: 1,
          workflow: {
            mode: 'strict',
            expectedSessionId,
            maxAgeSeconds: 300,
            maxFutureSkewSeconds: 10,
          },
        });
        const weakened = {
          ...defaultConfig,
          workflow: {
            mode: 'compatible' as const,
            maxAgeSeconds: 301,
            maxFutureSkewSeconds: 11,
          },
        };
        expect(policyDiagnostics(weakened, baseline).map((diagnostic) => diagnostic.code))
          .toEqual(expect.arrayContaining([
            'POLICY_WORKFLOW_MODE',
            'POLICY_WORKFLOW_SESSION',
            'POLICY_WORKFLOW_MAX_AGE',
            'POLICY_WORKFLOW_FUTURE_SKEW',
          ]));
      });

      it('protects CI-required strict OIDC identity and key binding from weakening', () => {
        const baseline = parsePolicyBaseline({
          schemaVersion: 1,
          attestation: {
            mode: 'ci-required',
            repository: 'owner/repository',
            maxAgeSeconds: 300,
            maxFutureSkewSeconds: 10,
            trustedPublicKeys: [],
            githubOidc: {
              mode: 'strict',
              audience: 'https://musubix.dev/attestation',
              repository: 'owner/repository',
              workflow: 'release.yml',
              ref: 'refs/heads/main',
              keyBinding: 'public-key',
            },
          },
        });
        const weakened = {
          ...defaultConfig,
          attestation: {
            ...defaultConfig.attestation,
            mode: 'local' as const,
            maxAgeSeconds: 301,
            maxFutureSkewSeconds: 11,
            githubOidc: { mode: 'off' as const },
          },
        };
        expect(policyDiagnostics(weakened, baseline).map((diagnostic) => diagnostic.code))
          .toEqual(expect.arrayContaining([
            'POLICY_ATTESTATION_MODE',
            'POLICY_ATTESTATION_MAX_AGE',
            'POLICY_ATTESTATION_FUTURE_SKEW',
            'POLICY_ATTESTATION_OIDC_MODE',
            'POLICY_ATTESTATION_OIDC_BINDING',
          ]));

        const rebound = {
          ...defaultConfig,
          attestation: {
            ...baseline.attestation,
            githubOidc: {
              ...baseline.attestation.githubOidc,
              mode: 'strict' as const,
              keyBinding: 'key-id' as const,
            },
          },
        };
        expect(policyDiagnostics(rebound, baseline))
          .toContainEqual(expect.objectContaining({ code: 'POLICY_ATTESTATION_OIDC_BINDING' }));
      });
    });
    const graph = await indexGraph(root);
    const gate = graphGate(graph, defaultConfig.architecture, defaultConfig.codeGraph);
    const dynamic = gate.diagnostics.filter((diagnostic) => diagnostic.code === 'GRAPH_DYNAMIC');
    expect(dynamic).toHaveLength(2);
    expect(dynamic.every((diagnostic) => diagnostic.severity === 'warning')).toBe(true);
    expect(gate.valid).toBe(true);
  });

  it('upgrades unresolved computed loading to gate-blocking errors in strict mode', async () => {
    const root = await project();
    await writeText(root, 'src/dynamic.ts', 'const target = getTarget(); import(target); require(target);');
    const config = await loadConfig(root);
    config.codeGraph.mode = 'strict';
    await writeJson(root, '.musubix/config.json', config);
    const baseline = JSON.parse(await readText(root, '.musubix/policy-baseline.json'));
    baseline.codeGraph.mode = 'strict';
    await writeJson(root, '.musubix/policy-baseline.json', baseline);

    const graph = await indexGraph(root);
    const graphResult = graphGate(graph, config.architecture, config.codeGraph);
    expect(graphResult.valid).toBe(false);
    expect(graphResult.diagnostics.filter((diagnostic) => diagnostic.code === 'GRAPH_DYNAMIC'))
      .toEqual([
        expect.objectContaining({ severity: 'error' }),
        expect.objectContaining({ severity: 'error' }),
      ]);

    const gate = await runGate(root);
    expect(gate.status).toBe('fail');
    expect(gate.checks.find((check) => check.name === 'graph'))
      .toMatchObject({ required: true, status: 'fail' });
    expect((await projectStatus(root)).codeGraph).toEqual({ mode: 'strict' });
  });

  it('rejects weakening a strict trusted Code Graph baseline', async () => {
    const root = await project();
    const baseline = JSON.parse(await readText(root, '.musubix/policy-baseline.json'));
    baseline.codeGraph.mode = 'strict';
    await writeJson(root, '.musubix/policy-baseline.json', baseline);

    const report = await runGate(root);
    expect(report.status).toBe('fail');
    expect(report.checks.find((check) => check.name === 'policy')?.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'POLICY_CODE_GRAPH_MODE' }));
  });

  it('allows statically resolvable cache-busting imports in strict mode', async () => {
    const root = await fixture({
      'src/entry.ts': 'export const value = 1;',
      'src/runner.ts': [
        "const moduleUrl = new URL('./entry.js', import.meta.url).href;",
        'import(`${moduleUrl}?fresh=${Date.now()}`);',
      ].join('\n'),
    });
    const graph = await indexGraph(root);
    const gate = graphGate(graph, defaultConfig.architecture, { mode: 'strict' });
    expect(graph.imports).toContainEqual(expect.objectContaining({
      from: 'src/runner.ts', to: 'src/entry.ts', kind: 'dynamic',
    }));
    expect(gate.diagnostics.filter((diagnostic) => diagnostic.code === 'GRAPH_DYNAMIC')).toEqual([]);
    expect(gate.valid).toBe(true);
  });
});
