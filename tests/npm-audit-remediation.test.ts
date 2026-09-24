import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
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
  check: 'evidence' | 'lock' | 'policy',
  env: NodeJS.ProcessEnv = {},
): CheckReport {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/check-npm-audit-remediation.mjs', check],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...env } },
    );
    return JSON.parse(stdout) as CheckReport;
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : '';
    if (stdout) return JSON.parse(stdout) as CheckReport;
    return {
      valid: false,
      diagnostics: [{ code: 'CHECK_EXECUTION', message: 'Checker did not return JSON.' }],
    };
  }
}

function runGateCommandTimeoutMarginCheck(): CheckReport {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/check-gate-command-timeout-margin.mjs'],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    return JSON.parse(stdout) as CheckReport;
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : '';
    if (stdout) return JSON.parse(stdout) as CheckReport;
    return {
      valid: false,
      diagnostics: [{ code: 'CHECK_EXECUTION', message: 'Checker did not return JSON.' }],
    };
  }
}

function withFixture(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'musubix3-audit-'));
  try {
    for (const path of [
      'package.json',
      'package-lock.json',
      'vitest.config.ts',
      'README.md',
      'README-ja.md',
      '.github/workflows/ci.yml',
      '.github/workflows/dependency-audit.yml',
    ]) {
      if (!existsSync(path)) continue;
      const target = join(root, path);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, readFileSync(path, 'utf8'));
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function expectLockDiagnostic(
  mutate: (root: string, packageJson: Record<string, unknown>, lock: Record<string, unknown>) => void,
  code: string,
): void {
  withFixture((root) => {
    const packagePath = join(root, 'package.json');
    const lockPath = join(root, 'package-lock.json');
    const packageJson = readJson(packagePath);
    const lock = readJson(lockPath);
    mutate(root, packageJson, lock);
    writeJson(packagePath, packageJson);
    writeJson(lockPath, lock);
    expect(runCheck('lock', { NPM_AUDIT_REMEDIATION_ROOT: root }).diagnostics)
      .toContainEqual(expect.objectContaining({ code }));
  });
}

function expectEvidenceDiagnostic(mutate: (change: string) => string): void {
  const directory = mkdtempSync(join(tmpdir(), 'musubix3-audit-evidence-'));
  const path = join(directory, 'CHANGE-0022.md');
  try {
    writeFileSync(path, mutate(readFileSync('.musubix/changes/CHANGE-0022.md', 'utf8')));
    expect(runCheck('evidence', { NPM_AUDIT_REMEDIATION_CHANGE_PATH: path }).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'AUDIT_EVIDENCE' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('npm audit remediation', () => {
  /** @id TEST-GATE-COMMAND-TIMEOUT-MARGIN-001
   * @verifies REQ-GATE-COMMAND-TIMEOUT-MARGIN-001
   */
  it('TEST-GATE-COMMAND-TIMEOUT-MARGIN-001 preserves full-test policy with the rebaselined 305-second timeout margin', () => {
    const config = readJson('.musubix/config.json');
    const commands = config.commands as Array<{ name?: string; timeoutMs?: number }>;
    expect(commands.find((command) => command.name === 'test')?.timeoutMs).toBe(305000);
    expect(runGateCommandTimeoutMarginCheck()).toEqual({ valid: true, diagnostics: [] });
  });

  /** @id TEST-NPM-AUDIT-REMEDIATION-001
   * @verifies REQ-NPM-AUDIT-REMEDIATION-001
   */
  it('TEST-NPM-AUDIT-REMEDIATION-001 records the reviewed advisory and reachability evidence', () => {
    expect(runCheck('evidence')).toEqual({ valid: true, diagnostics: [] });
    expectEvidenceDiagnostic((change) => change.replace('GHSA-82fw-gwwq-j7x9', 'missing-advisory'));
    expectEvidenceDiagnostic((change) => change.replace(
      'does not configure browser mode',
      'may configure browser mode',
    ));
    expectEvidenceDiagnostic((change) => change.replace('no fixed 3.x release', '3.x status unknown'));
    expectEvidenceDiagnostic((change) => change.replace(
      'moderate-or-higher findings: 0',
      'moderate-or-higher findings: 1',
    ));
    for (const severity of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
      expectEvidenceDiagnostic((change) => change.replace(
        `${severity} 0`,
        `${severity} 1`,
      ));
    }
    expectEvidenceDiagnostic((change) => `${change}
Audit result: info 1, low 0, moderate 0, high 0, critical 0, total 1.
`);
    expectEvidenceDiagnostic((change) => change.replace(
      /Audit captured at: [^.]+\./,
      'Audit captured at: unknown.',
    ));
    expectEvidenceDiagnostic((change) => change.replace(
      /Audit captured at: [^.]+\./,
      'Audit captured at: 2999-01-01T00:00:00Z.',
    ));
    expectEvidenceDiagnostic((change) => change.replace(
      /Audited package-lock SHA-256:\s+`[a-f0-9]{64}`/,
      'Audited package-lock SHA-256: `invalid`',
    ));
    const directory = mkdtempSync(join(tmpdir(), 'musubix3-audit-evidence-count-'));
    const path = join(directory, 'CHANGE-0022.md');
    try {
      writeFileSync(
        path,
        readFileSync('.musubix/changes/CHANGE-0022.md', 'utf8')
          .replace(/Audit captured at: [^.]+\./, 'Audit captured at: unknown.'),
      );
      expect(runCheck('evidence', {
        NPM_AUDIT_REMEDIATION_CHANGE_PATH: path,
      }).diagnostics.filter((item) => item.message.includes('timestamp'))).toHaveLength(1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  /** @id TEST-NPM-AUDIT-REMEDIATION-002
   * @verifies REQ-NPM-AUDIT-REMEDIATION-002
   */
  it('TEST-NPM-AUDIT-REMEDIATION-002 resolves every Vitest tooling path outside the advisory range', () => {
    expect(runCheck('lock')).toEqual({ valid: true, diagnostics: [] });
    expectLockDiagnostic((_root, _packageJson, lock) => {
      lock.lockfileVersion = 2;
    }, 'LOCK_SCHEMA');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      lock.packages = [];
    }, 'LOCK_SCHEMA');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      lock.dependencies = {};
    }, 'LOCK_LEGACY');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, unknown>;
      delete packages['node_modules/vitest'];
      delete packages['node_modules/@vitest/mocker'];
    }, 'LOCK_MISSING');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, unknown>;
      delete packages['node_modules/vite'];
    }, 'LOCK_MISSING');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, unknown>;
      packages['node_modules/example/node_modules/vitest'] = { version: '3.2.7', dev: true };
    }, 'LOCK_VULNERABLE');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/vitest']!.dev = false;
    }, 'LOCK_DEV');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/vitest']!.version = '4.1.11-beta.1';
    }, 'LOCK_VERSION');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/vitest']!.version = '5.0.0';
    }, 'LOCK_VERSION');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/vitest']!.engines = { node: '>=24' };
    }, 'LOCK_ENGINE');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/vite']!.engines = { node: '>=22.12.0' };
    }, 'VITE_ENGINE');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/vite']!.version = '9.0.0-beta.1';
    }, 'LOCK_VERSION');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/@vitest/mocker']!.version = '4.2.0';
    }, 'LOCK_VERSION');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      const devDependencies = packages['']!.devDependencies as Record<string, string>;
      devDependencies['@vitest/mocker'] = '^4.1.11';
    }, 'MANIFEST_CONTRACT');
    expectLockDiagnostic((_root, packageJson, lock) => {
      const packageDevDependencies = packageJson.devDependencies as Record<string, string>;
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      const lockDevDependencies = packages['']!.devDependencies as Record<string, string>;
      packageDevDependencies['@vitest/mocker'] = '^4.1.11';
      lockDevDependencies['@vitest/mocker'] = '^4.1.11';
    }, 'MANIFEST_CONTRACT');
  });

  /** @id TEST-NPM-AUDIT-REMEDIATION-003
   * @verifies REQ-NPM-AUDIT-REMEDIATION-003
   */
  it('TEST-NPM-AUDIT-REMEDIATION-003 preserves test configuration and CI execution contracts', () => {
    expect(runCheck('lock')).toEqual({ valid: true, diagnostics: [] });
    expect(() => execFileSync(
      process.execPath,
      ['./node_modules/vitest/vitest.mjs', 'run', 'tests/p3-codegraph-policy.test.ts', '--reporter=dot'],
      { cwd: process.cwd(), encoding: 'utf8' },
    )).not.toThrow();
    expectLockDiagnostic((root) => {
      const workflowPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(workflowPath, readFileSync(workflowPath, 'utf8').replace(
        'node-version: 22',
        'node-version: 18',
      ));
    }, 'CI_CONTRACT');
    expectLockDiagnostic((root) => {
      const workflowPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(workflowPath, readFileSync(workflowPath, 'utf8').replace(
        '          node-version: 22',
        [
          '          node-version: 22',
          '      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444',
          '        with:',
          '          node-version: 18',
        ].join('\n'),
      ));
    }, 'CI_CONTRACT');
    expectLockDiagnostic((root) => {
      const workflowPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(workflowPath, readFileSync(workflowPath, 'utf8').replace(
        '      - run: npm test',
        '      - run: npm test\n      - run: npm test',
      ));
    }, 'CI_CONTRACT');
    expectLockDiagnostic((root) => {
      const workflowPath = join(root, '.github/workflows/ci.yml');
      writeFileSync(workflowPath, readFileSync(workflowPath, 'utf8').replace(
        '  core-portability:',
        '  core-portability:\n    continue-on-error: true',
      ));
    }, 'CI_CONTRACT');
    expectLockDiagnostic((_root, packageJson) => {
      const devDependencies = packageJson.devDependencies as Record<string, string>;
      devDependencies.vitest = '^5.0.0';
    }, 'MANIFEST_CONTRACT');
    expectLockDiagnostic((_root, packageJson) => {
      const scripts = packageJson.scripts as Record<string, string>;
      scripts['audit:report'] = 'npm audit --omit=dev --json';
    }, 'CONFIG_CONTRACT');
    expectLockDiagnostic((_root, _packageJson, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['']!.dependencies = { commander: '^99.0.0' };
    }, 'MANIFEST_CONTRACT');
    expectLockDiagnostic((root) => {
      const configPath = join(root, 'vitest.config.ts');
      writeFileSync(configPath, readFileSync(configPath, 'utf8').replace(
        'maxWorkers: 2',
        'maxWorkers: 3',
      ));
    }, 'CONFIG_CONTRACT');
    expectLockDiagnostic((root) => {
      const configPath = join(root, 'vitest.config.ts');
      writeFileSync(configPath, `${readFileSync(configPath, 'utf8')}\n// poolOptions\n`);
    }, 'CONFIG_REMOVED');
  });

  /** @id TEST-NPM-AUDIT-REMEDIATION-004
   * @verifies REQ-NPM-AUDIT-REMEDIATION-004
   */
  it('TEST-NPM-AUDIT-REMEDIATION-004 documents the dependency-audit monitoring policy', () => {
    expect(runCheck('policy')).toEqual({ valid: true, diagnostics: [] });
    expect(readFileSync('README.md', 'utf8')).toContain('npm run audit:report');
    expect(readFileSync('README-ja.md', 'utf8')).toContain('npm run audit:report');
    expect(readFileSync('README.md', 'utf8')).toContain('.github/workflows/dependency-audit.yml');
    expect(readFileSync('README-ja.md', 'utf8')).toContain('.github/workflows/dependency-audit.yml');
    const workflow = readFileSync('.github/workflows/dependency-audit.yml', 'utf8');
    expect(workflow).toContain('schedule:');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('npm run audit:report');
    for (const path of ['README.md', 'README-ja.md']) {
      withFixture((root) => {
        writeFileSync(join(root, path), '# incomplete\n');
        expect(runCheck('policy', { NPM_AUDIT_REMEDIATION_ROOT: root }).diagnostics)
          .toContainEqual(expect.objectContaining({ code: 'AUDIT_POLICY', path }));
      });
    }
    withFixture((root) => {
      writeFileSync(
        join(root, 'README.md'),
        readFileSync(join(root, 'README.md'), 'utf8').replace('time-bound', 'current'),
      );
      expect(runCheck('policy', { NPM_AUDIT_REMEDIATION_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'AUDIT_POLICY', path: 'README.md' }));
    });
    withFixture((root) => {
      writeFileSync(
        join(root, 'README-ja.md'),
        readFileSync(join(root, 'README-ja.md'), 'utf8').replace('その時点の証拠', '現在の証拠'),
      );
      expect(runCheck('policy', { NPM_AUDIT_REMEDIATION_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({ code: 'AUDIT_POLICY', path: 'README-ja.md' }));
    });
    withFixture((root) => {
      const path = join(root, '.github/workflows/dependency-audit.yml');
      writeFileSync(path, readFileSync(path, 'utf8').replace(
        'npm run audit:report',
        'npm audit --omit=dev --json',
      ));
      expect(runCheck('policy', { NPM_AUDIT_REMEDIATION_ROOT: root }).diagnostics)
        .toContainEqual(expect.objectContaining({
          code: 'AUDIT_POLICY',
          path: '.github/workflows/dependency-audit.yml',
        }));
    });
    const workflowMutations: ReadonlyArray<readonly [string, string]> = [
      ['  schedule:', '  disabled_schedule:'],
      ['  workflow_dispatch:', '  disabled_dispatch:'],
      ["    - cron: '23 4 * * 1'", "    - cron: 'not-a-cron'"],
      [
        'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09',
        'actions/checkout@v5',
      ],
      [
        'actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444',
        'actions/setup-node@v5',
      ],
      ['          node-version: 24', '          node-version: 22'],
      ['  audit:', '  audit:\n    continue-on-error: true'],
    ];
    for (const [from, to] of workflowMutations) {
      withFixture((root) => {
        const path = join(root, '.github/workflows/dependency-audit.yml');
        writeFileSync(path, readFileSync(path, 'utf8').replace(from, to));
        expect(runCheck('policy', { NPM_AUDIT_REMEDIATION_ROOT: root }).diagnostics)
          .toContainEqual(expect.objectContaining({
            code: 'AUDIT_POLICY',
            path: '.github/workflows/dependency-audit.yml',
          }));
      });
    }
  });
});
