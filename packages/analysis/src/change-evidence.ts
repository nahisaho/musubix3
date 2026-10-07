import { exists, readText, within } from './files.js';

// Shared change-chronology data model and pure accessors used by both
// change.ts (recording/validation) and change-waiver.ts (waiver evidence).
// Kept in its own module, with no dependency on either, to avoid a
// module-dependency cycle between them.

export const changePhases = ['impact', 'requirements', 'design', 'red', 'implementation', 'green', 'quality'] as const;
export type ChangePhase = typeof changePhases[number];

export interface ChangeFingerprints {
  impact: string;
  requirements: string;
  design: string;
  implementation: string;
  tests: string;
  tdd: string;
  requirementImplementations?: Record<string, {
    paths: string[];
    fingerprints: Record<string, string>;
  }>;
}

export interface ChangePhaseEvidence {
  phase: ChangePhase;
  order?: number;
  recordedAt: string;
  fingerprints: ChangeFingerprints;
  allowUnchanged?: boolean;
}

export interface ChangeTddBatch {
  requirementIds: string[];
  red?: ChangePhaseEvidence;
  implementation?: ChangePhaseEvidence;
  green?: ChangePhaseEvidence;
}

export interface ChangeRecord {
  changeId: string;
  requirementIds: string[];
  phases: Partial<Record<ChangePhase, ChangePhaseEvidence>>;
  tddBatches?: ChangeTddBatch[];
  qualityHistory?: ChangePhaseEvidence[];
}

export interface ChangeEvidence {
  schemaVersion: 1 | 2;
  changes: ChangeRecord[];
}

export interface ChangeCompleteness {
  changeId: string;
  functionalRequirements: number;
  nonFunctionalRequirements: number;
  requirements: number;
  completeRequirements: number;
  valid: boolean;
}

export async function loadChangeEvidence(root: string): Promise<ChangeEvidence | null> {
  const path = '.musubix/evidence/changes.json';
  if (!await exists(within(root, path))) return null;
  const value = JSON.parse(await readText(root, path)) as ChangeEvidence;
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1 || !Array.isArray(value.changes)) {
    throw new Error('Invalid change chronology evidence.');
  }
  if (value.schemaVersion > 2) {
    throw new Error(`CHANGE_EVIDENCE_SCHEMA_UNSUPPORTED: schema version ${value.schemaVersion} is not supported.`);
  }
  return value;
}

/** @id CODE-CHANGE-QUALITY-REFRESH-001
 * @implements REQ-CHANGE-QUALITY-REFRESH-001 REQ-CHANGE-QUALITY-REFRESH-003
 * @design DES-CHANGE-QUALITY-REFRESH-001
 */
export function qualityLineage(change: ChangeRecord): ChangePhaseEvidence[] {
  const quality = change.phases.quality;
  return [...(change.qualityHistory ?? []), ...(quality ? [quality] : [])];
}

export function qualityIdentity(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error('Quality ordinal must be a positive integer.');
  return ordinal === 1 ? 'quality' : `quality:${ordinal}`;
}

export function qualityPayloadForIdentity(
  change: ChangeRecord,
  identity: string,
): ChangePhaseEvidence | undefined {
  const match = /^quality(?::([1-9]\d*))?$/.exec(identity);
  if (!match) return undefined;
  const ordinal = match[1] === undefined ? 1 : Number(match[1]);
  const lineage = qualityLineage(change);
  return lineage[ordinal - 1];
}

export function qualityOrderIdentity(change: ChangeRecord, checkpoint: ChangePhaseEvidence): string {
  const index = qualityLineage(change).findIndex((entry) => entry === checkpoint);
  if (index < 0) throw new Error('Quality checkpoint is not part of the supplied change lineage.');
  return qualityIdentity(index + 1);
}

/** @id CODE-CHANGE-REQUIREMENT-BATCHES-001
 * @implements REQ-CHANGE-REQUIREMENT-BATCHES-001 REQ-CHANGE-REQUIREMENT-BATCHES-003 REQ-CHANGE-REQUIREMENT-BATCHES-004
 * @design DES-CHANGE-REQUIREMENT-BATCHES-001
 */
