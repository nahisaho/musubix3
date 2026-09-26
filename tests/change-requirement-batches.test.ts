import { expect, it } from 'vitest';
import {
  readText, recordChangePhase, recordChangeWaiver, runTddPhase, validateChangeCompleteness,
  validateChangeEvidence, writeJson, writeText,
} from '../packages/analysis/src/index.js';
import {
  batchFor, currentRequirementIdsForBatch, effectiveBatches, hasValidTddCycle,
  orderMigrationRequiredRequirementCondition, voidedCycleOrdersInCurrentWindow,
  type ChangePhaseEvidence, type ChangeRecord,
} from '../packages/analysis/src/change-evidence.js';
import type { TddEvidence, TddPhaseEvidence } from '../packages/analysis/src/tdd.js';
import { code, project, recordTddGreen, recordTddRed, tddResultRunner, testCode } from './helpers.js';

function batchPhase(
  phase: ChangePhaseEvidence['phase'],
  order: number,
): ChangePhaseEvidence {
  return {
    phase,
    order,
    recordedAt: new Date(order).toISOString(),
    fingerprints: {
      impact: 'impact',
      requirements: 'requirements',
      design: 'design',
      implementation: `implementation-${order}`,
      tests: `tests-${order}`,
      tdd: `tdd-${order}`,
    },
  };
}

function unorderedBatchPhase(phase: ChangePhaseEvidence['phase']): ChangePhaseEvidence {
  const { order: _order, ...evidence } = batchPhase(phase, 0);
  return evidence;
}

function tddPhase(phase: 'red' | 'green', order: number, valid = true): TddPhaseEvidence {
  return {
    phase,
    valid,
    commandSha256: 'command',
    outputSha256: 'output',
    exitCode: phase === 'red' ? 1 : 0,
    durationMs: 1,
    testFingerprint: 'test',
    order,
    recordedAt: new Date(order).toISOString(),
    diagnostics: [],
  };
}

async function addSecondRequirement(root: string): Promise<void> {
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}
## REQ-EXAMPLE-002: Report secondary readiness
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall report its secondary readiness.
Acceptance: A test checks the reported secondary readiness against the configured checks.
`);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}
## DES-EXAMPLE-002: Secondary readiness component
Responsibilities: Aggregate explicit secondary readiness evidence without inventing success.
Interfaces: reportSecondaryReadiness() returns pass, fail, or skipped evidence.
Constraints: Missing required evidence cannot count as success.
Requirements: REQ-EXAMPLE-002
ADRs: ADR-0001
Depends-On: none
`);
  await writeText(root, 'src/second.ts', `/** @id CODE-EXAMPLE-002
 * @implements REQ-EXAMPLE-002
 * @design DES-EXAMPLE-002
 */
export function secondaryReadiness() { return true; }
`);
  await writeText(root, 'src/second.test.ts', `import { secondaryReadiness } from './second.js';
/** @id TEST-EXAMPLE-002
 * @verifies REQ-EXAMPLE-002
 */
export function testSecondaryReadiness() { if (!secondaryReadiness()) throw new Error('not ready'); }
`);
}

/** @id TEST-CHANGE-REQUIREMENT-BATCHES-001
 * @verifies REQ-CHANGE-REQUIREMENT-BATCHES-001 REQ-CHANGE-REQUIREMENT-BATCHES-005
 */
it('TEST-CHANGE-REQUIREMENT-BATCHES-001 completes an interleaved Red-Implement-Green loop per requirement batch', async () => {
  const root = await project();
  await addSecondRequirement(root);
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);

  // Batch A: requirement 001 completes its own Red -> Implementation -> Green loop first.
  await writeText(root, 'src/service.test.ts', `${testCode}\n// batch A staged failing behavior\n`);
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
    tddResultRunner(root, 'passed'));
  await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']);

  // Batch B: requirement 002 completes its own loop afterwards, entirely independently.
  await writeText(root, 'src/second.test.ts', `${await readText(root, 'src/second.test.ts')}\n// batch B staged failing behavior\n`);
  await runTddPhase(root, 'red', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'failed', { exitCode: 1 }));
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-002']);
  await writeText(root, 'src/second.ts', (await readText(root, 'src/second.ts')).replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-002']);
  await runTddPhase(root, 'green', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002', 'test',
    tddResultRunner(root, 'passed'));
  await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-002']);

  await recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);

  expect(await validateChangeEvidence(root)).toMatchObject({ present: true, valid: true, changes: 1 });
  expect(await validateChangeCompleteness(root)).toMatchObject({
    present: true,
    valid: true,
    changes: [expect.objectContaining({ changeId: 'CHANGE-0001', requirements: 2, completeRequirements: 2 })],
  });
});

