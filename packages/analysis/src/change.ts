import { error, ids, validateDesign, validateRequirements, type Diagnostic, type Requirement } from '../../domain/src/index.js';
import { digest, exists, files, snapshot, within, writeJson, readText } from './files.js';
import { loadTddEvidence } from './tdd.js';
import { buildTrace } from './trace.js';
import { indexGraph } from './graph.js';
import { validatePerformanceEvidence } from './performance.js';
import { appendEvidenceOrder, evidenceOrderRecord, inspectEvidenceOrder } from './order.js';

export const changePhases = ['impact', 'requirements', 'design', 'red', 'implementation', 'green', 'quality'] as const;
export type ChangePhase = typeof changePhases[number];

interface ChangeFingerprints {
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

async function fingerprint(root: string, paths: string[]): Promise<string> {
  return digest(JSON.stringify(await snapshot(root, [...new Set(paths)].sort())));
}

async function requirementImplementationFingerprints(
  root: string,
  requirementIds: string[],
  trace: Awaited<ReturnType<typeof buildTrace>>,
): Promise<NonNullable<ChangeFingerprints['requirementImplementations']>> {
  const graph = await indexGraph(root, false);
  const nodes = new Map(trace.nodes.map((node) => [node.id, node]));
  const testPaths = new Set(trace.nodes.filter((node) => node.kind === 'test').map((node) => node.path));
  const result: NonNullable<ChangeFingerprints['requirementImplementations']> = {};
  for (const requirementId of requirementIds) {
    const designs = trace.edges
      .filter((edge) => edge.relation === 'satisfies' && edge.to === requirementId && nodes.get(edge.from)?.kind === 'design')
      .map((edge) => edge.from);
    const direct = new Set(trace.edges
      .filter((edge) => edge.relation === 'implements'
        && (edge.to === requirementId || designs.includes(edge.to))
        && nodes.get(edge.from)?.kind === 'code')
      .map((edge) => nodes.get(edge.from)!.path));
    const relevant = new Set([...direct].filter((path) => graph.files.includes(path) && !testPaths.has(path)));
    const queue = [...relevant];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index]!;
      for (const edge of graph.imports.filter((entry) => !entry.external && entry.from === current)) {
        if (testPaths.has(edge.to) || relevant.has(edge.to)) continue;
        relevant.add(edge.to);
        queue.push(edge.to);
      }
    }
    const paths = [...relevant].sort();
    result[requirementId] = { paths, fingerprints: await snapshot(root, paths) };
  }
  return result;
}

async function currentFingerprints(root: string, changeId: string, requirementIds: string[]): Promise<ChangeFingerprints> {
  const paths = await files(root);
  const trace = await buildTrace(root);
  const codePaths = trace.nodes.filter((node) => node.kind === 'code').map((node) => node.path);
  const testPaths = trace.nodes.filter((node) => node.kind === 'test').map((node) => node.path);
  const tddPath = '.musubix/evidence/tdd.json';
  return {
    impact: await fingerprint(root, paths.filter((path) => path === `.musubix/changes/${changeId}.md`)),
    requirements: await fingerprint(root, paths.filter((path) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(path))),
    design: await fingerprint(root, paths.filter((path) =>
      /^\.musubix\/features\/[^/]+\/design\.md$/.test(path) || /^\.musubix\/decisions\/ADR-\d+\.md$/.test(path))),
    implementation: await fingerprint(root, codePaths),
    tests: await fingerprint(root, testPaths),
    tdd: await fingerprint(root, await exists(within(root, tddPath)) ? [tddPath] : []),
    requirementImplementations: await requirementImplementationFingerprints(root, requirementIds, trace),
  };
}

export async function loadChangeEvidence(root: string): Promise<ChangeEvidence | null> {
  const path = '.musubix/evidence/changes.json';
  if (!await exists(within(root, path))) return null;
  const value = JSON.parse(await readText(root, path)) as ChangeEvidence;
  if (value.schemaVersion !== 1 || !Array.isArray(value.changes)) throw new Error('Invalid change chronology evidence.');
  return value;
}

const tddBatchPhases = ['red', 'implementation', 'green'] as const;
type TddBatchPhase = typeof tddBatchPhases[number];

