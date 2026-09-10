import { expect, it } from 'vitest';
import {
  readText, recordChangePhase, runTddPhase, validateChangeCompleteness, validateChangeEvidence, writeText,
} from '../packages/analysis/src/index.js';
import { code, project, tddResultRunner, testCode } from './helpers.js';

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
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);

  await expect(recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/red/i);

  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await expect(recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']))
    .rejects.toThrow(/implementation/i);

  // An unrelated batch (002) is unaffected by 001's missing Implementation.
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-002']);
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
  await recordChangePhase(root, 'CHANGE-0001', 'requirements', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await recordChangePhase(root, 'CHANGE-0001', 'design', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-001']);
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-001']);
  await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-001']);

  await expect(recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']))
    .rejects.toThrow(/REQ-EXAMPLE-002/);

  await recordChangePhase(root, 'CHANGE-0001', 'red', ['REQ-EXAMPLE-002']);
  await recordChangePhase(root, 'CHANGE-0001', 'implementation', ['REQ-EXAMPLE-002']);
  await recordChangePhase(root, 'CHANGE-0001', 'green', ['REQ-EXAMPLE-002']);
  await recordChangePhase(root, 'CHANGE-0001', 'quality', ['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
});

// Supporting regression check (not independently trace-tracked): the existing
// full-set, once-per-change recording form (REQ-CHANGE-REQUIREMENT-BATCHES-002)
// is already proven unchanged by tests/gate-install.test.ts's
// "proves staged change order with artifact fingerprints and TDD evidence" and
// "rejects unrelated source changes as implementation evidence for a requirement".
