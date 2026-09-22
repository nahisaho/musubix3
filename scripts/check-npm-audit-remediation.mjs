import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(process.env.NPM_AUDIT_REMEDIATION_ROOT ?? '.');
const changePath = process.env.NPM_AUDIT_REMEDIATION_CHANGE_PATH
  ?? resolve(root, '.musubix/changes/CHANGE-0022.md');

function rootPath(path) {
  return resolve(root, path);
}

function diagnostic(code, message, path) {
  return { code, message, ...(path ? { path } : {}) };
}

function report(diagnostics) {
  process.stdout.write(`${JSON.stringify({ valid: diagnostics.length === 0, diagnostics })}\n`);
  if (diagnostics.length) process.exitCode = 1;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function packageRecords(packages, name) {
  const rootKey = `node_modules/${name}`;
  const suffix = `/node_modules/${name}`;
  return Object.entries(packages)
    .filter(([key]) => key === rootKey || key.endsWith(suffix))
    .map(([key, value]) => ({ key, value }));
}

function stableVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function hasSetupNode(job, version) {
  return (job?.steps ?? []).some((step) =>
    typeof step?.uses === 'string'
    && step.uses.startsWith('actions/setup-node@')
    && String(step.with?.['node-version']) === String(version));
}

function setupNodeVersions(job) {
  return (job?.steps ?? [])
    .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/setup-node@'))
    .map((step) => String(step.with?.['node-version']));
}

function hasRun(job, command) {
  return (job?.steps ?? []).some((step) => step?.run === command);
}

function runCount(job, command) {
  return (job?.steps ?? []).filter((step) => step?.run === command).length;
}

/** @id CODE-NPM-AUDIT-REMEDIATION-001
 * @implements REQ-NPM-AUDIT-REMEDIATION-001 REQ-NPM-AUDIT-REMEDIATION-002
 * @design DES-NPM-AUDIT-REMEDIATION-001
 */
function checkEvidence() {
  const diagnostics = [];
  const change = readFileSync(changePath, 'utf8').replace(/\s+/g, ' ');
  const lockSha256 = createHash('sha256')
    .update(readFileSync(rootPath('package-lock.json')))
    .digest('hex');
  const anchors = [
    'Advisory: GHSA-82fw-gwwq-j7x9 / CVE-2026-84373',
    'GHSA-82fw-gwwq-j7x9',
    'CVE-2026-84373',
    'CVSS 5.9',
    'CWE-22',
    'vitest > @vitest/mocker',
    '>=2.1.0 <4.1.11',
    'no fixed 3.x release',
    'development-only',
    'does not configure browser mode',
    '5.0.0-beta.1',
    'before 5.0.0-rc.2',
    'Audit command: `npm run audit:report` (`npm audit --json`)',
    'Audit result: info 0, low 0, moderate 0, high 0, critical 0, total 0',
    'GHSA-82fw-gwwq-j7x9 findings: 0',
    'moderate-or-higher findings: 0',
  ];
  for (const anchor of anchors) {
    if (!change.includes(anchor)) {
      diagnostics.push(diagnostic('AUDIT_EVIDENCE', `CHANGE-0022 is missing evidence: ${anchor}.`, changePath));
    }
  }
  const auditSummaries = [...change.matchAll(
    /Audit result: info (\d+), low (\d+), moderate (\d+), high (\d+), critical (\d+), total (\d+)/g,
  )];
  if (auditSummaries.length !== 1
    || auditSummaries[0].slice(1).some((count) => count !== '0')) {
    diagnostics.push(diagnostic(
      'AUDIT_EVIDENCE',
      'CHANGE-0022 must contain exactly one all-zero audit severity summary.',
      changePath,
    ));
  }
  const auditCapturedAt = /Audit captured at: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\./
    .exec(change)?.[1];
  const auditCapturedAtMs = auditCapturedAt ? Date.parse(auditCapturedAt) : Number.NaN;
  if (!Number.isFinite(auditCapturedAtMs)
    || new Date(auditCapturedAtMs).toISOString().replace('.000Z', 'Z') !== auditCapturedAt
    || auditCapturedAtMs > Date.now() + 300_000) {
    diagnostics.push(diagnostic(
      'AUDIT_EVIDENCE',
      'CHANGE-0022 must timestamp the live registry audit in UTC.',
      changePath,
    ));
  }
  if (!change.includes(`Audited package-lock SHA-256: \`${lockSha256}\``)) {
    diagnostics.push(diagnostic(
      'AUDIT_EVIDENCE',
      'CHANGE-0022 audit evidence must bind the current package-lock.json SHA-256.',
      changePath,
    ));
  }
  return diagnostics;
}

/** @id CODE-NPM-AUDIT-REMEDIATION-002
 * @implements REQ-NPM-AUDIT-REMEDIATION-002 REQ-NPM-AUDIT-REMEDIATION-003
 * @design DES-NPM-AUDIT-REMEDIATION-002
 */
function checkLock() {
  const diagnostics = [];
  const packagePath = rootPath('package.json');
  const lockPath = rootPath('package-lock.json');
  const configPath = rootPath('vitest.config.ts');
  const workflowPath = rootPath('.github/workflows/ci.yml');
  const packageJson = readJson(packagePath);
  const lock = readJson(lockPath);
  if (lock.lockfileVersion !== 3
    || !lock.packages
    || typeof lock.packages !== 'object'
    || Array.isArray(lock.packages)) {
    return [diagnostic('LOCK_SCHEMA', 'package-lock.json must use lockfileVersion 3 with packages.', lockPath)];
  }
  if (Object.hasOwn(lock, 'dependencies')) {
    diagnostics.push(diagnostic('LOCK_LEGACY', 'Legacy top-level lockfile dependencies are forbidden.', lockPath));
  }
  const expectedProductionSurface = {
    dependencies: {
      commander: '^13.1.0',
      typescript: '~5.9.3',
      yaml: '^2.8.1',
    },
    bin: { musubix3: 'dist/packages/cli/src/main.js' },
    exports: {
      './domain': './dist/packages/domain/src/index.js',
      './analysis': './dist/packages/analysis/src/index.js',
      './attestation': './dist/packages/analysis/src/attestation.js',
    },
    files: [
      'dist',
      'assets',
      '.github/skills',
      '.github/plugin/marketplace.json',
      'plugin.json',
      'README-ja.md',
      'CHANGELOG.md',
      'LICENSE',
    ],
  };
  if (packageJson.devDependencies?.vitest !== '^4.1.11'
    || Object.hasOwn(packageJson.devDependencies ?? {}, '@vitest/mocker')
    || packageJson.engines?.node !== '>=20'
    || Object.hasOwn(packageJson, 'overrides')
    || Object.entries(expectedProductionSurface).some(([key, value]) =>
      JSON.stringify(packageJson[key]) !== JSON.stringify(value))) {
    diagnostics.push(diagnostic('MANIFEST_CONTRACT', 'package.json dependency or distribution contract changed.', packagePath));
  }
  const rootLockPackage = lock.packages[''];
  if (rootLockPackage?.devDependencies?.vitest !== '^4.1.11'
    || JSON.stringify(rootLockPackage?.devDependencies)
      !== JSON.stringify(packageJson.devDependencies)
    || rootLockPackage?.engines?.node !== packageJson.engines?.node
    || JSON.stringify(rootLockPackage?.dependencies) !== JSON.stringify(expectedProductionSurface.dependencies)
    || JSON.stringify(rootLockPackage?.bin) !== JSON.stringify(expectedProductionSurface.bin)) {
    diagnostics.push(diagnostic(
      'MANIFEST_CONTRACT',
      'Root lockfile metadata must preserve the reviewed dependency and distribution contract.',
      lockPath,
    ));
  }
  const fixedMinimum = [4, 1, 11];
  const nextMajor = [5, 0, 0];
  for (const name of ['vitest', '@vitest/mocker']) {
    const records = packageRecords(lock.packages, name);
    if (!records.length) {
      diagnostics.push(diagnostic('LOCK_MISSING', `No ${name} package record is resolved.`, lockPath));
    }
    for (const { key, value } of records) {
      if (value?.dev !== true) {
        diagnostics.push(diagnostic('LOCK_DEV', `${key} must remain development-only.`, lockPath));
      }
      const version = stableVersion(value?.version);
      if (!version) {
        diagnostics.push(diagnostic('LOCK_VERSION', `${key} must use a stable numeric version.`, lockPath));
      } else if (compareVersion(version, fixedMinimum) < 0) {
        diagnostics.push(diagnostic('LOCK_VULNERABLE', `${key}@${value.version} remains in the affected range.`, lockPath));
      } else if (compareVersion(version, nextMajor) >= 0) {
        diagnostics.push(diagnostic('LOCK_VERSION', `${key}@${value.version} is outside reviewed stable 4.x.`, lockPath));
      }
    }
  }
  const vitestRecords = packageRecords(lock.packages, 'vitest');
  const mockerRecords = packageRecords(lock.packages, '@vitest/mocker');
  const vitestVersions = [...new Set(vitestRecords.map(({ value }) => value?.version))].sort();
  const mockerVersions = [...new Set(mockerRecords.map(({ value }) => value?.version))].sort();
  if (JSON.stringify(vitestVersions) !== JSON.stringify(mockerVersions)) {
    diagnostics.push(diagnostic(
      'LOCK_VERSION',
      'Resolved Vitest and @vitest/mocker versions must remain aligned.',
      lockPath,
    ));
  }
  if (vitestRecords.some(({ value }) =>
    value?.engines?.node !== '^20.0.0 || ^22.0.0 || >=24.0.0')) {
    diagnostics.push(diagnostic('LOCK_ENGINE', 'Resolved Vitest must support CI Node.js 20, 22, and 24.', lockPath));
  }
  const viteRecords = packageRecords(lock.packages, 'vite');
  if (!viteRecords.length) {
    diagnostics.push(diagnostic('LOCK_MISSING', 'No Vite package record is resolved.', lockPath));
  }
  for (const { key, value } of viteRecords) {
    const version = stableVersion(value?.version);
    if (!version
      || compareVersion(version, [8, 3, 0]) < 0
      || compareVersion(version, [9, 0, 0]) >= 0) {
      diagnostics.push(diagnostic(
        'LOCK_VERSION',
        `${key} must remain on the reviewed stable Vite 8.x line.`,
        lockPath,
      ));
    }
    if (value?.dev !== true || value?.engines?.node !== '^20.19.0 || >=22.12.0') {
      diagnostics.push(diagnostic('VITE_ENGINE', `${key} must remain dev-only with the reviewed Node.js floor.`, lockPath));
    }
  }
  const scripts = packageJson.scripts ?? {};
  if (scripts.test !== 'vitest run'
    || scripts['test:adapters'] !== 'vitest run tests/adapter-integration.test.ts --maxWorkers=1'
    || scripts['test:watch'] !== 'vitest'
    || scripts['audit:report'] !== 'npm audit --json') {
    diagnostics.push(diagnostic('CONFIG_CONTRACT', 'Vitest package scripts changed.', packagePath));
  }
  const config = readFileSync(configPath, 'utf8');
  const configAnchors = [
    "include: ['tests/**/*.test.ts']",
    'testTimeout: 20_000',
    'maxWorkers: 2',
  ];
  if (configAnchors.some((anchor) => !config.includes(anchor))) {
    diagnostics.push(diagnostic('CONFIG_CONTRACT', 'Vitest selection, timeout, or worker limits changed.', configPath));
  }
  const removedPatterns = [
    /\bpoolOptions\b/,
    /\bsingleThread\b/,
    /\bsingleFork\b/,
    /\bmaxThreads\b/,
    /\bmaxForks\b/,
    /\bminWorkers\b/,
    /\bpoolMatchGlobs\b/,
    /\benvironmentMatchGlobs\b/,
    /\bworkspace\s*:/,
    /\buseAtomics\b/,
    /\btesterScripts\b/,
    /\breporter(?:s)?\s*:\s*['"]basic['"]/,
    /\bdeps\s*:\s*\{[^}]*\b(?:external|inline|fallbackCJS)\b/s,
  ];
  if (removedPatterns.some((pattern) => pattern.test(config))) {
    diagnostics.push(diagnostic('CONFIG_REMOVED', 'Vitest configuration uses a removed v4 option.', configPath));
  }
  const workflow = parse(readFileSync(workflowPath, 'utf8'));
  const jobs = workflow.jobs ?? {};
  const requiredJobs = [
    jobs['core-portability'],
    jobs['node-compatibility'],
    jobs['native-adapters'],
    jobs['formal-solvers'],
  ];
  const compatibilityMatrix = jobs['node-compatibility']?.strategy?.matrix?.node;
  if (requiredJobs.some((job) => Object.hasOwn(job ?? {}, 'continue-on-error'))
    || !hasSetupNode(jobs['core-portability'], 22)
    || JSON.stringify(setupNodeVersions(jobs['core-portability'])) !== JSON.stringify(['22'])
    || !hasRun(jobs['core-portability'], 'npm test')
    || runCount(jobs['core-portability'], 'npm test') !== 1
    || JSON.stringify(compatibilityMatrix) !== JSON.stringify([20, 24])
    || JSON.stringify(setupNodeVersions(jobs['node-compatibility']))
      !== JSON.stringify(['${{ matrix.node }}'])
    || !hasRun(jobs['node-compatibility'], 'npm test')
    || runCount(jobs['node-compatibility'], 'npm test') !== 1
    || !hasSetupNode(jobs['native-adapters'], 24)
    || JSON.stringify(setupNodeVersions(jobs['native-adapters'])) !== JSON.stringify(['24'])
    || !hasRun(jobs['native-adapters'], 'npm run test:adapters')
    || runCount(jobs['native-adapters'], 'npm run test:adapters') !== 1
    || !hasSetupNode(jobs['formal-solvers'], 24)
    || JSON.stringify(setupNodeVersions(jobs['formal-solvers'])) !== JSON.stringify(['24'])
    || !hasRun(jobs['formal-solvers'], 'npm test -- --run tests/p3-formal.test.ts')
    || runCount(jobs['formal-solvers'], 'npm test -- --run tests/p3-formal.test.ts') !== 1) {
    diagnostics.push(diagnostic('CI_CONTRACT', 'Vitest CI Node.js lines or commands changed.', workflowPath));
  }
  return diagnostics;
}

/** @id CODE-NPM-AUDIT-REMEDIATION-003
 * @implements REQ-NPM-AUDIT-REMEDIATION-004
 * @design DES-NPM-AUDIT-REMEDIATION-003
 */
function checkPolicy() {
  const diagnostics = [];
  const documents = [
    {
      path: 'README.md',
      anchors: [
        'Dependency audit policy',
        '`npm audit --json`',
        'development dependencies',
        'reachability',
        'maintained fix',
        'residual risk',
        'time-bound',
      ],
    },
    {
      path: 'README-ja.md',
      anchors: [
        '依存関係auditポリシー',
        '`npm audit --json`',
        '開発時依存',
        '到達可能性',
        'maintained fix',
        '残存リスク',
        'その時点の証拠',
      ],
    },
  ];
  for (const document of documents) {
    const path = rootPath(document.path);
    const text = readFileSync(path, 'utf8').replace(/\s+/g, ' ');
    if (document.anchors.some((anchor) => !text.includes(anchor))) {
      diagnostics.push(diagnostic('AUDIT_POLICY', 'Dependency audit guidance is incomplete.', document.path));
    }
  }
  const workflowPath = '.github/workflows/dependency-audit.yml';
  const workflow = parse(readFileSync(rootPath(workflowPath), 'utf8'));
  const triggers = workflow.on ?? {};
  const auditJob = workflow.jobs?.audit;
  const checkoutUses = (auditJob?.steps ?? [])
    .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout@'))
    .map((step) => step.uses);
  const setupNodeUses = (auditJob?.steps ?? [])
    .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/setup-node@'))
    .map((step) => step.uses);
  const auditSteps = (auditJob?.steps ?? [])
    .filter((step) => step?.run === 'npm run audit:report');
  const npmrcPath = rootPath('.npmrc');
  const npmrc = existsSync(npmrcPath) ? readFileSync(npmrcPath, 'utf8') : '';
  if (JSON.stringify(triggers.schedule) !== JSON.stringify([{ cron: '23 4 * * 1' }])
    || !Object.hasOwn(triggers, 'workflow_dispatch')
    || Object.hasOwn(workflow, 'env')
    || Object.hasOwn(workflow, 'defaults')
    || JSON.stringify(checkoutUses)
      !== JSON.stringify(['actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09'])
    || JSON.stringify(setupNodeUses)
      !== JSON.stringify(['actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444'])
    || JSON.stringify(setupNodeVersions(auditJob)) !== JSON.stringify(['24'])
    || auditSteps.length !== 1
    || Object.hasOwn(auditJob ?? {}, 'continue-on-error')
    || Object.hasOwn(auditJob ?? {}, 'env')
    || Object.hasOwn(auditJob ?? {}, 'defaults')
    || auditSteps.some((step) =>
      Object.hasOwn(step, 'continue-on-error')
      || Object.hasOwn(step, 'env')
      || Object.hasOwn(step, 'shell'))
    || /^\s*audit-level\s*=/m.test(npmrc)) {
    diagnostics.push(diagnostic(
      'AUDIT_POLICY',
      'Dependency audit workflow must support scheduled and manual full audit reports.',
      workflowPath,
    ));
  }
  return diagnostics;
}

const check = process.argv[2];
if (check === 'evidence') report(checkEvidence());
else if (check === 'lock') report(checkLock());
else if (check === 'policy') report(checkPolicy());
else {
  process.stderr.write('Usage: node scripts/check-npm-audit-remediation.mjs <evidence|lock|policy>\n');
  process.exitCode = 2;
}
