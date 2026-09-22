import { link, mkdir, open, readFile, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { error, type Diagnostic } from '../../domain/src/index.js';
import {
  canonicalJson,
  evaluateChangeWaiverState,
  loadChangeWaiverEvidence,
  type ChangeWaiverEvidence,
  type ChangeWaiverRecord,
} from './change-waiver.js';
import {
  assertEvidenceMergeReady,
  assertEvidenceMergeStartable,
  evidenceJournals,
} from './evidence-merge-guard.js';
import {
  assertCoordinatedEvidenceRead,
  withEvidenceWriterLock,
} from './evidence-writer-lock.js';
import {
  batchKey,
  effectiveBatches,
  loadChangeEvidence,
  qualityIdentity,
  qualityLineage,
  qualityPayloadForIdentity,
  type ChangeEvidence,
  type ChangePhase,
  type ChangePhaseEvidence,
  type ChangeRecord,
  type ChangeTddBatch,
} from './change-evidence.js';
import { digest, exists, readText, safePath, within } from './files.js';
import {
  loadEvidenceOrder,
  validateEvidenceOrderLog,
  type EvidenceOrderLog,
  type EvidenceOrderRecord,
} from './order.js';
import {
  loadTddEvidence,
  type TddChainPhase,
  type TddChainRecord,
  type TddCycle,
  type TddEvidence,
} from './tdd.js';

const EVIDENCE_DIR = '.musubix/evidence';
const ORDER_PATH = `${EVIDENCE_DIR}/order.json`;
const TDD_PATH = `${EVIDENCE_DIR}/tdd.json`;
const CHANGES_PATH = `${EVIDENCE_DIR}/changes.json`;
const WAIVERS_PATH = `${EVIDENCE_DIR}/change-waivers.json`;
const JOURNAL_PATH = `${EVIDENCE_DIR}/.merge-transaction.json`;
const STAGING_PREFIX = `${EVIDENCE_DIR}/.merge-transaction.`;
const TARGETS = [ORDER_PATH, TDD_PATH, CHANGES_PATH, WAIVERS_PATH] as const;
const TDD_PHASES = ['red', 'green', 'refactor', 'migrate', 'void'] as const;
const CHANGE_PHASES = ['impact', 'requirements', 'design', 'red', 'implementation', 'green', 'quality'] as const;
const BATCH_PHASES = ['red', 'implementation', 'green'] as const;

type SourceName = 'base' | 'incoming';
type TargetPath = typeof TARGETS[number];

export interface EvidenceMergeDiagnostic {
  code: string;
  message: string;
  file?: string;
  identity?: string;
}

export interface EvidenceMergeFileStatus {
  path: TargetPath;
  changed: boolean;
}

export interface EvidenceMergeReport {
  valid: boolean;
  preserved: number;
  deduplicated: number;
  appended: number;
  revalidationRequired: boolean;
  diagnostics: EvidenceMergeDiagnostic[];
  followUpDiagnostics: Diagnostic[];
  staleWaivers: Array<{ changeId: string; code: string; requirementId?: string; detail?: string }>;
  supersededScopes: Array<{ changeId: string; code: string; requirementId?: string; detail?: string }>;
  files: EvidenceMergeFileStatus[];
}

export interface EvidenceMergeOptions {
  dryRun?: boolean;
  /** Test-only deterministic fault injection. */
  faultAt?: string;
}

export interface EvidenceMergeRecoveryReport {
  recovered: boolean;
  action: 'nothing-to-recover' | 'rolled-back' | 'rolled-forward';
  discardedStaging: boolean;
}

interface EvidenceHistory {
  root: string;
  order: EvidenceOrderLog;
  tdd: TddEvidence;
  changes: ChangeEvidence;
  waivers: ChangeWaiverEvidence;
  waiverFilePresent: boolean;
  raw: Partial<Record<TargetPath, string>>;
}

interface PayloadRef {
  kind: 'tdd' | 'change' | 'waiver';
  identity: string;
  value: unknown;
}

interface OrderEntry {
  source: SourceName;
  record: EvidenceOrderRecord;
  payload?: PayloadRef;
}

interface MergePlan {
  base: EvidenceHistory;
  incoming: EvidenceHistory;
  entries: OrderEntry[];
  baseOrderMap: Map<number, number>;
  incomingOrderMap: Map<number, number>;
  preserved: number;
  deduplicated: number;
  appended: number;
  retainedIncomingPayload: boolean;
  diagnostics: EvidenceMergeDiagnostic[];
}

interface Candidates {
  order: EvidenceOrderLog;
  tdd: TddEvidence;
  changes: ChangeEvidence;
  waivers: ChangeWaiverEvidence;
  includeWaivers: boolean;
  bytes: Partial<Record<TargetPath, string>>;
}

interface JournalTarget {
  path: TargetPath;
  existed: boolean;
  originalBase64: string;
  originalSha256: string;
  candidateBase64: string;
  candidateSha256: string;
  temporaryPath: string;
}

interface MergeJournal {
  schemaVersion: 1;
  transactionId: string;
  state: 'prepared' | 'committed';
  targets: JournalTarget[];
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function mergeDiagnostic(code: string, message: string, file?: string, identity?: string): EvidenceMergeDiagnostic {
  return {
    code,
    message,
    ...(file !== undefined ? { file } : {}),
    ...(identity !== undefined ? { identity } : {}),
  };
}

function reconstructedFree(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reconstructedFree);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !['sequence', 'order', 'previousSha256', 'recordSha256', 'payloadSha256', 'phaseEvidenceSha256'].includes(key))
    .map(([key, entry]) => [key, reconstructedFree(entry)]));
}

function semanticEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(reconstructedFree(left)) === canonicalJson(reconstructedFree(right));
}

function nonWaiverOrderKey(record: EvidenceOrderRecord): string {
  return canonicalJson([
    record.kind,
    record.entityId,
    record.phase,
    record.code ?? null,
    record.requirementId ?? null,
    record.detail ?? null,
  ]);
}

function waiverIdentity(record: ChangeWaiverRecord): string {
  return canonicalJson([
    record.changeId,
    record.code,
    record.requirementId ?? null,
    record.detail ?? null,
    record.approver,
    record.reason,
    record.recordedAt,
    record.snapshotVersion,
    record.snapshotHash,
  ]);
}

function batchPhase(record: EvidenceOrderRecord, change: ChangeRecord): ChangePhaseEvidence | undefined {
  const [phase, key] = record.phase.split(':', 2);
  if (!BATCH_PHASES.includes(phase as typeof BATCH_PHASES[number])) return undefined;
  if (key === undefined) return change.phases[phase as ChangePhase];
  const batch = change.tddBatches?.find((entry) => batchKey(entry.requirementIds) === key);
  return batch?.[phase as typeof BATCH_PHASES[number]];
}

function payloadFor(history: EvidenceHistory, record: EvidenceOrderRecord): PayloadRef | undefined {
  if (record.kind === 'tdd') {
    const cycle = history.tdd.cycles.find((entry) => entry.cycleId === record.entityId);
    const value = cycle?.[record.phase as TddChainPhase];
    return value ? { kind: 'tdd', identity: `${record.entityId}:${record.phase}`, value } : undefined;
  }
  if (record.phase === 'waiver') {
    const waiver = history.waivers.waivers.find((entry) => entry.order === record.sequence);
    return waiver ? { kind: 'waiver', identity: waiverIdentity(waiver), value: waiver } : undefined;
  }
  const change = history.changes.changes.find((entry) => entry.changeId === record.entityId);
  if (!change) return undefined;
  if (/^quality(?::[1-9]\d*)?$/.test(record.phase)) {
    const value = qualityPayloadForIdentity(change, record.phase);
    return value ? { kind: 'change', identity: `${record.entityId}:${record.phase}`, value } : undefined;
  }
  const value = batchPhase(record, change);
  return value ? { kind: 'change', identity: `${record.entityId}:${record.phase}`, value } : undefined;
}

