import { link, mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { digest, exists, safePath } from './files.js';
import { evidenceJournals } from './evidence-merge-guard.js';
import { withEvidenceWriterLock } from './evidence-writer-lock.js';
import {
  synchronizeDirectory,
  type DirectoryOpen,
} from './filesystem-durability.js';
import { validateEvidenceOrderLog, type EvidenceOrderLog } from './order.js';
import {
  qualityIdentity,
  qualityLineage,
  type ChangeEvidence,
} from './change-evidence.js';

const EVIDENCE_DIR = '.musubix/evidence';
const ORDER_PATH = `${EVIDENCE_DIR}/order.json`;
const CHANGES_PATH = `${EVIDENCE_DIR}/changes.json`;
const JOURNAL_PATH = `${EVIDENCE_DIR}/.quality-refresh-transaction.json`;
const STAGING_PREFIX = `${EVIDENCE_DIR}/.quality-refresh-transaction.`;
const TARGETS = [ORDER_PATH, CHANGES_PATH] as const;
type TargetPath = typeof TARGETS[number];

interface JournalTarget {
  path: TargetPath;
  existed: boolean;
  originalBase64: string;
  originalSha256: string;
  candidateBase64: string;
  candidateSha256: string;
  temporaryPath: string;
}

interface QualityRefreshJournal {
  schemaVersion: 1;
  kind: 'quality-refresh';
  transactionId: string;
  state: 'prepared' | 'committed';
  targets: JournalTarget[];
}

export interface QualityRefreshRecoveryReport {
  recovered: boolean;
  action: 'nothing-to-recover' | 'rolled-back' | 'rolled-forward';
}

export interface QualityRefreshDirectorySyncDependencies {
  syncDirectory?: (path: string) => Promise<void>;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function fsyncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @id CODE-TRANSACTION-DIRECTORY-SYNC-POLICY-002
 * @implements REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 * @design DES-TRANSACTION-DIRECTORY-SYNC-POLICY-002 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-006
 */
export async function fsyncQualityRefreshDirectory(
  path: string,
  openDirectory?: DirectoryOpen,
  platform?: () => NodeJS.Platform,
): Promise<void> {
  await synchronizeDirectory(path, 'allow-unsupported', openDirectory, platform);
}

async function removeIfPresent(path: string): Promise<void> {
  await rm(path, { force: true });
}

async function originalBytes(root: string, path: TargetPath): Promise<{ existed: boolean; bytes: string }> {
  const absolute = await safePath(root, path);
  try {
    return { existed: true, bytes: await readFile(absolute, 'utf8') };
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { existed: false, bytes: '' };
    throw cause;
  }
}

async function restoreJournal(
  root: string,
  journal: QualityRefreshJournal,
  syncDirectory: (path: string) => Promise<void> = fsyncQualityRefreshDirectory,
): Promise<void> {
  const evidenceDirectory = await safePath(root, EVIDENCE_DIR);
  for (const target of journal.targets) {
    const absolute = await safePath(root, target.path);
    if (target.existed) {
      const staging = `${absolute}.${journal.transactionId}.restore`;
      await writeFile(staging, Buffer.from(target.originalBase64, 'base64'));
      await fsyncFile(staging);
      await rename(staging, absolute);
    } else {
      await removeIfPresent(absolute);
    }
    await removeIfPresent(await safePath(root, target.temporaryPath));
  }
  await syncDirectory(evidenceDirectory);
  await removeIfPresent(await safePath(root, JOURNAL_PATH));
  await syncDirectory(evidenceDirectory);
}

function validateCandidate(order: EvidenceOrderLog, changes: ChangeEvidence): void {
  if (!validateEvidenceOrderLog(order).valid || changes.schemaVersion !== 2 || !Array.isArray(changes.changes)) {
    throw new Error('candidate evidence is structurally invalid');
  }
  for (const change of changes.changes) {
    if (change.qualityHistory !== undefined
      && (!Array.isArray(change.qualityHistory) || change.qualityHistory.length === 0)) {
      throw new Error(`${change.changeId} has malformed Quality history`);
    }
    const lineage = qualityLineage(change);
    if (!lineage.length) continue;
    const identities = new Set<string>();
    for (const [index, checkpoint] of lineage.entries()) {
      const identity = qualityIdentity(index + 1);
      identities.add(identity);
      if (checkpoint.phase !== 'quality' || typeof checkpoint.recordedAt !== 'string'
        || !checkpoint.fingerprints || !Number.isInteger(checkpoint.order)) {
        throw new Error(`${change.changeId}:${identity} is malformed`);
      }
      const matches = order.records.filter((record) =>
        record.kind === 'change' && record.entityId === change.changeId
        && record.phase === identity && record.sequence === checkpoint.order);
      if (matches.length !== 1) throw new Error(`${change.changeId}:${identity} is not paired`);
    }
    if (order.records.some((record) =>
      record.kind === 'change' && record.entityId === change.changeId
      && /^quality(?::\d+)?$/.test(record.phase) && !identities.has(record.phase))) {
      throw new Error(`${change.changeId} has an orphan Quality order identity`);
    }
  }
}

function validateJournal(journal: QualityRefreshJournal): void {
  if (journal.schemaVersion !== 1 || journal.kind !== 'quality-refresh'
    || typeof journal.transactionId !== 'string' || !journal.transactionId
    || !['prepared', 'committed'].includes(journal.state) || !Array.isArray(journal.targets)) {
    throw new Error('published Quality-refresh journal is invalid');
  }
  const paths = new Set<TargetPath>();
  for (const target of journal.targets) {
    if (!TARGETS.includes(target.path) || paths.has(target.path)
      || typeof target.existed !== 'boolean'
      || typeof target.originalBase64 !== 'string' || typeof target.originalSha256 !== 'string'
      || typeof target.candidateBase64 !== 'string' || typeof target.candidateSha256 !== 'string'
      || typeof target.temporaryPath !== 'string'
      || !target.temporaryPath.startsWith(`${target.path}.${journal.transactionId}.`)
      || digest(Buffer.from(target.originalBase64, 'base64')) !== target.originalSha256
      || digest(Buffer.from(target.candidateBase64, 'base64')) !== target.candidateSha256) {
      throw new Error('published Quality-refresh journal target is invalid');
    }
    paths.add(target.path);
  }
  if (paths.size !== TARGETS.length || TARGETS.some((path) => !paths.has(path))) {
    throw new Error('published Quality-refresh journal target inventory is incomplete');
  }
}

function unsafe(reason: string): Error {
  return new Error(`CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE: ${reason}`);
}

function unsafeRecovery(reason: string, inventory: string[]): Error {
  return new Error(
    `CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE: ${reason} Journal: ${JOURNAL_PATH}. `
    + `Owned paths: ${inventory.length ? inventory.join(', ') : 'none identified'}. `
    + 'Manual remediation: back up .musubix/evidence; restore or verify order.json and changes.json '
    + 'from a trusted source; quarantine the listed Quality-refresh paths; rerun structural validation.',
  );
}

function journalInventory(journal: QualityRefreshJournal, staging: string[] = []): string[] {
  return [
    JOURNAL_PATH,
    ...staging.map((entry) => `${EVIDENCE_DIR}/${entry}`),
    ...journal.targets.map((target) => target.temporaryPath),
  ];
}

function recoveryDirectorySync(
  syncDirectory: (path: string) => Promise<void>,
  inventory: string[],
): (path: string) => Promise<void> {
  return async (path) => {
    try {
      await syncDirectory(path);
    } catch (cause) {
      throw unsafeRecovery(cause instanceof Error ? cause.message : String(cause), inventory);
    }
  };
}

/** @id CODE-CHANGE-QUALITY-REFRESH-002
 * @implements REQ-CHANGE-QUALITY-REFRESH-001 REQ-CHANGE-QUALITY-REFRESH-003 REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 * @design DES-CHANGE-QUALITY-REFRESH-002 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-002 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-003
 */
export async function commitQualityRefresh(
  root: string,
  order: EvidenceOrderLog,
  changes: ChangeEvidence,
  faultAt?: string,
  dependencies: QualityRefreshDirectorySyncDependencies = {},
): Promise<void> {
  const syncDirectory = dependencies.syncDirectory ?? fsyncQualityRefreshDirectory;
  const journals = await evidenceJournals(root);
  if (journals.merge) throw new Error('EVIDENCE_MERGE_RECOVERY_REQUIRED: run evidence merge --recover.');
  if (journals.qualityRefresh) {
    throw new Error('CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED: run change quality-recover.');
  }
  validateCandidate(order, changes);
  const transactionId = crypto.randomUUID();
  const candidateBytes: Record<TargetPath, string> = {
    [ORDER_PATH]: json(order),
    [CHANGES_PATH]: json(changes),
  };
  const targets: JournalTarget[] = [];
  for (const path of TARGETS) {
    const original = await originalBytes(root, path);
    const candidate = candidateBytes[path];
    targets.push({
      path,
      existed: original.existed,
      originalBase64: Buffer.from(original.bytes).toString('base64'),
      originalSha256: digest(original.bytes),
      candidateBase64: Buffer.from(candidate).toString('base64'),
      candidateSha256: digest(candidate),
      temporaryPath: `${path}.${transactionId}.quality-refresh`,
    });
  }
  const journal: QualityRefreshJournal = {
    schemaVersion: 1,
    kind: 'quality-refresh',
    transactionId,
    state: 'prepared',
    targets,
  };
  const journalAbsolute = await safePath(root, JOURNAL_PATH);
  const stagingJournal = await safePath(root, `${STAGING_PREFIX}${transactionId}.json`);
  await mkdir(dirname(journalAbsolute), { recursive: true });
  if (faultAt === 'journal:staging') throw new Error('Injected Quality refresh failure at journal:staging.');
  await writeFile(stagingJournal, json(journal), { flag: 'wx' });
  await fsyncFile(stagingJournal);
  if (faultAt === 'journal:publication') {
    throw new Error('CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED: injected failure at journal:publication.');
  }
  try {
    await link(stagingJournal, journalAbsolute);
    await unlink(stagingJournal);
  } catch (cause) {
    await removeIfPresent(stagingJournal);
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED: another Quality refresh was published.');
    }
    throw cause;
  }
  try {
    await syncDirectory(dirname(journalAbsolute));
    for (let index = 0; index < targets.length; index++) {
      if (faultAt === `temporary:${index}`) throw new Error(`Injected Quality refresh failure at temporary:${index}.`);
      const target = targets[index]!;
      const temporary = await safePath(root, target.temporaryPath);
      await writeFile(temporary, Buffer.from(target.candidateBase64, 'base64'), { flag: 'wx' });
      await fsyncFile(temporary);
    }
    for (let index = 0; index < targets.length; index++) {
      if (faultAt === `replace:${index}`) throw new Error(`Injected Quality refresh failure at replace:${index}.`);
      const target = targets[index]!;
      await rename(await safePath(root, target.temporaryPath), await safePath(root, target.path));
    }
    await syncDirectory(dirname(journalAbsolute));
    journal.state = 'committed';
    const commitStaging = await safePath(root, `${STAGING_PREFIX}${transactionId}.commit.json`);
    await writeFile(commitStaging, json(journal), { flag: 'wx' });
    await fsyncFile(commitStaging);
    if (faultAt === 'commit-marker') throw new Error('Injected Quality refresh failure at commit-marker.');
    await rename(commitStaging, journalAbsolute);
    await syncDirectory(dirname(journalAbsolute));
    if (faultAt === 'cleanup') {
      throw new Error('CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED: injected failure at cleanup.');
    }
    await removeIfPresent(journalAbsolute);
  } catch (cause) {
    const injected = cause instanceof Error && cause.message.startsWith('Injected Quality refresh failure');
    if (injected && journal.state === 'prepared') {
      await restoreJournal(root, journal, recoveryDirectorySync(
        syncDirectory,
        journalInventory(journal),
      ));
      throw cause;
    }
    throw new Error(`CHANGE_QUALITY_REFRESH_RECOVERY_REQUIRED: ${
      cause instanceof Error ? cause.message : String(cause)
    }`);
  }
}

/** @id CODE-CHANGE-QUALITY-REFRESH-003
 * @implements REQ-CHANGE-QUALITY-REFRESH-003 REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 * @design DES-CHANGE-QUALITY-REFRESH-002 DES-TRANSACTION-DIRECTORY-SYNC-POLICY-003
 */
export async function recoverQualityRefresh(
  root: string,
  dependencies: QualityRefreshDirectorySyncDependencies = {},
): Promise<QualityRefreshRecoveryReport> {
  return withEvidenceWriterLock(root, 'change quality-recover', async () => {
    const syncDirectory = dependencies.syncDirectory ?? fsyncQualityRefreshDirectory;
    const journals = await evidenceJournals(root);
    if (journals.merge && journals.qualityRefresh) throw unsafe('merge and Quality-refresh journals coexist.');
    if (journals.merge) throw new Error('EVIDENCE_MERGE_RECOVERY_REQUIRED: run evidence merge --recover.');
    const journalAbsolute = await safePath(root, JOURNAL_PATH);
    const evidenceDir = await safePath(root, EVIDENCE_DIR);
    let staging: string[] = [];
    try {
      staging = (await readdir(evidenceDir))
        .filter((entry) => entry.startsWith('.quality-refresh-transaction.')
          && entry !== '.quality-refresh-transaction.json');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
    if (!await exists(journalAbsolute)) {
      for (const entry of staging) await removeIfPresent(resolve(evidenceDir, entry));
      return { recovered: false, action: 'nothing-to-recover' };
    }
    let journal: QualityRefreshJournal;
    try {
      journal = JSON.parse(await readFile(journalAbsolute, 'utf8')) as QualityRefreshJournal;
      validateJournal(journal);
    } catch (cause) {
      throw unsafe(cause instanceof Error ? cause.message : String(cause));
    }
    const inventory = journalInventory(journal, staging);
    const syncRecoveryDirectory = recoveryDirectorySync(syncDirectory, inventory);
    if (journal.state === 'prepared') {
      await restoreJournal(root, journal, syncRecoveryDirectory);
      for (const entry of staging) await removeIfPresent(resolve(evidenceDir, entry));
      return { recovered: true, action: 'rolled-back' };
    }
    try {
      const values = new Map(journal.targets.map((target) => [
        target.path,
        JSON.parse(Buffer.from(target.candidateBase64, 'base64').toString('utf8')) as unknown,
      ]));
      validateCandidate(values.get(ORDER_PATH) as EvidenceOrderLog, values.get(CHANGES_PATH) as ChangeEvidence);
      for (const target of journal.targets) {
        const absolute = await safePath(root, target.path);
        let actual = '';
        try {
          actual = await readFile(absolute, 'utf8');
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
        }
        const actualDigest = digest(actual);
        if (actualDigest !== target.originalSha256 && actualDigest !== target.candidateSha256) {
          throw unsafe(`${target.path} differs from both journaled original and candidate.`);
        }
        if (actualDigest !== target.candidateSha256) {
          const recovery = `${absolute}.${journal.transactionId}.recover`;
          await writeFile(recovery, Buffer.from(target.candidateBase64, 'base64'));
          await fsyncFile(recovery);
          await rename(recovery, absolute);
        }
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('CHANGE_QUALITY_REFRESH_RECOVERY_UNSAFE')) throw cause;
      throw unsafe(cause instanceof Error ? cause.message : String(cause));
    }
    await syncRecoveryDirectory(evidenceDir);
    await removeIfPresent(journalAbsolute);
    for (const entry of staging) await removeIfPresent(resolve(evidenceDir, entry));
    await syncRecoveryDirectory(evidenceDir);
    return { recovered: true, action: 'rolled-forward' };
  });
}
