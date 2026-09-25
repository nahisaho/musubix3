import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import * as evidenceMerge from '../packages/analysis/src/evidence-merge.js';
import * as qualityRefresh from '../packages/analysis/src/quality-refresh.js';
import { project as createProject } from './helpers.js';
import type { EvidenceDirectorySyncPolicy } from '../packages/analysis/src/index.js';

type DirectorySyncHandle = {
  sync(): Promise<void>;
  close(): Promise<void>;
};

type DirectoryOpen = (path: string, flags: 'r') => Promise<DirectorySyncHandle>;
type DirectorySync = (
  path: string,
  openDirectory?: DirectoryOpen,
  platform?: () => NodeJS.Platform,
) => Promise<void>;
type SyncDependencies = {
  syncDirectory?: (path: string) => Promise<void>;
};
type QualityRefreshApi = {
  commitQualityRefresh(
    root: string,
    order: analysis.EvidenceOrderLog,
    changes: analysis.ChangeEvidence,
    faultAt?: string,
    dependencies?: SyncDependencies,
  ): Promise<void>;
  recoverQualityRefresh(root: string, dependencies?: SyncDependencies): Promise<unknown>;
};
type EvidenceMergeApi = {
  mergeEvidenceHistories(
    root: string,
    incoming: string,
    options?: { faultAt?: string; syncDirectory?: (path: string) => Promise<void> },
  ): Promise<unknown>;
  recoverEvidenceMerge(root: string, dependencies?: SyncDependencies): Promise<unknown>;
};
type WriterLease = {
  release(): Promise<void>;
};
type WriterLockApi = {
  acquireEvidenceWriterLock(
    root: string,
    command: string,
    dependencies?: {
      hostname?: () => string;
      processFingerprint?: () => Promise<{
        platform: 'linux';
        bootId: string;
        pidNamespace: string;
        processStart: string;
      }>;
      syncEvidenceDirectory?: (path: string, policy: EvidenceDirectorySyncPolicy) => Promise<void>;
      syncEvidenceDirectorySync?: (path: string, policy: EvidenceDirectorySyncPolicy) => void;
    },
  ): Promise<WriterLease>;
  recoverEvidenceWriterLock(
    root: string,
    dependencies?: {
      hostname?: () => string;
      processFingerprint?: () => Promise<{
        platform: 'linux';
        bootId: string;
        pidNamespace: string;
        processStart: string;
      }>;
      processState?: () => Promise<'dead' | 'live' | 'reused' | 'indeterminate'>;
      syncEvidenceDirectory?: (path: string, policy: EvidenceDirectorySyncPolicy) => Promise<void>;
    },
  ): Promise<unknown>;
};

const qualityDirectorySync: DirectorySync = analysis.fsyncQualityRefreshDirectory;
const mergeDirectorySync: DirectorySync = analysis.fsyncEvidenceMergeDirectory;
const qualityApi = qualityRefresh as unknown as QualityRefreshApi;
const mergeApi = evidenceMerge as unknown as EvidenceMergeApi;
const lockApi = analysis as unknown as WriterLockApi;
const temporaryRoots: string[] = [];

async function project(): Promise<string> {
  const root = await createProject();
  await analysis.writeJson(root, '.musubix/evidence/order.json', {
    schemaVersion: 1,
    records: [],
  });
  await analysis.writeJson(root, '.musubix/evidence/tdd.json', {
    schemaVersion: 1,
    cycles: [],
    chain: [],
  });
  await analysis.writeJson(root, '.musubix/evidence/changes.json', {
    schemaVersion: 1,
    changes: [],
  });
  return root;
}

function filesystemError(code: string, message = `injected ${code}`): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code, syscall: 'fsync' });
}

