import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { Diagnostic } from '../packages/domain/src/index.js';
import type { WorkflowEvent, WorkflowManifest } from '../packages/analysis/src/index.js';
import {
  activeWorkflowWaivers,
  canonicalJson,
  currentCodeFor,
  digest,
  loadWorkflow,
  loadWorkflowWaiverEvidence,
  projectStatus,
  readText,
  recordWorkflowWaiver,
  runGate,
  runProcess,
  snapshotPayload,
  validateLoadedWorkflow,
  validateWorkflow,
  waiverChainValid,
  waiverLinkage,
  waiverRecordShapeValid,
  workflowWaiverEvidenceDiagnostics,
  writeJson,
  writeText,
} from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');
const verifiedAt = '2020-01-01T00:00:00.000Z';
const declarationOneAt = '2020-01-01T00:00:10.000Z';
const declarationTwoAt = '2020-01-01T00:00:20.000Z';

function invocation(
  skill: string,
  toolCallId: string,
  invokedAt: string,
  status: 'completed' | 'failed' | 'incomplete',
  completedAt?: string,
): NonNullable<WorkflowManifest['verification']>['invocations'][number] {
  return { skill, toolCallId, invokedAt, ...(completedAt ? { completedAt } : {}), status };
}

function completedDeclaration(
  skill: string,
  phase: string,
  recordedAt: string,
  overrides: Partial<WorkflowEvent> = {},
): WorkflowEvent {
  return {
    skill,
    version: '0.1.17',
    provenance: 'self-reported',
    phase,
    status: 'completed',
    recordedAt,
    ...overrides,
  };
}

function verification(
  events: WorkflowEvent[],
  invocations: NonNullable<WorkflowManifest['verification']>['invocations'],
  salt = 'v1',
): NonNullable<WorkflowManifest['verification']> {
  return {
    mode: 'compatible',
    sourceSha256: digest(JSON.stringify({ salt, invocations })),
    eventsSha256: digest(JSON.stringify(events)),
    verifiedAt,
    invocations,
  };
}

async function writeWorkflowEvidence(
  root: string,
  events: WorkflowEvent[],
  invocations: NonNullable<WorkflowManifest['verification']>['invocations'],
  salt = 'v1',
): Promise<void> {
  await writeJson(root, '.musubix/evidence/workflow.json', {
    schemaVersion: 1,
    events,
    verification: verification(events, invocations, salt),
  });
}

async function writeUnverifiedWorkflow(root: string, events: WorkflowEvent[]): Promise<void> {
  await writeJson(root, '.musubix/evidence/workflow.json', { schemaVersion: 1, events });
}

function findDiagnostics(diagnostics: Diagnostic[], code: string): Diagnostic[] {
  return diagnostics.filter((diagnostic) => diagnostic.code === code);
}

function findScopeDiagnostics(
  diagnostics: Diagnostic[],
  code: string,
  scope: { skill: string; phase: string; declarationRecordedAt: string; index?: number },
): Diagnostic[] {
  return diagnostics.filter((diagnostic) =>
    diagnostic.code === code
    && diagnostic.skill === scope.skill
    && diagnostic.phase === scope.phase
    && diagnostic.declarationRecordedAt === scope.declarationRecordedAt
    && diagnostic.index === scope.index);
}

