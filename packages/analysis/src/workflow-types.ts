import type { WorkflowConfig } from './config.js';
import { digest, exists, readText, within } from './files.js';

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

export interface WorkflowInvocationSource {
  mode: 'compatible' | 'strict';
  sourceSha256: string;
  sessionId?: string;
  transcriptSha256?: string;
}

export interface WorkflowLedgerInvocation {
  skill: string;
  toolCallId: string;
  invokedAt: string;
  completedAt?: string;
  status: 'completed' | 'failed' | 'incomplete';
  sources: WorkflowInvocationSource[];
}

export interface WorkflowDeclarationBinding {
  eventIndex: number;
  skill: string;
  phase: string;
  recordedAt: string;
  toolCallId: string;
}

export interface WorkflowReconciliation {
  schemaVersion: 1;
  mode: 'compatible' | 'strict';
  expectedSessionId?: string;
  skewMs: number;
  ledgerSha256: string;
  bindingsSha256: string;
  invocations: WorkflowLedgerInvocation[];
  bindings: WorkflowDeclarationBinding[];
}

export interface WorkflowManifest {
  schemaVersion: 1;
  events: WorkflowEvent[];
  reconciliation?: WorkflowReconciliation;
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
    sourceBytes?: number;
    maxTranscriptBytes?: number;
    maximumLineBytes?: number;
    maxTranscriptLineBytes?: number;
    invocations: Array<{
      skill: string;
      toolCallId: string;
      invokedAt: string;
      completedAt?: string;
      status: 'completed' | 'failed' | 'incomplete';
    }>;
  };
}

export interface PersistingWorkflowVerificationOptions extends Partial<WorkflowVerificationOptions> {
  resetLedger?: boolean;
  confirmReset?: boolean;
}

export interface WorkflowVerificationWarning {
  code: 'WORKFLOW_WAIVER_MIGRATION_SKIPPED';
  message: string;
}

export type WorkflowReconciliationInstrumentation = (operation: string) => void;

export type WorkflowVerificationResult = {
  workflow: WorkflowManifest;
  warnings: WorkflowVerificationWarning[];
} & WorkflowManifest;

/** @id CODE-WORKFLOW-RESUMED-SESSION-DURABILITY-012
 * @implements REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-001 REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-007
 * @design DES-WORKFLOW-RESUMED-SESSION-DURABILITY-001 DES-WORKFLOW-RESUMED-SESSION-DURABILITY-007
 */
export const workflowReconciliationLimits = {
  maxInvocations: 10_000,
  maxSources: 50_000,
  maxBytes: 16_777_216,
} as const;

export interface WorkflowVerificationOptions extends WorkflowConfig {
  now?: () => Date;
  maxBytes?: number;
  maxLineBytes?: number;
  maxEvents?: number;
}

export interface WorkflowSanitizationResult {
  inputEvents: number;
  outputEvents: number;
  skillInvocations: number;
  sessionId: string;
  sessionReplaced: boolean;
  outputPath: string;
}

export const workflowVerificationLimits = {
  maxBytes: 100_000_000,
  maxLineBytes: 1_000_000,
  maxEvents: 1_000_000,
} as const;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** @id CODE-WORKFLOW-RESUMED-SESSION-DURABILITY-011
 * @implements REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-006
 * @design DES-WORKFLOW-RESUMED-SESSION-DURABILITY-006
 */
function canonicalReconciliationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalReconciliationJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalReconciliationJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** @id CODE-WORKFLOW-RESUMED-SESSION-DURABILITY-004
 * @implements REQ-WORKFLOW-RESUMED-SESSION-DURABILITY-006 REQ-ATTESTATION-EVIDENCE-STABILITY-004
 * @design DES-WORKFLOW-RESUMED-SESSION-DURABILITY-006 DES-ATTESTATION-EVIDENCE-STABILITY-004
 */
export function workflowEvidenceHead(workflow: WorkflowManifest | null | undefined): string | null {
  const verification = workflow?.verification;
  if (workflow && Object.prototype.hasOwnProperty.call(workflow, 'reconciliation')) {
    const value = workflow.reconciliation as unknown;
    const candidate = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const reconciliation = {
      schemaVersion: candidate.schemaVersion === 1 ? 1 : null,
      mode: candidate.mode === 'compatible' || candidate.mode === 'strict' ? candidate.mode : null,
      skewMs: typeof candidate.skewMs === 'number' ? candidate.skewMs : null,
      ledgerSha256: typeof candidate.ledgerSha256 === 'string' ? candidate.ledgerSha256 : null,
      bindingsSha256: typeof candidate.bindingsSha256 === 'string' ? candidate.bindingsSha256 : null,
      ...(typeof candidate.expectedSessionId === 'string' ? { expectedSessionId: candidate.expectedSessionId } : {}),
    };
    const verificationProjection = !verification
      ? null
      : !verification.mode && !verification.transcriptSha256 && !verification.sessionId
        ? { eventsSha256: verification.eventsSha256, sourceSha256: verification.sourceSha256 }
        : {
            eventsSha256: verification.eventsSha256,
            sourceSha256: verification.sourceSha256,
            transcriptSha256: verification.transcriptSha256 ?? null,
            mode: verification.mode ?? 'compatible',
            sessionId: verification.sessionId ?? null,
            exitCode: verification.exitCode ?? null,
            terminalAt: verification.terminalAt ?? null,
            eventCount: verification.eventCount ?? null,
            sourceBytes: verification.sourceBytes ?? null,
            maxTranscriptBytes: verification.maxTranscriptBytes ?? null,
            maximumLineBytes: verification.maximumLineBytes ?? null,
            maxTranscriptLineBytes: verification.maxTranscriptLineBytes ?? null,
            invocations: verification.invocations,
          };
    return digest(canonicalReconciliationJson({ verification: verificationProjection, reconciliation }));
  }
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
    sourceBytes: verification.sourceBytes ?? null,
    maxTranscriptBytes: verification.maxTranscriptBytes ?? null,
    maximumLineBytes: verification.maximumLineBytes ?? null,
    maxTranscriptLineBytes: verification.maxTranscriptLineBytes ?? null,
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
