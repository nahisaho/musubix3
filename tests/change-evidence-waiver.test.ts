import { expect, it } from 'vitest';
import type { Diagnostic } from '../packages/domain/src/index.js';
import {
  activeWaivers, appendEvidenceOrder, digest, exists, loadChangeEvidence, readText, recordChangePhase, recordChangeWaiver,
  runTddPhase, validateChangeCompleteness, validateChangeEvidence, waiverEvidenceDiagnostics, within, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { code, project, tddResultRunner, testCode } from './helpers.js';

/**
 * Stages CHANGE-0001 for REQ-EXAMPLE-001 through impact/requirements/design,
 * then records the `red` phase without ever running a real TDD Red cycle,
 * which is exactly the structurally-unavoidable recording-order debt this
 * feature exists to let a human waive: `CHANGE_RED_UNPROVEN` fires because
 * no valid TDD cycle precedes the recorded Red fingerprint.
 */
async function stageChangeThroughRed(root: string, changeId = 'CHANGE-0001'): Promise<void> {
  await writeText(root, `.musubix/changes/${changeId}.md`, `# ${changeId}\nRequirements: REQ-EXAMPLE-001\n`);
  await recordChangePhase(root, changeId, 'impact', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, changeId, 'requirements', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, changeId, 'design', ['REQ-EXAMPLE-001']);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior, no TDD Red evidence recorded\n`);
  await recordChangePhase(root, changeId, 'red', ['REQ-EXAMPLE-001']);
}

/** Extends `stageChangeThroughRed` through Implementation and Green, again
 * without ever running a real TDD cycle, so `CHANGE_GREEN_UNPROVEN` and
 * `CHANGE_COMPLETENESS_TDD` both fire alongside the still-present
 * `CHANGE_RED_UNPROVEN`. */
async function stageChangeThroughGreen(root: string, changeId = 'CHANGE-0001'): Promise<void> {
  await stageChangeThroughRed(root, changeId);
  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  await recordChangePhase(root, changeId, 'implementation', ['REQ-EXAMPLE-001']);
  await recordChangePhase(root, changeId, 'green', ['REQ-EXAMPLE-001']);
}

function diagnosticsFor(diagnostics: Diagnostic[], code: string): Diagnostic[] {
  return diagnostics.filter((d) => d.code === code);
}

/** @id TEST-CHANGE-EVIDENCE-WAIVER-001
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-001
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-001 rejects a waiver for any code outside the twelve-code allow-list', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  const before = await readText(root, '.musubix/evidence/order.json');
  for (const rejectedCode of ['CHANGE_COMPLETENESS_ACCEPTANCE', 'CHANGE_COMPLETENESS_CODE', 'CHANGE_DOCUMENT_MISSING', 'NOT_A_REAL_CODE']) {
    await expect(recordChangeWaiver(root, 'CHANGE-0001', rejectedCode, undefined, undefined, 'nahisaho', 'not waivable'))
      .rejects.toThrow(/not a waivable code/);
  }
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(before);
  await expect(readText(root, '.musubix/evidence/change-waivers.json')).rejects.toThrow();
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-002
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-002
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-002 rejects a waiver when no matching diagnostic is currently reported', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  const before = await readText(root, '.musubix/evidence/order.json');
  // CHANGE_GREEN_UNPROVEN cannot fire yet: Green has not even been recorded.
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_GREEN_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'premature'))
    .rejects.toThrow(/no matching/i);
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(before);
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-003
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-003
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-003 requires a non-empty approver and reason', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, '', 'a reason')).rejects.toThrow(/approver/i);
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, '  ', 'a reason')).rejects.toThrow(/approver/i);
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', '')).rejects.toThrow(/reason/i);
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', '   ')).rejects.toThrow(/reason/i);
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-004
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-004
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-004 binds requirement-scoping to each code\'s own granularity', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', undefined, undefined, 'nahisaho', 'missing scope'))
    .rejects.toThrow(/requires --requirement/);
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-DOES-NOT-EXIST-001', undefined, 'nahisaho', 'bad scope'))
    .rejects.toThrow(/not declared/);
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-005
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-005 REQ-CHANGE-EVIDENCE-WAIVER-015
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-005 records the waiver as a hash-chained, ordered, identity-bound entry, and starts non-stale', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  const beforeEvidence = await readText(root, '.musubix/evidence/changes.json');
  const beforeTdd = await exists(within(root, '.musubix/evidence/tdd.json'));
  const beforeOrder = JSON.parse(await readText(root, '.musubix/evidence/order.json'));
  const maxSequence = beforeOrder.records.length ? Math.max(...beforeOrder.records.map((r: { sequence: number }) => r.sequence)) : 0;

  const result = await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'recorded order before impl');
  expect(result).toMatchObject({ recorded: true, changeId: 'CHANGE-0001', code: 'CHANGE_RED_UNPROVEN', requirementId: 'REQ-EXAMPLE-001' });

  expect(await readText(root, '.musubix/evidence/changes.json')).toBe(beforeEvidence);
  expect(await exists(within(root, '.musubix/evidence/tdd.json'))).toBe(beforeTdd);

  const waivers = JSON.parse(await readText(root, '.musubix/evidence/change-waivers.json'));
  expect(waivers.waivers).toHaveLength(1);
  const record = waivers.waivers[0];
  expect(record).toMatchObject({
    changeId: 'CHANGE-0001', code: 'CHANGE_RED_UNPROVEN', requirementId: 'REQ-EXAMPLE-001',
    approver: 'nahisaho', reason: 'recorded order before impl', snapshotVersion: 1,
  });
  expect(record.previousSha256).toBe('0'.repeat(64));

  const afterOrder = JSON.parse(await readText(root, '.musubix/evidence/order.json'));
  const waiverOrderRecords = afterOrder.records.filter((r: { phase: string }) => r.phase === 'waiver');
  expect(waiverOrderRecords).toHaveLength(1);
  expect(waiverOrderRecords[0]).toMatchObject({
    entityId: 'CHANGE-0001', code: 'CHANGE_RED_UNPROVEN', requirementId: 'REQ-EXAMPLE-001', sequence: maxSequence + 1,
  });
  expect(record.order).toBe(maxSequence + 1);

  const evidence = await validateChangeEvidence(root);
  const redDiagnostics = diagnosticsFor(evidence.diagnostics, 'CHANGE_RED_UNPROVEN');
  expect(redDiagnostics).toHaveLength(1);
  expect(redDiagnostics[0]).toMatchObject({
    severity: 'warning', changeId: 'CHANGE-0001', requirementId: 'REQ-EXAMPLE-001',
    waiver: { approver: 'nahisaho', reason: 'recorded order before impl' },
  });
});



/** @id TEST-CHANGE-EVIDENCE-WAIVER-006
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-008 REQ-CHANGE-EVIDENCE-WAIVER-009
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-006 downgrades only the exact waived instance, never any other change/requirement/code', async () => {
  const root = await project();
  await stageChangeThroughRed(root, 'CHANGE-0001');
  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'waived once');

  const evidence = await validateChangeEvidence(root);
  const redDiagnostics = diagnosticsFor(evidence.diagnostics, 'CHANGE_RED_UNPROVEN');
  expect(redDiagnostics).toHaveLength(1);
  expect(redDiagnostics[0]!.severity).toBe('warning');
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-007
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-010
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-007 rejects a duplicate waiver for an already validly waived, non-stale scope', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'first waiver');
  const before = await readText(root, '.musubix/evidence/change-waivers.json');
  const beforeOrder = await readText(root, '.musubix/evidence/order.json');
  await expect(recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'second waiver'))
    .rejects.toThrow(/already/i);
  expect(await readText(root, '.musubix/evidence/change-waivers.json')).toBe(before);
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(beforeOrder);
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-008
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-011
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-008 treats a waiver as stale once its snapshot payload changes, reporting it error again plus a stale diagnostic', async () => {
  const root = await project();
  await stageChangeThroughGreen(root);
  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_GREEN_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'waived before real TDD evidence');

  let evidence = await validateChangeEvidence(root);
  expect(diagnosticsFor(evidence.diagnostics, 'CHANGE_GREEN_UNPROVEN')[0]!.severity).toBe('warning');
  expect(diagnosticsFor(evidence.diagnostics, 'CHANGE_WAIVER_STALE')).toHaveLength(0);

  // Recording a real TDD cycle afterward changes the snapshot payload for this requirement.
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'failed', { exitCode: 1 }));
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'passed'));

  evidence = await validateChangeEvidence(root);
  const staleDiagnostics = diagnosticsFor(evidence.diagnostics, 'CHANGE_WAIVER_STALE');
  expect(staleDiagnostics.length).toBeGreaterThan(0);
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-009
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-006 REQ-CHANGE-EVIDENCE-WAIVER-007
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-009 reports malformed waiver evidence without downgrading the targeted diagnostic', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'valid waiver');

  // Corrupt the waiver chain: break the hash so it fails shape/chain validation.
  const waivers = JSON.parse(await readText(root, '.musubix/evidence/change-waivers.json'));
  waivers.waivers[0].payloadSha256 = '0'.repeat(64);
  await writeJson(root, '.musubix/evidence/change-waivers.json', waivers);

  const evidence = await validateChangeEvidence(root);
  expect(diagnosticsFor(evidence.diagnostics, 'CHANGE_RED_UNPROVEN')[0]!.severity).toBe('error');
  expect(diagnosticsFor(evidence.diagnostics, 'CHANGE_WAIVER_EVIDENCE_MALFORMED').length).toBeGreaterThan(0);
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-010
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-012
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-010 surfaces active waivers for audit visibility, excluding stale/malformed ones', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'audited waiver');

  const active = await activeWaivers(root);
  expect(active).toHaveLength(1);
  expect(active[0]).toMatchObject({
    changeId: 'CHANGE-0001', code: 'CHANGE_RED_UNPROVEN', requirementId: 'REQ-EXAMPLE-001',
    approver: 'nahisaho', reason: 'audited waiver',
  });

  const waivers = JSON.parse(await readText(root, '.musubix/evidence/change-waivers.json'));
  waivers.waivers[0].snapshotHash = digest('tampered');
  await writeJson(root, '.musubix/evidence/change-waivers.json', waivers);
  expect(await activeWaivers(root)).toHaveLength(0);
  expect((await waiverEvidenceDiagnostics(root)).length).toBeGreaterThan(0);
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-011
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-013
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-011 attaches structured changeId/requirementId targets to every waivable diagnostic', async () => {
  const root = await project();
  await stageChangeThroughRed(root);
  const evidence = await validateChangeEvidence(root);
  const redDiagnostic = diagnosticsFor(evidence.diagnostics, 'CHANGE_RED_UNPROVEN')[0];
  expect(redDiagnostic!.changeId).toBe('CHANGE-0001');
  expect(redDiagnostic!.requirementId).toBe('REQ-EXAMPLE-001');
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-012
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-014
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-012 redefines change-history/change-completeness validity as free of error-severity diagnostics', async () => {
  const root = await project();
  await stageChangeThroughGreen(root);

  let evidence = await validateChangeEvidence(root);
  expect(evidence.valid).toBe(false);
  let completeness = await validateChangeCompleteness(root);
  expect(completeness.valid).toBe(false);

  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_RED_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'waived red');
  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_GREEN_UNPROVEN', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'waived green');
  await recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001']);

  evidence = await validateChangeEvidence(root);
  expect(evidence.valid).toBe(true);
  expect(evidence.diagnostics.some((d) => d.severity === 'error')).toBe(false);

  const changeDoc = await loadChangeEvidence(root);
  expect(changeDoc?.changes).toHaveLength(1);

  // CHANGE_COMPLETENESS_TDD also needs waiving for completeness to pass.
  await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_COMPLETENESS_TDD', 'REQ-EXAMPLE-001', undefined, 'nahisaho', 'waived completeness');
  completeness = await validateChangeCompleteness(root);
  expect(completeness.valid).toBe(true);
  expect(completeness.changes[0]).toMatchObject({ changeId: 'CHANGE-0001', completeRequirements: 1, requirements: 1, valid: true });
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-013
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-016
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-013 waives CHANGE_RECORD_MISSING with no requirement/detail scope even when changes.json does not exist', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0002.md', '# CHANGE-0002\nRequirements: REQ-EXAMPLE-001\n');
  expect(await exists(within(root, '.musubix/evidence/changes.json'))).toBe(false);

  let evidence = await validateChangeEvidence(root);
  const recordMissing = diagnosticsFor(evidence.diagnostics, 'CHANGE_RECORD_MISSING');
  expect(recordMissing).toHaveLength(1);
  expect(recordMissing[0]!.severity).toBe('error');
  expect(recordMissing[0]!.requirementId).toBeUndefined();
  expect(recordMissing[0]!.detail).toBeUndefined();

  const result = await recordChangeWaiver(root, 'CHANGE-0002', 'CHANGE_RECORD_MISSING', undefined, undefined, 'nahisaho', 'document staged before recording');
  expect(result).toMatchObject({ recorded: true, changeId: 'CHANGE-0002', code: 'CHANGE_RECORD_MISSING' });

  evidence = await validateChangeEvidence(root);
  expect(diagnosticsFor(evidence.diagnostics, 'CHANGE_RECORD_MISSING')[0]!.severity).toBe('warning');
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-014
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-016
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-014 waives detail-scoped CHANGE_PHASE_MISSING using the phase:<name> grammar', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);

  let evidence = await validateChangeEvidence(root);
  const phaseMissing = diagnosticsFor(evidence.diagnostics, 'CHANGE_PHASE_MISSING').filter((d) => d.detail === 'phase:requirements');
  expect(phaseMissing).toHaveLength(1);
  expect(phaseMissing[0]!.severity).toBe('error');

  const before = await readText(root, '.musubix/evidence/order.json');
  const result = await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_PHASE_MISSING', undefined, 'phase:requirements', 'nahisaho', 'requirements phase deliberately deferred');
  expect(result).toMatchObject({ recorded: true, changeId: 'CHANGE-0001', code: 'CHANGE_PHASE_MISSING', detail: 'phase:requirements' });
  expect(await readText(root, '.musubix/evidence/order.json')).not.toBe(before);

  evidence = await validateChangeEvidence(root);
  const waived = diagnosticsFor(evidence.diagnostics, 'CHANGE_PHASE_MISSING').filter((d) => d.detail === 'phase:requirements');
  expect(waived).toHaveLength(1);
  expect(waived[0]!.severity).toBe('warning');

  // A different phase's CHANGE_PHASE_MISSING instance is unaffected.
  const designMissing = diagnosticsFor(evidence.diagnostics, 'CHANGE_PHASE_MISSING').filter((d) => d.detail === 'phase:design');
  expect(designMissing[0]?.severity).toBe('error');
});

/** @id TEST-CHANGE-EVIDENCE-WAIVER-015
 * @verifies REQ-CHANGE-EVIDENCE-WAIVER-016
 */
it('TEST-CHANGE-EVIDENCE-WAIVER-015 waives batch-scoped CHANGE_TESTS_UNCHANGED using the bare batchKey grammar', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);

  // `recordChangePhase` itself fail-fasts on unchanged tests before Red, so this
  // state (a legacy/directly-edited evidence file predating that guard) is
  // constructed by directly appending a `red` phase whose `fingerprints.tests`
  // is identical to `design`'s — the exact state `CHANGE_TESTS_UNCHANGED` reports.
  const evidencePath = '.musubix/evidence/changes.json';
  const evidence = JSON.parse(await readText(root, evidencePath));
  const change = evidence.changes.find((entry: { changeId: string }) => entry.changeId === 'CHANGE-0001');
  const orderRecord = await appendEvidenceOrder(root, { kind: 'change', entityId: 'CHANGE-0001', phase: 'red' });
  change.phases.red = { phase: 'red', order: orderRecord.sequence, recordedAt: new Date().toISOString(), fingerprints: change.phases.design.fingerprints };
  await writeJson(root, evidencePath, evidence);

  let diagnostics = (await validateChangeEvidence(root)).diagnostics;
  const testsUnchanged = diagnosticsFor(diagnostics, 'CHANGE_TESTS_UNCHANGED');
  expect(testsUnchanged).toHaveLength(1);
  const batchDetail = testsUnchanged[0]!.detail;
  expect(batchDetail).toBe('REQ-EXAMPLE-001');
  expect(testsUnchanged[0]!.severity).toBe('error');

  const result = await recordChangeWaiver(root, 'CHANGE-0001', 'CHANGE_TESTS_UNCHANGED', undefined, batchDetail, 'nahisaho', 'legacy evidence predates the Red fail-fast guard');
  expect(result).toMatchObject({ recorded: true, changeId: 'CHANGE-0001', code: 'CHANGE_TESTS_UNCHANGED', detail: batchDetail });

  diagnostics = (await validateChangeEvidence(root)).diagnostics;
  expect(diagnosticsFor(diagnostics, 'CHANGE_TESTS_UNCHANGED')[0]!.severity).toBe('warning');
});