function orderKey(entry: OrderEntry): string {
  if (entry.record.kind === 'change' && entry.record.phase === 'waiver') {
    return entry.payload?.kind === 'waiver'
      ? `paired-waiver:${entry.payload.identity}`
      : `unpaired-waiver:${entry.source}:${entry.record.sequence}`;
  }
  return nonWaiverOrderKey(entry.record);
}

async function readRequired(root: string, path: TargetPath): Promise<string> {
  try {
    return await readText(root, path);
  } catch {
    throw new Error(`Required evidence file is missing: ${path}`);
  }
}

async function loadHistory(root: string): Promise<EvidenceHistory> {
  const rawOrder = await readRequired(root, ORDER_PATH);
  const rawTdd = await readRequired(root, TDD_PATH);
  const rawChanges = await readRequired(root, CHANGES_PATH);
  const waiverFilePresent = await exists(within(root, WAIVERS_PATH));
  const rawWaivers = waiverFilePresent ? await readText(root, WAIVERS_PATH) : undefined;
  const order = await loadEvidenceOrder(root);
  const tdd = await loadTddEvidence(root);
  const changes = await loadChangeEvidence(root);
  const loadedWaivers = await loadChangeWaiverEvidence(root);
  if (!order || !tdd || !changes) throw new Error('Required evidence history is incomplete.');
  const orderValidation = validateEvidenceOrderLog(order);
  if (!orderValidation.valid) throw new Error(`Invalid evidence order: ${orderValidation.diagnostics.map((item) => item.code).join(', ')}`);
  if (loadedWaivers?.malformed) throw new Error('Invalid change waiver evidence.');
  return {
    root,
    order,
    tdd,
    changes,
    waivers: loadedWaivers ?? { schemaVersion: 1, waivers: [] },
    waiverFilePresent,
    raw: {
      [ORDER_PATH]: rawOrder,
      [TDD_PATH]: rawTdd,
      [CHANGES_PATH]: rawChanges,
      ...(rawWaivers !== undefined ? { [WAIVERS_PATH]: rawWaivers } : {}),
    },
  };
}

function validateInputEntities(history: EvidenceHistory): EvidenceMergeDiagnostic[] {
  const diagnostics: EvidenceMergeDiagnostic[] = [];
  const cycles = new Set<string>();
  for (const cycle of history.tdd.cycles) {
    if (!cycle.cycleId || cycles.has(cycle.cycleId)) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Duplicate or missing TDD cycle ID.', TDD_PATH, cycle.cycleId ?? 'missing'));
    } else cycles.add(cycle.cycleId);
  }
  const changes = new Set<string>();
  for (const change of history.changes.changes) {
    if (changes.has(change.changeId)) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Duplicate change ID.', CHANGES_PATH, change.changeId));
    } else changes.add(change.changeId);
    const batchKeys = new Set<string>();
    for (const batch of change.tddBatches ?? []) {
      const key = batchKey(batch.requirementIds);
      if (batchKeys.has(key)) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Duplicate persisted requirement batch key.',
          CHANGES_PATH, `${change.changeId}:${key}`));
      }
      batchKeys.add(key);
    }
  }
  const phaseSet = new Set<string>();
  for (const record of history.tdd.chain ?? []) {
    const key = `${record.cycleId}:${record.phase}`;
    if (phaseSet.has(key)) diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Duplicate TDD chain identity.', TDD_PATH, key));
    phaseSet.add(key);
  }
  for (const cycle of history.tdd.cycles) {
    for (const phase of TDD_PHASES) {
      const value = cycle[phase];
      if (value && !phaseSet.has(`${cycle.cycleId}:${phase}`)) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Missing TDD chain identity.', TDD_PATH, `${cycle.cycleId}:${phase}`));
      }
      if (value && !Number.isInteger(value.order)) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
          'TDD phase lacks monotonic order evidence; migrate or regenerate it before merging.',
          TDD_PATH, `${cycle.cycleId}:${phase}`));
      }
      if (value?.order !== undefined) {
        const matches = history.order.records.filter((record) =>
          record.sequence === value.order && record.kind === 'tdd'
          && record.entityId === cycle.cycleId && record.phase === phase);
        if (matches.length !== 1) {
          diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'TDD phase does not pair to exactly one order record.',
            TDD_PATH, `${cycle.cycleId}:${phase}`));
        }
      }
    }
  }
  for (const key of phaseSet) {
    const [cycleId, phase] = key.split(':', 2);
    const cycle = history.tdd.cycles.find((entry) => entry.cycleId === cycleId);
    if (!cycle?.[phase as TddChainPhase]) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Extra TDD chain identity.', TDD_PATH, key));
    }
  }
  for (const change of history.changes.changes) {
    if (history.changes.schemaVersion === 1 && change.qualityHistory !== undefined) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
        'Schema version 1 cannot contain Quality history.', CHANGES_PATH, change.changeId));
    }
    const historyShapeValid = change.qualityHistory === undefined
      || (Array.isArray(change.qualityHistory) && change.qualityHistory.length > 0);
    if (!historyShapeValid) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
        'Quality history must be a non-empty array when present.', CHANGES_PATH, change.changeId));
    }
    if (Array.isArray(change.qualityHistory) && change.qualityHistory.length > 0 && !change.phases.quality) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
        'Quality history requires an authoritative Quality checkpoint.', CHANGES_PATH, change.changeId));
    }
    const lineage = Array.isArray(change.qualityHistory)
      ? [...change.qualityHistory, ...(change.phases.quality ? [change.phases.quality] : [])]
      : [...(change.phases.quality ? [change.phases.quality] : [])];
    const qualityIdentities = new Set<string>();
    let previousQualityOrder = 0;
    for (const [index, value] of lineage.entries()) {
      const identity = qualityIdentity(index + 1);
      qualityIdentities.add(identity);
      if (value.phase !== 'quality' || typeof value.recordedAt !== 'string'
        || !value.fingerprints || !Number.isInteger(value.order) || value.order! <= previousQualityOrder) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
          'Quality lineage checkpoint is malformed.', CHANGES_PATH, `${change.changeId}:${identity}`));
        continue;
      }
      previousQualityOrder = value.order!;
      const matches = history.order.records.filter((record) =>
        record.sequence === value.order && record.kind === 'change'
        && record.entityId === change.changeId && record.phase === identity);
      if (matches.length !== 1) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
          'Quality checkpoint does not pair to exactly one order record.',
          CHANGES_PATH, `${change.changeId}:${identity}`));
      }
    }
    if (history.order.records.some((record) =>
      record.kind === 'change' && record.entityId === change.changeId
      && /^quality(?::\d+)?$/.test(record.phase) && !qualityIdentities.has(record.phase))) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
        'Quality order identity is orphaned or malformed.', CHANGES_PATH, change.changeId));
    }
    for (const phase of CHANGE_PHASES.filter((entry) => entry !== 'quality')) {
      const value = change.phases[phase];
      if (value && !Number.isInteger(value.order)) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
          'Change phase lacks monotonic order evidence; migrate or regenerate it before merging.',
          CHANGES_PATH, `${change.changeId}:${phase}`));
      }
      if (!value?.order) continue;
      const matches = history.order.records.filter((record) =>
        record.sequence === value.order && record.kind === 'change'
        && record.entityId === change.changeId && record.phase === phase);
      if (matches.length !== 1) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Change phase does not pair to exactly one order record.',
          CHANGES_PATH, `${change.changeId}:${phase}`));
      }
    }
    for (const batch of change.tddBatches ?? []) {
      const key = batchKey(batch.requirementIds);
      for (const phase of BATCH_PHASES) {
        const value = batch[phase];
        if (value && !Number.isInteger(value.order)) {
          diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
            'Change batch phase lacks monotonic order evidence; migrate or regenerate it before merging.',
            CHANGES_PATH, `${change.changeId}:${phase}:${key}`));
        }
        if (!value?.order) continue;
        const matches = history.order.records.filter((record) =>
          record.sequence === value.order && record.kind === 'change'
          && record.entityId === change.changeId && record.phase === `${phase}:${key}`);
        if (matches.length !== 1) {
          diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Change batch phase does not pair to exactly one order record.',
            CHANGES_PATH, `${change.changeId}:${phase}:${key}`));
        }
      }
    }
  }
  for (const waiver of history.waivers.waivers) {
    const matches = history.order.records.filter((record) =>
      record.sequence === waiver.order && record.kind === 'change'
      && record.entityId === waiver.changeId && record.phase === 'waiver'
      && record.code === waiver.code && record.requirementId === waiver.requirementId
      && record.detail === waiver.detail);
    if (matches.length !== 1) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Waiver does not pair to exactly one order record.',
        WAIVERS_PATH, waiverIdentity(waiver)));
    }
  }
  return diagnostics;
}

