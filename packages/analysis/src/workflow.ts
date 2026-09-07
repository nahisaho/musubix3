import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { error, type Diagnostic } from '../../domain/src/index.js';
import type { WorkflowConfig } from './config.js';
import { digest, exists, readText, within, writeJson } from './files.js';

export interface WorkflowEvent {
  skill: string;
  version: string;
  provenance?: 'self-reported';
  phase: string;
  status: 'completed' | 'skipped' | 'failed';
  reason?: string;
  commandSha256?: string;
  recordedAt: string;
}

export interface WorkflowManifest {
  schemaVersion: 1;
  events: WorkflowEvent[];
  verification?: {
    mode?: 'compatible' | 'strict';
    sourceSha256: string;
    transcriptSha256?: string;
    eventsSha256: string;
    verifiedAt: string;
    sessionId?: string;
    exitCode?: number;
    terminalAt?: string;
    eventCount?: number;
    invocations: Array<{
      skill: string;
      toolCallId: string;
      invokedAt: string;
      completedAt?: string;
      status: 'completed' | 'failed' | 'incomplete';
    }>;
  };
}

export interface WorkflowVerificationOptions extends WorkflowConfig {
  now?: () => Date;
  maxBytes?: number;
  maxLineBytes?: number;
  maxEvents?: number;
}

export const workflowVerificationLimits = {
  maxBytes: 100_000_000,
  maxLineBytes: 1_000_000,
  maxEvents: 1_000_000,
} as const;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const starts = new Set(['tool.execution_start', 'tool.execution_started', 'tool_use']);
const completes = new Set(['tool.execution_complete', 'tool.execution_completed', 'tool_result']);

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function eventsSha256(events: WorkflowEvent[]): string {
  return digest(JSON.stringify(events));
}

export function workflowEvidenceHead(workflow: WorkflowManifest | null | undefined): string | null {
  const verification = workflow?.verification;
  if (!verification) return null;
  if (!verification.mode && !verification.transcriptSha256 && !verification.sessionId) {
    return digest(`${verification.eventsSha256}:${verification.sourceSha256}`);
  }
  return digest(canonical({
    eventsSha256: verification.eventsSha256,
    sourceSha256: verification.sourceSha256,
    transcriptSha256: verification.transcriptSha256 ?? null,
    mode: verification.mode ?? 'compatible',
    sessionId: verification.sessionId ?? null,
    exitCode: verification.exitCode ?? null,
    terminalAt: verification.terminalAt ?? null,
    eventCount: verification.eventCount ?? null,
    invocations: verification.invocations,
  }));
}

export async function loadWorkflow(root: string): Promise<WorkflowManifest | null> {
  const path = '.musubix/evidence/workflow.json';
  if (!await exists(within(root, path))) return null;
  const value = JSON.parse(await readText(root, path)) as WorkflowManifest;
  if (value.schemaVersion !== 1 || !Array.isArray(value.events)) throw new Error('Invalid workflow evidence.');
  return value;
}

export async function recordWorkflow(
  root: string,
  event: Omit<WorkflowEvent, 'version' | 'recordedAt' | 'commandSha256'> & { command?: string },
): Promise<WorkflowManifest> {
  if (!/^[a-z0-9-]+$/.test(event.skill)) throw new Error('Workflow skill must be a lowercase kebab-case identifier.');
  if (!/^[a-z0-9-]+$/.test(event.phase)) throw new Error('Workflow phase must be a lowercase kebab-case identifier.');
  const current = await loadWorkflow(root) ?? { schemaVersion: 1, events: [] };
  delete current.verification;
  current.events.push({
    skill: event.skill,
    version: '0.1.2',
    provenance: 'self-reported',
    phase: event.phase,
    status: event.status,
    ...(event.reason ? { reason: event.reason } : {}),
    ...(event.command ? { commandSha256: digest(event.command) } : {}),
    recordedAt: new Date().toISOString(),
  });
  await writeJson(root, '.musubix/evidence/workflow.json', current);
  return current;
}

