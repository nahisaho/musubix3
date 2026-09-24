import { error, type Diagnostic } from '../../domain/src/index.js';
import { digest, exists, readText, within, writeJson } from './files.js';
import {
  batchFor, batchesForKey, batchKey, completenessTddUnsatisfiedCondition, designUnchangedCondition,
  currentRequirementIdsForBatch, effectiveBatches, greenUnprovenCondition,
  implementationUnchangedCondition, loadChangeEvidence,
  orderMigrationRequiredBatchCondition,
  orderMigrationRequiredPhaseCondition, orderMigrationRequiredRequirementCondition,
  phaseMissingCondition, recordMissingCondition, redUnprovenCondition, relevantImplementationUnchangedCondition,
  requirementsUnchangedCondition, testChangedAfterRedCondition, testsUnchangedCondition,
  voidedCycleOrdersInCurrentWindow,
  type ChangeEvidence, type ChangePhase, type ChangeTddBatch,
} from './change-evidence.js';
import { loadTddEvidence, validlyVoidedTddCycles, type TddEvidence } from './tdd.js';
import { appendEvidenceOrder, evidenceOrderRecord, inspectEvidenceOrder } from './order.js';
import { withEvidenceWriterLock } from './evidence-writer-lock.js';

const WAIVER_PATH = '.musubix/evidence/change-waivers.json';
const GENESIS_SHA256 = '0'.repeat(64);
const SHA256_RE = /^[a-f0-9]{64}$/i;
const tddBatchPhaseNames = ['red', 'implementation', 'green'] as const;

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
  'CHANGE_RECORD_MISSING',
  'CHANGE_PHASE_MISSING',
  'CHANGE_ORDER_MIGRATION_REQUIRED',
  'CHANGE_TESTS_UNCHANGED',
  'CHANGE_IMPLEMENTATION_UNCHANGED',
  'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED',
  'CHANGE_TEST_CHANGED_AFTER_RED',
] as const;
export type WaivableCode = typeof WAIVABLE_CODES[number];

/** @id CODE-CHANGE-EVIDENCE-WAIVER-017
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-004 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 * Four disjoint, exhaustive scope-key regime sets, replacing the original
 * single `CHANGE_LEVEL_CODES` set, so REQ-004's regime matrix is data, never
 * scattered per-code `if` branches.
 */
export const NEITHER_KEY_CODES = new Set<WaivableCode>(['CHANGE_REQUIREMENTS_UNCHANGED', 'CHANGE_DESIGN_UNCHANGED', 'CHANGE_RECORD_MISSING']);
export const REQUIREMENT_ONLY_CODES = new Set<WaivableCode>(['CHANGE_RED_UNPROVEN', 'CHANGE_GREEN_UNPROVEN', 'CHANGE_COMPLETENESS_TDD']);
export const DETAIL_ONLY_CODES = new Set<WaivableCode>([
  'CHANGE_PHASE_MISSING', 'CHANGE_ORDER_MIGRATION_REQUIRED', 'CHANGE_TESTS_UNCHANGED',
  'CHANGE_IMPLEMENTATION_UNCHANGED', 'CHANGE_TEST_CHANGED_AFTER_RED',
]);
export const BOTH_KEYS_CODES = new Set<WaivableCode>(['CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED']);

/** Retained purely for backward-compatible naming inside this module. */
export const CHANGE_LEVEL_CODES = NEITHER_KEY_CODES;

export function requiresRequirementId(code: WaivableCode): boolean {
  return REQUIREMENT_ONLY_CODES.has(code) || BOTH_KEYS_CODES.has(code);
}

export function requiresDetail(code: WaivableCode): boolean {
  return DETAIL_ONLY_CODES.has(code) || BOTH_KEYS_CODES.has(code);
}

export const CURRENT_SNAPSHOT_VERSION = 1;

export interface ChangeWaiverRecord {
  changeId: string;
  code: string;
  requirementId?: string;
  detail?: string;
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
    return { ...value, schemaVersion: 1, waivers: value.waivers };
  } catch {
    return { schemaVersion: 1, waivers: [], malformed: true };
  }
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-003
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-013 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-003
 */