async function validateIncomingWorktree(root: string, base: EvidenceHistory, incoming: EvidenceHistory): Promise<EvidenceMergeDiagnostic[]> {
  const diagnostics: EvidenceMergeDiagnostic[] = [];
  const newChangeIds = new Set<string>();
  for (const change of incoming.changes.changes) {
    const baseChange = base.changes.changes.find((entry) => entry.changeId === change.changeId);
    if (!baseChange || !semanticEqual(baseChange, change)) newChangeIds.add(change.changeId);
  }
  for (const waiver of incoming.waivers.waivers) {
    if (!base.waivers.waivers.some((entry) => waiverIdentity(entry) === waiverIdentity(waiver))) {
      newChangeIds.add(waiver.changeId);
    }
  }
  for (const changeId of newChangeIds) {
    if (!await exists(within(root, `.musubix/changes/${changeId}.md`))) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_WORKTREE_INCOMPLETE',
        `Incoming evidence requires .musubix/changes/${changeId}.md in the current worktree.`,
        `.musubix/changes/${changeId}.md`, changeId));
    }
  }
  return diagnostics;
}

/** @id CODE-EVIDENCE-HISTORY-MERGE-001
 * @implements REQ-EVIDENCE-HISTORY-MERGE-001 REQ-EVIDENCE-HISTORY-MERGE-003
 * @design DES-EVIDENCE-HISTORY-MERGE-001
 */
async function planEvidenceMerge(root: string, incomingRoot: string): Promise<MergePlan> {
  const [baseReal, incomingReal] = await Promise.all([realpath(root), realpath(incomingRoot)]);
  const nested = (parent: string, child: string): boolean => {
    const rel = relative(parent, child);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  };
  if (nested(baseReal, incomingReal) || nested(incomingReal, baseReal)) {
    throw new Error('Incoming evidence root must be path-disjoint from the current root.');
  }
  const [base, incoming] = await Promise.all([loadHistory(baseReal), loadHistory(incomingReal)]);
  const diagnostics = [
    ...validateInputEntities(base),
    ...validateInputEntities(incoming),
    ...await validateIncomingWorktree(baseReal, base, incoming),
  ];
  const entries: OrderEntry[] = base.order.records.map((record) => {
    const payload = payloadFor(base, record);
    return { source: 'base', record, ...(payload ? { payload } : {}) };
  });
  const baseOrderMap = new Map<number, number>(base.order.records.map((record) => [record.sequence, record.sequence]));
  const incomingOrderMap = new Map<number, number>();
  const byKey = new Map(entries.map((entry) => [orderKey(entry), entry]));
  let deduplicated = 0;
  let retainedIncomingPayload = false;
  let previousMapped = 0;
  for (const record of incoming.order.records) {
    const payload = payloadFor(incoming, record);
    const entry: OrderEntry = { source: 'incoming', record, ...(payload ? { payload } : {}) };
    const key = orderKey(entry);
    const existing = byKey.get(key);
    let mapped: number;
    if (existing) {
      if (existing.record.testId !== record.testId) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Matching order identity has a different testId.', ORDER_PATH,
          `${record.kind}:${record.entityId}:${record.phase}`));
      } else if (existing.payload && payload && !semanticEqual(existing.payload.value, payload.value)) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Matching logical evidence has divergent payloads.',
          record.kind === 'tdd' ? TDD_PATH : CHANGES_PATH, payload.identity));
      } else if (!existing.payload && payload) {
        existing.payload = payload;
        retainedIncomingPayload = true;
      }
      mapped = existing.record.sequence;
      deduplicated += 1;
    } else {
      mapped = entries.length + 1;
      entries.push(entry);
      byKey.set(key, entry);
      if (payload) retainedIncomingPayload = true;
    }
    incomingOrderMap.set(record.sequence, mapped);
    if (mapped <= previousMapped) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Deduplication would invert incoming chronology.', ORDER_PATH,
        `${record.kind}:${record.entityId}:${record.phase}`));
    }
    previousMapped = mapped;
  }
  return {
    base,
    incoming,
    entries,
    baseOrderMap,
    incomingOrderMap,
    preserved: base.order.records.length,
    deduplicated,
    appended: entries.length - base.order.records.length,
    retainedIncomingPayload,
    diagnostics,
  };
}

function mappedOrder(source: SourceName, order: number | undefined, plan: MergePlan): number | undefined {
  if (order === undefined) return undefined;
  return (source === 'base' ? plan.baseOrderMap : plan.incomingOrderMap).get(order);
}

function rewritePhase<T extends { order?: number }>(value: T, source: SourceName, plan: MergePlan): T {
  const clone = structuredClone(value);
  const order = mappedOrder(source, clone.order, plan);
  if (order === undefined) delete clone.order;
  else clone.order = order;
  return clone;
}

function buildOrder(plan: MergePlan): EvidenceOrderLog {
  const records: EvidenceOrderRecord[] = [];
  for (const entry of plan.entries) {
    const previousSha256 = records.at(-1)?.recordSha256 ?? null;
    const { recordSha256: _recordSha256, ...original } = entry.record;
    const payload: Omit<EvidenceOrderRecord, 'recordSha256'> = {
      ...original,
      sequence: records.length + 1,
      previousSha256,
    };
    records.push({ ...payload, recordSha256: digest(JSON.stringify(payload)) });
  }
  return { ...plan.base.order, schemaVersion: 1, records };
}

function cycleHeaderEqual(left: TddCycle, right: TddCycle): boolean {
  return left.requirementId === right.requirementId
    && left.testId === right.testId
    && left.testPath === right.testPath
    && left.commandName === right.commandName;
}

