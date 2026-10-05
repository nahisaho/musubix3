import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  archiveTddCycle, buildTrace, legacyTestFingerprint, migrateTddFingerprint, migrateTddIdentifier,
  readText, runProcess, runTddPhase, validateTddEvidence, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { code, digestChainRecord, project, req, tddResultRunner } from './helpers.js';

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

const identifierMigrationDeclaration = (testId: string, title = `${testId} keeps behavior`, body = 'expect(readiness()).toBe(true);') => `
  /** @id ${testId}
   * @verifies REQ-EXAMPLE-001
   */
  it('${title}', () => {
    ${body}
  });
`;

const identifierMigrationTestFile = (testId: string, title = `${testId} keeps behavior`, body = 'expect(readiness()).toBe(true);') => `import { describe, expect, it } from 'vitest';
import { readiness } from './service.js';

describe('identifier migration', () => {${identifierMigrationDeclaration(testId, title, body)}
});
`;

async function migrateWithRename(
  root: string,
  oldTestId: string,
  newTestId: string,
  options: { preMigrateFingerprint?: boolean; body?: string } = {},
): Promise<void> {
  await writeText(root, 'src/service.test.ts', identifierMigrationTestFile(oldTestId));
  await runTddPhase(root, 'red', oldTestId, 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', `${code}\n// non-test source change between Red and Green.\n`);
  await runTddPhase(root, 'green', oldTestId, 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  if (options.preMigrateFingerprint) {
    await recordAsLegacy(root, oldTestId);
    const fingerprintMigration = await migrateTddFingerprint(root, oldTestId, 'nahisaho');
    expect(fingerprintMigration).toMatchObject({ migrated: true, testId: oldTestId });
  }
  await writeText(root, 'src/service.test.ts', identifierMigrationTestFile(
    newTestId,
    `${newTestId} keeps behavior`,
    options.body ?? 'expect(readiness()).toBe(true);',
  ));
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

/** @id TEST-TDD-IDENTIFIER-MIGRATION-002
 * @verifies REQ-TDD-IDENTIFIER-MIGRATION-001 REQ-TDD-IDENTIFIER-MIGRATION-002 REQ-TDD-IDENTIFIER-MIGRATION-004
 */
it('TEST-TDD-IDENTIFIER-MIGRATION-002 relinks already-covered evidence across a pure identifier rename while preserving the one-ID mode', async () => {
  const root = await project();
  await writeText(root, '.musubix/features/example/requirements.md',
    `${req('The system shall report readiness.', 'REQ-EXAMPLE-001')}Acceptance: TEST-NEW-001 passes.\n`
    + `${req('The system shall report other readiness.', 'REQ-EXAMPLE-002')}Acceptance: TEST-EXAMPLE-002 passes.\n`);
  await writeText(root, 'src/other.test.ts', `import { readiness } from './service.js';
/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-002
 */
export function testOther() { if (!readiness()) throw new Error('not ready'); }
`);
  await migrateWithRename(root, 'TEST-OLD-001', 'TEST-NEW-001', { preMigrateFingerprint: true });

  const before = await validateTddEvidence(root);
  expect(before.diagnostics.some((d) => d.code === 'TDD_TEST_STALE' && d.message.includes('TEST-OLD-001'))).toBe(true);
  expect(before.diagnostics.some((d) => d.code === 'TDD_REQUIREMENT_UNCOVERED' && d.message.includes('REQ-EXAMPLE-001'))).toBe(true);
  expect(before.diagnostics.some((d) => d.code === 'TDD_REQUIREMENT_UNCOVERED' && d.message.includes('REQ-EXAMPLE-002'))).toBe(true);

  const evidenceBefore = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const orderBefore = JSON.parse(await readText(root, '.musubix/evidence/order.json'));
  const cycleBefore = evidenceBefore.cycles.at(-1);
  const redBefore = JSON.stringify(cycleBefore.red);
  const greenBefore = JSON.stringify(cycleBefore.green);

  const migration = await migrateTddIdentifier(root, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho');
  expect(migration).toMatchObject({
    migrated: true,
    testId: 'TEST-OLD-001',
    oldTestId: 'TEST-OLD-001',
    newTestId: 'TEST-NEW-001',
  });

  const after = await validateTddEvidence(root);
  expect(after.diagnostics.some((d) => d.code === 'TDD_TEST_STALE' && d.message.includes('TEST-OLD-001'))).toBe(false);
  expect(after.diagnostics.some((d) => d.code === 'TDD_REQUIREMENT_UNCOVERED' && d.message.includes('REQ-EXAMPLE-001'))).toBe(false);
  expect(after.diagnostics.some((d) => d.code === 'TDD_REQUIREMENT_UNCOVERED' && d.message.includes('REQ-EXAMPLE-002'))).toBe(true);

  const evidenceAfter = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const orderAfter = JSON.parse(await readText(root, '.musubix/evidence/order.json'));
  const cycleAfter = evidenceAfter.cycles.at(-1);
  expect(JSON.stringify(cycleAfter.red)).toBe(redBefore);
  expect(JSON.stringify(cycleAfter.green)).toBe(greenBefore);
  expect(cycleAfter.migrate.mode).toBe('fingerprint');
  expect(cycleAfter.migrateHistory).toHaveLength(2);
  expect(cycleAfter.migrateHistory[1]).toMatchObject({
    phase: 'migrate',
    mode: 'identifier',
    oldTestId: 'TEST-OLD-001',
    newTestId: 'TEST-NEW-001',
    approver: 'nahisaho',
  });
  expect(evidenceAfter.cycles).toHaveLength(evidenceBefore.cycles.length);
  expect(orderAfter.records.length).toBe(orderBefore.records.length + 1);
  expect(orderAfter.records.at(-1)).toMatchObject({
    kind: 'tdd',
    phase: 'migrate',
    oldTestId: 'TEST-OLD-001',
    newTestId: 'TEST-NEW-001',
  });

  const tddBytesBeforeRepeat = await readText(root, '.musubix/evidence/tdd.json');
  const orderBytesBeforeRepeat = await readText(root, '.musubix/evidence/order.json');
  await expect(migrateTddIdentifier(root, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho'))
    .rejects.toThrow(/already relinked|already migrated/i);
  expect(await readText(root, '.musubix/evidence/tdd.json')).toBe(tddBytesBeforeRepeat);
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(orderBytesBeforeRepeat);

  const cli = resolve('dist/packages/cli/src/main.js');
  const tooMany = await runProcess(process.execPath, [
    cli, 'tdd', 'migrate', 'TEST-OLD-001', 'TEST-NEW-001', 'TEST-EXTRA-001', '--approver', 'nahisaho', '--confirm',
  ], { cwd: root, timeoutMs: 20_000 });
  expect(tooMany.exitCode).not.toBe(0);
});

/** @id TEST-TDD-IDENTIFIER-MIGRATION-003
 * @verifies REQ-TDD-IDENTIFIER-MIGRATION-003
 */
it('TEST-TDD-IDENTIFIER-MIGRATION-003 rejects identifier migration whenever any rename-only precondition is false', async () => {
  const root = await project();
  await migrateWithRename(root, 'TEST-OLD-001', 'TEST-NEW-001');
  const baselineTdd = await readText(root, '.musubix/evidence/tdd.json');
  const baselineOrder = await readText(root, '.musubix/evidence/order.json');

  await expect(migrateTddIdentifier(root, 'TEST-OLD-001', 'TEST-OLD-001', 'nahisaho'))
    .rejects.toThrow(/must differ|same/i);
  expect(await readText(root, '.musubix/evidence/tdd.json')).toBe(baselineTdd);
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(baselineOrder);

  const changedBodyRoot = await project();
  await migrateWithRename(changedBodyRoot, 'TEST-OLD-001', 'TEST-NEW-001', {
    body: "expect(readiness()).toBe(true); expect('changed body').toContain('body');",
  });
  await expect(migrateTddIdentifier(changedBodyRoot, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho'))
    .rejects.toThrow(/rename-only|fingerprint|statement|assertion/i);

  const sourceChangedRoot = await project();
  await migrateWithRename(sourceChangedRoot, 'TEST-OLD-001', 'TEST-NEW-001');
  await writeText(sourceChangedRoot, 'src/service.ts', `${code}\n// post-green non-test drift before rename relink.\n`);
  await expect(migrateTddIdentifier(sourceChangedRoot, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho'))
    .rejects.toThrow(/sourceFingerprint|non-test/i);

  const movedRoot = await project();
  await migrateWithRename(movedRoot, 'TEST-OLD-001', 'TEST-NEW-001');
  await writeText(movedRoot, 'src/renamed.test.ts', identifierMigrationTestFile('TEST-NEW-001'));
  await writeText(movedRoot, 'src/service.test.ts', '');
  await expect(migrateTddIdentifier(movedRoot, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho'))
    .rejects.toThrow(/different file path|same test file/i);

  const duplicateRoot = await project();
  await migrateWithRename(duplicateRoot, 'TEST-OLD-001', 'TEST-NEW-001');
  await writeText(duplicateRoot, 'src/service.test.ts', `import { describe, expect, it } from 'vitest';
import { readiness } from './service.js';

describe('identifier migration', () => {${identifierMigrationDeclaration('TEST-OLD-001')}${identifierMigrationDeclaration('TEST-NEW-001')}
});
`);
  await expect(migrateTddIdentifier(duplicateRoot, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho'))
    .rejects.toThrow(/old.*declaration remains|surviving authoritative/i);

  const conflictRoot = await project();
  await migrateWithRename(conflictRoot, 'TEST-OLD-001', 'TEST-NEW-001');
  await runTddPhase(conflictRoot, 'red', 'TEST-NEW-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(conflictRoot, 'failed', { exitCode: 1 }));
  await writeText(conflictRoot, 'src/service.ts', `${code}\n// another source change between Red and Green.\n`);
  await runTddPhase(conflictRoot, 'green', 'TEST-NEW-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(conflictRoot, 'passed'));
  await expect(migrateTddIdentifier(conflictRoot, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho'))
    .rejects.toThrow(/already has.*cycle|prior cycle/i);

  const archivedRoot = await project();
  await writeText(archivedRoot, 'src/service.test.ts', identifierMigrationTestFile('TEST-OLD-001'));
  await runTddPhase(archivedRoot, 'red', 'TEST-OLD-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(archivedRoot, 'failed', { exitCode: 1 }));
  await writeText(archivedRoot, 'src/service.ts', `${code}\n// non-test source change between Red and Green.\n`);
  await runTddPhase(archivedRoot, 'green', 'TEST-OLD-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(archivedRoot, 'passed'));
  await archiveTddCycle(archivedRoot, 'TEST-OLD-001', 'nahisaho', 'covered elsewhere');
  await writeText(archivedRoot, 'src/service.test.ts', identifierMigrationTestFile('TEST-NEW-001'));
  await expect(migrateTddIdentifier(archivedRoot, 'TEST-OLD-001', 'TEST-NEW-001', 'nahisaho'))
    .rejects.toThrow(/archived/i);
});
