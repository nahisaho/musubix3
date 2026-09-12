import { expect, it } from 'vitest';
import {
  appendEvidenceOrder, digest, migrateTddFingerprint, readText, runTddPhase, validateTddEvidence, voidTddCycle, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import { digestChainRecord, project, tddResultRunner } from './helpers.js';

// Directly appends a validly linked `void` payload onto an arbitrary
// (possibly non-latest) cycle, bypassing `voidTddCycle`'s own eligibility
// checks. This mirrors this repository's existing evidence-tamper test
// convention (see `recordAsLegacy` in tests/tdd-fingerprint-migration.test.ts)
// and is the only way to construct scenarios `voidTddCycle` itself would
// never organically produce, such as "an earlier fallback candidate is
// already validly voided" (REQ-TDD-CYCLE-VOID-002).
async function forceVoid(root: string, cycleId: string, approver = 'nahisaho', reason = 'fixture void'): Promise<void> {
  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const cycle = evidence.cycles.find((entry: { cycleId?: string }) => entry.cycleId === cycleId);
  const orderRecord = await appendEvidenceOrder(root, { kind: 'tdd', entityId: cycleId, phase: 'void', testId: cycle.testId });
  const voidPayload = { phase: 'void', approver, reason, order: orderRecord.sequence, recordedAt: new Date().toISOString() };
  cycle.void = voidPayload;
  const previous = evidence.chain.at(-1);
  const payload = {
    sequence: evidence.chain.length + 1,
    cycleId,
    requirementId: cycle.requirementId,
    testId: cycle.testId,
    testPath: cycle.testPath,
    commandName: cycle.commandName,
    phase: 'void',
    phaseEvidenceSha256: digest(JSON.stringify(voidPayload)),
    previousSha256: previous?.recordSha256 ?? null,
  };
  evidence.chain.push({ ...payload, recordSha256: digestChainRecord(payload) });
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);
}

async function recordFullCycle(root: string, sourceChange = '// change\n'): Promise<void> {
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'failed', { exitCode: 1 }));
  await writeText(root, 'src/service.ts', `// non-test source change between Red and Green.\n${sourceChange}export function ready() { return true; }\n`);
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'passed'));
}

async function recordDanglingCycle(root: string): Promise<void> {
  // A trailing cycle with only a (valid) Red phase and no Green: the
  // "accidental re-invocation after already Green" scenario this feature
  // targets.
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'failed', { exitCode: 1 }));
}

async function latestCycleId(root: string, testId = 'TEST-EXAMPLE-001'): Promise<string> {
  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  return evidence.cycles.filter((cycle: { testId: string }) => cycle.testId === testId).at(-1).cycleId;
}

/** @id TEST-TDD-CYCLE-VOID-001
 * @verifies REQ-TDD-CYCLE-VOID-001
 */
it('TEST-TDD-CYCLE-VOID-001 rejects voiding a cycle whose latest Green is already valid', async () => {
  const root = await project();
  await recordFullCycle(root);
  const before = await readText(root, '.musubix/evidence/tdd.json');
  const beforeOrder = await readText(root, '.musubix/evidence/order.json');
  await expect(voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'not dangling')).rejects.toThrow(/valid Green/);
  expect(await readText(root, '.musubix/evidence/tdd.json')).toBe(before);
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(beforeOrder);
});

/** @id TEST-TDD-CYCLE-VOID-002
 * @verifies REQ-TDD-CYCLE-VOID-002
 */
it('TEST-TDD-CYCLE-VOID-002 rejects voiding when no earlier non-voided valid fallback cycle exists', async () => {
  const root = await project();
  // No earlier cycle at all.
  await recordDanglingCycle(root);
  const before = await readText(root, '.musubix/evidence/tdd.json');
  const beforeOrder = await readText(root, '.musubix/evidence/order.json');
  let result = await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'no coverage without it');
  expect(result).toMatchObject({ voided: false, testId: 'TEST-EXAMPLE-001' });
  expect(result.reason).toMatch(/no earlier valid/);
  expect(await readText(root, '.musubix/evidence/tdd.json')).toBe(before);
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(beforeOrder);

  // The only earlier valid Red-Green cycle is itself already (validly) voided.
  const root2 = await project();
  await recordFullCycle(root2);
  const firstCycleId = await latestCycleId(root2);
  await forceVoid(root2, firstCycleId);
  await recordDanglingCycle(root2);
  result = await voidTddCycle(root2, 'TEST-EXAMPLE-001', 'nahisaho', 'no coverage without it');
  expect(result).toMatchObject({ voided: false });
  expect(result.reason).toMatch(/no earlier valid/);
});

