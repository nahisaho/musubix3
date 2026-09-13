import { error, type Diagnostic } from '../../domain/src/index.js';
import { digest, exists, readText, within, writeJson } from './files.js';

export type EvidenceOrderKind = 'change' | 'tdd';

export interface EvidenceOrderRecord {
  sequence: number;
  kind: EvidenceOrderKind;
  entityId: string;
  phase: string;
  /**
   * Only ever set on `kind: 'tdd'` records for the `void` phase (added for
   * `tdd-cycle-void`), so a void order record can itself be checked against
   * the cycle's own `testId`, not only its `entityId`/`cycleId`. Absent on
   * every other kind/phase, including pre-existing `red`/`green`/`refactor`/
   * `migrate` records, for backward compatibility.
   */
  testId?: string;
  /**
   * Only ever set on `kind: 'change'` records for the `waiver` phase, since
   * `entityId` (the `changeId`) alone is not unique across the many
   * codes/requirements one change can waive. Absent on every other
   * kind/phase.
   */
  code?: string;
  /**
   * Only ever set on `kind: 'change'` records for the `waiver` phase, for a
   * requirement-scoped waivable code. Absent for change-level waivable codes
   * and every other kind/phase.
   */
  requirementId?: string;
  /** @id CODE-CHANGE-EVIDENCE-WAIVER-021
   * @implements REQ-CHANGE-EVIDENCE-WAIVER-016
   * @design DES-CHANGE-EVIDENCE-WAIVER-001
   * Only ever set on `kind: 'change'` records for the `waiver` phase, for a
   * `detail`-scoped or both-scoped waivable code (CHANGE-0012's generalized
   * scope key). Absent for `neither`/`requirement`-only regime codes and
   * every other kind/phase.
   */
  detail?: string;
  previousSha256: string | null;
  recordSha256: string;
}

export interface EvidenceOrderLog {
  schemaVersion: 1;
  records: EvidenceOrderRecord[];
}

/**
 * Scoping fields that further distinguish an order record beyond
 * `kind`/`entityId`/`phase`, currently only used by `change-evidence-waiver`
 * for the `waiver` phase. Each field is appended to the key only when
 * present, so omitting `scope` (the default for every pre-existing call
 * site) computes byte-identical keys to before this type existed.
 */
export interface EvidenceOrderScope {
  code?: string;
  requirementId?: string;
  detail?: string;
  /**
   * Only ever supplied, and only ever consulted by `recordKey`, for
   * `phase === 'waiver'` records — never by any external caller directly.
   * See `recordKey`'s CODE-CHANGE-EVIDENCE-WAIVER-013 annotation below.
   */
  sequence?: number;
}

const orderPath = '.musubix/evidence/order.json';