function mergeTdd(plan: MergePlan, diagnostics: EvidenceMergeDiagnostic[]): TddEvidence {
  const cycles: TddCycle[] = [];
  const byId = new Map<string, TddCycle>();
  const owners = new Map<string, SourceName>();
  for (const source of ['base', 'incoming'] as const) {
    const history = source === 'base' ? plan.base : plan.incoming;
    for (const sourceCycle of history.tdd.cycles) {
      const cycleId = sourceCycle.cycleId!;
      let target = byId.get(cycleId);
      if (!target) {
        target = structuredClone(sourceCycle);
        cycles.push(target);
        byId.set(cycleId, target);
        for (const phase of TDD_PHASES) if (sourceCycle[phase]) owners.set(`${cycleId}:${phase}`, source);
        continue;
      }
      if (!cycleHeaderEqual(target, sourceCycle)) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Matching cycle ID has different header fields.', TDD_PATH, cycleId));
        continue;
      }
      for (const phase of TDD_PHASES) {
        const incomingPhase = sourceCycle[phase];
        const existingPhase = target[phase];
        if (incomingPhase && existingPhase && !semanticEqual(existingPhase, incomingPhase)) {
          diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Matching cycle phase has divergent payloads.', TDD_PATH, `${cycleId}:${phase}`));
        } else if (incomingPhase && !existingPhase) {
          (target as unknown as Record<string, unknown>)[phase] = structuredClone(incomingPhase);
          owners.set(`${cycleId}:${phase}`, source);
        }
      }
    }
  }
  for (const cycle of cycles) {
    for (const phase of TDD_PHASES) {
      const value = cycle[phase];
      if (!value) continue;
      (cycle as unknown as Record<string, unknown>)[phase] = rewritePhase(value, owners.get(`${cycle.cycleId}:${phase}`) ?? 'base', plan);
    }
  }
  const phaseEntries: Array<{
    cycle: TddCycle; phase: TddChainPhase; value: unknown; order: number; template?: TddChainRecord;
  }> = [];
  for (const cycle of cycles) {
    for (const phase of TDD_PHASES) {
      const value = cycle[phase];
      if (value?.order !== undefined) {
        const owner = owners.get(`${cycle.cycleId}:${phase}`) ?? 'base';
        const source = owner === 'base' ? plan.base : plan.incoming;
        const template = source.tdd.chain?.find((entry) => entry.cycleId === cycle.cycleId && entry.phase === phase);
        phaseEntries.push({ cycle, phase, value, order: value.order, ...(template ? { template } : {}) });
      }
    }
  }
  phaseEntries.sort((left, right) => left.order - right.order);
  const chain: TddChainRecord[] = [];
  for (const entry of phaseEntries) {
    const {
      recordSha256: _recordSha256,
      sequence: _sequence,
      previousSha256: _previousSha256,
      phaseEvidenceSha256: _phaseEvidenceSha256,
      cycleId: _cycleId,
      requirementId: _requirementId,
      testId: _testId,
      testPath: _testPath,
      commandName: _commandName,
      phase: _phase,
      ...unknown
    } = entry.template ?? {} as TddChainRecord;
    const payload: Omit<TddChainRecord, 'recordSha256'> = {
      sequence: chain.length + 1,
      cycleId: entry.cycle.cycleId!,
      requirementId: entry.cycle.requirementId,
      testId: entry.cycle.testId,
      testPath: entry.cycle.testPath,
      commandName: entry.cycle.commandName,
      phase: entry.phase,
      phaseEvidenceSha256: digest(JSON.stringify(entry.value)),
      previousSha256: chain.at(-1)?.recordSha256 ?? null,
      ...unknown,
    };
    chain.push({ ...payload, recordSha256: digest(JSON.stringify(payload)) });
  }
  return { ...plan.base.tdd, schemaVersion: 1, cycles, chain };
}

function rewriteChangePhase(value: ChangePhaseEvidence, source: SourceName, plan: MergePlan): ChangePhaseEvidence {
  return rewritePhase(value, source, plan);
}

function mergeBatch(target: ChangeTddBatch, incoming: ChangeTddBatch, plan: MergePlan,
  diagnostics: EvidenceMergeDiagnostic[], changeId: string): void {
  for (const phase of BATCH_PHASES) {
    const left = target[phase];
    const right = incoming[phase];
    if (left && right && !semanticEqual(left, right)) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Matching change batch phase has divergent payloads.',
        CHANGES_PATH, `${changeId}:${phase}:${batchKey(target.requirementIds)}`));
    } else if (!left && right) {
      target[phase] = rewriteChangePhase(right, 'incoming', plan);
    }
  }
}

function mergeChanges(plan: MergePlan, diagnostics: EvidenceMergeDiagnostic[]): ChangeEvidence {
  const changes = structuredClone(plan.base.changes.changes);
  const byId = new Map(changes.map((change) => [change.changeId, change]));
  for (const change of changes) {
    for (const phase of CHANGE_PHASES.filter((entry) => entry !== 'quality')) {
      const item = change.phases[phase];
      if (item) change.phases[phase] = rewriteChangePhase(item, 'base', plan);
    }
    if (change.qualityHistory) {
      change.qualityHistory = change.qualityHistory.map((item) => rewriteChangePhase(item, 'base', plan));
    }
    if (change.phases.quality) change.phases.quality = rewriteChangePhase(change.phases.quality, 'base', plan);
    for (const batch of change.tddBatches ?? []) {
      for (const phase of BATCH_PHASES) {
        const item = batch[phase];
        if (item) batch[phase] = rewriteChangePhase(item, 'base', plan);
      }
    }
  }
  for (const sourceChange of plan.incoming.changes.changes) {
    const target = byId.get(sourceChange.changeId);
    if (!target) {
      const clone = structuredClone(sourceChange);
      for (const phase of CHANGE_PHASES.filter((entry) => entry !== 'quality')) {
        const item = clone.phases[phase];
        if (item) clone.phases[phase] = rewriteChangePhase(item, 'incoming', plan);
      }
      if (clone.qualityHistory) {
        clone.qualityHistory = clone.qualityHistory.map((item) => rewriteChangePhase(item, 'incoming', plan));
      }
      if (clone.phases.quality) clone.phases.quality = rewriteChangePhase(clone.phases.quality, 'incoming', plan);
      for (const batch of clone.tddBatches ?? []) {
        for (const phase of BATCH_PHASES) {
          const item = batch[phase];
          if (item) batch[phase] = rewriteChangePhase(item, 'incoming', plan);
        }
      }
      changes.push(clone);
      byId.set(clone.changeId, clone);
      continue;
    }
    if (canonicalJson([...target.requirementIds].sort()) !== canonicalJson([...sourceChange.requirementIds].sort())) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Matching change ID has different requirement IDs.',
        CHANGES_PATH, sourceChange.changeId));
      continue;
    }
    for (const phase of CHANGE_PHASES.filter((entry) => entry !== 'quality')) {
      const left = target.phases[phase];
      const right = sourceChange.phases[phase];
      if (left && right && !semanticEqual(left, right)) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Matching change phase has divergent payloads.',
          CHANGES_PATH, `${sourceChange.changeId}:${phase}`));
      } else if (!left && right) target.phases[phase] = rewriteChangePhase(right, 'incoming', plan);
    }
    const leftLineage = qualityLineage(target);
    const rightLineage = qualityLineage(sourceChange);
    const shared = Math.min(leftLineage.length, rightLineage.length);
    const prefix = Array.from({ length: shared }, (_, index) =>
      semanticEqual(leftLineage[index], rightLineage[index])).every(Boolean);
    if (!prefix) {
      diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT',
        'Quality lineages diverge at the same ordinal.', CHANGES_PATH, sourceChange.changeId));
    } else if (rightLineage.length > leftLineage.length) {
      const rewritten = rightLineage.map((item) => rewriteChangePhase(item, 'incoming', plan));
      target.phases.quality = rewritten.at(-1)!;
      if (rewritten.length > 1) target.qualityHistory = rewritten.slice(0, -1);
      else delete target.qualityHistory;
    }
    for (const incomingBatch of sourceChange.tddBatches ?? []) {
      const targetBatches = target.tddBatches ??= [];
      const key = batchKey(incomingBatch.requirementIds);
      const matches = targetBatches.filter((batch) => batchKey(batch.requirementIds) === key);
      if (matches.length > 1) {
        diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_CONFLICT', 'Ambiguous duplicate requirement batch key.',
          CHANGES_PATH, `${sourceChange.changeId}:${key}`));
      } else if (matches.length === 1) {
        mergeBatch(matches[0]!, incomingBatch, plan, diagnostics, sourceChange.changeId);
      } else {
        const clone = structuredClone(incomingBatch);
        for (const phase of BATCH_PHASES) {
          const item = clone[phase];
          if (item) clone[phase] = rewriteChangePhase(item, 'incoming', plan);
        }
        targetBatches.push(clone);
      }
    }
  }
  const hasHistory = changes.some((change) => (change.qualityHistory?.length ?? 0) > 0);
  return {
    ...plan.base.changes,
    schemaVersion: hasHistory || plan.base.changes.schemaVersion === 2 || plan.incoming.changes.schemaVersion === 2 ? 2 : 1,
    changes,
  };
}