/** @id TEST-CHANGE-REQUIREMENT-BATCHES-002
 * @verifies REQ-CHANGE-REQUIREMENT-BATCHES-003
 */
it('TEST-CHANGE-REQUIREMENT-BATCHES-002 rejects Implementation for a batch before its own Red and Green before its own Implementation', async () => {
  const root = await project();
  await addSecondRequirement(root);
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);

  await expect(recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/red/i);

  await writeText(root, 'src/service.test.ts', `${testCode}\n// batch 001 staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/implementation/i);

  // An unrelated batch (002) is unaffected by 001's missing Implementation.
  await writeText(root, 'src/second.test.ts', `${await readText(root, 'src/second.test.ts')}\n// batch 002 staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-002']);
  await writeText(root, 'src/second.ts', (await readText(root, 'src/second.ts')).replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-002']);
});

/** @id TEST-CHANGE-REQUIREMENT-BATCHES-003
 * @verifies REQ-CHANGE-REQUIREMENT-BATCHES-004
 */
it('TEST-CHANGE-REQUIREMENT-BATCHES-003 rejects Quality until every requirement has Green coverage', async () => {
  const root = await project();
  await addSecondRequirement(root);
  await writeText(root, '.musubix/changes/CHANGE-0001.md', '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await writeText(root, 'src/service.test.ts', `${testCode}\n// batch 001 staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
  await recordTddGreen(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']);

  await expect(recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']))
    .rejects.toThrow(/REQ-EXAMPLE-002/);

  await writeText(root, 'src/second.test.ts', `${await readText(root, 'src/second.test.ts')}\n// batch 002 staged failing behavior\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-002']);
  await writeText(root, 'src/second.ts', (await readText(root, 'src/second.ts')).replace('return true', 'return false'));
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-002']);
  await recordTddGreen(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-002']);
  await recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
});

/** @id TEST-CHANGE-REQUIREMENT-BATCHES-006
 * @verifies REQ-CHANGE-REQUIREMENT-BATCHES-005
 */
it('TEST-CHANGE-REQUIREMENT-BATCHES-006 recognizes every requirement in one authoritative @verifies declaration', async () => {
  const root = await project();
  await addSecondRequirement(root);
  await writeText(root, 'src/second.test.ts', 'export {};\n');
  await writeText(root, 'src/service.test.ts', `/** @id TEST-EXAMPLE-001
 * @verifies REQ-EXAMPLE-001 REQ-EXAMPLE-002
 */
export function testReadiness() { return true; }
`);
  await writeText(root, '.musubix/changes/CHANGE-0001.md',
    '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  const requirements = ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002'];
  await recordChangePhase(root, 'CHANGE-0001', 'impact', requirements);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: clarified shared test coverage.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', requirements);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: clarified shared test binding.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', requirements);
  await writeText(root, 'src/service.test.ts',
    `${await readText(root, 'src/service.test.ts')}\n// red checkpoint\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'red', requirements);
  await writeText(root, 'src/service.ts',
    `${await readText(root, 'src/service.ts')}\n// implementation checkpoint\n`);
  await writeText(root, 'src/second.ts',
    `${await readText(root, 'src/second.ts')}\n// implementation checkpoint\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', requirements);
  await recordTddGreen(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddGreen(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'green', requirements);
  await recordChangePhase(root, 'CHANGE-0001', 'quality', requirements);

  const result = await validateChangeCompleteness(root);
  expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
    code: 'CHANGE_COMPLETENESS_TEST',
    message: expect.stringContaining('REQ-EXAMPLE-002'),
  }));
});

/** @id TEST-CHANGE-REQUIREMENT-BATCHES-007
 * @verifies REQ-CHANGE-REQUIREMENT-BATCHES-005
 */
it('TEST-CHANGE-REQUIREMENT-BATCHES-007 uses trace-compatible polyglot comment blocks for authoritative tests', async () => {
  const root = await project();
  await addSecondRequirement(root);
  await writeText(root, 'src/service.test.ts', 'export {};\n');
  await writeText(root, 'src/second.test.ts', 'export {};\n');
  await writeText(root, 'src/shared_test.py', `# @id TEST-EXAMPLE-PY-001
# @verifies REQ-EXAMPLE-001 REQ-EXAMPLE-002
def test_readiness():
    assert True
`);
  await writeText(root, '.musubix/changes/CHANGE-0001.md',
    '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  const requirements = ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002'];
  await recordChangePhase(root, 'CHANGE-0001', 'impact', requirements);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: clarified polyglot test coverage.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', requirements);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: clarified polyglot test binding.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', requirements);
  await writeText(root, 'src/shared_test.py',
    `${await readText(root, 'src/shared_test.py')}\n# red checkpoint\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-PY-001', 'REQ-EXAMPLE-001');
  await recordTddRed(root, 'TEST-EXAMPLE-PY-001', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'red', requirements);
  await writeText(root, 'src/service.ts',
    `${await readText(root, 'src/service.ts')}\n// implementation checkpoint\n`);
  await writeText(root, 'src/second.ts',
    `${await readText(root, 'src/second.ts')}\n// implementation checkpoint\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', requirements);
  await recordTddGreen(root, 'TEST-EXAMPLE-PY-001', 'REQ-EXAMPLE-001');
  await recordTddGreen(root, 'TEST-EXAMPLE-PY-001', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'green', requirements);
  await recordChangePhase(root, 'CHANGE-0001', 'quality', requirements);

  const result = await validateChangeCompleteness(root);
  expect(result.diagnostics).not.toContainEqual(expect.objectContaining({
    code: 'CHANGE_COMPLETENESS_TEST',
    message: expect.stringContaining('REQ-EXAMPLE-002'),
  }));
});

/** @id TEST-CHANGE-REQUIREMENT-BATCHES-008
 * @verifies REQ-CHANGE-REQUIREMENT-BATCHES-005
 */
it('TEST-CHANGE-REQUIREMENT-BATCHES-008 selects the latest overlapping requirement batch by Red order', () => {
  const change: ChangeRecord = {
    changeId: 'CHANGE-TEST',
    requirementIds: ['REQ-A', 'REQ-B'],
    phases: {
      red: batchPhase('red', 10),
      implementation: batchPhase('implementation', 11),
      green: batchPhase('green', 12),
    },
    tddBatches: [{
      requirementIds: ['REQ-A'],
      red: batchPhase('red', 20),
      implementation: batchPhase('implementation', 21),
      green: batchPhase('green', 22),
    }],
  };

  const selected = batchFor(effectiveBatches(change), 'REQ-A');

  expect(selected?.red?.order).toBe(20);
});

/** @id TEST-CHANGE-REQUIREMENT-BATCHES-009
 * @verifies REQ-CHANGE-REQUIREMENT-BATCHES-005
 */
it('TEST-CHANGE-REQUIREMENT-BATCHES-009 binds only valid voids inside the current batch window', () => {
  const change: ChangeRecord = {
    changeId: 'CHANGE-TEST',
    requirementIds: ['REQ-A'],
    phases: {
      requirements: batchPhase('requirements', 10),
      red: batchPhase('red', 20),
    },
    tddBatches: [{
      requirementIds: ['REQ-A'],
      red: batchPhase('red', 30),
    }],
  };
  const cycles: TddEvidence['cycles'] = [
    {
      requirementId: 'REQ-A',
      testId: 'TEST-BEFORE',
      testPath: 'before.test.ts',
      commandName: 'test',
      red: tddPhase('red', 19),
      void: { phase: 'void', approver: 'reviewer', reason: 'before window', order: 42, recordedAt: new Date(42).toISOString() },
    },
    {
      requirementId: 'REQ-A',
      testId: 'TEST-IN-WINDOW-A',
      testPath: 'inside-a.test.ts',
      commandName: 'test',
      red: tddPhase('red', 25),
      void: { phase: 'void', approver: 'reviewer', reason: 'inside window', order: 41, recordedAt: new Date(41).toISOString() },
    },
    {
      requirementId: 'REQ-A',
      testId: 'TEST-IN-WINDOW-B',
      testPath: 'inside-b.test.ts',
      commandName: 'test',
      red: tddPhase('red', 29),
      void: { phase: 'void', approver: 'reviewer', reason: 'inside window', order: 39, recordedAt: new Date(39).toISOString() },
    },
    {
      requirementId: 'REQ-A',
      testId: 'TEST-AFTER',
      testPath: 'after.test.ts',
      commandName: 'test',
      red: tddPhase('red', 31),
      void: { phase: 'void', approver: 'reviewer', reason: 'after window', order: 40, recordedAt: new Date(40).toISOString() },
    },
  ];

  expect(voidedCycleOrdersInCurrentWindow(change, 'REQ-A', { schemaVersion: 1, cycles }, new Set(cycles)))
    .toEqual([39, 41]);
  expect(voidedCycleOrdersInCurrentWindow(change, 'REQ-A', { schemaVersion: 1, cycles }, new Set()))
    .toEqual([]);
});

it('keeps later incomplete batches current and projects current requirement IDs', () => {
  const legacy = {
    requirementIds: ['REQ-A', 'REQ-B'],
    red: batchPhase('red', 10),
    implementation: batchPhase('implementation', 11),
    green: batchPhase('green', 12),
  };
  const scoped = {
    requirementIds: ['REQ-A'],
    red: batchPhase('red', 20),
  };
  const batches = [legacy, scoped];

  expect(batchFor(batches, 'REQ-A')).toBe(scoped);
  expect(currentRequirementIdsForBatch(batches, legacy, ['REQ-A', 'REQ-B'])).toEqual(['REQ-B']);
  expect(currentRequirementIdsForBatch(batches, scoped, ['REQ-A', 'REQ-B'])).toEqual(['REQ-A']);

  const legacyWithoutOrder = {
    requirementIds: ['REQ-A'],
    red: unorderedBatchPhase('red'),
  };
  const scopedWithoutOrder = {
    requirementIds: ['REQ-A'],
    red: unorderedBatchPhase('red'),
  };
  expect(batchFor([legacyWithoutOrder, scopedWithoutOrder], 'REQ-A')).toBe(legacyWithoutOrder);

  const tiedScoped = {
    requirementIds: ['REQ-A'],
    red: batchPhase('red', 10),
  };
  expect(batchFor([legacy, tiedScoped], 'REQ-A')).toBe(tiedScoped);
});

it('ignores superseded TDD cycles outside the current batch window', () => {
  const change: ChangeRecord = {
    changeId: 'CHANGE-TEST',
    requirementIds: ['REQ-A'],
    phases: {
      requirements: batchPhase('requirements', 10),
      red: batchPhase('red', 20),
      implementation: batchPhase('implementation', 21),
      green: batchPhase('green', 22),
    },
    tddBatches: [{
      requirementIds: ['REQ-A'],
      red: batchPhase('red', 30),
      implementation: batchPhase('implementation', 33),
      green: batchPhase('green', 35),
    }],
  };
  const tdd: TddEvidence = {
    schemaVersion: 1,
    cycles: [
      {
        requirementId: 'REQ-A',
        testId: 'TEST-OLD',
        testPath: 'old.test.ts',
        commandName: 'test',
        red: tddPhase('red', 19),
      },
      {
        requirementId: 'REQ-A',
        testId: 'TEST-ABANDONED',
        testPath: 'abandoned.test.ts',
        commandName: 'test',
        red: tddPhase('red', 28),
      },
      {
        requirementId: 'REQ-A',
        testId: 'TEST-CURRENT',
        testPath: 'current.test.ts',
        commandName: 'test',
        red: tddPhase('red', 29),
        green: tddPhase('green', 34),
      },
    ],
  };

  expect(hasValidTddCycle(change, 'REQ-A', tdd)).toBe(true);
  expect(orderMigrationRequiredRequirementCondition(change, 'REQ-A', tdd)).toBe(false);

  tdd.cycles.push({
    requirementId: 'REQ-A',
    testId: 'TEST-LATER-INCOMPLETE',
    testPath: 'later.test.ts',
    commandName: 'test',
    red: tddPhase('red', 30),
  });
  expect(hasValidTddCycle(change, 'REQ-A', tdd)).toBe(true);
  expect(orderMigrationRequiredRequirementCondition(change, 'REQ-A', tdd)).toBe(true);

  const voided = tdd.cycles.at(-1)!;
  expect(hasValidTddCycle(change, 'REQ-A', tdd, new Set([voided]))).toBe(true);
  expect(orderMigrationRequiredRequirementCondition(change, 'REQ-A', tdd, new Set([voided]))).toBe(false);
});

it('suppresses fully superseded batch diagnostics in validation and waiver recording', async () => {
  const root = await project();
  await addSecondRequirement(root);
  const requirements = ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002'];
  await writeText(root, '.musubix/changes/CHANGE-0001.md',
    '# CHANGE-0001\nRequirements: REQ-EXAMPLE-001 REQ-EXAMPLE-002\n');
  await recordChangePhase(root, 'CHANGE-0001', 'impact', requirements);
  await writeText(root, '.musubix/features/example/requirements.md',
    `${await readText(root, '.musubix/features/example/requirements.md')}\nChange: revised acceptance behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', requirements);
  await writeText(root, '.musubix/features/example/design.md',
    `${await readText(root, '.musubix/features/example/design.md')}\nChange: revised component behavior.\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'design', requirements);

  await writeText(root, 'src/service.test.ts', `${testCode}\n// legacy red\n`);
  await recordTddRed(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddRed(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'red', requirements);
  await writeText(root, 'src/service.ts', `${code}\n// legacy implementation\n`);
  await writeText(root, 'src/second.ts', `${await readText(root, 'src/second.ts')}\n// legacy implementation\n`);
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', requirements);
  await recordTddGreen(root, 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001');
  await recordTddGreen(root, 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-002');
  await recordChangePhase(root, 'CHANGE-0001', 'green', requirements);

  for (const [requirementId, testPath, implementationPath] of [
    ['REQ-EXAMPLE-001', 'src/service.test.ts', 'src/service.ts'],
    ['REQ-EXAMPLE-002', 'src/second.test.ts', 'src/second.ts'],
  ] as const) {
    await writeText(root, testPath, `${await readText(root, testPath)}\n// scoped red\n`);
    await recordTddRed(root,
      requirementId === 'REQ-EXAMPLE-001' ? 'TEST-EXAMPLE-001' : 'TEST-EXAMPLE-002',
      requirementId);
    await recordChangePhase(root, 'CHANGE-0001', 'red', [requirementId]);
    await writeText(root, implementationPath, `${await readText(root, implementationPath)}\n// scoped implementation\n`);
    await recordChangePhase(root, 'CHANGE-0001', 'implementation', [requirementId]);
    await recordTddGreen(root,
      requirementId === 'REQ-EXAMPLE-001' ? 'TEST-EXAMPLE-001' : 'TEST-EXAMPLE-002',
      requirementId);
    await recordChangePhase(root, 'CHANGE-0001', 'green', [requirementId]);
  }

  const evidencePath = '.musubix/evidence/changes.json';
  const evidence = JSON.parse(await readText(root, evidencePath));
  const change = evidence.changes.find((entry: { changeId: string }) => entry.changeId === 'CHANGE-0001');
  change.phases.red.fingerprints.tests = change.phases.design.fingerprints.tests;
  await writeJson(root, evidencePath, evidence);

  const diagnostics = (await validateChangeEvidence(root)).diagnostics;
  expect(diagnostics).not.toContainEqual(expect.objectContaining({
    code: 'CHANGE_TESTS_UNCHANGED',
    detail: 'REQ-EXAMPLE-001,REQ-EXAMPLE-002',
  }));
  await expect(recordChangeWaiver(
    root,
    'CHANGE-0001',
    'CHANGE_TESTS_UNCHANGED',
    undefined,
    'REQ-EXAMPLE-001,REQ-EXAMPLE-002',
    'nahisaho',
    'superseded legacy batch',
  )).rejects.toThrow(/No matching CHANGE_TESTS_UNCHANGED diagnostic is currently reported/);
});
