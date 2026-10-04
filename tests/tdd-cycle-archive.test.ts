// Covers the `tdd-cycle-archive` feature (CHANGE-0039, Issue #50): archiving a
// latest TDD cycle via `archiveTddCycle`/`tdd archive`, its hash-chained
// linkage validation (`archiveLinkage`), and its interaction with mandatory
// requirement coverage, migration precedence, and `tdd validate --json`
// surfacing. See .musubix/features/tdd-cycle-archive/{requirements,design}.md.
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { digestChainRecord, project, tddResultRunner } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');

type ArchiveResult = { archived: boolean; testId: string; cycleId?: string; reason?: string };

// Directly appends a validly linked `archive` payload onto an arbitrary
// (possibly non-latest) cycle, bypassing `archiveTddCycle`'s latest-cycle
// preconditions. This mirrors the repository's existing evidence-tamper test
// convention for targeted malformed/precedence scenarios.
async function forceArchive(root: string, cycleId: string, approver = 'nahisaho', reason = 'fixture archive'): Promise<void> {
  const evidence = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const cycle = evidence.cycles.find((entry: { cycleId?: string }) => entry.cycleId === cycleId);
  const orderRecord = await analysis.appendEvidenceOrder(root, { kind: 'tdd', entityId: cycleId, phase: 'archive', testId: cycle.testId });
  const archivePayload = {
    phase: 'archive',
    approver,
    reason,
    testId: cycle.testId,
    cycleId,
    order: orderRecord.sequence,
    recordedAt: new Date().toISOString(),
  };
  cycle.archive = archivePayload;
  const previous = evidence.chain.at(-1);
  const payload = {
    sequence: evidence.chain.length + 1,
    cycleId,
    requirementId: cycle.requirementId,
    testId: cycle.testId,
    testPath: cycle.testPath,
    commandName: cycle.commandName,
    phase: 'archive',
    phaseEvidenceSha256: analysis.digest(JSON.stringify(archivePayload)),
    previousSha256: previous?.recordSha256 ?? null,
  };
  evidence.chain.push({ ...payload, recordSha256: digestChainRecord(payload) });
  await analysis.writeJson(root, '.musubix/evidence/tdd.json', evidence);
}

async function archiveTddCycle(root: string, testId: string, approver: string, reason: string): Promise<ArchiveResult> {
  const fn = (analysis as Record<string, unknown>).archiveTddCycle;
  if (typeof fn !== 'function') throw new Error('archiveTddCycle is not available.');
  return (fn as (root: string, testId: string, approver: string, reason: string) => Promise<ArchiveResult>)(root, testId, approver, reason);
}

async function invoke(root: string, args: string[]): Promise<Awaited<ReturnType<typeof analysis.runProcess>>> {
  return analysis.runProcess(process.execPath, [cli, ...args], { cwd: root, timeoutMs: 20_000 });
}

async function readEvidence(root: string): Promise<{
  cycles: Array<Record<string, unknown>>;
  chain: Array<Record<string, unknown>>;
}> {
  return JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
}

function archivedEntries(report: Awaited<ReturnType<typeof analysis.validateTddEvidence>>): Array<{
  testId: string;
  cycleId: string;
  archive: { approver: string; reason: string; recordedAt: string };
}> {
  const value = (report as Record<string, unknown>).archived;
  return Array.isArray(value) ? value as Array<{
    testId: string;
    cycleId: string;
    archive: { approver: string; reason: string; recordedAt: string };
  }> : [];
}

async function latestCycleId(root: string, testId = 'TEST-EXAMPLE-001'): Promise<string> {
  const evidence = await readEvidence(root);
  return evidence.cycles.filter((cycle) => cycle.testId === testId).at(-1)!.cycleId as string;
}

async function recordFullCycle(
  root: string,
  options: {
    testId?: string;
    requirementId?: string;
    redCommand?: string;
    greenCommand?: string;
    sourceChange?: string;
  } = {},
): Promise<void> {
  const {
    testId = 'TEST-EXAMPLE-001',
    requirementId = 'REQ-EXAMPLE-001',
    redCommand = 'test',
    greenCommand = redCommand,
    sourceChange = '// change\n',
  } = options;
  await analysis.runTddPhase(root, 'red', testId, requirementId, redCommand, tddResultRunner(root, 'failed', { exitCode: 1 }));
  await analysis.writeText(root, 'src/service.ts', `// non-test source change between Red and Green.\n${sourceChange}export function readiness() { return true; }\n`);
  await analysis.runTddPhase(root, 'green', testId, requirementId, greenCommand, tddResultRunner(root, 'passed'));
}

