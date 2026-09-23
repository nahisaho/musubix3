import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

interface WriterLockOwner {
  transactionId: string;
  command: string;
}

interface WriterLease {
  owner: WriterLockOwner;
  release(): Promise<void>;
}

type EvidenceDirectorySyncPolicy = 'allow-unsupported' | 'strict';

interface WriterLockApi {
  withEvidenceWriterLock<T>(root: string, command: string, operation: () => Promise<T>): Promise<T>;
  acquireEvidenceWriterLock(
    root: string,
    command: string,
    dependencies?: {
      hostname?: () => string;
      platform?: () => NodeJS.Platform;
      processFingerprint?: () => Promise<{ platform: 'linux'; bootId: string; pidNamespace: string; processStart: string }>;
      syncEvidenceDirectory?: (path: string, policy: EvidenceDirectorySyncPolicy) => Promise<void>;
      syncEvidenceDirectorySync?: (path: string, policy: EvidenceDirectorySyncPolicy) => void;
    },
  ): Promise<WriterLease>;
  recoverEvidenceWriterLock(
    root: string,
    dependencies?: {
      hostname?: () => string;
      platform?: () => NodeJS.Platform;
      processFingerprint?: () => Promise<{ platform: 'linux'; bootId: string; pidNamespace: string; processStart: string }>;
      processState?: () => Promise<'dead' | 'live' | 'reused' | 'indeterminate'>;
      syncEvidenceDirectory?: (path: string, policy: EvidenceDirectorySyncPolicy) => Promise<void>;
    },
  ): Promise<{ action: 'nothing-to-recover' | 'recovered'; recovered: boolean }>;
}

const lockApi = analysis as unknown as WriterLockApi;
const lockPath = (root: string): string => resolve(root, '.musubix/evidence/.writer-lock.json');
const filesystemError = (code: string): NodeJS.ErrnoException =>
  Object.assign(new Error(`injected ${code}`), { code });

/** @id TEST-EVIDENCE-WRITER-LOCK-001
 * @verifies REQ-EVIDENCE-WRITER-LOCK-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-001 publishes complete owner metadata before writer side effects', async () => {
  const root = await fixture();

  await lockApi.withEvidenceWriterLock(root, 'test-writer', async () => {
    const owner = JSON.parse(await readFile(lockPath(root), 'utf8')) as WriterLockOwner;
    expect(owner.command).toBe('test-writer');
    expect(owner.transactionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

/** @id TEST-EVIDENCE-WRITER-LOCK-002
 * @verifies REQ-EVIDENCE-WRITER-LOCK-002
 */
it('TEST-EVIDENCE-WRITER-LOCK-002 rejects an unrelated contender before its callback runs', async () => {
  const root = await fixture();
  let releaseOwner!: () => void;
  const ownerStarted = new Promise<void>((resolveStarted) => {
    releaseOwner = resolveStarted;
  });
  let entered = false;
  const owner = lockApi.withEvidenceWriterLock(root, 'owner', () => ownerStarted);
  await readFile(lockPath(root), 'utf8');

  await expect(lockApi.withEvidenceWriterLock(root, 'contender', async () => {
    entered = true;
  })).rejects.toMatchObject({ code: 'EVIDENCE_WRITER_LOCKED' });
  expect(entered).toBe(false);

  releaseOwner();
  await owner;
});

/** @id TEST-EVIDENCE-WRITER-LOCK-003
 * @verifies REQ-EVIDENCE-WRITER-LOCK-003
 */
it('TEST-EVIDENCE-WRITER-LOCK-003 reuses one owner for nested and concurrent sibling operations', async () => {
  const root = await fixture();

  const transactionIds = await lockApi.withEvidenceWriterLock(root, 'outer', async () =>
    Promise.all([
      lockApi.withEvidenceWriterLock(root, 'nested-a', async () =>
        (JSON.parse(await readFile(lockPath(root), 'utf8')) as WriterLockOwner).transactionId),
      lockApi.withEvidenceWriterLock(root, 'nested-b', async () =>
        (JSON.parse(await readFile(lockPath(root), 'utf8')) as WriterLockOwner).transactionId),
    ]));

  expect(new Set(transactionIds).size).toBe(1);
});

/** @id TEST-EVIDENCE-WRITER-LOCK-004
 * @verifies REQ-EVIDENCE-WRITER-LOCK-004
 */