function batchKey(requirementIds: string[]): string {
  return [...new Set(requirementIds)].sort().join(',');
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

function batchFor(batches: ChangeTddBatch[], requirementId: string): ChangeTddBatch | undefined {
  return batches.find((batch) => batch.requirementIds.includes(requirementId));
}

export async function recordChangePhase(
  root: string,
  changeId: string,
  phase: ChangePhase,
  requirementIds: string[],
): Promise<ChangeEvidence> {
  if (!/^CHANGE-\d+$/.test(changeId)) throw new Error('Change ID must match CHANGE-<digits>.');
  if (!changePhases.includes(phase)) throw new Error('Unknown change phase.');
  if (!requirementIds.length || requirementIds.some((id) => !ids.requirement.test(id))) {
    throw new Error('At least one valid REQ-* ID is required.');
  }
  if (phase === 'impact' && !await exists(within(root, `.musubix/changes/${changeId}.md`))) {
    throw new Error(`Missing staged change document: .musubix/changes/${changeId}.md`);
  }
  const evidence = await loadChangeEvidence(root) ?? { schemaVersion: 1, changes: [] };
  if (evidence.changes.some((entry) =>
    changePhases.some((entryPhase) => entry.phases[entryPhase] && !Number.isInteger(entry.phases[entryPhase]!.order))
    || (entry.tddBatches ?? []).some((batch) =>
      tddBatchPhases.some((batchPhase) => batch[batchPhase] && !Number.isInteger(batch[batchPhase]!.order))))) {
    throw new Error('Existing change evidence lacks monotonic order; regenerate it before recording new phases.');
  }
  let change = evidence.changes.find((entry) => entry.changeId === changeId);
  if (!change) {
    if (phase !== 'impact') throw new Error('The first recorded change phase must be impact.');
    change = { changeId, requirementIds: [...new Set(requirementIds)].sort(), phases: {} };
    evidence.changes.push(change);
  }
  const normalizedRequirementIds = [...new Set(requirementIds)].sort();
  const isFullSet = JSON.stringify(normalizedRequirementIds) === JSON.stringify([...change.requirementIds].sort());
  const isBatchPhase = (tddBatchPhases as readonly string[]).includes(phase);

  if (!isBatchPhase || isFullSet) {
    // impact/requirements/design/quality (always), and red/implementation/green
    // recorded with the change's exact full requirement ID set: identical,
    // unchanged, once-per-change behavior (REQ-CHANGE-REQUIREMENT-BATCHES-002).
    if (change.phases[phase]) throw new Error(`${changeId}:${phase} is already recorded.`);
    if (phase === 'requirements' && !change.phases.impact) throw new Error('requirements requires the preceding impact phase.');
    if (phase === 'design' && !change.phases.requirements) throw new Error('design requires the preceding requirements phase.');
    if (phase === 'red' && !change.phases.design) throw new Error('red requires the preceding design phase.');
    if (phase === 'implementation' && !change.phases.red) throw new Error('implementation requires the preceding red phase.');
    if (phase === 'green' && !change.phases.implementation) throw new Error('green requires the preceding implementation phase.');
    if (phase === 'quality') {
      const covered = new Set(effectiveBatches(change).filter((batch) => batch.green).flatMap((batch) => batch.requirementIds));
      const missing = change.requirementIds.filter((id) => !covered.has(id));
      if (missing.length) throw new Error(`quality requires Green evidence covering all change requirement IDs; missing ${missing.join(', ')}.`);
    }
    if (!isFullSet) {
      throw new Error(!isBatchPhase
        ? 'Every phase must use the same requirement IDs.'
        : 'Every phase must use requirement IDs declared on the change.');
    }
    const order = await appendEvidenceOrder(root, { kind: 'change', entityId: changeId, phase });
    change.phases[phase] = {
      phase,
      order: order.sequence,
      recordedAt: new Date().toISOString(),
      fingerprints: await currentFingerprints(root, changeId, change.requirementIds),
    };
  } else {
    // red/implementation/green recorded with a proper, non-empty subset of the
    // change's requirement IDs: an independent requirement batch
    // (REQ-CHANGE-REQUIREMENT-BATCHES-001, -003).
    if (!normalizedRequirementIds.length || !normalizedRequirementIds.every((id) => change.requirementIds.includes(id))) {
      throw new Error('A requirement batch must use a non-empty subset of the change requirement IDs.');
    }
    const batchPhase = phase as TddBatchPhase;
    change.tddBatches ??= [];
    const key = batchKey(normalizedRequirementIds);
    let batch = change.tddBatches.find((entry) => batchKey(entry.requirementIds) === key);
    if (batchPhase === 'red') {
      if (batch?.red) throw new Error(`${changeId}:red is already recorded for requirement batch ${normalizedRequirementIds.join(', ')}.`);
      if (!change.phases.design) throw new Error('red requires the preceding design phase.');
      if (!batch) {
        batch = { requirementIds: normalizedRequirementIds };
        change.tddBatches.push(batch);
      }
    } else if (batchPhase === 'implementation') {
      if (!batch?.red) throw new Error(`implementation requires the preceding red phase for requirement batch ${normalizedRequirementIds.join(', ')}.`);
      if (batch.implementation) throw new Error(`${changeId}:implementation is already recorded for requirement batch ${normalizedRequirementIds.join(', ')}.`);
    } else {
      if (!batch?.implementation) throw new Error(`green requires the preceding implementation phase for requirement batch ${normalizedRequirementIds.join(', ')}.`);
      if (batch.green) throw new Error(`${changeId}:green is already recorded for requirement batch ${normalizedRequirementIds.join(', ')}.`);
    }
    const order = await appendEvidenceOrder(root, { kind: 'change', entityId: changeId, phase: `${phase}:${key}` });
    batch[batchPhase] = {
      phase,
      order: order.sequence,
      recordedAt: new Date().toISOString(),
      fingerprints: await currentFingerprints(root, changeId, normalizedRequirementIds),
    };
  }
  await writeJson(root, '.musubix/evidence/changes.json', evidence);
  return evidence;
}

/** @id CODE-CHANGE-REQUIREMENT-BATCHES-002
 * @implements REQ-CHANGE-REQUIREMENT-BATCHES-005
 * @design DES-CHANGE-REQUIREMENT-BATCHES-002
 */
export async function validateChangeEvidence(root: string): Promise<{
  present: boolean;
  valid: boolean;
  changes: number;
  diagnostics: Diagnostic[];
}> {
  const evidence = await loadChangeEvidence(root);
  const documents = (await files(root))
    .filter((path) => /^\.musubix\/changes\/CHANGE-\d+\.md$/.test(path))
    .map((path) => path.split('/').at(-1)!.replace(/\.md$/, ''));
  if (!evidence?.changes.length) {
    return {
      present: documents.length > 0,
      valid: false,
      changes: 0,
      diagnostics: documents.map((changeId) =>
        error('CHANGE_RECORD_MISSING', `${changeId} has a change document but no chronology record.`)),
    };
  }
  const diagnostics: Diagnostic[] = [];
  const order = await inspectEvidenceOrder(root);
  diagnostics.push(...order.diagnostics);
  for (const changeId of documents) {
    if (!evidence.changes.some((change) => change.changeId === changeId)) {
      diagnostics.push(error('CHANGE_RECORD_MISSING', `${changeId} has a change document but no chronology record.`));
    }
  }
  for (const change of evidence.changes) {
    if (!documents.includes(change.changeId)) {
      diagnostics.push(error('CHANGE_DOCUMENT_MISSING', `${change.changeId} has chronology evidence but no change document.`));
    }
  }
  const tdd = await loadTddEvidence(root);
  const singularPhases = ['impact', 'requirements', 'design', 'quality'] as const;
  for (const change of evidence.changes) {
    const batches = effectiveBatches(change);
    const fullSetKey = batchKey(change.requirementIds);
    for (const singularPhase of singularPhases) {
      const item = change.phases[singularPhase];
      if (!item) diagnostics.push(error('CHANGE_PHASE_MISSING', `${change.changeId} is missing ${singularPhase}.`));
      if (item && !Number.isInteger(item.order)) {
        diagnostics.push(error('CHANGE_ORDER_MIGRATION_REQUIRED', `${change.changeId}:${singularPhase} lacks monotonic order evidence; regenerate this change chronology.`));
      } else if (item) {
        const record = evidenceOrderRecord(order.records, 'change', change.changeId, singularPhase);
        if (!record || record.sequence !== item.order) {
          diagnostics.push(error('CHANGE_ORDER_MISMATCH', `${change.changeId}:${singularPhase} does not match the monotonic evidence order log.`));
        }
      }
    }
    if (change.phases.requirements?.order !== undefined && change.phases.impact?.order !== undefined
      && change.phases.requirements.order <= change.phases.impact.order) {
      diagnostics.push(error('CHANGE_PHASE_ORDER', `${change.changeId}:requirements is not after impact.`));
    }
    if (change.phases.design?.order !== undefined && change.phases.requirements?.order !== undefined
      && change.phases.design.order <= change.phases.requirements.order) {
      diagnostics.push(error('CHANGE_PHASE_ORDER', `${change.changeId}:design is not after requirements.`));
    }
    for (const batchPhase of tddBatchPhases) {
      const covered = new Set(batches.filter((batch) => batch[batchPhase]).flatMap((batch) => batch.requirementIds));
      const missing = change.requirementIds.filter((id) => !covered.has(id));
      if (missing.length) {
        diagnostics.push(error('CHANGE_PHASE_MISSING', `${change.changeId} is missing ${batchPhase} for ${missing.join(', ')}.`));
      }
    }
    for (const batch of batches) {
      const key = batchKey(batch.requirementIds);
      const isFullSet = key === fullSetKey;
      for (const batchPhase of tddBatchPhases) {
        const item = batch[batchPhase];
        if (!item) continue;
        if (!Number.isInteger(item.order)) {
          diagnostics.push(error('CHANGE_ORDER_MIGRATION_REQUIRED', `${change.changeId}:${batchPhase} lacks monotonic order evidence; regenerate this change chronology.`));
          continue;
        }
        const orderPhaseKey = isFullSet ? batchPhase : `${batchPhase}:${key}`;
        const record = evidenceOrderRecord(order.records, 'change', change.changeId, orderPhaseKey);
        if (!record || record.sequence !== item.order) {
          diagnostics.push(error('CHANGE_ORDER_MISMATCH', `${change.changeId}:${batchPhase} does not match the monotonic evidence order log.`));
        }
      }
      if (batch.red?.order !== undefined && change.phases.design?.order !== undefined
        && batch.red.order <= change.phases.design.order) {
        diagnostics.push(error('CHANGE_PHASE_ORDER', `${change.changeId}:red is not after design.`));
      }
      if (batch.implementation?.order !== undefined && batch.red?.order !== undefined
        && batch.implementation.order <= batch.red.order) {
        diagnostics.push(error('CHANGE_PHASE_ORDER', `${change.changeId}:implementation is not after red.`));
      }
      if (batch.green?.order !== undefined && batch.implementation?.order !== undefined
        && batch.green.order <= batch.implementation.order) {
        diagnostics.push(error('CHANGE_PHASE_ORDER', `${change.changeId}:green is not after implementation.`));
      }
      if (change.phases.quality?.order !== undefined && batch.green?.order !== undefined
        && change.phases.quality.order <= batch.green.order) {
        diagnostics.push(error('CHANGE_PHASE_ORDER', `${change.changeId}:quality is not after green.`));
      }
    }
    const impact = change.phases.impact;
    const requirements = change.phases.requirements;
    const design = change.phases.design;
    if (impact && requirements && impact.fingerprints.requirements === requirements.fingerprints.requirements) {
      diagnostics.push(error('CHANGE_REQUIREMENTS_UNCHANGED', `${change.changeId} did not change requirements after impact analysis.`));
    }
    if (requirements && design && requirements.fingerprints.design === design.fingerprints.design) {
      diagnostics.push(error('CHANGE_DESIGN_UNCHANGED', `${change.changeId} did not change design after requirements.`));
    }
    for (const batch of batches) {
      const red = batch.red;
      const implementation = batch.implementation;
      const green = batch.green;
      if (design && red && design.fingerprints.tests === red.fingerprints.tests) {
        diagnostics.push(error('CHANGE_TESTS_UNCHANGED', `${change.changeId} did not add or change tests before Red.`));
      }
      if (red && implementation && red.fingerprints.implementation === implementation.fingerprints.implementation) {
        diagnostics.push(error('CHANGE_IMPLEMENTATION_UNCHANGED', `${change.changeId} did not change implementation after Red.`));
      }
      if (red && implementation) {
        for (const requirementId of batch.requirementIds) {
          const before = red.fingerprints.requirementImplementations?.[requirementId];
          const after = implementation.fingerprints.requirementImplementations?.[requirementId];
          if (!before || !after || (!before.paths.length && !after.paths.length)) {
            diagnostics.push(error(
              'CHANGE_IMPLEMENTATION_SCOPE_MISSING',
              `${change.changeId} has no Code Graph implementation scope for ${requirementId}.`,
            ));
          } else if (JSON.stringify(before.fingerprints) === JSON.stringify(after.fingerprints)) {
            diagnostics.push(error(
              'CHANGE_RELEVANT_IMPLEMENTATION_UNCHANGED',
              `${change.changeId} did not change implementation related to ${requirementId} after Red.`,
            ));
          }
        }
      }
      if (red && green && red.fingerprints.tests !== green.fingerprints.tests) {
        diagnostics.push(error('CHANGE_TEST_CHANGED_AFTER_RED', `${change.changeId} changed tests between Red and Green.`));
      }
    }
    for (const requirementId of change.requirementIds) {
      const batch = batchFor(batches, requirementId);
      const red = batch?.red;
      const implementation = batch?.implementation;
      const green = batch?.green;
      const cycles = tdd?.cycles.filter((cycle) => cycle.requirementId === requirementId) ?? [];
      const validCycle = cycles.find((cycle) =>
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
      if (red && cycles.some((cycle) => !Number.isInteger(cycle.red.order) || !Number.isInteger(cycle.green?.order))) {
        diagnostics.push(error('CHANGE_ORDER_MIGRATION_REQUIRED', `${change.changeId}:${requirementId} references TDD evidence without monotonic order; regenerate the cycle.`));
      }
      if (red && !validCycle) {
        diagnostics.push(error('CHANGE_RED_UNPROVEN', `${change.changeId} has no valid Red evidence for ${requirementId} before its Red phase.`));
      }
      if (green && !validCycle) {
        diagnostics.push(error('CHANGE_GREEN_UNPROVEN', `${change.changeId} has no valid Green evidence for ${requirementId} before its Green phase.`));
      }
    }
  }
  return { present: true, valid: !diagnostics.length, changes: evidence.changes.length, diagnostics };
}

export async function validateChangeCompleteness(root: string): Promise<{
  present: boolean;
  valid: boolean;
  changes: ChangeCompleteness[];
  diagnostics: Diagnostic[];
}> {
  const evidence = await loadChangeEvidence(root);
  if (!evidence?.changes.length) return { present: false, valid: false, changes: [], diagnostics: [] };
  const diagnostics: Diagnostic[] = [];
  const trace = await buildTrace(root, false);
  const nodes = new Map(trace.nodes.map((node) => [node.id, node]));
  const requirementsById = new Map<string, Requirement>();
  for (const path of (await files(root)).filter((entry) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(entry))) {
    for (const requirement of validateRequirements(await readText(root, path), path).value) {
      requirementsById.set(requirement.id, requirement);
    }
  }
  const designsById = new Map<string, ReturnType<typeof validateDesign>['value'][number]>();
  for (const path of (await files(root)).filter((entry) => /^\.musubix\/features\/[^/]+\/design\.md$/.test(entry))) {
    for (const component of validateDesign(await readText(root, path), path).value) designsById.set(component.id, component);
  }
  const tdd = await loadTddEvidence(root);
  const performance = await validatePerformanceEvidence(root);
  const changes: ChangeCompleteness[] = [];
  for (const change of evidence.changes) {
    const diagnosticStart = diagnostics.length;
    const changePath = `.musubix/changes/${change.changeId}.md`;
    const declaredRequirements = await exists(within(root, changePath))
      ? [...new Set((/^Requirements\s*:\s*(.+)$/im.exec(await readText(root, changePath))?.[1] ?? '').match(/\bREQ-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3,}\b/g) ?? [])].sort()
      : [];
    if (JSON.stringify(declaredRequirements) !== JSON.stringify([...change.requirementIds].sort())) {
      diagnostics.push(error('CHANGE_REQUIREMENTS_MISMATCH', `${change.changeId} must explicitly enumerate exactly ${change.requirementIds.join(', ')} in its Requirements field.`, changePath));
    }
    let completeRequirements = 0;
    let functionalRequirements = 0;
    let nonFunctionalRequirements = 0;
    for (const requirementId of change.requirementIds) {
      const requirementNode = nodes.get(requirementId);
      const requirement = requirementsById.get(requirementId);
      const type = requirement?.type;
      if (type === 'non-functional') nonFunctionalRequirements++;
      else if (type === 'functional') functionalRequirements++;
      const designs = trace.edges
        .filter((edge) => edge.relation === 'satisfies' && edge.to === requirementId && nodes.get(edge.from)?.kind === 'design')
        .map((edge) => edge.from);
      const hasAdr = trace.edges.some((edge) =>
        edge.relation === 'decides' && designs.includes(edge.to) && nodes.get(edge.from)?.kind === 'adr');
      const hasCode = trace.edges.some((edge) =>
        edge.relation === 'implements'
        && (edge.to === requirementId || designs.includes(edge.to))
        && nodes.get(edge.from)?.kind === 'code');
      const hasTest = trace.edges.some((edge) =>
        edge.relation === 'verifies' && edge.to === requirementId && nodes.get(edge.from)?.kind === 'test');
      const designConcrete = designs.some((id) => {
        const component = designsById.get(id);
        return component
          && component.requirements.includes(requirementId)
          && [component.responsibility, component.interfaces, component.constraints]
            .every((value) => value.trim().length >= 8 && !/^(TODO|TBD|N\/A|none|未定)$/i.test(value.trim()));
      });
      let authoritativeTest = false;
      for (const node of trace.nodes.filter((candidate) => candidate.kind === 'test')) {
        if (!trace.edges.some((edge) => edge.from === node.id && edge.to === requirementId && edge.relation === 'verifies')) continue;
        const source = await readText(root, node.path);
        if (new RegExp(`@id\\s+${node.id}\\b`).test(source) && new RegExp(`@verifies\\s+${requirementId}\\b`).test(source)) {
          authoritativeTest = true;
          break;
        }
      }
      const measurableAcceptance = !!requirement?.acceptance
        && requirement.acceptance.trim().length >= 8
        && !/^(TODO|TBD|N\/A|none|未定)$/i.test(requirement.acceptance.trim())
        && /(?:\d|test|check|verif|assert|given|when|then|return|status|pass|fail|テスト|確認|検証|以下|以上)/i.test(requirement.acceptance);
      const requirements = change.phases.requirements;
      const batch = batchFor(effectiveBatches(change), requirementId);
      const red = batch?.red;
      const implementation = batch?.implementation;
      const green = batch?.green;
      const hasTdd = tdd?.cycles.some((cycle) =>
        cycle.requirementId === requirementId
        && requirements
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
        && cycle.green.order! <= green.order!) ?? false;
      const checks = [
        [!!requirementNode && !!requirement && !!type, 'CHANGE_COMPLETENESS_REQUIREMENT', 'requirement'],
        [measurableAcceptance, 'CHANGE_COMPLETENESS_ACCEPTANCE', 'nonempty measurable Acceptance criteria'],
        [designs.length > 0 && designConcrete, 'CHANGE_COMPLETENESS_DESIGN', 'concrete design responsibilities, interfaces, and constraints'],
        [hasAdr, 'CHANGE_COMPLETENESS_ADR', 'ADR'],
        [hasCode, 'CHANGE_COMPLETENESS_CODE', 'implementation'],
        [hasTest && authoritativeTest, 'CHANGE_COMPLETENESS_TEST', 'authoritative annotated test declaration'],
        [hasTdd, 'CHANGE_COMPLETENESS_TDD', 'bounded Red-Green TDD'],
        [!requirement?.performance || (performance.valid && performance.validRequirements.includes(requirementId)), 'CHANGE_COMPLETENESS_PERFORMANCE', 'provenance-bound deterministic operation-budget evidence'],
      ] as const;
      for (const [present, code, artifact] of checks) {
        if (!present) diagnostics.push(error(code, `${change.changeId}:${requirementId} lacks ${artifact} evidence.`));
      }
      if (checks.every(([present]) => present)) completeRequirements++;
    }
    changes.push({
      changeId: change.changeId,
      functionalRequirements,
      nonFunctionalRequirements,
      requirements: change.requirementIds.length,
      completeRequirements,
      valid: completeRequirements === change.requirementIds.length && diagnostics.length === diagnosticStart,
    });
  }
  return { present: true, valid: !diagnostics.length, changes, diagnostics };
}