async function recordDanglingCycle(
  root: string,
  options: { testId?: string; requirementId?: string; command?: string } = {},
): Promise<void> {
  const { testId = 'TEST-EXAMPLE-001', requirementId = 'REQ-EXAMPLE-001', command = 'test' } = options;
  await analysis.runTddPhase(root, 'red', testId, requirementId, command, tddResultRunner(root, 'failed', { exitCode: 1 }));
}

/** @id TEST-TDD-CYCLE-ARCHIVE-001
 * @verifies REQ-TDD-CYCLE-ARCHIVE-001
 */
it('TEST-TDD-CYCLE-ARCHIVE-001 archives the latest cycle whether its Green evidence is valid, invalid, or absent', async () => {
  const root = await project();
  await recordFullCycle(root);
  const validCycleId = await latestCycleId(root);
  let result = await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire a valid cycle after rename');
  expect(result).toMatchObject({ archived: true, testId: 'TEST-EXAMPLE-001', cycleId: validCycleId });

  const root2 = await project();
  await recordDanglingCycle(root2);
  const noGreenCycleId = await latestCycleId(root2);
  result = await archiveTddCycle(root2, 'TEST-EXAMPLE-001', 'nahisaho', 'retire a dangling cycle');
  expect(result).toMatchObject({ archived: true, cycleId: noGreenCycleId });

  const root3 = await project();
  await analysis.runTddPhase(root3, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root3, 'failed', { exitCode: 1 }));
  await analysis.runTddPhase(root3, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root3, 'failed', { exitCode: 1 }));
  const invalidGreenCycleId = await latestCycleId(root3);
  result = await archiveTddCycle(root3, 'TEST-EXAMPLE-001', 'nahisaho', 'retire an invalid Green cycle');
  expect(result).toMatchObject({ archived: true, cycleId: invalidGreenCycleId });
});

/** @id TEST-TDD-CYCLE-ARCHIVE-002
 * @verifies REQ-TDD-CYCLE-ARCHIVE-002
 */
it('TEST-TDD-CYCLE-ARCHIVE-002 archives a latest cycle without needing any earlier non-archived fallback', async () => {
  const root = await project();
  await recordDanglingCycle(root);
  const onlyCycleId = await latestCycleId(root);
  let result = await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'single-cycle rename cleanup');
  expect(result).toMatchObject({ archived: true, cycleId: onlyCycleId });

  const root2 = await project();
  await recordFullCycle(root2);
  const earlierCycleId = await latestCycleId(root2);
  await forceArchive(root2, earlierCycleId, 'nahisaho', 'retire the older baseline');
  await recordDanglingCycle(root2);
  const latest = await latestCycleId(root2);
  result = await archiveTddCycle(root2, 'TEST-EXAMPLE-001', 'nahisaho', 'retire the latest rename residue');
  expect(result).toMatchObject({ archived: true, cycleId: latest });
});

/** @id TEST-TDD-CYCLE-ARCHIVE-003
 * @verifies REQ-TDD-CYCLE-ARCHIVE-003
 */