export function effectiveBatches(change: ChangeRecord): ChangeTddBatch[] {
  const batches = change.tddBatches ?? [];
  if (change.phases.red || change.phases.implementation || change.phases.green) {
    const legacyBatch: ChangeTddBatch = { requirementIds: [...change.requirementIds] };
    if (change.phases.red) legacyBatch.red = change.phases.red;
    if (change.phases.implementation) legacyBatch.implementation = change.phases.implementation;
    if (change.phases.green) legacyBatch.green = change.phases.green;
    return [legacyBatch, ...batches];
  }
  return batches;
}

/** @id CODE-CHANGE-REQUIREMENT-BATCHES-003
 * @implements REQ-CHANGE-REQUIREMENT-BATCHES-005
 * @design DES-CHANGE-REQUIREMENT-BATCHES-002
 */
export function batchFor(batches: ChangeTddBatch[], requirementId: string): ChangeTddBatch | undefined {
  const applicable = batches.filter((batch) => batch.requirementIds.includes(requirementId));
  const ordered = applicable.filter((batch) => Number.isInteger(batch.red?.order));
  if (!ordered.length) return applicable[0];
  return ordered.reduce((selected, batch) =>
    batch.red!.order! >= selected.red!.order! ? batch : selected);
}

/** @id CODE-TDD-GREEN-REQUIREMENT-SCOPING-002
 * @implements REQ-TDD-GREEN-REQUIREMENT-SCOPING-003
 * @design DES-TDD-GREEN-REQUIREMENT-SCOPING-002
 * Fail-fast precondition for `tdd red`/`tdd green`, checked by
 * `runTddPhaseUnlocked` (`tdd.ts`) before any side effect. Both phases first
 * share the same "does any candidate change have `phases.design` recorded"
 * check; only once a design-satisfied candidate exists does `green` go on to
 * distinguish a missing `implementation` from a missing `red`. This mirrors
 * `change.ts`'s own `recordChangePhaseUnlocked` phase-precedence rules
 * (`design` before `red` before `implementation` before `green`) so the
 * reported `missingPhase` always names a `change-record` command `change.ts`
 * would itself currently accept.
 */
export function changeRecordPhasePrecondition(
  evidence: ChangeEvidence | null,
  phase: 'red' | 'green',
  requirementId: string,
): { satisfied: boolean; changeId?: string; missingPhase?: 'design' | 'red' | 'implementation' } {
  const candidates = (evidence?.changes ?? []).filter((change) => change.requirementIds.includes(requirementId));
  const designSatisfied = candidates.filter((change) => change.phases.design);
  if (!designSatisfied.length) {
    return {
      satisfied: false,
      missingPhase: 'design',
      ...(candidates[0] ? { changeId: candidates[0].changeId } : {}),
    };
  }
  if (phase === 'red') return { satisfied: true };

  const batchesByChange = designSatisfied.map((change) => ({
    change,
    batch: batchFor(effectiveBatches(change), requirementId),
  }));
  if (batchesByChange.some(({ batch }) => batch?.red && batch.implementation)) {
    return { satisfied: true };
  }
  const withRed = batchesByChange.find(({ batch }) => batch?.red);
  if (withRed) {
    return { satisfied: false, changeId: withRed.change.changeId, missingPhase: 'implementation' };
  }
  return { satisfied: false, changeId: designSatisfied[0]!.changeId, missingPhase: 'red' };
}

export function currentRequirementIdsForBatch(
  batches: ChangeTddBatch[],
  batch: ChangeTddBatch,
  requirementIds: string[],
): string[] {
  // `batch` must be an element of `batches`; callers intentionally share one
  // effectiveBatches() result so duplicate batch keys remain distinguishable.
  return requirementIds.filter((requirementId) => batchFor(batches, requirementId) === batch);
}

