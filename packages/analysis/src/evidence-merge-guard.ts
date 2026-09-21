import { lstat, readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

const JOURNAL_PATH = '.musubix/evidence/.merge-transaction.json';
const EVIDENCE_DIR = '.musubix/evidence';

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

export async function assertEvidenceMergeReady(root: string): Promise<void> {
  if (await pathExists(resolve(root, JOURNAL_PATH))) {
    throw new Error('EVIDENCE_MERGE_RECOVERY_REQUIRED: run evidence merge --recover.');
  }
}

export async function assertEvidenceMergeStartable(root: string): Promise<void> {
  await assertEvidenceMergeReady(root);
  try {
    const entries = await readdir(resolve(root, EVIDENCE_DIR));
    if (entries.some((entry) => entry.startsWith('.merge-transaction.') && entry !== '.merge-transaction.json')) {
      throw new Error('EVIDENCE_MERGE_RECOVERY_REQUIRED: unpublished merge staging exists.');
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
  }
}

export async function assertEvidencePathReady(root: string, path: string): Promise<void> {
  const rel = relative(resolve(root), resolve(root, path)).split(sep).join('/');
  if (rel === EVIDENCE_DIR || rel.startsWith(`${EVIDENCE_DIR}/`)) {
    await assertEvidenceMergeReady(root);
  }
}

export async function assertAbsoluteEvidencePathReady(path: string): Promise<void> {
  const absolute = resolve(path);
  const marker = `${sep}.musubix${sep}evidence`;
  const index = absolute.indexOf(marker);
  if (index !== -1) await assertEvidenceMergeReady(absolute.slice(0, index));
}
