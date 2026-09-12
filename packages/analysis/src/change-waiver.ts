import { error, type Diagnostic } from '../../domain/src/index.js';
import { digest, exists, readText, within, writeJson } from './files.js';
import {
  batchFor, completenessTddUnsatisfiedCondition, designUnchangedCondition, effectiveBatches, greenUnprovenCondition,
  loadChangeEvidence, redUnprovenCondition, requirementsUnchangedCondition, type ChangeEvidence,
} from './change-evidence.js';
import { loadTddEvidence, type TddEvidence } from './tdd.js';
import { appendEvidenceOrder, evidenceOrderRecord, inspectEvidenceOrder } from './order.js';

const WAIVER_PATH = '.musubix/evidence/change-waivers.json';
const GENESIS_SHA256 = '0'.repeat(64);
const SHA256_RE = /^[a-f0-9]{64}$/i;

/** @id CODE-CHANGE-EVIDENCE-WAIVER-001
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-001 REQ-CHANGE-EVIDENCE-WAIVER-004
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 */
export const WAIVABLE_CODES = [
  'CHANGE_REQUIREMENTS_UNCHANGED',
  'CHANGE_DESIGN_UNCHANGED',
  'CHANGE_RED_UNPROVEN',
  'CHANGE_GREEN_UNPROVEN',
  'CHANGE_COMPLETENESS_TDD',
] as const;
export type WaivableCode = typeof WAIVABLE_CODES[number];

export const CHANGE_LEVEL_CODES = new Set<WaivableCode>(['CHANGE_REQUIREMENTS_UNCHANGED', 'CHANGE_DESIGN_UNCHANGED']);

export const CURRENT_SNAPSHOT_VERSION = 1;

export interface ChangeWaiverRecord {
  changeId: string;
  code: string;
  requirementId?: string;
  approver: string;
  reason: string;
  recordedAt: string;
  snapshotVersion: number;
  snapshotHash: string;
  order: number;
  previousSha256: string;
  payloadSha256: string;
}

export interface ChangeWaiverEvidence {
  schemaVersion: 1;
  waivers: ChangeWaiverRecord[];
}

export type LoadedChangeWaiverEvidence =
  | { schemaVersion: 1; waivers: ChangeWaiverRecord[]; malformed?: false }
  | { schemaVersion: 1; waivers: []; malformed: true };