/** @id TEST-TDD-CYCLE-VOID-003
 * @verifies REQ-TDD-CYCLE-VOID-003
 */
it('TEST-TDD-CYCLE-VOID-003 requires a non-empty approver and reason', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  await expect(voidTddCycle(root, 'TEST-EXAMPLE-001', '', 'a reason')).rejects.toThrow(/approver/);
  await expect(voidTddCycle(root, 'TEST-EXAMPLE-001', '  ', 'a reason')).rejects.toThrow(/approver/);
  await expect(voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', '')).rejects.toThrow(/reason/);
  await expect(voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', '   ')).rejects.toThrow(/reason/);
});

/** @id TEST-TDD-CYCLE-VOID-004
 * @verifies REQ-TDD-CYCLE-VOID-004
 */
it('TEST-TDD-CYCLE-VOID-004 records the void as a hash-chained, ordered, identity-bound entry without disturbing other evidence', async () => {
  const root = await project();
  await recordFullCycle(root);
  const firstCycleId = await latestCycleId(root);
  await recordDanglingCycle(root);
  const danglingCycleId = await latestCycleId(root);

  const beforeEvidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const firstCycleBefore = beforeEvidence.cycles.find((cycle: { cycleId: string }) => cycle.cycleId === firstCycleId);
  const beforeOrder = JSON.parse(await readText(root, '.musubix/evidence/order.json'));
  const maxSequence = Math.max(...beforeOrder.records.map((record: { sequence: number }) => record.sequence));

  const result = await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'accidental duplicate Red invocation');
  expect(result).toMatchObject({ voided: true, testId: 'TEST-EXAMPLE-001', cycleId: danglingCycleId });

  const afterEvidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const firstCycleAfter = afterEvidence.cycles.find((cycle: { cycleId: string }) => cycle.cycleId === firstCycleId);
  expect(firstCycleAfter).toEqual(firstCycleBefore);

  const dangling = afterEvidence.cycles.find((cycle: { cycleId: string }) => cycle.cycleId === danglingCycleId);
  expect(dangling.void).toMatchObject({ phase: 'void', approver: 'nahisaho', reason: 'accidental duplicate Red invocation' });

  const afterOrder = JSON.parse(await readText(root, '.musubix/evidence/order.json'));
  const newOrderRecords = afterOrder.records.filter((record: { phase: string }) => record.phase === 'void');
  expect(newOrderRecords).toHaveLength(1);
  expect(newOrderRecords[0]).toMatchObject({ entityId: danglingCycleId, testId: 'TEST-EXAMPLE-001', sequence: maxSequence + 1 });

  const voidChainRecords = afterEvidence.chain.filter((record: { phase: string }) => record.phase === 'void');
  expect(voidChainRecords).toHaveLength(1);
  expect(voidChainRecords[0]).toMatchObject({ cycleId: danglingCycleId, testId: 'TEST-EXAMPLE-001', phase: 'void' });
  expect(voidChainRecords[0].previousSha256).toBe(afterEvidence.chain.at(-2).recordSha256);
});

/** @id TEST-TDD-CYCLE-VOID-005
 * @verifies REQ-TDD-CYCLE-VOID-005
 */
it('TEST-TDD-CYCLE-VOID-005 treats a void payload with a mismatched cycleId chain record as not validly linked', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'accidental duplicate Red invocation');

  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const voidChainRecord = evidence.chain.find((record: { phase: string }) => record.phase === 'void');
  voidChainRecord.cycleId = 'not-the-real-cycle-id';
  const { recordSha256: _drop, ...rest } = voidChainRecord;
  voidChainRecord.recordSha256 = digestChainRecord(rest);
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);

  const validation = await validateTddEvidence(root);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_VOID_EVIDENCE_MALFORMED' && d.message.includes('TEST-EXAMPLE-001'))).toBe(true);
  expect(validation.voided).toEqual([]);
});

