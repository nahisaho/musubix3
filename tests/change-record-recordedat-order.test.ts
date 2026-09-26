import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  appendEvidenceOrder, changePhases, loadChangeEvidence, readText, recordChangePhase, runProcess,
  validateChangeEvidence, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { code, project, recordTddGreen, recordTddRed, testCode } from './helpers.js';

/** @id TEST-CHANGE-RECORD-RECORDEDAT-ORDER-001
 * @verifies REQ-CHANGE-RECORD-RECORDEDAT-ORDER-001
 */
it('TEST-CHANGE-RECORD-RECORDEDAT-ORDER-001 documents that order (not recordedAt) is the verified chronology field, in --help and README', async () => {
  const root = await project();
  const cli = resolve('dist/packages/cli/src/main.js');
  const result = await runProcess(process.execPath, [cli, 'change-record', '--help'], {
    cwd: root,
    timeoutMs: 20_000,
  });
  expect(result.stdout).toContain('order');
  expect(result.stdout).toContain('recordedAt');
  expect(result.stdout).toMatch(/recordedAt[\s\S]*no ordering guarantee/i);

  const readme = await readFile(resolve('README.md'), 'utf8');
  const section = readme.slice(readme.indexOf('`change-record <CHANGE-ID>'));
  expect(section).toContain('`order`');
  expect(section).toContain('`recordedAt`');
  expect(section).toContain('CHANGE_RECORDEDAT_OUT_OF_ORDER');
});

/** Builds a change with non-contiguous `order` values (foreign `tdd`-kind
 * order records interleaved between our change's own phases) and a
 * full-requirement-set (legacy) red/implementation/green batch, matching
 * this feature's design (DES-CHANGE-RECORD-RECORDEDAT-ORDER-002). */
async function buildNonContiguousChange(root: string): Promise<void> {
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  const foreign = () => appendEvidenceOrder(root, { kind: 'tdd', entityId: 'FOREIGN', phase: `filler-${crypto.randomUUID()}` });
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
  await foreign();
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  await foreign();
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await foreign();
  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
  await recordTddGreen(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']);
  await recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001']);
}

/** Rewrites every phase's `recordedAt` to a synthetic, strictly-increasing
 * timestamp matching its `order`, so the baseline change has no naturally
 * occurring inversions regardless of real wall-clock timing (recording
 * several phases in quick succession can otherwise tie or, under heavy
 * system load, invert their real capture order). Tests then apply their
 * own deliberate swaps on top of this deterministic baseline. */
async function normalizeRecordedAt(root: string, changeId: string): Promise<void> {
  const evidence = await loadChangeEvidence(root);
  const change = evidence!.changes.find((c) => c.changeId === changeId)!;
  const entries = changePhases
    .map((phase) => change.phases[phase])
    .filter((entry): entry is NonNullable<typeof entry> => entry != null && typeof entry.order === 'number')
    .sort((a, b) => a.order! - b.order!);
  const base = Date.parse('2024-01-01T00:00:00.000Z');
  entries.forEach((entry, index) => {
    entry.recordedAt = new Date(base + index * 1000).toISOString();
  });
  await writeJson(root, '.musubix/evidence/changes.json', evidence);
}

/** @id TEST-CHANGE-RECORD-RECORDEDAT-ORDER-002
 * @verifies REQ-CHANGE-RECORD-RECORDEDAT-ORDER-002
 */
it('TEST-CHANGE-RECORD-RECORDEDAT-ORDER-002 reports exactly one warning-severity CHANGE_RECORDEDAT_OUT_OF_ORDER diagnostic for an inverted consecutive order pair, and none when recordedAt is monotonic', async () => {
  const root = await project();
  await buildNonContiguousChange(root);
  await normalizeRecordedAt(root, 'CHANGE-0001');

  const baseline = await validateChangeEvidence(root);
  expect(baseline.diagnostics.filter((d) => d.code === 'CHANGE_RECORDEDAT_OUT_OF_ORDER')).toHaveLength(0);
  expect(baseline.diagnostics.filter((d) => d.code === 'CHANGE_ORDER_MISMATCH')).toHaveLength(0);
  expect(baseline.diagnostics.filter((d) => d.code === 'CHANGE_PHASE_ORDER')).toHaveLength(0);

  const evidence = await loadChangeEvidence(root);
  const change = evidence!.changes.find((c) => c.changeId === 'CHANGE-0001')!;
  // design has a lower `order` than red (design recorded strictly before red);
  // swap their recordedAt so the later-order entry (red) has the earlier timestamp.
  const designRecordedAt = change.phases.design!.recordedAt;
  change.phases.design!.recordedAt = change.phases.red!.recordedAt;
  change.phases.red!.recordedAt = designRecordedAt;
  await writeJson(root, '.musubix/evidence/changes.json', evidence);

  const report = await validateChangeEvidence(root);
  const inversions = report.diagnostics.filter((d) => d.code === 'CHANGE_RECORDEDAT_OUT_OF_ORDER');
  expect(inversions).toHaveLength(1);
  expect(inversions[0]!.severity).toBe('warning');
  expect(inversions[0]!.changeId ?? inversions[0]!.message).toContain('CHANGE-0001');
  expect(inversions[0]!.message).toContain('design');
  expect(inversions[0]!.message).toContain('red');
  // The new warning never turns an otherwise-passing set of checks into a
  // failure: comparing error-severity diagnostics before/after the swap
  // (unrelated pre-existing error-severity diagnostics, e.g. unproven TDD
  // cycles in this minimal fixture, are unaffected by this feature).
  const errorsBefore = baseline.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code).sort();
  const errorsAfter = report.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code).sort();
  expect(errorsAfter).toEqual(errorsBefore);
  expect(report.diagnostics.filter((d) => d.code === 'CHANGE_ORDER_MISMATCH')).toHaveLength(0);
  expect(report.diagnostics.filter((d) => d.code === 'CHANGE_PHASE_ORDER')).toHaveLength(0);
});

