import { expect, it } from 'vitest';
import {
  buildTrace, legacyTestFingerprint, migrateTddFingerprint, readText, runTddPhase, validateTddEvidence, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { code, digestChainRecord, project, tddResultRunner } from './helpers.js';

const nestedTestFile = (body: string) => `import { readiness } from './service.js';

export function suite() {
  /** @id TEST-EXAMPLE-001
   * @verifies REQ-EXAMPLE-001
   */
  function testFirst() { if (!readiness()) throw new Error('not ready'); }
  ${body}
}
`;

// Simulates the real-world state this feature migrates: a cycle whose Green
// phase was recorded under the superseded (pre-AST-scoping) algorithm.
// Directly rewriting recorded evidence mirrors this repository's existing
// evidence-tamper test convention (see tests/gate-install.test.ts), and is
// the only way to reconstruct "recorded under an algorithm this codebase no
// longer runs" without reverting the fix under test.
async function recordAsLegacy(root: string, testId: string): Promise<{ legacyValue: string; newValue: string }> {
  const trace = await buildTrace(root);
  const test = trace.nodes.find((node) => node.kind === 'test' && node.id === testId)!;
  const legacyValue = await legacyTestFingerprint(root, test);
  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const cycle = evidence.cycles.at(-1);
  const newValue = cycle.green.testFingerprint;
  cycle.green.testFingerprint = legacyValue;
  const chainRecord = evidence.chain.find((record: { cycleId: string; phase: string }) =>
    record.cycleId === cycle.cycleId && record.phase === 'green');
  chainRecord.phaseEvidenceSha256 = digestChainRecord(cycle.green);
  const { recordSha256: _drop, ...rest } = chainRecord;
  chainRecord.recordSha256 = digestChainRecord(rest);
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);
  return { legacyValue, newValue };
}

/** @id TEST-TDD-FINGERPRINT-MIGRATION-001
 * @verifies REQ-TDD-FINGERPRINT-MIGRATION-001
 */
it('TEST-TDD-FINGERPRINT-MIGRATION-001 migrates a cycle recorded under the superseded algorithm without a fresh Red/Green', async () => {
  const root = await project();
  await writeText(root, 'src/service.test.ts', nestedTestFile(''));
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', `${code}\n// non-test source change between Red and Green.\n`);
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));

  const { legacyValue, newValue } = await recordAsLegacy(root, 'TEST-EXAMPLE-001');
  expect(legacyValue).not.toBe(newValue);

  let staleness = await validateTddEvidence(root);
  expect(staleness.diagnostics.some((d) => d.code === 'TDD_TEST_STALE')).toBe(true);

  const migration = await migrateTddFingerprint(root, 'TEST-EXAMPLE-001', 'nahisaho');
  expect(migration).toMatchObject({ migrated: true, fromFingerprint: legacyValue, toFingerprint: newValue });

  staleness = await validateTddEvidence(root);
  expect(staleness.valid).toBe(true);
  expect(staleness.diagnostics).toEqual([]);

  // A genuine later edit to the test's own body must still be detected.
  await writeText(root, 'src/service.test.ts', nestedTestFile('// edited').replace(
    "function testFirst() { if (!readiness()) throw new Error('not ready'); }",
    "function testFirst() { if (!readiness()) throw new Error('genuinely changed'); }",
  ));
  staleness = await validateTddEvidence(root);
  expect(staleness.diagnostics.some((d) => d.code === 'TDD_TEST_STALE' && d.message.includes('TEST-EXAMPLE-001'))).toBe(true);
});

it('TEST-TDD-FINGERPRINT-MIGRATION-002 refuses to migrate a cycle whose test genuinely drifted', async () => {
  const root = await project();
  await writeText(root, 'src/service.test.ts', nestedTestFile(''));
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', `${code}\n// non-test source change between Red and Green.\n`);
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  await recordAsLegacy(root, 'TEST-EXAMPLE-001');

  // Real drift: the annotated test's own body changes after the simulated
  // legacy recording, so the legacy recomputation of the new text can no
  // longer match the stored legacy fingerprint.
  await writeText(root, 'src/service.test.ts', nestedTestFile('').replace(
    "function testFirst() { if (!readiness()) throw new Error('not ready'); }",
    "function testFirst() { if (!readiness()) throw new Error('genuinely different'); }",
  ));

  const migration = await migrateTddFingerprint(root, 'TEST-EXAMPLE-001', 'nahisaho');
  expect(migration.migrated).toBe(false);
  expect(migration.reason).toMatch(/real drift/);

  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  expect(evidence.cycles.at(-1).migrate).toBeUndefined();
});