export async function verifyWorkflowLog(
  root: string,
  logText: string,
  options: WorkflowVerificationOptions = { mode: 'compatible' },
): Promise<WorkflowManifest> {
  return verifyWorkflowChunks(root, (async function* () {
    yield Buffer.from(logText);
  })(), options);
}

export async function verifyWorkflowLogFile(
  root: string,
  path: string,
  options: WorkflowVerificationOptions = { mode: 'compatible' },
): Promise<WorkflowManifest> {
  return verifyWorkflowChunks(root, createReadStream(path), options);
}

async function verifyWorkflowChunks(
  root: string,
  chunks: AsyncIterable<Uint8Array>,
  options: WorkflowVerificationOptions,
): Promise<WorkflowManifest> {
  const current = await loadWorkflow(root);
  if (!current?.events.length) throw new Error('No workflow declarations are available to verify.');
  if (!['compatible', 'strict'].includes(options.mode)) throw new Error('Workflow verification mode must be compatible or strict.');
  if (options.expectedSessionId && !uuid.test(options.expectedSessionId)) throw new Error('Expected workflow session ID must be a UUID.');
  const maxBytes = options.maxBytes ?? workflowVerificationLimits.maxBytes;
  const maxLineBytes = options.maxLineBytes ?? workflowVerificationLimits.maxLineBytes;
  const maxEvents = options.maxEvents ?? workflowVerificationLimits.maxEvents;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Workflow maximum byte limit must be a positive integer.');
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 1) throw new Error('Workflow maximum line byte limit must be a positive integer.');
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new Error('Workflow maximum event limit must be a positive integer.');

  const sourceHash = createHash('sha256');
  const transcriptHash = createHash('sha256');
  transcriptHash.update('[');
  let totalBytes = 0;
  let lineNumber = 1;
  let lineParts: Buffer[] = [];
  let lineBytes = 0;
  let parsedCount = 0;
  let resultCount = 0;
  let lastParsedWasResult = false;
  let terminalRecord: Record<string, unknown> | undefined;
  const invocationsById = new Map<string, { skill: string; toolCallId: string; invokedAt: string }>();
  const completions = new Map<string, { completedAt: string; status: 'completed' | 'failed' }>();
  const toolStarts = new Map<string, { timestamp: string; index: number }>();
  const toolCompletions = new Set<string>();
  let lastToolTimestamp = Number.NEGATIVE_INFINITY;

  const processLine = (bytes: Buffer, line: number): void => {
    if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, -1);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(`Workflow transcript line ${line} must contain valid UTF-8.`);
    }
    const lineText = text;
    if (!lineText.trim()) return;
    let event: unknown;
    try {
      event = JSON.parse(lineText) as unknown;
    } catch {
      if (options.mode === 'strict') {
        throw new Error(`Workflow transcript line ${line} must contain valid JSON.`);
      }
      return;
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      if (options.mode === 'strict') throw new Error(`Workflow transcript line ${line} must be a JSON object.`);
      return;
    }
    parsedCount += 1;
    if (parsedCount > maxEvents) {
      throw new Error(`Workflow transcript exceeds the maximum event count of ${maxEvents}.`);
    }
    const record = event as Record<string, unknown>;
    transcriptHash.update(parsedCount === 1 ? canonical(record) : `,${canonical(record)}`);
    lastParsedWasResult = record.type === 'result';
    if (lastParsedWasResult) {
      resultCount += 1;
      terminalRecord = record;
    }
    const data = record.data && typeof record.data === 'object'
      ? record.data as Record<string, unknown>
      : record;
    const type = String(record.type ?? '');
    const timestampValue = record.timestamp ?? data.timestamp;
    const timestamp = typeof timestampValue === 'string' ? timestampValue : '';
    const time = Date.parse(timestamp);
    if (options.mode === 'strict') {
      if (!type) throw new Error(`Workflow transcript line ${line} has no event type.`);
      if (!timestamp || Number.isNaN(time)) throw new Error(`Workflow transcript line ${line} has an invalid timestamp.`);
    }
    const toolCallId = data.toolCallId ?? data.callId ?? record.toolCallId;
    if (starts.has(type)) {
      if (typeof toolCallId !== 'string' || !toolCallId || !timestamp) {
        if (options.mode === 'strict') throw new Error(`Tool start on line ${line} requires a toolCallId and timestamp.`);
        return;
      }
      if (options.mode === 'strict' && toolStarts.has(toolCallId)) {
        throw new Error(`Tool call ${toolCallId} has more than one start event.`);
      }
      lastToolTimestamp = Math.max(lastToolTimestamp, time);
      toolStarts.set(toolCallId, { timestamp, index: parsedCount - 1 });
      const toolName = data.toolName ?? data.name ?? record.toolName;
      let args: Record<string, unknown> = {};
      if (data.arguments && typeof data.arguments === 'object') args = data.arguments as Record<string, unknown>;
      else if (typeof data.arguments === 'string') {
        try { args = JSON.parse(data.arguments) as Record<string, unknown>; } catch { args = {}; }
      } else if (data.input && typeof data.input === 'object') args = data.input as Record<string, unknown>;
      if (toolName === 'skill' && typeof args.skill === 'string' && !invocationsById.has(toolCallId)) {
        invocationsById.set(toolCallId, { skill: args.skill, toolCallId, invokedAt: timestamp });
      }
    } else if (completes.has(type)) {
      if (typeof toolCallId !== 'string' || !toolCallId || !timestamp) {
        if (options.mode === 'strict') throw new Error(`Tool completion on line ${line} requires a toolCallId and timestamp.`);
        return;
      }
      const start = toolStarts.get(toolCallId);
      if (options.mode === 'strict') {
        if (!start) throw new Error(`Tool call ${toolCallId} completed without a matching start.`);
        if (toolCompletions.has(toolCallId)) throw new Error(`Tool call ${toolCallId} has more than one completion event.`);
        if (start.index >= parsedCount - 1
          || Date.parse(start.timestamp) - time > (options.maxEventSkewMs ?? 1000)) {
          throw new Error(`Tool call ${toolCallId} violates event timestamp order.`);
        }
      }
      lastToolTimestamp = Math.max(lastToolTimestamp, time);
      toolCompletions.add(toolCallId);
      const success = data.success ?? record.success;
      if (options.mode === 'strict' && typeof success !== 'boolean') {
        throw new Error(`Tool call ${toolCallId} completion must declare boolean success.`);
      }
      completions.set(toolCallId, { completedAt: timestamp, status: success === false ? 'failed' : 'completed' });
    }
  };

  for await (const value of chunks) {
    const chunk = Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`Workflow transcript exceeds the maximum total size of ${maxBytes} bytes.`);
    }
    sourceHash.update(chunk);
    let start = 0;
    for (let index = chunk.indexOf(0x0a); index !== -1; index = chunk.indexOf(0x0a, start)) {
      const part = chunk.subarray(start, index);
      lineBytes += part.byteLength;
      if (lineBytes > maxLineBytes) {
        throw new Error(`Workflow transcript line ${lineNumber} exceeds the maximum size of ${maxLineBytes} bytes.`);
      }
      if (part.byteLength) lineParts.push(part);
      processLine(Buffer.concat(lineParts, lineBytes), lineNumber);
      lineNumber += 1;
      lineParts = [];
      lineBytes = 0;
      start = index + 1;
    }
    const remainder = chunk.subarray(start);
    lineBytes += remainder.byteLength;
    if (lineBytes > maxLineBytes) {
      throw new Error(`Workflow transcript line ${lineNumber} exceeds the maximum size of ${maxLineBytes} bytes.`);
    }
    if (remainder.byteLength) lineParts.push(remainder);
  }
  processLine(Buffer.concat(lineParts, lineBytes), lineNumber);
  transcriptHash.update(']');
  if (options.mode === 'strict' && !parsedCount) throw new Error('Strict workflow verification requires a complete Copilot JSONL transcript.');

  let terminal: { timestamp: string; sessionId: string; exitCode: number } | undefined;
  if (options.mode === 'strict') {
    if (resultCount !== 1) throw new Error('Strict workflow verification requires exactly one terminal result event.');
    if (!lastParsedWasResult) throw new Error('The terminal result event must be the final JSONL event.');
    const timestamp = terminalRecord!.timestamp;
    const sessionId = terminalRecord!.sessionId;
    const exitCode = terminalRecord!.exitCode;
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))
      || lastToolTimestamp - Date.parse(timestamp) > (options.maxEventSkewMs ?? 1000)) {
      throw new Error('The terminal result event violates event timestamp order.');
    }
    if (typeof sessionId !== 'string' || !uuid.test(sessionId)) {
      throw new Error('The terminal result event must declare a UUID sessionId.');
    }
    if (exitCode !== 0) throw new Error('The terminal result event must declare exitCode 0.');
    if (options.expectedSessionId && sessionId.toLowerCase() !== options.expectedSessionId.toLowerCase()) {
      throw new Error(`Transcript session ID ${sessionId} does not match expected session ID ${options.expectedSessionId}.`);
    }
    const now = (options.now ?? (() => new Date()))().getTime();
    const terminalTime = Date.parse(timestamp);
    if (options.maxFutureSkewSeconds !== undefined
      && terminalTime > now + options.maxFutureSkewSeconds * 1000) {
      throw new Error('The terminal workflow transcript timestamp is beyond the allowed future skew.');
    }
    if (options.maxAgeSeconds !== undefined && now - terminalTime > options.maxAgeSeconds * 1000) {
      throw new Error('The terminal workflow transcript is older than the configured maximum age.');
    }
    const incomplete = [...toolStarts.keys()].find((toolCallId) => !toolCompletions.has(toolCallId));
    if (incomplete) throw new Error(`Tool call ${incomplete} has a start event without a completion.`);
    terminal = { timestamp, sessionId, exitCode };
  }
  const invocations: NonNullable<WorkflowManifest['verification']>['invocations'] = [...invocationsById.values()]
    .map((start) => ({ ...start, ...(completions.get(start.toolCallId) ?? { status: 'incomplete' as const }) }))
    .sort((a, b) => timestampMs(a.invokedAt) - timestampMs(b.invokedAt) || a.toolCallId.localeCompare(b.toolCallId));
  if (!invocations.length) throw new Error('No Copilot Skill invocation events were found in the log.');
  current.verification = {
    mode: options.mode,
    sourceSha256: sourceHash.digest('hex'),
    ...(options.mode === 'strict' ? {
      transcriptSha256: transcriptHash.digest('hex'),
      sessionId: terminal!.sessionId,
      exitCode: terminal!.exitCode,
      terminalAt: terminal!.timestamp,
      eventCount: parsedCount,
    } : {}),
    eventsSha256: eventsSha256(current.events),
    verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
    invocations,
  };
  await writeJson(root, '.musubix/evidence/workflow.json', current);
  return current;
}

