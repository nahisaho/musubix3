import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
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
  const root = fixtureDirectory('audit-');
  try {
    for (const path of [
      'package.json',
      'package-lock.json',
      'vitest.config.ts',
      'README.md',
      'README-ja.md',
      '.github/workflows/ci.yml',
      '.github/workflows/dependency-audit.yml',
      '.musubix/changes/CHANGE-0022.md',
      '.musubix/changes/CHANGE-0052.md',
      '.musubix/evidence/npm-audit/CHANGE-0052.json',
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

function fixtureDirectory(prefix: string): string {
  const base = resolve('.test-work');
  mkdirSync(base, { recursive: true });
  return mkdtempSync(join(base, prefix));
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
  const directory = fixtureDirectory('audit-evidence-');
  const path = join(directory, 'CHANGE-0022.md');
  try {
    writeFileSync(path, mutate(readFileSync('.musubix/changes/CHANGE-0022.md', 'utf8')));
    expect(runCheck('evidence', { NPM_AUDIT_REMEDIATION_CHANGE_PATH: path }).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'AUDIT_EVIDENCE' }));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function reviewedGraph(packageJson: Record<string, unknown>, lock: Record<string, unknown>): void {
  packageJson.overrides = { 'js-yaml': '^5.4.3' };
  const packages = lock.packages as Record<string, Record<string, unknown>>;
  delete packages['']!.overrides;
  for (const [key, value] of Object.entries(packages)) {
    if (key.endsWith('node_modules/js-yaml')) {
      value.version = '5.4.3';
      value.dev = true;
      value.dependencies = { argparse: '^2.0.1' };
      delete value.optionalDependencies;
      delete value.peerDependencies;
    } else if (key.endsWith('node_modules/argparse')) {
      value.version = '2.0.1';
      value.dev = true;
      delete value.dependencies;
      delete value.optionalDependencies;
      delete value.peerDependencies;
    } else if (key.endsWith('node_modules/sprintf-js')) {
      delete packages[key];
    }
  }
}

function expectOverrideLockDiagnostic(
  mutate: Parameters<typeof expectLockDiagnostic>[0],
  code: string,
): void {
  expectLockDiagnostic((root, packageJson, lock) => {
    reviewedGraph(packageJson, lock);
    mutate(root, packageJson, lock);
  }, code);
}

function consumers(lock: Record<string, unknown>): Array<{ path: string; kind: string; range: string }> {
  const result: Array<{ path: string; kind: string; range: string }> = [];
  for (const [path, raw] of Object.entries(lock.packages as Record<string, unknown>)) {
    const value = raw as Record<string, Record<string, string> | undefined>;
    for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const range = value?.[kind]?.['js-yaml'];
      if (typeof range === 'string') result.push({ path, kind, range });
    }
  }
  return result.sort((left, right) => {
    const a = `${left.path}\0${left.kind}\0${left.range}`;
    const b = `${right.path}\0${right.kind}\0${right.range}`;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function digest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const assessmentFixture = `## Override advisory assessment

Advisory: GHSA-hp3w-g68c-fv3c.
Dependency path: \`jest@30.5.1 > @jest/core@30.5.1 > @jest/transform@30.5.1 > babel-plugin-istanbul@8.0.0 > @istanbuljs/load-nyc-config@1.1.0 > js-yaml@3.15.2 > argparse@1.0.10 > sprintf-js@1.0.3\`.
Impact: CPU denial of service through attacker-controlled unbounded precision specifiers.
Fixed sprintf-js release: none published; affected <=1.1.3.
Exposure: development-only Jest tooling; production source does not import Jest/js-yaml/sprintf-js and the package archive contains none of this dependency chain.
Decision: remove sprintf-js through the reviewed js-yaml override, not accept it as harmless.
Consumer: @istanbuljs/load-nyc-config declares js-yaml "^3.13.1"; the override deliberately exceeds that range.
Call site: \`require('js-yaml').load(await readFile(configFile, 'utf8'))\`.
Limits: no universal unreachability claim; compatibility is not inferred solely from an unchanged method name.
Residual risk: future advisories or future attacker-controlled developer input remain possible; recurring weekly/manual audit monitoring and release-time review remain required.
`;

function replaceSection(text: string, heading: string, content: string): string {
  const pattern = new RegExp(`^## ${heading}\\n[\\s\\S]*?(?=^## |$(?![\\s\\S]))`, 'm');
  return pattern.test(text) ? text.replace(pattern, content) : `${text}\n${content}`;
}

function evidenceFixture(root: string): void {
  const lockPath = join(root, 'package-lock.json');
  const reportPath = join(root, '.musubix/evidence/npm-audit/CHANGE-0052.json');
  mkdirSync(dirname(reportPath), { recursive: true });
  // Synthetic audit data belongs only to isolated tests, never repository evidence.
  writeJson(reportPath, {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  });
  const capture = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lockDigest = digest(lockPath);
  const oldPath = join(root, '.musubix/changes/CHANGE-0022.md');
  writeFileSync(oldPath, readFileSync(oldPath, 'utf8')
    .replace(/Audit captured at: [^.]+\./, `Audit captured at: ${capture}.`)
    .replace(/Audited package-lock SHA-256:\s+`[a-f0-9]{64}`/, `Audited package-lock SHA-256: \`${lockDigest}\``)
    .replace(/^.*Follow-up remediation: CHANGE-0052.*\n?/gm, '')
    + '\nFollow-up remediation: CHANGE-0052.\n');
  const changePath = join(root, '.musubix/changes/CHANGE-0052.md');
  let change = replaceSection(readFileSync(changePath, 'utf8'), 'Override advisory assessment', assessmentFixture);
  change = replaceSection(change, 'Verification evidence', `## Verification evidence

Override audit captured at: ${capture}.
Override lockfile SHA-256: \`${lockDigest}\`.
Audit report SHA-256: \`${digest(reportPath)}\`.
Remediation history: CHANGE-0022 -> CHANGE-0052.
Js-yaml consumer inventory: ${JSON.stringify(consumers(readJson(lockPath)))}

`);
  writeFileSync(changePath, change);
}

function expectOverrideEvidenceDiagnostic(
  mutate: (root: string) => void,
  code: string,
  relativePath: string,
): void {
  withFixture((root) => {
    evidenceFixture(root);
    mutate(root);
    expect(runCheck('evidence', { NPM_AUDIT_REMEDIATION_ROOT: root }).diagnostics)
      .toContainEqual(expect.objectContaining({ code, path: join(root, relativePath) }));
  });
}

describe('reviewed audit override contract', () => {
  /** @id TEST-AUDIT-OVERRIDE-CONTRACT-001
   * @verifies REQ-AUDIT-OVERRIDE-CONTRACT-001
   */
  it('TEST-AUDIT-OVERRIDE-CONTRACT-001 pins and guards every replacement dependency record', () => {
    expect(readJson('package.json').overrides).toEqual({ 'js-yaml': '^5.4.3' });
    expect(runCheck('lock')).toEqual({ valid: true, diagnostics: [] });
    for (const name of ['js-yaml', 'argparse']) {
      const mutations: Array<(value: Record<string, unknown>) => void> = [
        (value) => { value.version = '1.0.0'; },
        (value) => { value.version = name === 'js-yaml' ? '6.0.0' : '3.0.0'; },
        (value) => { value.version = '5.4.3-beta.1'; },
        (value) => { value.dev = false; },
        (value) => { value.dependencies = null; },
        (value) => { value.dependencies = []; },
        (value) => { value.dependencies = { unexpected: '^1.0.0' }; },
        (value) => { value.optionalDependencies = { unexpected: '^1.0.0' }; },
        (value) => { value.peerDependencies = 'malformed'; },
      ];
      for (const mutate of mutations) {
        expectOverrideLockDiagnostic((_root, _manifest, lock) => {
          const packages = lock.packages as Record<string, Record<string, unknown>>;
          mutate(packages[`node_modules/${name}`]!);
        }, 'LOCK_OVERRIDE_GRAPH');
      }
      for (const malformed of [null, [], 'invalid']) {
        expectOverrideLockDiagnostic((_root, _manifest, lock) => {
          (lock.packages as Record<string, unknown>)[`node_modules/${name}`] = malformed;
        }, 'LOCK_OVERRIDE_GRAPH');
      }
      expectOverrideLockDiagnostic((_root, _manifest, lock) => {
        delete (lock.packages as Record<string, unknown>)[`node_modules/${name}`];
      }, 'LOCK_OVERRIDE_GRAPH');
      expectOverrideLockDiagnostic((_root, _manifest, lock) => {
        (lock.packages as Record<string, unknown>)[`node_modules/other/node_modules/${name}`] = {
          version: '1.0.0', dev: true,
        };
      }, 'LOCK_OVERRIDE_GRAPH');
    }
    expectOverrideLockDiagnostic((_root, _manifest, lock) => {
      const packages = lock.packages as Record<string, Record<string, unknown>>;
      packages['node_modules/js-yaml']!.version = '5.4.2';
    }, 'LOCK_OVERRIDE_GRAPH');
    for (const path of ['node_modules/sprintf-js', 'node_modules/other/node_modules/sprintf-js']) {
      expectOverrideLockDiagnostic((_root, _manifest, lock) => {
        (lock.packages as Record<string, unknown>)[path] = { version: '1.0.3', dev: true };
      }, 'LOCK_OVERRIDE_GRAPH');
    }
  });

  /** @id TEST-AUDIT-OVERRIDE-CONTRACT-002
   * @verifies REQ-AUDIT-OVERRIDE-CONTRACT-002
   */
  it('TEST-AUDIT-OVERRIDE-CONTRACT-002 accepts only the reviewed manifest and generated root representation', () => {
    withFixture((root) => {
      const manifest = readJson(join(root, 'package.json'));
      const lock = readJson(join(root, 'package-lock.json'));
      reviewedGraph(manifest, lock);
      writeJson(join(root, 'package.json'), manifest);
      writeJson(join(root, 'package-lock.json'), lock);
      expect(runCheck('lock', { NPM_AUDIT_REMEDIATION_ROOT: root })).toEqual({ valid: true, diagnostics: [] });
    });
    for (const overrides of [
      undefined, {}, { different: '^5.4.3' }, { 'js-yaml': '^5.4.2' },
      { 'js-yaml': '^5.4.3', extra: '^1.0.0' },
      { 'js-yaml': { '.': '^5.4.3' } }, null, [], 'invalid',
    ]) {
      expectOverrideLockDiagnostic((_root, manifest) => {
        if (overrides === undefined) delete manifest.overrides;
        else manifest.overrides = overrides;
      }, 'MANIFEST_CONTRACT');
    }
    for (const overrides of [{ 'js-yaml': '^5.4.3' }, {}, null, 'invalid']) {
      expectOverrideLockDiagnostic((_root, _manifest, lock) => {
        (lock.packages as Record<string, Record<string, unknown>>)['']!.overrides = overrides;
      }, 'MANIFEST_CONTRACT');
    }
    for (const key of ['dependencies', 'bin', 'exports', 'files', 'engines']) {
      expectOverrideLockDiagnostic((_root, manifest) => { manifest[key] = {}; }, 'MANIFEST_CONTRACT');
    }
  });

  /** @id TEST-AUDIT-OVERRIDE-CONTRACT-003
   * @verifies REQ-AUDIT-OVERRIDE-CONTRACT-003
   */
  it('TEST-AUDIT-OVERRIDE-CONTRACT-003 binds the retained full audit to current lockfile evidence', () => {
    const reportPath = '.musubix/evidence/npm-audit/CHANGE-0052.json';
    expect(existsSync(reportPath)).toBe(true);
    expect(runCheck('evidence')).toEqual({ valid: true, diagnostics: [] });
    withFixture((root) => {
      evidenceFixture(root);
      expect(runCheck('evidence', { NPM_AUDIT_REMEDIATION_ROOT: root })).toEqual({ valid: true, diagnostics: [] });
    });
    for (const severity of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
      expectOverrideEvidenceDiagnostic((root) => {
        const path = join(root, reportPath);
        const report = readJson(path);
        ((report.metadata as Record<string, unknown>).vulnerabilities as Record<string, unknown>)[severity] = 1;
        writeJson(path, report);
      }, 'AUDIT_OVERRIDE_EVIDENCE', reportPath);
    }
    for (const mutate of [
      (report: Record<string, unknown>) => { delete report.metadata; },
      (report: Record<string, unknown>) => { report.vulnerabilities = []; },
      (report: Record<string, unknown>) => { report.vulnerabilities = { injected: {} }; },
      (report: Record<string, unknown>) => {
        ((report.metadata as Record<string, unknown>).vulnerabilities as Record<string, unknown>).total = '0';
      },
    ]) {
      expectOverrideEvidenceDiagnostic((root) => {
        const path = join(root, reportPath);
        const report = readJson(path);
        mutate(report);
        writeJson(path, report);
      }, 'AUDIT_OVERRIDE_EVIDENCE', reportPath);
    }
    for (const content of ['not JSON', '{}']) {
      expectOverrideEvidenceDiagnostic((root) => { writeFileSync(join(root, reportPath), content); },
        'AUDIT_OVERRIDE_EVIDENCE', reportPath);
    }
    expectOverrideEvidenceDiagnostic((root) => {
      const path = join(root, reportPath);
      writeFileSync(path, `${readFileSync(path, 'utf8')}\n`);
    }, 'AUDIT_OVERRIDE_EVIDENCE', reportPath);
    const changePath = '.musubix/changes/CHANGE-0052.md';
    for (const [pattern, replacement] of [
      [/Override lockfile SHA-256: `[^`]+`/, 'Override lockfile SHA-256: `invalid`'],
      [/Override audit captured at: [^.]+\./, 'Override audit captured at: 2999-01-01T00:00:00Z.'],
      [/Remediation history: CHANGE-0022 -> CHANGE-0052\./, 'Remediation history: missing.'],
    ] as const) {
      expectOverrideEvidenceDiagnostic((root) => {
        const path = join(root, changePath);
        writeFileSync(path, readFileSync(path, 'utf8').replace(pattern, replacement));
      }, 'AUDIT_OVERRIDE_EVIDENCE', changePath);
    }
    expectOverrideEvidenceDiagnostic((root) => {
      const path = join(root, '.musubix/changes/CHANGE-0022.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace('Follow-up remediation: CHANGE-0052.', 'Follow-up: missing.'));
    }, 'AUDIT_OVERRIDE_EVIDENCE', '.musubix/changes/CHANGE-0022.md');
  });

  /** @id TEST-AUDIT-OVERRIDE-CONTRACT-004
   * @verifies REQ-AUDIT-OVERRIDE-CONTRACT-004
   */
  it('TEST-AUDIT-OVERRIDE-CONTRACT-004 checks exposure evidence and executes the overridden YAML consumer', async () => {
    const changePath = '.musubix/changes/CHANGE-0052.md';
    expectOverrideEvidenceDiagnostic((root) => {
      const path = join(root, changePath);
      writeFileSync(path, readFileSync(path, 'utf8').replace('Decision: remove sprintf-js', 'Decision: unknown'));
    }, 'AUDIT_OVERRIDE_ASSESSMENT', changePath);
    for (const anchor of [
      'Advisory: GHSA-hp3w-g68c-fv3c.', 'attacker-controlled unbounded precision specifiers',
      'none published; affected <=1.1.3', 'production source does not import Jest/js-yaml/sprintf-js',
      'the override deliberately exceeds that range',
      "require('js-yaml').load(await readFile(configFile, 'utf8'))",
      'no universal unreachability claim',
      'compatibility is not inferred solely from an unchanged method name',
      'recurring weekly/manual audit monitoring',
    ]) {
      expectOverrideEvidenceDiagnostic((root) => {
        const path = join(root, changePath);
        writeFileSync(path, readFileSync(path, 'utf8').replace(anchor, 'missing'));
      }, 'AUDIT_OVERRIDE_ASSESSMENT', changePath);
    }
    for (const inventory of ['[]', 'not-json', '[{"path":"wrong","kind":"dependencies","range":"^3.13.1"}]']) {
      expectOverrideEvidenceDiagnostic((root) => {
        const path = join(root, changePath);
        writeFileSync(path, readFileSync(path, 'utf8').replace(/^Js-yaml consumer inventory: .*$/m,
          `Js-yaml consumer inventory: ${inventory}`));
      }, 'AUDIT_OVERRIDE_ASSESSMENT', changePath);
    }
    for (const field of ['kind', 'range']) {
      for (const value of [null, 1, [], {}, 'invalid']) {
        expectOverrideEvidenceDiagnostic((root) => {
          const path = join(root, changePath);
          const content = readFileSync(path, 'utf8');
          const line = /^Js-yaml consumer inventory: (.*)$/m.exec(content)!;
          const entries = JSON.parse(line[1]!) as Array<Record<string, unknown>>;
          entries[0]![field] = value;
          writeFileSync(path, content.replace(line[0],
            `Js-yaml consumer inventory: ${JSON.stringify(entries)}`));
        }, 'AUDIT_OVERRIDE_ASSESSMENT', changePath);
      }
    }
    for (const mode of ['multiple', 'duplicate', 'order']) {
      expectOverrideEvidenceDiagnostic((root) => {
        if (mode === 'order') {
          const lockPath = join(root, 'package-lock.json');
          const lock = readJson(lockPath);
          (lock.packages as Record<string, unknown>)['node_modules/z-extra-consumer'] = {
            version: '1.0.0', dev: true, dependencies: { 'js-yaml': '^3.13.1' },
          };
          writeJson(lockPath, lock);
          evidenceFixture(root);
        }
        const path = join(root, changePath);
        const content = readFileSync(path, 'utf8');
        const line = /^Js-yaml consumer inventory: (.*)$/m.exec(content)!;
        const entries = JSON.parse(line[1]!) as unknown[];
        if (mode === 'multiple') writeFileSync(path, `${content}\n${line[0]}\n`);
        else writeFileSync(path, content.replace(line[0],
          `Js-yaml consumer inventory: ${JSON.stringify(mode === 'duplicate' ? [...entries, entries[0]] : entries.reverse())}`));
      }, 'AUDIT_OVERRIDE_ASSESSMENT', changePath);
    }
    expect(runCheck('evidence')).toEqual({ valid: true, diagnostics: [] });
    const require = createRequire(import.meta.url);
    const consumerRequire = createRequire(require.resolve('@istanbuljs/load-nyc-config'));
    let directory = dirname(consumerRequire.resolve('js-yaml'));
    while (!existsSync(join(directory, 'package.json')) && dirname(directory) !== directory) directory = dirname(directory);
    const installed = readJson(join(directory, 'package.json'));
    expect(installed.name).toBe('js-yaml');
    expect(installed.version).toMatch(/^5\.\d+\.\d+$/);
    const root = fixtureDirectory('yaml-consumer-');
    try {
      writeJson(join(root, 'package.json'), { name: 'yaml-consumer-fixture', private: true });
      writeFileSync(join(root, '.nycrc.yaml'),
        'check-coverage: true\nlines: 85\nexclude: excluded-file.ts\nextension:\n  - .ts\n  - .js\n');
      const { loadNycConfig } = require('@istanbuljs/load-nyc-config') as {
        loadNycConfig: (options: { cwd: string; nycrcPath: string }) => Promise<Record<string, unknown>>;
      };
      expect(await loadNycConfig({ cwd: root, nycrcPath: '.nycrc.yaml' })).toMatchObject({
        cwd: root, checkCoverage: true, lines: 85, exclude: ['excluded-file.ts'], extension: ['.ts', '.js'],
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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