/** @id TEST-CHANGE-RECORD-RECORDEDAT-ORDER-003
 * @verifies REQ-CHANGE-RECORD-RECORDEDAT-ORDER-002
 */
it('TEST-CHANGE-RECORD-RECORDEDAT-ORDER-003 excludes entries with a duplicated order, a missing order, or a non-canonical recordedAt from the inversion comparison, while still flagging an unrelated valid inversion', async () => {
  const root = await project();
  await buildNonContiguousChange(root);
  await normalizeRecordedAt(root, 'CHANGE-0001');
  const evidence = await loadChangeEvidence(root);
  const change = evidence!.changes.find((c) => c.changeId === 'CHANGE-0001')!;

  // Duplicate order: force requirements to share impact's order, and invert
  // their recordedAt; the pair must be excluded (no warning), even though it
  // would otherwise be an inversion.
  const impactRecordedAt = change.phases.impact!.recordedAt;
  change.phases.requirements!.order = change.phases.impact!.order!;
  change.phases.requirements!.recordedAt = impactRecordedAt;
  change.phases.impact!.recordedAt = change.phases.design!.recordedAt;

  // Missing order: quality loses its order field entirely, and is given an
  // implausibly early recordedAt; it must be excluded regardless of value.
  delete (change.phases.quality as { order?: number }).order;
  change.phases.quality!.recordedAt = impactRecordedAt;

  // Non-canonical recordedAt: red keeps a valid `order` but its `recordedAt`
  // is rewritten to a non-canonical (though parseable) ISO variant, and
  // swapped with design's (an inversion, if red were still eligible); this
  // must not produce a warning.
  const nonCanonical = change.phases.red!.recordedAt.replace(/\.\d{3}Z$/, '+00:00');
  expect(nonCanonical).not.toBe(change.phases.red!.recordedAt);
  expect(Number.isNaN(Date.parse(nonCanonical))).toBe(false);
  change.phases.design!.recordedAt = change.phases.red!.recordedAt;
  change.phases.red!.recordedAt = nonCanonical;

  // Unrelated, fully valid pair (implementation/green): still an inversion
  // and must still be flagged, proving the exclusions above are selective,
  // not a global suppression of the diagnostic.
  const implementationRecordedAt = change.phases.implementation!.recordedAt;
  change.phases.implementation!.recordedAt = change.phases.green!.recordedAt;
  change.phases.green!.recordedAt = implementationRecordedAt;

  await writeJson(root, '.musubix/evidence/changes.json', evidence);
  const report = await validateChangeEvidence(root);
  const inversions = report.diagnostics.filter((d) => d.code === 'CHANGE_RECORDEDAT_OUT_OF_ORDER');
  expect(inversions).toHaveLength(1);
  expect(inversions[0]!.message).toContain('implementation');
  expect(inversions[0]!.message).toContain('green');
});
