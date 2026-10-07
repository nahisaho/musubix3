import { expect, it } from 'vitest';
import {
  exists, readText, recordChangePhase, runTddPhase, within, writeText,
} from '../packages/analysis/src/index.js';
import { project, tddResultRunner } from './helpers.js';

async function snapshotTddEvidence(root: string): Promise<{ order: string; tdd: string | null }> {
  return {
    order: await readText(root, '.musubix/evidence/order.json'),
    tdd: await exists(within(root, '.musubix/evidence/tdd.json')) ? await readText(root, '.musubix/evidence/tdd.json') : null,
  };
}

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

/** @id TEST-TDD-GREEN-REQUIREMENT-SCOPING-002
 * @verifies REQ-TDD-GREEN-REQUIREMENT-SCOPING-003
 */
it('TEST-TDD-GREEN-REQUIREMENT-SCOPING-002 rejects tdd red/green before its change-record phase precondition is satisfied, writing no evidence', async () => {
  const root = await project();
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001']);

  // Neither requirements nor design has been change-recorded yet: Red must be
  // rejected naming the design phase, before the test command runs or any
  // evidence/order-log entry is written.
  const beforeDesignMissing = await snapshotTddEvidence(root);
  await expect(runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 })))
    .rejects.toThrow(/change-record CHANGE-0001 design --requirement REQ-EXAMPLE-001/);
  expect(await snapshotTddEvidence(root)).toEqual(beforeDesignMissing);

  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001']);

  // design is now change-recorded: Red itself succeeds.
  const red = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  expect(red.valid).toBe(true);

  // The TDD-evidence Red cycle above does not itself satisfy this
  // requirement's change-record precondition for Green: change-record red
  // has not been recorded for CHANGE-0001 yet, so Green must still be
  // rejected, naming the change-record red command, before the test command
  // runs again or any new evidence/order-log entry is written.
  await writeText(root, 'src/service.ts', `/** @id CODE-EXAMPLE-001
 * @implements REQ-EXAMPLE-001
 * @design DES-EXAMPLE-001
 */
export function readiness() { return true; } // non-test source change between Red and Green.
`);
  const beforeRedMissing = await snapshotTddEvidence(root);
  await expect(runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed')))
    .rejects.toThrow(/change-record CHANGE-0001 red --requirement REQ-EXAMPLE-001/);
  expect(await snapshotTddEvidence(root)).toEqual(beforeRedMissing);

  await writeText(root, 'src/service.test.ts',
    `${await readText(root, 'src/service.test.ts')}\n// staged failing behavior for CHANGE-0001's own red phase.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);

  // change-record red is recorded but not yet implementation: Green must be
  // rejected again, now naming the change-record implementation command.
  const beforeImplementationMissing = await snapshotTddEvidence(root);
  await expect(runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed')))
    .rejects.toThrow(/change-record CHANGE-0001 implementation --requirement REQ-EXAMPLE-001/);
  expect(await snapshotTddEvidence(root)).toEqual(beforeImplementationMissing);

  await writeText(root, 'src/service.ts', `/** @id CODE-EXAMPLE-001
 * @implements REQ-EXAMPLE-001
 * @design DES-EXAMPLE-001
 */
export function readiness() { return true; } // further non-test change for CHANGE-0001's own implementation phase.
`);
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);

  // Both red and implementation are now change-recorded: Green succeeds.
  const green = await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  expect(green.valid).toBe(true);
});

// Supporting regression check (not independently trace-tracked, matching the
// convention above): REQ-TDD-GREEN-REQUIREMENT-SCOPING-003's "zero changes
// reference the requirement at all" acceptance scenario.
it('rejects tdd red naming design as missing, without naming any change-id, when no staged change references the requirement at all', async () => {
  const root = await project();
  // A staged change document and recorded impact phase exist, but they
  // reference a different requirement entirely, so zero candidates match
  // REQ-EXAMPLE-001 (hasChangeDocuments is still true project-wide).
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-OTHER-001\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-OTHER-001']);

  let message = '';
  try {
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
  } catch (cause) {
    message = cause instanceof Error ? cause.message : String(cause);
  }
  expect(message).toMatch(/design/);
  expect(message).not.toMatch(/change-record CHANGE-0001/);
});

// Supporting regression check (not independently trace-tracked): REQ-TDD-GREEN-REQUIREMENT-SCOPING-003's
// "zero staged change documents" acceptance scenario — existing non-staged-change
// TDD workflows (already exercised throughout this file's other tests, none of
// which create a `.musubix/changes/CHANGE-*.md` file) keep working unaffected.
it('leaves tdd red/green unaffected when the project has zero staged change documents', async () => {
  const root = await project();
  const red = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  expect(red.valid).toBe(true);
  await writeText(root, 'src/service.ts', '// non-test source change between Red and Green.\nexport function readiness() { return true; }\n');
  const green = await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  expect(green.valid).toBe(true);
});