function openHandle(sync: () => Promise<void>, close: () => Promise<void> = async () => {}): DirectoryOpen {
  return async () => ({ sync, close });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** @id TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 * @verifies REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 */
it('TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-001 shares the platform classifier and strict policy', async () => {
  const api = analysis as Record<string, unknown>;
  const classify = api.classifyDirectorySyncError as
    ((cause: unknown, platform: NodeJS.Platform) => 'unsupported' | 'actionable');
  const synchronize = api.synchronizeDirectory as (
    path: string,
    policy: EvidenceDirectorySyncPolicy,
    openDirectory?: DirectoryOpen,
    platform?: () => NodeJS.Platform,
  ) => Promise<void>;
  const legacyPolicy: EvidenceDirectorySyncPolicy = 'strict';

  expect(typeof classify).toBe('function');
  expect(typeof synchronize).toBe('function');
  expect(legacyPolicy).toBe('strict');
  for (const code of ['EPERM', 'EINVAL', 'ENOTSUP']) {
    expect(classify(filesystemError(code), 'win32')).toBe('unsupported');
  }
  for (const code of ['EISDIR', 'EACCES', 'UNKNOWN']) {
    expect(classify(filesystemError(code), 'win32')).toBe('actionable');
  }
  expect(classify(filesystemError('EPERM'), 'linux')).toBe('actionable');
  expect(classify(filesystemError('EINVAL'), 'darwin')).toBe('actionable');
  expect(classify('EPERM', 'win32')).toBe('actionable');

  const unsupported = filesystemError('EPERM');
  await expect(synchronize('.', 'allow-unsupported', openHandle(async () => {
    throw unsupported;
  }), () => 'win32')).resolves.toBeUndefined();
  await expect(synchronize('.', 'strict', openHandle(async () => {
    throw unsupported;
  }), () => 'win32')).rejects.toBe(unsupported);
});

/** @id TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-002
 * @verifies REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 */
it('TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-002 scopes suppression to sync on Windows', async () => {
  const legacyQualityShape: (
    path: string,
    openDirectory?: DirectoryOpen,
  ) => Promise<void> = qualityDirectorySync;
  const legacyMergeShape: (
    path: string,
    openDirectory?: DirectoryOpen,
  ) => Promise<void> = mergeDirectorySync;
  expect(typeof legacyQualityShape).toBe('function');
  expect(typeof legacyMergeShape).toBe('function');

  for (const synchronize of [qualityDirectorySync, mergeDirectorySync]) {
    const linuxError = filesystemError('EPERM');
    await expect(synchronize('.', openHandle(async () => {
      throw linuxError;
    }), () => 'linux')).rejects.toBe(linuxError);

    const windowsActionable = filesystemError('EISDIR');
    await expect(synchronize('.', openHandle(async () => {
      throw windowsActionable;
    }), () => 'win32')).rejects.toBe(windowsActionable);

    let closes = 0;
    await expect(synchronize('.', openHandle(async () => {
      throw filesystemError('ENOTSUP');
    }, async () => {
      closes++;
    }), () => 'win32')).resolves.toBeUndefined();
    expect(closes).toBe(1);

    const openError = filesystemError('EPERM', 'directory open failed');
    await expect(synchronize('.', async () => {
      throw openError;
    }, () => 'win32')).rejects.toBe(openError);

    const closeError = filesystemError('EIO', 'directory close failed');
    await expect(synchronize('.', openHandle(async () => {
      throw filesystemError('EPERM');
    }, async () => {
      throw closeError;
    }), () => 'win32')).rejects.toBe(closeError);
  }
});

/** @id TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-003
 * @verifies REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 */
it('TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-003 preserves transaction recovery diagnostics', async () => {
  const qualityRoot = await project();
  const order: analysis.EvidenceOrderLog = { schemaVersion: 1, records: [] };
  const changes: analysis.ChangeEvidence = { schemaVersion: 2, changes: [] };
  const qualityFailure = filesystemError('EACCES', 'quality directory sync failed');
  let qualitySyncCalls = 0;
  await expect(qualityApi.commitQualityRefresh(
    qualityRoot,
    order,
    changes,
    undefined,
    { syncDirectory: async () => {
      qualitySyncCalls++;
      throw qualityFailure;
    } },
  )).rejects.toThrow(/CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED.*quality directory sync failed/);
  expect(qualitySyncCalls).toBe(1);
  await expect(readFile(
    join(qualityRoot, '.musubix/evidence/.quality-refresh-transaction.json'),
    'utf8',
  )).resolves.toContain('"state": "prepared"');

  let qualityRecoveryCalls = 0;
  await expect(qualityApi.recoverQualityRefresh(qualityRoot, {
    syncDirectory: async () => {
      qualityRecoveryCalls++;
      throw filesystemError('EACCES', 'quality rollback sync failed');
    },
  })).rejects.toThrow(
    /CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE.*quality rollback sync failed.*quality-refresh-transaction\.json.*Owned paths:/,
  );
  expect(qualityRecoveryCalls).toBe(1);

  const mergeRoot = await project();
  await analysis.writeJson(mergeRoot, '.musubix/evidence/order.json', {
    schemaVersion: 1,
    records: [],
  });
  await analysis.writeJson(mergeRoot, '.musubix/evidence/tdd.json', {
    schemaVersion: 1,
    cycles: [],
    chain: [],
  });
  await analysis.writeJson(mergeRoot, '.musubix/evidence/changes.json', {
    schemaVersion: 1,
    changes: [],
  });
  const cloneParent = await mkdtemp(join(tmpdir(), 'musubix-directory-sync-merge-'));
  temporaryRoots.push(cloneParent);
  const incoming = join(cloneParent, 'incoming');
  await cp(mergeRoot, incoming, { recursive: true });
  let mergeSyncCalls = 0;
  await expect(mergeApi.mergeEvidenceHistories(mergeRoot, incoming, {
    syncDirectory: async () => {
      mergeSyncCalls++;
      throw filesystemError('EACCES', 'merge directory sync failed');
    },
  })).rejects.toThrow(/EVIDENCE_MERGE_RECOVERY_REQUIRED.*merge directory sync failed/);
  expect(mergeSyncCalls).toBe(1);
  await expect(readFile(
    join(mergeRoot, '.musubix/evidence/.merge-transaction.json'),
    'utf8',
  )).resolves.toContain('"state": "prepared"');

  let mergeRecoveryCalls = 0;
  await expect(mergeApi.recoverEvidenceMerge(mergeRoot, {
    syncDirectory: async () => {
      mergeRecoveryCalls++;
      throw filesystemError('EACCES', 'merge rollback sync failed');
    },
  })).rejects.toThrow(
    /EVIDENCE_MERGE_RECOVERY_UNSAFE.*merge rollback sync failed.*merge-transaction\.json.*Merge-owned paths:/,
  );
  expect(mergeRecoveryCalls).toBe(1);
});

/** @id TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-004
 * @verifies REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 */
it('TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-004 synchronizes a real runner-local directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'musubix-directory-sync-'));
  temporaryRoots.push(root);
  await expect(qualityDirectorySync(root)).resolves.toBeUndefined();
  await expect(mergeDirectorySync(root)).resolves.toBeUndefined();
});

