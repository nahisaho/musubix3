import { open } from 'node:fs/promises';

export type DirectorySyncPolicy = 'allow-unsupported' | 'strict';
export type EvidenceDirectorySyncPolicy = DirectorySyncPolicy;
export type DirectorySyncErrorClassification = 'unsupported' | 'actionable';

export interface DirectorySyncHandle {
  sync(): Promise<void>;
  close(): Promise<void>;
}

export type DirectoryOpen = (path: string, flags: 'r') => Promise<DirectorySyncHandle>;

const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_ERRORS = new Set(['EPERM', 'EINVAL', 'ENOTSUP']);

/** @id CODE-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 * @implements REQ-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 * @design DES-TRANSACTION-DIRECTORY-SYNC-POLICY-001
 */
export function classifyDirectorySyncError(
  cause: unknown,
  platform: NodeJS.Platform,
): DirectorySyncErrorClassification {
  if (!(cause instanceof Error) || !('code' in cause)) return 'actionable';
  const code = String((cause as NodeJS.ErrnoException).code);
  return platform === 'win32' && WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(code)
    ? 'unsupported'
    : 'actionable';
}

export async function synchronizeDirectory(
  path: string,
  policy: DirectorySyncPolicy,
  openDirectory: DirectoryOpen = (directory, flags) => open(directory, flags),
  platform: () => NodeJS.Platform = () => process.platform,
): Promise<void> {
  const handle = await openDirectory(path, 'r');
  try {
    try {
      await handle.sync();
    } catch (cause) {
      if (policy !== 'allow-unsupported'
        || classifyDirectorySyncError(cause, platform()) !== 'unsupported') {
        throw cause;
      }
    }
  } finally {
    await handle.close();
  }
}
