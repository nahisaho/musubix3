import { describe, expect, it } from 'vitest';
import {
  collectEvidenceHeads, defaultConfig, loadWorkflow, parseConfig, recordWorkflow, validateWorkflow,
  verifyWorkflowLog, writeJson,
} from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

const sessionId = '123e4567-e89b-42d3-a456-426614174000';

function strictTranscript(options: {
  resultSessionId?: string;
  exitCode?: number;
  extra?: object[];
  reverseCompletion?: boolean;
  terminalAt?: string;
} = {}): string {
  const start = {
    type: 'tool.execution_start',
    timestamp: '2020-01-01T00:00:01.000Z',
    data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
  };
  const completion = {
    type: 'tool.execution_complete',
    timestamp: options.reverseCompletion ? '2020-01-01T00:00:00.000Z' : '2020-01-01T00:00:02.000Z',
    data: { toolCallId: 'call-1', success: true },
  };
  return [start, completion, ...(options.extra ?? []), {
    type: 'result',
    timestamp: options.terminalAt ?? '2020-01-01T00:00:03.000Z',
    sessionId: options.resultSessionId ?? sessionId,
    exitCode: options.exitCode ?? 0,
  }].map((event) => JSON.stringify(event)).join('\n');
}

describe('P3 strict workflow transcript provenance', () => {
  it('keeps compatible verification by default and parses strict workflow config', () => {
    expect(defaultConfig.workflow).toEqual({
      mode: 'compatible',
      maxAgeSeconds: 3600,
      maxFutureSkewSeconds: 60,
    });
    expect(parseConfig({ schemaVersion: 1 }).workflow).toEqual(defaultConfig.workflow);
    expect(parseConfig({
      schemaVersion: 1,
      workflow: {
        mode: 'strict',
        expectedSessionId: sessionId,
        maxAgeSeconds: 300,
        maxFutureSkewSeconds: 10,
      },
    }).workflow).toEqual({
      mode: 'strict',
      expectedSessionId: sessionId,
      maxAgeSeconds: 300,
      maxFutureSkewSeconds: 10,
    });
    expect(() => parseConfig({ schemaVersion: 1, workflow: { mode: 'strict', expectedSessionId: 'not-a-uuid' } }))
      .toThrow('workflow.expectedSessionId');
    expect(() => parseConfig({ schemaVersion: 1, workflow: { mode: 'compatible', expectedSessionId: sessionId } }))
      .toThrow('requires workflow.mode strict');
  });

  it('enforces bounded strict transcript freshness at verification and validation time', async () => {
    const root = await fixture();
    const now = new Date('2020-01-01T00:05:00.000Z');
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await expect(verifyWorkflowLog(root, strictTranscript(), {
      mode: 'strict',
      maxAgeSeconds: 60,
      maxFutureSkewSeconds: 10,
      now: () => now,
    })).rejects.toThrow('older than');
    await expect(verifyWorkflowLog(root, strictTranscript({ terminalAt: '2020-01-01T00:05:30.000Z' }), {
      mode: 'strict',
      maxAgeSeconds: 60,
      maxFutureSkewSeconds: 10,
      now: () => now,
    })).rejects.toThrow('future');

    await verifyWorkflowLog(root, strictTranscript({ terminalAt: '2020-01-01T00:04:30.000Z' }), {
      mode: 'strict',
      maxAgeSeconds: 60,
      maxFutureSkewSeconds: 10,
      now: () => now,
    });
    expect(await validateWorkflow(root, {
      mode: 'strict',
      maxAgeSeconds: 20,
      maxFutureSkewSeconds: 10,
      now: () => now,
    })).toMatchObject({ verified: false });
    expect((await validateWorkflow(root, {
      mode: 'strict',
      maxAgeSeconds: 20,
      maxFutureSkewSeconds: 10,
      now: () => now,
    })).diagnostics).toContainEqual(expect.objectContaining({ code: 'WORKFLOW_TRANSCRIPT_EXPIRED' }));
  });

  it('persists a canonical transcript hash and terminal session identity in strict mode', async () => {
    const root = await fixture();
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    const first = await verifyWorkflowLog(root, `${strictTranscript()}\n`, {
      mode: 'strict',
      expectedSessionId: sessionId,
    });
    expect(first.verification).toMatchObject({
      mode: 'strict',
      sessionId,
      exitCode: 0,
      terminalAt: '2020-01-01T00:00:03.000Z',
      eventCount: 3,
    });
    expect(first.verification?.transcriptSha256).toMatch(/^[a-f0-9]{64}$/);
    const second = await verifyWorkflowLog(root, strictTranscript(), { mode: 'strict' });
    expect(second.verification?.transcriptSha256).toBe(first.verification?.transcriptSha256);
    expect(second.verification?.sourceSha256).not.toBe(first.verification?.sourceSha256);
    expect(await validateWorkflow(root, { mode: 'strict', expectedSessionId: sessionId }))
      .toMatchObject({ verified: true });
  });

  it('does not let compatible evidence satisfy a strict gate', async () => {
    const root = await fixture();
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await verifyWorkflowLog(root, strictTranscript().split('\n').slice(0, -1).join('\n'));
    expect((await validateWorkflow(root, { mode: 'strict' })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_TRANSCRIPT_INCOMPLETE' }));
  });

  it('requires exactly one final successful result with the expected session identity', async () => {
    const root = await fixture();
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await expect(verifyWorkflowLog(root, strictTranscript().split('\n').slice(0, -1).join('\n'), { mode: 'strict' }))
      .rejects.toThrow('terminal result');
    await expect(verifyWorkflowLog(root, strictTranscript({ exitCode: 1 }), { mode: 'strict' }))
      .rejects.toThrow('exitCode 0');
    await expect(verifyWorkflowLog(root, strictTranscript({
      extra: [{ type: 'result', timestamp: '2020-01-01T00:00:02.500Z', sessionId, exitCode: 0 }],
    }), { mode: 'strict' })).rejects.toThrow('exactly one');
    await expect(verifyWorkflowLog(root, strictTranscript(), {
      mode: 'strict',
      expectedSessionId: '123e4567-e89b-42d3-a456-426614174001',
    })).rejects.toThrow('does not match');
  });

  it('rejects malformed, unordered, orphaned, duplicate, and incomplete tool lifecycles', async () => {
    const root = await fixture();
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    await expect(verifyWorkflowLog(root, `${strictTranscript()}\nnot-json\n`, { mode: 'strict' }))
      .rejects.toThrow('valid JSON');
    await expect(verifyWorkflowLog(root, strictTranscript({ reverseCompletion: true }), { mode: 'strict' }))
      .rejects.toThrow('timestamp order');
    const orphan = strictTranscript().replace(
      '"tool.execution_start"',
      '"assistant.message"',
    );
    await expect(verifyWorkflowLog(root, orphan, { mode: 'strict' })).rejects.toThrow('without a matching start');
    const incomplete = strictTranscript().split('\n').filter((line) => !line.includes('tool.execution_complete')).join('\n');
    await expect(verifyWorkflowLog(root, incomplete, { mode: 'strict' })).rejects.toThrow('without a completion');
  });

  it('binds strict transcript identity into the workflow attestation head', async () => {
    const root = await fixture();
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    const manifest = await verifyWorkflowLog(root, strictTranscript(), { mode: 'strict' });
    const first = (await collectEvidenceHeads(root)).workflow;
    manifest.verification!.sessionId = '123e4567-e89b-42d3-a456-426614174001';
    await writeJson(root, '.musubix/evidence/workflow.json', manifest);
    expect((await collectEvidenceHeads(root)).workflow).not.toBe(first);
  });

  it('orders offset timestamps by instant rather than lexical representation', async () => {
    const root = await fixture();
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    const declaration = (await loadWorkflow(root))!;
    declaration.events[0]!.recordedAt = '2020-01-01T09:30:00.000Z';
    await writeJson(root, '.musubix/evidence/workflow.json', declaration);
    const transcript = [
      {
        type: 'tool.execution_start',
        timestamp: '2020-01-01T01:00:00.000-09:00',
        data: { toolCallId: 'call-offset', toolName: 'skill', arguments: { skill: 'sdd-change' } },
      },
      {
        type: 'tool.execution_complete',
        timestamp: '2020-01-01T01:00:01.000-09:00',
        data: { toolCallId: 'call-offset', success: true },
      },
      {
        type: 'result',
        timestamp: '2020-01-01T10:01:00.000Z',
        sessionId,
        exitCode: 0,
      },
    ].map((event) => JSON.stringify(event)).join('\n');
    const now = () => new Date('2020-01-01T10:02:00.000Z');
    await verifyWorkflowLog(root, transcript, {
      mode: 'strict',
      maxAgeSeconds: 300,
      maxFutureSkewSeconds: 10,
      now,
    });
    const result = await validateWorkflow(root, {
      mode: 'strict',
      maxAgeSeconds: 300,
      maxFutureSkewSeconds: 10,
      now,
    });
    expect(result.verified).toBe(false);
    expect(result.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_SKILL_NOT_INVOKED' }));
  });
});
