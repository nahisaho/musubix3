import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  digest,
  canonicalJson,
  mergeEvidenceHistories,
  readText,
  recoverEvidenceMerge,
} from '../packages/analysis/src/index.js';

const roots: string[] = [];
const evidencePaths = [
  '.musubix/evidence/order.json',
  '.musubix/evidence/tdd.json',
  '.musubix/evidence/changes.json',
] as const;

function bytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function orderRecord(sequence: number, phase: string, previousSha256: string | null): Record<string, unknown> {
  const payload = { sequence, kind: 'tdd', entityId: 'cycle-ordering', phase, previousSha256 };
  return { ...payload, recordSha256: digest(JSON.stringify(payload)) };
}

function chainRecord(
  sequence: number,
  phase: string,
  phaseEvidence: unknown,
  previousSha256: string | null,
): Record<string, unknown> {
  const payload = {
    sequence,
    cycleId: 'cycle-ordering',
    requirementId: 'REQ-EXAMPLE-001',
    testId: 'TEST-EXAMPLE-001',
    testPath: 'tests/example.test.ts',
    commandName: 'test',
    phase,
    phaseEvidenceSha256: digest(JSON.stringify(phaseEvidence)),
    previousSha256,
  };
  return { ...payload, recordSha256: digest(JSON.stringify(payload)) };
}