function mergeWaivers(plan: MergePlan): ChangeWaiverEvidence {
  const waivers = structuredClone(plan.base.waivers.waivers).map((record) => rewritePhase(record, 'base', plan));
  const identities = new Set(waivers.map(waiverIdentity));
  for (const source of plan.incoming.waivers.waivers) {
    const identity = waiverIdentity(source);
    if (!identities.has(identity)) {
      waivers.push(rewritePhase(structuredClone(source), 'incoming', plan));
      identities.add(identity);
    }
  }
  let previousSha256 = '0'.repeat(64);
  for (const waiver of waivers) {
    waiver.previousSha256 = previousSha256;
    const { payloadSha256: _payloadSha256, ...payload } = waiver;
    waiver.payloadSha256 = digest(canonicalJson(payload));
    previousSha256 = waiver.payloadSha256;
  }
  return { ...plan.base.waivers, schemaVersion: 1, waivers };
}

function validateQualityOrder(changes: ChangeEvidence): EvidenceMergeDiagnostic[] {
  const diagnostics: EvidenceMergeDiagnostic[] = [];
  for (const change of changes.changes) {
    const quality = change.phases.quality?.order;
    if (quality === undefined) continue;
    for (const batch of effectiveBatches(change)) {
      for (const phase of ['red', 'implementation'] as const) {
        const order = batch[phase]?.order;
        if (order !== undefined && quality <= order) {
          diagnostics.push(mergeDiagnostic('EVIDENCE_MERGE_QUALITY_ORDER',
            `${change.changeId}:quality is not after ${phase}.`, CHANGES_PATH, `${change.changeId}:${phase}`));
        }
      }
    }
  }
  return diagnostics;
}