async function invoke(root: string, args: string[]): Promise<Awaited<ReturnType<typeof runProcess>>> {
  return runProcess(process.execPath, [cli, ...args], { cwd: root, timeoutMs: 20_000 });
}

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-001
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-013 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-001 keeps validateWorkflow and validateLoadedWorkflow byte-identical while adding structured scope fields', async () => {
  const root = await project();
  const events = [completedDeclaration('sdd-change', 'complete', declarationOneAt)];
  await writeWorkflowEvidence(root, events, [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);

  const workflow = await loadWorkflow(root);
  const loaded = await loadWorkflowWaiverEvidence(root);
  const fromWrapper = await validateWorkflow(root, { mode: 'compatible' });
  const fromLoaded = await validateLoadedWorkflow(root, workflow, { mode: 'compatible' }, loaded);

  expect(fromLoaded.diagnostics).toEqual(fromWrapper.diagnostics);
  expect(findScopeDiagnostics(fromWrapper.diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationOneAt,
  })[0]).toMatchObject({
    severity: 'error',
    skill: 'sdd-change',
    phase: 'complete',
    declarationRecordedAt: declarationOneAt,
  });
  expect(findScopeDiagnostics(fromWrapper.diagnostics, 'WORKFLOW_BINDING_MISSING', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationOneAt,
  })).toHaveLength(1);
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-002
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-001 REQ-WORKFLOW-EVIDENCE-WAIVER-003 REQ-WORKFLOW-EVIDENCE-WAIVER-005
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-002 rejects CLI calls with disallowed codes, missing confirmation, missing options, bad timestamps, and invalid --index values', async () => {
  const root = await project();
  const event = completedDeclaration('sdd-change', 'complete', declarationOneAt);
  await writeWorkflowEvidence(root, [event], [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);

  const disallowed = await invoke(root, [
    'workflow', 'waiver', 'record', 'WORKFLOW_BINDING_MISSING',
    '--skill', 'sdd-change', '--phase', 'complete', '--recorded-at', declarationOneAt,
    '--approver', 'nahisaho', '--reason', 'no direct binding waiver', '--confirm',
  ]);
  expect(disallowed.exitCode).toBe(2);
  expect(disallowed.stderr).toContain('not a waivable code');

  const missingConfirm = await invoke(root, [
    'workflow', 'waiver', 'record', 'WORKFLOW_SKILL_NOT_INVOKED',
    '--skill', 'sdd-change', '--phase', 'complete', '--recorded-at', declarationOneAt,
    '--approver', 'nahisaho', '--reason', 'needs review',
  ]);
  expect(missingConfirm.exitCode).toBe(2);
  expect(missingConfirm.stderr).toContain('--confirm');

  const missingApprover = await invoke(root, [
    'workflow', 'waiver', 'record', 'WORKFLOW_SKILL_NOT_INVOKED',
    '--skill', 'sdd-change', '--phase', 'complete', '--recorded-at', declarationOneAt,
    '--reason', 'needs review', '--confirm',
  ]);
  expect(missingApprover.exitCode).toBe(2);
  expect(missingApprover.stderr).toContain('--approver');

  const missingReason = await invoke(root, [
    'workflow', 'waiver', 'record', 'WORKFLOW_SKILL_NOT_INVOKED',
    '--skill', 'sdd-change', '--phase', 'complete', '--recorded-at', declarationOneAt,
    '--approver', 'nahisaho', '--confirm',
  ]);
  expect(missingReason.exitCode).toBe(2);
  expect(missingReason.stderr).toContain('--reason');

  const badRecordedAt = await invoke(root, [
    'workflow', 'waiver', 'record', 'WORKFLOW_SKILL_NOT_INVOKED',
    '--skill', 'sdd-change', '--phase', 'complete', '--recorded-at', 'not-a-timestamp',
    '--approver', 'nahisaho', '--reason', 'needs review', '--confirm',
  ]);
  expect(badRecordedAt.exitCode).toBe(2);
  expect(badRecordedAt.stderr).toContain('valid --recorded-at timestamp');

  const badIndex = await invoke(root, [
    'workflow', 'waiver', 'record', 'WORKFLOW_SKILL_NOT_INVOKED',
    '--skill', 'sdd-change', '--phase', 'complete', '--recorded-at', declarationOneAt,
    '--index', '1.5', '--approver', 'nahisaho', '--reason', 'needs review', '--confirm',
  ]);
  expect(badIndex.exitCode).toBe(2);
  expect(badIndex.stderr).toContain('nonnegative safe integer');
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-003
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-002 REQ-WORKFLOW-EVIDENCE-WAIVER-004
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-003 requires both prior reconciliation and a currently present matching diagnostic', async () => {
  const root = await project();
  const event = completedDeclaration('sdd-change', 'complete', declarationOneAt);
  await writeUnverifiedWorkflow(root, [event]);

  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'reviewed'))
    .rejects.toThrow(/workflow-verify/);

  await writeWorkflowEvidence(root, [event], [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, 0, 'nahisaho', 'spurious index'))
    .rejects.toThrow(/does not accept --index/);
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, '   ', 'reviewed'))
    .rejects.toThrow(/non-empty --approver and --reason/);
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', '   '))
    .rejects.toThrow(/non-empty --approver and --reason/);
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_INVOCATION_FAILED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'wrong code'))
    .rejects.toThrow(/No matching WORKFLOW_INVOCATION_FAILED diagnostic is currently reported/);
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', '2020-01-01T09:00:10.000+09:00', undefined, 'nahisaho', 'normalized timestamp mismatch'))
    .rejects.toThrow(/does not resolve to a completed workflow declaration/);
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-004
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-005 REQ-WORKFLOW-EVIDENCE-WAIVER-006 REQ-WORKFLOW-EVIDENCE-WAIVER-009 REQ-WORKFLOW-EVIDENCE-WAIVER-014
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-004 records a genesis waiver, downgrades only the exact colliding scope, and surfaces workflowWaivers in gate/status', async () => {
  const root = await project();
  const collisionAt = declarationOneAt;
  const events = [
    completedDeclaration('sdd-change', 'complete', collisionAt),
    completedDeclaration('sdd-change', 'complete', collisionAt),
  ];
  await writeWorkflowEvidence(root, events, [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);

  const workflowBefore = await readText(root, '.musubix/evidence/workflow.json');
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', collisionAt, undefined, 'nahisaho', 'ambiguous'))
    .rejects.toThrow(/valid --index values are: 0, 1/);
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', collisionAt, 9, 'nahisaho', 'bad index'))
    .rejects.toThrow(/colliding declaration indices: 0, 1/);

  const result = await recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', collisionAt, 1, 'nahisaho', 'exact collision reviewed');
  expect(result).toMatchObject({
    recorded: true,
    skill: 'sdd-change',
    phase: 'complete',
    declarationRecordedAt: collisionAt,
    index: 1,
    code: 'WORKFLOW_SKILL_NOT_INVOKED',
  });

  const evidence = JSON.parse(await readText(root, '.musubix/evidence/workflow-waivers.json'));
  expect(evidence.waivers).toHaveLength(1);
  expect(await readText(root, '.musubix/evidence/workflow.json')).toBe(workflowBefore);
  expect(evidence.waivers[0]).toMatchObject({
    skill: 'sdd-change',
    phase: 'complete',
    declarationRecordedAt: collisionAt,
    index: 1,
    approver: 'nahisaho',
    reason: 'exact collision reviewed',
    sequence: 1,
    snapshotVersion: 1,
    previousSha256: '0'.repeat(64),
  });

  const diagnostics = (await validateWorkflow(root)).diagnostics;
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: collisionAt, index: 1,
  })[0]).toMatchObject({
    severity: 'warning',
    waiver: {
      approver: 'nahisaho',
      reason: 'exact collision reviewed',
      recordedAt: evidence.waivers[0].waiverRecordedAt,
      waiverRecordedAt: evidence.waivers[0].waiverRecordedAt,
    },
  });
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_BINDING_MISSING', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: collisionAt, index: 1,
  })[0]?.severity).toBe('warning');
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: collisionAt, index: 0,
  })[0]?.severity).toBe('error');

  const gate = await runGate(root);
  expect(gate.workflowWaivers).toEqual([expect.objectContaining({
    skill: 'sdd-change',
    phase: 'complete',
    declarationRecordedAt: collisionAt,
    index: 1,
    code: 'WORKFLOW_SKILL_NOT_INVOKED',
    approver: 'nahisaho',
    reason: 'exact collision reviewed',
  })]);
  expect(gate.checks.find((check) => check.name === 'workflow')).toMatchObject({ status: 'fail' });

  const status = await projectStatus(root);
  expect(status.workflowWaivers).toEqual(gate.workflowWaivers);
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-005
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-007 REQ-WORKFLOW-EVIDENCE-WAIVER-013
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-005 validates raw evidence shape, closed schema, top-level malformation, and chain/linkage independently', async () => {
  const root = await project();
  const event = completedDeclaration('sdd-change', 'complete', declarationOneAt);
  await writeWorkflowEvidence(root, [event], [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);

  await writeJson(root, '.musubix/evidence/workflow-waivers.json', { schemaVersion: 2, waivers: [] });
  expect(await loadWorkflowWaiverEvidence(root)).toEqual({ schemaVersion: 1, waivers: [], malformed: true });

  await writeJson(root, '.musubix/evidence/workflow-waivers.json', { schemaVersion: 1, waivers: [null] });
  expect(await loadWorkflowWaiverEvidence(root)).toEqual({ schemaVersion: 1, waivers: [null], malformed: false });

  const validShape = {
    skill: 'sdd-change',
    phase: 'complete',
    declarationRecordedAt: declarationOneAt,
    code: 'WORKFLOW_SKILL_NOT_INVOKED',
    approver: 'nahisaho',
    reason: 'reviewed',
    waiverRecordedAt: '2020-01-02T00:00:00.000Z',
    sequence: 1,
    snapshotVersion: 1,
    snapshotHash: 'a'.repeat(64),
    previousSha256: '0'.repeat(64),
    payloadSha256: 'b'.repeat(64),
  };
  expect(waiverRecordShapeValid(validShape)).toBe(true);
  expect(waiverRecordShapeValid({ ...validShape, extra: true })).toBe(false);
  expect(waiverRecordShapeValid({ ...validShape, declarationRecordedAt: '2020-13-40T25:61:61.999Z' })).toBe(false);
  expect(waiverRecordShapeValid({ ...validShape, index: null })).toBe(false);

  const chain = [
    { ...validShape, payloadSha256: digest(JSON.stringify('placeholder')) },
  ];
  const typed = chain[0]!;
  typed.payloadSha256 = digest(canonicalJson({ ...typed, payloadSha256: undefined }));
  expect(waiverChainValid(chain, 0)).toBe(true);
  expect(waiverChainValid([{ ...typed, previousSha256: 'f'.repeat(64) }], 0)).toBe(false);
  expect(waiverLinkage(await loadWorkflow(root), [typed], 0)).toEqual({ valid: true });
  expect(waiverLinkage(await loadWorkflow(root), [{ ...typed, declarationRecordedAt: declarationTwoAt }], 0)).toMatchObject({ valid: false });
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-006
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-008 REQ-WORKFLOW-EVIDENCE-WAIVER-017
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-006 reports malformed workflow-waiver evidence separately and rejects further appends until repaired', async () => {
  const root = await project();
  const event = completedDeclaration('sdd-change', 'complete', declarationOneAt);
  await writeWorkflowEvidence(root, [event], [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);
  await writeText(root, '.musubix/evidence/workflow-waivers.json', '{ not valid json }');
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'blocked by malformed file'))
    .rejects.toThrow(/workflow-waivers\.json is malformed/);
  await writeJson(root, '.musubix/evidence/workflow-waivers.json', { schemaVersion: 1, waivers: [] });
  await recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'valid waiver');

  const waivers = JSON.parse(await readText(root, '.musubix/evidence/workflow-waivers.json'));
  waivers.waivers[0].payloadSha256 = '0'.repeat(64);
  await writeJson(root, '.musubix/evidence/workflow-waivers.json', waivers);

  const workflow = await validateWorkflow(root);
  expect(findDiagnostics(workflow.diagnostics, 'WORKFLOW_WAIVER_EVIDENCE_MALFORMED')).toHaveLength(0);
  expect(findScopeDiagnostics(workflow.diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationOneAt,
  })[0]?.severity).toBe('error');

  const gate = await runGate(root);
  expect(gate.waiverDiagnostics).toContainEqual(expect.objectContaining({
    code: 'WORKFLOW_WAIVER_EVIDENCE_MALFORMED',
    path: '.musubix/evidence/workflow-waivers.json',
    skill: 'sdd-change',
    phase: 'complete',
    declarationRecordedAt: declarationOneAt,
  }));
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'blocked'))
    .rejects.toThrow(/repair the evidence chain/);
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-007
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-009 REQ-WORKFLOW-EVIDENCE-WAIVER-010 REQ-WORKFLOW-EVIDENCE-WAIVER-015
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-007 passes the workflow gate when every workflow error is waived, while leaving non-waived diagnostics as errors', async () => {
  const root = await project();
  const events = [
    completedDeclaration('sdd-change', 'complete', declarationOneAt),
    completedDeclaration('sdd-design', 'complete', declarationTwoAt),
  ];
  await writeWorkflowEvidence(root, events, [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);

  await recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'first only');
  let gate = await runGate(root);
  expect(gate.checks.find((check) => check.name === 'workflow')).toMatchObject({ status: 'fail' });
  expect(findScopeDiagnostics((gate.checks.find((check) => check.name === 'workflow')?.diagnostics ?? []), 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-design', phase: 'complete', declarationRecordedAt: declarationTwoAt,
  })[0]?.severity).toBe('error');

  await recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-design', 'complete', declarationTwoAt, undefined, 'nahisaho', 'second too');
  gate = await runGate(root);
  expect(gate.checks.find((check) => check.name === 'workflow')).toMatchObject({ status: 'pass' });
  expect(gate.workflowWaivers).toHaveLength(2);
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-008
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-011 REQ-WORKFLOW-EVIDENCE-WAIVER-012 REQ-WORKFLOW-EVIDENCE-WAIVER-014 REQ-WORKFLOW-EVIDENCE-WAIVER-017
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-008 marks stale waivers separately, allows same-scope replacement, and excludes stale entries from workflowWaivers', async () => {
  const root = await project();
  const event = completedDeclaration('sdd-change', 'complete', declarationOneAt, { commandSha256: 'c'.repeat(64) });
  await writeWorkflowEvidence(root, [event], [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')], 'first');
  await recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'initial waiver');

  await writeWorkflowEvidence(root, [event], [invocation('other-skill', 'call-2', '2020-01-01T00:00:03.000Z', 'completed', '2020-01-01T00:00:04.000Z')], 'second');
  const workflow = await validateWorkflow(root);
  expect(findScopeDiagnostics(workflow.diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationOneAt,
  })[0]?.severity).toBe('error');
  expect(await activeWorkflowWaivers(root)).toEqual([]);
  expect(await workflowWaiverEvidenceDiagnostics(root)).toContainEqual(expect.objectContaining({
    code: 'WORKFLOW_WAIVER_STALE',
    skill: 'sdd-change',
    phase: 'complete',
    declarationRecordedAt: declarationOneAt,
  }));

  const second = await recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'replacement waiver');
  expect(second).toMatchObject({ recorded: true, code: 'WORKFLOW_SKILL_NOT_INVOKED' });
  const stored = JSON.parse(await readText(root, '.musubix/evidence/workflow-waivers.json'));
  expect(stored.waivers).toHaveLength(2);
  expect(stored.waivers.map((record: { sequence: number }) => record.sequence)).toEqual([1, 2]);
  expect(await activeWorkflowWaivers(root)).toEqual([expect.objectContaining({
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationOneAt, reason: 'replacement waiver',
  })]);

  await expect(recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'duplicate active'))
    .rejects.toThrow(/already has an active waiver/);
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-009
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-001 REQ-WORKFLOW-EVIDENCE-WAIVER-010 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-009 never waives tool-call-scoped reuse diagnostics and keeps them structurally distinct', async () => {
  const root = await project();
  const events = [completedDeclaration('sdd-change', 'complete', declarationOneAt)];
  const reused = invocation('sdd-change', 'shared-call', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z');
  await writeWorkflowEvidence(root, events, [reused, reused], 'reused');

  const workflow = await validateWorkflow(root);
  const duplicate = findDiagnostics(workflow.diagnostics, 'WORKFLOW_INVOCATION_REUSED').find((diagnostic) => diagnostic.skill === undefined);
  expect(duplicate).toMatchObject({ severity: 'error' });
  expect(duplicate?.phase).toBeUndefined();
  expect(currentCodeFor(workflow.diagnostics, 'sdd-change', 'complete', declarationOneAt, undefined)).toBe(null);
  await expect(recordWorkflowWaiver(root, 'WORKFLOW_INVOCATION_REUSED', 'sdd-change', 'complete', declarationOneAt, undefined, 'nahisaho', 'wrong flavor'))
    .rejects.toThrow(/No matching WORKFLOW_INVOCATION_REUSED diagnostic is currently reported/);
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-010
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-002 REQ-WORKFLOW-EVIDENCE-WAIVER-012 REQ-WORKFLOW-EVIDENCE-WAIVER-016
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-010 binds each declaration-scoped reason code to its own structured scope and exact current code', async () => {
  const root = await project();
  const reusedAt = '2020-01-01T00:00:30.000Z';
  const orderAtFirst = '2020-01-01T00:00:40.000Z';
  const orderAtSecond = '2020-01-01T00:00:50.000Z';
  const events = [
    completedDeclaration('sdd-failed', 'complete', declarationOneAt),
    completedDeclaration('sdd-incomplete', 'complete', declarationTwoAt),
    completedDeclaration('sdd-reused', 'one', reusedAt),
    completedDeclaration('sdd-reused', 'two', '2020-01-01T00:00:31.000Z'),
    completedDeclaration('sdd-second', 'complete', orderAtFirst),
    completedDeclaration('sdd-first', 'complete', orderAtSecond),
  ];
  const invocations = [
    invocation('sdd-failed', 'failed-call', '2020-01-01T00:00:01.000Z', 'failed', '2020-01-01T00:00:02.000Z'),
    invocation('sdd-incomplete', 'incomplete-call', '2020-01-01T00:00:03.000Z', 'incomplete'),
    invocation('sdd-reused', 'single-call', '2020-01-01T00:00:04.000Z', 'completed', '2020-01-01T00:00:05.000Z'),
    invocation('sdd-first', 'order-second', '2020-01-01T00:00:06.000Z', 'completed', '2020-01-01T00:00:07.000Z'),
    invocation('sdd-second', 'order-first', '2020-01-01T00:00:08.000Z', 'completed', '2020-01-01T00:00:09.000Z'),
  ];
  await writeWorkflowEvidence(root, events, invocations, 'reason-codes');

  const diagnostics = (await validateWorkflow(root)).diagnostics;
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_INVOCATION_FAILED', {
    skill: 'sdd-failed', phase: 'complete', declarationRecordedAt: declarationOneAt,
  })).toHaveLength(1);
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_INVOCATION_INCOMPLETE', {
    skill: 'sdd-incomplete', phase: 'complete', declarationRecordedAt: declarationTwoAt,
  })).toHaveLength(1);
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_INVOCATION_REUSED', {
    skill: 'sdd-reused', phase: 'two', declarationRecordedAt: '2020-01-01T00:00:31.000Z',
  })).toHaveLength(1);
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_INVOCATION_ORDER', {
    skill: 'sdd-first', phase: 'complete', declarationRecordedAt: orderAtSecond,
  })).toHaveLength(1);

  expect(snapshotPayload(await loadWorkflow(root), 'sdd-failed', 'complete', declarationOneAt, undefined, 'WORKFLOW_INVOCATION_FAILED')).toMatchObject({
    skill: 'sdd-failed',
    phase: 'complete',
    status: 'completed',
    recordedAt: declarationOneAt,
    commandSha256: null,
    index: null,
    workflowEvidenceHead: expect.any(String),
    code: 'WORKFLOW_INVOCATION_FAILED',
  });
});

/** @id TEST-WORKFLOW-EVIDENCE-WAIVER-011
 * @verifies REQ-WORKFLOW-EVIDENCE-WAIVER-006 REQ-WORKFLOW-EVIDENCE-WAIVER-008 REQ-WORKFLOW-EVIDENCE-WAIVER-014 REQ-WORKFLOW-EVIDENCE-WAIVER-015
 */
it('TEST-WORKFLOW-EVIDENCE-WAIVER-011 keeps malformed workflow waiver diagnostics non-blocking when the workflow check itself has no error-severity diagnostics', async () => {
  const root = await project();
  await writeText(root, '.musubix/evidence/workflow-waivers.json', '{ not valid json }');
  const gate = await runGate(root);
  expect(gate.checks.find((check) => check.name === 'workflow')).toMatchObject({ status: 'skipped' });
  expect(gate.waiverDiagnostics).toEqual([expect.objectContaining({
    code: 'WORKFLOW_WAIVER_EVIDENCE_MALFORMED',
    path: '.musubix/evidence/workflow-waivers.json',
  })]);
});