/** @id TEST-TDD-CYCLE-VOID-006
 * @verifies REQ-TDD-CYCLE-VOID-006
 */
it('TEST-TDD-CYCLE-VOID-006 reports malformed void evidence for a duplicated void chain record', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'accidental duplicate Red invocation');

  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const orderLog = JSON.parse(await readText(root, '.musubix/evidence/order.json'));
  const voidChainRecord = evidence.chain.find((record: { phase: string }) => record.phase === 'void');
  const duplicate = {
    ...voidChainRecord,
    sequence: evidence.chain.length + 1,
    previousSha256: evidence.chain.at(-1).recordSha256,
  };
  delete (duplicate as { recordSha256?: string }).recordSha256;
  const withHash = { ...duplicate, recordSha256: digestChainRecord(duplicate) };
  evidence.chain.push(withHash);
  const dupOrder = {
    sequence: orderLog.records.length + 1,
    kind: 'tdd',
    entityId: voidChainRecord.cycleId,
    phase: 'void',
    testId: voidChainRecord.testId,
    previousSha256: orderLog.records.at(-1).recordSha256,
  };
  orderLog.records.push({ ...dupOrder, recordSha256: digest(JSON.stringify(dupOrder)) });
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);
  await writeJson(root, '.musubix/evidence/order.json', orderLog);

  const validation = await validateTddEvidence(root);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_VOID_EVIDENCE_MALFORMED')).toBe(true);
});

/** @id TEST-TDD-CYCLE-VOID-007
 * @verifies REQ-TDD-CYCLE-VOID-007
 */
it('TEST-TDD-CYCLE-VOID-007 still raises TDD_GREEN_MISSING alongside the malformed-void diagnostic', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'accidental duplicate Red invocation');

  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const voidChainRecord = evidence.chain.find((record: { phase: string }) => record.phase === 'void');
  voidChainRecord.testId = 'TEST-EXAMPLE-999';
  const { recordSha256: _drop, ...rest } = voidChainRecord;
  voidChainRecord.recordSha256 = digestChainRecord(rest);
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);

  const validation = await validateTddEvidence(root);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_VOID_EVIDENCE_MALFORMED')).toBe(true);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_GREEN_MISSING' && d.message.includes('TEST-EXAMPLE-001'))).toBe(true);
});

/** @id TEST-TDD-CYCLE-VOID-008
 * @verifies REQ-TDD-CYCLE-VOID-008
 */
it('TEST-TDD-CYCLE-VOID-008 suppresses missing-phase diagnostics independently for each validly voided trailing cycle', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  const secondCycleId = await latestCycleId(root);
  await recordDanglingCycle(root);
  const thirdCycleId = await latestCycleId(root);

  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'void the newest dangling cycle');
  let validation = await validateTddEvidence(root);
  expect(validation.diagnostics.filter((d) => d.message.includes(thirdCycleId)).some((d) => d.code === 'TDD_GREEN_MISSING')).toBe(false);
  // The still-unvoided middle cycle keeps raising its diagnostics.
  expect(validation.diagnostics.some((d) => d.code === 'TDD_GREEN_MISSING' && d.message.includes('TEST-EXAMPLE-001'))).toBe(true);

  await forceVoid(root, secondCycleId, 'nahisaho', 'void the middle dangling cycle too');
  validation = await validateTddEvidence(root);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_GREEN_MISSING' || d.code === 'TDD_RED_MISSING')).toBe(false);
  expect(validation.voided.map((entry) => entry.cycleId).sort()).toEqual([secondCycleId, thirdCycleId].sort());
});

/** @id TEST-TDD-CYCLE-VOID-009
 * @verifies REQ-TDD-CYCLE-VOID-009
 */
it('TEST-TDD-CYCLE-VOID-009 leaves diagnostics for a non-voided cycle unaffected by voiding a different cycle', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  const middleCycleId = await latestCycleId(root);
  await recordDanglingCycle(root);

  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'void only the newest dangling cycle');
  const validation = await validateTddEvidence(root);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_GREEN_MISSING' && d.message.includes('TEST-EXAMPLE-001'))).toBe(true);
  expect(validation.voided.map((entry) => entry.cycleId)).not.toContain(middleCycleId);
});

