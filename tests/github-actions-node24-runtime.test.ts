import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

function migratedWorkflow(source: string, path: string): string {
  const withVersion = source.replaceAll('node-version: 22', 'node-version: 24');
  return path.endsWith('/ci.yml')
    ? withVersion.replace('Core (${{ matrix.os }}, Node 22)', 'Core (${{ matrix.os }}, Node 24)')
    : withVersion;
}

function gitBlobId(source: string): string {
  const bytes = Buffer.from(source);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

function withProjectNode24Fixture(run: (root: string) => void): void {
  // Retain reviewed pre-migration publishing bytes while exercising migrated workflow copies.
  const root = mkdtempSync(join(tmpdir(), 'musubix3-project-node24-'));
  try {
    for (const directory of [
      '.github/workflows',
      'tests/fixtures/github-actions-node24-runtime',
      'tests/fixtures/release-asset-publishing',
    ]) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/npm-publish.yml',
    ]) {
      writeFileSync(join(root, path), migratedWorkflow(readFileSync(path, 'utf8'), path));
    }
    writeFileSync(
      join(root, 'tests/fixtures/github-actions-node24-runtime/baseline.json'),
      readFileSync('tests/fixtures/github-actions-node24-runtime/baseline.json', 'utf8'),
    );
    for (const path of ['package.json', 'package-lock.json', 'vitest.config.ts']) {
      writeFileSync(join(root, path), readFileSync(path, 'utf8'));
    }
    const priorFixture = JSON.parse(
      readFileSync('tests/fixtures/release-asset-publishing/workflow-baseline.json', 'utf8'),
    ) as { workflows: Array<{ path: string; priorSource: string }> };
    const workflows = [
      ['.github/workflows/release.yml', 'a0013a4f5530c84f812242664523ea965dd67306', '30aaa213cf5ed8158e374f5e9b71ac8dd3a7eb1c0551d5e274b9e6f8b3183f6a'],
      ['.github/workflows/npm-publish.yml', 'ccb30e3b980a93fa9c323fb81944e5253257f2d7', '4ccb354eb54c11ac9e8bf9b7d7925aad95d78292f985cad5e57367108733e616'],
    ] as const;
    const publishingWorkflows = workflows.map(([path, priorBlobId, priorSourceSha256]) => {
      const priorSource = priorFixture.workflows.find((record) => record.path === path)!.priorSource;
      const currentSource = readFileSync(join(root, path), 'utf8');
      return {
        path,
        priorSource,
        priorSourceSha256,
        priorCommit: '46edcde9209cc2708c5d6669c98af9e55aa7c7cb',
        priorBlobId,
        sourceSha256: sha256(currentSource),
      };
    });
    writeFileSync(
      join(root, 'tests/fixtures/release-asset-publishing/workflow-baseline.json'),
      `${JSON.stringify({ schemaVersion: 1, approvedChange: 'CHANGE-0047', workflows: publishingWorkflows }, null, 2)}\n`,
    );
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runNpmAuditCheck(root: string): CheckReport {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/check-npm-audit-remediation.mjs', 'lock'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, NPM_AUDIT_REMEDIATION_ROOT: root },
      },
    );
    return JSON.parse(stdout) as CheckReport;
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : '';
    return JSON.parse(stdout) as CheckReport;
  }
}