/** @id TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-005
 * @verifies REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 */
it('TEST-TRANSACTION-DIRECTORY-SYNC-POLICY-005 preserves forwarding, policies, and unsafe recovery boundaries', async () => {
  const currentQualityShape: DirectorySync = analysis.fsyncQualityRefreshDirectory;
  const currentMergeShape: DirectorySync = analysis.fsyncEvidenceMergeDirectory;
  const legacyQualityShape: (
    path: string,
    openDirectory?: DirectoryOpen,
  ) => Promise<void> = analysis.fsyncQualityRefreshDirectory;
  const legacyMergeShape: (
    path: string,
    openDirectory?: DirectoryOpen,
  ) => Promise<void> = analysis.fsyncEvidenceMergeDirectory;
  expect(typeof currentQualityShape).toBe('function');
  expect(typeof currentMergeShape).toBe('function');
  expect(typeof legacyQualityShape).toBe('function');
  expect(typeof legacyMergeShape).toBe('function');

  const realDirectory = await mkdtemp(join(tmpdir(), 'musubix-directory-sync-forwarding-'));
  temporaryRoots.push(realDirectory);
  await expect(currentQualityShape(realDirectory, undefined, () => 'linux')).resolves.toBeUndefined();
  await expect(currentMergeShape(realDirectory, undefined, () => 'linux')).resolves.toBeUndefined();

  const observedPolicies: EvidenceDirectorySyncPolicy[] = [];
  const lockRoot = await project();
  const lease = await lockApi.acquireEvidenceWriterLock(lockRoot, 'policy-observation', {
    syncEvidenceDirectorySync: (_path, policy) => {
      observedPolicies.push(policy);
    },
    syncEvidenceDirectory: async (_path, policy) => {
      observedPolicies.push(policy);
    },
  });
  await lease.release();

  const rollbackRoot = await project();
  await expect(lockApi.acquireEvidenceWriterLock(rollbackRoot, 'rollback-policy', {
    syncEvidenceDirectorySync: () => {
      throw filesystemError('EACCES');
    },
    syncEvidenceDirectory: async (_path, policy) => {
      observedPolicies.push(policy);
    },
  })).rejects.toMatchObject({ code: 'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED' });

  const recoveryRoot = await project();
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
  await lockApi.recoverEvidenceWriterLock(recoveryRoot, {
    hostname,
    processFingerprint: async () => fingerprint,
    processState: async () => 'dead',
    syncEvidenceDirectory: async (_path, policy) => {
      observedPolicies.push(policy);
    },
  });
  expect(observedPolicies).toEqual([
    'allow-unsupported',
    'allow-unsupported',
    'allow-unsupported',
    'strict',
  ]);

  const rollbackQualityRoot = await project();
  let rollbackQualitySyncs = 0;
  await expect(qualityApi.commitQualityRefresh(
    rollbackQualityRoot,
    { schemaVersion: 1, records: [] },
    { schemaVersion: 2, changes: [] },
    'temporary:0',
    { syncDirectory: async () => {
      rollbackQualitySyncs++;
      if (rollbackQualitySyncs === 2) {
        throw filesystemError('EACCES', 'quality injected rollback sync failed');
      }
    } },
  )).rejects.toThrow(
    /CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE.*quality injected rollback sync failed.*Owned paths:/,
  );
  expect(rollbackQualitySyncs).toBe(2);

  const rollbackMergeRoot = await project();
  const rollbackMergeParent = await mkdtemp(join(tmpdir(), 'musubix-directory-sync-rollback-merge-'));
  temporaryRoots.push(rollbackMergeParent);
  const rollbackMergeIncoming = join(rollbackMergeParent, 'incoming');
  await cp(rollbackMergeRoot, rollbackMergeIncoming, { recursive: true });
  let rollbackMergeSyncs = 0;
  await expect(mergeApi.mergeEvidenceHistories(rollbackMergeRoot, rollbackMergeIncoming, {
    faultAt: 'temporary:0',
    syncDirectory: async () => {
      rollbackMergeSyncs++;
      if (rollbackMergeSyncs === 2) {
        throw filesystemError('EACCES', 'merge injected rollback sync failed');
      }
    },
  })).rejects.toThrow(
    /EVIDENCE_MERGE_RECOVERY_UNSAFE.*merge injected rollback sync failed.*Merge-owned paths:/,
  );
  expect(rollbackMergeSyncs).toBe(2);

  const committedQualityRoot = await project();
  await expect(qualityApi.commitQualityRefresh(
    committedQualityRoot,
    { schemaVersion: 1, records: [] },
    { schemaVersion: 2, changes: [] },
    'cleanup',
  )).rejects.toThrow(/CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED/);
  await expect(readFile(
    join(committedQualityRoot, '.musubix/evidence/.quality-refresh-transaction.json'),
    'utf8',
  )).resolves.toContain('"state": "committed"');
  let committedQualitySyncs = 0;
  await expect(qualityApi.recoverQualityRefresh(committedQualityRoot, {
    syncDirectory: async () => {
      committedQualitySyncs++;
      throw filesystemError('EACCES', 'quality roll-forward sync failed');
    },
  })).rejects.toThrow(
    /CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE.*quality roll-forward sync failed.*Owned paths:/,
  );
  expect(committedQualitySyncs).toBe(1);

  const committedMergeRoot = await project();
  const committedMergeParent = await mkdtemp(join(tmpdir(), 'musubix-directory-sync-committed-merge-'));
  temporaryRoots.push(committedMergeParent);
  const committedMergeIncoming = join(committedMergeParent, 'incoming');
  await cp(committedMergeRoot, committedMergeIncoming, { recursive: true });
  await expect(mergeApi.mergeEvidenceHistories(committedMergeRoot, committedMergeIncoming, {
    faultAt: 'cleanup',
  })).rejects.toThrow(/EVIDENCE_MERGE_RECOVERY_REQUIRED/);
  await expect(readFile(
    join(committedMergeRoot, '.musubix/evidence/.merge-transaction.json'),
    'utf8',
  )).resolves.toContain('"state": "committed"');
  let committedMergeSyncs = 0;
  await expect(mergeApi.recoverEvidenceMerge(committedMergeRoot, {
    syncDirectory: async () => {
      committedMergeSyncs++;
      throw filesystemError('EACCES', 'merge roll-forward sync failed');
    },
  })).rejects.toThrow(
    /EVIDENCE_MERGE_RECOVERY_UNSAFE.*merge roll-forward sync failed.*Merge-owned paths:/,
  );
  expect(committedMergeSyncs).toBe(1);
});