function validateCandidateReferences(
  order: EvidenceOrderLog,
  tdd: TddEvidence,
  changes: ChangeEvidence,
  waivers: ChangeWaiverEvidence,
): EvidenceMergeDiagnostic[] {
  const diagnostics: EvidenceMergeDiagnostic[] = [];
  const orderAt = new Map(order.records.map((record) => [record.sequence, record]));
  const chainKeys = new Set<string>();
  for (const [index, record] of (tdd.chain ?? []).entries()) {
    const key = `${record.cycleId}:${record.phase}`;
    const expectedPrevious = index === 0 ? null : tdd.chain![index - 1]!.recordSha256;
    const { recordSha256, ...payload } = record;
    if (record.sequence !== index + 1 || record.previousSha256 !== expectedPrevious
      || recordSha256 !== digest(JSON.stringify(payload))) {
      diagnostics.push(mergeDiagnostic('TDD_CHAIN_HASH_MISMATCH', 'Rebuilt TDD chain linkage or hash is invalid.', TDD_PATH, key));
    }
    if (chainKeys.has(key)) {
      diagnostics.push(mergeDiagnostic('TDD_CHAIN_PHASE_DUPLICATE', 'Rebuilt TDD chain identity is duplicated.', TDD_PATH, key));
    }
    chainKeys.add(key);
  }
  for (const cycle of tdd.cycles) {
    for (const phase of TDD_PHASES) {
      const value = cycle[phase];
      if (!value) continue;
      const identity = `${cycle.cycleId}:${phase}`;
      const record = value.order === undefined ? undefined : orderAt.get(value.order);
      if (!record || record.kind !== 'tdd' || record.entityId !== cycle.cycleId || record.phase !== phase) {
        diagnostics.push(mergeDiagnostic('TDD_ORDER_MISMATCH', 'Rebuilt TDD phase does not match its order record.', TDD_PATH, identity));
      }
      const chain = tdd.chain?.find((entry) => entry.cycleId === cycle.cycleId && entry.phase === phase);
      if (!chain || chain.phaseEvidenceSha256 !== digest(JSON.stringify(value))) {
        diagnostics.push(mergeDiagnostic('TDD_CHAIN_PAYLOAD_MISMATCH', 'Rebuilt TDD phase does not match its chain payload hash.', TDD_PATH, identity));
      }
      chainKeys.delete(identity);
    }
    if (cycle.green?.order !== undefined && cycle.red.order !== undefined && cycle.green.order <= cycle.red.order) {
      diagnostics.push(mergeDiagnostic('TDD_ORDER_SEQUENCE', 'Green is not after Red in monotonic evidence order.',
        TDD_PATH, `${cycle.cycleId}:green`));
    }
    if (cycle.refactor?.order !== undefined && cycle.green?.order !== undefined
      && cycle.refactor.order <= cycle.green.order) {
      diagnostics.push(mergeDiagnostic('TDD_ORDER_SEQUENCE', 'Refactor is not after Green in monotonic evidence order.',
        TDD_PATH, `${cycle.cycleId}:refactor`));
    }
    const latestNonMigrateOrder = cycle.refactor?.valid ? cycle.refactor.order : cycle.green?.order;
    if (cycle.migrate?.order !== undefined && latestNonMigrateOrder !== undefined
      && cycle.migrate.order <= latestNonMigrateOrder) {
      diagnostics.push(mergeDiagnostic('TDD_ORDER_SEQUENCE', 'Migrate is not after Green/Refactor in monotonic evidence order.',
        TDD_PATH, `${cycle.cycleId}:migrate`));
    }
  }
  for (const identity of chainKeys) {
    diagnostics.push(mergeDiagnostic('TDD_CHAIN_ORPHAN', 'Rebuilt TDD chain entry has no phase payload.', TDD_PATH, identity));
  }
  for (const change of changes.changes) {
    for (const phase of CHANGE_PHASES.filter((entry) => entry !== 'quality')) {
      const value = change.phases[phase];
      if (!value) continue;
      const record = value.order === undefined ? undefined : orderAt.get(value.order);
      if (!record || record.kind !== 'change' || record.entityId !== change.changeId || record.phase !== phase) {
        diagnostics.push(mergeDiagnostic('CHANGE_ORDER_MISMATCH', 'Rebuilt change phase does not match its order record.',
          CHANGES_PATH, `${change.changeId}:${phase}`));
      }
    }
    const qualityIdentities = new Set<string>();
    let previousQualityOrder = 0;
    for (const [index, value] of qualityLineage(change).entries()) {
      const identity = qualityIdentity(index + 1);
      qualityIdentities.add(identity);
      const record = value.order === undefined ? undefined : orderAt.get(value.order);
      if (!record || record.kind !== 'change' || record.entityId !== change.changeId
        || record.phase !== identity || value.order! <= previousQualityOrder) {
        diagnostics.push(mergeDiagnostic('CHANGE_QUALITY_HISTORY_MALFORMED',
          'Rebuilt Quality checkpoint does not match its ordinal order record.',
          CHANGES_PATH, `${change.changeId}:${identity}`));
      }
      previousQualityOrder = value.order ?? previousQualityOrder;
    }
    if (order.records.some((record) =>
      record.kind === 'change' && record.entityId === change.changeId
      && /^quality(?::\d+)?$/.test(record.phase) && !qualityIdentities.has(record.phase))) {
      diagnostics.push(mergeDiagnostic('CHANGE_QUALITY_HISTORY_MALFORMED',
        'Rebuilt Quality order record is orphaned.', CHANGES_PATH, change.changeId));
    }
    const fullSetKey = batchKey(change.requirementIds);
    if (change.phases.requirements?.order !== undefined && change.phases.impact?.order !== undefined
      && change.phases.requirements.order <= change.phases.impact.order) {
      diagnostics.push(mergeDiagnostic('CHANGE_PHASE_ORDER', 'Requirements is not after impact.',
        CHANGES_PATH, `${change.changeId}:requirements`));
    }
    if (change.phases.design?.order !== undefined && change.phases.requirements?.order !== undefined
      && change.phases.design.order <= change.phases.requirements.order) {
      diagnostics.push(mergeDiagnostic('CHANGE_PHASE_ORDER', 'Design is not after requirements.',
        CHANGES_PATH, `${change.changeId}:design`));
    }
    for (const batch of effectiveBatches(change)) {
      const key = batchKey(batch.requirementIds);
      for (const phase of BATCH_PHASES) {
        const value = batch[phase];
        if (!value) continue;
        const expectedPhase = key === fullSetKey ? phase : `${phase}:${key}`;
        const record = value.order === undefined ? undefined : orderAt.get(value.order);
        if (!record || record.kind !== 'change' || record.entityId !== change.changeId || record.phase !== expectedPhase) {
          diagnostics.push(mergeDiagnostic('CHANGE_ORDER_MISMATCH', 'Rebuilt change batch phase does not match its order record.',
            CHANGES_PATH, `${change.changeId}:${phase}:${key}`));
        }
      }
      const ordered = [
        change.phases.design?.order,
        batch.red?.order,
        batch.implementation?.order,
        batch.green?.order,
        change.phases.quality?.order,
      ].filter((value): value is number => value !== undefined);
      if (ordered.some((value, index) => index > 0 && value <= ordered[index - 1]!)) {
        diagnostics.push(mergeDiagnostic('CHANGE_PHASE_ORDER', 'Rebuilt change chronology is out of order.',
          CHANGES_PATH, `${change.changeId}:${key}`));
      }
    }
  }
  let previousSha256 = '0'.repeat(64);
  for (const waiver of waivers.waivers) {
    const identity = waiverIdentity(waiver);
    const record = orderAt.get(waiver.order);
    if (!record || record.kind !== 'change' || record.entityId !== waiver.changeId || record.phase !== 'waiver'
      || record.code !== waiver.code || record.requirementId !== waiver.requirementId || record.detail !== waiver.detail) {
      diagnostics.push(mergeDiagnostic('CHANGE_WAIVER_EVIDENCE_MALFORMED', 'Rebuilt waiver does not match its order record.',
        WAIVERS_PATH, identity));
    }
    const { payloadSha256, ...payload } = waiver;
    if (waiver.previousSha256 !== previousSha256 || payloadSha256 !== digest(canonicalJson(payload))) {
      diagnostics.push(mergeDiagnostic('CHANGE_WAIVER_EVIDENCE_MALFORMED', 'Rebuilt waiver hash chain is invalid.',
        WAIVERS_PATH, identity));
    }
    previousSha256 = waiver.payloadSha256;
  }
  return diagnostics;
}

/** @id CODE-EVIDENCE-HISTORY-MERGE-002
 * @implements REQ-EVIDENCE-HISTORY-MERGE-002 REQ-EVIDENCE-HISTORY-MERGE-003
 * @design DES-EVIDENCE-HISTORY-MERGE-002
 */
function buildCandidates(plan: MergePlan): Candidates {
  const diagnostics = plan.diagnostics;
  const candidateDiagnosticStart = diagnostics.length;
  const order = buildOrder(plan);
  const tdd = mergeTdd(plan, diagnostics);
  const changes = mergeChanges(plan, diagnostics);
  const waivers = mergeWaivers(plan);
  diagnostics.push(...validateQualityOrder(changes));
  diagnostics.push(...validateCandidateReferences(order, tdd, changes, waivers));
  const orderValidation = validateEvidenceOrderLog(order);
  diagnostics.push(...orderValidation.diagnostics.map((item) =>
    mergeDiagnostic(item.code, item.message, item.path ?? ORDER_PATH)));
  if (diagnostics.length > candidateDiagnosticStart) {
    diagnostics.push(mergeDiagnostic(
      'EVIDENCE_MERGE_CANDIDATE_INVALID',
      'The reconstructed evidence candidate is structurally invalid; see the accompanying diagnostics.',
    ));
  }
  const includeWaivers = plan.base.waiverFilePresent || waivers.waivers.length > 0;
  return {
    order,
    tdd,
    changes,
    waivers,
    includeWaivers,
    bytes: {
      [ORDER_PATH]: json(order),
      [TDD_PATH]: json(tdd),
      [CHANGES_PATH]: json(changes),
      ...(includeWaivers ? { [WAIVERS_PATH]: json(waivers) } : {}),
    },
  };
}

