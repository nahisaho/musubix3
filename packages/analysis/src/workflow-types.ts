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
