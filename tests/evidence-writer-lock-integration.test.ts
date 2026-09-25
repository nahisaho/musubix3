import { spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_CONDITIONAL_OPERATION_MODES,
  EVIDENCE_OPERATION_CLASSIFICATION,
  EVIDENCE_WRITER_ANALYSIS_ENTRIES,
  EvidenceWriterLockError,
  acquireEvidenceWriterLock,
  adapterInvocation,
  assertEvidenceOutputUnprotected,
  clearAdapterOutput,
  classifyEvidenceOperation,
  defaultConfig,
  digest,
  mergeEvidenceHistories,
  readText,
  recordWorkflow,
  recoverEvidenceMerge,
  recoverEvidenceWriterLock,
  runProcess,
  withEvidenceWriterLock,
  type EvidenceDirectorySyncPolicy,
} from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

const cli = resolve('dist/packages/cli/src/main.js');
const writerLockPath = (root: string): string => resolve(root, '.musubix/evidence/.writer-lock.json');
const jsonBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const filesystemError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`injected ${code}`), { code });

async function snapshotProject(root: string): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const path of (await readdir(root, { recursive: true })).sort()) {
    if (path.includes('.writer-lock')) continue;
    try {
      snapshot[path] = digest(await readFile(resolve(root, path)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EISDIR') throw error;
      snapshot[path] = 'directory';
    }
  }
  return snapshot;
}

async function waitForPath(path: string): Promise<void> {
  for (;;) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
  }
}