it('TEST-EVIDENCE-WRITER-LOCK-004 releases its own lock after a handled operation failure', async () => {
  const root = await fixture();

  await expect(lockApi.withEvidenceWriterLock(root, 'failing-writer', async () => {
    throw new Error('expected failure');
  })).rejects.toThrow('expected failure');

  await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

/** @id TEST-EVIDENCE-WRITER-LOCK-005
 * @verifies REQ-EVIDENCE-WRITER-LOCK-005
 */
it('TEST-EVIDENCE-WRITER-LOCK-005 explicitly recovers only a demonstrably dead same-host owner', async () => {
  const root = await fixture();
  const fingerprint = {
    platform: 'linux' as const,
    bootId: 'boot-test',
    pidNamespace: 'pid:[test]',
    processStart: '100',
  };
  await lockApi.acquireEvidenceWriterLock(root, 'abandoned', {
    hostname,
    processFingerprint: async () => fingerprint,
  });

  const report = await lockApi.recoverEvidenceWriterLock(root, {
    hostname,
    processFingerprint: async () => fingerprint,
    processState: async () => 'dead',
  });

  expect(report).toEqual({ action: 'recovered', recovered: true });
  await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

/** @id TEST-EVIDENCE-WRITER-LOCK-024
 * @verifies REQ-EVIDENCE-WRITER-LOCK-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-024 permits only unsupported Windows directory synchronization', async () => {
  for (const code of ['EPERM', 'EINVAL', 'ENOTSUP']) {
    const root = await fixture();
    let publicationCalls = 0;
    let releaseCalls = 0;
    const lease = await lockApi.acquireEvidenceWriterLock(root, `windows-${code}`, {
      platform: () => 'win32',
      syncEvidenceDirectorySync: () => {
        publicationCalls += 1;
        throw filesystemError(code);
      },
      syncEvidenceDirectory: async () => {
        releaseCalls += 1;
        throw filesystemError(code);
      },
    });
    await lease.release();
    expect(publicationCalls).toBe(1);
    expect(releaseCalls).toBe(1);
    await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  }

  for (const testCase of [
    { platform: 'win32' as const, code: 'EACCES' },
    { platform: 'linux' as const, code: 'EPERM' },
  ]) {
    const root = await fixture();
    let lease: WriterLease | undefined;
    let failure: unknown;
    try {
      lease = await lockApi.acquireEvidenceWriterLock(root, `${testCase.platform}-${testCase.code}`, {
        platform: () => testCase.platform,
        syncEvidenceDirectorySync: () => {
          throw filesystemError(testCase.code);
        },
      });
    } catch (error) {
      failure = error;
    } finally {
      await lease?.release();
    }
    expect(failure).toMatchObject({
      code: 'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      cause: { code: testCase.code },
    });
  }

  const root = await fixture();
  const lease = await lockApi.acquireEvidenceWriterLock(root, 'windows-release-eacces', {
    platform: () => 'win32',
    syncEvidenceDirectorySync: () => undefined,
    syncEvidenceDirectory: async () => {
      throw filesystemError('EACCES');
    },
  });
  await expect(lease.release()).rejects.toMatchObject({
    code: 'EVIDENCE_WRITER_LOCK_RELEASE_FAILED',
    cause: { code: 'EACCES' },
  });
});

/** @id TEST-EVIDENCE-WRITER-LOCK-026
 * @verifies REQ-EVIDENCE-WRITER-LOCK-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-026 couples directory synchronization policy to every call site', async () => {
  const observed: EvidenceDirectorySyncPolicy[] = [];
  const root = await fixture();
  const lease = await lockApi.acquireEvidenceWriterLock(root, 'policy-observation', {
    platform: () => 'win32',
    syncEvidenceDirectorySync: (_path, policy) => {
      observed.push(policy);
    },
    syncEvidenceDirectory: async (_path, policy) => {
      observed.push(policy);
    },
  });
  await lease.release();

  const recoveryRoot = await fixture();
  const fingerprint = {
    platform: 'linux' as const,
    bootId: 'boot-test',
    pidNamespace: 'pid:[test]',
    processStart: '100',
  };
  await lockApi.acquireEvidenceWriterLock(recoveryRoot, 'recovery-policy', {
    hostname,
    processFingerprint: async () => fingerprint,
  });
  await expect(lockApi.recoverEvidenceWriterLock(recoveryRoot, {
    hostname,
    platform: () => 'win32',
    processFingerprint: async () => fingerprint,
    processState: async () => 'dead',
    syncEvidenceDirectory: async (_path, policy) => {
      observed.push(policy);
      throw filesystemError('EPERM');
    },
  })).rejects.toMatchObject({
    code: 'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE',
    cause: { code: 'EPERM' },
  });

  expect(observed).toEqual(['allow-unsupported', 'allow-unsupported', 'strict']);
});
