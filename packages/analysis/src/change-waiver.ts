import { error, type Diagnostic } from '../../domain/src/index.js';
import { digest, exists, readText, within, writeJson } from './files.js';
import {
  batchFor, batchForKey, batchKey, completenessTddUnsatisfiedCondition, designUnchangedCondition,
  effectiveBatches, greenUnprovenCondition, implementationUnchangedCondition, loadChangeEvidence,
  orderMigrationRequiredBatchCondition, orderMigrationRequiredPhaseCondition, orderMigrationRequiredRequirementCondition,
  phaseMissingCondition, recordMissingCondition, redUnprovenCondition, relevantImplementationUnchangedCondition,
  requirementsUnchangedCondition, testChangedAfterRedCondition, testsUnchangedCondition,
  type ChangeEvidence, type ChangePhase, type ChangeRecord, type ChangeTddBatch,
} from './change-evidence.js';
import { loadTddEvidence, type TddEvidence } from './tdd.js';
import { appendEvidenceOrder, evidenceOrderRecord, inspectEvidenceOrder } from './order.js';

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
    return { schemaVersion: 1, waivers: value.waivers };
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

/** @id CODE-CHANGE-EVIDENCE-WAIVER-019
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-002
 * The inverse parser of `diagnosticDetail`, used to recover structured
 * fields from a stored or supplied `detail` string.
 */