export function currentTddOrderWindow(
  change: ChangeRecord,
  requirementId: string,
): { after: number; through: number } | undefined {
  const requirementsOrder = change.phases.requirements?.order;
  const batches = effectiveBatches(change);
  const batch = batchFor(batches, requirementId);
  const currentRedOrder = batch?.red?.order;
  if (!Number.isInteger(requirementsOrder) || !Number.isInteger(currentRedOrder)) return undefined;
  const previousRedOrders = batches
    .filter((candidate) =>
      candidate.requirementIds.includes(requirementId)
      && Number.isInteger(candidate.red?.order)
      && candidate.red!.order! < currentRedOrder!)
    .map((candidate) => candidate.red!.order!);
  return {
    after: Math.max(requirementsOrder!, ...previousRedOrders),
    through: currentRedOrder!,
  };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-014
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 * Relocated here (unchanged body) from `change.ts`, which already imports
 * from this module, so a `batchForKey` selector living here can reuse this
 * canonical definition without creating a module-dependency cycle.
 */
export function batchKey(requirementIds: string[]): string {
  return [...new Set(requirementIds)].sort().join(',');
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-015
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-016
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 */
export function batchForKey(batches: ChangeTddBatch[], key: string): ChangeTddBatch | undefined {
  return batches.find((batch) => batchKey(batch.requirementIds) === key);
}

export function batchesForKey<T extends { requirementIds: string[] }>(batches: T[], key: string): T[] {
  return batches.filter((batch) => batchKey(batch.requirementIds) === key);
}

// Pure, side-effect-free re-derivations of the exact "would this diagnostic
// currently fire" conditions used by change.ts's validators. Kept here (with
// no dependency on change.ts or change-waiver.ts) so change-waiver.ts can
// check for a currently-reported diagnostic without importing change.ts,
// which would otherwise create a module dependency cycle.

export function requirementsUnchangedCondition(change: ChangeRecord): boolean {
  const impact = change.phases.impact;
  const requirements = change.phases.requirements;
  return !!impact && !!requirements && !requirements.allowUnchanged
    && impact.fingerprints.requirements === requirements.fingerprints.requirements;
}

export function designUnchangedCondition(change: ChangeRecord): boolean {
  const requirements = change.phases.requirements;
  const design = change.phases.design;
  return !!requirements && !!design && requirements.fingerprints.design === design.fingerprints.design;
}

const tddBatchPhaseNames = ['red', 'implementation', 'green'] as const;
type TddBatchPhaseName = typeof tddBatchPhaseNames[number];

/** @id CODE-CHANGE-EVIDENCE-WAIVER-016
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-002
 * @design DES-CHANGE-EVIDENCE-WAIVER-001
 * Pure re-derivations of the remaining seven CHANGE-0012 codes' exact
 * "would this diagnostic currently fire" conditions, mirroring the
 * pre-existing five-code precedent above, so `recordChangeWaiver` never
 * needs to import from `change.ts` (which itself imports from
 * `change-waiver.ts`, so importing `change.ts` here would create a module
 * dependency cycle).
 */
export async function recordMissingCondition(root: string, evidence: ChangeEvidence | null, changeId: string): Promise<boolean> {
  if (!await exists(within(root, `.musubix/changes/${changeId}.md`))) return false;
  return evidence === null || !evidence.changes.some((entry) => entry.changeId === changeId);
}

export function phaseMissingCondition(change: ChangeRecord, phaseName: string): boolean {
  if ((tddBatchPhaseNames as readonly string[]).includes(phaseName)) {
    const covered = new Set(effectiveBatches(change)
      .filter((batch) => batch[phaseName as TddBatchPhaseName])
      .flatMap((batch) => batch.requirementIds));
    return change.requirementIds.some((id) => !covered.has(id));
  }
  return !change.phases[phaseName as ChangePhase];
}

export function orderMigrationRequiredPhaseCondition(change: ChangeRecord, phaseName: string): boolean {
  const item = change.phases[phaseName as ChangePhase];
  return !!item && !Number.isInteger(item.order);
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-022
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-011
 * @design DES-CHANGE-EVIDENCE-WAIVER-004
 */
type BatchOrderState = Pick<ChangeTddBatch, 'requirementIds'>
  & Partial<Record<'red' | 'implementation' | 'green', { order?: number }>>;

export function orderMigrationRequiredBatchItemCondition(
  batch: BatchOrderState,
  batchPhaseName: string,
): boolean {
  const item = batch[batchPhaseName as TddBatchPhaseName];
  return !!item && !Number.isInteger(item.order);
}

export function orderMigrationRequiredBatchCondition(
  change: Pick<ChangeRecord, 'changeId' | 'requirementIds' | 'phases'> & { tddBatches?: BatchOrderState[] },
  batchPhaseName: string,
  key: string,
): boolean {
  const batches = [...(change.tddBatches ?? [])];
  if (change.phases.red || change.phases.implementation || change.phases.green) {
    const legacyBatch: BatchOrderState = {
      requirementIds: [...change.requirementIds],
      ...(change.phases.red ? { red: change.phases.red } : {}),
      ...(change.phases.implementation ? { implementation: change.phases.implementation } : {}),
      ...(change.phases.green ? { green: change.phases.green } : {}),
    };
    batches.unshift(legacyBatch);
  }
  return batchesForKey(batches, key)
    .some((batch) => orderMigrationRequiredBatchItemCondition(batch, batchPhaseName));
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-024
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-017
 * @design DES-CHANGE-EVIDENCE-WAIVER-004
 * Pure re-derivations of `CHANGE_PHASE_ORDER`'s six transition conditions
 * (GitHub Issue #56), mirroring `orderMigrationRequiredPhaseCondition`'s/
 * `orderMigrationRequiredBatchCondition`'s shape so `evaluateWaiverCondition`
 * never duplicates `change.ts`'s emission-site comparisons.
 */
export function phaseOrderPhaseCondition(change: ChangeRecord, phaseName: string): boolean {
  if (phaseName === 'requirements') {
    const requirements = change.phases.requirements;
    const impact = change.phases.impact;
    return requirements?.order !== undefined && impact?.order !== undefined && requirements.order <= impact.order;
  }
  if (phaseName === 'design') {
    const design = change.phases.design;
    const requirements = change.phases.requirements;
    return design?.order !== undefined && requirements?.order !== undefined && design.order <= requirements.order;
  }
  return false;
}

export function phaseOrderBatchItemCondition(
  change: Pick<ChangeRecord, 'phases'>,
  batch: BatchOrderState,
  batchPhaseName: string,
): boolean {
  if (batchPhaseName === 'red') {
    const design = change.phases.design;
    return batch.red?.order !== undefined && design?.order !== undefined && batch.red.order <= design.order;
  }
  if (batchPhaseName === 'implementation') {
    return batch.implementation?.order !== undefined && batch.red?.order !== undefined
      && batch.implementation.order <= batch.red.order;
  }
  if (batchPhaseName === 'green') {
    return batch.green?.order !== undefined && batch.implementation?.order !== undefined
      && batch.green.order <= batch.implementation.order;
  }
  if (batchPhaseName === 'quality') {
    const quality = change.phases.quality;
    return quality?.order !== undefined && batch.green?.order !== undefined && quality.order <= batch.green.order;
  }
  return false;
}

export function phaseOrderBatchCondition(
  change: Pick<ChangeRecord, 'changeId' | 'requirementIds' | 'phases'> & { tddBatches?: BatchOrderState[] },
  batchPhaseName: string,
  key: string,
): boolean {
  const batches = [...(change.tddBatches ?? [])];
  if (change.phases.red || change.phases.implementation || change.phases.green) {
    const legacyBatch: BatchOrderState = {
      requirementIds: [...change.requirementIds],
      ...(change.phases.red ? { red: change.phases.red } : {}),
      ...(change.phases.implementation ? { implementation: change.phases.implementation } : {}),
      ...(change.phases.green ? { green: change.phases.green } : {}),
    };
    batches.unshift(legacyBatch);
  }
  return batchesForKey(batches, key)
    .some((batch) => phaseOrderBatchItemCondition(change, batch, batchPhaseName));
}

export function testsUnchangedCondition(change: ChangeRecord, batch: ChangeTddBatch): boolean {
  const design = change.phases.design;
  const red = batch.red;
  return !!design && !!red && design.fingerprints.tests === red.fingerprints.tests;
}

export function implementationUnchangedCondition(batch: ChangeTddBatch): boolean {
  const red = batch.red;
  const implementation = batch.implementation;
  return !!red && !!implementation && red.fingerprints.implementation === implementation.fingerprints.implementation;
}

export function relevantImplementationUnchangedCondition(batch: ChangeTddBatch, requirementId: string): boolean {
  const red = batch.red;
  const implementation = batch.implementation;
  if (!red || !implementation) return false;
  const before = red.fingerprints.requirementImplementations?.[requirementId];
  const after = implementation.fingerprints.requirementImplementations?.[requirementId];
  if (!before || !after || (!before.paths.length && !after.paths.length)) return false;
  return JSON.stringify(before.fingerprints) === JSON.stringify(after.fingerprints);
}

export function testChangedAfterRedCondition(batch: ChangeTddBatch): boolean {
  const red = batch.red;
  const green = batch.green;
  return !!red && !!green && red.fingerprints.tests !== green.fingerprints.tests;
}
