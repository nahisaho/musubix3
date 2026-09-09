import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  recordWorkflow, validateWorkflow, verifyWorkflowLogFile, writeText,
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

describe('Workflow multi-session verification', () => {
  /** @id TEST-WORKFLOW-MULTI-SESSION-001
   * @verifies REQ-WORKFLOW-MULTI-SESSION-001
   */
  it('TEST-WORKFLOW-MULTI-SESSION-001 reconciles declarations whose invocations span separate session transcript files', async () => {
    const root = await fixture();
    await writeText(root, 'session-a.jsonl', skillEvents('call-a', 'sdd-change', '2020-01-01T00:00:01.000Z', '2020-01-01T00:00:02.000Z'));
    await writeText(root, 'session-b.jsonl', skillEvents('call-b', 'sdd-knowledge', '2020-01-02T00:00:01.000Z', '2020-01-02T00:00:02.000Z'));
    const pathA = resolve(root, 'session-a.jsonl');
    const pathB = resolve(root, 'session-b.jsonl');

    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await recordWorkflow(root, { skill: 'sdd-knowledge', phase: 'complete', status: 'completed' });

    // Neither single transcript alone can reconcile both declarations.
    await verifyWorkflowLogFile(root, pathA);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_SKILL_NOT_INVOKED' }));
    await verifyWorkflowLogFile(root, pathB);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_SKILL_NOT_INVOKED' }));

    // Supplying both files (in either order) reconciles both declarations.
    await verifyWorkflowLogFile(root, [pathA, pathB]);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics).toEqual([]);
    await verifyWorkflowLogFile(root, [pathB, pathA]);
    expect((await validateWorkflow(root, { mode: 'compatible' })).diagnostics).toEqual([]);
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
});