/**
 * Sorts object keys and renders `undefined` values as omitted keys, so the
 * same logical payload always canonicalizes to the same JSON string
 * regardless of key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-002
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-007
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 */
export async function loadChangeWaiverEvidence(root: string): Promise<LoadedChangeWaiverEvidence | null> {
  if (!await exists(within(root, WAIVER_PATH))) return null;
  try {
    const value = JSON.parse(await readText(root, WAIVER_PATH)) as ChangeWaiverEvidence;
    if (value.schemaVersion !== 1 || !Array.isArray(value.waivers)) {
      return { schemaVersion: 1, waivers: [], malformed: true };
    }
    return { schemaVersion: 1, waivers: value.waivers };
  } catch {
    return { schemaVersion: 1, waivers: [], malformed: true };
  }
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-003
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-013
 * @design DES-CHANGE-EVIDENCE-WAIVER-003
 */
export function errorFor(code: string, message: string, target: { changeId: string; requirementId?: string }): Diagnostic {
  return { ...error(code, message), ...target };
}

interface SnapshotBatchPhase {
  fingerprints: unknown;
  order: number | null;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-004
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 */
export function snapshotPayload(
  evidence: ChangeEvidence,
  tdd: TddEvidence | null,
  changeId: string,
  code: WaivableCode,
  requirementId?: string,
): unknown | null {
  const change = evidence.changes.find((entry) => entry.changeId === changeId);
  if (!change) return null;
  if (code === 'CHANGE_REQUIREMENTS_UNCHANGED') {
    const impact = change.phases.impact;
    const requirements = change.phases.requirements;
    return {
      impactRequirements: impact?.fingerprints.requirements ?? null,
      requirementsRequirements: requirements?.fingerprints.requirements ?? null,
      allowUnchanged: requirements?.allowUnchanged ?? null,
    };
  }
  if (code === 'CHANGE_DESIGN_UNCHANGED') {
    const requirements = change.phases.requirements;
    const design = change.phases.design;
    return {
      requirementsDesign: requirements?.fingerprints.design ?? null,
      design: design?.fingerprints.design ?? null,
    };
  }
  // CHANGE_RED_UNPROVEN / CHANGE_GREEN_UNPROVEN / CHANGE_COMPLETENESS_TDD share
  // one payload shape; the caller must already have resolved requirementId per
  // REQ-CHANGE-EVIDENCE-WAIVER-004's granularity rule before reaching here.
  if (requirementId === undefined) {
    throw new Error(`snapshotPayload: ${code} requires a requirementId.`);
  }
  const batch = batchFor(effectiveBatches(change), requirementId);
  const phase = (item?: { fingerprints: unknown; order?: number }): SnapshotBatchPhase | null =>
    item ? { fingerprints: item.fingerprints, order: item.order ?? null } : null;
  const cycles = (tdd?.cycles ?? [])
    .filter((cycle) => cycle.requirementId === requirementId)
    .map((cycle) => ({
      cycleId: cycle.cycleId ?? '',
      red: { valid: cycle.red.valid, order: cycle.red.order ?? null },
      green: cycle.green ? { valid: cycle.green.valid, order: cycle.green.order ?? null } : null,
    }))
    .sort((a, b) => {
      const orderA = a.red.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.red.order ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;
      return a.cycleId < b.cycleId ? -1 : a.cycleId > b.cycleId ? 1 : 0;
    })
    .map(({ cycleId: _cycleId, ...rest }) => rest);
  return {
    requirementsOrder: change.phases.requirements?.order ?? null,
    red: phase(batch?.red),
    implementation: phase(batch?.implementation),
    green: phase(batch?.green),
    cycles,
  };
}

function snapshotHashFor(
  evidence: ChangeEvidence,
  tdd: TddEvidence | null,
  changeId: string,
  code: WaivableCode,
  requirementId?: string,
): string {
  return digest(canonicalJson(snapshotPayload(evidence, tdd, changeId, code, requirementId)));
}

function nonStale(
  record: ChangeWaiverRecord,
  evidence: ChangeEvidence,
  tdd: TddEvidence | null,
): boolean {
  if (record.snapshotVersion !== CURRENT_SNAPSHOT_VERSION) return false;
  if (!(WAIVABLE_CODES as readonly string[]).includes(record.code)) return false;
  const hash = snapshotHashFor(evidence, tdd, record.changeId, record.code as WaivableCode, record.requirementId);
  return record.snapshotHash === hash;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-005
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-015
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 */
export function waiverRecordShapeValid(record: unknown): record is ChangeWaiverRecord {
  if (typeof record !== 'object' || record === null) return false;
  const candidate = record as Partial<ChangeWaiverRecord>;
  const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  if (!nonEmpty(candidate.changeId) || !nonEmpty(candidate.code) || !nonEmpty(candidate.approver)
    || !nonEmpty(candidate.reason) || !nonEmpty(candidate.recordedAt)) return false;
  if (candidate.requirementId !== undefined && !nonEmpty(candidate.requirementId)) return false;
  if (!Number.isInteger(candidate.snapshotVersion) || (candidate.snapshotVersion as number) < 1) return false;
  if (!Number.isInteger(candidate.order) || (candidate.order as number) < 1) return false;
  if (typeof candidate.snapshotHash !== 'string' || !SHA256_RE.test(candidate.snapshotHash)) return false;
  if (typeof candidate.payloadSha256 !== 'string' || !SHA256_RE.test(candidate.payloadSha256)) return false;
  if (typeof candidate.previousSha256 !== 'string'
    || !(candidate.previousSha256 === GENESIS_SHA256 || SHA256_RE.test(candidate.previousSha256))) return false;
  return true;
}

function payloadShaOf(record: ChangeWaiverRecord): string {
  const { payloadSha256: _payloadSha256, ...rest } = record;
  return digest(canonicalJson(rest));
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-006
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-015
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 */
export function waiverChainValid(waivers: ChangeWaiverRecord[], index: number): boolean {
  const record = waivers[index];
  if (!record) return false;
  const expectedPrevious = index === 0 ? GENESIS_SHA256 : waivers[index - 1]!.payloadSha256;
  if (record.previousSha256 !== expectedPrevious) return false;
  return record.payloadSha256 === payloadShaOf(record);
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-007
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-006
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 */
export function waiverLinkage(
  evidence: ChangeEvidence | null,
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>,
  waivers: ChangeWaiverRecord[],
  index: number,
): { valid: boolean; reason?: string } {
  const record = waivers[index];
  if (!record) return { valid: false, reason: 'Waiver record does not exist.' };
  if (!waiverRecordShapeValid(record)) return { valid: false, reason: 'Waiver record has an invalid shape.' };
  if (!waiverChainValid(waivers, index)) return { valid: false, reason: 'Waiver record breaks the evidence chain.' };
  if (evidence === null) return { valid: false, reason: 'No change evidence is available to link this waiver.' };
  if (!(WAIVABLE_CODES as readonly string[]).includes(record.code)) {
    return { valid: false, reason: `${record.code} is not a waivable code.` };
  }
  const code = record.code as WaivableCode;
  const isChangeLevel = CHANGE_LEVEL_CODES.has(code);
  if (isChangeLevel && record.requirementId !== undefined) {
    return { valid: false, reason: `${code} is change-level and must not declare a requirementId.` };
  }
  if (!isChangeLevel && record.requirementId === undefined) {
    return { valid: false, reason: `${code} is requirement-scoped and requires a requirementId.` };
  }
  const change = evidence.changes.find((entry) => entry.changeId === record.changeId);
  if (!change) return { valid: false, reason: `${record.changeId} is not a known change.` };
  if (record.requirementId !== undefined && !change.requirementIds.includes(record.requirementId)) {
    return { valid: false, reason: `${record.requirementId} is not declared by ${record.changeId}.` };
  }
  if (!order.valid) return { valid: false, reason: 'Monotonic evidence order is invalid.' };
  const scope: { code?: string; requirementId?: string } = { code: record.code };
  if (record.requirementId !== undefined) scope.requirementId = record.requirementId;
  const matches = [...order.records.values()].filter((candidate) =>
    candidate.kind === 'change' && candidate.entityId === record.changeId && candidate.phase === 'waiver'
    && candidate.code === record.code && candidate.requirementId === record.requirementId);
  if (matches.length !== 1) {
    return { valid: false, reason: 'Waiver order-log linkage is not unique.' };
  }
  const orderRecord = evidenceOrderRecord(order.records, 'change', record.changeId, 'waiver', scope);
  if (!orderRecord || orderRecord.sequence !== record.order) {
    return { valid: false, reason: 'Waiver order-log entry does not match this waiver.' };
  }
  return { valid: true };
}

export interface WaiverContext {
  loaded: LoadedChangeWaiverEvidence | null;
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-008
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-008 REQ-CHANGE-EVIDENCE-WAIVER-009
 * @design DES-CHANGE-EVIDENCE-WAIVER-004
 */
export function waivedDiagnostic(
  waiverContext: WaiverContext,
  evidence: ChangeEvidence,
  tdd: TddEvidence | null,
  code: WaivableCode,
  message: string,
  changeId: string,
  requirementId: string | undefined,
): Diagnostic {
  const base = errorFor(code, message, { changeId, ...(requirementId !== undefined ? { requirementId } : {}) });
  const loaded = waiverContext.loaded;
  if (!loaded || loaded.malformed) return base;
  const index = loaded.waivers.findIndex((candidate) =>
    candidate.changeId === changeId && candidate.code === code && candidate.requirementId === requirementId);
  if (index === -1) return base;
  const record = loaded.waivers[index]!;
  if (!waiverLinkage(evidence, waiverContext.order, loaded.waivers, index).valid) return base;
  if (!nonStale(record, evidence, tdd)) return base;
  return {
    ...base,
    severity: 'warning',
    waiver: { approver: record.approver, reason: record.reason, recordedAt: record.recordedAt },
  };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-009
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-007 REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-004
 */
export function reportWaiverEvidenceDiagnostics(
  waiverContext: WaiverContext,
  evidence: ChangeEvidence | null,
  tdd: TddEvidence | null,
): Diagnostic[] {
  const loaded = waiverContext.loaded;
  if (!loaded) return [];
  if (loaded.malformed) {
    return [error('CHANGE_WAIVER_EVIDENCE_MALFORMED', `${WAIVER_PATH} is malformed.`, WAIVER_PATH)];
  }
  const diagnostics: Diagnostic[] = [];
  for (let index = 0; index < loaded.waivers.length; index++) {
    const record = loaded.waivers[index]!;
    const linkage = waiverLinkage(evidence, waiverContext.order, loaded.waivers, index);
    if (!linkage.valid) {
      diagnostics.push(error(
        'CHANGE_WAIVER_EVIDENCE_MALFORMED',
        `Waiver for ${record.changeId}:${record.code}${record.requirementId ? `:${record.requirementId}` : ''} is malformed: ${linkage.reason ?? 'invalid linkage'}.`,
        WAIVER_PATH,
      ));
      continue;
    }
    if (evidence && !nonStale(record, evidence, tdd)) {
      diagnostics.push(error(
        'CHANGE_WAIVER_STALE',
        `Waiver for ${record.changeId}:${record.code}${record.requirementId ? `:${record.requirementId}` : ''} is stale.`,
        WAIVER_PATH,
      ));
    }
  }
  return diagnostics;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-010
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-001 REQ-CHANGE-EVIDENCE-WAIVER-002 REQ-CHANGE-EVIDENCE-WAIVER-003 REQ-CHANGE-EVIDENCE-WAIVER-004 REQ-CHANGE-EVIDENCE-WAIVER-005 REQ-CHANGE-EVIDENCE-WAIVER-010 REQ-CHANGE-EVIDENCE-WAIVER-015
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 */
export async function recordChangeWaiver(
  root: string,
  changeId: string,
  code: string,
  requirementId: string | undefined,
  approver: string,
  reason: string,
): Promise<{ recorded: boolean; changeId: string; code: string; requirementId?: string }> {
  const loaded = await loadChangeWaiverEvidence(root);
  const existing = loaded === null ? { schemaVersion: 1 as const, waivers: [] as ChangeWaiverRecord[] } : loaded;
  if (loaded !== null && loaded.malformed) {
    throw new Error(`${WAIVER_PATH} is malformed; regenerate or repair it before recording a new waiver.`);
  }
  const order = await inspectEvidenceOrder(root);
  const evidence = await loadChangeEvidence(root);
  for (let index = 0; index < existing.waivers.length; index++) {
    if (!waiverRecordShapeValid(existing.waivers[index])
      || !waiverChainValid(existing.waivers, index)
      || !waiverLinkage(evidence, order, existing.waivers, index).valid) {
      throw new Error('An existing waiver record is invalid; repair the evidence chain before recording a new waiver.');
    }
  }
  if (!(WAIVABLE_CODES as readonly string[]).includes(code)) {
    throw new Error(`${code} is not a waivable code. Allowed codes: ${WAIVABLE_CODES.join(', ')}.`);
  }
  const waivableCode = code as WaivableCode;
  const isChangeLevel = CHANGE_LEVEL_CODES.has(waivableCode);
  if (isChangeLevel && requirementId !== undefined) {
    throw new Error(`${waivableCode} is change-level and does not accept a requirement scope.`);
  }
  if (!isChangeLevel && requirementId === undefined) {
    throw new Error(`${waivableCode} is requirement-scoped and requires --requirement.`);
  }
  if (!approver.trim() || !reason.trim()) {
    throw new Error('A non-empty --approver and --reason are required.');
  }
  if (!evidence) throw new Error(`${changeId} has no change evidence.`);
  const change = evidence.changes.find((entry) => entry.changeId === changeId);
  if (!change) throw new Error(`${changeId} is not a known change.`);
  if (requirementId !== undefined && !change.requirementIds.includes(requirementId)) {
    throw new Error(`${requirementId} is not declared by ${changeId}.`);
  }
  const tdd = await loadTddEvidence(root);
  const currentlyReported = ((): boolean => {
    switch (waivableCode) {
      case 'CHANGE_REQUIREMENTS_UNCHANGED': return requirementsUnchangedCondition(change);
      case 'CHANGE_DESIGN_UNCHANGED': return designUnchangedCondition(change);
      case 'CHANGE_RED_UNPROVEN': return redUnprovenCondition(change, requirementId!, tdd);
      case 'CHANGE_GREEN_UNPROVEN': return greenUnprovenCondition(change, requirementId!, tdd);
      case 'CHANGE_COMPLETENESS_TDD': return completenessTddUnsatisfiedCondition(change, requirementId!, tdd);
      default: return false;
    }
  })();
  if (!currentlyReported) {
    throw new Error(`No matching ${waivableCode} diagnostic is currently reported for ${changeId}${requirementId ? `:${requirementId}` : ''}.`);
  }
  for (let index = 0; index < existing.waivers.length; index++) {
    const record = existing.waivers[index]!;
    if (record.changeId === changeId && record.code === waivableCode && record.requirementId === requirementId
      && waiverLinkage(evidence, order, existing.waivers, index).valid
      && nonStale(record, evidence, tdd)) {
      throw new Error(`${changeId}:${waivableCode}${requirementId ? `:${requirementId}` : ''} already has an active waiver.`);
    }
  }
  const snapshotHash = snapshotHashFor(evidence, tdd, changeId, waivableCode, requirementId);
  const orderRecord = await appendEvidenceOrder(root, {
    kind: 'change',
    entityId: changeId,
    phase: 'waiver',
    code: waivableCode,
    ...(requirementId !== undefined ? { requirementId } : {}),
  });
  const previousSha256 = existing.waivers.at(-1)?.payloadSha256 ?? GENESIS_SHA256;
  const withoutHash: Omit<ChangeWaiverRecord, 'payloadSha256'> = {
    changeId,
    code: waivableCode,
    ...(requirementId !== undefined ? { requirementId } : {}),
    approver,
    reason,
    recordedAt: new Date().toISOString(),
    snapshotVersion: CURRENT_SNAPSHOT_VERSION,
    snapshotHash,
    order: orderRecord.sequence,
    previousSha256,
  };
  const payloadSha256 = digest(canonicalJson(withoutHash));
  const record: ChangeWaiverRecord = { ...withoutHash, payloadSha256 };
  const nextEvidence: ChangeWaiverEvidence = { schemaVersion: 1, waivers: [...existing.waivers, record] };
  await writeJson(root, WAIVER_PATH, nextEvidence);
  return { recorded: true, changeId, code: waivableCode, ...(requirementId !== undefined ? { requirementId } : {}) };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-011
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-012
 * @design DES-CHANGE-EVIDENCE-WAIVER-005
 */
export async function activeWaivers(root: string): Promise<Array<{
  changeId: string; code: string; requirementId?: string; approver: string; reason: string; recordedAt: string;
}>> {
  const loaded = await loadChangeWaiverEvidence(root);
  if (!loaded || loaded.malformed) return [];
  const evidence = await loadChangeEvidence(root);
  const tdd = await loadTddEvidence(root);
  const order = await inspectEvidenceOrder(root);
  const results: Array<{ changeId: string; code: string; requirementId?: string; approver: string; reason: string; recordedAt: string }> = [];
  for (let index = 0; index < loaded.waivers.length; index++) {
    const record = loaded.waivers[index]!;
    if (!waiverLinkage(evidence, order, loaded.waivers, index).valid) continue;
    if (!evidence || !nonStale(record, evidence, tdd)) continue;
    results.push({
      changeId: record.changeId,
      code: record.code,
      ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
      approver: record.approver,
      reason: record.reason,
      recordedAt: record.recordedAt,
    });
  }
  return results;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-012
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-007 REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-005
 */
export async function waiverEvidenceDiagnostics(root: string): Promise<Diagnostic[]> {
  const loaded = await loadChangeWaiverEvidence(root);
  const evidence = await loadChangeEvidence(root);
  const tdd = await loadTddEvidence(root);
  const order = await inspectEvidenceOrder(root);
  return reportWaiverEvidenceDiagnostics({ loaded, order }, evidence, tdd);
}
