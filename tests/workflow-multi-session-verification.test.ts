import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson, defaultConfig, digest, loadWorkflow, recordAllWorkflowWaivers, recordWorkflow, validateLoadedWorkflow, validateWorkflow,
  verifyWorkflowLogFile, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

function skillEvents(toolCallId: string, skill: string, startAt: string, completeAt: string): string {
  return [
    {
      type: 'tool.execution_start',
      timestamp: startAt,
      data: { toolCallId, toolName: 'skill', arguments: { skill } },
    },
    {
      type: 'tool.execution_complete',
      timestamp: completeAt,
      data: { toolCallId, success: true },
    },
  ].map((event) => JSON.stringify(event)).join('\n');
}

function strictSkillEvents(sessionId: string, toolCallId: string, skill: string, day: number): string {
  const prefix = `2020-01-${String(day).padStart(2, '0')}T00:00:`;
  return [
    { type: 'session.start', timestamp: `${prefix}00.000Z`, data: { sessionId } },
    {
      type: 'tool.execution_start',
      timestamp: `${prefix}01.000Z`,
      data: { toolCallId, toolName: 'skill', arguments: { skill } },
    },
    {
      type: 'tool.execution_complete',
      timestamp: `${prefix}02.000Z`,
      data: { toolCallId, success: true },
    },
    {
      type: 'session.shutdown',
      timestamp: `${prefix}03.000Z`,
      data: { shutdownType: 'routine', sessionId },
    },
  ].map((event) => JSON.stringify(event)).join('\n');
}

async function persistenceResultContract() {
  const root = await fixture();
  await writeText(root, 'session.jsonl', skillEvents(
    'call-a',
    'sdd-change',
    '2020-01-01T00:00:01.000Z',
    '2020-01-01T00:00:02.000Z',
  ));
  await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
  return verifyWorkflowLogFile(root, resolve(root, 'session.jsonl'));
}