function projectNode24Change(status = 'staged'): string {
  const completed = status === 'completed';
  return [
    '---',
    'schemaVersion: 1',
    'id: CHANGE-0047',
    `status: ${status}`,
    '---',
    completed
      ? '- Post-merge CI run: https://github.com/nahisaho/musubix3/actions/runs/123456'
      : '- Post-merge CI run: pending until the first merged CI execution.',
    `- Core ubuntu-latest conclusion: ${completed ? 'success' : 'pending.'}`,
    `- Core windows-latest conclusion: ${completed ? 'success' : 'pending.'}`,
    `- Core macos-latest conclusion: ${completed ? 'success' : 'pending.'}`,
    completed
      ? '- Deferred release evidence: https://github.com/nahisaho/musubix3/actions/runs/234567; Node.js 20 warning: absent'
      : '- Deferred release evidence: pending until the next natural release execution.',
    completed
      ? '- Deferred npm-publish evidence: https://github.com/nahisaho/musubix3/actions/runs/345678; Node.js 20 warning: absent'
      : '- Deferred npm-publish evidence: pending until the next natural publication.',
  ].join('\n');
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
    const projectEvidencePath = join(evidencePath, '..', 'CHANGE-0047.md');
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
      writeFileSync(projectEvidencePath, projectNode24Change());
      const evidenceEnv = {
        GITHUB_ACTIONS_CHANGE_PATH: evidencePath,
        GITHUB_ACTIONS_PROJECT_NODE24_CHANGE_PATH: projectEvidencePath,
      };
      expect(runCheck('evidence', evidenceEnv))
        .toEqual({ valid: true, diagnostics: [] });
      writeFileSync(evidencePath, 'Requirements approval was recorded\n');
      expect(runCheck('evidence', evidenceEnv).valid)
        .toBe(false);
    } finally {
      rmSync(join(evidencePath, '..'), { recursive: true, force: true });
    }
  });

  /** @id TEST-GITHUB-ACTIONS-PROJECT-NODE24-001
   * @verifies REQ-GITHUB-ACTIONS-PROJECT-NODE24-001
   */
  it('TEST-GITHUB-ACTIONS-PROJECT-NODE24-001 requires Node.js 24 across primary workflows', () => {
    withProjectNode24Fixture((root) => {
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }))
        .toEqual({ valid: true, diagnostics: [] });
      expect(runNpmAuditCheck(root)).toEqual({ valid: true, diagnostics: [] });
    });
  });

  /** @id TEST-GITHUB-ACTIONS-PROJECT-NODE24-002
   * @verifies REQ-GITHUB-ACTIONS-PROJECT-NODE24-002 REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002
   */
  it('TEST-GITHUB-ACTIONS-PROJECT-NODE24-002 binds prior publishing provenance to exact runtime-only changes', () => {
    withProjectNode24Fixture((root) => {
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }))
        .toEqual({ valid: true, diagnostics: [] });
      const fixturePath = join(root, 'tests/fixtures/release-asset-publishing/workflow-baseline.json');
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
        workflows: Array<{
          path: string;
          priorSource: string;
          priorBlobId: string;
          priorCommit: string;
          sourceSha256: string;
        }>;
      };
      expect(gitBlobId(fixture.workflows[0]!.priorSource)).toBe(fixture.workflows[0]!.priorBlobId);
      const originalFixture = JSON.stringify(fixture, null, 2);
      fixture.workflows[0]!.priorCommit = '0000000000000000000000000000000000000000';
      writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_REVIEWED_BASELINE' }));
      writeFileSync(fixturePath, `${originalFixture}\n`);
      const baselineRefreshFixture = JSON.parse(originalFixture) as typeof fixture;
      baselineRefreshFixture.workflows[0]!.priorSource = readFileSync(
        join(root, baselineRefreshFixture.workflows[0]!.path),
        'utf8',
      );
      writeFileSync(fixturePath, `${JSON.stringify(baselineRefreshFixture, null, 2)}\n`);
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_REVIEWED_BASELINE' }));
      writeFileSync(fixturePath, `${originalFixture}\n`);
      const releasePath = join(root, '.github/workflows/release.yml');
      const changedRelease = readFileSync(releasePath, 'utf8').replace(
        'permissions:\n      contents: read',
        'permissions:\n      contents: write',
      );
      writeFileSync(releasePath, changedRelease);
      const driftFixture = JSON.parse(originalFixture) as typeof fixture;
      driftFixture.workflows.find((record) => record.path.endsWith('/release.yml'))!.sourceSha256
        = sha256(changedRelease);
      writeFileSync(fixturePath, `${JSON.stringify(driftFixture, null, 2)}\n`);
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_PROTECTED_DRIFT' }));
      writeFileSync(releasePath, migratedWorkflow(readFileSync('.github/workflows/release.yml', 'utf8'), '.github/workflows/release.yml'));
      writeFileSync(fixturePath, `${originalFixture}\n`);
      const newlineFixture = JSON.parse(originalFixture) as typeof fixture;
      newlineFixture.workflows[0]!.priorSource = newlineFixture.workflows[0]!.priorSource.trimEnd();
      writeFileSync(fixturePath, `${JSON.stringify(newlineFixture, null, 2)}\n`);
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_REVIEWED_BASELINE' }));
    });
  });

  /** @id TEST-GITHUB-ACTIONS-PROJECT-NODE24-003
   * @verifies REQ-GITHUB-ACTIONS-PROJECT-NODE24-003
   */
  it('TEST-GITHUB-ACTIONS-PROJECT-NODE24-003 enforces exact bilingual documentation and evidence states', () => {
    const root = mkdtempSync(join(tmpdir(), 'musubix3-project-node24-docs-'));
    try {
      const english = readFileSync('README.md', 'utf8')
        .replace(
          '- Core CI covers Node 22 on Linux, Windows, and macOS, with additional Node 20\n  and Node 24 Linux compatibility checks.',
          '- Core CI covers Node 24 on Linux, Windows, and macOS, while the Linux compatibility matrix tests Node 20 and Node 24.',
        )
        .replace(
          "  controls. The actions' Node.js 24 implementation runtime is independent of\n  the Node.js 20/22/24 versions tested for this package.",
          "  controls.\n  The actions' Node.js 24 implementation runtime is independent of the Node.js 20/24 versions tested for this package.",
        )
        .replace(
          'skills, native manifests, built CLI/modules and assets. Core CI runs on Node 22\nacross Linux, Windows, and macOS, with additional Node 20 and Node 24 compatibility\nchecks on Linux.',
          'skills, native manifests, built CLI/modules and assets.\nCore CI runs on Node 24 across Linux, Windows, and macOS, while the Linux compatibility matrix tests Node 20 and Node 24.',
        );
      const japanese = readFileSync('README-ja.md', 'utf8')
        .replace(
          '- Core CIはNode 22をLinux、Windows、macOSで実行し、LinuxではNode 20と\n  Node 24の互換性も追加確認します。',
          '- Core CIはNode 24をLinux、Windows、macOSで実行し、LinuxではNode 20/24の互換性も検証します。',
        )
        .replace(
          '  publication control を再検証します。Action 自体の Node.js 24 runtime は、\n  package が検証する Node.js 20/22/24 とは別のものです。',
          '  publication control を再検証します。\n  Action 自体の Node.js 24 runtime は、package が検証する Node.js 20/24 とは別のものです。',
        )
        .replace(
          'CLI、モジュール、雛形が明示的に含まれます。Core CIはNode 22をLinux、Windows、\nmacOSで実行し、LinuxではNode 20/24の互換性も検証します。',
          'CLI、モジュール、雛形が明示的に含まれます。\nCore CIはNode 24をLinux、Windows、macOSで実行し、Linuxのcompatibility matrixではNode 20とNode 24を検証します。',
        );
      writeFileSync(join(root, 'README.md'), english);
      writeFileSync(join(root, 'README-ja.md'), japanese);
      const change21Path = join(root, 'CHANGE-0021.md');
      const change47Path = join(root, 'CHANGE-0047.md');
      writeFileSync(change21Path, [
        'Requirements approval was recorded',
        'Design approval was recorded',
        'real failing Red and passing Green',
        '601 passed/9 skipped tests',
        'Strict trace coverage is design 1.0, implementation 1.0, and tests 1.0',
        'changed quality gate passed all required non-approval checks',
        'Post-merge CI evidence: pending',
        'Deferred release/npm-publish evidence: pending',
      ].join('\n'));
      writeFileSync(change47Path, projectNode24Change());
      const env = {
        GITHUB_ACTIONS_PROJECT_NODE24_DOC_ROOT: root,
        GITHUB_ACTIONS_CHANGE_PATH: change21Path,
        GITHUB_ACTIONS_PROJECT_NODE24_CHANGE_PATH: change47Path,
      };
      expect(runCheck('runners', env)).toEqual({ valid: true, diagnostics: [] });
      expect(runCheck('evidence', env)).toEqual({ valid: true, diagnostics: [] });
      const documentationStatements = [
        ['README.md', english, '- Core CI covers Node 24 on Linux, Windows, and macOS, while the Linux compatibility matrix tests Node 20 and Node 24.'],
        ['README.md', english, "  The actions' Node.js 24 implementation runtime is independent of the Node.js 20/24 versions tested for this package."],
        ['README.md', english, 'Core CI runs on Node 24 across Linux, Windows, and macOS, while the Linux compatibility matrix tests Node 20 and Node 24.'],
        ['README-ja.md', japanese, '- Core CIはNode 24をLinux、Windows、macOSで実行し、LinuxではNode 20/24の互換性も検証します。'],
        ['README-ja.md', japanese, '  Action 自体の Node.js 24 runtime は、package が検証する Node.js 20/24 とは別のものです。'],
        ['README-ja.md', japanese, 'Core CIはNode 24をLinux、Windows、macOSで実行し、Linuxのcompatibility matrixではNode 20とNode 24を検証します。'],
      ] as const;
      for (const [path, source, statement] of documentationStatements) {
        writeFileSync(join(root, path), source.replace(statement, `${statement} drift`));
        expect(runCheck('runners', env).diagnostics)
          .toContainEqual(expect.objectContaining({
            code: 'PROJECT_NODE24_DOCUMENTATION',
            message: expect.stringContaining(statement),
          }));
        writeFileSync(join(root, path), source);
      }
      const completedEvidence = projectNode24Change('completed');
      writeFileSync(change47Path, completedEvidence);
      expect(runCheck('evidence', env)).toEqual({ valid: true, diagnostics: [] });
      writeFileSync(change47Path, completedEvidence.replace('/runs/123456', '/runs/not-a-number'));
      expect(runCheck('evidence', env).diagnostics)
        .toContainEqual(expect.objectContaining({
          code: 'CHANGE_PROJECT_NODE24_EVIDENCE',
          message: expect.stringContaining('Post-merge CI run:'),
        }));
      writeFileSync(change47Path, completedEvidence.replace(
        'Node.js 20 warning: absent',
        'Node.js 20 warning: present',
      ));
      expect(runCheck('evidence', env).diagnostics)
        .toContainEqual(expect.objectContaining({
          code: 'CHANGE_PROJECT_NODE24_EVIDENCE',
          message: expect.stringContaining('Deferred release evidence:'),
        }));
      expect(runCheck('evidence', {
        ...env,
        GITHUB_ACTIONS_PROJECT_NODE24_CHANGE_PATH: join(root, 'missing-CHANGE-0047.md'),
      }).diagnostics).toContainEqual(expect.objectContaining({
        code: 'CHANGE_PROJECT_NODE24_EVIDENCE',
        message: expect.stringContaining('missing'),
      }));
      writeFileSync(change47Path, completedEvidence.replace(
        '- Core ubuntu-latest conclusion: success',
        '- Core ubuntu-latest conclusion: failure',
      ));
      expect(runCheck('evidence', env).diagnostics)
        .toContainEqual(expect.objectContaining({
          code: 'CHANGE_PROJECT_NODE24_EVIDENCE',
          message: expect.stringContaining('Core ubuntu-latest conclusion:'),
        }));
      writeFileSync(
        change47Path,
        `${completedEvidence}\n- Post-merge CI run: https://github.com/nahisaho/musubix3/actions/runs/456789`,
      );
      expect(runCheck('evidence', env).diagnostics)
        .toContainEqual(expect.objectContaining({
          code: 'CHANGE_PROJECT_NODE24_EVIDENCE',
          message: expect.stringContaining('Post-merge CI run:'),
        }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  /** @id TEST-GITHUB-ACTIONS-PROJECT-NODE24-004
   * @verifies REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002
   */
  it('TEST-GITHUB-ACTIONS-PROJECT-NODE24-004 preserves non-runtime protected workflow values', () => {
    withProjectNode24Fixture((root) => {
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }))
        .toEqual({ valid: true, diagnostics: [] });
      const ciPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(ciPath, readFileSync(ciPath, 'utf8').replace(
        'permissions:\n  contents: read',
        'permissions:\n  contents: write',
      ));
      expect(runCheck('workflows', { GITHUB_ACTIONS_WORKFLOW_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'WORKFLOW_PROTECTED_DRIFT' }));
    });
  });

  /** @id TEST-GITHUB-ACTIONS-PROJECT-NODE24-005
   * @verifies REQ-NPM-AUDIT-REMEDIATION-002
   */
  it('TEST-GITHUB-ACTIONS-PROJECT-NODE24-005 reports only Node.js 20 and 24 as active CI lines', () => {
    withProjectNode24Fixture((root) => {
      expect(runNpmAuditCheck(root)).toEqual({ valid: true, diagnostics: [] });
      const lockPath = join(root, 'package-lock.json');
      const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
        packages: Record<string, { engines?: { node?: string } }>;
      };
      for (const [path, record] of Object.entries(lock.packages)) {
        if (path === 'node_modules/vitest' || path.endsWith('/node_modules/vitest')) {
          record.engines = { node: '>=24' };
        }
      }
      writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
      const engineReport = runNpmAuditCheck(root);
      expect(engineReport.diagnostics).toContainEqual(expect.objectContaining({
        code: 'LOCK_ENGINE',
        message: 'Resolved Vitest must support the active CI Node.js 20 and 24 lines.',
      }));
      const ciPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(ciPath, readFileSync(ciPath, 'utf8').replace(
        '          node-version: 24',
        '          node-version: 22',
      ));
      const report = runNpmAuditCheck(root);
      expect(report.diagnostics).toContainEqual(expect.objectContaining({
        code: 'CI_CONTRACT',
        message: 'Vitest CI Node.js lines or commands changed.',
      }));
    });
  });
});
