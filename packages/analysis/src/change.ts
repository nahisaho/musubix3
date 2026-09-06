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

export interface ChangeRecord {
  changeId: string;
  requirementIds: string[];
  phases: Partial<Record<ChangePhase, ChangePhaseEvidence>>;
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
    changePhases.some((entryPhase) => entry.phases[entryPhase] && !Number.isInteger(entry.phases[entryPhase]!.order)))) {
    throw new Error('Existing change evidence lacks monotonic order; regenerate it before recording new phases.');
  }
  let change = evidence.changes.find((entry) => entry.changeId === changeId);
  if (!change) {
    if (phase !== 'impact') throw new Error('The first recorded change phase must be impact.');
    change = { changeId, requirementIds: [...new Set(requirementIds)].sort(), phases: {} };
    evidence.changes.push(change);
  } else if (JSON.stringify(change.requirementIds) !== JSON.stringify([...new Set(requirementIds)].sort())) {
    throw new Error('Every phase must use the same requirement IDs.');
  }
  const index = changePhases.indexOf(phase);
  if (index > 0 && !change.phases[changePhases[index - 1]!]) {
    throw new Error(`${phase} requires the preceding ${changePhases[index - 1]} phase.`);
  }
  if (change.phases[phase]) throw new Error(`${changeId}:${phase} is already recorded.`);
  const order = await appendEvidenceOrder(root, { kind: 'change', entityId: changeId, phase });
  change.phases[phase] = {
    phase,
    order: order.sequence,
    recordedAt: new Date().toISOString(),
    fingerprints: await currentFingerprints(root, changeId, change.requirementIds),
  };
  await writeJson(root, '.musubix/evidence/changes.json', evidence);
  return evidence;
}

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
  for (const change of evidence.changes) {
    const phases = changePhases.map((phase) => change.phases[phase]);
    for (let index = 0; index < phases.length; index++) {
      if (!phases[index]) diagnostics.push(error('CHANGE_PHASE_MISSING', `${change.changeId} is missing ${changePhases[index]}.`));
      if (phases[index] && !Number.isInteger(phases[index]!.order)) {
        diagnostics.push(error('CHANGE_ORDER_MIGRATION_REQUIRED', `${change.changeId}:${changePhases[index]} lacks monotonic order evidence; regenerate this change chronology.`));
      } else if (phases[index]) {
        const record = evidenceOrderRecord(order.records, 'change', change.changeId, changePhases[index]!);
        if (!record || record.sequence !== phases[index]!.order) {
          diagnostics.push(error('CHANGE_ORDER_MISMATCH', `${change.changeId}:${changePhases[index]} does not match the monotonic evidence order log.`));
        }
      }
      if (index > 0 && phases[index]?.order !== undefined && phases[index - 1]?.order !== undefined
        && phases[index]!.order! <= phases[index - 1]!.order!) {
        diagnostics.push(error('CHANGE_PHASE_ORDER', `${change.changeId}:${changePhases[index]} is not after ${changePhases[index - 1]}.`));
      }
    }
    const impact = change.phases.impact;
    const requirements = change.phases.requirements;
    const design = change.phases.design;
    const red = change.phases.red;
    const implementation = change.phases.implementation;
    const green = change.phases.green;
    if (impact && requirements && impact.fingerprints.requirements === requirements.fingerprints.requirements) {
      diagnostics.push(error('CHANGE_REQUIREMENTS_UNCHANGED', `${change.changeId} did not change requirements after impact analysis.`));
    }
    if (requirements && design && requirements.fingerprints.design === design.fingerprints.design) {
      diagnostics.push(error('CHANGE_DESIGN_UNCHANGED', `${change.changeId} did not change design after requirements.`));
    }
    if (design && red && design.fingerprints.tests === red.fingerprints.tests) {
      diagnostics.push(error('CHANGE_TESTS_UNCHANGED', `${change.changeId} did not add or change tests before Red.`));
    }
    if (red && implementation && red.fingerprints.implementation === implementation.fingerprints.implementation) {
      diagnostics.push(error('CHANGE_IMPLEMENTATION_UNCHANGED', `${change.changeId} did not change implementation after Red.`));
    }
    if (red && implementation) {
      for (const requirementId of change.requirementIds) {
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
    for (const requirementId of change.requirementIds) {
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
      const red = change.phases.red;
      const implementation = change.phases.implementation;
      const green = change.phases.green;
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