describe('Workflow multi-session verification', () => {
  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-001
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-001 retains verified invocations across separate persisting runs', async () => {
    const root = await fixture();
    await writeText(root, 'session-a.jsonl', skillEvents('call-a', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    await writeText(root, 'session-b.jsonl', skillEvents('call-b', 'sdd-knowledge', '2020-01-02T00:00:01.000Z', '2020-01-02T00:00:02.000Z'));
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await recordWorkflow(root, { skill: 'sdd-knowledge', phase: 'complete', status: 'completed' });

    await verifyWorkflowLogFile(root, resolve(root, 'session-a.jsonl'));
    await verifyWorkflowLogFile(root, resolve(root, 'session-b.jsonl'));

    const workflow = JSON.parse(await import('node:fs/promises').then(({ readFile }) =>
      readFile(resolve(root, '.musubix/evidence/workflow.json'), 'utf8')));
    expect(workflow.reconciliation.invocations.map((entry: { toolCallId: string }) => entry.toolCallId))
      .toEqual(['call-a', 'call-b']);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics).toEqual([]);
  });

  /** @id TEST-WORKFLOW-MULTI-SESSION-001
   * @verifies REQ-WORKFLOW-MULTI-SESSION-001
   */
  it('TEST-WORKFLOW-MULTI-SESSION-001 reconciles declarations whose invocations span separate session transcript files', async () => {
    const root = await fixture();
    await writeText(root, 'session-a.jsonl', skillEvents('call-a', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    await writeText(root, 'session-b.jsonl', skillEvents('call-b', 'sdd-knowledge', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    const pathA = resolve(root, 'session-a.jsonl');
    const pathB = resolve(root, 'session-b.jsonl');

    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await recordWorkflow(root, { skill: 'sdd-knowledge', phase: 'complete', status: 'completed' });

    // Separate persisting runs contribute to the same durable ledger.
    await verifyWorkflowLogFile(root, pathA);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_SKILL_NOT_INVOKED' }));
    await verifyWorkflowLogFile(root, pathB);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics).toEqual([]);

    // Supplying both files (in either order) reconciles both declarations.
    const forward = await verifyWorkflowLogFile(root, [pathA, pathB]);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics).toEqual([]);
    const reversed = await verifyWorkflowLogFile(root, [pathB, pathA]);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics).toEqual([]);
    expect(reversed.workflow.verification?.sourceSha256).toBe(forward.workflow.verification?.sourceSha256);
  });

  it('rejects the same tool call ID appearing in more than one supplied transcript file', async () => {
    const root = await fixture();
    await writeText(root, 'session-a.jsonl', skillEvents('call-shared', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    await writeText(root, 'session-b.jsonl', skillEvents('call-shared', 'sdd-change', '2020-01-02T00:00:01.000Z', '2020-01-02T00:00:02.000Z'));
    await expect(verifyWorkflowLogFile(root, [resolve(root, 'session-a.jsonl'), resolve(root, 'session-b.jsonl')]))
      .rejects.toThrow('more than one workflow transcript file');
  });

  it('rejects more than one transcript file in strict mode', async () => {
    const root = await fixture();
    await writeText(root, 'session-a.jsonl', skillEvents('call-a', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    await writeText(root, 'session-b.jsonl', skillEvents('call-b', 'sdd-change', '2020-01-02T00:00:01.000Z', '2020-01-02T00:00:02.000Z'));
    await expect(verifyWorkflowLogFile(root, [resolve(root, 'session-a.jsonl'), resolve(root, 'session-b.jsonl')], { mode: 'strict' }))
      .rejects.toThrow('exactly one transcript file');
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-007
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-007
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-007 documents reset, limits, and migration recovery', async () => {
    const readme = await readFile(resolve('README.md'), 'utf8');
    expect(readme).toContain('--reset-ledger --confirm');
    expect(readme).toContain('50,000-source');
    expect(readme).toContain('WORKFLOW_INVOCATION_CONFLICT');
    expect(readme).toContain('WORKFLOW_RECONCILIATION_MALFORMED');
    expect(readme).toContain('WORKFLOW_RECONCILIATION_LIMIT');
    expect(readme).toContain('WORKFLOW_RECONCILIATION_CONFIG_MISMATCH');
    expect(readme).toContain('WORKFLOW_RECONCILIATION_RESET_CONFIRMATION_REQUIRED');
    expect(readme).toContain('WORKFLOW_WAIVER_MIGRATION_SKIPPED');
    expect(readme).toContain('WORKFLOW_WAIVER_MIGRATION_WRITE_FAILED');
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-002
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-003
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-002 reports one ledger build and memoized scope heads', async () => {
    const root = await fixture();
    for (let index = 0; index < 100; index += 1) {
      await recordWorkflow(root, { skill: `missing-skill-${index}`, phase: 'complete', status: 'completed' });
    }
    const transcript = Array.from({ length: 1_000 }, (_, index) => {
      const start = new Date(Date.UTC(2020, 0, 1, 0, 0, index * 2)).toISOString();
      const complete = new Date(Date.UTC(2020, 0, 1, 0, 0, index * 2 + 1)).toISOString();
      return skillEvents(`call-${index}`, `unrelated-skill-${index}`, start, complete);
    }).join('\n');
    await writeText(root, 'session.jsonl', transcript);
    await verifyWorkflowLogFile(root, resolve(root, 'session.jsonl'));
    const workflow = await loadWorkflow(root);
    const beforeWaivers: string[] = [];
    await (validateLoadedWorkflow as unknown as (...args: unknown[]) => Promise<unknown>)(
      root,
      workflow,
      { mode: 'compatible' },
      { mode: 'compatible' },
      undefined,
      (operation: string) => beforeWaivers.push(operation),
    );
    expect(beforeWaivers).toEqual(['canonicalLedgerBuild']);

    expect((await recordAllWorkflowWaivers(root, 'nahisaho', 'scale fixture')).recorded).toBe(100);
    const loaded = JSON.parse(await readFile(resolve(root, '.musubix/evidence/workflow-waivers.json'), 'utf8'));
    const operations: string[] = [];
    await (validateLoadedWorkflow as unknown as (...args: unknown[]) => Promise<unknown>)(
      root,
      workflow,
      { mode: 'compatible' },
      { mode: 'compatible' },
      loaded,
      (operation: string) => operations.push(operation),
    );
    expect(operations.filter((operation) => operation === 'canonicalLedgerBuild')).toHaveLength(1);
    const scopeOperations = operations.filter((operation) => operation.startsWith('scopeHeadComputed('));
    expect(scopeOperations).toHaveLength(100);
    expect(new Set(scopeOperations)).toHaveLength(100);
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-004
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-004 rejects a source-shape mutation even with recomputed digests', async () => {
    const root = await fixture();
    await writeText(root, 'session.jsonl', skillEvents('call-a', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await verifyWorkflowLogFile(root, resolve(root, 'session.jsonl'));
    const workflow = await loadWorkflow(root) as NonNullable<Awaited<ReturnType<typeof loadWorkflow>>>;
    workflow.reconciliation!.invocations[0]!.sources[0]!.mode = 'invalid' as never;
    workflow.reconciliation!.ledgerSha256 = digest(canonicalJson(workflow.reconciliation!.invocations));
    await writeJson(root, '.musubix/evidence/workflow.json', workflow);
    expect((await validateWorkflow(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_RECONCILIATION_MALFORMED' }));
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-009
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-009 keeps unverified precedence after recordWorkflow retains stale bindings', async () => {
    const root = await fixture();
    await writeText(root, 'session.jsonl', [
      skillEvents('call-a', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'),
      skillEvents('call-b', 'sdd-change', '2020-01-01T00:00:03.000Z', '2020-01-01T00:00:04.000Z'),
    ].join('\n'));
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'requirements', status: 'completed' });
    await verifyWorkflowLogFile(root, resolve(root, 'session.jsonl'));

    await recordWorkflow(root, { skill: 'sdd-change', phase: 'design', status: 'completed' });
    const diagnostics = (await validateWorkflow(root)).diagnostics;
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 'WORKFLOW_INVOCATION_UNVERIFIED' }));
    expect(diagnostics).not.toContainEqual(expect.objectContaining({ code: 'WORKFLOW_RECONCILIATION_MALFORMED' }));
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-010
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-010 keeps run session constraints transient and validates exact durable shapes', async () => {
    const sessionA = '123e4567-e89b-42d3-a456-426614174000';
    const sessionB = '123e4567-e89b-42d3-a456-426614174001';
    const root = await fixture();
    await writeText(root, 'session-a.jsonl', strictSkillEvents(sessionA, 'call-a', 'sdd-change', 1));
    await writeText(root, 'session-b.jsonl', strictSkillEvents(sessionB, 'call-b', 'sdd-knowledge', 2));
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await recordWorkflow(root, { skill: 'sdd-knowledge', phase: 'complete', status: 'completed' });

    await verifyWorkflowLogFile(root, resolve(root, 'session-a.jsonl'), {
      mode: 'strict',
      expectedSessionId: sessionA,
      now: () => new Date('2020-01-01T00:00:04.000Z'),
    });
    await verifyWorkflowLogFile(root, resolve(root, 'session-b.jsonl'), {
      mode: 'strict',
      expectedSessionId: sessionB,
      now: () => new Date('2020-01-02T00:00:04.000Z'),
    });
    const workflow = await loadWorkflow(root) as NonNullable<Awaited<ReturnType<typeof loadWorkflow>>>;
    expect(workflow.reconciliation?.expectedSessionId).toBeUndefined();
    expect(workflow.reconciliation?.bindings.map((binding) => Object.keys(binding).sort())).toEqual([
      ['eventIndex', 'phase', 'recordedAt', 'skill', 'toolCallId'],
      ['eventIndex', 'phase', 'recordedAt', 'skill', 'toolCallId'],
    ]);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics).toEqual([]);

    delete workflow.reconciliation!.invocations[0]!.completedAt;
    workflow.reconciliation!.ledgerSha256 = digest(canonicalJson(workflow.reconciliation!.invocations));
    await writeJson(root, '.musubix/evidence/workflow.json', workflow);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_RECONCILIATION_MALFORMED' }));

    const anchoredRoot = await fixture();
    const config = structuredClone(defaultConfig);
    config.workflow = { mode: 'strict', expectedSessionId: sessionA };
    await writeJson(anchoredRoot, '.musubix/config.json', config);
    await writeText(anchoredRoot, 'session-a.jsonl', strictSkillEvents(sessionA, 'call-a', 'sdd-change', 1));
    await writeText(anchoredRoot, 'session-b.jsonl', strictSkillEvents(sessionB, 'call-b', 'sdd-change', 2));
    await recordWorkflow(anchoredRoot, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await verifyWorkflowLogFile(anchoredRoot, resolve(anchoredRoot, 'session-a.jsonl'), {
      now: () => new Date('2020-01-01T00:00:04.000Z'),
    });
    const before = await readFile(resolve(anchoredRoot, '.musubix/evidence/workflow.json'), 'utf8');
    config.workflow.expectedSessionId = sessionB;
    await writeJson(anchoredRoot, '.musubix/config.json', config);
    await expect(verifyWorkflowLogFile(anchoredRoot, resolve(anchoredRoot, 'session-b.jsonl'), {
      now: () => new Date('2020-01-02T00:00:04.000Z'),
    }))
      .rejects.toThrow(/WORKFLOW_RECONCILIATION_CONFIG_MISMATCH.*reset-ledger/);
    expect(await readFile(resolve(anchoredRoot, '.musubix/evidence/workflow.json'), 'utf8')).toBe(before);
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-011
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-006 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-007 REQ-WORKFLOW-EVIDENCE-WAIVER-012 REQ-WORKFLOW-EVIDENCE-WAIVER-014
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-011 returns only the documented persistence result while retaining manifest compatibility', async () => {
    const root = await fixture();
    await writeText(root, 'session.jsonl', skillEvents(
      'call-a',
      'sdd-change',
      '2020-01-01T00:00:01.000Z',
      '2020-01-01T00:00:02.000Z',
    ));
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    const result = await verifyWorkflowLogFile(root, resolve(root, 'session.jsonl'));

    expect(Object.keys(result).sort()).toEqual(['warnings', 'workflow']);
    expect(result.workflow.reconciliation?.bindings[0]).toEqual(expect.objectContaining({
      eventIndex: 0,
      skill: 'sdd-change',
      phase: 'complete',
      toolCallId: 'call-a',
    }));
    expect(result.verification).toBe(result.workflow.verification);
    expect(result.warnings).toEqual([]);
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-012
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-012 exposes the durable merged workflow through the documented result', async () => {
    const result = await persistenceResultContract();
    expect(Object.keys(result).sort()).toEqual(['warnings', 'workflow']);
    expect(result.workflow.reconciliation?.invocations).toHaveLength(1);
    expect(result.verification).toBe(result.workflow.verification);
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-013
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-013 exposes deterministic bindings through the documented result', async () => {
    const result = await persistenceResultContract();
    expect(Object.keys(result).sort()).toEqual(['warnings', 'workflow']);
    expect(result.workflow.reconciliation?.bindings[0]?.toolCallId).toBe('call-a');
    expect(result.workflow.reconciliation?.bindingsSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-014
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-014 exposes only the exact durable binding shape', async () => {
    const result = await persistenceResultContract();
    expect(Object.keys(result).sort()).toEqual(['warnings', 'workflow']);
    expect(Object.keys(result.workflow.reconciliation!.bindings[0]!).sort()).toEqual([
      'eventIndex',
      'phase',
      'recordedAt',
      'skill',
      'toolCallId',
    ]);
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-015
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-006
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-015 exposes attested reconciliation digests through the documented result', async () => {
    const result = await persistenceResultContract();
    expect(Object.keys(result).sort()).toEqual(['warnings', 'workflow']);
    expect(result.workflow.reconciliation?.ledgerSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.workflow.reconciliation?.bindingsSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-016
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-007
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-016 exposes migration and recovery warnings through the documented result', async () => {
    const result = await persistenceResultContract();
    expect(Object.keys(result).sort()).toEqual(['warnings', 'workflow']);
    expect(result.warnings).toEqual([]);
  });

  /** @id TEST-WORKFLOW-EVIDENCE-WAIVER-018
   * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-012
   */
  it('TEST-WORKFLOW-EVIDENCE-WAIVER-018 preserves scope-valid waiver evaluation behind the documented result', async () => {
    const result = await persistenceResultContract();
    expect(Object.keys(result).sort()).toEqual(['warnings', 'workflow']);
    expect(result.workflow.reconciliation?.bindings[0]).toEqual(expect.objectContaining({
      skill: 'sdd-change',
      phase: 'complete',
    }));
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-005
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-005
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-005 reports malformed waiver migration as still pending', async () => {
    const root = await fixture();
    await writeText(root, 'session.jsonl', skillEvents('call-a', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await writeJson(root, '.musubix/evidence/workflow-waivers.json', { schemaVersion: 1, waivers: [{}] });
    const result = await verifyWorkflowLogFile(root, resolve(root, 'session.jsonl'));
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'WORKFLOW_WAIVER_MIGRATION_SKIPPED',
      message: expect.stringContaining('remains pending'),
    }));
  });

  /** @id TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-008
   * @verifies REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-006
   */
  it('TEST-WORKFLOW-RESUMED-SESSION-DURABILITY-008 documents reconciliation attestation fields', async () => {
    const readme = await readFile(resolve('README.md'), 'utf8');
    expect(readme).toContain('ledgerSha256');
    expect(readme).toContain('bindingsSha256');
  });
});
