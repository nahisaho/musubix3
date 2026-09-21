import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { error, type Diagnostic } from '../../domain/src/index.js';
import { loadConfig } from './config.js';
import { digest, exists, safePath, writeJson } from './files.js';
import {
  CURRENT_SNAPSHOT_VERSION, WORKFLOW_WAIVABLE_CODES, WORKFLOW_WAIVER_PATH, authoritativeIndex, buildWorkflowWaiverContext,
  deriveWorkflowWaiverAudit, loadWorkflowWaiverEvidence, nonStale, payloadShaOf, resolveEvent,
  scopeKey, scopeLabel, snapshotHashFor, waiverChainValid, waiverLinkage, waiverRecordShapeValid, waivedWorkflowDiagnostic,
  type LoadedWorkflowWaiverEvidence, type WorkflowWaivableCode, type WorkflowWaiverContext, type WorkflowWaiverRecord,
  linkageReason,
} from './workflow-waiver.js';
import {
  loadWorkflow, workflowVerificationLimits,
  type WorkflowEvent, type WorkflowManifest, type WorkflowSanitizationResult, type WorkflowVerificationOptions,
} from './workflow-types.js';

export * from './workflow-types.js';

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
    version: '0.1.8',
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

/* @id CODE-WORKFLOW-MULTI-SESSION-001
 * @implements REQ-WORKFLOW-MULTI-SESSION-001
 * @design DES-WORKFLOW-MULTI-SESSION-001
 */
