import { error, type Diagnostic } from '../../domain/src/index.js';
import { canonicalJson } from './change-waiver.js';
import { digest, exists, readText, within } from './files.js';
import {
  workflowEvidenceHead,
  type WorkflowEvent, type WorkflowManifest,
} from './workflow-types.js';

export const WORKFLOW_WAIVER_PATH = '.musubix/evidence/workflow-waivers.json';
const GENESIS_SHA256 = '0'.repeat(64);
const ISO_UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA256_RE = /^[a-f0-9]{64}$/;

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-001
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-001 REQ-WORKFLOW-EVIDENCE-WAIVER-005 REQ-WORKFLOW-EVIDENCE-WAIVER-013 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-001
 */
export const WORKFLOW_WAIVABLE_CODES = [
  'WORKFLOW_SKILL_NOT_INVOKED',
  'WORKFLOW_INVOCATION_ORDER',
  'WORKFLOW_INVOCATION_INCOMPLETE',
  'WORKFLOW_INVOCATION_FAILED',
  'WORKFLOW_INVOCATION_REUSED',
] as const;
export type WorkflowWaivableCode = typeof WORKFLOW_WAIVABLE_CODES[number];

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-002
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-013
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-001
 */
export const CURRENT_SNAPSHOT_VERSION = 1;

export interface WorkflowWaiverRecord {
  skill: string;
  phase: string;
  declarationRecordedAt: string;
  index?: number;
  code: WorkflowWaivableCode;
  approver: string;
  reason: string;
  waiverRecordedAt: string;
  sequence: number;
  snapshotVersion: number;
  snapshotHash: string;
  previousSha256: string;
  payloadSha256: string;
}