export async function validateWorkflow(
  root: string,
  options: WorkflowVerificationOptions = { mode: 'compatible' },
): Promise<{
  present: boolean;
  verified: boolean;
  events: number;
  skills: number;
  diagnostics: Diagnostic[];
}> {
  const workflow = await loadWorkflow(root);
  if (!workflow?.events.length) return { present: false, verified: false, events: 0, skills: 0, diagnostics: [] };
  const diagnostics: Diagnostic[] = [];
  if (!workflow.verification) {
    diagnostics.push(error('WORKFLOW_INVOCATION_UNVERIFIED', 'Workflow declarations have not been reconciled with a Copilot session log.'));
  } else {
    if (options.mode === 'strict') {
      const verification = workflow.verification;
      if (verification.mode !== 'strict'
        || !verification.transcriptSha256 || !/^[a-f0-9]{64}$/i.test(verification.transcriptSha256)
        || !verification.sessionId || !uuid.test(verification.sessionId)
        || verification.exitCode !== 0
        || !verification.terminalAt || Number.isNaN(Date.parse(verification.terminalAt))
        || !Number.isInteger(verification.eventCount) || verification.eventCount! < 1) {
        diagnostics.push(error('WORKFLOW_TRANSCRIPT_INCOMPLETE', 'Strict workflow verification requires complete terminal transcript evidence.'));
      } else if (options.expectedSessionId
        && verification.sessionId.toLowerCase() !== options.expectedSessionId.toLowerCase()) {
        diagnostics.push(error('WORKFLOW_SESSION_MISMATCH', `Verified session ${verification.sessionId} does not match configured session ${options.expectedSessionId}.`));
      } else {
        const now = (options.now ?? (() => new Date()))().getTime();
        const terminalTime = Date.parse(verification.terminalAt);
        if (options.maxFutureSkewSeconds !== undefined
          && terminalTime > now + options.maxFutureSkewSeconds * 1000) {
          diagnostics.push(error('WORKFLOW_TRANSCRIPT_FUTURE', 'Verified workflow transcript is beyond the configured future clock skew.'));
        }
        if (options.maxAgeSeconds !== undefined && now - terminalTime > options.maxAgeSeconds * 1000) {
          diagnostics.push(error('WORKFLOW_TRANSCRIPT_EXPIRED', 'Verified workflow transcript is older than the configured maximum age.'));
        }
      }
    }
    if (workflow.verification.eventsSha256 !== eventsSha256(workflow.events)) {
      diagnostics.push(error('WORKFLOW_VERIFICATION_STALE', 'Workflow declarations changed after Skill invocation verification.'));
    }
    const duplicateCalls = workflow.verification.invocations
      .filter((invocation, index, all) => all.findIndex((candidate) => candidate.toolCallId === invocation.toolCallId) !== index);
    for (const duplicate of duplicateCalls) {
      diagnostics.push(error('WORKFLOW_INVOCATION_REUSED', `Tool call ${duplicate.toolCallId} appears more than once in invocation evidence.`));
    }
    const used = new Set<string>();
    let previousIndex = -1;
    for (const event of workflow.events.filter((candidate) => candidate.status === 'completed')) {
      const recordedAt = timestampMs(event.recordedAt);
      const eligible = workflow.verification.invocations
        .map((invocation, index) => ({ invocation, index }))
        .filter(({ invocation }) => invocation.skill === event.skill && timestampMs(invocation.invokedAt) <= recordedAt);
      const match = eligible.find(({ invocation, index }) =>
        !used.has(invocation.toolCallId)
        && index > previousIndex
        && invocation.status === 'completed'
        && !!invocation.completedAt
        && timestampMs(invocation.completedAt) <= recordedAt);
      if (!match) {
        if (eligible.some(({ invocation }) => invocation.status === 'incomplete')) {
          diagnostics.push(error('WORKFLOW_INVOCATION_INCOMPLETE', `${event.skill}:${event.phase} only has an incomplete Skill invocation.`));
        } else if (eligible.some(({ invocation }) => invocation.status === 'failed')) {
          diagnostics.push(error('WORKFLOW_INVOCATION_FAILED', `${event.skill}:${event.phase} only has a failed Skill invocation.`));
        } else if (eligible.some(({ invocation }) => used.has(invocation.toolCallId))) {
          diagnostics.push(error('WORKFLOW_INVOCATION_REUSED', `${event.skill}:${event.phase} would reuse an invocation already bound to another declaration.`));
        } else if (eligible.some(({ index }) => index <= previousIndex)) {
          diagnostics.push(error('WORKFLOW_INVOCATION_ORDER', `${event.skill}:${event.phase} would bind Skill invocations out of declaration order.`));
        } else {
          diagnostics.push(error(
            'WORKFLOW_SKILL_NOT_INVOKED',
            `${event.skill}:${event.phase} has no matching earlier completed Copilot Skill invocation.`,
          ));
        }
      } else {
        used.add(match.invocation.toolCallId);
        previousIndex = match.index;
      }
      if (!match) {
        diagnostics.push(error(
          'WORKFLOW_BINDING_MISSING',
          `${event.skill}:${event.phase} is not one-to-one bound to completed invocation evidence.`,
        ));
      }
    }
  }
  return {
    present: true,
    verified: !diagnostics.length,
    events: workflow.events.length,
    skills: new Set(workflow.events.map((event) => event.skill)).size,
    diagnostics,
  };
}
