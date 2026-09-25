import { access, readFile, unlink } from 'node:fs/promises';
import { fstatSync, statSync, unlinkSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

interface WriterLockOwner {
  canonicalRoot: string;
  transactionId: string;
  command: string;
}

interface WriterLease {
  owner: WriterLockOwner;
  release(): Promise<void>;
}

type EvidenceDirectorySyncPolicy = 'allow-unsupported' | 'strict';
interface WriterLockIdentity {
  dev: number;
  ino: number;
}

interface WriterLockApi {
  withEvidenceWriterLock<T>(root: string, command: string, operation: () => Promise<T>): Promise<T>;
  acquireEvidenceWriterLock(
    root: string,
    command: string,
    dependencies?: {
      hostname?: () => string;
      platform?: () => NodeJS.Platform;
      processFingerprint?: () => Promise<{ platform: 'linux'; bootId: string; pidNamespace: string; processStart: string }>;
      lockOwner?: (path: string) => Promise<WriterLockOwner>;
      lockIdentity?: (path: string) => Promise<WriterLockIdentity>;
      publishedLockIdentity?: (descriptor: number) => WriterLockIdentity;
      rollbackUnlink?: (path: string) => Promise<void>;
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
const readLockOwner = async (path: string): Promise<WriterLockOwner> =>
  JSON.parse(await readFile(path, 'utf8')) as WriterLockOwner;

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
  const observed: EvidenceDirectorySyncPolicy[] = [];
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
    syncEvidenceDirectory: async (_path, policy) => {
      observed.push(policy);
    },
  });

  expect(report).toEqual({ action: 'recovered', recovered: true });
  expect(observed).toEqual(['strict']);
  await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

/** @id TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 * @verifies REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001 reports post-unlink sync failure accurately', async () => {
  const root = await fixture();
  const fingerprint = {
    platform: 'linux' as const,
    bootId: 'boot-test',
    pidNamespace: 'pid:[test]',
    processStart: '100',
  };
  const lease = await lockApi.acquireEvidenceWriterLock(root, 'abandoned-durability', {
    hostname,
    processFingerprint: async () => fingerprint,
  });

  await expect(lockApi.recoverEvidenceWriterLock(root, {
    hostname,
    processFingerprint: async () => fingerprint,
    processState: async () => 'dead',
    syncEvidenceDirectory: async () => {
      throw filesystemError('EACCES');
    },
  })).rejects.toMatchObject({
    code: 'EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED',
    lockPath: lockPath(root),
    owner: expect.objectContaining({ transactionId: lease.owner.transactionId }),
    lockRemoved: true,
    cause: { code: 'EACCES' },
    guidance: [
      expect.stringContaining('absent now'),
      expect.stringContaining('exact reported path'),
    ],
  });
  await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
});

/** @id TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-003
 * @verifies REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-003 preserves a pre-unlink unsafe lock byte-for-byte', async () => {
  const root = await fixture();
  const fingerprint = {
    platform: 'linux' as const,
    bootId: 'boot-test',
    pidNamespace: 'pid:[test]',
    processStart: '100',
  };
  await lockApi.acquireEvidenceWriterLock(root, 'unsafe-owner', {
    hostname,
    processFingerprint: async () => fingerprint,
  });
  const before = await readFile(lockPath(root), 'utf8');

  await expect(lockApi.recoverEvidenceWriterLock(root, {
    hostname: () => 'different-host',
    processFingerprint: async () => fingerprint,
    processState: async () => 'dead',
  })).rejects.toMatchObject({
    code: 'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE',
    lockRemoved: undefined,
  });
  expect(await readFile(lockPath(root), 'utf8')).toBe(before);
  await unlink(lockPath(root));
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
 * @verifies REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
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
    code: 'EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED',
    lockRemoved: true,
    cause: { code: 'EPERM' },
  });
  await expect(readFile(lockPath(recoveryRoot), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

  expect(observed).toEqual(['allow-unsupported', 'allow-unsupported', 'strict']);
});

/** @id TEST-EVIDENCE-WRITER-LOCK-027
 * @verifies REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-027 verifies acquisition rollback identity, durability, and error precedence', async () => {
    const acquireFailure = async (
      root: string,
      dependencies: NonNullable<Parameters<WriterLockApi['acquireEvidenceWriterLock']>[2]>,
    ): Promise<Record<string, unknown>> => {
      try {
        await lockApi.acquireEvidenceWriterLock(root, 'rollback-test', dependencies);
        throw new Error('expected acquisition failure');
      } catch (error) {
        expect(error).toMatchObject({
          code: 'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
          cause: { code: 'EACCES' },
        });
        return error as Record<string, unknown>;
      }
    };

    for (const testCase of [
      {
        name: 'canonical-root mismatch',
        owner: async (path: string): Promise<WriterLockOwner> => ({
          ...await readLockOwner(path),
          canonicalRoot: resolve('/replacement-root'),
        }),
      },
      {
        name: 'transaction mismatch',
        owner: async (path: string): Promise<WriterLockOwner> => ({
          ...await readLockOwner(path),
          transactionId: 'replacement-transaction',
        }),
      },
      {
        name: 'unreadable metadata',
        owner: async (): Promise<WriterLockOwner> => { throw filesystemError('EIO'); },
      },
      {
        name: 'malformed metadata',
        owner: async (): Promise<WriterLockOwner> => { throw new SyntaxError('malformed owner'); },
      },
    ]) {
      const root = await fixture();
      const error = await acquireFailure(root, {
        lockOwner: testCase.owner,
        syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
      });
      expect(error.rollbackError, testCase.name).toMatchObject({
        code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
        lockPath: lockPath(root),
        lockRemoved: false,
        guidance: expect.arrayContaining([expect.stringContaining(lockPath(root))]),
      });
      await expect(readFile(lockPath(root), 'utf8')).resolves.toContain('"transactionId"');
      await unlink(lockPath(root));
    }

    {
      const root = await fixture();
      let observations = 0;
      const error = await acquireFailure(root, {
        lockIdentity: async () => {
          observations += 1;
          return observations === 1 ? { dev: 1, ino: 1 } : { dev: 2, ino: 2 };
        },
        syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
      });
      expect(error.rollbackError).toMatchObject({
        code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
        lockRemoved: false,
      });
      await expect(readFile(lockPath(root), 'utf8')).resolves.toContain('"transactionId"');
      await unlink(lockPath(root));
    }

    {
      const root = await fixture();
      let publishedIdentityCaptures = 0;
      let rollbackIdentityObservations = 0;
      const error = await acquireFailure(root, {
        publishedLockIdentity: () => {
          publishedIdentityCaptures += 1;
          return { dev: 1, ino: 1 };
        },
        lockIdentity: async () => {
          rollbackIdentityObservations += 1;
          return { dev: 1, ino: 1 };
        },
        syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
      });
      expect(error.rollbackError).toBeUndefined();
      expect(publishedIdentityCaptures).toBe(1);
      expect(rollbackIdentityObservations).toBe(1);
      await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }

    {
      const root = await fixture();
      const error = await acquireFailure(root, {
        publishedLockIdentity: () => { throw filesystemError('EACCES'); },
      });
      expect(error.rollbackError).toMatchObject({
        code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
        lockRemoved: false,
      });
      await expect(readFile(lockPath(root), 'utf8')).resolves.toContain('"transactionId"');
      await unlink(lockPath(root));
    }

    {
      const root = await fixture();
      const error = await acquireFailure(root, {
        rollbackUnlink: async () => { throw filesystemError('EBUSY'); },
        syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
      });
      expect(error.rollbackError).toMatchObject({
        code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
        lockRemoved: false,
        cause: { code: 'EBUSY' },
      });
      await expect(readFile(lockPath(root), 'utf8')).resolves.toContain('"transactionId"');
      await unlink(lockPath(root));
    }

    {
      const root = await fixture();
      const error = await acquireFailure(root, {
        syncEvidenceDirectorySync: () => {
          unlinkSync(lockPath(root));
          throw filesystemError('EACCES');
        },
      });
      expect(error.rollbackError).toBeUndefined();
      await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }

    {
      const root = await fixture();
      const error = await acquireFailure(root, {
        rollbackUnlink: async (path) => {
          await unlink(path);
          throw filesystemError('ENOENT');
        },
        syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
      });
      expect(error.rollbackError).toBeUndefined();
      await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }

    {
      const parent = await fixture();
      const root = resolve(parent, 'created-root');
      const policies: EvidenceDirectorySyncPolicy[] = [];
      const error = await acquireFailure(root, {
        syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
        syncEvidenceDirectory: async (_path, policy) => { policies.push(policy); },
      });
      expect(error.rollbackError).toBeUndefined();
      expect(policies).toEqual(['allow-unsupported']);
      await expect(access(root)).rejects.toMatchObject({ code: 'ENOENT' });
    }

    {
      const root = await fixture();
      const error = await acquireFailure(root, {
        syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
        syncEvidenceDirectory: async () => { throw filesystemError('EIO'); },
      });
      expect(error.rollbackError).toMatchObject({
        code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
        lockRemoved: true,
        cause: { code: 'EIO' },
        guidance: expect.arrayContaining([
          expect.stringContaining('crash durability'),
          expect.stringContaining(lockPath(root)),
        ]),
      });
      await expect(readFile(lockPath(root), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    }
});

const acquireRollbackGuidanceFailure = async (
  root: string,
  dependencies: NonNullable<Parameters<WriterLockApi['acquireEvidenceWriterLock']>[2]>,
): Promise<Record<string, unknown>> => {
  try {
    await lockApi.acquireEvidenceWriterLock(root, 'rollback-guidance-test', dependencies);
    throw new Error('expected acquisition failure');
  } catch (error) {
    expect(error).toMatchObject({ code: 'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED' });
    return error as Record<string, unknown>;
  }
};

/** @id TEST-EVIDENCE-WRITER-LOCK-030
 * @verifies REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-030 reports the failed acquirer after descriptor capture fails', async () => {
  const root = await fixture();
  let descriptorIdentity: WriterLockIdentity | undefined;
  let publishedIdentity: WriterLockIdentity | undefined;
  const error = await acquireRollbackGuidanceFailure(root, {
    publishedLockIdentity: (descriptor) => {
      const descriptorStats = fstatSync(descriptor);
      const publishedStats = statSync(lockPath(root));
      descriptorIdentity = { dev: descriptorStats.dev, ino: descriptorStats.ino };
      publishedIdentity = { dev: publishedStats.dev, ino: publishedStats.ino };
      throw filesystemError('EACCES');
    },
  });
  expect(descriptorIdentity).toEqual(publishedIdentity);
  expect(error.rollbackError).toMatchObject({
    code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
    lockRemoved: false,
    owner: expect.objectContaining({ command: 'rollback-guidance-test' }),
    guidance: expect.arrayContaining([
      expect.stringContaining('failed acquirer with no lease'),
    ]),
  });
  await unlink(lockPath(root));
});

/** @id TEST-EVIDENCE-WRITER-LOCK-031
 * @verifies REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-031 refuses failed-acquirer cleanup for a replacement lock', async () => {
  const root = await fixture();
  const error = await acquireRollbackGuidanceFailure(root, {
    lockOwner: async (path) => ({
      ...await readLockOwner(path),
      transactionId: 'replacement-transaction',
    }),
    syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
  });
  expect(error.rollbackError).toMatchObject({
    code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
    lockRemoved: false,
    owner: expect.objectContaining({ transactionId: 'replacement-transaction' }),
    guidance: expect.arrayContaining([
      expect.stringContaining('replacement lock'),
      expect.stringContaining('must not be removed'),
    ]),
  });
  await unlink(lockPath(root));
});

/** @id TEST-EVIDENCE-WRITER-LOCK-032
 * @verifies REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 */
it('TEST-EVIDENCE-WRITER-LOCK-032 reports when rollback owner metadata is unavailable', async () => {
  const root = await fixture();
  const error = await acquireRollbackGuidanceFailure(root, {
    lockOwner: async () => { throw filesystemError('EIO'); },
    syncEvidenceDirectorySync: () => { throw filesystemError('EACCES'); },
  });
  expect(error.rollbackError).toMatchObject({
    code: 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
    lockRemoved: false,
    owner: undefined,
    guidance: expect.arrayContaining([
      expect.stringContaining('owner metadata may be unavailable'),
    ]),
  });
  await unlink(lockPath(root));
});