export interface WorkflowWaiverEvidence {
  schemaVersion: 1;
  waivers: WorkflowWaiverRecord[];
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-003
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-006 REQ-WORKFLOW-EVIDENCE-WAIVER-008 REQ-WORKFLOW-EVIDENCE-WAIVER-013 REQ-WORKFLOW-EVIDENCE-WAIVER-017
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-002
 */
export type LoadedWorkflowWaiverEvidence =
  | { schemaVersion: 1; waivers: unknown[]; malformed: false }
  | { schemaVersion: 1; waivers: []; malformed: true };

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function canonicalUtcTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && ISO_UTC_MILLISECONDS.test(value)
    && !Number.isNaN(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function payloadShaOf(record: Omit<WorkflowWaiverRecord, 'payloadSha256'> | WorkflowWaiverRecord): string {
  const { payloadSha256: _payloadSha256, ...rest } = record as WorkflowWaiverRecord & { payloadSha256?: string };
  return digest(canonicalJson(rest));
}

export function scopeLabel(
  skill: string,
  phase: string,
  declarationRecordedAt: string,
  index: number | undefined,
): string {
  return `${skill}:${phase}:${declarationRecordedAt}${index === undefined ? '' : `:${index}`}`;
}

function declarationMatchIndices(
  workflow: WorkflowManifest | null,
  skill: string,
  phase: string,
  declarationRecordedAt: string,
): number[] {
  return (workflow?.events ?? []).flatMap((event, eventIndex) =>
    event.status === 'completed'
    && event.skill === skill
    && event.phase === phase
    && event.recordedAt === declarationRecordedAt
      ? [eventIndex]
      : []);
}

export function linkageReason(
  workflow: WorkflowManifest | null,
  skill: string,
  phase: string,
  declarationRecordedAt: string,
  index: number | undefined,
): string {
  const matches = declarationMatchIndices(workflow, skill, phase, declarationRecordedAt);
  const label = scopeLabel(skill, phase, declarationRecordedAt, index);
  if (matches.length === 0) return `${label} does not resolve to a completed workflow declaration.`;
  if (index === undefined) return `${label} is ambiguous; valid --index values are: ${matches.join(', ')}.`;
  if (matches.length === 1) return `${label} does not accept --index without an exact timestamp collision.`;
  return `${label} must use one of the colliding declaration indices: ${matches.join(', ')}.`;
}

export function nonStale(record: WorkflowWaiverRecord, index: number, context: WorkflowWaiverContext): boolean {
  return record.snapshotVersion === CURRENT_SNAPSHOT_VERSION && record.snapshotHash === context.currentHash[index];
}

function recoverableScopeFields(record: unknown): Partial<{
  skill: string;
  phase: string;
  declarationRecordedAt: string;
  index: number;
  code: string;
}> {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  const candidate = record as Record<string, unknown>;
  return {
    ...(nonEmpty(candidate.skill) ? { skill: candidate.skill } : {}),
    ...(nonEmpty(candidate.phase) ? { phase: candidate.phase } : {}),
    ...(canonicalUtcTimestamp(candidate.declarationRecordedAt) ? { declarationRecordedAt: candidate.declarationRecordedAt } : {}),
    ...(Number.isInteger(candidate.index) && (candidate.index as number) >= 0 ? { index: candidate.index as number } : {}),
    ...(typeof candidate.code === 'string' && (WORKFLOW_WAIVABLE_CODES as readonly string[]).includes(candidate.code)
      ? { code: candidate.code }
      : {}),
  };
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-004
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-006 REQ-WORKFLOW-EVIDENCE-WAIVER-008 REQ-WORKFLOW-EVIDENCE-WAIVER-013 REQ-WORKFLOW-EVIDENCE-WAIVER-017
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-002
 */
export async function loadWorkflowWaiverEvidence(root: string): Promise<LoadedWorkflowWaiverEvidence | null> {
  if (!await exists(within(root, WORKFLOW_WAIVER_PATH))) return null;
  try {
    const value = JSON.parse(await readText(root, WORKFLOW_WAIVER_PATH)) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || value.schemaVersion !== 1 || !Array.isArray(value.waivers)) {
      return { schemaVersion: 1, waivers: [], malformed: true };
    }
    return { schemaVersion: 1, waivers: value.waivers, malformed: false };
  } catch {
    return { schemaVersion: 1, waivers: [], malformed: true };
  }
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-005
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-013
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-002
 */
export function waiverRecordShapeValid(record: unknown): record is WorkflowWaiverRecord {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const candidate = record as Partial<WorkflowWaiverRecord> & Record<string, unknown>;
  const allowedKeys = new Set([
    'skill', 'phase', 'declarationRecordedAt', 'index', 'code', 'approver', 'reason', 'waiverRecordedAt',
    'sequence', 'snapshotVersion', 'snapshotHash', 'previousSha256', 'payloadSha256',
  ]);
  if (Object.keys(candidate).some((key) => !allowedKeys.has(key))) return false;
  if (!nonEmpty(candidate.skill) || !nonEmpty(candidate.phase) || !nonEmpty(candidate.approver) || !nonEmpty(candidate.reason)) return false;
  if (!canonicalUtcTimestamp(candidate.declarationRecordedAt) || !canonicalUtcTimestamp(candidate.waiverRecordedAt)) return false;
  if (!(typeof candidate.code === 'string' && (WORKFLOW_WAIVABLE_CODES as readonly string[]).includes(candidate.code))) return false;
  if (candidate.index !== undefined && (!Number.isInteger(candidate.index) || candidate.index < 0)) return false;
  const sequence = candidate.sequence as number | undefined;
  const snapshotVersion = candidate.snapshotVersion as number | undefined;
  if (sequence === undefined || !Number.isInteger(sequence) || sequence < 1) return false;
  if (snapshotVersion === undefined || !Number.isInteger(snapshotVersion) || snapshotVersion < 1) return false;
  if (typeof candidate.snapshotHash !== 'string' || !SHA256_RE.test(candidate.snapshotHash)) return false;
  if (typeof candidate.previousSha256 !== 'string' || !SHA256_RE.test(candidate.previousSha256)) return false;
  if (typeof candidate.payloadSha256 !== 'string' || !SHA256_RE.test(candidate.payloadSha256)) return false;
  return true;
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-006
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-013 REQ-WORKFLOW-EVIDENCE-WAIVER-017
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-002
 */
export function waiverChainValid(waivers: unknown[], index: number): boolean {
  if (!waiverRecordShapeValid(waivers[index])) return false;
  const record = waivers[index];
  const predecessor = waivers[index - 1] as Record<string, unknown> | undefined;
  const expectedPreviousSha256 = index === 0 ? GENESIS_SHA256 : predecessor?.payloadSha256;
  const expectedSequence = index === 0 ? 1 : typeof predecessor?.sequence === 'number' ? predecessor.sequence + 1 : undefined;
  return record.previousSha256 === expectedPreviousSha256
    && record.sequence === expectedSequence
    && record.payloadSha256 === payloadShaOf(record);
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-007
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-005 REQ-WORKFLOW-EVIDENCE-WAIVER-007 REQ-WORKFLOW-EVIDENCE-WAIVER-013
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-003
 */
export function resolveEvent(
  workflow: WorkflowManifest | null,
  skill: string,
  phase: string,
  declarationRecordedAt: string,
  index: number | undefined,
): WorkflowEvent | undefined {
  const matches = declarationMatchIndices(workflow, skill, phase, declarationRecordedAt);
  if (index === undefined) return matches.length === 1 ? workflow?.events[matches[0]!] : undefined;
  if (matches.length < 2 || !matches.includes(index)) return undefined;
  return workflow?.events[index];
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-008
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-005 REQ-WORKFLOW-EVIDENCE-WAIVER-007 REQ-WORKFLOW-EVIDENCE-WAIVER-013
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-003
 */
export function scopeKey(skill: string, phase: string, declarationRecordedAt: string, index: number | undefined): string {
  return JSON.stringify([skill, phase, declarationRecordedAt, index ?? null]);
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-009
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-007 REQ-WORKFLOW-EVIDENCE-WAIVER-013
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-003
 */
export function waiverLinkage(
  workflow: WorkflowManifest | null,
  waivers: unknown[],
  index: number,
): { valid: boolean; reason?: string } {
  if (!waiverRecordShapeValid(waivers[index])) return { valid: false, reason: 'Waiver record has an invalid shape.' };
  if (!waiverChainValid(waivers, index)) return { valid: false, reason: 'Waiver record breaks the evidence chain.' };
  const record = waivers[index] as WorkflowWaiverRecord;
  if (!resolveEvent(workflow, record.skill, record.phase, record.declarationRecordedAt, record.index)) {
    return { valid: false, reason: linkageReason(workflow, record.skill, record.phase, record.declarationRecordedAt, record.index) };
  }
  return { valid: true };
}

export interface WorkflowWaiverContext {
  loaded: LoadedWorkflowWaiverEvidence | null;
  workflow: WorkflowManifest | null;
  linkage: Array<{ valid: boolean; reason?: string }>;
  currentHash: Array<string | undefined>;
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-010
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-005 REQ-WORKFLOW-EVIDENCE-WAIVER-007 REQ-WORKFLOW-EVIDENCE-WAIVER-013
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-003
 */
export function buildWorkflowWaiverContext(
  loaded: LoadedWorkflowWaiverEvidence | null,
  workflow: WorkflowManifest | null,
  rawDiagnostics: Diagnostic[],
): WorkflowWaiverContext {
  const linkage: Array<{ valid: boolean; reason?: string }> = [];
  const currentHash: Array<string | undefined> = [];
  if (loaded && !loaded.malformed) {
    for (let index = 0; index < loaded.waivers.length; index += 1) {
      const resolved = waiverLinkage(workflow, loaded.waivers, index);
      linkage.push(resolved);
      currentHash.push(resolved.valid ? snapshotHashFor(workflow, rawDiagnostics, loaded.waivers[index] as WorkflowWaiverRecord) : undefined);
    }
  }
  return { loaded, workflow, linkage, currentHash };
}

export function authoritativeIndex(
  context: WorkflowWaiverContext,
  skill: string,
  phase: string,
  declarationRecordedAt: string,
  index: number | undefined,
): number {
  const loaded = context.loaded;
  if (!loaded || loaded.malformed) return -1;
  let authoritative = -1;
  for (let recordIndex = 0; recordIndex < loaded.waivers.length; recordIndex += 1) {
    if (!context.linkage[recordIndex]?.valid || !waiverRecordShapeValid(loaded.waivers[recordIndex])) continue;
    const record = loaded.waivers[recordIndex] as WorkflowWaiverRecord;
    if (scopeKey(record.skill, record.phase, record.declarationRecordedAt, record.index)
      !== scopeKey(skill, phase, declarationRecordedAt, index)) continue;
    if (authoritative === -1 || record.sequence > (loaded.waivers[authoritative] as WorkflowWaiverRecord).sequence) {
      authoritative = recordIndex;
    }
  }
  return authoritative;
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-011
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-012
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-004
 */
export function snapshotPayload(
  workflow: WorkflowManifest | null,
  skill: string,
  phase: string,
  declarationRecordedAt: string,
  index: number | undefined,
  code: WorkflowWaivableCode | null,
): unknown {
  const event = resolveEvent(workflow, skill, phase, declarationRecordedAt, index);
  if (!event) throw new Error(`snapshotPayload: ${scopeLabel(skill, phase, declarationRecordedAt, index)} does not resolve to a declaration event.`);
  return {
    skill: event.skill,
    phase: event.phase,
    status: event.status,
    recordedAt: event.recordedAt,
    version: event.version,
    commandSha256: event.commandSha256 ?? null,
    index: index ?? null,
    workflowEvidenceHead: workflowEvidenceHead(workflow),
    code,
  };
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-012
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-012
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-004
 */
export function currentCodeFor(
  rawDiagnostics: Diagnostic[],
  skill: string,
  phase: string,
  declarationRecordedAt: string,
  index: number | undefined,
): WorkflowWaivableCode | null {
  const match = rawDiagnostics.find((diagnostic) =>
    (WORKFLOW_WAIVABLE_CODES as readonly string[]).includes(diagnostic.code)
    && diagnostic.skill === skill
    && diagnostic.phase === phase
    && diagnostic.declarationRecordedAt === declarationRecordedAt
    && diagnostic.index === index);
  return match ? match.code as WorkflowWaivableCode : null;
}

// Exported only to let workflow.ts own recordWorkflowWaiver without recreating the workflow ↔ waiver import cycle.
export function snapshotHashFor(
  workflow: WorkflowManifest | null,
  rawDiagnostics: Diagnostic[],
  record: WorkflowWaiverRecord,
): string {
  return digest(canonicalJson(snapshotPayload(
    workflow,
    record.skill,
    record.phase,
    record.declarationRecordedAt,
    record.index,
    currentCodeFor(rawDiagnostics, record.skill, record.phase, record.declarationRecordedAt, record.index),
  )));
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-013
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-001 REQ-WORKFLOW-EVIDENCE-WAIVER-009 REQ-WORKFLOW-EVIDENCE-WAIVER-010 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-005
 */
export function waivedWorkflowDiagnostic(context: WorkflowWaiverContext, diagnostic: Diagnostic): Diagnostic {
  if (!(WORKFLOW_WAIVABLE_CODES as readonly string[]).includes(diagnostic.code) && diagnostic.code !== 'WORKFLOW_BINDING_MISSING') {
    return diagnostic;
  }
  if (!diagnostic.skill || !diagnostic.phase || !diagnostic.declarationRecordedAt) return diagnostic;
  const authoritative = authoritativeIndex(
    context,
    diagnostic.skill,
    diagnostic.phase,
    diagnostic.declarationRecordedAt,
    diagnostic.index,
  );
  if (authoritative === -1 || !context.loaded || context.loaded.malformed || !waiverRecordShapeValid(context.loaded.waivers[authoritative])) {
    return diagnostic;
  }
  const record = context.loaded.waivers[authoritative];
  if (!nonStale(record, authoritative, context)) return diagnostic;
  return {
    ...diagnostic,
    severity: 'warning',
    waiver: {
      approver: record.approver,
      reason: record.reason,
      recordedAt: record.waiverRecordedAt,
      waiverRecordedAt: record.waiverRecordedAt,
    },
  };
}

/** @id CODE-WORKFLOW-EVIDENCE-WAIVER-014
 * @implements REQ-WORKFLOW-EVIDENCE-WAIVER-008 REQ-WORKFLOW-EVIDENCE-WAIVER-012 REQ-WORKFLOW-EVIDENCE-WAIVER-014 REQ-WORKFLOW-EVIDENCE-WAIVER-015
 * @design DES-WORKFLOW-EVIDENCE-WAIVER-007
 */
export function deriveWorkflowWaiverAudit(context: WorkflowWaiverContext): {
  workflowWaivers: Array<{
    skill: string;
    phase: string;
    declarationRecordedAt: string;
    index?: number;
    code: string;
    approver: string;
    reason: string;
    waiverRecordedAt: string;
  }>;
  workflowWaiverDiagnostics: Diagnostic[];
} {
  const loaded = context.loaded;
  if (!loaded) return { workflowWaivers: [], workflowWaiverDiagnostics: [] };
  if (loaded.malformed) {
    return {
      workflowWaivers: [],
      workflowWaiverDiagnostics: [error('WORKFLOW_WAIVER_EVIDENCE_MALFORMED', `${WORKFLOW_WAIVER_PATH} is malformed.`, WORKFLOW_WAIVER_PATH)],
    };
  }
  const workflowWaivers: Array<{
    skill: string;
    phase: string;
    declarationRecordedAt: string;
    index?: number;
    code: string;
    approver: string;
    reason: string;
    waiverRecordedAt: string;
  }> = [];
  const workflowWaiverDiagnostics: Diagnostic[] = [];
  const groupsSeen = new Set<string>();
  for (let index = 0; index < loaded.waivers.length; index += 1) {
    const record = loaded.waivers[index];
    const linkage = context.linkage[index] ?? { valid: false, reason: 'Waiver record is not linked.' };
    if (!linkage.valid) {
      const { code: recordCode, ...scope } = recoverableScopeFields(record);
      workflowWaiverDiagnostics.push({
        ...error(
          'WORKFLOW_WAIVER_EVIDENCE_MALFORMED',
          `Workflow waiver evidence at waivers[${index}] is malformed${recordCode ? ` for ${recordCode}` : ''}: ${linkage.reason ?? 'invalid linkage'}`,
          WORKFLOW_WAIVER_PATH,
        ),
        ...scope,
      });
      continue;
    }
    const typedRecord = record as WorkflowWaiverRecord;
    const key = scopeKey(typedRecord.skill, typedRecord.phase, typedRecord.declarationRecordedAt, typedRecord.index);
    if (groupsSeen.has(key)) continue;
    groupsSeen.add(key);
    const authoritative = authoritativeIndex(
      context,
      typedRecord.skill,
      typedRecord.phase,
      typedRecord.declarationRecordedAt,
      typedRecord.index,
    );
    if (authoritative === -1 || !waiverRecordShapeValid(loaded.waivers[authoritative])) continue;
    const authoritativeRecord = loaded.waivers[authoritative];
    if (!nonStale(authoritativeRecord, authoritative, context)) {
      workflowWaiverDiagnostics.push({
        ...error('WORKFLOW_WAIVER_STALE', `Workflow waiver for ${scopeLabel(
          authoritativeRecord.skill,
          authoritativeRecord.phase,
          authoritativeRecord.declarationRecordedAt,
          authoritativeRecord.index,
        )} is stale.`, WORKFLOW_WAIVER_PATH),
        skill: authoritativeRecord.skill,
        phase: authoritativeRecord.phase,
        declarationRecordedAt: authoritativeRecord.declarationRecordedAt,
        ...(authoritativeRecord.index === undefined ? {} : { index: authoritativeRecord.index }),
      });
      continue;
    }
    workflowWaivers.push({
      skill: authoritativeRecord.skill,
      phase: authoritativeRecord.phase,
      declarationRecordedAt: authoritativeRecord.declarationRecordedAt,
      ...(authoritativeRecord.index === undefined ? {} : { index: authoritativeRecord.index }),
      code: authoritativeRecord.code,
      approver: authoritativeRecord.approver,
      reason: authoritativeRecord.reason,
      waiverRecordedAt: authoritativeRecord.waiverRecordedAt,
    });
  }
  return { workflowWaivers, workflowWaiverDiagnostics };
}