export async function verifyWorkflowLogFile(
  root: string,
  path: string | string[],
  options: WorkflowVerificationOptions = { mode: 'compatible' },
): Promise<WorkflowManifest> {
  const paths = Array.isArray(path) ? path : [path];
  if (!paths.length) throw new Error('Workflow verification requires at least one transcript file.');
  if (paths.length > 1 && options.mode === 'strict') {
    throw new Error('Strict workflow verification requires exactly one transcript file.');
  }
  let orderedPaths = paths;
  if (paths.length > 1) {
    // Multiple transcripts are concatenated into one logical stream below; a
    // toolCallId genuinely belongs to a single Copilot session, so seeing it
    // start in more than one supplied file indicates the files do not
    // represent disjoint sessions and must be rejected rather than silently
    // merged (REQ-WORKFLOW-MULTI-SESSION-001). While scanning for that, also
    // record each file's earliest event timestamp so files can be
    // concatenated in chronological session order regardless of how the
    // caller listed them, while still preserving each file's own internal
    // (possibly clock-skewed) source order untouched.
    const seenInFile = new Map<string, string>();
    const earliestTimestamp = new Map<string, number>();
    for (const filePath of paths) {
      const text = await readFile(filePath, 'utf-8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let event: unknown;
        try { event = JSON.parse(line) as unknown; } catch { continue; }
        if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
        const record = event as Record<string, unknown>;
        const data = record.data && typeof record.data === 'object'
          ? record.data as Record<string, unknown>
          : record;
        const type = String(record.type ?? '');
        const timestampValue = record.timestamp ?? data.timestamp;
        const time = typeof timestampValue === 'string' ? Date.parse(timestampValue) : NaN;
        if (!Number.isNaN(time)) {
          const current = earliestTimestamp.get(filePath);
          if (current === undefined || time < current) earliestTimestamp.set(filePath, time);
        }
        const toolCallId = data.toolCallId ?? data.callId ?? record.toolCallId;
        if (starts.has(type) && typeof toolCallId === 'string') {
          const previousFile = seenInFile.get(toolCallId);
          if (previousFile !== undefined && previousFile !== filePath) {
            throw new Error(`Tool call ${toolCallId} appears in more than one workflow transcript file.`);
          }
          seenInFile.set(toolCallId, filePath);
        }
      }
    }
    orderedPaths = paths
      .map((filePath, index) => ({ filePath, index, time: earliestTimestamp.get(filePath) ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => (a.time - b.time) || (a.index - b.index))
      .map(({ filePath }) => filePath);
  }
  return verifyWorkflowChunks(root, (async function* () {
    for (let index = 0; index < orderedPaths.length; index += 1) {
      let endedWithNewline = true;
      for await (const chunk of createReadStream(orderedPaths[index]!)) {
        endedWithNewline = chunk.at(-1) === 0x0a;
        yield chunk;
      }
      // Guarantee a line boundary between concatenated files even when a
      // transcript file does not end with a trailing newline. Only inserted
      // between files (never after the last) so a single-path call's byte
      // stream, and therefore its sourceSha256, is unchanged.
      if (index < orderedPaths.length - 1 && !endedWithNewline) yield Buffer.from('\n');
    }
  })(), options);
}

export async function sanitizeWorkflowLogFile(
  root: string,
  inputPath: string,
  outputPath: string,
  replacementSessionId?: string,
  maxEventSkewMs?: number,
  maxTranscriptBytes?: number,
  maxTranscriptLineBytes?: number,
): Promise<WorkflowSanitizationResult> {
  if (replacementSessionId && !uuid.test(replacementSessionId)) {
    throw new Error('Replacement workflow session ID must be a UUID.');
  }
  // Fail closed on the complete source before removing privacy-sensitive non-Skill events.
  const validated = await verifyWorkflowLogFile(root, inputPath, {
    mode: 'strict',
    ...(maxEventSkewMs === undefined ? {} : { maxEventSkewMs }),
    ...(maxTranscriptBytes === undefined ? {} : { maxBytes: maxTranscriptBytes }),
    ...(maxTranscriptLineBytes === undefined ? {} : { maxLineBytes: maxTranscriptLineBytes }),
  });
  const expectedSourceSha256 = validated.verification!.sourceSha256;
  const maxBytes = maxTranscriptBytes ?? workflowVerificationLimits.maxBytes;
  const maxLineBytes = maxTranscriptLineBytes ?? workflowVerificationLimits.maxLineBytes;
  const target = await safePath(root, outputPath);
  await mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.${crypto.randomUUID()}.writing`;
  const output = await open(staging, 'wx');
  const skillCalls = new Set<string>();
  let inputEvents = 0;
  let outputEvents = 0;
  let outputBytes = 0;
  let terminalSessionId = '';
  let sourceBytes = 0;
  const sourceHash = createHash('sha256');
  const emit = async (event: Record<string, unknown>): Promise<void> => {
    const line = JSON.stringify(event);
    const lineBytes = Buffer.byteLength(line);
    const recordBytes = lineBytes + 1;
    if (lineBytes > maxLineBytes) {
      throw new Error(`Sanitized workflow event exceeds the maximum line size of ${maxLineBytes} bytes.`);
    }
    if (outputBytes + recordBytes > maxBytes) {
      throw new Error(`Sanitized workflow transcript exceeds the maximum total size of ${maxBytes} bytes.`);
    }
    await output.write(`${line}\n`);
    outputBytes += recordBytes;
    outputEvents += 1;
  };
  const processSanitizedLine = async (bytes: Buffer): Promise<void> => {
      if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, -1);
      let line: string;
      try {
        line = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        throw new Error(`Workflow transcript line ${inputEvents + 1} must contain valid UTF-8 before sanitization.`);
      }
      if (!line.trim()) return;
      inputEvents += 1;
      if (inputEvents > workflowVerificationLimits.maxEvents) {
        throw new Error(`Workflow transcript exceeds the maximum event count of ${workflowVerificationLimits.maxEvents}.`);
      }
      if (Buffer.byteLength(line) > maxLineBytes) {
        throw new Error(`Workflow transcript line ${inputEvents} exceeds the maximum size of ${maxLineBytes} bytes; raise workflow.maxTranscriptLineBytes in .musubix/config.json and protect it in the policy baseline.`);
      }
      let event: unknown;
      try {
        event = JSON.parse(line) as unknown;
      } catch {
        throw new Error(`Workflow transcript line ${inputEvents} must contain valid JSON before sanitization.`);
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) return;
      const record = event as Record<string, unknown>;
      const data = record.data && typeof record.data === 'object'
        ? record.data as Record<string, unknown>
        : record;
      const type = String(record.type ?? '');
      const timestamp = typeof (record.timestamp ?? data.timestamp) === 'string'
        ? String(record.timestamp ?? data.timestamp)
        : '';
      const toolCallId = data.toolCallId ?? data.callId ?? record.toolCallId;
      if (starts.has(type)) {
        let args: Record<string, unknown> = {};
        if (data.arguments && typeof data.arguments === 'object') args = data.arguments as Record<string, unknown>;
        else if (typeof data.arguments === 'string') {
          try { args = JSON.parse(data.arguments) as Record<string, unknown>; } catch { args = {}; }
        } else if (data.input && typeof data.input === 'object') args = data.input as Record<string, unknown>;
        const toolName = data.toolName ?? data.name ?? record.toolName;
        if (toolName === 'skill' && typeof toolCallId === 'string' && typeof args.skill === 'string') {
          skillCalls.add(toolCallId);
          await emit({
            type: 'tool.execution_start',
            timestamp,
            data: { toolCallId, toolName: 'skill', arguments: { skill: args.skill } },
          });
        }
      } else if (completes.has(type) && typeof toolCallId === 'string' && skillCalls.has(toolCallId)) {
        const success = data.success ?? record.success;
        if (typeof success !== 'boolean') {
          throw new Error(`Skill tool completion ${toolCallId} must declare boolean success before sanitization.`);
        }
        await emit({
          type: 'tool.execution_complete',
          timestamp,
          data: { toolCallId, success },
        });
      } else if (type === 'session.start') {
        const sessionId = data.sessionId ?? record.sessionId;
        if (typeof sessionId !== 'string' || !uuid.test(sessionId)) {
          throw new Error('The workflow session start must declare a UUID sessionId before sanitization.');
        }
        terminalSessionId = replacementSessionId ?? sessionId;
        await emit({
          type: 'session.start',
          timestamp,
          data: { sessionId: terminalSessionId },
        });
      } else if (type === 'session.shutdown') {
        const sessionId = data.sessionId ?? record.sessionId;
        await emit({
          type: 'session.shutdown',
          timestamp,
          data: {
            shutdownType: data.shutdownType,
            ...(typeof sessionId === 'string'
              ? { sessionId: replacementSessionId ?? sessionId }
              : {}),
          },
        });
      } else if (type === 'session.resume') {
        const sessionId = data.sessionId ?? record.sessionId;
        await emit({
          type: 'session.resume',
          timestamp,
          ...(typeof sessionId === 'string'
            ? { data: { sessionId: replacementSessionId ?? sessionId } }
            : {}),
        });
      } else if (type === 'result') {
        const sessionId = record.sessionId;
        if (typeof sessionId !== 'string' || !uuid.test(sessionId)) {
          throw new Error('The terminal workflow result must declare a UUID sessionId before sanitization.');
        }
        terminalSessionId = replacementSessionId ?? sessionId;
        await emit({
          type: 'result',
          timestamp,
          sessionId: terminalSessionId,
          exitCode: record.exitCode,
        });
      }
  };
  try {
    let lineParts: Buffer[] = [];
    let lineBytes = 0;
    for await (const value of createReadStream(inputPath)) {
      const chunk = Buffer.from(value);
      sourceBytes += chunk.byteLength;
      if (sourceBytes > maxBytes) throw new Error(`Workflow transcript exceeds the maximum total size of ${maxBytes} bytes; raise workflow.maxTranscriptBytes in .musubix/config.json and protect it in the policy baseline.`);
      sourceHash.update(chunk);
      let start = 0;
      for (let index = chunk.indexOf(0x0a); index !== -1; index = chunk.indexOf(0x0a, start)) {
        const part = chunk.subarray(start, index);
        lineBytes += part.byteLength;
        if (lineBytes > maxLineBytes) {
          throw new Error(`Workflow transcript line ${inputEvents + 1} exceeds the maximum size of ${maxLineBytes} bytes; raise workflow.maxTranscriptLineBytes in .musubix/config.json and protect it in the policy baseline.`);
        }
        if (part.byteLength) lineParts.push(part);
        await processSanitizedLine(Buffer.concat(lineParts, lineBytes));
        lineParts = [];
        lineBytes = 0;
        start = index + 1;
      }
      const remainder = chunk.subarray(start);
      lineBytes += remainder.byteLength;
      if (lineBytes > maxLineBytes) {
        throw new Error(`Workflow transcript line ${inputEvents + 1} exceeds the maximum size of ${maxLineBytes} bytes; raise workflow.maxTranscriptLineBytes in .musubix/config.json and protect it in the policy baseline.`);
      }
      if (remainder.byteLength) lineParts.push(remainder);
    }
    await processSanitizedLine(Buffer.concat(lineParts, lineBytes));
    if (sourceHash.digest('hex') !== expectedSourceSha256) {
      throw new Error('Workflow transcript changed after strict validation; retry sanitization with a stable source file.');
    }
    if (!skillCalls.size) throw new Error('No Copilot Skill invocation events were found in the workflow transcript.');
    if (!terminalSessionId) throw new Error('No workflow session identity was found in the transcript.');
    await output.close();
    await rename(staging, target);
  } finally {
    await output.close().catch(() => undefined);
    if (await exists(staging)) await unlink(staging);
  }
  return {
    inputEvents,
    outputEvents,
    skillInvocations: skillCalls.size,
    sessionId: terminalSessionId,
    sessionReplaced: replacementSessionId !== undefined,
    outputPath,
  };
}

/* @id CODE-WORKFLOW-SHUTDOWN-001
 * @implements REQ-WORKFLOW-SHUTDOWN-001
 */
async function verifyWorkflowChunks(
  root: string,
  chunks: AsyncIterable<Uint8Array>,
  options: WorkflowVerificationOptions,
): Promise<WorkflowManifest> {
  const current = await loadWorkflow(root);
  if (!current?.events.length) throw new Error('No workflow declarations are available to verify.');
  if (!['compatible', 'strict'].includes(options.mode)) throw new Error('Workflow verification mode must be compatible or strict.');
  if (options.expectedSessionId && !uuid.test(options.expectedSessionId)) throw new Error('Expected workflow session ID must be a UUID.');
  const maxBytes = options.maxTranscriptBytes ?? options.maxBytes ?? workflowVerificationLimits.maxBytes;
  const maxLineBytes = options.maxTranscriptLineBytes ?? options.maxLineBytes ?? workflowVerificationLimits.maxLineBytes;
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
  let maximumLineBytes = 0;
  let parsedCount = 0;
  let resultCount = 0;
  let shutdownCount = 0;
  let sessionStartCount = 0;
  let lastParsedWasTerminal = false;
  let terminalRecord: Record<string, unknown> | undefined;
  const sessionIds = new Set<string>();
  let lifecycleState: 'before-start' | 'active' | 'awaiting-resume' = 'before-start';
  let lifecycleError: string | undefined;
  let shutdownTypeError = false;
  let lifecycleIdentityError: string | undefined;
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
    const data = record.data && typeof record.data === 'object'
      ? record.data as Record<string, unknown>
      : record;
    const type = String(record.type ?? '');
    const isResult = type === 'result';
    const isShutdown = type === 'session.shutdown';
    lastParsedWasTerminal = isResult || isShutdown;
    if (isResult) {
      resultCount += 1;
      terminalRecord = record;
    }
    if (isShutdown) {
      shutdownCount += 1;
      terminalRecord = record;
    }
    if (type === 'session.start' || type === 'session.resume' || isShutdown) {
      const lifecycleSessionId = data.sessionId ?? record.sessionId;
      if (lifecycleSessionId !== undefined) {
        if (typeof lifecycleSessionId !== 'string' || !uuid.test(lifecycleSessionId)) {
          lifecycleIdentityError ??= `The ${type} event must declare a UUID sessionId when present.`;
        } else {
          sessionIds.add(lifecycleSessionId.toLowerCase());
        }
      }
    }
    if (type === 'session.start') {
      sessionStartCount += 1;
      if (lifecycleState !== 'before-start' || sessionStartCount > 1) {
        lifecycleError ??= 'A routine shutdown lifecycle requires exactly one session start.';
      } else {
        lifecycleState = 'active';
      }
    } else if (type === 'session.resume') {
      if (lifecycleState !== 'awaiting-resume') {
        lifecycleError ??= 'A session resume must immediately follow a non-final routine shutdown.';
      } else {
        lifecycleState = 'active';
      }
    } else if (isShutdown) {
      if (data.shutdownType !== 'routine') shutdownTypeError = true;
      if (lifecycleState === 'before-start') {
        lifecycleError ??= 'A session shutdown cannot occur before the session start.';
      } else if (lifecycleState === 'awaiting-resume') {
        lifecycleError ??= 'Every non-final session shutdown must be immediately followed by session.resume.';
      }
      lifecycleState = 'awaiting-resume';
    } else if (lifecycleState === 'awaiting-resume') {
      lifecycleError ??= 'Every non-final session shutdown must be immediately followed by session.resume.';
    }
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
          || (options.maxEventSkewMs !== undefined
            && Date.parse(start.timestamp) - time > options.maxEventSkewMs)) {
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
      throw new Error(`Workflow transcript exceeds the maximum total size of ${maxBytes} bytes; raise workflow.maxTranscriptBytes in .musubix/config.json and protect it in the policy baseline.`);
    }
    sourceHash.update(chunk);
    let start = 0;
    for (let index = chunk.indexOf(0x0a); index !== -1; index = chunk.indexOf(0x0a, start)) {
      const part = chunk.subarray(start, index);
      lineBytes += part.byteLength;
      if (lineBytes > maxLineBytes) {
        throw new Error(`Workflow transcript line ${lineNumber} exceeds the maximum size of ${maxLineBytes} bytes; raise workflow.maxTranscriptLineBytes in .musubix/config.json and protect it in the policy baseline.`);
      }
      maximumLineBytes = Math.max(maximumLineBytes, lineBytes);
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
      throw new Error(`Workflow transcript line ${lineNumber} exceeds the maximum size of ${maxLineBytes} bytes; raise workflow.maxTranscriptLineBytes in .musubix/config.json and protect it in the policy baseline.`);
    }
    if (remainder.byteLength) lineParts.push(remainder);
  }
  maximumLineBytes = Math.max(maximumLineBytes, lineBytes);
  processLine(Buffer.concat(lineParts, lineBytes), lineNumber);
  transcriptHash.update(']');
  if (options.mode === 'strict' && !parsedCount) throw new Error('Strict workflow verification requires a complete Copilot JSONL transcript.');

  let terminal: { timestamp: string; sessionId: string; exitCode: number } | undefined;
  if (options.mode === 'strict') {
    if (resultCount > 1 || (resultCount > 0 && shutdownCount > 0) || (resultCount === 0 && shutdownCount === 0)) {
      throw new Error('Strict workflow verification requires exactly one terminal result format or a routine shutdown lifecycle.');
    }
    if (!lastParsedWasTerminal) {
      throw new Error(resultCount === 1
        ? 'The terminal result event must be the final JSONL event.'
        : 'The terminal session shutdown must be the final JSONL event.');
    }
    const timestamp = terminalRecord!.timestamp;
    const terminalData = terminalRecord!.data && typeof terminalRecord!.data === 'object'
      ? terminalRecord!.data as Record<string, unknown>
      : terminalRecord!;
    let sessionId: unknown;
    let exitCode: unknown;
    if (resultCount === 1) {
      sessionId = terminalRecord!.sessionId;
      exitCode = terminalRecord!.exitCode;
    } else {
      if (shutdownTypeError || terminalData.shutdownType !== 'routine') {
        throw new Error('Every session shutdown must declare shutdownType routine.');
      }
      if (lifecycleError) throw new Error(lifecycleError);
      if (lifecycleIdentityError) throw new Error(lifecycleIdentityError);
      if (sessionStartCount !== 1 || sessionIds.size !== 1) {
        throw new Error('A routine session shutdown requires exactly one session UUID.');
      }
      [sessionId] = sessionIds;
      const shutdownSessionId = terminalData.sessionId ?? terminalRecord!.sessionId;
      if (shutdownSessionId !== undefined
        && (typeof shutdownSessionId !== 'string' || shutdownSessionId.toLowerCase() !== sessionId)) {
        throw new Error('The terminal session shutdown identity does not match the session start.');
      }
      exitCode = 0;
    }
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))
      || (options.maxEventSkewMs !== undefined
        && lastToolTimestamp - Date.parse(timestamp) > options.maxEventSkewMs)) {
      throw new Error(resultCount === 1
        ? 'The terminal result event violates event timestamp order.'
        : 'The terminal session shutdown violates event timestamp order.');
    }
    if (typeof sessionId !== 'string' || !uuid.test(sessionId)) {
      throw new Error(resultCount === 1
        ? 'The terminal result event must declare a UUID sessionId.'
        : 'The terminal session shutdown must resolve to a UUID sessionId.');
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
    .map((start) => ({ ...start, ...(completions.get(start.toolCallId) ?? { status: 'incomplete' as const }) }));
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
      sourceBytes: totalBytes,
      maxTranscriptBytes: maxBytes,
      maximumLineBytes,
      maxTranscriptLineBytes: maxLineBytes,
    } : {}),
    eventsSha256: eventsSha256(current.events),
    verifiedAt: (options.now ?? (() => new Date()))().toISOString(),
    invocations,
  };
  await writeJson(root, '.musubix/evidence/workflow.json', current);
  return current;
}

function declarationScope(workflow: WorkflowManifest, event: WorkflowEvent, eventIndex: number): Pick<Diagnostic, 'skill' | 'phase' | 'declarationRecordedAt' | 'index'> {
  const collisions = workflow.events.flatMap((candidate, candidateIndex) =>
    candidate.status === 'completed'
    && candidate.skill === event.skill
    && candidate.phase === event.phase
    && candidate.recordedAt === event.recordedAt
      ? [candidateIndex]
      : []);
  return {
    skill: event.skill,
    phase: event.phase,
    declarationRecordedAt: event.recordedAt,
    ...(collisions.length >= 2 ? { index: eventIndex } : {}),
  };
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-018
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-001 REQ-WORKFLOW-EVIDENCE-WAIVER-009 REQ-WORKFLOW-EVIDENCE-WAIVER-010 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-005
 */
export async function validateLoadedWorkflow(
  root: string,
  workflow: WorkflowManifest | null,
  options: WorkflowVerificationOptions = { mode: 'compatible' },
  preloadedWaiverEvidence?: LoadedWorkflowWaiverEvidence | null,
): Promise<{
  present: boolean;
  verified: boolean;
  events: number;
  skills: number;
  diagnostics: Diagnostic[];
  workflowWaiverContext: WorkflowWaiverContext;
}> {
  const present = !!workflow?.events.length;
  const rawDiagnostics: Diagnostic[] = [];
  if (workflow?.events.length) {
    if (!workflow.verification) {
      rawDiagnostics.push(error('WORKFLOW_INVOCATION_UNVERIFIED', 'Workflow declarations have not been reconciled with a Copilot session log.'));
    } else {
      if (options.mode === 'strict') {
        const verification = workflow.verification;
        if (verification.mode !== 'strict'
          || !verification.transcriptSha256 || !/^[a-f0-9]{64}$/i.test(verification.transcriptSha256)
          || !verification.sessionId || !uuid.test(verification.sessionId)
          || verification.exitCode !== 0
          || !verification.terminalAt || Number.isNaN(Date.parse(verification.terminalAt))
          || !Number.isInteger(verification.eventCount) || verification.eventCount! < 1
          || !Number.isSafeInteger(verification.sourceBytes) || verification.sourceBytes! < 1
          || !Number.isSafeInteger(verification.maxTranscriptBytes) || verification.maxTranscriptBytes! < 1
          || !Number.isSafeInteger(verification.maximumLineBytes) || verification.maximumLineBytes! < 1
          || !Number.isSafeInteger(verification.maxTranscriptLineBytes) || verification.maxTranscriptLineBytes! < 1) {
          rawDiagnostics.push(error('WORKFLOW_TRANSCRIPT_INCOMPLETE', 'Strict workflow verification requires complete terminal transcript evidence.'));
        } else if (verification.sourceBytes! > verification.maxTranscriptBytes!
          || verification.sourceBytes! > (options.maxTranscriptBytes ?? workflowVerificationLimits.maxBytes)
          || verification.maxTranscriptBytes! > (options.maxTranscriptBytes ?? workflowVerificationLimits.maxBytes)
          || verification.maximumLineBytes! > verification.maxTranscriptLineBytes!
          || verification.maximumLineBytes! > (options.maxTranscriptLineBytes ?? options.maxLineBytes ?? workflowVerificationLimits.maxLineBytes)
          || verification.maxTranscriptLineBytes! > (options.maxTranscriptLineBytes ?? options.maxLineBytes ?? workflowVerificationLimits.maxLineBytes)) {
          rawDiagnostics.push(error('WORKFLOW_TRANSCRIPT_SIZE', 'Verified workflow transcript exceeds the configured maximum transcript size.'));
        } else if (options.expectedSessionId
          && verification.sessionId.toLowerCase() !== options.expectedSessionId.toLowerCase()) {
          rawDiagnostics.push(error('WORKFLOW_SESSION_MISMATCH', `Verified session ${verification.sessionId} does not match configured session ${options.expectedSessionId}.`));
        } else {
          const now = (options.now ?? (() => new Date()))().getTime();
          const terminalTime = Date.parse(verification.terminalAt);
          if (options.maxFutureSkewSeconds !== undefined
            && terminalTime > now + options.maxFutureSkewSeconds * 1000) {
            rawDiagnostics.push(error('WORKFLOW_TRANSCRIPT_FUTURE', 'Verified workflow transcript is beyond the configured future clock skew.'));
          }
          if (options.maxAgeSeconds !== undefined && now - terminalTime > options.maxAgeSeconds * 1000) {
            rawDiagnostics.push(error('WORKFLOW_TRANSCRIPT_EXPIRED', 'Verified workflow transcript is older than the configured maximum age.'));
          }
        }
      }
      if (workflow.verification.eventsSha256 !== eventsSha256(workflow.events)) {
        rawDiagnostics.push(error('WORKFLOW_VERIFICATION_STALE', 'Workflow declarations changed after Skill invocation verification.'));
      }
      const duplicateCalls = workflow.verification.invocations
        .filter((invocation, index, all) => all.findIndex((candidate) => candidate.toolCallId === invocation.toolCallId) !== index);
      for (const duplicate of duplicateCalls) {
        rawDiagnostics.push(error('WORKFLOW_INVOCATION_REUSED', `Tool call ${duplicate.toolCallId} appears more than once in invocation evidence.`));
      }
      const used = new Set<string>();
      let previousIndex = -1;
      for (const [eventIndex, event] of workflow.events.entries()) {
        if (event.status !== 'completed') continue;
        const scope = declarationScope(workflow, event, eventIndex);
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
            rawDiagnostics.push({
              ...error('WORKFLOW_INVOCATION_INCOMPLETE', `${event.skill}:${event.phase} only has an incomplete Skill invocation.`),
              ...scope,
            });
          } else if (eligible.some(({ invocation }) => invocation.status === 'failed')) {
            rawDiagnostics.push({
              ...error('WORKFLOW_INVOCATION_FAILED', `${event.skill}:${event.phase} only has a failed Skill invocation.`),
              ...scope,
            });
          } else if (eligible.some(({ invocation }) => used.has(invocation.toolCallId))) {
            rawDiagnostics.push({
              ...error('WORKFLOW_INVOCATION_REUSED', `${event.skill}:${event.phase} would reuse an invocation already bound to another declaration.`),
              ...scope,
            });
          } else if (eligible.some(({ index }) => index <= previousIndex)) {
            rawDiagnostics.push({
              ...error('WORKFLOW_INVOCATION_ORDER', `${event.skill}:${event.phase} would bind Skill invocations out of declaration order.`),
              ...scope,
            });
          } else {
            rawDiagnostics.push({
              ...error('WORKFLOW_SKILL_NOT_INVOKED', `${event.skill}:${event.phase} has no matching earlier completed Copilot Skill invocation.`),
              ...scope,
            });
          }
        } else {
          used.add(match.invocation.toolCallId);
          previousIndex = match.index;
        }
        if (!match) {
          rawDiagnostics.push({
            ...error('WORKFLOW_BINDING_MISSING', `${event.skill}:${event.phase} is not one-to-one bound to completed invocation evidence.`),
            ...scope,
          });
        }
      }
    }
  }
  const loaded = preloadedWaiverEvidence !== undefined ? preloadedWaiverEvidence : await loadWorkflowWaiverEvidence(root);
  const workflowWaiverContext = buildWorkflowWaiverContext(loaded, workflow, rawDiagnostics);
  const diagnostics = rawDiagnostics.map((diagnostic) => waivedWorkflowDiagnostic(workflowWaiverContext, diagnostic));
  return {
    present,
    verified: !diagnostics.length,
    events: workflow?.events.length ?? 0,
    skills: new Set((workflow?.events ?? []).map((event) => event.skill)).size,
    diagnostics,
    workflowWaiverContext,
  };
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-019
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-009 REQ-WORKFLOW-EVIDENCE-WAIVER-010 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-005
 */
export async function validateWorkflow(
  root: string,
  options: WorkflowVerificationOptions = { mode: 'compatible' },
): Promise<{
  present: boolean;
  verified: boolean;
  events: number;
  skills: number;
  diagnostics: Diagnostic[];
  workflowWaiverContext: WorkflowWaiverContext;
}> {
  const workflow = await loadWorkflow(root);
  return validateLoadedWorkflow(root, workflow, options);
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-015
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-014
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-007
 */
export async function activeWorkflowWaivers(root: string): Promise<ReturnType<typeof deriveWorkflowWaiverAudit>['workflowWaivers']> {
  const workflow = await validateWorkflow(root);
  return deriveWorkflowWaiverAudit(workflow.workflowWaiverContext).workflowWaivers;
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-016
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-008 REQ-WORKFLOW-EVIDENCE-WAIVER-012
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-007
 */
export async function workflowWaiverEvidenceDiagnostics(root: string): Promise<Diagnostic[]> {
  const workflow = await validateWorkflow(root);
  return deriveWorkflowWaiverAudit(workflow.workflowWaiverContext).workflowWaiverDiagnostics;
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-017
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-001 REQ-WORKFLOW-EVIDENCE-WAIVER-002 REQ-WORKFLOW-EVIDENCE-WAIVER-003 REQ-WORKFLOW-EVIDENCE-WAIVER-004 REQ-WORKFLOW-EVIDENCE-WAIVER-005 REQ-WORKFLOW-EVIDENCE-WAIVER-006 REQ-WORKFLOW-EVIDENCE-WAIVER-011 REQ-WORKFLOW-EVIDENCE-WAIVER-013 REQ-WORKFLOW-EVIDENCE-WAIVER-017
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-006
 */
export async function recordWorkflowWaiver(
  root: string,
  code: string,
  skill: string,
  phase: string,
  recordedAt: string,
  index: number | undefined,
  approver: string,
  reason: string,
): Promise<{ recorded: boolean; skill: string; phase: string; declarationRecordedAt: string; index?: number; code: string }> {
  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new Error(`${recordedAt} is not a valid --recorded-at timestamp.`);
  }
  const loaded = await loadWorkflowWaiverEvidence(root);
  if (loaded?.malformed) {
    throw new Error(`${WORKFLOW_WAIVER_PATH} is malformed; regenerate or repair it before recording a new waiver.`);
  }
  const workflow = await loadWorkflow(root);
  const config = await loadConfig(root);
  const existing = loaded ?? { schemaVersion: 1 as const, waivers: [] as unknown[] };
  for (let recordIndex = 0; recordIndex < existing.waivers.length; recordIndex += 1) {
    const current = existing.waivers[recordIndex];
    if (!waiverRecordShapeValid(current)
      || !waiverChainValid(existing.waivers, recordIndex)
      || !waiverLinkage(workflow, existing.waivers, recordIndex).valid) {
      throw new Error(`Existing workflow waiver at waivers[${recordIndex}] is invalid; repair the evidence chain before recording a new waiver.`);
    }
  }
  if (!(WORKFLOW_WAIVABLE_CODES as readonly string[]).includes(code)) {
    throw new Error(`${code} is not a waivable code. Allowed codes: ${WORKFLOW_WAIVABLE_CODES.join(', ')}.`);
  }
  if (!approver.trim() || !reason.trim()) throw new Error('A non-empty --approver and --reason are required.');
  const validated = await validateLoadedWorkflow(root, workflow, config.workflow, loaded);
  if (validated.diagnostics.some((diagnostic) => diagnostic.code === 'WORKFLOW_INVOCATION_UNVERIFIED')) {
    throw new Error('workflow-verify must be (re-)run before any declaration-scoped workflow diagnostic can be waived.');
  }
  if (!resolveEvent(workflow, skill, phase, recordedAt, index)) {
    throw new Error(linkageReason(workflow, skill, phase, recordedAt, index));
  }
  const diagnosticScope = { skill, phase, declarationRecordedAt: recordedAt, ...(index === undefined ? {} : { index }) };
  const matchingDiagnostic = validated.diagnostics.find((diagnostic) =>
    diagnostic.code === code
    && diagnostic.skill === diagnosticScope.skill
    && diagnostic.phase === diagnosticScope.phase
    && diagnostic.declarationRecordedAt === diagnosticScope.declarationRecordedAt
    && diagnostic.index === diagnosticScope.index);
  if (!matchingDiagnostic) {
    throw new Error(`No matching ${code} diagnostic is currently reported for ${scopeLabel(skill, phase, recordedAt, index)}.`);
  }
  const context = validated.workflowWaiverContext;
  const activeIndex = authoritativeIndex(context, skill, phase, recordedAt, index);
  if (activeIndex !== -1 && !context.loaded?.malformed && waiverRecordShapeValid(context.loaded!.waivers[activeIndex])) {
    const activeRecord = context.loaded!.waivers[activeIndex];
    if (nonStale(activeRecord, activeIndex, context)) {
      throw new Error(`${scopeLabel(skill, phase, recordedAt, index)} already has an active waiver.`);
    }
  }
  const previous = existing.waivers.at(-1);
  const nextSequence = previous && waiverRecordShapeValid(previous) ? previous.sequence + 1 : 1;
  const previousSha256 = previous && waiverRecordShapeValid(previous) ? previous.payloadSha256 : '0'.repeat(64);
  const waiverRecordedAt = new Date().toISOString();
  const draftRecord: WorkflowWaiverRecord = {
    skill,
    phase,
    declarationRecordedAt: recordedAt,
    ...(index === undefined ? {} : { index }),
    code: code as WorkflowWaivableCode,
    approver,
    reason,
    waiverRecordedAt,
    sequence: nextSequence,
    snapshotVersion: CURRENT_SNAPSHOT_VERSION,
    snapshotHash: '',
    previousSha256,
    payloadSha256: '',
  };
  const snapshotHash = snapshotHashFor(workflow, validated.diagnostics, draftRecord);
  const withoutPayloadSha: Omit<WorkflowWaiverRecord, 'payloadSha256'> = {
    ...draftRecord,
    snapshotHash,
  };
  const record: WorkflowWaiverRecord = {
    ...withoutPayloadSha,
    payloadSha256: payloadShaOf(withoutPayloadSha),
  };
  await writeJson(root, WORKFLOW_WAIVER_PATH, {
    schemaVersion: 1,
    waivers: [...existing.waivers, record],
  });
  return {
    recorded: true,
    skill,
    phase,
    declarationRecordedAt: recordedAt,
    ...(index === undefined ? {} : { index }),
    code,
  };
}

/** @id CODE-WORKFLOW-WAIVER-BULK-001
 * @implements REQ-WORKFLOW-WAIVER-BULK-001 REQ-WORKFLOW-WAIVER-BULK-002 REQ-WORKFLOW-WAIVER-BULK-003
 * @design DES-WORKFLOW-WAIVER-BULK-001
 */
export async function recordAllWorkflowWaivers(
  root: string,
  approver: string,
  reason: string,
): Promise<{ recorded: number; waivers: Array<{ skill: string; phase: string; declarationRecordedAt: string; index?: number; code: string }> }> {
  const loaded = await loadWorkflowWaiverEvidence(root);
  if (loaded?.malformed) {
    throw new Error(`${WORKFLOW_WAIVER_PATH} is malformed; regenerate or repair it before recording a new waiver.`);
  }
  const workflow = await loadWorkflow(root);
  const config = await loadConfig(root);
  const existing = loaded ?? { schemaVersion: 1 as const, waivers: [] as unknown[] };
  for (let recordIndex = 0; recordIndex < existing.waivers.length; recordIndex += 1) {
    const current = existing.waivers[recordIndex];
    if (!waiverRecordShapeValid(current)
      || !waiverChainValid(existing.waivers, recordIndex)
      || !waiverLinkage(workflow, existing.waivers, recordIndex).valid) {
      throw new Error(`Existing workflow waiver at waivers[${recordIndex}] is invalid; repair the evidence chain before recording a new waiver.`);
    }
  }
  if (!approver.trim() || !reason.trim()) throw new Error('A non-empty --approver and --reason are required.');
  const validated = await validateLoadedWorkflow(root, workflow, config.workflow, loaded);
  if (validated.diagnostics.some((diagnostic) => diagnostic.code === 'WORKFLOW_INVOCATION_UNVERIFIED')) {
    throw new Error('workflow-verify must be (re-)run before any declaration-scoped workflow diagnostic can be waived.');
  }
  const context = validated.workflowWaiverContext;
  const seen = new Set<string>();
  const candidates: Array<{ skill: string; phase: string; declarationRecordedAt: string; index?: number; code: WorkflowWaivableCode }> = [];
  for (const diagnostic of validated.diagnostics) {
    if (!(WORKFLOW_WAIVABLE_CODES as readonly string[]).includes(diagnostic.code)) continue;
    if (!diagnostic.skill || !diagnostic.phase || !diagnostic.declarationRecordedAt) continue;
    const key = scopeKey(diagnostic.skill, diagnostic.phase, diagnostic.declarationRecordedAt, diagnostic.index);
    if (seen.has(key)) continue;
    seen.add(key);
    const activeIndex = authoritativeIndex(context, diagnostic.skill, diagnostic.phase, diagnostic.declarationRecordedAt, diagnostic.index);
    if (activeIndex !== -1 && !context.loaded?.malformed && waiverRecordShapeValid(context.loaded!.waivers[activeIndex])) {
      const activeRecord = context.loaded!.waivers[activeIndex];
      if (nonStale(activeRecord, activeIndex, context)) continue;
    }
    candidates.push({
      skill: diagnostic.skill,
      phase: diagnostic.phase,
      declarationRecordedAt: diagnostic.declarationRecordedAt,
      ...(diagnostic.index === undefined ? {} : { index: diagnostic.index }),
      code: diagnostic.code as WorkflowWaivableCode,
    });
  }
  candidates.sort((a, b) =>
    a.skill.localeCompare(b.skill)
    || a.phase.localeCompare(b.phase)
    || a.declarationRecordedAt.localeCompare(b.declarationRecordedAt)
    || (a.index ?? -1) - (b.index ?? -1));
  if (candidates.length === 0) return { recorded: 0, waivers: [] };
  const tail = existing.waivers.at(-1);
  let nextSequence = tail && waiverRecordShapeValid(tail) ? tail.sequence + 1 : 1;
  let previousSha256 = tail && waiverRecordShapeValid(tail) ? tail.payloadSha256 : '0'.repeat(64);
  const newRecords: WorkflowWaiverRecord[] = [];
  for (const candidate of candidates) {
    const waiverRecordedAt = new Date().toISOString();
    const draftRecord: WorkflowWaiverRecord = {
      skill: candidate.skill,
      phase: candidate.phase,
      declarationRecordedAt: candidate.declarationRecordedAt,
      ...(candidate.index === undefined ? {} : { index: candidate.index }),
      code: candidate.code,
      approver,
      reason,
      waiverRecordedAt,
      sequence: nextSequence,
      snapshotVersion: CURRENT_SNAPSHOT_VERSION,
      snapshotHash: '',
      previousSha256,
      payloadSha256: '',
    };
    const snapshotHash = snapshotHashFor(workflow, validated.diagnostics, draftRecord);
    const withoutPayloadSha: Omit<WorkflowWaiverRecord, 'payloadSha256'> = { ...draftRecord, snapshotHash };
    const record: WorkflowWaiverRecord = { ...withoutPayloadSha, payloadSha256: payloadShaOf(withoutPayloadSha) };
    newRecords.push(record);
    nextSequence += 1;
    previousSha256 = record.payloadSha256;
  }
  await writeJson(root, WORKFLOW_WAIVER_PATH, {
    schemaVersion: 1,
    waivers: [...existing.waivers, ...newRecords],
  });
  return {
    recorded: newRecords.length,
    waivers: newRecords.map((record) => ({
      skill: record.skill,
      phase: record.phase,
      declarationRecordedAt: record.declarationRecordedAt,
      ...(record.index === undefined ? {} : { index: record.index }),
      code: record.code,
    })),
  };
}
