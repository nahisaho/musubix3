import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runProcess, validateModelCorrespondenceEvidence, writeText } from '../packages/analysis/src/index.js';
import { fixture, req } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');

/** @id TEST-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-001
 * @verifies REQ-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-001
 */
it('TEST-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-001 hints at `evidence refresh` when model-correspondence.json is missing', async () => {
  const root = await fixture();
  await writeText(
    root,
    '.musubix/features/alerting/requirements.md',
    req('The system shall raise an alert when temperatureAboveThreshold.') +
      '\nFormal: {"kind":"conditional","condition":"temperatureAboveThreshold","consequence":"alertRaised"}\n',
  );

  const withFormal = await validateModelCorrespondenceEvidence(root);
  expect(withFormal.present).toBe(false);
  expect(withFormal.diagnostics).toHaveLength(1);
  expect(withFormal.diagnostics[0]!.code).toBe('MODEL_CORRESPONDENCE_MISSING');
  expect(withFormal.diagnostics[0]!.message).toContain('npx musubix3 evidence refresh');

  // No explicit-Formal-JSON requirements: diagnostics stays empty, unchanged.
  const noFormalRoot = await fixture({ 'requirements.md': req() });
  const withoutFormal = await validateModelCorrespondenceEvidence(noFormalRoot);
  expect(withoutFormal.diagnostics).toHaveLength(0);
});

/** @id TEST-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-002
 * @verifies REQ-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-002
 */
it('TEST-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-002 documents the `evidence refresh` prerequisite in --help', async () => {
  const root = await fixture();
  const result = await runProcess(process.execPath, [cli, 'model-correspondence', 'validate', '--help'], {
    cwd: root,
    timeoutMs: 20_000,
  });
  expect(result.stdout).toContain('evidence refresh');
});
