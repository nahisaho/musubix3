import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type CheckReport = {
  valid: boolean;
  diagnostics: Array<{
    code: string;
    message: string;
    path?: string;
  }>;
};

function runCheck(
  check: 'lock' | 'workflows' | 'runners' | 'evidence',
  env: NodeJS.ProcessEnv = {},
): CheckReport {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/check-github-actions.mjs', check],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...env } },
    );
    return JSON.parse(stdout) as CheckReport;
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : '';
    return JSON.parse(stdout) as CheckReport;
  }
}

function withWorkflowFixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'musubix3-actions-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/npm-publish.yml',
    ]) {
      writeFileSync(join(root, path), readFileSync(path, 'utf8'));
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('GitHub Actions Node.js 24 runtime', () => {
  /** @id TEST-GITHUB-ACTIONS-NODE24-RUNTIME-001
   * @verifies REQ-GITHUB-ACTIONS-NODE24-RUNTIME-001
   */
  it('TEST-GITHUB-ACTIONS-NODE24-RUNTIME-001 validates exhaustive reviewed Node.js 24 action metadata', () => {
    expect(runCheck('lock')).toEqual({ valid: true, diagnostics: [] });
    withWorkflowFixture((root) => {
      const ciPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(ciPath, readFileSync(ciPath, 'utf8').replace(
        'uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0',
        'uses: "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09" # v5.1.0',
      ));
      expect(runCheck('lock', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }))
        .toEqual({ valid: true, diagnostics: [] });
    });
  });

  /** @id TEST-GITHUB-ACTIONS-NODE24-RUNTIME-002
   * @verifies REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002
   */
  it('TEST-GITHUB-ACTIONS-NODE24-RUNTIME-002 preserves protected workflows and release artifact hand-offs', () => {
    expect(runCheck('workflows')).toEqual({ valid: true, diagnostics: [] });
    withWorkflowFixture((root) => {
      const ciPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(ciPath, readFileSync(ciPath, 'utf8').replace(
        'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0',
        'actions/checkout@v5',
      ));
      expect(runCheck('lock', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'ACTION_WORKFLOW_PIN' }));
      writeFileSync(ciPath, readFileSync(ciPath, 'utf8').replace(
        'actions/checkout@v5',
        'actions/checkout@v5 # v5.1.0 temporary',
      ));
      expect(runCheck('lock', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'ACTION_WORKFLOW_PIN' }));
    });
    withWorkflowFixture((root) => {
      const releasePath = join(root, '.github/workflows/release.yml');
      writeFileSync(releasePath, readFileSync(releasePath, 'utf8').replace(
        /^  validate:$/m,
        '  validate-renamed:',
      ));
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'RELEASE_ARTIFACT_CONTRACT' }));
    });
  });

  /** @id TEST-GITHUB-ACTIONS-NODE24-RUNTIME-003
   * @verifies REQ-GITHUB-ACTIONS-NODE24-RUNTIME-003
   */
  it('TEST-GITHUB-ACTIONS-NODE24-RUNTIME-003 enforces the documented floating hosted-runner policy', () => {
    expect(runCheck('runners')).toEqual({ valid: true, diagnostics: [] });
    expect(runCheck('evidence')).toEqual({ valid: true, diagnostics: [] });
    const evidencePath = join(mkdtempSync(join(tmpdir(), 'musubix3-evidence-')), 'CHANGE-0021.md');
    try {
      writeFileSync(evidencePath, [
        'Requirements approval was recorded',
        'Design approval was recorded',
        'real failing Red and passing Green',
        '601 passed/9 skipped tests',
        'Strict trace coverage is design 1.0, implementation 1.0, and tests 1.0',
        'changed quality gate passed all required non-approval checks',
        'Post-merge CI evidence: https://github.com/nahisaho/musubix3/actions/runs/123456.',
        'gh run view 123456 --log',
        'The following actions target Node.js 20',
        'Deferred release/npm-publish evidence: pending',
      ].join('\n'));
      expect(runCheck('evidence', { GITHUB_ACTIONS_CHANGE_PATH: evidencePath }))
        .toEqual({ valid: true, diagnostics: [] });
      writeFileSync(evidencePath, 'Requirements approval was recorded\n');
      expect(runCheck('evidence', { GITHUB_ACTIONS_CHANGE_PATH: evidencePath }).valid)
        .toBe(false);
    } finally {
      rmSync(join(evidencePath, '..'), { recursive: true, force: true });
    }
  });
});