it('TEST-TDD-CYCLE-ARCHIVE-003 requires approver, reason, and confirm without mutating evidence on CLI validation failures', async () => {
  const root = await project();
  await recordDanglingCycle(root);
  const before = await analysis.readText(root, '.musubix/evidence/tdd.json');
  const beforeOrder = await analysis.readText(root, '.musubix/evidence/order.json');

  const missingConfirm = await invoke(root, [
    'tdd', 'archive', 'TEST-EXAMPLE-001',
    '--approver', 'nahisaho', '--reason', 'retire this cycle',
  ]);
  expect(missingConfirm.exitCode).toBe(2);
  expect(missingConfirm.stderr).toContain('--confirm');

  const missingApprover = await invoke(root, [
    'tdd', 'archive', 'TEST-EXAMPLE-001',
    '--reason', 'retire this cycle', '--confirm',
  ]);
  expect(missingApprover.exitCode).toBe(2);
  expect(missingApprover.stderr).toContain('--approver');

  await expect(archiveTddCycle(root, 'TEST-EXAMPLE-001', '', 'retire this cycle')).rejects.toThrow(/approver/);
  await expect(archiveTddCycle(root, 'TEST-EXAMPLE-001', '  ', 'retire this cycle')).rejects.toThrow(/approver/);
  await expect(archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', '')).rejects.toThrow(/reason/);
  await expect(archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', '   ')).rejects.toThrow(/reason/);

  expect(await analysis.readText(root, '.musubix/evidence/tdd.json')).toBe(before);
  expect(await analysis.readText(root, '.musubix/evidence/order.json')).toBe(beforeOrder);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-004
 * @verifies REQ-TDD-CYCLE-ARCHIVE-004
 */
it('TEST-TDD-CYCLE-ARCHIVE-004 enforces marker precedence between archive and void while leaving later fresh cycles eligible', async () => {
  const root = await project();
  await recordDanglingCycle(root);
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'first archive');
  const before = await analysis.readText(root, '.musubix/evidence/tdd.json');
  const beforeOrder = await analysis.readText(root, '.musubix/evidence/order.json');

  const missingConfirm = await invoke(root, [
    'tdd', 'archive', 'TEST-EXAMPLE-001',
    '--approver', 'nahisaho', '--reason', 'missing confirmation still wins',
  ]);
  expect(missingConfirm.exitCode).toBe(2);
  expect(missingConfirm.stderr).toContain('--confirm');

  await expect(archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'second archive')).rejects.toThrow(/void or archive marker/i);
  expect(await analysis.readText(root, '.musubix/evidence/tdd.json')).toBe(before);
  expect(await analysis.readText(root, '.musubix/evidence/order.json')).toBe(beforeOrder);

  const root2 = await project();
  await recordFullCycle(root2);
  await recordDanglingCycle(root2);
  await analysis.voidTddCycle(root2, 'TEST-EXAMPLE-001', 'nahisaho', 'first void');
  await expect(archiveTddCycle(root2, 'TEST-EXAMPLE-001', 'nahisaho', 'archive after void')).rejects.toThrow(/void or archive marker/i);

  const root3 = await project();
  await recordFullCycle(root3);
  await archiveTddCycle(root3, 'TEST-EXAMPLE-001', 'nahisaho', 'retire a valid cycle');
  await expect(analysis.voidTddCycle(root3, 'TEST-EXAMPLE-001', 'nahisaho', 'void after archive')).rejects.toThrow(/archive/i);

  const evidence = await readEvidence(root3);
  const archiveChainRecord = evidence.chain.find((record) => record.phase === 'archive')!;
  archiveChainRecord.testId = 'TEST-EXAMPLE-999';
  const { recordSha256: _drop, ...rest } = archiveChainRecord as { recordSha256: string };
  archiveChainRecord.recordSha256 = digestChainRecord(rest);
  await analysis.writeJson(root3, '.musubix/evidence/tdd.json', evidence);
  await expect(analysis.voidTddCycle(root3, 'TEST-EXAMPLE-001', 'nahisaho', 'malformed archive still blocks void')).rejects.toThrow(/archive/i);

  const root4 = await project();
  await recordFullCycle(root4);
  const firstCycleId = await latestCycleId(root4);
  await forceArchive(root4, firstCycleId, 'nahisaho', 'older archived baseline');
  await recordDanglingCycle(root4);
  const noFallback = await analysis.voidTddCycle(root4, 'TEST-EXAMPLE-001', 'nahisaho', 'archived fallback is ineligible');
  expect(noFallback).toMatchObject({ voided: false, testId: 'TEST-EXAMPLE-001' });
  expect(noFallback.reason).toMatch(/no earlier valid/i);

  await recordFullCycle(root4, { sourceChange: '// refreshed baseline\n' });
  await recordDanglingCycle(root4);
  const laterVoid = await analysis.voidTddCycle(root4, 'TEST-EXAMPLE-001', 'nahisaho', 'only the newest cycle should matter');
  expect(laterVoid.voided).toBe(true);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-005
 * @verifies REQ-TDD-CYCLE-ARCHIVE-005
 */
it('TEST-TDD-CYCLE-ARCHIVE-005 records archive evidence as one ordered, hash-chained append without disturbing older phases', async () => {
  const root = await project();
  await recordFullCycle(root);
  const archivedCycleId = await latestCycleId(root);
  const beforeEvidence = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const cycleBefore = beforeEvidence.cycles.find((cycle: { cycleId: string }) => cycle.cycleId === archivedCycleId);
  const beforeOrder = JSON.parse(await analysis.readText(root, '.musubix/evidence/order.json'));
  const maxSequence = Math.max(...beforeOrder.records.map((record: { sequence: number }) => record.sequence));
  const previousChainHash = beforeEvidence.chain.at(-1).recordSha256;

  const result = await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire a renamed test id');
  expect(result).toMatchObject({ archived: true, cycleId: archivedCycleId });

  const afterEvidence = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const archivedCycle = afterEvidence.cycles.find((cycle: { cycleId: string }) => cycle.cycleId === archivedCycleId);
  expect(archivedCycle.red).toEqual(cycleBefore.red);
  expect(archivedCycle.green).toEqual(cycleBefore.green);
  expect(archivedCycle.archive).toMatchObject({
    phase: 'archive',
    approver: 'nahisaho',
    reason: 'retire a renamed test id',
    testId: 'TEST-EXAMPLE-001',
    cycleId: archivedCycleId,
  });

  const afterOrder = JSON.parse(await analysis.readText(root, '.musubix/evidence/order.json'));
  const archiveOrderRecords = afterOrder.records.filter((record: { phase: string }) => record.phase === 'archive');
  expect(archiveOrderRecords).toHaveLength(1);
  expect(archiveOrderRecords[0]).toMatchObject({
    entityId: archivedCycleId,
    phase: 'archive',
    testId: 'TEST-EXAMPLE-001',
    sequence: maxSequence + 1,
  });

  const archiveChainRecords = afterEvidence.chain.filter((record: { phase: string }) => record.phase === 'archive');
  expect(archiveChainRecords).toHaveLength(1);
  expect(archiveChainRecords[0]).toMatchObject({ cycleId: archivedCycleId, testId: 'TEST-EXAMPLE-001', phase: 'archive' });
  expect(archiveChainRecords[0].previousSha256).toBe(previousChainHash);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-006
 * @verifies REQ-TDD-CYCLE-ARCHIVE-006
 */
it('TEST-TDD-CYCLE-ARCHIVE-006 treats archive linkage as invalid when identity, uniqueness, or payload hashing is broken', async () => {
  const root = await project();
  await recordFullCycle(root);
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire the cycle');

  const evidence = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const orderLog = JSON.parse(await analysis.readText(root, '.musubix/evidence/order.json'));
  const cycle = evidence.cycles.at(-1);
  const archiveChainRecord = evidence.chain.find((record: { phase: string }) => record.phase === 'archive');
  archiveChainRecord.cycleId = 'not-the-real-cycle-id';
  const { recordSha256: _drop, ...rest } = archiveChainRecord;
  archiveChainRecord.recordSha256 = digestChainRecord(rest);
  const duplicateOrder = {
    sequence: orderLog.records.length + 1,
    kind: 'tdd',
    entityId: cycle.cycleId,
    phase: 'archive',
    testId: cycle.testId,
    previousSha256: orderLog.records.at(-1).recordSha256,
  };
  orderLog.records.push({ ...duplicateOrder, recordSha256: analysis.digest(JSON.stringify(duplicateOrder)) });
  await analysis.writeJson(root, '.musubix/evidence/tdd.json', evidence);
  await analysis.writeJson(root, '.musubix/evidence/order.json', orderLog);

  const validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_ARCHIVE_EVIDENCE_MALFORMED' && diagnostic.message.includes('TEST-EXAMPLE-001'))).toBe(true);
  expect(archivedEntries(validation)).toEqual([]);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-014
 * @verifies REQ-TDD-CYCLE-ARCHIVE-006
 */
it('TEST-TDD-CYCLE-ARCHIVE-014 rejects a conflicting chain record sharing the cycleId under a different testId, even when the correctly identity-matched record is otherwise untouched', async () => {
  const root = await project();
  await recordFullCycle(root);
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire the cycle');

  const evidence = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const cycle = evidence.cycles.at(-1);
  const genuineArchiveRecord = evidence.chain.find((record: { phase: string }) => record.phase === 'archive');
  const conflicting = {
    sequence: evidence.chain.length + 1,
    cycleId: cycle.cycleId,
    requirementId: cycle.requirementId,
    testId: 'TEST-EXAMPLE-CONFLICTING',
    testPath: cycle.testPath,
    commandName: cycle.commandName,
    phase: 'archive',
    phaseEvidenceSha256: genuineArchiveRecord.phaseEvidenceSha256,
    previousSha256: evidence.chain.at(-1).recordSha256,
  };
  evidence.chain.push({ ...conflicting, recordSha256: digestChainRecord(conflicting) });
  await analysis.writeJson(root, '.musubix/evidence/tdd.json', evidence);

  const validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_ARCHIVE_EVIDENCE_MALFORMED' && diagnostic.message.includes('TEST-EXAMPLE-001'))).toBe(true);
  expect(archivedEntries(validation)).toEqual([]);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-007
 * @verifies REQ-TDD-CYCLE-ARCHIVE-007
 */
it('TEST-TDD-CYCLE-ARCHIVE-007 reports malformed archive evidence alongside the cycle\'s own diagnostics', async () => {
  const root = await project();
  await recordDanglingCycle(root);
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire malformed linkage');

  const evidence = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const archiveChainRecord = evidence.chain.find((record: { phase: string }) => record.phase === 'archive');
  archiveChainRecord.testId = 'TEST-EXAMPLE-999';
  const { recordSha256: _drop, ...rest } = archiveChainRecord;
  archiveChainRecord.recordSha256 = digestChainRecord(rest);
  await analysis.writeJson(root, '.musubix/evidence/tdd.json', evidence);

  const validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_ARCHIVE_EVIDENCE_MALFORMED')).toBe(true);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_GREEN_MISSING' && diagnostic.message.includes('TEST-EXAMPLE-001'))).toBe(true);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-008
 * @verifies REQ-TDD-CYCLE-ARCHIVE-008
 */
it('TEST-TDD-CYCLE-ARCHIVE-008 suppresses only stale archive-local diagnostics while keeping integrity diagnostics active', async () => {
  const root = await project();
  await recordFullCycle(root, { sourceChange: '// mismatch fixture change\n' });
  const evidenceBeforeArchive = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const latestCycle = evidenceBeforeArchive.cycles.at(-1);
  latestCycle.green.commandSha256 = analysis.digest(JSON.stringify(['npx', ['vitest', 'run', '--changed-command']]));
  latestCycle.green.sourceFingerprint = latestCycle.red.sourceFingerprint;
  await analysis.writeJson(root, '.musubix/evidence/tdd.json', evidenceBeforeArchive);

  let validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_GREEN_WITHOUT_SOURCE_CHANGE')).toBe(true);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_COMMAND_CHANGED')).toBe(true);

  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire mismatched command evidence');
  validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_GREEN_WITHOUT_SOURCE_CHANGE')).toBe(false);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_COMMAND_CHANGED')).toBe(false);

  const evidence = JSON.parse(await analysis.readText(root, '.musubix/evidence/tdd.json'));
  const redRecord = evidence.chain.find((record: { phase: string }) => record.phase === 'red');
  redRecord.recordSha256 = 'broken-red-record-hash';
  await analysis.writeJson(root, '.musubix/evidence/tdd.json', evidence);

  validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_CHAIN_LINK')).toBe(true);

  const root2 = await project();
  await recordDanglingCycle(root2);
  await archiveTddCycle(root2, 'TEST-EXAMPLE-001', 'nahisaho', 'retire dangling evidence');
  const archivedDangling = await analysis.validateTddEvidence(root2);
  expect(archivedDangling.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_GREEN_MISSING')).toBe(false);
  expect(archivedDangling.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_LEGACY_OR_UNSCOPED_EVIDENCE')).toBe(false);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-009
 * @verifies REQ-TDD-CYCLE-ARCHIVE-009
 */
it('TEST-TDD-CYCLE-ARCHIVE-009 leaves diagnostics for a different non-archived cycle untouched', async () => {
  const root = await project();
  await recordFullCycle(root);
  await recordDanglingCycle(root);
  const olderDanglingId = await latestCycleId(root);
  await recordDanglingCycle(root);

  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'archive only the newest cycle');
  const validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_GREEN_MISSING' && diagnostic.message.includes('TEST-EXAMPLE-001'))).toBe(true);
  expect(archivedEntries(validation).map((entry) => entry.cycleId)).not.toContain(olderDanglingId);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-010
 * @verifies REQ-TDD-CYCLE-ARCHIVE-010
 */
it('TEST-TDD-CYCLE-ARCHIVE-010 keeps mandatory requirement coverage unchanged when a cycle is archived', async () => {
  const root = await project();
  await analysis.runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'failed', { exitCode: 1 }));
  await analysis.runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'failed', { exitCode: 1 }));
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire invalid evidence');
  let validation = await analysis.validateTddEvidence(root);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_REQUIREMENT_UNCOVERED' && diagnostic.message.includes('REQ-EXAMPLE-001'))).toBe(true);

  const root2 = await project();
  await recordFullCycle(root2);
  await archiveTddCycle(root2, 'TEST-EXAMPLE-001', 'nahisaho', 'retire still-valid evidence');
  validation = await analysis.validateTddEvidence(root2);
  expect(validation.diagnostics.some((diagnostic) => diagnostic.code === 'TDD_REQUIREMENT_UNCOVERED' && diagnostic.message.includes('REQ-EXAMPLE-001'))).toBe(false);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-011
 * @verifies REQ-TDD-CYCLE-ARCHIVE-011
 */
it('TEST-TDD-CYCLE-ARCHIVE-011 allows a fresh Red-Green cycle after archiving the previous latest cycle', async () => {
  const root = await project();
  await recordFullCycle(root);
  const archivedCycleId = await latestCycleId(root);
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire the old cycle');

  await recordFullCycle(root, { sourceChange: '// new cycle after archive\n' });
  const evidence = await readEvidence(root);
  expect(evidence.cycles.filter((cycle) => cycle.testId === 'TEST-EXAMPLE-001')).toHaveLength(2);
  expect(evidence.cycles.find((cycle) => cycle.cycleId === archivedCycleId)?.archive).toBeDefined();

  const validation = await analysis.validateTddEvidence(root);
  expect(validation.valid).toBe(true);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-012
 * @verifies REQ-TDD-CYCLE-ARCHIVE-012
 */
it('TEST-TDD-CYCLE-ARCHIVE-012 rejects migrating an archived latest cycle but evaluates a later fresh cycle normally', async () => {
  const root = await project();
  await recordFullCycle(root);
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire the current cycle');
  const before = await analysis.readText(root, '.musubix/evidence/tdd.json');
  const beforeOrder = await analysis.readText(root, '.musubix/evidence/order.json');

  await expect(analysis.migrateTddFingerprint(root, 'TEST-EXAMPLE-001', 'nahisaho')).rejects.toThrow(/archived and cannot be migrated/i);
  expect(await analysis.readText(root, '.musubix/evidence/tdd.json')).toBe(before);
  expect(await analysis.readText(root, '.musubix/evidence/order.json')).toBe(beforeOrder);

  await recordFullCycle(root, { sourceChange: '// fresh cycle after archive\n' });
  const migration = await analysis.migrateTddFingerprint(root, 'TEST-EXAMPLE-001', 'nahisaho');
  expect(migration.testId).toBe('TEST-EXAMPLE-001');
  if (!migration.migrated) expect(migration.reason).not.toMatch(/archived/i);
});

/** @id TEST-TDD-CYCLE-ARCHIVE-013
 * @verifies REQ-TDD-CYCLE-ARCHIVE-013
 */
it('TEST-TDD-CYCLE-ARCHIVE-013 surfaces scoped archive evidence in validate output keyed to the archived cycle', async () => {
  const root = await project();
  await recordFullCycle(root);
  const archivedCycleId = await latestCycleId(root);
  await archiveTddCycle(root, 'TEST-EXAMPLE-001', 'nahisaho', 'retire this cycle');

  const validation = await analysis.validateTddEvidence(root);
  expect(archivedEntries(validation)).toHaveLength(1);
  expect(archivedEntries(validation)[0]).toMatchObject({
    testId: 'TEST-EXAMPLE-001',
    cycleId: archivedCycleId,
    archive: { approver: 'nahisaho', reason: 'retire this cycle' },
  });
});