function recordSha256(record: Omit<EvidenceOrderRecord, 'recordSha256'>): string {
  return digest(JSON.stringify(record));
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-013
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 * Appends `scope.detail` after `scope.code`/`scope.requirementId` (only when
 * present), then, only when `phase === 'waiver'`, `scope.sequence` (only when
 * present). Every existing call site omits `scope.detail`/`scope.sequence`
 * (or the whole `scope` argument), so pre-existing keys are byte-identical.
 * `scope.sequence` lets multiple waiver-phase records share every other
 * scope field (REQ-CHANGE-EVIDENCE-WAIVER-006/010's supersession) without
 * ever colliding, since a record's `sequence` is strictly monotonic and
 * unique; it is never appended for any non-`waiver` phase, so
 * `EVIDENCE_ORDER_DUPLICATE` detection for every other phase is unchanged.
 */
function recordKey(kind: EvidenceOrderKind, entityId: string, phase: string, scope?: EvidenceOrderScope): string {
  const key: unknown[] = [kind, entityId, phase];
  if (scope?.code !== undefined) key.push(scope.code);
  if (scope?.requirementId !== undefined) key.push(scope.requirementId);
  if (scope?.detail !== undefined) key.push(scope.detail);
  if (phase === 'waiver' && scope?.sequence !== undefined) key.push(scope.sequence);
  return JSON.stringify(key);
}

export async function loadEvidenceOrder(root: string): Promise<EvidenceOrderLog | null> {
  if (!await exists(within(root, orderPath))) return null;
  const value = JSON.parse(await readText(root, orderPath)) as EvidenceOrderLog;
  if (value.schemaVersion !== 1 || !Array.isArray(value.records)) {
    throw new Error('Invalid monotonic evidence order log.');
  }
  return value;
}

export function validateEvidenceOrderLog(log: EvidenceOrderLog | null): {
  valid: boolean;
  records: Map<string, EvidenceOrderRecord>;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const records = new Map<string, EvidenceOrderRecord>();
  if (!log) return { valid: true, records, diagnostics };
  for (const [index, record] of log.records.entries()) {
    const expectedSequence = index + 1;
    const expectedPrevious = index === 0 ? null : log.records[index - 1]!.recordSha256;
    if (!record || !['change', 'tdd'].includes(record.kind)
      || typeof record.entityId !== 'string' || !record.entityId
      || typeof record.phase !== 'string' || !record.phase
      || (record.testId !== undefined && (typeof record.testId !== 'string' || !record.testId))
      || (record.code !== undefined && (typeof record.code !== 'string' || !record.code))
      || (record.requirementId !== undefined && (typeof record.requirementId !== 'string' || !record.requirementId))
      || (record.detail !== undefined && (typeof record.detail !== 'string' || !record.detail))
      || !Number.isInteger(record.sequence) || record.sequence < 1
      || (record.previousSha256 !== null && !/^[a-f0-9]{64}$/i.test(record.previousSha256))
      || !/^[a-f0-9]{64}$/i.test(record.recordSha256)) {
      diagnostics.push(error('EVIDENCE_ORDER_SCHEMA', `Monotonic evidence order record ${index + 1} is malformed.`, orderPath));
      continue;
    }
    const { recordSha256: actual, ...payload } = record;
    if (record.sequence !== expectedSequence) {
      diagnostics.push(error('EVIDENCE_ORDER_SEQUENCE', `Evidence order record ${record.sequence} is out of order; expected ${expectedSequence}.`, orderPath));
    }
    if (record.previousSha256 !== expectedPrevious) {
      diagnostics.push(error('EVIDENCE_ORDER_LINK', `Evidence order record ${record.sequence} does not link to its predecessor.`, orderPath));
    }
    if (actual !== recordSha256(payload)) {
      diagnostics.push(error('EVIDENCE_ORDER_HASH', `Evidence order record ${record.sequence} has an invalid SHA-256.`, orderPath));
    }
    const key = recordKey(record.kind, record.entityId, record.phase, {
      ...(record.code !== undefined ? { code: record.code } : {}),
      ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
      ...(record.phase === 'waiver' ? { sequence: record.sequence } : {}),
    });
    if (records.has(key)) {
      diagnostics.push(error('EVIDENCE_ORDER_DUPLICATE', `${record.kind}:${record.entityId}:${record.phase} appears more than once.`, orderPath));
    }
    records.set(key, record);
  }
  return { valid: !diagnostics.length, records, diagnostics };
}

export async function inspectEvidenceOrder(root: string): Promise<ReturnType<typeof validateEvidenceOrderLog>> {
  try {
    return validateEvidenceOrderLog(await loadEvidenceOrder(root));
  } catch (cause) {
    return {
      valid: false,
      records: new Map(),
      diagnostics: [error(
        'EVIDENCE_ORDER_SCHEMA',
        cause instanceof Error ? cause.message : String(cause),
        orderPath,
      )],
    };
  }
}

export async function appendEvidenceOrder(
  root: string,
  input: Pick<EvidenceOrderRecord, 'kind' | 'entityId' | 'phase'> & Partial<Pick<EvidenceOrderRecord, 'testId' | 'code' | 'requirementId' | 'detail'>>,
): Promise<EvidenceOrderRecord> {
  const log = await loadEvidenceOrder(root) ?? { schemaVersion: 1, records: [] };
  const validated = validateEvidenceOrderLog(log);
  if (!validated.valid) {
    throw new Error('Existing monotonic evidence order is invalid; regenerate evidence before appending.');
  }
  const scope: EvidenceOrderScope = {
    ...(input.code !== undefined ? { code: input.code } : {}),
    ...(input.requirementId !== undefined ? { requirementId: input.requirementId } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.phase === 'waiver' ? { sequence: log.records.length + 1 } : {}),
  };
  if (validated.records.has(recordKey(input.kind, input.entityId, input.phase, scope))) {
    throw new Error(`${input.kind}:${input.entityId}:${input.phase} is already present in monotonic evidence order.`);
  }
  const previous = log.records.at(-1);
  const payload: Omit<EvidenceOrderRecord, 'recordSha256'> = {
    sequence: log.records.length + 1,
    ...input,
    previousSha256: previous?.recordSha256 ?? null,
  };
  const record = { ...payload, recordSha256: recordSha256(payload) };
  log.records.push(record);
  await writeJson(root, orderPath, log);
  return record;
}

export function evidenceOrderRecord(
  records: Map<string, EvidenceOrderRecord>,
  kind: EvidenceOrderKind,
  entityId: string,
  phase: string,
  scope?: EvidenceOrderScope,
): EvidenceOrderRecord | undefined {
  return records.get(recordKey(kind, entityId, phase, scope));
}