async function writeOrderingHistory(project: string, lastPhase: 'migrate' | 'refactor'): Promise<void> {
  const red = { valid: true, order: 1 };
  const green = { valid: true, order: 2 };
  const last = { valid: true, order: 3, ...(lastPhase === 'migrate' ? { approver: 'reviewer' } : {}) };
  const firstOrder = orderRecord(1, 'red', null);
  const secondOrder = orderRecord(2, 'green', firstOrder.recordSha256 as string);
  const thirdOrder = orderRecord(3, lastPhase, secondOrder.recordSha256 as string);
  const firstChain = chainRecord(1, 'red', red, null);
  const secondChain = chainRecord(2, 'green', green, firstChain.recordSha256 as string);
  const thirdChain = chainRecord(3, lastPhase, last, secondChain.recordSha256 as string);
  await writeFile(join(project, evidencePaths[0]), bytes({
    schemaVersion: 1,
    records: [firstOrder, secondOrder, thirdOrder],
  }));
  await writeFile(join(project, evidencePaths[1]), bytes({
    schemaVersion: 1,
    cycles: [{
      cycleId: 'cycle-ordering',
      requirementId: 'REQ-EXAMPLE-001',
      testId: 'TEST-EXAMPLE-001',
      testPath: 'tests/example.test.ts',
      commandName: 'test',
      red,
      green,
      [lastPhase]: last,
    }],
    chain: [firstChain, secondChain, thirdChain],
  }));
  await writeFile(join(project, evidencePaths[2]), bytes({ schemaVersion: 1, changes: [] }));
}

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'musubix-evidence-recovery-'));
  roots.push(value);
  await mkdir(join(value, '.musubix/evidence'), { recursive: true });
  return value;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe('evidence merge recovery', () => {
  it('blocks shared evidence reads while a canonical merge journal exists', async () => {
    const project = await root();
    await writeFile(join(project, evidencePaths[0]), bytes({ schemaVersion: 1, records: [] }));
    await writeFile(join(project, '.musubix/evidence/.merge-transaction.json'), '{}\n');

    await expect(readText(project, evidencePaths[0])).rejects.toThrow('EVIDENCE_MERGE_RECOVERY_REQUIRED');
  });

  it('discards unpublished staging without touching evidence targets', async () => {
    const project = await root();
    const original = bytes({ schemaVersion: 1, records: [] });
    await writeFile(join(project, evidencePaths[0]), original);
    await writeFile(join(project, '.musubix/evidence/.merge-transaction.test.json'), '{}\n');

    await expect(recoverEvidenceMerge(project)).resolves.toEqual({
      recovered: false,
      action: 'nothing-to-recover',
      discardedStaging: true,
    });
    await expect(readFile(join(project, evidencePaths[0]), 'utf8')).resolves.toBe(original);
  });

  /** @id TEST-EVIDENCE-HISTORY-MERGE-006
   * @verifies REQ-EVIDENCE-HISTORY-MERGE-004
   */
  it('TEST-EVIDENCE-HISTORY-MERGE-006 rolls a prepared transaction back to byte-identical originals', async () => {
    const project = await root();
    const originals = {
      [evidencePaths[0]]: bytes({ schemaVersion: 1, records: [] }),
      [evidencePaths[1]]: bytes({ schemaVersion: 1, cycles: [], chain: [] }),
      [evidencePaths[2]]: bytes({ schemaVersion: 1, changes: [] }),
    };
    const transactionId = 'prepared-test';
    const targets = [];
    for (const path of evidencePaths) {
      const original = originals[path];
      const candidate = `${original} `;
      await writeFile(join(project, path), candidate);
      targets.push({
        path,
        existed: true,
        originalBase64: Buffer.from(original).toString('base64'),
        originalSha256: digest(original),
        candidateBase64: Buffer.from(candidate).toString('base64'),
        candidateSha256: digest(candidate),
        temporaryPath: `${path}.${transactionId}.merge`,
      });
    }
    await writeFile(join(project, '.musubix/evidence/.merge-transaction.json'), bytes({
      schemaVersion: 1,
      transactionId,
      state: 'prepared',
      targets,
    }));

    await expect(recoverEvidenceMerge(project)).resolves.toMatchObject({ recovered: true, action: 'rolled-back' });
    for (const path of evidencePaths) {
      await expect(readFile(join(project, path), 'utf8')).resolves.toBe(originals[path]);
    }
  });

  /** @id TEST-EVIDENCE-HISTORY-MERGE-007
   * @verifies REQ-EVIDENCE-HISTORY-MERGE-004
   */
  it('TEST-EVIDENCE-HISTORY-MERGE-007 rolls a committed transaction forward from journaled candidate bytes', async () => {
    const project = await root();
    const candidates = {
      [evidencePaths[0]]: bytes({ schemaVersion: 1, records: [] }),
      [evidencePaths[1]]: bytes({ schemaVersion: 1, cycles: [], chain: [] }),
      [evidencePaths[2]]: bytes({ schemaVersion: 1, changes: [] }),
    };
    const transactionId = 'committed-test';
    const targets = [];
    for (const path of evidencePaths) {
      const original = `${candidates[path]} `;
      await writeFile(join(project, path), original);
      targets.push({
        path,
        existed: true,
        originalBase64: Buffer.from(original).toString('base64'),
        originalSha256: digest(original),
        candidateBase64: Buffer.from(candidates[path]).toString('base64'),
        candidateSha256: digest(candidates[path]),
        temporaryPath: `${path}.${transactionId}.merge`,
      });
    }
    await writeFile(join(project, '.musubix/evidence/.merge-transaction.json'), bytes({
      schemaVersion: 1,
      transactionId,
      state: 'committed',
      targets,
    }));

    await expect(recoverEvidenceMerge(project)).resolves.toMatchObject({ recovered: true, action: 'rolled-forward' });
    for (const path of evidencePaths) {
      await expect(readFile(join(project, path), 'utf8')).resolves.toBe(candidates[path]);
    }
  });

  it('reports unsafe journals with inventory and manual remediation', async () => {
    const project = await root();
    await writeFile(join(project, '.musubix/evidence/.merge-transaction.json'), '{broken');

    await expect(recoverEvidenceMerge(project)).rejects.toThrow(/Journal: .*\.merge-transaction\.json.*Manual remediation:/);
  });

  it('reports an appended waiver as stale and as a changed authoritative scope', async () => {
    const base = await root();
    const incoming = await root();
    const changeId = 'CHANGE-9999';
    const change = { changeId, requirementIds: ['REQ-EXAMPLE-001'], phases: {} };
    for (const project of [base, incoming]) {
      await mkdir(join(project, '.musubix/changes'), { recursive: true });
      await writeFile(join(project, `.musubix/changes/${changeId}.md`), `# ${changeId}\nRequirements: REQ-EXAMPLE-001\n`);
      await writeFile(join(project, evidencePaths[1]), bytes({ schemaVersion: 1, cycles: [], chain: [] }));
      await writeFile(join(project, evidencePaths[2]), bytes({ schemaVersion: 1, changes: [change] }));
    }
    await writeFile(join(base, evidencePaths[0]), bytes({ schemaVersion: 1, records: [] }));
    const orderPayload = {
      sequence: 1,
      kind: 'change',
      entityId: changeId,
      phase: 'waiver',
      code: 'CHANGE_PHASE_MISSING',
      detail: 'phase:quality',
      previousSha256: null,
    };
    await writeFile(join(incoming, evidencePaths[0]), bytes({
      schemaVersion: 1,
      records: [{ ...orderPayload, recordSha256: digest(JSON.stringify(orderPayload)) }],
    }));
    const withoutPayloadHash = {
      changeId,
      code: 'CHANGE_PHASE_MISSING',
      detail: 'phase:quality',
      approver: 'reviewer',
      reason: 'fixture',
      recordedAt: '2026-01-01T00:00:00.000Z',
      snapshotVersion: 1,
      snapshotHash: '0'.repeat(64),
      order: 1,
      previousSha256: '0'.repeat(64),
    };
    await writeFile(join(incoming, '.musubix/evidence/change-waivers.json'), bytes({
      schemaVersion: 1,
      waivers: [{
        ...withoutPayloadHash,
        payloadSha256: digest(canonicalJson(withoutPayloadHash)),
      }],
    }));

    const report = await mergeEvidenceHistories(base, incoming, { dryRun: true });

    expect(report.valid).toBe(true);
    expect(report.staleWaivers).toEqual([expect.objectContaining({ changeId, code: 'CHANGE_PHASE_MISSING' })]);
    expect(report.supersededScopes).toEqual([{
      changeId,
      code: 'CHANGE_PHASE_MISSING',
      detail: 'phase:quality',
    }]);
  });

  /** @id TEST-EVIDENCE-HISTORY-MERGE-008
   * @verifies REQ-EVIDENCE-HISTORY-MERGE-002
   */
  it('TEST-EVIDENCE-HISTORY-MERGE-008 rejects a merged TDD phase order that would place migrate before refactor', async () => {
    const base = await root();
    const incoming = await root();
    await writeOrderingHistory(base, 'migrate');
    await writeOrderingHistory(incoming, 'refactor');
    const before = await readFile(join(base, evidencePaths[1]), 'utf8');

    const report = await mergeEvidenceHistories(base, incoming);

    expect(report.valid).toBe(false);
    expect(report.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TDD_ORDER_SEQUENCE', identity: 'cycle-ordering:migrate' }),
      expect.objectContaining({ code: 'EVIDENCE_MERGE_CANDIDATE_INVALID' }),
    ]));
    await expect(readFile(join(base, evidencePaths[1]), 'utf8')).resolves.toBe(before);
  });
});