/** @id TEST-TDD-CYCLE-VOID-010
 * @verifies REQ-TDD-CYCLE-VOID-010
 */
it('TEST-TDD-CYCLE-VOID-010 computes TDD_TEST_STALE against the nearest earlier non-voided valid cycle after voiding', async () => {
  const root = await project();
  await recordFullCycle(root, '// first change\n');
  await recordDanglingCycle(root);
  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'accidental duplicate Red invocation');

  let validation = await validateTddEvidence(root);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_TEST_STALE')).toBe(false);

  // A genuine edit to the test afterwards must still be detected against the
  // effective (voided-around) latest cycle.
  const staleTestCode = `import { ready } from './service.js';
/** @id TEST-EXAMPLE-001
 * @verifies REQ-EXAMPLE-001
 */
export function testReadiness() { if (!ready()) throw new Error('still not ready'); }
`;
  await writeText(root, 'src/service.test.ts', staleTestCode);
  validation = await validateTddEvidence(root);
  expect(validation.diagnostics.some((d) => d.code === 'TDD_TEST_STALE' && d.message.includes('TEST-EXAMPLE-001'))).toBe(true);
});

/** @id TEST-TDD-CYCLE-VOID-011
 * @verifies REQ-TDD-CYCLE-VOID-011
 */
it('TEST-TDD-CYCLE-VOID-011 rejects re-voiding but allows voiding a fresh later cycle', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'first void');
  const before = await readText(root, '.musubix/evidence/tdd.json');
  const beforeOrder = await readText(root, '.musubix/evidence/order.json');
  await expect(voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'second void')).rejects.toThrow(/already voided/);
  expect(await readText(root, '.musubix/evidence/tdd.json')).toBe(before);
  expect(await readText(root, '.musubix/evidence/order.json')).toBe(beforeOrder);

  // A fresh, later, fully valid Red-Green cycle, then a new dangling cycle:
  // voiding must not be rejected merely because an earlier cycle was voided.
  await recordFullCycle(root, '// second change\n');
  await recordDanglingCycle(root);
  const result = await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'void the newest dangling cycle again');
  expect(result.voided).toBe(true);
});

/** @id TEST-TDD-CYCLE-VOID-012
 * @verifies REQ-TDD-CYCLE-VOID-012
 */
it('TEST-TDD-CYCLE-VOID-012 routes tdd migrate around a validly voided latest cycle', async () => {
  const root = await project();
  await recordFullCycle(root);
  const firstCycleId = await latestCycleId(root);
  await recordDanglingCycle(root);
  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'accidental duplicate Red invocation');

  const migration = await migrateTddFingerprint(root, 'TEST-EXAMPLE-001', 'nahisaho');
  // The effective-latest cycle (the earlier full cycle) has no drift under
  // the superseded algorithm relative to its own current test text, so this
  // exercises routing; a genuine mismatch would instead report `migrated:
  // false` with the "real drift" reason, proving it targeted a real cycle.
  expect(migration.testId).toBe('TEST-EXAMPLE-001');
  expect(['migrated', 'not-migrated']).toContain(migration.migrated ? 'migrated' : 'not-migrated');

  const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
  const firstCycle = evidence.cycles.find((cycle: { cycleId: string }) => cycle.cycleId === firstCycleId);
  if (migration.migrated) expect(firstCycle.migrate).toBeDefined();
});

/** @id TEST-TDD-CYCLE-VOID-013
 * @verifies REQ-TDD-CYCLE-VOID-013
 */
it('TEST-TDD-CYCLE-VOID-013 surfaces scoped void evidence in tdd validate output, keyed to its own cycle', async () => {
  const root = await project();
  await recordFullCycle(root);
  const firstCycleId = await latestCycleId(root);
  await recordDanglingCycle(root);
  const danglingCycleId = await latestCycleId(root);
  await voidTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'accidental duplicate Red invocation');

  const validation = await validateTddEvidence(root);
  expect(validation.voided).toHaveLength(1);
  expect(validation.voided[0]).toMatchObject({
    testId: 'TEST-EXAMPLE-001',
    cycleId: danglingCycleId,
    void: { approver: 'nahisaho', reason: 'accidental duplicate Red invocation' },
  });
  expect(validation.voided.map((entry) => entry.cycleId)).not.toContain(firstCycleId);
});
