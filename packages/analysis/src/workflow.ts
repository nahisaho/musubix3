import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { error, type Diagnostic } from '../../domain/src/index.js';
import { canonicalJson } from './change-waiver.js';
import { defaultConfig, loadConfig, type WorkflowConfig } from './config.js';
import { digest, exists, safePath, writeJson } from './files.js';
import { assertEvidenceOutputUnprotected, withEvidenceWriterLock } from './evidence-writer-lock.js';
import {
  WORKFLOW_WAIVABLE_CODES, WORKFLOW_WAIVER_PATH, authoritativeIndex, buildWorkflowWaiverContext,
  computeWorkflowBindings, createWorkflowReconciliationPass,
  deriveWorkflowWaiverAudit, loadWorkflowWaiverEvidence, payloadShaOf, resolveEvent,
  scopeKey, scopeLabel, snapshotHashFor, waiverChainValid, waiverLinkage, waiverRecordShapeValid, waivedWorkflowDiagnostic,
  snapshotVersionFor, waiverSnapshotState,
  type LoadedWorkflowWaiverEvidence, type WorkflowWaivableCode, type WorkflowWaiverContext, type WorkflowWaiverRecord,
  linkageReason,
} from './workflow-waiver.js';
import {
  loadWorkflow, workflowReconciliationLimits, workflowVerificationLimits,
  type PersistingWorkflowVerificationOptions, type WorkflowEvent,
  type WorkflowInvocationSource, type WorkflowLedgerInvocation, type WorkflowManifest,
  type WorkflowReconciliation, type WorkflowSanitizationResult, type WorkflowVerificationOptions,
  type WorkflowVerificationResult, type WorkflowReconciliationInstrumentation,
} from './workflow-types.js';

export * from './workflow-types.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const starts = new Set(['tool.execution_start', 'tool.execution_started', 'tool_use']);
const completes = new Set(['tool.execution_complete', 'tool.execution_completed', 'tool_result']);

function timestampMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function compareUnicodeScalar(left: string, right: string): number {
  const a = [...left].map((character) => character.codePointAt(0)!);
  const b = [...right].map((character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

function eventsSha256(events: WorkflowEvent[]): string {
  return digest(JSON.stringify(events));
}

function sourceKey(source: WorkflowInvocationSource): string {
  return canonicalJson([
    source.mode,
    source.sessionId ?? '',
    source.transcriptSha256 ?? '',
    source.sourceSha256,
  ]);
}

function compareSources(left: WorkflowInvocationSource, right: WorkflowInvocationSource): number {
  return compareUnicodeScalar(left.mode, right.mode)
    || compareUnicodeScalar(left.sessionId ?? '', right.sessionId ?? '')
    || compareUnicodeScalar(left.transcriptSha256 ?? '', right.transcriptSha256 ?? '')
    || compareUnicodeScalar(left.sourceSha256, right.sourceSha256);
}

function canonicalInvocations(invocations: WorkflowLedgerInvocation[]): WorkflowLedgerInvocation[] {
  return invocations
    .map((invocation) => ({
      ...invocation,
      sources: [...invocation.sources].sort(compareSources),
    }))
    .sort((a, b) =>
      timestampMs(a.invokedAt) - timestampMs(b.invokedAt)
      || timestampMs(a.completedAt ?? '') - timestampMs(b.completedAt ?? '')
      || compareUnicodeScalar(a.skill, b.skill)
      || compareUnicodeScalar(a.toolCallId, b.toolCallId));
}

function reconciliationIdentityError(invocations: WorkflowLedgerInvocation[]): string | undefined {
  const toolCallIds = new Set<string>();
  for (const invocation of invocations) {
    if (toolCallIds.has(invocation.toolCallId)
      || new Set(invocation.sources.map(sourceKey)).size !== invocation.sources.length) {
      return 'Workflow reconciliation contains duplicate identities.';
    }
    toolCallIds.add(invocation.toolCallId);
  }
  if (canonicalJson(invocations) !== canonicalJson(canonicalInvocations(invocations))) {
    return 'Workflow reconciliation is not canonically ordered.';
  }
  return undefined;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function reconciliationShapeValid(workflow: WorkflowManifest, reconciliation: WorkflowReconciliation): boolean {
  const record = reconciliation as unknown as Record<string, unknown>;
  if (!exactKeys(
    record,
    ['schemaVersion', 'mode', 'skewMs', 'ledgerSha256', 'bindingsSha256', 'invocations', 'bindings'],
    ['expectedSessionId'],
  )) return false;
  if (reconciliation.expectedSessionId !== undefined
    && (!uuid.test(reconciliation.expectedSessionId) || reconciliation.expectedSessionId !== reconciliation.expectedSessionId.toLowerCase())) {
    return false;
  }
  const invocationShapeValid = reconciliation.invocations.every((invocation) => {
    if (!invocation || typeof invocation !== 'object' || Array.isArray(invocation)) return false;
    const candidate = invocation as unknown as Record<string, unknown>;
    if (!exactKeys(candidate, ['skill', 'toolCallId', 'invokedAt', 'status', 'sources'], ['completedAt'])
      || typeof invocation.skill !== 'string' || !invocation.skill
      || typeof invocation.toolCallId !== 'string' || !invocation.toolCallId
      || !validTimestamp(invocation.invokedAt)
      || !['completed', 'failed', 'incomplete'].includes(invocation.status)
      || (invocation.status === 'incomplete'
        ? invocation.completedAt !== undefined
        : !validTimestamp(invocation.completedAt))
      || !Array.isArray(invocation.sources) || invocation.sources.length === 0) {
      return false;
    }
    return invocation.sources.every((source) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
      const sourceRecord = source as unknown as Record<string, unknown>;
      const strict = source.mode === 'strict';
      return exactKeys(
        sourceRecord,
        strict ? ['mode', 'sourceSha256', 'sessionId', 'transcriptSha256'] : ['mode', 'sourceSha256'],
      )
        && ['compatible', 'strict'].includes(source.mode)
        && /^[a-f0-9]{64}$/.test(source.sourceSha256)
        && (!strict || (
          typeof source.sessionId === 'string'
          && uuid.test(source.sessionId)
          && source.sessionId === source.sessionId.toLowerCase()
          && typeof source.transcriptSha256 === 'string'
          && /^[a-f0-9]{64}$/.test(source.transcriptSha256)
        ));
    });
  });
  if (!invocationShapeValid) return false;
  const invocationIds = new Set(reconciliation.invocations.map((invocation) => invocation.toolCallId));
  const boundEvents = new Set<number>();
  const boundInvocations = new Set<string>();
  let previousEventIndex = -1;
  return reconciliation.bindings.every((binding) => {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return false;
    const candidate = binding as unknown as Record<string, unknown>;
    const event = workflow.events[binding.eventIndex];
    const valid = exactKeys(candidate, ['eventIndex', 'skill', 'phase', 'recordedAt', 'toolCallId'])
      && Number.isSafeInteger(binding.eventIndex)
      && binding.eventIndex > previousEventIndex
      && event?.status === 'completed'
      && binding.skill === event.skill
      && binding.phase === event.phase
      && binding.recordedAt === event.recordedAt
      && invocationIds.has(binding.toolCallId)
      && !boundEvents.has(binding.eventIndex)
      && !boundInvocations.has(binding.toolCallId);
    if (valid) {
      previousEventIndex = binding.eventIndex;
      boundEvents.add(binding.eventIndex);
      boundInvocations.add(binding.toolCallId);
    }
    return valid;
  });
}

/** @id CODE-WORKFLOW-RESUMED-SESSION-DURABILITY-001
 * @implements REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-002 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004
 * @design DES-WORKFLOW-RESUMED-SESSION-DURABILITY-001 DES-WORKFLOW-RESUMED-SESSION-DURABILITY-002 DES-WORKFLOW-RESUMED-SESSION-DURABILITY-003
 */
function mergeReconciliation(
  workflow: WorkflowManifest,
  options: WorkflowVerificationOptions,
  config: WorkflowConfig,
  resetLedger = false,
  sourceByToolCall?: Map<string, string>,
): WorkflowReconciliation {
  const verification = workflow.verification!;
  const previous = resetLedger ? undefined : workflow.reconciliation;
  const byId = new Map<string, WorkflowLedgerInvocation>();
  for (const invocation of previous?.invocations ?? []) {
    byId.set(invocation.toolCallId, { ...invocation, sources: [...invocation.sources] });
  }
  for (const invocation of verification.invocations) {
    const source: WorkflowInvocationSource = {
      mode: options.mode,
      sourceSha256: sourceByToolCall?.get(invocation.toolCallId) ?? verification.sourceSha256,
      ...(options.mode === 'strict' ? {
        sessionId: verification.sessionId!,
        transcriptSha256: verification.transcriptSha256!,
      } : {}),
    };
    const existing = byId.get(invocation.toolCallId);
    if (!existing) {
      byId.set(invocation.toolCallId, { ...invocation, sources: [source] });
      continue;
    }
    if (existing.skill !== invocation.skill || existing.invokedAt !== invocation.invokedAt) {
      throw new Error(`WORKFLOW_INVOCATION_CONFLICT: ${invocation.toolCallId} has conflicting invocation identity.`);
    }
    if (existing.status !== invocation.status) {
      if (existing.status === 'incomplete' && invocation.status !== 'incomplete') {
        existing.status = invocation.status;
        if (invocation.completedAt !== undefined) existing.completedAt = invocation.completedAt;
      } else if (invocation.status !== 'incomplete') {
        throw new Error(`WORKFLOW_INVOCATION_CONFLICT: ${invocation.toolCallId} has conflicting terminal evidence.`);
      }
    } else if (existing.completedAt !== invocation.completedAt) {
      throw new Error(`WORKFLOW_INVOCATION_CONFLICT: ${invocation.toolCallId} has conflicting completion evidence.`);
    }
    if (!existing.sources.some((candidate) => sourceKey(candidate) === sourceKey(source))) existing.sources.push(source);
  }
  const invocations = canonicalInvocations([...byId.values()]);
  const mode = previous?.mode === 'strict' || options.mode === 'strict' ? 'strict' : 'compatible';
  const configuredSessionId = config.expectedSessionId?.toLowerCase();
  const expectedSessionId = previous?.expectedSessionId ?? configuredSessionId;
  const skewMs = config.maxEventSkewMs ?? 0;
  const bindings = computeWorkflowBindings(workflow, invocations, mode, expectedSessionId, skewMs);
  const reconciliation: WorkflowReconciliation = {
    schemaVersion: 1,
    mode,
    ...(expectedSessionId ? { expectedSessionId } : {}),
    skewMs,
    ledgerSha256: digest(canonicalJson(invocations)),
    bindingsSha256: digest(canonicalJson(bindings)),
    invocations,
    bindings,
  };
  const sourceCount = invocations.reduce((sum, invocation) => sum + invocation.sources.length, 0);
  if (invocations.length > workflowReconciliationLimits.maxInvocations
    || sourceCount > workflowReconciliationLimits.maxSources
    || Buffer.byteLength(canonicalJson(reconciliation)) > workflowReconciliationLimits.maxBytes) {
    throw new Error('WORKFLOW_RECONCILIATION_LIMIT: durable workflow reconciliation exceeds configured limits.');
  }
  return reconciliation;
}

function reconciliationDiagnostic(
  workflow: WorkflowManifest,
  config: WorkflowConfig,
): Diagnostic | undefined {
  if (!Object.prototype.hasOwnProperty.call(workflow, 'reconciliation')) return undefined;
  const value = workflow.reconciliation as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return error('WORKFLOW_RECONCILIATION_MALFORMED', 'Workflow reconciliation is malformed.', '.musubix/evidence/workflow.json');
  }
  const reconciliation = value as WorkflowReconciliation;
  const sourceCount = Array.isArray(reconciliation.invocations)
    ? reconciliation.invocations.reduce((sum, invocation) =>
        sum + (Array.isArray(invocation?.sources) ? invocation.sources.length : 0), 0)
    : 0;
  if (!Array.isArray(reconciliation.invocations) || !Array.isArray(reconciliation.bindings)
    || reconciliation.schemaVersion !== 1
    || !['compatible', 'strict'].includes(reconciliation.mode)
    || !Number.isSafeInteger(reconciliation.skewMs) || reconciliation.skewMs < 0
    || !reconciliationShapeValid(workflow, reconciliation)
    || reconciliation.ledgerSha256 !== digest(canonicalJson(reconciliation.invocations))
    || reconciliation.bindingsSha256 !== digest(canonicalJson(reconciliation.bindings))) {
    return error('WORKFLOW_RECONCILIATION_MALFORMED', 'Workflow reconciliation is malformed.', '.musubix/evidence/workflow.json');
  }
  const identityError = reconciliationIdentityError(reconciliation.invocations);
  if (identityError) {
    return error('WORKFLOW_RECONCILIATION_MALFORMED', identityError, '.musubix/evidence/workflow.json');
  }
  if (reconciliation.invocations.length > workflowReconciliationLimits.maxInvocations
    || sourceCount > workflowReconciliationLimits.maxSources
    || Buffer.byteLength(canonicalJson(reconciliation)) > workflowReconciliationLimits.maxBytes) {
    return error('WORKFLOW_RECONCILIATION_LIMIT', 'Workflow reconciliation exceeds durable limits.', '.musubix/evidence/workflow.json');
  }
  if ((config.maxEventSkewMs ?? 0) !== reconciliation.skewMs
    || (config.mode === 'strict' && reconciliation.mode !== 'strict')
    || (config.expectedSessionId
      && reconciliation.expectedSessionId?.toLowerCase() !== config.expectedSessionId.toLowerCase())) {
    return error('WORKFLOW_RECONCILIATION_CONFIG_MISMATCH', 'Workflow reconciliation does not match current config.', '.musubix/evidence/workflow.json');
  }
  if (workflow.verification && workflow.verification.eventsSha256 === eventsSha256(workflow.events)) {
    const recomputedBindings = computeWorkflowBindings(
      workflow,
      reconciliation.invocations,
      reconciliation.mode,
      reconciliation.expectedSessionId,
      reconciliation.skewMs,
    );
    if (canonicalJson(recomputedBindings) !== canonicalJson(reconciliation.bindings)) {
      return error('WORKFLOW_RECONCILIATION_MALFORMED', 'Workflow reconciliation bindings are not reproducible.', '.musubix/evidence/workflow.json');
    }
  }
  return undefined;
}

/** @id CODE-WORKFLOW-RESUMED-SESSION-DURABILITY-002
 * @implements REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-005
 * @design DES-WORKFLOW-RESUMED-SESSION-DURABILITY-005
 */
async function planWorkflowWaiverMigration(
  root: string,
  workflow: WorkflowManifest,
  config: WorkflowConfig,
): Promise<{
  evidence?: { schemaVersion: 1; waivers: unknown[] };
  warnings: Array<{ code: 'WORKFLOW_WAIVER_MIGRATION_SKIPPED'; message: string }>;
}> {
  const loaded = await loadWorkflowWaiverEvidence(root);
  if (!loaded) return { warnings: [] };
  if (loaded.malformed || loaded.waivers.some((record, index) =>
    !waiverRecordShapeValid(record) || !waiverChainValid(loaded.waivers, index))) {
    return {
      warnings: [{
        code: 'WORKFLOW_WAIVER_MIGRATION_SKIPPED',
        message: 'Workflow reconciliation committed, but malformed waiver evidence prevented migration; migration remains pending.',
      }],
    };
  }
  const validated = await validateLoadedWorkflow(root, workflow, config, config, loaded);
  const context = validated.workflowWaiverContext;
  if (context.suppressed) {
    return {
      warnings: [{
        code: 'WORKFLOW_WAIVER_MIGRATION_SKIPPED',
        message: 'Workflow reconciliation committed, but suppressed waiver classification prevented migration; migration remains pending.',
      }],
    };
  }
  const successors: WorkflowWaiverRecord[] = [];
  let previous = loaded.waivers.at(-1) as WorkflowWaiverRecord | undefined;
  for (let index = 0; index < loaded.waivers.length; index += 1) {
    const record = loaded.waivers[index] as WorkflowWaiverRecord;
    if (record.snapshotVersion !== 1 || !context.linkage[index]?.valid) continue;
    if (authoritativeIndex(context, record.skill, record.phase, record.declarationRecordedAt, record.index) !== index) continue;
    const code = context.currentCode?.[index] ?? null;
    if (code !== null && code !== record.code) continue;
    const draft: WorkflowWaiverRecord = {
      ...record,
      sequence: (previous?.sequence ?? 0) + 1,
      snapshotVersion: 2,
      snapshotHash: '',
      previousSha256: previous?.payloadSha256 ?? '0'.repeat(64),
      payloadSha256: '',
    };
    const withoutPayload = {
      ...draft,
      snapshotHash: snapshotHashFor(workflow, validated.diagnostics, draft, context.reconciliationPass),
    };
    const successor = { ...withoutPayload, payloadSha256: payloadShaOf(withoutPayload) };
    successors.push(successor);
    previous = successor;
  }
  return successors.length
    ? { evidence: { schemaVersion: 1, waivers: [...loaded.waivers, ...successors] }, warnings: [] }
    : { warnings: [] };
}

async function resolvePersistingOptions(
  root: string,
  options: PersistingWorkflowVerificationOptions | undefined,
): Promise<{ verification: WorkflowVerificationOptions; reconciliationConfig: WorkflowConfig; resetLedger: boolean }> {
  const configPath = await safePath(root, '.musubix/config.json');
  const hasConfig = await exists(configPath);
  const configured = hasConfig ? (await loadConfig(root)).workflow : { mode: 'compatible' as const };
  if (configured.mode === 'strict' && options?.mode === 'compatible') {
    throw new Error('WORKFLOW_RECONCILIATION_CONFIG_MISMATCH: strict workflow config cannot be weakened.');
  }
  if (hasConfig && options?.maxEventSkewMs !== undefined
    && options.maxEventSkewMs !== (configured.maxEventSkewMs ?? 0)) {
    throw new Error('WORKFLOW_RECONCILIATION_CONFIG_MISMATCH: supplied workflow skew differs from config.');
  }
  if (options?.expectedSessionId && configured.expectedSessionId
    && options.expectedSessionId.toLowerCase() !== configured.expectedSessionId.toLowerCase()) {
    throw new Error('WORKFLOW_RECONCILIATION_CONFIG_MISMATCH: supplied session does not match configured session.');
  }
  if (options?.resetLedger && !options.confirmReset) {
    throw new Error('WORKFLOW_RECONCILIATION_RESET_CONFIRMATION_REQUIRED: --reset-ledger requires --confirm.');
  }
  const resetLedger = options?.resetLedger === true;
  const persisted = resetLedger ? undefined : (await loadWorkflow(root))?.reconciliation;
  const configuredSessionId = configured.expectedSessionId?.toLowerCase();
  const persistedSessionId = persisted?.expectedSessionId?.toLowerCase();
  if (configuredSessionId && persistedSessionId && configuredSessionId !== persistedSessionId) {
    throw new Error('WORKFLOW_RECONCILIATION_CONFIG_MISMATCH: configured session differs from the persisted session; --reset-ledger --confirm is required to replace it.');
  }
  const effectiveSessionId = configuredSessionId ?? persistedSessionId;
  if (options?.expectedSessionId && effectiveSessionId
    && options.expectedSessionId.toLowerCase() !== effectiveSessionId) {
    throw new Error('WORKFLOW_RECONCILIATION_CONFIG_MISMATCH: supplied session does not match the configured or persisted session.');
  }
  const mode = options?.mode === 'strict' || options?.expectedSessionId ? 'strict' : configured.mode;
  return {
    verification: {
      ...configured,
      ...options,
      mode,
      ...(options?.expectedSessionId ?? effectiveSessionId
        ? { expectedSessionId: (options?.expectedSessionId ?? effectiveSessionId)! }
        : {}),
    },
    reconciliationConfig: {
      ...configured,
      ...(configuredSessionId ? { expectedSessionId: configuredSessionId } : {}),
    },
    resetLedger,
  };
}

export async function recordWorkflow(
  root: string,
  event: Omit<WorkflowEvent, 'version' | 'recordedAt' | 'commandSha256'> & { command?: string },
): Promise<WorkflowManifest> {
  return withEvidenceWriterLock(root, 'workflow-record', () => recordWorkflowUnlocked(root, event));
}

async function recordWorkflowUnlocked(
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
  options?: PersistingWorkflowVerificationOptions,
): Promise<WorkflowVerificationResult> {
  return withEvidenceWriterLock(root, 'workflow-verify', async () => {
    const resolved = await resolvePersistingOptions(root, options);
    return (
    await verifyWorkflowChunks(root, (async function* () {
      yield Buffer.from(logText);
    })(), resolved.verification, true, resolved.resetLedger, undefined, resolved.reconciliationConfig) as WorkflowVerificationResult);
  });
}

/* @id CODE-WORKFLOW-MULTI-SESSION-001
 * @implements REQ-WORKFLOW-MULTI-SESSION-001
 * @design DES-WORKFLOW-MULTI-SESSION-001
 */
export async function verifyWorkflowLogFile(
  root: string,
  path: string | string[],
  options?: PersistingWorkflowVerificationOptions,
): Promise<WorkflowVerificationResult> {
  return withEvidenceWriterLock(root, 'workflow-verify', async () => {
    const resolved = await resolvePersistingOptions(root, options);
    return await verifyWorkflowLogFileUnlocked(
      root,
      path,
      resolved.verification,
      true,
      resolved.resetLedger,
      resolved.reconciliationConfig,
    ) as WorkflowVerificationResult;
  });
}

async function workflowFileMetadata(
  path: string,
  maxBytes: number,
  maxLineBytes: number,
  maxEvents: number,
): Promise<{ sourceSha256: string; sourceBytes: number; eventCount: number; earliestTimestamp: number; toolCallIds: string[] }> {
  const sourceHash = createHash('sha256');
  const toolCallIds: string[] = [];
  let sourceBytes = 0;
  let eventCount = 0;
  let earliestTimestamp = Number.POSITIVE_INFINITY;
  let lineParts: Buffer[] = [];
  let lineBytes = 0;
  let lineNumber = 1;
  const inspectLine = (bytes: Buffer): void => {
    if (!bytes.length) return;
    let event: unknown;
    try { event = JSON.parse(bytes.toString('utf8')) as unknown; } catch { return; }
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    eventCount += 1;
    if (eventCount > maxEvents) {
      throw new Error(`Workflow transcript exceeds the maximum event count of ${maxEvents}.`);
    }
    const record = event as Record<string, unknown>;
    const data = record.data && typeof record.data === 'object'
      ? record.data as Record<string, unknown>
      : record;
    const timestampValue = record.timestamp ?? data.timestamp;
    const time = typeof timestampValue === 'string' ? Date.parse(timestampValue) : NaN;
    if (!Number.isNaN(time) && time < earliestTimestamp) earliestTimestamp = time;
    const toolCallId = data.toolCallId ?? data.callId ?? record.toolCallId;
    if (starts.has(String(record.type ?? '')) && typeof toolCallId === 'string') toolCallIds.push(toolCallId);
  };
  for await (const value of createReadStream(path)) {
    const chunk = Buffer.from(value);
    sourceBytes += chunk.byteLength;
    if (sourceBytes > maxBytes) {
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
      if (part.byteLength) lineParts.push(part);
      inspectLine(Buffer.concat(lineParts, lineBytes));
      lineParts = [];
      lineBytes = 0;
      lineNumber += 1;
      start = index + 1;
    }
    const remainder = chunk.subarray(start);
    lineBytes += remainder.byteLength;
    if (lineBytes > maxLineBytes) {
      throw new Error(`Workflow transcript line ${lineNumber} exceeds the maximum size of ${maxLineBytes} bytes; raise workflow.maxTranscriptLineBytes in .musubix/config.json and protect it in the policy baseline.`);
    }
    if (remainder.byteLength) lineParts.push(remainder);
  }
  inspectLine(Buffer.concat(lineParts, lineBytes));
  return { sourceSha256: sourceHash.digest('hex'), sourceBytes, eventCount, earliestTimestamp, toolCallIds };
}

async function verifyWorkflowLogFileUnlocked(
  root: string,
  path: string | string[],
  options: WorkflowVerificationOptions,
  persist = true,
  resetLedger = false,
  reconciliationConfig?: WorkflowConfig,
): Promise<WorkflowManifest | WorkflowVerificationResult> {
  const paths = Array.isArray(path) ? path : [path];
  if (!paths.length) throw new Error('Workflow verification requires at least one transcript file.');
  if (paths.length > 1 && options.mode === 'strict') {
    throw new Error('Strict workflow verification requires exactly one transcript file.');
  }
  let orderedPaths = paths;
  const sourceByToolCall = new Map<string, string>();
  const metadataByPath = new Map<string, Awaited<ReturnType<typeof workflowFileMetadata>>>();
  const maxBytes = options.maxTranscriptBytes ?? options.maxBytes ?? workflowVerificationLimits.maxBytes;
  const maxLineBytes = options.maxTranscriptLineBytes ?? options.maxLineBytes ?? workflowVerificationLimits.maxLineBytes;
  const maxEvents = options.maxEvents ?? workflowVerificationLimits.maxEvents;
  let metadataBytes = 0;
  let metadataEvents = 0;
  for (const filePath of paths) {
    const metadata = await workflowFileMetadata(filePath, maxBytes, maxLineBytes, maxEvents);
    metadataBytes += metadata.sourceBytes;
    metadataEvents += metadata.eventCount;
    if (metadataBytes > maxBytes) {
      throw new Error(`Workflow transcript exceeds the maximum total size of ${maxBytes} bytes; raise workflow.maxTranscriptBytes in .musubix/config.json and protect it in the policy baseline.`);
    }
    if (metadataEvents > maxEvents) {
      throw new Error(`Workflow transcript exceeds the maximum event count of ${maxEvents}.`);
    }
    metadataByPath.set(filePath, metadata);
    for (const toolCallId of metadata.toolCallIds) sourceByToolCall.set(toolCallId, metadata.sourceSha256);
  }
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
    for (const filePath of paths) {
      for (const toolCallId of metadataByPath.get(filePath)!.toolCallIds) {
        const previousFile = seenInFile.get(toolCallId);
        if (previousFile !== undefined && previousFile !== filePath) {
          throw new Error(`Tool call ${toolCallId} appears in more than one workflow transcript file.`);
        }
        seenInFile.set(toolCallId, filePath);
      }
    }
    orderedPaths = paths
      .map((filePath) => ({ filePath, time: metadataByPath.get(filePath)!.earliestTimestamp }))
      .sort((a, b) => (a.time - b.time)
        || compareUnicodeScalar(resolvePath(a.filePath), resolvePath(b.filePath)))
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
  })(), options, persist, resetLedger, sourceByToolCall, reconciliationConfig);
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
  const validated = await verifyWorkflowLogFileUnlocked(root, inputPath, {
    mode: 'strict',
    ...(maxEventSkewMs === undefined ? {} : { maxEventSkewMs }),
    ...(maxTranscriptBytes === undefined ? {} : { maxBytes: maxTranscriptBytes }),
    ...(maxTranscriptLineBytes === undefined ? {} : { maxLineBytes: maxTranscriptLineBytes }),
  }, false);
  const expectedSourceSha256 = 'workflow' in validated
    ? validated.workflow.verification!.sourceSha256
    : validated.verification!.sourceSha256;
  const maxBytes = maxTranscriptBytes ?? workflowVerificationLimits.maxBytes;
  const maxLineBytes = maxTranscriptLineBytes ?? workflowVerificationLimits.maxLineBytes;
  const target = await safePath(root, outputPath);
  await assertEvidenceOutputUnprotected(root, target);
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
  persist = true,
  resetLedger = false,
  sourceByToolCall?: Map<string, string>,
  reconciliationConfig: WorkflowConfig = options,
): Promise<WorkflowManifest | WorkflowVerificationResult> {
  const current = persist
    ? await loadWorkflow(root)
    : await (async (): Promise<WorkflowManifest | null> => {
        const path = await safePath(root, '.musubix/evidence/workflow.json');
        return await exists(path) ? JSON.parse(await readFile(path, 'utf8')) as WorkflowManifest : null;
      })();
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
    transcriptHash.update(parsedCount === 1 ? canonicalJson(record) : `,${canonicalJson(record)}`);
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
  if (!persist) return current;
  current.reconciliation = mergeReconciliation(current, options, reconciliationConfig, resetLedger, sourceByToolCall);
  const migration = await planWorkflowWaiverMigration(root, current, reconciliationConfig);
  await writeJson(root, '.musubix/evidence/workflow.json', current);
  if (migration.evidence) {
    try {
      await writeJson(root, WORKFLOW_WAIVER_PATH, migration.evidence);
    } catch (cause) {
      throw new Error('WORKFLOW_WAIVER_MIGRATION_WRITE_FAILED: workflow reconciliation committed and waiver migration remains pending.', { cause });
    }
  }
  return Object.assign(Object.create(current) as WorkflowManifest, {
    workflow: current,
    warnings: migration.warnings,
  });
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
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-001 REQ-WORKFLOW-EVIDENCE-WAIVER-009 REQ-WORKFLOW-EVIDENCE-WAIVER-010 REQ-WORKFLOW-EVIDENCE-WAIVER-012 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-005
 */
export async function validateLoadedWorkflow(
  root: string,
  workflow: WorkflowManifest | null,
  options: WorkflowVerificationOptions = { mode: 'compatible' },
  reconciliationConfigOrLoaded?: WorkflowConfig | LoadedWorkflowWaiverEvidence | null,
  preloadedWaiverEvidence?: LoadedWorkflowWaiverEvidence | null,
  instrumentation?: WorkflowReconciliationInstrumentation,
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
  const resolvedReconciliationConfig = reconciliationConfigOrLoaded
    && 'mode' in reconciliationConfigOrLoaded
    ? reconciliationConfigOrLoaded as WorkflowConfig
    : (await exists(await safePath(root, '.musubix/config.json'))
        ? (await loadConfig(root)).workflow
        : defaultConfig.workflow);
  const explicitlyLoaded = reconciliationConfigOrLoaded
    && !('mode' in reconciliationConfigOrLoaded)
    ? reconciliationConfigOrLoaded as LoadedWorkflowWaiverEvidence
    : preloadedWaiverEvidence;
  const reconciliationError = workflow ? reconciliationDiagnostic(workflow, resolvedReconciliationConfig) : undefined;
  const reconciliationPass = workflow?.reconciliation && !reconciliationError
    ? createWorkflowReconciliationPass(workflow, instrumentation)
    : undefined;
  if (reconciliationError) rawDiagnostics.push(reconciliationError);
  if (workflow?.events.length) {
    if (!workflow.verification) {
      rawDiagnostics.push(error('WORKFLOW_INVOCATION_UNVERIFIED', 'Workflow declarations have not been reconciled with a Copilot session log.'));
    } else if (!reconciliationError) {
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
      const evidenceInvocations = workflow.reconciliation?.invocations ?? workflow.verification.invocations;
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
        const deadline = recordedAt + (workflow.reconciliation?.skewMs ?? 0);
        const eligible = evidenceInvocations
          .map((invocation, index) => ({ invocation, index }))
          .filter(({ invocation }) =>
            invocation.skill === event.skill
            && timestampMs(invocation.invokedAt) <= deadline
            && (!workflow.reconciliation || workflow.reconciliation.mode !== 'strict'
              || !('sources' in invocation)
              || (invocation as WorkflowLedgerInvocation).sources.some((source: WorkflowInvocationSource) =>
                source.mode === 'strict'
                && (!workflow.reconciliation?.expectedSessionId
                  || source.sessionId?.toLowerCase() === workflow.reconciliation.expectedSessionId))));
        const match = eligible.find(({ invocation, index }) =>
          !used.has(invocation.toolCallId)
          && index > previousIndex
          && invocation.status === 'completed'
          && !!invocation.completedAt
          && timestampMs(invocation.completedAt) <= deadline);
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
  const loaded = explicitlyLoaded !== undefined ? explicitlyLoaded : await loadWorkflowWaiverEvidence(root);
  const workflowWaiverContext = buildWorkflowWaiverContext(loaded, workflow, rawDiagnostics, reconciliationPass);
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
  options?: WorkflowVerificationOptions,
  reconciliationConfig?: WorkflowConfig,
): Promise<{
  present: boolean;
  verified: boolean;
  events: number;
  skills: number;
  diagnostics: Diagnostic[];
  workflowWaiverContext: WorkflowWaiverContext;
}> {
  const workflow = await loadWorkflow(root);
  const config = await exists(await safePath(root, '.musubix/config.json'))
    ? await loadConfig(root)
    : defaultConfig;
  return validateLoadedWorkflow(
    root,
    workflow,
    options ?? config.workflow,
    reconciliationConfig ?? config.workflow,
  );
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

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-027
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-012 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-004
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-005
 */
function workflowReconciliationBlocker(diagnostics: Diagnostic[]): Diagnostic | undefined {
  return diagnostics.find((diagnostic) =>
    ['WORKFLOW_INVOCATION_UNVERIFIED', 'WORKFLOW_RECONCILIATION_MALFORMED', 'WORKFLOW_RECONCILIATION_LIMIT',
      'WORKFLOW_RECONCILIATION_CONFIG_MISMATCH'].includes(diagnostic.code));
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
  return withEvidenceWriterLock(root, 'workflow waiver record', () =>
    recordWorkflowWaiverUnlocked(root, code, skill, phase, recordedAt, index, approver, reason));
}

async function recordWorkflowWaiverUnlocked(
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
  const config = await exists(await safePath(root, '.musubix/config.json'))
    ? await loadConfig(root)
    : defaultConfig;
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
  const validated = await validateLoadedWorkflow(root, workflow, config.workflow, config.workflow, loaded);
  const reconciliationBlocker = workflowReconciliationBlocker(validated.diagnostics);
  if (reconciliationBlocker) {
    throw new Error(`${reconciliationBlocker.code}: run workflow-verify to repair workflow reconciliation before any declaration-scoped workflow diagnostic can be waived.`);
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
    if (waiverSnapshotState(context, activeIndex) === 'current') {
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
    snapshotVersion: snapshotVersionFor(workflow),
    snapshotHash: '',
    previousSha256,
    payloadSha256: '',
  };
  const snapshotHash = snapshotHashFor(
    workflow,
    validated.diagnostics,
    draftRecord,
    validated.workflowWaiverContext.reconciliationPass,
  );
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
  return withEvidenceWriterLock(root, 'workflow waiver record-all', () =>
    recordAllWorkflowWaiversUnlocked(root, approver, reason));
}

async function recordAllWorkflowWaiversUnlocked(
  root: string,
  approver: string,
  reason: string,
): Promise<{ recorded: number; waivers: Array<{ skill: string; phase: string; declarationRecordedAt: string; index?: number; code: string }> }> {
  const loaded = await loadWorkflowWaiverEvidence(root);
  if (loaded?.malformed) {
    throw new Error(`${WORKFLOW_WAIVER_PATH} is malformed; regenerate or repair it before recording a new waiver.`);
  }
  const workflow = await loadWorkflow(root);
  const config = await exists(await safePath(root, '.musubix/config.json'))
    ? await loadConfig(root)
    : defaultConfig;
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
  const validated = await validateLoadedWorkflow(root, workflow, config.workflow, config.workflow, loaded);
  const reconciliationBlocker = workflowReconciliationBlocker(validated.diagnostics);
  if (reconciliationBlocker) {
    throw new Error(`${reconciliationBlocker.code}: run workflow-verify to repair workflow reconciliation before any declaration-scoped workflow diagnostic can be waived.`);
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
      if (waiverSnapshotState(context, activeIndex) === 'current') continue;
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
    compareUnicodeScalar(a.skill, b.skill)
    || compareUnicodeScalar(a.phase, b.phase)
    || compareUnicodeScalar(a.declarationRecordedAt, b.declarationRecordedAt)
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
      snapshotVersion: snapshotVersionFor(workflow),
      snapshotHash: '',
      previousSha256,
      payloadSha256: '',
    };
    const snapshotHash = snapshotHashFor(
      workflow,
      validated.diagnostics,
      draftRecord,
      validated.workflowWaiverContext.reconciliationPass,
    );
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
