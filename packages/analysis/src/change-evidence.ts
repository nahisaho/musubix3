import { exists, readText, within } from './files.js';
import type { TddEvidence } from './tdd.js';

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
}

export interface ChangeEvidence {
  schemaVersion: 1;
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
  if (value.schemaVersion !== 1 || !Array.isArray(value.changes)) throw new Error('Invalid change chronology evidence.');
  return value;
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

export function batchFor(batches: ChangeTddBatch[], requirementId: string): ChangeTddBatch | undefined {
  return batches.find((batch) => batch.requirementIds.includes(requirementId));
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

export function hasValidTddCycle(change: ChangeRecord, requirementId: string, tdd: TddEvidence | null): boolean {
  const requirements = change.phases.requirements;
  const batch = batchFor(effectiveBatches(change), requirementId);
  const red = batch?.red;
  const implementation = batch?.implementation;
  const green = batch?.green;
  const cycles = tdd?.cycles.filter((cycle) => cycle.requirementId === requirementId) ?? [];
  return cycles.some((cycle) =>
    requirements
    && red
    && implementation
    && green
    && Number.isInteger(requirements.order)
    && Number.isInteger(red.order)
    && Number.isInteger(implementation.order)
    && Number.isInteger(green.order)
    && Number.isInteger(cycle.red.order)
    && Number.isInteger(cycle.green?.order)
    && cycle.red.valid
    && cycle.green?.valid
    && cycle.red.order! > requirements.order!
    && cycle.red.order! <= red.order!
    && cycle.green.order! > implementation.order!
    && cycle.green.order! <= green.order!);
}

export function redUnprovenCondition(change: ChangeRecord, requirementId: string, tdd: TddEvidence | null): boolean {
  const batch = batchFor(effectiveBatches(change), requirementId);
  return !!batch?.red && !hasValidTddCycle(change, requirementId, tdd);
}

export function greenUnprovenCondition(change: ChangeRecord, requirementId: string, tdd: TddEvidence | null): boolean {
  const batch = batchFor(effectiveBatches(change), requirementId);
  return !!batch?.green && !hasValidTddCycle(change, requirementId, tdd);
}

export function completenessTddUnsatisfiedCondition(change: ChangeRecord, requirementId: string, tdd: TddEvidence | null): boolean {
  return !hasValidTddCycle(change, requirementId, tdd);
}
