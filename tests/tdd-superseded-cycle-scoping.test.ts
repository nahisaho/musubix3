import { expect, it } from 'vitest';
import { validateTddEvidence, writeText, runTddPhase } from '../packages/analysis/src/index.js';
import { project, tddResultRunner } from './helpers.js';

/** @id TEST-TDD-SUPERSEDED-CYCLE-SCOPING-001
 * @verifies REQ-TDD-SUPERSEDED-CYCLE-SCOPING-001
 */
it('TEST-TDD-SUPERSEDED-CYCLE-SCOPING-001 does not block gate on a superseded incomplete Red cycle', async () => {
  const root = await project();

  // First attempt: the configured command reports the test as passing while
  // Red requires a failing result, so this cycle's Red phase is recorded
  // invalid (TDD_TARGET_RESULT) and it never receives a Green phase.
  const firstRed = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed', { exitCode: 1 }));
  expect(firstRed.valid).toBe(false);

  // A later, fully valid Red-Green cycle is recorded for the same test ID.
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', '// non-test source change between Red and Green.\nexport function ready() { return true; }\n');
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));

  const evidence = await validateTddEvidence(root);
  expect(evidence.diagnostics.filter((d) => d.code === 'TDD_RED_MISSING' && d.message.includes('TEST-EXAMPLE-001'))).toEqual([]);
  expect(evidence.diagnostics.filter((d) => d.code === 'TDD_GREEN_MISSING' && d.message.includes('TEST-EXAMPLE-001'))).toEqual([]);
  expect(evidence.diagnostics.filter((d) => d.code === 'TDD_LEGACY_OR_UNSCOPED_EVIDENCE' && d.message.includes('TEST-EXAMPLE-001'))).toEqual([]);
});

// Supporting regression check (not independently trace-tracked, matching the
// convention in tdd-fingerprint-scoping.test.ts): REQ-TDD-SUPERSEDED-CYCLE-SCOPING-002's
// coverage is already proven by TEST-TDD-SUPERSEDED-CYCLE-SCOPING-001 above.
it('still raises TDD_TEST_STALE for the latest cycle when the test changes afterwards', async () => {
  const root = await project();
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', '// non-test source change between Red and Green.\nexport function ready() { return true; }\n');
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));

  const staleTestCode = `import { readiness } from './service.js';
/** @id TEST-EXAMPLE-001
 * @verifies REQ-EXAMPLE-001
 */
export function testReadiness() { if (!readiness()) throw new Error('still not ready'); }
`;
  await writeText(root, 'src/service.test.ts', staleTestCode);

  const evidence = await validateTddEvidence(root);
  expect(evidence.diagnostics.some((d) => d.code === 'TDD_TEST_STALE' && d.message.includes('TEST-EXAMPLE-001'))).toBe(true);
});