async function fsyncPath(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function fsyncDirectory(path: string): Promise<void> {
  try {
    await fsyncPath(path);
  } catch (cause) {
    if (!['EISDIR', 'EPERM', 'EACCES', 'EINVAL'].includes((cause as NodeJS.ErrnoException).code ?? '')) throw cause;
  }
}

async function removeIfPresent(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function originalBytes(root: string, path: TargetPath): Promise<{ existed: boolean; bytes: string }> {
  const absolute = await safePath(root, path);
  try {
    return { existed: true, bytes: await readFile(absolute, 'utf8') };
  } catch {
    return { existed: false, bytes: '' };
  }
}

async function restoreJournal(root: string, journal: MergeJournal): Promise<void> {
  const evidenceDirectory = await safePath(root, EVIDENCE_DIR);
  for (const target of journal.targets) {
    const absolute = await safePath(root, target.path);
    if (target.existed) {
      const staging = `${absolute}.${journal.transactionId}.restore`;
      await writeFile(staging, Buffer.from(target.originalBase64, 'base64'));
      await fsyncPath(staging);
      await rename(staging, absolute);
    } else {
      await removeIfPresent(absolute);
    }
    await removeIfPresent(await safePath(root, target.temporaryPath));
  }
  await fsyncDirectory(evidenceDirectory);
  await removeIfPresent(await safePath(root, JOURNAL_PATH));
  await fsyncDirectory(evidenceDirectory);
}

/** @id CODE-EVIDENCE-HISTORY-MERGE-003
 * @implements REQ-EVIDENCE-HISTORY-MERGE-004
 * @design DES-EVIDENCE-HISTORY-MERGE-003
 */
async function applyCandidates(root: string, candidates: Candidates, faultAt?: string): Promise<void> {
  const transactionId = crypto.randomUUID();
  const targets: JournalTarget[] = [];
  for (const path of TARGETS) {
    const candidate = candidates.bytes[path];
    if (candidate === undefined) continue;
    const original = await originalBytes(root, path);
    targets.push({
      path,
      existed: original.existed,
      originalBase64: Buffer.from(original.bytes).toString('base64'),
      originalSha256: digest(original.bytes),
      candidateBase64: Buffer.from(candidate).toString('base64'),
      candidateSha256: digest(candidate),
      temporaryPath: `${path}.${transactionId}.merge`,
    });
  }
  const journal: MergeJournal = { schemaVersion: 1, transactionId, state: 'prepared', targets };
  const journalAbsolute = await safePath(root, JOURNAL_PATH);
  const stagingJournal = await safePath(root, `${STAGING_PREFIX}${transactionId}.json`);
  await mkdir(dirname(journalAbsolute), { recursive: true });
  if (faultAt === 'journal:staging') throw new Error('Injected evidence merge failure at journal:staging.');
  await writeFile(stagingJournal, json(journal), { flag: 'wx' });
  await fsyncPath(stagingJournal);
  if (faultAt === 'journal:publication') {
    throw new Error('EVIDENCE_MERGE_RECOVERY_REQUIRED: injected failure at journal:publication.');
  }
  try {
    await link(stagingJournal, journalAbsolute);
    await unlink(stagingJournal);
  } catch (cause) {
    await removeIfPresent(stagingJournal);
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('EVIDENCE_MERGE_RECOVERY_REQUIRED: another merge transaction was published.');
    }
    throw cause;
  }
  await fsyncDirectory(dirname(journalAbsolute));
  try {
    for (let index = 0; index < targets.length; index++) {
      if (faultAt === `temporary:${index}`) throw new Error(`Injected evidence merge failure at temporary:${index}.`);
      const target = targets[index]!;
      const temporary = await safePath(root, target.temporaryPath);
      await writeFile(temporary, Buffer.from(target.candidateBase64, 'base64'), { flag: 'wx' });
      await fsyncPath(temporary);
    }
    for (let index = 0; index < targets.length; index++) {
      if (faultAt === `replace:${index}`) throw new Error(`Injected evidence merge failure at replace:${index}.`);
      const target = targets[index]!;
      await rename(await safePath(root, target.temporaryPath), await safePath(root, target.path));
    }
    await fsyncDirectory(dirname(journalAbsolute));
    journal.state = 'committed';
    const commitStaging = await safePath(root, `${STAGING_PREFIX}${transactionId}.commit.json`);
    await writeFile(commitStaging, json(journal), { flag: 'wx' });
    await fsyncPath(commitStaging);
    if (faultAt === 'commit-marker') throw new Error('Injected evidence merge failure at commit-marker.');
    await rename(commitStaging, journalAbsolute);
    await fsyncDirectory(dirname(journalAbsolute));
    if (faultAt === 'cleanup') throw new Error('EVIDENCE_MERGE_RECOVERY_REQUIRED: injected failure at cleanup.');
    await removeIfPresent(journalAbsolute);
  } catch (cause) {
    const injected = cause instanceof Error && cause.message.startsWith('Injected evidence merge failure');
    if (injected && journal.state === 'prepared') {
      await restoreJournal(root, journal);
      throw cause;
    }
    throw new Error(`EVIDENCE_MERGE_RECOVERY_REQUIRED: ${
      cause instanceof Error ? cause.message : String(cause)
    }`);
  }
}

function reportFor(plan: MergePlan, candidates: Candidates): EvidenceMergeReport {
  const diagnostics = [...plan.diagnostics];
  const valid = diagnostics.length === 0;
  const files = TARGETS.map((path) => ({
    path,
    changed: candidates.bytes[path] !== undefined && candidates.bytes[path] !== plan.base.raw[path],
  }));
  return {
    valid,
    preserved: plan.preserved,
    deduplicated: plan.deduplicated,
    appended: plan.appended,
    revalidationRequired: plan.appended > 0 || plan.retainedIncomingPayload,
    diagnostics,
    followUpDiagnostics: [],
    staleWaivers: [],
    supersededScopes: [],
    files,
  };
}

/** @id CODE-EVIDENCE-HISTORY-MERGE-004
 * @implements REQ-EVIDENCE-HISTORY-MERGE-001 REQ-EVIDENCE-HISTORY-MERGE-004 REQ-EVIDENCE-HISTORY-MERGE-005
 * @design DES-EVIDENCE-HISTORY-MERGE-004
 */
export async function mergeEvidenceHistories(
  root: string,
  incoming: string,
  options: EvidenceMergeOptions = {},
): Promise<EvidenceMergeReport> {
  if (options.dryRun) {
    await assertCoordinatedEvidenceRead(root);
    await assertCoordinatedEvidenceRead(incoming);
    return mergeEvidenceHistoriesUnlocked(root, incoming, options);
  }
  return withEvidenceWriterLock(root, 'evidence merge', async () => {
    await assertCoordinatedEvidenceRead(incoming);
    return mergeEvidenceHistoriesUnlocked(root, incoming, options);
  });
}

async function mergeEvidenceHistoriesUnlocked(
  root: string,
  incoming: string,
  options: EvidenceMergeOptions,
): Promise<EvidenceMergeReport> {
  await assertEvidenceMergeStartable(root);
  const plan = await planEvidenceMerge(resolve(root), resolve(incoming));
  const candidates = buildCandidates(plan);
  const report = reportFor(plan, candidates);
  if (report.valid) {
    const [baseWaiverState, mergedWaiverState] = await Promise.all([
      evaluateChangeWaiverState(
        plan.base.root,
        plan.base.changes,
        plan.base.tdd,
        validateEvidenceOrderLog(plan.base.order),
        plan.base.waivers,
      ),
      evaluateChangeWaiverState(
        plan.base.root,
        candidates.changes,
        candidates.tdd,
        validateEvidenceOrderLog(candidates.order),
        candidates.waivers,
      ),
    ]);
    report.staleWaivers = mergedWaiverState.stale;
    report.followUpDiagnostics = mergedWaiverState.stale.map((scope) => ({
      code: 'EVIDENCE_MERGE_WAIVER_STALE',
      severity: 'warning',
      message: `Merged waiver ${scope.changeId}:${scope.code} is stale and inactive.`,
      path: WAIVERS_PATH,
      changeId: scope.changeId,
      ...(scope.requirementId !== undefined ? { requirementId: scope.requirementId } : {}),
      ...(scope.detail !== undefined ? { detail: scope.detail } : {}),
    }));
    for (const [scope, selected] of mergedWaiverState.authoritative) {
      if (baseWaiverState.authoritative.get(scope) === selected) continue;
      const [changeId, code, requirementId, detail] = JSON.parse(scope) as [
        string, string, string | null, string | null,
      ];
      report.supersededScopes.push({
        changeId,
        code,
        ...(requirementId !== null ? { requirementId } : {}),
        ...(detail !== null ? { detail } : {}),
      });
    }
  }
  if (!report.valid || options.dryRun) return report;
  await applyCandidates(plan.base.root, candidates, options.faultAt);
  return report;
}

export { assertEvidenceMergeReady, assertEvidenceMergeStartable };

function unsafeRecovery(reason: string, inventory: string[]): Error {
  return new Error(
    `EVIDENCE_MERGE_RECOVERY_UNSAFE: ${reason} Journal: ${JOURNAL_PATH}. `
    + `Merge-owned files: ${inventory.length ? inventory.join(', ') : 'none found'}. `
    + 'Manual remediation: back up .musubix/evidence; restore or verify order.json, tdd.json, changes.json, '
    + 'and change-waivers.json from a trusted source; quarantine the listed merge files; rerun structural validation.',
  );
}

function validateJournal(journal: MergeJournal): void {
  if (journal.schemaVersion !== 1 || typeof journal.transactionId !== 'string' || !journal.transactionId
    || !Array.isArray(journal.targets) || !['prepared', 'committed'].includes(journal.state)) {
    throw new Error('EVIDENCE_MERGE_RECOVERY_UNSAFE: published merge journal is invalid.');
  }
  const paths = new Set<TargetPath>();
  for (const target of journal.targets) {
    if (!TARGETS.includes(target.path) || paths.has(target.path)
      || typeof target.existed !== 'boolean'
      || typeof target.originalBase64 !== 'string' || typeof target.originalSha256 !== 'string'
      || typeof target.candidateBase64 !== 'string' || typeof target.candidateSha256 !== 'string'
      || typeof target.temporaryPath !== 'string'
      || !target.temporaryPath.startsWith(`${target.path}.${journal.transactionId}.`)
      || digest(Buffer.from(target.originalBase64, 'base64')) !== target.originalSha256
      || digest(Buffer.from(target.candidateBase64, 'base64')) !== target.candidateSha256) {
      throw new Error('EVIDENCE_MERGE_RECOVERY_UNSAFE: published merge journal target is invalid.');
    }
    paths.add(target.path);
  }
  for (const required of [ORDER_PATH, TDD_PATH, CHANGES_PATH] as const) {
    if (!paths.has(required)) {
      throw new Error('EVIDENCE_MERGE_RECOVERY_UNSAFE: published merge journal is missing a required target.');
    }
  }
}

function validateJournalCandidates(journal: MergeJournal): void {
  try {
    const values = new Map(journal.targets.map((target) => [
      target.path,
      JSON.parse(Buffer.from(target.candidateBase64, 'base64').toString('utf8')) as unknown,
    ]));
    const order = values.get(ORDER_PATH) as EvidenceOrderLog;
    const tdd = values.get(TDD_PATH) as TddEvidence;
    const changes = values.get(CHANGES_PATH) as ChangeEvidence;
    const waivers = (values.get(WAIVERS_PATH) as ChangeWaiverEvidence | undefined) ?? { schemaVersion: 1, waivers: [] };
    const diagnostics = [
      ...validateEvidenceOrderLog(order).diagnostics.map((item) =>
        mergeDiagnostic(item.code, item.message, item.path ?? ORDER_PATH)),
      ...validateQualityOrder(changes),
      ...validateCandidateReferences(order, tdd, changes, waivers),
    ];
    if (diagnostics.length) {
      throw new Error(diagnostics.map((item) => `${item.code}:${item.identity ?? item.file ?? 'unknown'}`).join(', '));
    }
  } catch (cause) {
    throw new Error(`EVIDENCE_MERGE_RECOVERY_UNSAFE: journaled candidate evidence is invalid: ${
      cause instanceof Error ? cause.message : String(cause)
    }`);
  }
}

export async function recoverEvidenceMerge(root: string): Promise<EvidenceMergeRecoveryReport> {
  return withEvidenceWriterLock(root, 'evidence merge --recover', () => recoverEvidenceMergeUnlocked(root));
}

async function recoverEvidenceMergeUnlocked(root: string): Promise<EvidenceMergeRecoveryReport> {
  const journals = await evidenceJournals(root);
  if (journals.merge && journals.qualityRefresh) {
    throw new Error('EVIDENCE_MERGE_RECOVERY_UNSAFE: merge and Quality-refresh journals coexist.');
  }
  if (journals.qualityRefresh) {
    throw new Error('CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED: run change quality-recover.');
  }
  const journalAbsolute = await safePath(root, JOURNAL_PATH);
  const evidenceDir = await safePath(root, EVIDENCE_DIR);
  let staging: string[] = [];
  try {
    staging = (await (await import('node:fs/promises')).readdir(evidenceDir))
      .filter((entry) => entry.startsWith('.merge-transaction.') && entry !== '.merge-transaction.json');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }
  if (!await exists(journalAbsolute)) {
    for (const entry of staging) await removeIfPresent(resolve(evidenceDir, entry));
    return { recovered: false, action: 'nothing-to-recover', discardedStaging: staging.length > 0 };
  }
  let journal: MergeJournal;
  try {
    journal = JSON.parse(await readFile(journalAbsolute, 'utf8')) as MergeJournal;
  } catch {
    throw unsafeRecovery('Published merge journal is unreadable.', [JOURNAL_PATH, ...staging]);
  }
  const inventory = [
    JOURNAL_PATH,
    ...staging.map((entry) => `${EVIDENCE_DIR}/${entry}`),
    ...(Array.isArray(journal.targets)
      ? journal.targets.flatMap((target) => typeof target?.temporaryPath === 'string' ? [target.temporaryPath] : [])
      : []),
  ];
  try {
    validateJournal(journal);
  } catch (cause) {
    throw unsafeRecovery(cause instanceof Error ? cause.message : String(cause), inventory);
  }
  if (journal.state === 'prepared') {
    await restoreJournal(root, journal);
    for (const entry of staging) await removeIfPresent(resolve(evidenceDir, entry));
    return { recovered: true, action: 'rolled-back', discardedStaging: staging.length > 0 };
  }
  try {
    validateJournalCandidates(journal);
  } catch (cause) {
    throw unsafeRecovery(cause instanceof Error ? cause.message : String(cause), inventory);
  }
  for (const target of journal.targets) {
    const absolute = await safePath(root, target.path);
    let actual = '';
    try {
      actual = await readFile(absolute, 'utf8');
    } catch {
      actual = '';
    }
    if (digest(actual) !== target.candidateSha256) {
      const stagingPath = `${absolute}.${journal.transactionId}.recover`;
      await writeFile(stagingPath, Buffer.from(target.candidateBase64, 'base64'));
      await fsyncPath(stagingPath);
      await rename(stagingPath, absolute);
      await fsyncDirectory(evidenceDir);
    }
    const verified = await readFile(absolute, 'utf8');
    if (digest(verified) !== target.candidateSha256) {
      throw unsafeRecovery('Candidate verification failed after rewrite.', inventory);
    }
  }
  await fsyncDirectory(evidenceDir);
  await removeIfPresent(journalAbsolute);
  for (const entry of staging) await removeIfPresent(resolve(evidenceDir, entry));
  await fsyncDirectory(evidenceDir);
  return { recovered: true, action: 'rolled-forward', discardedStaging: staging.length > 0 };
}
