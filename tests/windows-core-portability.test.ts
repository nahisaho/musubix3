import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import * as evidenceMerge from '../packages/analysis/src/evidence-merge.js';
import * as qualityRefresh from '../packages/analysis/src/quality-refresh.js';
import * as helpers from './helpers.js';

/** @id TEST-WINDOWS-CORE-PORTABILITY-001
 * @verifies REQ-CHANGE-QUALITY-REFRESH-001 REQ-EVIDENCE-HISTORY-MERGE-004 REQ-EVIDENCE-WRITER-LOCK-003 REQ-EVIDENCE-WRITER-LOCK-004 REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002 REQ-NPM-AUDIT-REMEDIATION-001 REQ-RELEASE-APPROVAL-ORDERING-003
 */
it('TEST-WINDOWS-CORE-PORTABILITY-001 enforces portable transaction and checkout primitives', () => {
  expect(readFileSync('.gitattributes', 'utf8')).toBe('* text=auto eol=lf\n');
  expect(typeof (helpers as Record<string, unknown>).caseSafeEnvironment).toBe('function');
  expect(readFileSync('packages/analysis/src/quality-refresh.ts', 'utf8'))
    .toContain("async function fsyncFile(path: string)");
  expect(readFileSync('packages/analysis/src/evidence-merge.ts', 'utf8'))
    .toContain("async function fsyncFile(path: string)");
});

/** @id TEST-WINDOWS-CORE-PORTABILITY-002
 * @verifies REQ-CHANGE-QUALITY-REFRESH-002 REQ-EVIDENCE-HISTORY-MERGE-001 REQ-EVIDENCE-HISTORY-MERGE-002 REQ-EVIDENCE-HISTORY-MERGE-003 REQ-EVIDENCE-HISTORY-MERGE-005 REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-005 REQ-NPM-AUDIT-REMEDIATION-002 REQ-RELEASE-ASSET-PUBLISHING-004
 */
it('TEST-WINDOWS-CORE-PORTABILITY-002 shares native root identity and effective LF attributes', () => {
  expect(typeof (analysis as Record<string, unknown>).resolveEvidenceWriterCanonicalRoot)
    .toBe('function');
  const attributes = execFileSync(
    'git',
    ['check-attr', 'text', 'eol', '--',
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/npm-publish.yml',
      'package-lock.json'],
    { encoding: 'utf8', env: { ...process.env, GIT_ATTR_NOSYSTEM: '1' } },
  );
  expect(attributes).not.toContain('unspecified');
  expect(attributes.match(/: text: auto/g)).toHaveLength(4);
  expect(attributes.match(/: eol: lf/g)).toHaveLength(4);
});

/** @id TEST-WINDOWS-CORE-PORTABILITY-003
 * @verifies REQ-CHANGE-QUALITY-REFRESH-001
 */
it('TEST-WINDOWS-CORE-PORTABILITY-003 preserves unsupported directory-open handling in Quality refresh', async () => {
  const syncDirectory = (qualityRefresh as Record<string, unknown>).fsyncQualityRefreshDirectory;
  expect(typeof syncDirectory).toBe('function');
  await expect((syncDirectory as (
    path: string,
    openDirectory: (path: string, flags: string) => Promise<never>,
  ) => Promise<void>)('.', async () => {
    throw Object.assign(new Error('unsupported'), { code: 'EPERM' });
  })).resolves.toBeUndefined();
});

/** @id TEST-WINDOWS-CORE-PORTABILITY-004
 * @verifies REQ-EVIDENCE-HISTORY-MERGE-004
 */
it('TEST-WINDOWS-CORE-PORTABILITY-004 preserves unsupported directory-open handling in evidence merge', async () => {
  const syncDirectory = (evidenceMerge as Record<string, unknown>).fsyncEvidenceMergeDirectory;
  expect(typeof syncDirectory).toBe('function');
  await expect((syncDirectory as (
    path: string,
    openDirectory: (path: string, flags: string) => Promise<never>,
  ) => Promise<void>)('.', async () => {
    throw Object.assign(new Error('unsupported'), { code: 'EPERM' });
  })).resolves.toBeUndefined();
});
