import { expect, it } from 'vitest';
import { validateTddEvidence, writeText, runTddPhase } from '../packages/analysis/src/index.js';
import { code, project, tddResultRunner } from './helpers.js';

const nestedTestFile = (extra: string) => `import { readiness } from './service.js';

export function suite() {
  /** @id TEST-EXAMPLE-001
   * @verifies REQ-EXAMPLE-001
   */
  function testFirst() { if (!readiness()) throw new Error('not ready'); }
${extra}
}
`;

// Deliberately not nested inside a `describe(...)` block: this test's own
// declaration must stay a top-level statement so its own TDD fingerprint is
// unaffected by the fix under test (REQ-TDD-FINGERPRINT-SCOPING-002). The
// nested-`describe`-style structure under test lives in the fixture file
// (`src/service.test.ts`) written below, not in this file.
/** @id TEST-TDD-FINGERPRINT-SCOPING-001
 * @verifies REQ-TDD-FINGERPRINT-SCOPING-001
 */
it('TEST-TDD-FINGERPRINT-SCOPING-001 keeps a nested test non-stale when a later sibling test is appended', async () => {
  const root = await project();
  await writeText(root, 'src/service.test.ts', nestedTestFile(''));

  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', `${code}\n// non-test source change between Red and Green.\n`);
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));

  let evidence = await validateTddEvidence(root);
  expect(evidence.diagnostics.filter((d) => d.code === 'TDD_TEST_STALE')).toEqual([]);

  // Append a new sibling test after the recorded one, exactly as incremental
  // TDD authoring does; TEST-EXAMPLE-001's own declaration is unchanged.
  await writeText(root, 'src/service.test.ts', nestedTestFile(`
  /** @id TEST-EXAMPLE-003
   * @verifies REQ-EXAMPLE-001
   */
  function testSecond() { if (!readiness()) throw new Error('not ready'); }`));

  evidence = await validateTddEvidence(root);
  expect(evidence.diagnostics.filter((d) => d.code === 'TDD_TEST_STALE' && d.message.includes('TEST-EXAMPLE-001'))).toEqual([]);
});

const topLevelTestFile = (extra: string) => `import { readiness } from './service.js';

/** @id TEST-EXAMPLE-001
 * @verifies REQ-EXAMPLE-001
 */
export function testFirst() { if (!readiness()) throw new Error('not ready'); }
${extra}
`;

// A test declared as its own top-level statement must keep computing the
// same fingerprint as before this change (REQ-TDD-FINGERPRINT-SCOPING-001's
// preservation clause). This scenario was already correctly scoped before
// the fix, so it needs no fresh Red; REQ-TDD-FINGERPRINT-SCOPING-001's
// coverage is already proven by the cycle above, and this is a supporting
// regression check, not a fresh trace-tracked test.
it('preserves the existing fingerprint for a top-level test declaration', async () => {
  const root = await project();
  await writeText(root, 'src/service.test.ts', topLevelTestFile(''));

  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', `${code}\n// non-test source change between Red and Green.\n`);
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));

  let evidence = await validateTddEvidence(root);
  expect(evidence.diagnostics.filter((d) => d.code === 'TDD_TEST_STALE')).toEqual([]);

  // Append a new sibling top-level test after the recorded one; this path
  // was already correctly scoped before this change (matches a top-level
  // AST statement directly) and must remain so.
  await writeText(root, 'src/service.test.ts', topLevelTestFile(`
/** @id TEST-EXAMPLE-003
 * @verifies REQ-EXAMPLE-001
 */
export function testSecond() { if (!readiness()) throw new Error('not ready'); }`));

  evidence = await validateTddEvidence(root);
  expect(evidence.diagnostics.filter((d) => d.code === 'TDD_TEST_STALE' && d.message.includes('TEST-EXAMPLE-001'))).toEqual([]);
});
