import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  readText, recordWorkflow, sanitizeWorkflowLogFile, verifyWorkflowLog, verifyWorkflowLogFile,
} from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

const sessionId = '123e4567-e89b-42d3-a456-426614174000';
const start = {
  type: 'tool.execution_start',
  timestamp: '2020-01-01T00:00:01.000Z',
  data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
};
const completion = {
  type: 'tool.execution_complete',
  timestamp: '2020-01-01T00:00:02.000Z',
  data: { toolCallId: 'call-1', success: true },
};
const result = {
  type: 'result',
  timestamp: '2020-01-01T00:00:03.000Z',
  sessionId,
  exitCode: 0,
};

async function preparedRoot(): Promise<string> {
  const root = await fixture();
  await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
  return root;
}

describe('P4 bounded streaming workflow verification', () => {
  it('streams a large transcript without changing event accounting', async () => {
    const root = await preparedRoot();
    const events = [
      start,
      ...Array.from({ length: 20_000 }, (_, index) => ({
        type: 'assistant.message',
        timestamp: '2020-01-01T00:00:01.500Z',
        data: { index, content: 'x'.repeat(64) },
      })),
      completion,
      result,
    ];
    const text = events.map((event) => JSON.stringify(event)).join('\n');
    const path = resolve(root, 'large.jsonl');
    await writeFile(path, text);

    const manifest = await verifyWorkflowLogFile(root, path, { mode: 'strict' });

    expect(Buffer.byteLength(text)).toBeGreaterThan(2_000_000);
    expect(manifest.verification).toMatchObject({ eventCount: events.length, sessionId });
  });

  it('handles UTF-8 and CRLF split across file stream chunks', async () => {
    const root = await preparedRoot();
    const utf8Prefix = '{"type":"assistant.message","timestamp":"2020-01-01T00:00:00.000Z","note":"';
    const splitUtf8Line = `${' '.repeat(65_535 - Buffer.byteLength(utf8Prefix))}${utf8Prefix}é"}\n`;
    const first = JSON.stringify(start);
    const crOffset = 131_071;
    const splitCrlfLine = `${first}${' '.repeat(crOffset - Buffer.byteLength(splitUtf8Line) - Buffer.byteLength(first))}\r\n`;
    const text = `${splitUtf8Line}${splitCrlfLine}${JSON.stringify(completion)}\r\n${JSON.stringify(result)}\r\n`;
    const path = resolve(root, 'boundaries.jsonl');
    await writeFile(path, text);

    const streamed = await verifyWorkflowLogFile(root, path, { mode: 'strict' });

    expect(streamed.verification).toMatchObject({ eventCount: 4, sessionId });
    expect(streamed.verification?.sourceSha256)
      .toBe(createHash('sha256').update(text).digest('hex'));
  });

  it('rejects oversized lines, excessive events, and malformed strict JSON', async () => {
    const root = await preparedRoot();
    const path = resolve(root, 'limited.jsonl');

    await writeFile(path, `${' '.repeat(33)}\n`);
    await expect(verifyWorkflowLogFile(root, path, { mode: 'strict', maxLineBytes: 32 }))
      .rejects.toThrow('line 1 exceeds the maximum size of 32 bytes');

    await writeFile(path, [start, completion, result].map((event) => JSON.stringify(event)).join('\n'));
    await expect(verifyWorkflowLogFile(root, path, { mode: 'strict', maxEvents: 2 }))
      .rejects.toThrow('maximum event count of 2');
    await expect(verifyWorkflowLogFile(root, path, { mode: 'strict', maxBytes: 10 }))
      .rejects.toThrow('maximum total size of 10 bytes');

    await writeFile(path, `${JSON.stringify(start)}\nnot-json\n`);
    await expect(verifyWorkflowLogFile(root, path, { mode: 'strict' }))
      .rejects.toThrow('line 2 must contain valid JSON');
  });

  it('keeps streamed and string raw/canonical hashes stable', async () => {
    const root = await preparedRoot();
    const text = [start, completion, result].map((event) => JSON.stringify(event)).join('\r\n') + '\r\n';
    const path = resolve(root, 'stable.jsonl');
    await writeFile(path, text);

    const streamed = await verifyWorkflowLogFile(root, path, { mode: 'strict' });
    const fromString = await verifyWorkflowLog(root, text, { mode: 'strict' });

    expect(streamed.verification?.sourceSha256).toBe(fromString.verification?.sourceSha256);
    expect(streamed.verification?.transcriptSha256).toBe(fromString.verification?.transcriptSha256);
    expect(streamed.verification?.sourceSha256)
      .toBe(createHash('sha256').update(text).digest('hex'));
  });

  it('creates a privacy-minimized transcript that remains strictly verifiable', async () => {
    const root = await preparedRoot();
    const raw = resolve(root, 'raw.jsonl');
    await writeFile(raw, [
      { type: 'assistant.message', timestamp: '2020-01-01T00:00:00.000Z', data: { content: 'secret-value' } },
      start,
      {
        type: 'tool.execution_start',
        timestamp: '2020-01-01T00:00:01.500Z',
        data: { toolCallId: 'other-call', toolName: 'bash', arguments: { command: 'echo secret-value' } },
      },
      completion,
      {
        type: 'tool.execution_complete',
        timestamp: '2020-01-01T00:00:02.500Z',
        data: { toolCallId: 'other-call', success: true, output: 'secret-value' },
      },
      result,
    ].map((event) => JSON.stringify(event)).join('\n'));
    const replacement = '123e4567-e89b-42d3-a456-426614174099';
    const report = await sanitizeWorkflowLogFile(root, raw, 'evidence/workflow.jsonl', replacement);
    const sanitized = await readText(root, 'evidence/workflow.jsonl');

    expect(report).toMatchObject({
      inputEvents: 6,
      outputEvents: 3,
      skillInvocations: 1,
      sessionId: replacement,
      sessionReplaced: true,
    });
    expect(sanitized).not.toContain('secret-value');
    expect((await verifyWorkflowLog(root, sanitized, { mode: 'strict', expectedSessionId: replacement })).verification)
      .toMatchObject({ eventCount: 3, sessionId: replacement });
  });

  it('refuses to sanitize a source transcript that fails strict verification', async () => {
    const root = await preparedRoot();
    const raw = resolve(root, 'invalid-raw.jsonl');
    await writeFile(raw, [
      start,
      completion,
      result,
      { type: 'assistant.message', timestamp: '2020-01-01T00:00:04.000Z', data: { content: 'dropped' } },
    ].map((event) => JSON.stringify(event)).join('\n'));

    await expect(sanitizeWorkflowLogFile(root, raw, 'evidence/workflow.jsonl'))
      .rejects.toThrow('terminal result event must be the final');
  });
});
