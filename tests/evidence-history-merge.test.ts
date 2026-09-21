import { cp, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { project, tddResultRunner } from './helpers.js';

type MergeDiagnostic = { code: string; identity?: string };
type MergeReport = {
  valid: boolean;
  preserved: number;
  deduplicated: number;
  appended: number;
  revalidationRequired: boolean;
  diagnostics: MergeDiagnostic[];
};
type MergeOptions = { dryRun?: boolean; faultAt?: string };
type MergeApi = {
  mergeEvidenceHistories(root: string, incoming: string, options?: MergeOptions): Promise<MergeReport>;
};

const mergeApi = analysis as unknown as MergeApi;

async function declareTest(root: string, testId: string): Promise<void> {
  const path = 'src/service.test.ts';
  const current = await analysis.readText(root, path);
  if (current.includes(`@id ${testId}`)) return;
  await analysis.writeText(root, path, `${current}
/** @id ${testId}
 * @verifies REQ-EXAMPLE-001
 */
`);
}

async function recordCycle(root: string, testId: string, greenStdout = ''): Promise<void> {
  await declareTest(root, testId);
  await analysis.runTddPhase(root, 'red', testId, 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  const source = await analysis.readText(root, 'src/service.ts');
  await analysis.writeText(root, 'src/service.ts', `${source}\n// ${testId} Green source change\n`);
  await analysis.runTddPhase(root, 'green', testId, 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed', { stdout: greenStdout }));
}

async function historyWithCommonCycle(): Promise<{ base: string; incoming: string }> {
  const base = await project();
  await analysis.writeJson(base, '.musubix/evidence/changes.json', { schemaVersion: 1, changes: [] });
  for (let index = 1; index <= 8; index++) {
    await declareTest(base, `TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-${String(index).padStart(3, '0')}`);
  }
  await recordCycle(base, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-001');
  const parent = await mkdtemp(join(tmpdir(), 'musubix-evidence-merge-'));
  const incoming = join(parent, 'incoming');
  await cp(base, incoming, { recursive: true });
  return { base, incoming };
}

/** @id TEST-EVIDENCE-HISTORY-MERGE-001
 * @verifies REQ-EVIDENCE-HISTORY-MERGE-001
 */
it('TEST-EVIDENCE-HISTORY-MERGE-001 preserves base order, deduplicates the ancestor, and appends incoming history', async () => {
  const { base, incoming } = await historyWithCommonCycle();
  await recordCycle(base, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-002');
  await recordCycle(incoming, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-003');
  const incomingBefore = await analysis.readText(incoming, '.musubix/evidence/order.json');

  const report = await mergeApi.mergeEvidenceHistories(base, incoming);

  expect(report).toMatchObject({ valid: true, preserved: 4, deduplicated: 2, appended: 2, revalidationRequired: true });
  expect(await analysis.readText(incoming, '.musubix/evidence/order.json')).toBe(incomingBefore);
});

/** @id TEST-EVIDENCE-HISTORY-MERGE-002
 * @verifies REQ-EVIDENCE-HISTORY-MERGE-002
 */
it('TEST-EVIDENCE-HISTORY-MERGE-002 rebuilds order references and the TDD hash chain into a valid candidate', async () => {
  const { base, incoming } = await historyWithCommonCycle();
  await recordCycle(base, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-004');
  await recordCycle(incoming, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-005');

  const report = await mergeApi.mergeEvidenceHistories(base, incoming);
  const order = await analysis.loadEvidenceOrder(base);
  const tdd = await analysis.validateTddEvidence(base);

  expect(report.valid).toBe(true);
  expect(analysis.validateEvidenceOrderLog(order).valid).toBe(true);
  expect(tdd.valid).toBe(true);
});

/** @id TEST-EVIDENCE-HISTORY-MERGE-003
 * @verifies REQ-EVIDENCE-HISTORY-MERGE-003
 */
it('TEST-EVIDENCE-HISTORY-MERGE-003 rejects divergent payloads for the same cycle phase without writing', async () => {
  const base = await project();
  await analysis.writeJson(base, '.musubix/evidence/changes.json', { schemaVersion: 1, changes: [] });
  await declareTest(base, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-006');
  await analysis.runTddPhase(base, 'red', 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-006', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(base, 'failed', { exitCode: 1 }));
  const parent = await mkdtemp(join(tmpdir(), 'musubix-evidence-conflict-'));
  const incoming = join(parent, 'incoming');
  await cp(base, incoming, { recursive: true });
  await analysis.runTddPhase(base, 'green', 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-006', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(base, 'passed', { stdout: 'base' }));
  await analysis.runTddPhase(incoming, 'green', 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-006', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(incoming, 'passed', { stdout: 'incoming' }));
  const before = await analysis.readText(base, '.musubix/evidence/tdd.json');

  const report = await mergeApi.mergeEvidenceHistories(base, incoming);

  expect(report.valid).toBe(false);
  expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'EVIDENCE_MERGE_CONFLICT' }));
  expect(await analysis.readText(base, '.musubix/evidence/tdd.json')).toBe(before);
});

/** @id TEST-EVIDENCE-HISTORY-MERGE-004
 * @verifies REQ-EVIDENCE-HISTORY-MERGE-004
 */
it('TEST-EVIDENCE-HISTORY-MERGE-004 restores byte-identical evidence after an injected replacement failure', async () => {
  const { base, incoming } = await historyWithCommonCycle();
  await recordCycle(incoming, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-007');
  const paths = ['order.json', 'tdd.json', 'changes.json'];
  const before = await Promise.all(paths.map((path) => analysis.readText(base, `.musubix/evidence/${path}`)));

  await expect(mergeApi.mergeEvidenceHistories(base, incoming, { faultAt: 'replace:1' }))
    .rejects.toThrow(/injected/i);

  await expect(Promise.all(paths.map((path) => analysis.readText(base, `.musubix/evidence/${path}`))))
    .resolves.toEqual(before);
});

/** @id TEST-EVIDENCE-HISTORY-MERGE-005
 * @verifies REQ-EVIDENCE-HISTORY-MERGE-005
 */
it('TEST-EVIDENCE-HISTORY-MERGE-005 dry-run returns the merge plan without writing any evidence file', async () => {
  const { base, incoming } = await historyWithCommonCycle();
  await recordCycle(incoming, 'TEST-EVIDENCE-HISTORY-MERGE-FIXTURE-008');
  const paths = ['order.json', 'tdd.json', 'changes.json'];
  const before = await Promise.all(paths.map((path) => analysis.readText(base, `.musubix/evidence/${path}`)));

  const report = await mergeApi.mergeEvidenceHistories(base, incoming, { dryRun: true });

  expect(report).toMatchObject({ valid: true, appended: 2, revalidationRequired: true });
  await expect(Promise.all(paths.map((path) => analysis.readText(base, `.musubix/evidence/${path}`))))
    .resolves.toEqual(before);
});