export function parseDetail(code: WaivableCode, detail: string | undefined): ParsedDetail | null {
  if (detail === undefined) return null;
  if (detail.startsWith('phase:')) return { kind: 'phase', phaseName: detail.slice('phase:'.length) };
  if (detail.startsWith('batch:')) {
    const rest = detail.slice('batch:'.length);
    const separator = rest.indexOf(':');
    if (separator === -1) return null;
    return { kind: 'batch', batchPhaseName: rest.slice(0, separator), batchKey: rest.slice(separator + 1) };
  }
  if (detail.startsWith('requirement:')) return { kind: 'requirement', requirementId: detail.slice('requirement:'.length) };
  if (code === 'CHANGE_TESTS_UNCHANGED' || code === 'CHANGE_IMPLEMENTATION_UNCHANGED'
    || code === 'CHANGE_TEST_CHANGED_AFTER_RED' || code === 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED') {
    return { kind: 'batchKey', batchKey: detail };
  }
  return null;
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
  if (!await exists(within(root, changePath))) return null;
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
      requirementsOrder: change?.phases.requirements?.order ?? null,
      red: phaseItem(batch?.red),
      implementation: phaseItem(batch?.implementation),
      green: phaseItem(batch?.green),
      cycles,
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
      const batch = change ? batchForKey(effectiveBatches(change), parsed.batchKey) : undefined;
      const item = batch?.[parsed.batchPhaseName as typeof tddBatchPhaseNames[number]];
      return {
        phaseItemPresent: item != null,
        orderIsInteger: Number.isInteger(item?.order),
        phaseOrder: Number.isInteger(item?.order) ? item!.order : null,
      };
    }
    if (parsed.kind === 'requirement') {
      const cycles = (tdd?.cycles ?? [])
        .filter((cycle) => cycle.requirementId === parsed.requirementId)
        .map((cycle) => ({ redOrder: cycle.red.order ?? null, greenOrder: cycle.green?.order ?? null }))
        .sort((a, b) => (a.redOrder ?? Number.MAX_SAFE_INTEGER) - (b.redOrder ?? Number.MAX_SAFE_INTEGER));
      return { cycles };
    }
    return null;
  }

  if (parsed.kind !== 'batchKey') return null;
  const batch = change ? batchForKey(effectiveBatches(change), parsed.batchKey) : undefined;

  if (code === 'CHANGE_TESTS_UNCHANGED') {
    return { designTests: change?.phases.design?.fingerprints.tests ?? null, batchRedTests: batch?.red?.fingerprints.tests ?? null };
  }
  if (code === 'CHANGE_IMPLEMENTATION_UNCHANGED') {
    return {
      redImplementation: batch?.red?.fingerprints.implementation ?? null,
      implementationImplementation: batch?.implementation?.fingerprints.implementation ?? null,
    };
  }
  if (code === 'CHANGE_TEST_CHANGED_AFTER_RED') {
    return { redTests: batch?.red?.fingerprints.tests ?? null, greenTests: batch?.green?.fingerprints.tests ?? null };
  }
  if (code === 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED') {
    if (requirementId === undefined) return null;
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
export async function waiverLinkage(
  root: string,
  evidence: ChangeEvidence | null,
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>,
  waivers: ChangeWaiverRecord[],
  index: number,
): Promise<{ valid: boolean; reason?: string }> {
  const record = waivers[index];
  if (!record) return { valid: false, reason: 'Waiver record does not exist.' };
  if (!waiverRecordShapeValid(record)) return { valid: false, reason: 'Waiver record has an invalid shape.' };
  if (!waiverChainValid(waivers, index)) return { valid: false, reason: 'Waiver record breaks the evidence chain.' };
  if (!await exists(within(root, `.musubix/changes/${record.changeId}.md`))) {
    return { valid: false, reason: `${record.changeId} has no change document.` };
  }
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
  if (code === 'CHANGE_RECORD_MISSING') {
    const stillMissing = evidence === null || !evidence.changes.some((entry) => entry.changeId === record.changeId);
    if (!stillMissing) return { valid: false, reason: `${record.changeId} now has a chronology record.` };
  } else {
    if (evidence === null) return { valid: false, reason: 'No change evidence is available to link this waiver.' };
    const change = evidence.changes.find((entry) => entry.changeId === record.changeId);
    if (!change) return { valid: false, reason: `${record.changeId} is not a known change.` };
    if (record.requirementId !== undefined && !change.requirementIds.includes(record.requirementId)) {
      return { valid: false, reason: `${record.requirementId} is not declared by ${record.changeId}.` };
    }
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

export interface WaiverContext {
  loaded: LoadedChangeWaiverEvidence | null;
  order: Awaited<ReturnType<typeof inspectEvidenceOrder>>;
  linkage: Array<{ valid: boolean; reason?: string }>;
  currentHash: Array<string | undefined>;
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
): Promise<WaiverContext> {
  const loaded = await loadChangeWaiverEvidence(root);
  const order = await inspectEvidenceOrder(root);
  const linkage: Array<{ valid: boolean; reason?: string }> = [];
  const currentHash: Array<string | undefined> = [];
  if (loaded && !loaded.malformed) {
    for (let index = 0; index < loaded.waivers.length; index++) {
      const recordLinkage = await waiverLinkage(root, evidence, order, loaded.waivers, index);
      linkage.push(recordLinkage);
      if (recordLinkage.valid) {
        const record = loaded.waivers[index]!;
        currentHash.push(digest(canonicalJson(await snapshotPayload(
          root, evidence, tdd, order, record.changeId, record.code as WaivableCode, record.requirementId, record.detail,
        ))));
      } else {
        currentHash.push(undefined);
      }
    }
  }
  return { loaded, order, linkage, currentHash };
}

function nonStale(record: ChangeWaiverRecord, index: number, waiverContext: WaiverContext): boolean {
  return record.snapshotVersion === CURRENT_SNAPSHOT_VERSION && record.snapshotHash === waiverContext.currentHash[index];
}

function scopeMatches(record: ChangeWaiverRecord, changeId: string, code: string, requirementId: string | undefined, detail: string | undefined): boolean {
  return record.changeId === changeId && record.code === code && record.requirementId === requirementId && record.detail === detail;
}

/**
 * Selects the greatest-`order` validly linked record within a
 * `changeId`/`code`/`requirementId`/`detail` scope group (REQ-006's
 * supersession rule), returning its index, or -1 if none match/link.
 */
function authoritativeIndex(
  waiverContext: WaiverContext,
  changeId: string,
  code: string,
  requirementId: string | undefined,
  detail: string | undefined,
): number {
  const loaded = waiverContext.loaded;
  if (!loaded || loaded.malformed) return -1;
  let best = -1;
  for (let index = 0; index < loaded.waivers.length; index++) {
    const record = loaded.waivers[index]!;
    if (!waiverContext.linkage[index]?.valid) continue;
    if (!scopeMatches(record, changeId, code, requirementId, detail)) continue;
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
  const index = authoritativeIndex(waiverContext, changeId, code, requirementId, detail);
  if (index === -1) return base;
  const record = loaded.waivers[index]!;
  if (!nonStale(record, index, waiverContext)) return base;
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
export function reportWaiverEvidenceDiagnostics(
  waiverContext: WaiverContext,
  _evidence: ChangeEvidence | null,
  _tdd: TddEvidence | null,
): Diagnostic[] {
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
    const authoritative = authoritativeIndex(waiverContext, record.changeId, record.code, record.requirementId, record.detail);
    if (authoritative === -1) continue;
    const authoritativeRecord = loaded.waivers[authoritative]!;
    if (!nonStale(authoritativeRecord, authoritative, waiverContext)) {
      diagnostics.push(error('CHANGE_WAIVER_STALE', `Waiver for ${label(authoritativeRecord)} is stale.`, WAIVER_PATH));
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
      || !(await waiverLinkage(root, evidence, order, existing.waivers, index)).valid) {
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
  if (!await exists(within(root, `.musubix/changes/${changeId}.md`))) {
    throw new Error(`${changeId} has no change document.`);
  }
  const change: ChangeRecord | undefined = evidence?.changes.find((entry) => entry.changeId === changeId);
  if (waivableCode !== 'CHANGE_RECORD_MISSING') {
    if (!change) throw new Error(`${changeId} is not a known change.`);
    if (requirementId !== undefined && !change.requirementIds.includes(requirementId)) {
      throw new Error(`${requirementId} is not declared by ${changeId}.`);
    }
  }
  const tdd = await loadTddEvidence(root);
  const parsed = detail !== undefined ? parseDetail(waivableCode, detail) : null;
  if (requiresDetail(waivableCode) && !parsed) {
    throw new Error(`${detail} is not a valid --detail value for ${waivableCode}.`);
  }
  const currentlyReported = await (async (): Promise<boolean> => {
    switch (waivableCode) {
      case 'CHANGE_REQUIREMENTS_UNCHANGED': return requirementsUnchangedCondition(change!);
      case 'CHANGE_DESIGN_UNCHANGED': return designUnchangedCondition(change!);
      case 'CHANGE_RED_UNPROVEN': return redUnprovenCondition(change!, requirementId!, tdd);
      case 'CHANGE_GREEN_UNPROVEN': return greenUnprovenCondition(change!, requirementId!, tdd);
      case 'CHANGE_COMPLETENESS_TDD': return completenessTddUnsatisfiedCondition(change!, requirementId!, tdd);
      case 'CHANGE_RECORD_MISSING': return recordMissingCondition(root, evidence, changeId);
      case 'CHANGE_PHASE_MISSING':
        return parsed?.kind === 'phase' ? phaseMissingCondition(change!, parsed.phaseName) : false;
      case 'CHANGE_ORDER_MIGRATION_REQUIRED': {
        if (!parsed) return false;
        if (parsed.kind === 'phase') return orderMigrationRequiredPhaseCondition(change!, parsed.phaseName);
        if (parsed.kind === 'batch') return orderMigrationRequiredBatchCondition(change!, parsed.batchPhaseName, parsed.batchKey);
        if (parsed.kind === 'requirement') return orderMigrationRequiredRequirementCondition(change!, parsed.requirementId, tdd);
        return false;
      }
      case 'CHANGE_TESTS_UNCHANGED': {
        if (parsed?.kind !== 'batchKey') return false;
        const batch = batchForKey(effectiveBatches(change!), parsed.batchKey);
        return !!batch && testsUnchangedCondition(change!, batch);
      }
      case 'CHANGE_IMPLEMENTATION_UNCHANGED': {
        if (parsed?.kind !== 'batchKey') return false;
        const batch = batchForKey(effectiveBatches(change!), parsed.batchKey);
        return !!batch && implementationUnchangedCondition(batch);
      }
      case 'CHANGE_TEST_CHANGED_AFTER_RED': {
        if (parsed?.kind !== 'batchKey') return false;
        const batch = batchForKey(effectiveBatches(change!), parsed.batchKey);
        return !!batch && testChangedAfterRedCondition(batch);
      }
      case 'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED': {
        if (parsed?.kind !== 'batchKey' || requirementId === undefined) return false;
        const batch = batchForKey(effectiveBatches(change!), parsed.batchKey);
        return !!batch && relevantImplementationUnchangedCondition(batch, requirementId);
      }
      default: return false;
    }
  })();
  if (!currentlyReported) {
    throw new Error(`No matching ${waivableCode} diagnostic is currently reported for ${changeId}${requirementId ? `:${requirementId}` : ''}${detail ? `:${detail}` : ''}.`);
  }
  for (let index = 0; index < existing.waivers.length; index++) {
    const record = existing.waivers[index]!;
    if (scopeMatches(record, changeId, waivableCode, requirementId, detail)
      && (await waiverLinkage(root, evidence, order, existing.waivers, index)).valid) {
      const hash = digest(canonicalJson(await snapshotPayload(root, evidence, tdd, order, changeId, waivableCode, requirementId, detail)));
      if (record.snapshotVersion === CURRENT_SNAPSHOT_VERSION && record.snapshotHash === hash) {
        throw new Error(`${changeId}:${waivableCode}${requirementId ? `:${requirementId}` : ''}${detail ? `:${detail}` : ''} already has an active waiver.`);
      }
    }
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
export async function activeWaivers(root: string): Promise<Array<{
  changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string;
}>> {
  const loaded = await loadChangeWaiverEvidence(root);
  if (!loaded || loaded.malformed) return [];
  const evidence = await loadChangeEvidence(root);
  const tdd = await loadTddEvidence(root);
  const waiverContext = await buildWaiverContext(root, evidence, tdd);
  const results: Array<{ changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string }> = [];
  const groupsSeen = new Set<string>();
  for (let index = 0; index < loaded.waivers.length; index++) {
    const record = loaded.waivers[index]!;
    if (!waiverContext.linkage[index]?.valid) continue;
    const scopeKey = JSON.stringify([record.changeId, record.code, record.requirementId, record.detail]);
    if (groupsSeen.has(scopeKey)) continue;
    groupsSeen.add(scopeKey);
    const authoritative = authoritativeIndex(waiverContext, record.changeId, record.code, record.requirementId, record.detail);
    if (authoritative === -1) continue;
    const authoritativeRecord = loaded.waivers[authoritative]!;
    if (!nonStale(authoritativeRecord, authoritative, waiverContext)) continue;
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

/** @id CODE-CHANGE-EVIDENCE-WAIVER-012
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-007 REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-005
 */
export async function waiverEvidenceDiagnostics(root: string): Promise<Diagnostic[]> {
  const loaded = await loadChangeWaiverEvidence(root);
  const evidence = await loadChangeEvidence(root);
  const tdd = await loadTddEvidence(root);
  const waiverContext = await buildWaiverContext(root, evidence, tdd);
  return reportWaiverEvidenceDiagnostics({ ...waiverContext, loaded }, evidence, tdd);
}
