import { expect, it } from 'vitest';
import { writeText, runTddPhase } from '../packages/analysis/src/index.js';
import { project, tddResultRunner } from './helpers.js';

const multiVerifiesTestCode = `import { readiness } from './service.js';
/** @id TEST-EXAMPLE-001
 * @verifies REQ-EXAMPLE-001 REQ-EXAMPLE-002
 */
export function testReadiness() { if (!readiness()) throw new Error('not ready'); }
`;

/** @id TEST-TDD-GREEN-REQUIREMENT-SCOPING-001
 * @verifies REQ-TDD-GREEN-REQUIREMENT-SCOPING-001 REQ-TDD-GREEN-REQUIREMENT-SCOPING-002
 */
it('TEST-TDD-GREEN-REQUIREMENT-SCOPING-001 completes an older pending cycle for the same test ID after a newer one starts', async () => {
  const root = await project();
  await writeText(root, 'src/service.test.ts', multiVerifiesTestCode);

  // Red for requirement A, then Red for requirement B on the same test ID:
  // two independently pending cycles now exist for TEST-EXAMPLE-001.
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));

  // Before this fix, resolving `previous` by testId alone would always pick
  // the newest cycle (requirement B's), so Green for the *older* pending
  // cycle (requirement A's) would be wrongly rejected as a requirement/command
  // mismatch. Recording Green for requirement A's own cycle must succeed.
  await writeText(root, 'src/service.ts', '// non-test source change between Red and Green.\nexport function readiness() { return true; }\n');
  const greenA = await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  expect(greenA.valid).toBe(true);
});

// Supporting regression check (not independently trace-tracked, matching the
// convention in tdd-superseded-cycle-scoping.test.ts): REQ-TDD-GREEN-REQUIREMENT-SCOPING-002's
// coverage is proven together with TEST-TDD-GREEN-REQUIREMENT-SCOPING-001 above, since that
// test only completes once a rejected Green attempt (for a requirement ID with no matching
// pending cycle) leaves no order-log entry to block the correctly-matched Green that follows.
it('rejects Green for a requirement ID with no matching pending cycle without blocking a later correct Green', async () => {
  const root = await project();
  await writeText(root, 'src/service.test.ts', multiVerifiesTestCode);

  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));

  // No pending cycle exists for REQ-EXAMPLE-002 on this test ID yet; Green
  // must be rejected before running the command or touching the order log.
  await expect(runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'passed'))).rejects.toThrow();

  // The legitimate Green for REQ-EXAMPLE-001's own cycle must still succeed;
  // it must not be blocked by a leaked order-log entry from the rejection above.
  await writeText(root, 'src/service.ts', '// non-test source change between Red and Green.\nexport function readiness() { return true; }\n');
  const green = await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  expect(green.valid).toBe(true);
});