export function errorFor(code: WaivableCode, message: string, target: { changeId: string; requirementId?: string; detail?: string }): Diagnostic {
  return { ...error(code, message), ...target };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-018
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 * The single function computing the canonical `detail` grammar, used both
 * at emission time (`change.ts`) and at matching/snapshot time (below and
 * `recordChangeWaiver`), so the two call sites never diverge.
 */
export function diagnosticDetail(code: WaivableCode, context: {
  phaseName?: string;
  batchPhaseName?: string;
  batch?: ChangeTddBatch;
  requirementId?: string;
}): string | undefined {
  if (code === 'CHANGE_PHASE_MISSING') {
    return context.phaseName !== undefined ? `phase:${context.phaseName}` : undefined;
  }
  if (code === 'CHANGE_ORDER_MIGRATION_REQUIRED') {
    if (context.batchPhaseName !== undefined && context.batch !== undefined) {
      return `batch:${context.batchPhaseName}:${batchKey(context.batch.requirementIds)}`;
    }
    if (context.requirementId !== undefined) return `requirement:${context.requirementId}`;
    if (context.phaseName !== undefined) return `phase:${context.phaseName}`;
    return undefined;
  }
  if (code === 'CHANGE_TESTS_UNCHANGED' || code === 'CHANGE_IMPLEMENTATION_UNCHANGED'
    || code === 'CHANGE_TEST_CHANGED_AFTER_RED' || code === 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED') {
    return context.batch !== undefined ? batchKey(context.batch.requirementIds) : undefined;
  }
  return undefined;
}

export type ParsedDetail =
  | { kind: 'phase'; phaseName: string }
  | { kind: 'batch'; batchPhaseName: string; batchKey: string }
  | { kind: 'requirement'; requirementId: string }
  | { kind: 'batchKey'; batchKey: string };

function validBatchKey(key: string): boolean {
  const ids = key.split(',');
  return ids.length > 0
    && ids.every((id) => id.length > 0)
    && new Set(ids).size === ids.length
    && batchKey(ids) === key;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-019
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 * The inverse parser of `diagnosticDetail`, used to recover structured
 * fields from a stored or supplied `detail` string.
 */
export function parseDetail(code: WaivableCode, detail: string | undefined): ParsedDetail | null {
  if (detail === undefined) return null;
  if (detail.startsWith('phase:')) {
    const phaseName = detail.slice('phase:'.length);
    const allowed = code === 'CHANGE_PHASE_MISSING'
      ? ['impact', 'requirements', 'design', 'quality', ...tddBatchPhaseNames]
      : code === 'CHANGE_ORDER_MIGRATION_REQUIRED'
        ? ['impact', 'requirements', 'design']
        : [];
    return allowed.includes(phaseName as never) ? { kind: 'phase', phaseName } : null;
  }
  if (detail.startsWith('batch:')) {
    if (code !== 'CHANGE_ORDER_MIGRATION_REQUIRED') return null;
    const rest = detail.slice('batch:'.length);
    const separator = rest.indexOf(':');
    if (separator === -1) return null;
    const batchPhaseName = rest.slice(0, separator);
    const key = rest.slice(separator + 1);
    return (tddBatchPhaseNames as readonly string[]).includes(batchPhaseName) && validBatchKey(key)
      ? { kind: 'batch', batchPhaseName, batchKey: key }
      : null;
  }
  if (detail.startsWith('requirement:')) {
    if (code !== 'CHANGE_ORDER_MIGRATION_REQUIRED') return null;
    const parsedRequirementId = detail.slice('requirement:'.length);
    return parsedRequirementId ? { kind: 'requirement', requirementId: parsedRequirementId } : null;
  }
  if (code === 'CHANGE_TESTS_UNCHANGED' || code === 'CHANGE_IMPLEMENTATION_UNCHANGED'
    || code === 'CHANGE_TEST_CHANGED_AFTER_RED' || code === 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED') {
    return validBatchKey(detail) ? { kind: 'batchKey', batchKey: detail } : null;
  }
  return null;
}

function compareSnapshotCycles<T>(
  left: T,
  right: T,
  orderOf: (item: T) => unknown,
  idOf: (item: T) => string | undefined,
  serializedOf: (item: T) => unknown,
): number {
  const rank = (value: unknown): number => Number.isInteger(value) ? 0 : value === undefined || value === null ? 2 : 1;
  const leftOrder = orderOf(left);
  const rightOrder = orderOf(right);
  const rankDifference = rank(leftOrder) - rank(rightOrder);
  if (rankDifference !== 0) return rankDifference;
  if (Number.isInteger(leftOrder) && Number.isInteger(rightOrder) && leftOrder !== rightOrder) {
    return (leftOrder as number) - (rightOrder as number);
  }
  if (!Number.isInteger(leftOrder) && leftOrder != null && rightOrder != null) {
    const orderComparison = canonicalJson(leftOrder).localeCompare(canonicalJson(rightOrder));
    if (orderComparison !== 0) return orderComparison;
  }
  const idComparison = (idOf(left) ?? '').localeCompare(idOf(right) ?? '');
  if (idComparison !== 0) return idComparison;
  return canonicalJson(serializedOf(left)).localeCompare(canonicalJson(serializedOf(right)));
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-004
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-011 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 */
export async function snapshotPayload(
  root: string,
  evidence: ChangeEvidence | null,
  tdd: TddEvidence | null,
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>,
  changeId: string,
  code: WaivableCode,
  requirementId?: string,
  detail?: string,
): Promise<unknown | null> {
  const changePath = `.musubix/changes/${changeId}.md`;
  const change = evidence?.changes.find((entry) => entry.changeId === changeId);

  if (code === 'CHANGE_REQUIREMENTS_UNCHANGED') {
    const impact = change?.phases.impact;
    const requirements = change?.phases.requirements;
    return {
      impactRequirements: impact?.fingerprints.requirements ?? null,
      requirementsRequirements: requirements?.fingerprints.requirements ?? null,
      allowUnchanged: requirements?.allowUnchanged ?? null,
    };
  }
  if (code === 'CHANGE_DESIGN_UNCHANGED') {
    const requirements = change?.phases.requirements;
    const design = change?.phases.design;
    return {
      requirementsDesign: requirements?.fingerprints.design ?? null,
      design: design?.fingerprints.design ?? null,
    };
  }
  if (code === 'CHANGE_RECORD_MISSING') {
    if (!await exists(within(root, changePath))) return null;
    return {
      documentDigest: digest(await readText(root, changePath)),
      everRecorded: [...order.records.values()].some((record) => record.kind === 'change' && record.entityId === changeId && record.phase !== 'waiver'),
      currentEntry: change ? digest(canonicalJson(change)) : null,
    };
  }
  if (code === 'CHANGE_RED_UNPROVEN' || code === 'CHANGE_GREEN_UNPROVEN' || code === 'CHANGE_COMPLETENESS_TDD') {
    if (requirementId === undefined) throw new Error(`snapshotPayload: ${code} requires a requirementId.`);
    const batch = change ? batchFor(effectiveBatches(change), requirementId) : undefined;
    const phaseItem = (item?: { fingerprints: unknown; order?: number }) =>
      item ? { fingerprints: item.fingerprints, order: item.order ?? null } : null;
    const cycles = (tdd?.cycles ?? [])
      .filter((cycle) => cycle.requirementId === requirementId)
      .map((cycle) => ({
        cycleId: cycle.cycleId ?? '',
        red: { valid: cycle.red.valid, order: cycle.red.order },
        green: cycle.green ? { valid: cycle.green.valid, order: cycle.green.order } : null,
      }))
      .sort((a, b) => compareSnapshotCycles(a, b, (item) => item.red.order, (item) => item.cycleId, ({ cycleId: _id, ...item }) => item))
      .map(({ cycleId: _cycleId, ...rest }) => ({
        red: { valid: rest.red.valid, order: rest.red.order ?? null },
        green: rest.green ? { valid: rest.green.valid, order: rest.green.order ?? null } : null,
      }));
    const validlyVoided = validlyVoidedTddCycles(tdd, order);
    const voidedCycleOrders = change
      ? voidedCycleOrdersInCurrentWindow(change, requirementId, tdd, validlyVoided)
      : [];
    return {
      requirementsOrder: change?.phases.requirements?.order ?? null,
      red: phaseItem(batch?.red),
      implementation: phaseItem(batch?.implementation),
      green: phaseItem(batch?.green),
      cycles,
      ...(voidedCycleOrders.length ? { voidedCycleOrders } : {}),
    };
  }

  const parsed = parseDetail(code, detail);
  if (!parsed) return null;

  if (code === 'CHANGE_PHASE_MISSING') {
    if (parsed.kind !== 'phase') return null;
    const isTddBatch = (tddBatchPhaseNames as readonly string[]).includes(parsed.phaseName);
    if (isTddBatch) {
      const missingRequirementIds = change
        ? [...change.requirementIds]
          .filter((id) => !effectiveBatches(change).some((batch) =>
            batch[parsed.phaseName as typeof tddBatchPhaseNames[number]] && batch.requirementIds.includes(id)))
          .sort()
        : null;
      return { phasePresent: null, orderIsInteger: null, phaseOrder: null, missingRequirementIds };
    }
    const item = change?.phases[parsed.phaseName as ChangePhase];
    return {
      phasePresent: item !== undefined,
      orderIsInteger: Number.isInteger(item?.order),
      phaseOrder: Number.isInteger(item?.order) ? item!.order : null,
      missingRequirementIds: null,
    };
  }

  if (code === 'CHANGE_ORDER_MIGRATION_REQUIRED') {
    if (parsed.kind === 'phase') {
      const item = change?.phases[parsed.phaseName as ChangePhase];
      return {
        phasePresent: item !== undefined,
        orderIsInteger: Number.isInteger(item?.order),
        phaseOrder: Number.isInteger(item?.order) ? item!.order : null,
      };
    }
    if (parsed.kind === 'batch') {
      const matches = change ? batchesForKey(effectiveBatches(change), parsed.batchKey) : [];
      const state = (batch: ChangeTddBatch | undefined) => {
        const item = batch?.[parsed.batchPhaseName as typeof tddBatchPhaseNames[number]];
        return {
          phaseItemPresent: item != null,
          orderIsInteger: Number.isInteger(item?.order),
          phaseOrder: Number.isInteger(item?.order) ? item!.order : null,
        };
      };
      return matches.length <= 1 ? state(matches[0]) : { matchingBatches: matches.map((batch) => state(batch)) };
    }
    if (parsed.kind === 'requirement') {
      const validlyVoided = validlyVoidedTddCycles(tdd, order);
      const cycles = (tdd?.cycles ?? [])
        .filter((cycle) => cycle.requirementId === parsed.requirementId)
        .map((cycle) => ({ cycleId: cycle.cycleId ?? '', redOrder: cycle.red.order, greenOrder: cycle.green?.order }))
        .sort((a, b) => compareSnapshotCycles(a, b, (item) => item.redOrder, (item) => item.cycleId, ({ cycleId: _id, ...item }) => item))
        .map(({ cycleId: _cycleId, redOrder, greenOrder }) => ({
          redOrder: redOrder ?? null,
          greenOrder: greenOrder ?? null,
        }));
      const voidedCycleOrders = change
        ? voidedCycleOrdersInCurrentWindow(change, parsed.requirementId, tdd, validlyVoided)
        : [];
      return { cycles, ...(voidedCycleOrders.length ? { voidedCycleOrders } : {}) };
    }
    return null;
  }

  if (parsed.kind !== 'batchKey') return null;
  const batches = change ? effectiveBatches(change) : [];
  const matches = batchesForKey(batches, parsed.batchKey);
  const batch = matches[0];

  if (code === 'CHANGE_TESTS_UNCHANGED') {
    const designTests = change?.phases.design?.fingerprints.tests ?? null;
    if (matches.length <= 1) return { designTests, batchRedTests: batch?.red?.fingerprints.tests ?? null };
    return {
      designTests,
      matchingBatches: matches.map((candidate) => ({
        ownedRequirementIds: change ? currentRequirementIdsForBatch(batches, candidate, change.requirementIds).sort() : [],
        batchRedTests: candidate.red?.fingerprints.tests ?? null,
      })),
    };
  }
  if (code === 'CHANGE_IMPLEMENTATION_UNCHANGED') {
    if (matches.length > 1) {
      return {
        matchingBatches: matches.map((candidate) => ({
          ownedRequirementIds: change ? currentRequirementIdsForBatch(batches, candidate, change.requirementIds).sort() : [],
          redImplementation: candidate.red?.fingerprints.implementation ?? null,
          implementationImplementation: candidate.implementation?.fingerprints.implementation ?? null,
        })),
      };
    }
    return {
      redImplementation: batch?.red?.fingerprints.implementation ?? null,
      implementationImplementation: batch?.implementation?.fingerprints.implementation ?? null,
    };
  }
  if (code === 'CHANGE_TEST_CHANGED_AFTER_RED') {
    if (matches.length > 1) {
      return {
        matchingBatches: matches.map((candidate) => ({
          ownedRequirementIds: change ? currentRequirementIdsForBatch(batches, candidate, change.requirementIds).sort() : [],
          redTests: candidate.red?.fingerprints.tests ?? null,
          greenTests: candidate.green?.fingerprints.tests ?? null,
        })),
      };
    }
    return { redTests: batch?.red?.fingerprints.tests ?? null, greenTests: batch?.green?.fingerprints.tests ?? null };
  }
  if (code === 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED') {
    if (requirementId === undefined) return null;
    if (matches.length > 1) {
      return {
        matchingBatches: matches.map((candidate) => ({
          ownedRequirementIds: change ? currentRequirementIdsForBatch(batches, candidate, change.requirementIds).sort() : [],
          redRequirementImplementation: candidate.red?.fingerprints.requirementImplementations?.[requirementId] ?? null,
          implementationRequirementImplementation: candidate.implementation?.fingerprints.requirementImplementations?.[requirementId] ?? null,
        })),
      };
    }
    return {
      redRequirementImplementation: batch?.red?.fingerprints.requirementImplementations?.[requirementId] ?? null,
      implementationRequirementImplementation: batch?.implementation?.fingerprints.requirementImplementations?.[requirementId] ?? null,
    };
  }
  return null;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-005
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-015 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 */
export function waiverRecordShapeValid(record: unknown): record is ChangeWaiverRecord {
  if (typeof record !== 'object' || record === null) return false;
  const candidate = record as Partial<ChangeWaiverRecord>;
  const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
  if (!nonEmpty(candidate.changeId) || !nonEmpty(candidate.code) || !nonEmpty(candidate.approver)
    || !nonEmpty(candidate.reason) || !nonEmpty(candidate.recordedAt)) return false;
  if (candidate.requirementId !== undefined && !nonEmpty(candidate.requirementId)) return false;
  if (candidate.detail !== undefined && !nonEmpty(candidate.detail)) return false;
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
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-006 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 */
export function waiverLinkage(
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>,
  waivers: ChangeWaiverRecord[],
  index: number,
): { valid: boolean; reason?: string } {
  const record = waivers[index];
  if (!record) return { valid: false, reason: 'Waiver record does not exist.' };
  if (!waiverRecordShapeValid(record)) return { valid: false, reason: 'Waiver record has an invalid shape.' };
  if (!waiverChainValid(waivers, index)) return { valid: false, reason: 'Waiver record breaks the evidence chain.' };
  if (!(WAIVABLE_CODES as readonly string[]).includes(record.code)) {
    return { valid: false, reason: `${record.code} is not a waivable code.` };
  }
  const code = record.code as WaivableCode;
  if (requiresRequirementId(code) !== (record.requirementId !== undefined)) {
    return { valid: false, reason: `${code}'s requirementId scope does not match its regime.` };
  }
  if (requiresDetail(code) !== (record.detail !== undefined)) {
    return { valid: false, reason: `${code}'s detail scope does not match its regime.` };
  }
  if (record.detail !== undefined && !parseDetail(code, record.detail)) {
    return { valid: false, reason: `${record.detail} is not valid detail grammar for ${code}.` };
  }
  if (waivers.filter((candidate) => candidate.order === record.order).length !== 1) {
    return { valid: false, reason: `Waiver order ${record.order} is claimed by more than one record.` };
  }
  if (!order.valid) return { valid: false, reason: 'Monotonic evidence order is invalid.' };
  const orderRecord = evidenceOrderRecord(order.records, 'change', record.changeId, 'waiver', {
    code: record.code,
    ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
    ...(record.detail !== undefined ? { detail: record.detail } : {}),
    sequence: record.order,
  });
  if (!orderRecord || orderRecord.sequence !== record.order) {
    return { valid: false, reason: 'Waiver order-log entry does not match this waiver.' };
  }
  return { valid: true };
}

export type WaiverCondition = 'true' | 'false' | 'indeterminate';

export interface WaiverScope {
  changeId: string;
  code: WaivableCode;
  requirementId?: string;
  detail?: string;
}

export interface WaiverContext {
  loaded: LoadedChangeWaiverEvidence | null;
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>;
  linkage: Array<{ valid: boolean; reason?: string }>;
  currentHash: Array<string | undefined>;
  condition: Array<WaiverCondition | undefined>;
}

export async function evaluateWaiverCondition(
  root: string,
  evidence: ChangeEvidence | null,
  tdd: TddEvidence | null,
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>,
  scope: WaiverScope,
): Promise<WaiverCondition> {
  const change = evidence?.changes.find((entry) => entry.changeId === scope.changeId);
  if (scope.code === 'CHANGE_RECORD_MISSING') {
    if (!await exists(within(root, `.musubix/changes/${scope.changeId}.md`))) return 'indeterminate';
    return await recordMissingCondition(root, evidence, scope.changeId) ? 'true' : 'false';
  }
  if (!change) return 'indeterminate';
  if (scope.requirementId !== undefined && !change.requirementIds.includes(scope.requirementId)) return 'indeterminate';

  const validlyVoided = validlyVoidedTddCycles(tdd, order);
  const result = (value: boolean): WaiverCondition => value ? 'true' : 'false';
  switch (scope.code) {
    case 'CHANGE_REQUIREMENTS_UNCHANGED':
      return result(requirementsUnchangedCondition(change));
    case 'CHANGE_DESIGN_UNCHANGED':
      return result(designUnchangedCondition(change));
    case 'CHANGE_RED_UNPROVEN':
      return result(!change.qualityHistory?.length
        && redUnprovenCondition(change, scope.requirementId!, tdd, validlyVoided));
    case 'CHANGE_GREEN_UNPROVEN':
      return result(!change.qualityHistory?.length
        && greenUnprovenCondition(change, scope.requirementId!, tdd, validlyVoided));
    case 'CHANGE_COMPLETENESS_TDD':
      return result(completenessTddUnsatisfiedCondition(change, scope.requirementId!, tdd, validlyVoided));
    default:
      break;
  }

  const parsed = parseDetail(scope.code, scope.detail);
  if (!parsed) return 'indeterminate';
  if (scope.code === 'CHANGE_PHASE_MISSING') {
    return parsed.kind === 'phase' ? result(phaseMissingCondition(change, parsed.phaseName)) : 'indeterminate';
  }
  if (scope.code === 'CHANGE_ORDER_MIGRATION_REQUIRED') {
    if (parsed.kind === 'phase') return result(orderMigrationRequiredPhaseCondition(change, parsed.phaseName));
    if (parsed.kind === 'requirement') {
      if (!change.requirementIds.includes(parsed.requirementId)) return 'indeterminate';
      return result(orderMigrationRequiredRequirementCondition(change, parsed.requirementId, tdd, validlyVoided));
    }
    if (parsed.kind === 'batch') {
      const matches = batchesForKey(effectiveBatches(change), parsed.batchKey);
      if (!matches.length) return 'indeterminate';
      return result(orderMigrationRequiredBatchCondition(change, parsed.batchPhaseName, parsed.batchKey));
    }
    return 'indeterminate';
  }
  if (parsed.kind !== 'batchKey') return 'indeterminate';
  const batches = effectiveBatches(change);
  const matches = batchesForKey(batches, parsed.batchKey);
  if (!matches.length) return 'indeterminate';
  const owned = matches.filter((batch) => {
    const requirementIds = currentRequirementIdsForBatch(batches, batch, change.requirementIds);
    return scope.code === 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED'
      ? scope.requirementId !== undefined && requirementIds.includes(scope.requirementId)
      : requirementIds.length > 0;
  });
  if (!owned.length) return 'false';
  if (scope.code === 'CHANGE_TESTS_UNCHANGED') {
    return result(owned.some((batch) => testsUnchangedCondition(change, batch)));
  }
  if (scope.code === 'CHANGE_IMPLEMENTATION_UNCHANGED') {
    return result(owned.some((batch) => implementationUnchangedCondition(batch)));
  }
  if (scope.code === 'CHANGE_TEST_CHANGED_AFTER_RED') {
    return result(owned.some((batch) => testChangedAfterRedCondition(batch)));
  }
  if (scope.code === 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED') {
    return result(owned.some((batch) => relevantImplementationUnchangedCondition(batch, scope.requirementId!)));
  }
  return 'indeterminate';
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-020
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-006 REQ-CHANGE-EVIDENCE-WAIVER-007 REQ-CHANGE-EVIDENCE-WAIVER-010 REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-004
 * The sole async precomputation: every downstream function in this module
 * consults only this fully resolved value, so no diagnostic-emission call
 * site or final malformed/stale pass needs to itself `await` anything.
 */
export async function buildWaiverContext(
  root: string,
  evidence: ChangeEvidence | null,
  tdd: TddEvidence | null,
  precomputed: {
    loaded?: LoadedChangeWaiverEvidence | null;
    order?: Awaited<ReturnType<typeof inspectEvidenceOrder>>;
  } = {},
): Promise<WaiverContext> {
  const loaded = precomputed.loaded !== undefined ? precomputed.loaded : await loadChangeWaiverEvidence(root);
  const order = precomputed.order ?? await inspectEvidenceOrder(root);
  const linkage: Array<{ valid: boolean; reason?: string }> = [];
  const currentHash: Array<string | undefined> = [];
  const condition: Array<WaiverCondition | undefined> = [];
  if (loaded && !loaded.malformed) {
    for (let index = 0; index < loaded.waivers.length; index++) {
      const recordLinkage = waiverLinkage(order, loaded.waivers, index);
      linkage.push(recordLinkage);
      if (recordLinkage.valid) {
        const record = loaded.waivers[index]!;
        currentHash.push(digest(canonicalJson(await snapshotPayload(
          root, evidence, tdd, order, record.changeId, record.code as WaivableCode, record.requirementId, record.detail,
        ))));
        condition.push(await evaluateWaiverCondition(root, evidence, tdd, order, {
          changeId: record.changeId,
          code: record.code as WaivableCode,
          ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
          ...(record.detail !== undefined ? { detail: record.detail } : {}),
        }));
      } else {
        currentHash.push(undefined);
        condition.push(undefined);
      }
    }
  }
  return { loaded, order, linkage, currentHash, condition };
}

export function isWaiverStale(waiverContext: WaiverContext, index: number): boolean {
  const loaded = waiverContext.loaded;
  if (!loaded || loaded.malformed) return true;
  const record = loaded.waivers[index];
  return !record
    || record.snapshotVersion !== CURRENT_SNAPSHOT_VERSION
    || record.snapshotHash !== waiverContext.currentHash[index]
    || waiverContext.condition[index] === 'false'
    || waiverContext.condition[index] === 'indeterminate'
    || waiverContext.condition[index] === undefined;
}

function scopeMatches(record: ChangeWaiverRecord, changeId: string, code: string, requirementId: string | undefined, detail: string | undefined): boolean {
  return record.changeId === changeId && record.code === code && record.requirementId === requirementId && record.detail === detail;
}

/**
 * Selects the greatest-`order` validly linked record within a
 * `changeId`/`code`/`requirementId`/`detail` scope group (REQ-006's
 * supersession rule), returning its index, or -1 if none match/link.
 */
export function authoritativeWaiverIndex(
  waiverContext: WaiverContext,
  scope: WaiverScope,
): number {
  const loaded = waiverContext.loaded;
  if (!loaded || loaded.malformed) return -1;
  let best = -1;
  for (let index = 0; index < loaded.waivers.length; index++) {
    const record = loaded.waivers[index]!;
    if (!waiverContext.linkage[index]?.valid) continue;
    if (!scopeMatches(record, scope.changeId, scope.code, scope.requirementId, scope.detail)) continue;
    if (best === -1 || record.order > loaded.waivers[best]!.order) best = index;
  }
  return best;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-008
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-006 REQ-CHANGE-EVIDENCE-WAIVER-008 REQ-CHANGE-EVIDENCE-WAIVER-009 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-004
 */
export function waivedDiagnostic(
  waiverContext: WaiverContext,
  code: WaivableCode,
  message: string,
  changeId: string,
  requirementId: string | undefined,
  detail: string | undefined,
): Diagnostic {
  const base = errorFor(code, message, { changeId, ...(requirementId !== undefined ? { requirementId } : {}), ...(detail !== undefined ? { detail } : {}) });
  const loaded = waiverContext.loaded;
  if (!loaded || loaded.malformed) return base;
  const index = authoritativeWaiverIndex(waiverContext, {
    changeId,
    code,
    ...(requirementId !== undefined ? { requirementId } : {}),
    ...(detail !== undefined ? { detail } : {}),
  });
  if (index === -1) return base;
  const record = loaded.waivers[index]!;
  if (isWaiverStale(waiverContext, index)) return base;
  return {
    ...base,
    severity: 'warning',
    waiver: { approver: record.approver, reason: record.reason, recordedAt: record.recordedAt },
  };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-009
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-006 REQ-CHANGE-EVIDENCE-WAIVER-007 REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-004
 */
export function reportWaiverEvidenceDiagnostics(waiverContext: WaiverContext): Diagnostic[] {
  const loaded = waiverContext.loaded;
  if (!loaded) return [];
  if (loaded.malformed) {
    return [error('CHANGE_WAIVER_EVIDENCE_MALFORMED', `${WAIVER_PATH} is malformed.`, WAIVER_PATH)];
  }
  const diagnostics: Diagnostic[] = [];
  const label = (record: ChangeWaiverRecord): string =>
    `${record.changeId}:${record.code}${record.requirementId ? `:${record.requirementId}` : ''}${record.detail ? `:${record.detail}` : ''}`;
  const groupsSeen = new Set<string>();
  for (let index = 0; index < loaded.waivers.length; index++) {
    const record = loaded.waivers[index]!;
    const linkage = waiverContext.linkage[index]!;
    if (!linkage.valid) {
      diagnostics.push(error(
        'CHANGE_WAIVER_EVIDENCE_MALFORMED',
        `Waiver for ${label(record)} is malformed: ${linkage.reason ?? 'invalid linkage'}.`,
        WAIVER_PATH,
      ));
      continue;
    }
    const scopeKey = JSON.stringify([record.changeId, record.code, record.requirementId, record.detail]);
    if (groupsSeen.has(scopeKey)) continue;
    groupsSeen.add(scopeKey);
    const authoritative = authoritativeWaiverIndex(waiverContext, {
      changeId: record.changeId,
      code: record.code as WaivableCode,
      ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
    });
    if (authoritative === -1) continue;
    const authoritativeRecord = loaded.waivers[authoritative]!;
    if (isWaiverStale(waiverContext, authoritative)) {
      const condition = waiverContext.condition[authoritative];
      const remediation = condition === 'false'
        ? 'The target code is no longer reported for this scope (condition=false); a replacement waiver is not required.'
        : condition === 'true'
          ? 'The waived condition still exists (condition=true); resolve the debt or record an allowed replacement waiver.'
          : 'The waived condition cannot be evaluated; restore an evaluable change, requirement, or batch scope before retrying.';
      diagnostics.push({
        ...error('CHANGE_WAIVER_STALE', `Waiver for ${label(authoritativeRecord)} is stale. ${remediation}`, WAIVER_PATH),
        severity: condition === 'false' ? 'warning' : 'error',
        changeId: authoritativeRecord.changeId,
        ...(authoritativeRecord.requirementId !== undefined ? { requirementId: authoritativeRecord.requirementId } : {}),
        ...(authoritativeRecord.detail !== undefined ? { detail: authoritativeRecord.detail } : {}),
      });
    }
  }
  return diagnostics;
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-010
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-001 REQ-CHANGE-EVIDENCE-WAIVER-002 REQ-CHANGE-EVIDENCE-WAIVER-003 REQ-CHANGE-EVIDENCE-WAIVER-004 REQ-CHANGE-EVIDENCE-WAIVER-005 REQ-CHANGE-EVIDENCE-WAIVER-010 REQ-CHANGE-EVIDENCE-WAIVER-015 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 */
export async function recordChangeWaiver(
  root: string,
  changeId: string,
  code: string,
  requirementId: string | undefined,
  detail: string | undefined,
  approver: string,
  reason: string,
): Promise<{ recorded: boolean; changeId: string; code: string; requirementId?: string; detail?: string }> {
  return withEvidenceWriterLock(root, 'change waiver record', () =>
    recordChangeWaiverUnlocked(root, changeId, code, requirementId, detail, approver, reason));
}

async function recordChangeWaiverUnlocked(
  root: string,
  changeId: string,
  code: string,
  requirementId: string | undefined,
  detail: string | undefined,
  approver: string,
  reason: string,
): Promise<{ recorded: boolean; changeId: string; code: string; requirementId?: string; detail?: string }> {
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
      || !waiverLinkage(order, existing.waivers, index).valid) {
      throw new Error('An existing waiver record is invalid; repair the evidence chain before recording a new waiver.');
    }
  }
  if (!(WAIVABLE_CODES as readonly string[]).includes(code)) {
    throw new Error(`${code} is not a waivable code. Allowed codes: ${WAIVABLE_CODES.join(', ')}.`);
  }
  const waivableCode = code as WaivableCode;
  if (requiresRequirementId(waivableCode) !== (requirementId !== undefined)) {
    throw new Error(requiresRequirementId(waivableCode)
      ? `${waivableCode} is requirement-scoped and requires --requirement.`
      : `${waivableCode} does not accept a --requirement scope.`);
  }
  if (requiresDetail(waivableCode) !== (detail !== undefined)) {
    throw new Error(requiresDetail(waivableCode)
      ? `${waivableCode} is detail-scoped and requires --detail.`
      : `${waivableCode} does not accept a --detail scope.`);
  }
  if (!approver.trim() || !reason.trim()) {
    throw new Error('A non-empty --approver and --reason are required.');
  }
  const tdd = await loadTddEvidence(root);
  const parsed = detail !== undefined ? parseDetail(waivableCode, detail) : null;
  if (requiresDetail(waivableCode) && !parsed) {
    throw new Error(`${detail} is not a valid --detail value for ${waivableCode}.`);
  }
  const scope: WaiverScope = {
    changeId,
    code: waivableCode,
    ...(requirementId !== undefined ? { requirementId } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
  const condition = await evaluateWaiverCondition(root, evidence, tdd, order, scope);
  if (condition === 'indeterminate') {
    const change = evidence?.changes.find((entry) => entry.changeId === changeId);
    if (requirementId !== undefined && change && !change.requirementIds.includes(requirementId)) {
      throw new Error(`The ${waivableCode} scope cannot be evaluated because ${requirementId} is not declared by ${changeId}.`);
    }
    throw new Error(`The ${waivableCode} scope for ${changeId}${requirementId ? `:${requirementId}` : ''}${detail ? `:${detail}` : ''} cannot be evaluated.`);
  }
  if (condition === 'false') {
    throw new Error(`No matching ${waivableCode} diagnostic is currently reported for ${changeId}${requirementId ? `:${requirementId}` : ''}${detail ? `:${detail}` : ''}; the evaluated condition is false.`);
  }
  const waiverContext = await buildWaiverContext(root, evidence, tdd, {
    loaded: existing,
    order,
  });
  const authoritative = authoritativeWaiverIndex(waiverContext, scope);
  if (authoritative !== -1 && !isWaiverStale(waiverContext, authoritative)) {
    throw new Error(`${changeId}:${waivableCode}${requirementId ? `:${requirementId}` : ''}${detail ? `:${detail}` : ''} already has an active waiver.`);
  }
  const snapshotHash = digest(canonicalJson(await snapshotPayload(root, evidence, tdd, order, changeId, waivableCode, requirementId, detail)));
  const orderRecord = await appendEvidenceOrder(root, {
    kind: 'change',
    entityId: changeId,
    phase: 'waiver',
    code: waivableCode,
    ...(requirementId !== undefined ? { requirementId } : {}),
    ...(detail !== undefined ? { detail } : {}),
  });
  const previousSha256 = existing.waivers.at(-1)?.payloadSha256 ?? GENESIS_SHA256;
  const withoutHash: Omit<ChangeWaiverRecord, 'payloadSha256'> = {
    changeId,
    code: waivableCode,
    ...(requirementId !== undefined ? { requirementId } : {}),
    ...(detail !== undefined ? { detail } : {}),
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
  return {
    recorded: true,
    changeId,
    code: waivableCode,
    ...(requirementId !== undefined ? { requirementId } : {}),
    ...(detail !== undefined ? { detail } : {}),
  };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-011
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-006 REQ-CHANGE-EVIDENCE-WAIVER-012 REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-005
 */
export async function activeWaivers(root: string, precomputed?: WaiverContext): Promise<Array<{
  changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string;
}>> {
  const waiverContext = precomputed ?? await buildWaiverContext(
    root,
    await loadChangeEvidence(root),
    await loadTddEvidence(root),
  );
  const loaded = waiverContext.loaded;
  if (!loaded || loaded.malformed) return [];
  const results: Array<{ changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string }> = [];
  const groupsSeen = new Set<string>();
  for (let index = 0; index < loaded.waivers.length; index++) {
    const record = loaded.waivers[index]!;
    if (!waiverContext.linkage[index]?.valid) continue;
    const scopeKey = JSON.stringify([record.changeId, record.code, record.requirementId, record.detail]);
    if (groupsSeen.has(scopeKey)) continue;
    groupsSeen.add(scopeKey);
    const authoritative = authoritativeWaiverIndex(waiverContext, {
      changeId: record.changeId,
      code: record.code as WaivableCode,
      ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
    });
    if (authoritative === -1) continue;
    const authoritativeRecord = loaded.waivers[authoritative]!;
    if (isWaiverStale(waiverContext, authoritative)) continue;
    results.push({
      changeId: authoritativeRecord.changeId,
      code: authoritativeRecord.code,
      ...(authoritativeRecord.requirementId !== undefined ? { requirementId: authoritativeRecord.requirementId } : {}),
      ...(authoritativeRecord.detail !== undefined ? { detail: authoritativeRecord.detail } : {}),
      approver: authoritativeRecord.approver,
      reason: authoritativeRecord.reason,
      recordedAt: authoritativeRecord.recordedAt,
    });
  }
  return results;
}

export async function evaluateChangeWaiverState(
  root: string,
  evidence: ChangeEvidence,
  tdd: TddEvidence,
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>,
  waivers: ChangeWaiverEvidence,
): Promise<{
  stale: Array<{ changeId: string; code: string; requirementId?: string; detail?: string }>;
  authoritative: Map<string, string>;
}> {
  const linkage: Array<{ valid: boolean; reason?: string }> = [];
  const currentHash: Array<string | undefined> = [];
  for (let index = 0; index < waivers.waivers.length; index++) {
    const recordLinkage = waiverLinkage(order, waivers.waivers, index);
    linkage.push(recordLinkage);
    if (recordLinkage.valid) {
      const record = waivers.waivers[index]!;
      currentHash.push(digest(canonicalJson(await snapshotPayload(
        root, evidence, tdd, order, record.changeId, record.code as WaivableCode, record.requirementId, record.detail,
      ))));
    } else {
      currentHash.push(undefined);
    }
  }
  const condition: Array<WaiverCondition | undefined> = [];
  for (let index = 0; index < waivers.waivers.length; index++) {
    const record = waivers.waivers[index]!;
    condition.push(linkage[index]?.valid
      ? await evaluateWaiverCondition(root, evidence, tdd, order, {
          changeId: record.changeId,
          code: record.code as WaivableCode,
          ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
          ...(record.detail !== undefined ? { detail: record.detail } : {}),
        })
      : undefined);
  }
  const context: WaiverContext = {
    loaded: { schemaVersion: 1, waivers: waivers.waivers, malformed: false },
    order,
    linkage,
    currentHash,
    condition,
  };
  const authoritative = new Map<string, string>();
  const stale: Array<{ changeId: string; code: string; requirementId?: string; detail?: string }> = [];
  for (const record of waivers.waivers) {
    const scope = JSON.stringify([record.changeId, record.code, record.requirementId, record.detail]);
    if (authoritative.has(scope)) continue;
    const index = authoritativeWaiverIndex(context, {
      changeId: record.changeId,
      code: record.code as WaivableCode,
      ...(record.requirementId !== undefined ? { requirementId: record.requirementId } : {}),
      ...(record.detail !== undefined ? { detail: record.detail } : {}),
    });
    if (index === -1) continue;
    const selected = waivers.waivers[index]!;
    if (isWaiverStale(context, index)) {
      stale.push({
        changeId: selected.changeId,
        code: selected.code,
        ...(selected.requirementId !== undefined ? { requirementId: selected.requirementId } : {}),
        ...(selected.detail !== undefined ? { detail: selected.detail } : {}),
      });
    }
    authoritative.set(scope, JSON.stringify([
      selected.changeId,
      selected.code,
      selected.requirementId,
      selected.detail,
      selected.approver,
      selected.reason,
      selected.recordedAt,
      selected.snapshotVersion,
      selected.snapshotHash,
    ]));
  }
  return { stale, authoritative };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-012
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-007 REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-005
 */
export async function waiverEvidenceDiagnostics(root: string, precomputed?: WaiverContext): Promise<Diagnostic[]> {
  const waiverContext = precomputed ?? await buildWaiverContext(
    root,
    await loadChangeEvidence(root),
    await loadTddEvidence(root),
  );
  return reportWaiverEvidenceDiagnostics(waiverContext);
}
