import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import type { Diagnostic } from '../packages/domain/src/index.js';
import type { WorkflowEvent, WorkflowManifest } from '../packages/analysis/src/index.js';
import {
  digest,
  readText,
  recordAllWorkflowWaivers,
  recordWorkflowWaiver,
  runProcess,
  validateWorkflow,
  writeJson,
} from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');
const verifiedAt = '2020-01-01T00:00:00.000Z';
const declarationOneAt = '2020-01-01T00:00:10.000Z';
const declarationTwoAt = '2020-01-01T00:00:20.000Z';
const declarationThreeAt = '2020-01-01T00:00:30.000Z';

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

function invocation(
  skill: string,
  toolCallId: string,
  invokedAt: string,
  status: 'completed' | 'failed' | 'incomplete',
  completedAt?: string,
): NonNullable<WorkflowManifest['verification']>['invocations'][number] {
  return { skill, toolCallId, invokedAt, ...(completedAt ? { completedAt } : {}), status };
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

/** @id TEST-WORKFLOW-WAIVER-BULK-001
 * @verifies REQ-WORKFLOW-WAIVER-BULK-001
 */
it('TEST-WORKFLOW-WAIVER-BULK-001 waives every currently unwaived declaration-scoped diagnostic, skipping an already-actively-waived one', async () => {
  const root = await project();
  const events = [
    completedDeclaration('sdd-change', 'requirements', declarationOneAt),
    completedDeclaration('sdd-change', 'design', declarationTwoAt),
    completedDeclaration('sdd-change', 'complete', declarationThreeAt),
  ];
  await writeWorkflowEvidence(root, events, [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);

  // Pre-waive one declaration with the existing single-record command so the bulk
  // command must skip it rather than double-waiving it.
  await recordWorkflowWaiver(root, 'WORKFLOW_SKILL_NOT_INVOKED', 'sdd-change', 'requirements', declarationOneAt, undefined, 'nahisaho', 'already reviewed earlier');

  const result = await recordAllWorkflowWaivers(root, 'nahisaho', 'bulk reconciliation debt review');
  expect(result.recorded).toBe(2);
  expect(result.waivers).toEqual([
    expect.objectContaining({ skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationThreeAt, code: 'WORKFLOW_SKILL_NOT_INVOKED' }),
    expect.objectContaining({ skill: 'sdd-change', phase: 'design', declarationRecordedAt: declarationTwoAt, code: 'WORKFLOW_SKILL_NOT_INVOKED' }),
  ]);

  const evidence = JSON.parse(await readText(root, '.musubix/evidence/workflow-waivers.json'));
  expect(evidence.waivers).toHaveLength(3);
  expect(evidence.waivers[1].sequence).toBe(2);
  expect(evidence.waivers[2].sequence).toBe(3);
  expect(evidence.waivers[2].previousSha256).toBe(evidence.waivers[1].payloadSha256);
  expect(new Set(evidence.waivers.map((w: { approver: string }) => w.approver))).toEqual(new Set(['nahisaho']));

  const diagnostics = (await validateWorkflow(root)).diagnostics;
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'requirements', declarationRecordedAt: declarationOneAt,
  })[0]?.severity).toBe('warning');
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'design', declarationRecordedAt: declarationTwoAt,
  })[0]?.severity).toBe('warning');
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_SKILL_NOT_INVOKED', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationThreeAt,
  })[0]?.severity).toBe('warning');
  // The paired binding diagnostic for a waived scope is downgraded together, identically
  // to the existing single-record command's behavior.
  expect(findScopeDiagnostics(diagnostics, 'WORKFLOW_BINDING_MISSING', {
    skill: 'sdd-change', phase: 'complete', declarationRecordedAt: declarationThreeAt,
  })[0]?.severity).toBe('warning');
});

/** @id TEST-WORKFLOW-WAIVER-BULK-002
 * @verifies REQ-WORKFLOW-WAIVER-BULK-002
 */