describe('evidence writer lock integration', () => {
  /** @id TEST-EVIDENCE-WRITER-LOCK-006
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002
   */
  it('TEST-EVIDENCE-WRITER-LOCK-006 classifies every declared CLI coordination mode deterministically', () => {
    for (const operation of EVIDENCE_OPERATION_CLASSIFICATION.writer) {
      expect(classifyEvidenceOperation(operation)).toBe('writer');
    }
    for (const operation of EVIDENCE_OPERATION_CLASSIFICATION.coordinatedReader) {
      expect(classifyEvidenceOperation(operation)).toBe('coordinated-reader');
    }
    for (const operation of EVIDENCE_OPERATION_CLASSIFICATION.exempt) {
      expect(classifyEvidenceOperation(operation)).toBe('exempt');
    }
    expect(classifyEvidenceOperation('init')).toBe('writer');
    expect(classifyEvidenceOperation('init', { dryRun: true })).toBe('coordinated-reader');
    expect(classifyEvidenceOperation('evidence merge', { dryRun: true })).toBe('coordinated-reader');
    expect(() => classifyEvidenceOperation('unregistered command')).toThrow('Unclassified evidence operation');
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-007
   * @verifies REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-005
   */
  it('TEST-EVIDENCE-WRITER-LOCK-007 reports writer contention before merge-journal state', async () => {
    const root = await fixture();
    await mkdir(resolve(root, '.musubix/evidence'), { recursive: true });
    await writeFile(resolve(root, '.musubix/evidence/.merge-transaction.json'), '{}\n');
    const lease = await acquireEvidenceWriterLock(root, 'foreign-writer');
    try {
      await expect(readText(root, '.musubix/evidence/order.json'))
        .rejects.toMatchObject({ code: 'EVIDENCE_WRITER_LOCKED' });
    } finally {
      await lease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-008
   * @verifies REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-005
   */
  it('TEST-EVIDENCE-WRITER-LOCK-008 checks the incoming merge root before reading its evidence', async () => {
    const base = await fixture();
    const incoming = await fixture();
    const lease = await acquireEvidenceWriterLock(incoming, 'incoming-writer');
    try {
      await expect(mergeEvidenceHistories(base, incoming, { dryRun: true }))
        .rejects.toMatchObject({
          code: 'EVIDENCE_WRITER_LOCKED',
          owner: expect.objectContaining({ command: 'incoming-writer' }),
        });
    } finally {
      await lease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-009
   * @verifies REQ-EVIDENCE-WRITER-LOCK-004
   */
  it('TEST-EVIDENCE-WRITER-LOCK-009 refuses PID reuse without removing the lock', async () => {
    const root = await fixture();
    const fingerprint = {
      platform: 'linux' as const,
      bootId: 'boot-test',
      pidNamespace: 'pid:[test]',
      processStart: '100',
    };
    const lease = await acquireEvidenceWriterLock(root, 'reused-owner', {
      hostname,
      processFingerprint: async () => fingerprint,
    });
    await expect(recoverEvidenceWriterLock(root, {
      hostname,
      processFingerprint: async () => fingerprint,
      processState: async () => 'reused',
    })).rejects.toMatchObject({
      code: 'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE',
      owner: expect.objectContaining({ command: 'reused-owner' }),
    });
    expect(JSON.parse(await readFile(writerLockPath(root), 'utf8'))).toMatchObject({
      transactionId: lease.owner.transactionId,
    });
    await lease.release();
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-010
   * @verifies REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-004
   */
  it('TEST-EVIDENCE-WRITER-LOCK-010 preserves typed CLI lock errors and recovers a dead Linux owner', async () => {
    const root = await fixture();
    const lease = await acquireEvidenceWriterLock(root, 'cli-owner');
    const blocked = await runProcess(process.execPath, [
      cli, 'status', '--root', root, '--json',
    ], { cwd: root, timeoutMs: 10_000 });
    expect(blocked.exitCode).toBe(2);
    expect(JSON.parse(blocked.stdout)).toMatchObject({
      error: {
        code: 'EVIDENCE_WRITER_LOCKED',
        lockPath: writerLockPath(root),
        owner: {
          command: 'cli-owner',
          transactionId: lease.owner.transactionId,
        },
      },
    });

    if (process.platform !== 'linux') {
      await lease.release();
      return;
    }
    await writeFile(writerLockPath(root), `${JSON.stringify({
      ...lease.owner,
      pid: 2_147_483_647,
    }, null, 2)}\n`);
    const recovered = await runProcess(process.execPath, [
      cli, 'evidence', 'unlock', '--recover', '--root', root, '--json',
    ], { cwd: root, timeoutMs: 10_000 });
    expect(recovered.exitCode).toBe(0);
    expect(JSON.parse(recovered.stdout)).toEqual({ action: 'recovered', recovered: true });
    await expect(readFile(writerLockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-028
   * @verifies REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-028 renders rollback failures for JSON and human CLI callers', async () => {
    const cliModule = await import('../packages/cli/src/main.js');
    const evidenceCommand = cliModule.createProgram().commands.find((command) => command.name() === 'evidence');
    const unlockCommand = evidenceCommand?.commands.find((command) => command.name() === 'unlock');
    let help = '';
    unlockCommand?.configureOutput({ writeOut: (text) => { help += text; } });
    unlockCommand?.outputHelp();
    expect(help).toContain('EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED');
    expect(help).toContain('lockRemoved');
    const primary = new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      'acquisition failed',
      {
        lockPath: '/project/.musubix/evidence/.writer-lock.json',
        cause: filesystemError('EACCES'),
        rollbackError: new EvidenceWriterLockError(
          'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
          'rollback failed',
          {
            lockPath: '/project/.musubix/evidence/.writer-lock.json',
            lockRemoved: true,
            cause: filesystemError('EIO'),
            guidance: ['Inspect only the exact reported path before retrying.'],
          },
        ),
      },
    );

    expect(cliModule.renderEvidenceWriterLockError(primary)).toEqual({
      json: {
        error: {
          code: 'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
          message: 'acquisition failed',
          lockPath: '/project/.musubix/evidence/.writer-lock.json',
          cause: { name: 'Error', message: 'injected EACCES', code: 'EACCES' },
          rollbackError: {
            code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
            message: 'rollback failed',
            lockPath: '/project/.musubix/evidence/.writer-lock.json',
            lockRemoved: true,
            cause: { name: 'Error', message: 'injected EIO', code: 'EIO' },
            guidance: ['Inspect only the exact reported path before retrying.'],
          },
        },
      },
      human: [
        'musubix3: acquisition failed',
        'musubix3: EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED: rollback failed (lockRemoved: true)',
        'musubix3: Inspect only the exact reported path before retrying.',
      ],
    });

    expect(cliModule.renderEvidenceWriterLockError(new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      'non-error cause',
      {
        lockPath: '/project/.musubix/evidence/.writer-lock.json',
        cause: 'injected cause',
      },
    )).json.error.cause).toEqual({ message: 'injected cause' });
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-002
   * @verifies REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-002 renders recovery durability failures', async () => {
    const cliModule = await import('../packages/cli/src/main.js');
    const path = '/project/.musubix/evidence/.writer-lock.json';
    const guidance = [
      `The canonical lock path ${path} is absent now, but crash durability is unconfirmed.`,
      `Inspect only the exact reported path ${path} before retrying.`,
    ];
    const error = new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED',
      'recovery directory synchronization failed',
      {
        lockPath: path,
        lockRemoved: true,
        cause: filesystemError('EACCES'),
        guidance,
      },
    );

    expect(cliModule.renderEvidenceWriterLockError(error)).toEqual({
      json: {
        error: {
          code: 'EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED',
          message: 'recovery directory synchronization failed',
          lockPath: path,
          cause: { name: 'Error', message: 'injected EACCES', code: 'EACCES' },
          guidance,
          lockRemoved: true,
        },
      },
      human: [
        'musubix3: recovery directory synchronization failed',
        'musubix3: EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED (lockRemoved: true)',
        ...guidance.map((line) => `musubix3: ${line}`),
      ],
    });
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-020
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-020 initializes a nonexistent root under the writer lock', async () => {
    const parent = await fixture();
    const root = resolve(parent, 'new-project');
    const initialized = await runProcess(process.execPath, [
      cli, 'init', '--root', root, '--json',
    ], { cwd: parent, timeoutMs: 10_000 });
    expect(initialized.exitCode).toBe(0);
    expect(JSON.parse(initialized.stdout)).toMatchObject({ dryRun: false });
    expect(JSON.parse(await readFile(resolve(root, '.musubix/evidence/quality.json'), 'utf8')))
      .toMatchObject({ schemaVersion: 1 });
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-021
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-021 rejects exempt output paths that target a configured report', async () => {
    const root = await fixture({
      '.musubix/config.json': `${JSON.stringify({
        commands: [{
          name: 'test',
          command: 'node',
          args: [],
          testReport: { format: 'musubix-json', path: 'reports/test.json' },
        }],
      })}\n`,
    });
    await expect(assertEvidenceOutputUnprotected(root, resolve(root, 'reports/test.json')))
      .rejects.toMatchObject({ code: 'EVIDENCE_PROTECTED_OUTPUT_REJECTED' });
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-011
   * @verifies REQ-EVIDENCE-WRITER-LOCK-005
   */
  it('TEST-EVIDENCE-WRITER-LOCK-011 preserves a pending merge journal while writer-lock recovery is required', async () => {
    const root = await fixture();
    const observed: EvidenceDirectorySyncPolicy[] = [];
    const fingerprint = {
      platform: 'linux' as const,
      bootId: 'boot-test',
      pidNamespace: 'pid:[test]',
      processStart: '100',
    };
    const journalPath = resolve(root, '.musubix/evidence/.merge-transaction.json');
    await mkdir(resolve(root, '.musubix/evidence'), { recursive: true });
    const targets = [];
    for (const path of [
      '.musubix/evidence/order.json',
      '.musubix/evidence/tdd.json',
      '.musubix/evidence/changes.json',
    ]) {
      const original = path.endsWith('order.json')
        ? jsonBytes({ schemaVersion: 1, records: [] })
        : path.endsWith('tdd.json')
          ? jsonBytes({ schemaVersion: 1, cycles: [], chain: [] })
          : jsonBytes({ schemaVersion: 1, changes: [] });
      const candidate = `${original} `;
      await writeFile(resolve(root, path), candidate);
      targets.push({
        path,
        existed: true,
        originalBase64: Buffer.from(original).toString('base64'),
        originalSha256: digest(original),
        candidateBase64: Buffer.from(candidate).toString('base64'),
        candidateSha256: digest(candidate),
        temporaryPath: `${path}.writer-lock-test.merge`,
      });
    }
    await writeFile(journalPath, jsonBytes({
      schemaVersion: 1,
      transactionId: 'writer-lock-test',
      state: 'prepared',
      targets,
    }));
    const lease = await acquireEvidenceWriterLock(root, 'abandoned-merge-owner', {
      hostname,
      processFingerprint: async () => fingerprint,
    });
    const before = await readFile(journalPath, 'utf8');

    await expect(recoverEvidenceMerge(root)).rejects.toMatchObject({
      code: 'EVIDENCE_WRITER_LOCKED',
      owner: expect.objectContaining({ transactionId: lease.owner.transactionId }),
    });
    expect(await readFile(journalPath, 'utf8')).toBe(before);

    await expect(recoverEvidenceWriterLock(root, {
      hostname,
      processFingerprint: async () => fingerprint,
      processState: async () => 'dead',
      syncEvidenceDirectory: async (_path, policy) => {
        observed.push(policy);
      },
    })).resolves.toEqual({
      action: 'recovered',
      recovered: true,
    });
    expect(observed).toEqual(['strict']);
    expect(await readFile(journalPath, 'utf8')).toBe(before);
    await expect(recoverEvidenceMerge(root)).resolves.toMatchObject({
      recovered: true,
      action: 'rolled-back',
    });
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-012
   * @verifies REQ-EVIDENCE-WRITER-LOCK-005
   */
  it('TEST-EVIDENCE-WRITER-LOCK-012 reports destination ownership before incoming contention', async () => {
    const base = await fixture();
    const incoming = await fixture();
    const destinationLease = await acquireEvidenceWriterLock(base, 'destination-owner');
    const incomingLease = await acquireEvidenceWriterLock(incoming, 'incoming-owner');
    try {
      await expect(mergeEvidenceHistories(base, incoming)).rejects.toMatchObject({
        code: 'EVIDENCE_WRITER_LOCKED',
        owner: expect.objectContaining({
          command: 'destination-owner',
          transactionId: destinationLease.owner.transactionId,
        }),
      });
    } finally {
      await destinationLease.release();
      await incomingLease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-013
   * @verifies REQ-EVIDENCE-WRITER-LOCK-005
   */
  it('TEST-EVIDENCE-WRITER-LOCK-013 leaves project artifacts unchanged when the incoming root is locked', async () => {
    const base = await fixture({ 'base.txt': 'base\n' });
    const incoming = await fixture({ 'incoming.txt': 'incoming\n' });
    const incomingLease = await acquireEvidenceWriterLock(incoming, 'incoming-owner');
    const baseBefore = await snapshotProject(base);
    const incomingBefore = await snapshotProject(incoming);
    try {
      await expect(mergeEvidenceHistories(base, incoming)).rejects.toMatchObject({
        code: 'EVIDENCE_WRITER_LOCKED',
        owner: expect.objectContaining({ command: 'incoming-owner' }),
      });
      expect(await snapshotProject(base)).toEqual(baseBefore);
      expect(await snapshotProject(incoming)).toEqual(incomingBefore);
    } finally {
      await incomingLease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-014
   * @verifies REQ-EVIDENCE-WRITER-LOCK-004
   */
  it('TEST-EVIDENCE-WRITER-LOCK-014 fails closed when the lock inode changes before release', async () => {
    const successRoot = await fixture();
    let successIdentityReads = 0;
    await expect(withEvidenceWriterLock(successRoot, 'successful-work', async () => undefined, {
      lockIdentity: async () => ({
        dev: 1,
        ino: ++successIdentityReads,
      }),
    })).rejects.toMatchObject({ code: 'EVIDENCE_WRITER_LOCK_RELEASE_FAILED' });

    const failureRoot = await fixture();
    let failureIdentityReads = 0;
    const operationError = new Error('operation failed');
    await expect(withEvidenceWriterLock(failureRoot, 'failed-work', async () => {
      throw operationError;
    }, {
      lockIdentity: async () => ({
        dev: 1,
        ino: ++failureIdentityReads,
      }),
    })).rejects.toBe(operationError);
    expect(operationError).toMatchObject({
      evidenceWriterReleaseError: {
        code: 'EVIDENCE_WRITER_LOCK_RELEASE_FAILED',
      },
    });
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-015
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-015 classifies every registered CLI leaf', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorOutput = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { createProgram } = await import('../packages/cli/src/main.js');
    expect(output).not.toHaveBeenCalled();
    expect(errorOutput).not.toHaveBeenCalled();
    output.mockRestore();
    errorOutput.mockRestore();

    const leaves = new Set<string>();
    const visit = (commands: ReturnType<typeof createProgram>['commands'], prefix: string[] = []): void => {
      for (const command of commands) {
        const path = [...prefix, command.name()];
        if (command.commands.length > 0) {
          visit(command.commands, path);
          continue;
        }
        leaves.add(path.join(' '));
        for (const alias of command.aliases()) {
          leaves.add([...prefix, alias].join(' '));
        }
      }
    };
    visit(createProgram().commands);

    const classified = new Set([
      ...EVIDENCE_OPERATION_CLASSIFICATION.writer,
      ...EVIDENCE_OPERATION_CLASSIFICATION.coordinatedReader,
      ...EVIDENCE_OPERATION_CLASSIFICATION.exempt,
      ...EVIDENCE_OPERATION_CLASSIFICATION.conditional,
    ].map((operation) => operation.replace(/ --recover$/, ''))
      .filter((operation) => operation !== 'help' && operation !== 'version'));
    expect(classified).toEqual(leaves);
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-016
   * @verifies REQ-EVIDENCE-WRITER-LOCK-002
   */
  it('TEST-EVIDENCE-WRITER-LOCK-016 gives exactly one process ownership at a shared barrier', async () => {
    const root = await fixture();
    const start = resolve(root, 'start');
    const release = resolve(root, 'release');
    const moduleUrl = pathToFileURL(resolve('dist/packages/analysis/src/index.js')).href;
    const worker = resolve(root, 'worker.mjs');
    await writeFile(worker, `
      import { existsSync } from 'node:fs';
      import { writeFile } from 'node:fs/promises';
      import { acquireEvidenceWriterLock } from ${JSON.stringify(moduleUrl)};
      const [root, ready, start, release] = process.argv.slice(2);
      await writeFile(ready, '');
      while (!existsSync(start)) await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        const lease = await acquireEvidenceWriterLock(root, 'barrier-worker');
        console.log(JSON.stringify({ status: 'owner', owner: lease.owner }));
        while (!existsSync(release)) await new Promise((resolve) => setTimeout(resolve, 5));
        await lease.release();
      } catch (error) {
        console.log(JSON.stringify({ status: 'rejected', code: error.code, owner: error.owner }));
      }
    `);
    const children = [1, 2].map((index) => {
      const child = spawn(process.execPath, [worker, root, resolve(root, `ready-${index}`), start, release], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveDone) => {
        child.once('close', (code) => resolveDone({ code, stdout, stderr }));
      });
      return { done };
    });
    await Promise.all([waitForPath(resolve(root, 'ready-1')), waitForPath(resolve(root, 'ready-2'))]);
    await writeFile(start, '');
    await Promise.race(children.map((child) => child.done));
    await writeFile(release, '');
    const results = await Promise.all(children.map((child) => child.done));
    expect(results.every((result) => result.code === 0 && result.stderr === '')).toBe(true);
    const reports = results.map((result) => JSON.parse(result.stdout) as {
      status: 'owner' | 'rejected';
      code?: string;
      owner: { transactionId: string; command: string };
    });
    const owner = reports.filter((report) => report.status === 'owner');
    const rejected = reports.filter((report) => report.status === 'rejected');
    expect(owner).toHaveLength(1);
    expect(rejected).toEqual([expect.objectContaining({
      code: 'EVIDENCE_WRITER_LOCKED',
      owner: expect.objectContaining({
        command: 'barrier-worker',
        transactionId: owner[0]?.owner.transactionId,
      }),
    })]);
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-017
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-004
   */
  it('TEST-EVIDENCE-WRITER-LOCK-017 keeps exempt CLI operations independent of a foreign lock', async () => {
    const root = await fixture({
      '.musubix/config.json': jsonBytes(defaultConfig),
      'requirements.md': [
        '## REQ-EXEMPT-001: Example',
        'Priority: must',
        'Type: functional',
        'Statement: The system shall remain deterministic.',
        'Acceptance: Validation reports zero diagnostics.',
        '',
      ].join('\n'),
      'workflow.jsonl': [
        JSON.stringify({
          type: 'tool.execution_start',
          timestamp: '2020-01-01T00:00:01.000Z',
          data: { toolCallId: 'call-1', toolName: 'skill', arguments: { skill: 'sdd-change' } },
        }),
        JSON.stringify({
          type: 'tool.execution_complete',
          timestamp: '2020-01-01T00:00:02.000Z',
          data: { toolCallId: 'call-1', success: true },
        }),
        JSON.stringify({
          type: 'result',
          timestamp: '2020-01-01T00:00:03.000Z',
          sessionId: '123e4567-e89b-42d3-a456-426614174000',
          exitCode: 0,
        }),
      ].join('\n'),
    });
    await recordWorkflow(root, { skill: 'sdd-change', phase: 'complete', status: 'completed' });
    const lease = await acquireEvidenceWriterLock(root, 'foreign-writer');
    try {
      const requirements = await runProcess(process.execPath, [
        cli, 'requirements', 'validate', 'requirements.md', '--root', root, '--json',
      ], { cwd: root, timeoutMs: 10_000 });
      expect(requirements.exitCode).toBe(0);
      expect(JSON.parse(requirements.stdout)).toMatchObject({ valid: true });

      const sanitized = await runProcess(process.execPath, [
        cli, 'workflow-sanitize', 'workflow.jsonl', 'sanitized.jsonl', '--root', root, '--json',
      ], { cwd: root, timeoutMs: 10_000 });
      expect(sanitized.exitCode, `${sanitized.stdout}\n${sanitized.stderr}`).toBe(0);

      const recovery = await runProcess(process.execPath, [
        cli, 'evidence', 'unlock', '--recover', '--root', root, '--json',
      ], { cwd: root, timeoutMs: 10_000 });
      expect(recovery.exitCode).toBe(2);
      const recoveryError = JSON.parse(recovery.stdout) as {
        error: { code: string; owner?: { transactionId: string } };
      };
      expect(recoveryError.error.code).toBe(
        process.platform === 'linux'
          ? 'EVIDENCE_WRITER_LOCKED'
          : 'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE',
      );
      if (process.platform === 'linux') {
        expect(recoveryError.error.owner).toMatchObject({
          transactionId: lease.owner.transactionId,
        });
      }
    } finally {
      await lease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-025
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-025 documents the Windows durability boundary', async () => {
    const [english, japanese, help] = await Promise.all([
      readFile(resolve('README.md'), 'utf8'),
      readFile(resolve('README-ja.md'), 'utf8'),
      runProcess(process.execPath, [cli, 'evidence', 'unlock', '--help'], {
        cwd: process.cwd(),
        timeoutMs: 10_000,
      }),
    ]);
    expect(english).toContain('Windows directory synchronization rejects EPERM, EINVAL, or ENOTSUP');
    expect(english).toContain('automatic recovery remains inspection-only on Windows and macOS');
    expect(japanese).toContain('Windows の directory synchronization が EPERM、EINVAL、ENOTSUP');
    expect(japanese).toContain('Windows と macOS の自動復旧は inspection-only');
    expect(help.stdout).toContain('Windows directory synchronization');
    expect(help.stdout).toContain('inspection-only');
    expect(english).toContain('EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED');
    expect(japanese).toContain('EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED');
    expect(help.stdout).toContain('EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED');
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-018
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002
   */
  it('TEST-EVIDENCE-WRITER-LOCK-018 blocks graph gate before replacing the code graph cache', async () => {
    const root = await fixture({
      '.musubix/cache/codegraph.json': jsonBytes({ sentinel: 'unchanged' }),
    });
    const cachePath = resolve(root, '.musubix/cache/codegraph.json');
    const before = await readFile(cachePath, 'utf8');
    const lease = await acquireEvidenceWriterLock(root, 'foreign-writer');
    try {
      const result = await runProcess(process.execPath, [
        cli, 'graph', 'gate', '--root', root, '--json',
      ], { cwd: root, timeoutMs: 10_000 });
      expect(result.exitCode).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({
        error: { code: 'EVIDENCE_WRITER_LOCKED' },
      });
      expect(await readFile(cachePath, 'utf8')).toBe(before);
    } finally {
      await lease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-019
   * @verifies REQ-EVIDENCE-WRITER-LOCK-005
   */
  it('TEST-EVIDENCE-WRITER-LOCK-019 checks the dry-run destination before the incoming root', async () => {
    const base = await fixture();
    const incoming = await fixture();
    const destinationLease = await acquireEvidenceWriterLock(base, 'dry-run-destination-owner');
    const incomingLease = await acquireEvidenceWriterLock(incoming, 'dry-run-incoming-owner');
    try {
      await expect(mergeEvidenceHistories(base, incoming, { dryRun: true })).rejects.toMatchObject({
        code: 'EVIDENCE_WRITER_LOCKED',
        owner: expect.objectContaining({
          command: 'dry-run-destination-owner',
          transactionId: destinationLease.owner.transactionId,
        }),
      });
    } finally {
      await destinationLease.release();
      await incomingLease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-022
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002
   */
  it('TEST-EVIDENCE-WRITER-LOCK-022 coordinates direct adapter report mutations without an explicit root', async () => {
    const root = await fixture({
      '.musubix/evidence/native/direct-adapter/report.json': '{"sentinel":true}\n',
    });
    const path = resolve(root, '.musubix/evidence/native/direct-adapter/report.json');
    const before = await readFile(path, 'utf8');
    const lease = await acquireEvidenceWriterLock(root, 'foreign-writer');
    try {
      await expect(clearAdapterOutput(
        adapterInvocation('vitest', 'direct-adapter'),
        path,
      )).rejects.toMatchObject({ code: 'EVIDENCE_WRITER_LOCKED' });
      expect(await readFile(path, 'utf8')).toBe(before);
    } finally {
      await lease.release();
    }
  });

  /** @id TEST-EVIDENCE-WRITER-LOCK-023
   * @verifies REQ-EVIDENCE-WRITER-LOCK-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-023 keeps resolved modes and analysis writer entries exhaustive', async () => {
    const modeKeys = EVIDENCE_CONDITIONAL_OPERATION_MODES.map(({ operation, options }) =>
      `${operation}:${'dryRun' in options && options.dryRun === true ? 'dry-run' : 'write'}`);
    expect(new Set(modeKeys).size).toBe(modeKeys.length);
    for (const mode of EVIDENCE_CONDITIONAL_OPERATION_MODES) {
      expect(classifyEvidenceOperation(mode.operation, mode.options)).toBe(mode.classification);
    }
    for (const operation of EVIDENCE_OPERATION_CLASSIFICATION.conditional) {
      expect(EVIDENCE_OPERATION_CLASSIFICATION.writer).not.toContain(operation);
      expect(EVIDENCE_OPERATION_CLASSIFICATION.coordinatedReader).not.toContain(operation);
      expect(EVIDENCE_OPERATION_CLASSIFICATION.exempt).not.toContain(operation);
    }

    const observed = new Set<string>();
    for (const file of await readdir(resolve('packages/analysis/src'))) {
      if (!file.endsWith('.ts')) continue;
      const source = await readFile(resolve('packages/analysis/src', file), 'utf8');
      for (const match of source.matchAll(/withEvidenceWriterLock\([^,]+,\s*'([^']+)'/g)) {
        observed.add(match[1]!);
      }
      if (source.includes('withEvidenceWriterLock(root, `tdd ${phase}`')) observed.add('tdd <phase>');
    }
    expect(new Set(EVIDENCE_WRITER_ANALYSIS_ENTRIES)).toEqual(observed);
  });
});
