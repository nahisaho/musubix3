import { expect, it } from 'vitest';
import {
  readText, recordChangePhase, validateChangeCompleteness, writeText,
} from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

/**
 * Minimal fixture for `CHANGE_COMPLETENESS_ACCEPTANCE`: records only the
 * `impact` phase for CHANGE-0001 over REQ-EXAMPLE-001 (the smallest state
 * `validateChangeCompleteness` requires to evaluate the requirement's
 * `Acceptance:` text), then lets each test rewrite that Acceptance line.
 */
async function stageAcceptanceOnly(root: string): Promise<void> {
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);
}

async function setAcceptance(root: string, acceptance: string): Promise<void> {
  const requirementsText = await readText(root, '.musubix/features/example/requirements.md');
  await writeText(root, '.musubix/features/example/requirements.md',
    requirementsText.replace(/^Acceptance:.*$/m, `Acceptance: ${acceptance}`));
}

function hasAcceptanceDiagnostic(diagnostics: { code: string }[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === 'CHANGE_COMPLETENESS_ACCEPTANCE');
}

/** @id TEST-CHANGE-ACCEPTANCE-HEURISTIC-001
 * @verifies REQ-CHANGE-ACCEPTANCE-HEURISTIC-001
 */
it('TEST-CHANGE-ACCEPTANCE-HEURISTIC-001 recognizes report/error/naming vocabulary as measurable acceptance', async () => {
  const root = await project();
  await stageAcceptanceOnly(root);
  await setAcceptance(root, 'The command reports an error naming the missing option.');
  const result = await validateChangeCompleteness(root);
  expect(hasAcceptanceDiagnostic(result.diagnostics)).toBe(false);
});

/** @id TEST-CHANGE-ACCEPTANCE-HEURISTIC-002
 * @verifies REQ-CHANGE-ACCEPTANCE-HEURISTIC-001
 */
it('TEST-CHANGE-ACCEPTANCE-HEURISTIC-002 recognizes exit/configur vocabulary as measurable acceptance', async () => {
  const root = await project();
  await stageAcceptanceOnly(root);
  await setAcceptance(root, 'Omitting the flag exits nonzero listing every configured name.');
  const result = await validateChangeCompleteness(root);
  expect(hasAcceptanceDiagnostic(result.diagnostics)).toBe(false);
});

/** @id TEST-CHANGE-ACCEPTANCE-HEURISTIC-003
 * @verifies REQ-CHANGE-ACCEPTANCE-HEURISTIC-001
 */
it('TEST-CHANGE-ACCEPTANCE-HEURISTIC-003 recognizes contain/unaffected/stale vocabulary as measurable acceptance', async () => {
  const root = await project();
  await stageAcceptanceOnly(root);
  await setAcceptance(root, 'Output contains the entry unaffected by any stale domain.');
  const result = await validateChangeCompleteness(root);
  expect(hasAcceptanceDiagnostic(result.diagnostics)).toBe(false);
});

/** @id TEST-CHANGE-ACCEPTANCE-HEURISTIC-004
 * @verifies REQ-CHANGE-ACCEPTANCE-HEURISTIC-002
 */
it('TEST-CHANGE-ACCEPTANCE-HEURISTIC-004 still rejects whole-value placeholders and too-short text', async () => {
  const root = await project();
  await stageAcceptanceOnly(root);
  for (const acceptance of ['TBD', '未定', 'short']) {
    await setAcceptance(root, acceptance);
    const result = await validateChangeCompleteness(root);
    expect(hasAcceptanceDiagnostic(result.diagnostics)).toBe(true);
  }
});

/** @id TEST-CHANGE-ACCEPTANCE-HEURISTIC-005
 * @verifies REQ-CHANGE-ACCEPTANCE-HEURISTIC-002
 */
it('TEST-CHANGE-ACCEPTANCE-HEURISTIC-005 still rejects placeholder-prefixed text even when it contains a newly recognized keyword', async () => {
  const root = await project();
  await stageAcceptanceOnly(root);
  for (const acceptance of [
    'TODO: configure later',
    'TBD - error handling',
    '  todo : configure later',
    'TbD—error handling',
    '未定 — 後で設定',
  ]) {
    await setAcceptance(root, acceptance);
    const result = await validateChangeCompleteness(root);
    expect(hasAcceptanceDiagnostic(result.diagnostics)).toBe(true);
  }
});

/** @id TEST-CHANGE-ACCEPTANCE-HEURISTIC-006
 * @verifies REQ-CHANGE-ACCEPTANCE-HEURISTIC-001
 */
it('TEST-CHANGE-ACCEPTANCE-HEURISTIC-006 still rejects long non-placeholder prose containing no recognized keyword', async () => {
  const root = await project();
  await stageAcceptanceOnly(root);
  await setAcceptance(root, 'Please look at it manually sometime soon.');
  const result = await validateChangeCompleteness(root);
  expect(hasAcceptanceDiagnostic(result.diagnostics)).toBe(true);
});