it('TEST-WORKFLOW-WAIVER-BULK-002 rejects the whole bulk invocation without writing when any precondition fails', async () => {
  const root = await project();
  const event = completedDeclaration('sdd-change', 'complete', declarationOneAt);
  await writeUnverifiedWorkflow(root, [event]);

  await expect(recordAllWorkflowWaivers(root, 'nahisaho', 'unreconciled')).rejects.toThrow(/workflow-verify/);
  expect(await readText(root, '.musubix/evidence/workflow-waivers.json').catch(() => null)).toBeNull();

  await writeWorkflowEvidence(root, [event], [invocation('other-skill', 'call-1', '2020-01-01T00:00:01.000Z', 'completed', '2020-01-01T00:00:02.000Z')]);
  await expect(recordAllWorkflowWaivers(root, '   ', 'reviewed')).rejects.toThrow(/non-empty --approver and --reason/);
  await expect(recordAllWorkflowWaivers(root, 'nahisaho', '   ')).rejects.toThrow(/non-empty --approver and --reason/);
  expect(await readText(root, '.musubix/evidence/workflow-waivers.json').catch(() => null)).toBeNull();

  await writeJson(root, '.musubix/evidence/workflow-waivers.json', { schemaVersion: 2, waivers: [] });
  await expect(recordAllWorkflowWaivers(root, 'nahisaho', 'reviewed')).rejects.toThrow(/is malformed/);
  expect(JSON.parse(await readText(root, '.musubix/evidence/workflow-waivers.json'))).toEqual({ schemaVersion: 2, waivers: [] });

  const missingConfirm = await invoke(root, ['workflow', 'waiver', 'record-all', '--approver', 'nahisaho', '--reason', 'reviewed']);
  expect(missingConfirm.exitCode).toBe(2);
  expect(missingConfirm.stderr).toContain('--confirm');
});

/** @id TEST-WORKFLOW-WAIVER-BULK-003
 * @verifies REQ-WORKFLOW-WAIVER-BULK-003
 */
it('TEST-WORKFLOW-WAIVER-BULK-003 reports zero recorded waivers without writing when nothing currently qualifies', async () => {
  const root = await project();
  const event = completedDeclaration('sdd-change', 'complete', declarationOneAt);
  await writeWorkflowEvidence(root, [event], [invocation('sdd-change', 'call-1', '2020-01-01T00:00:05.000Z', 'completed', declarationOneAt)]);

  const first = await recordAllWorkflowWaivers(root, 'nahisaho', 'no candidates yet');
  expect(first).toEqual({ recorded: 0, waivers: [] });
  expect(await readText(root, '.musubix/evidence/workflow-waivers.json').catch(() => null)).toBeNull();

  const cliResult = await invoke(root, ['workflow', 'waiver', 'record-all', '--approver', 'nahisaho', '--reason', 'no candidates yet', '--confirm', '--json']);
  expect(cliResult.exitCode).toBe(0);
  expect(JSON.parse(cliResult.stdout)).toEqual({ recorded: 0, waivers: [] });
});

/** @id TEST-WORKFLOW-WAIVER-BULK-004
 * @verifies REQ-WORKFLOW-WAIVER-BULK-004
 */
it('TEST-WORKFLOW-WAIVER-BULK-004 documents workflow waiver record-all in README.md and the sdd-change skill\'s release-approval step', async () => {
  const readme = await readText(process.cwd(), 'README.md');
  const readmeRow = readme.split('\n').find((line) => line.includes('`workflow waiver record-all'));
  expect(readmeRow).toBeDefined();
  expect(readmeRow).toContain('--approver <name>');
  expect(readmeRow).toContain('--reason <text>');
  expect(readmeRow).toContain('--confirm');
  expect(readmeRow).toContain('all-or-nothing');
  expect(readmeRow).toContain('WORKFLOW_INVOCATION_UNVERIFIED');
  expect(readmeRow).toContain('WORKFLOW_BINDING_MISSING');
  expect(readme).toContain('`workflow waiver record <code>');

  const skill = await readText(process.cwd(), '.github/skills/sdd-change/SKILL.md');
  expect(skill).toMatch(/workflow-verify.*compatible mode/);
  expect(skill).toMatch(/session'?s (own )?live transcript/);
  expect(skill).toContain('workflow waiver record-all');
});

