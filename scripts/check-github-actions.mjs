import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/workflows/npm-publish.yml',
];
const actionWorkflowPaths = [
  ...workflowPaths,
  '.github/workflows/dependency-audit.yml',
];
const lockPath = 'scripts/github-actions-lock.json';
const fixturePath = 'tests/fixtures/github-actions-node24-runtime/baseline.json';
const releasePublishingFixturePath = 'tests/fixtures/release-asset-publishing/workflow-baseline.json';
const workflowRoot = process.env.GITHUB_ACTIONS_WORKFLOW_ROOT;
const projectNode24DocRoot = process.env.GITHUB_ACTIONS_PROJECT_NODE24_DOC_ROOT;
const changePath = process.env.GITHUB_ACTIONS_CHANGE_PATH ?? '.musubix/changes/CHANGE-0021.md';
const projectNode24ChangePath = process.env.GITHUB_ACTIONS_PROJECT_NODE24_CHANGE_PATH
  ?? '.musubix/changes/CHANGE-0047.md';
const shaPattern = /^[0-9a-f]{40}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function currentPath(path) {
  if (!workflowRoot) return path;
  const fixturePath = resolve(workflowRoot, path);
  if (existsSync(fixturePath)) return fixturePath;
  return path === '.github/workflows/dependency-audit.yml' ? path : fixturePath;
}

function fixtureCurrentPath(path) {
  if (!workflowRoot) return path;
  const copiedPath = resolve(workflowRoot, path);
  return existsSync(copiedPath) ? copiedPath : path;
}

function projectDocumentPath(path) {
  if (!projectNode24DocRoot) return path;
  const copiedPath = resolve(projectNode24DocRoot, path);
  return existsSync(copiedPath) ? copiedPath : path;
}

function diagnostic(code, message, path) {
  return { code, message, ...(path ? { path } : {}) };
}

function hasCarriageReturn(bytes) {
  return bytes.includes(13);
}

function report(diagnostics) {
  const value = { valid: diagnostics.length === 0, diagnostics };
  process.stdout.write(`${JSON.stringify(value)}\n`);
  if (diagnostics.length) process.exitCode = 1;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function actionReferences(path) {
  const references = [];
  const sourcePath = currentPath(path);
  for (const [index, line] of readFileSync(sourcePath, 'utf8').split(/\r?\n/).entries()) {
    const declaration = /^\s*(?:-\s+)?uses:\s*(.+?)\s*$/.exec(line);
    if (!declaration) continue;
    const match = /^(\S+)(?:\s+#\s+(\S+))?$/.exec(declaration[1]);
    const rawToken = match?.[1] ?? declaration[1].split(/\s+/)[0];
    const token = match && rawToken.length >= 2
      && ((rawToken.startsWith('"') && rawToken.endsWith('"'))
        || (rawToken.startsWith("'") && rawToken.endsWith("'")))
      ? rawToken.slice(1, -1)
      : rawToken;
    if (token.startsWith('./') || token.startsWith('docker://')) continue;
    const separator = token.lastIndexOf('@');
    const repository = separator === -1 ? token : token.slice(0, separator);
    const sha = match && separator !== -1 ? token.slice(separator + 1) : '';
    references.push({ repository, sha, tag: match?.[2] ?? '', path, line: index + 1 });
  }
  return references;
}

function major(tag) {
  const match = /^v(\d+)(?:\.\d+\.\d+)?$/.exec(tag);
  return match ? Number(match[1]) : null;
}

/** @id CODE-GITHUB-ACTIONS-NODE24-RUNTIME-001
 * @implements REQ-GITHUB-ACTIONS-NODE24-RUNTIME-001 REQ-NPM-AUDIT-REMEDIATION-004
 * @design DES-GITHUB-ACTIONS-NODE24-RUNTIME-001 DES-NPM-AUDIT-REMEDIATION-003
 */
function checkLock() {
  const diagnostics = [];
  const lock = readJson(lockPath);
  const fixture = readJson(fixturePath);
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.actions)) {
    return [diagnostic('ACTION_LOCK_SCHEMA', 'Action lock must use schemaVersion 1 with an actions array.', lockPath)];
  }
  const references = actionWorkflowPaths.flatMap(actionReferences);
  const entries = new Map();
  for (const entry of lock.actions) {
    const path = lockPath;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      diagnostics.push(diagnostic('ACTION_LOCK_SCHEMA', 'Every action lock entry must be an object.', path));
      continue;
    }
    const keys = Object.keys(entry).sort();
    const allowed = ['crossedMajors', 'kind', 'repository', 'reviewedAt', 'reviewer', 'runtime', 'sha', 'sourceUrl', 'tag'];
    if (keys.some((key) => !allowed.includes(key))) {
      diagnostics.push(diagnostic('ACTION_LOCK_SCHEMA', `Unknown lock fields for ${String(entry.repository)}.`, path));
    }
    if (typeof entry.repository !== 'string' || entries.has(entry.repository)) {
      diagnostics.push(diagnostic('ACTION_LOCK_DUPLICATE', `Action repository must be a unique string: ${String(entry.repository)}.`, path));
      continue;
    }
    entries.set(entry.repository, entry);
    if (!shaPattern.test(entry.sha) || !/^v\d+\.\d+\.\d+$/.test(entry.tag)) {
      diagnostics.push(diagnostic('ACTION_LOCK_IDENTITY', `Invalid SHA or exact release tag for ${entry.repository}.`, path));
    }
    if (!['javascript', 'composite', 'docker'].includes(entry.kind)) {
      diagnostics.push(diagnostic('ACTION_LOCK_KIND', `Invalid action kind for ${entry.repository}.`, path));
    }
    if ((entry.kind === 'javascript' && entry.runtime !== 'node24')
      || (entry.kind !== 'javascript' && Object.hasOwn(entry, 'runtime'))) {
      diagnostics.push(diagnostic('ACTION_LOCK_RUNTIME', `Invalid runtime classification for ${entry.repository}.`, path));
    }
    const expectedSource = `https://github.com/${entry.repository}/blob/${entry.sha}/action.yml`;
    if (entry.sourceUrl !== expectedSource) {
      diagnostics.push(diagnostic('ACTION_LOCK_SOURCE', `Source URL must bind ${entry.repository} to its exact SHA.`, path));
    }
    if (typeof entry.reviewer !== 'string' || !entry.reviewer.trim() || !datePattern.test(entry.reviewedAt)) {
      diagnostics.push(diagnostic('ACTION_LOCK_REVIEW', `Missing reviewer or review date for ${entry.repository}.`, path));
    }
    const baselineTag = fixture.baselineActions?.[entry.repository];
    const baselineMajor = major(baselineTag);
    const targetMajor = major(entry.tag);
    const expectedMajors = baselineMajor === null || targetMajor === null
      ? []
      : Array.from({ length: Math.max(0, targetMajor - baselineMajor) }, (_, index) => baselineMajor + index + 1);
    const crossed = Array.isArray(entry.crossedMajors) ? entry.crossedMajors : [];
    const actualMajors = crossed.map((item) => item?.major);
    if (JSON.stringify(actualMajors) !== JSON.stringify(expectedMajors)
      || crossed.some((item) => !Number.isInteger(item?.major)
        || typeof item?.migrationUrl !== 'string'
        || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(?:releases\/tag|compare|commit|pull)\//.test(item.migrationUrl))) {
      diagnostics.push(diagnostic('ACTION_LOCK_MIGRATION', `Incomplete crossed-major review metadata for ${entry.repository}.`, path));
    }
  }
  for (const reference of references) {
    if (!shaPattern.test(reference.sha) || !/^v\d+\.\d+\.\d+$/.test(reference.tag)) {
      diagnostics.push(diagnostic(
        'ACTION_WORKFLOW_PIN',
        `${reference.repository} must use a lowercase 40-character commit SHA with an exact release tag comment.`,
        reference.path,
      ));
      continue;
    }
    const entry = entries.get(reference.repository);
    if (!entry) {
      diagnostics.push(diagnostic('ACTION_LOCK_MISSING', `Missing lock entry for ${reference.repository}.`, reference.path));
    } else if (entry.sha !== reference.sha || entry.tag !== reference.tag) {
      diagnostics.push(diagnostic('ACTION_LOCK_STALE', `Workflow reference does not match reviewed lock entry for ${reference.repository}.`, reference.path));
    }
  }
  const referenced = new Set(references.map(({ repository }) => repository));
  for (const repository of entries.keys()) {
    if (!referenced.has(repository)) {
      diagnostics.push(diagnostic('ACTION_LOCK_UNREFERENCED', `Unreferenced action lock entry: ${repository}.`, lockPath));
    }
  }
  return diagnostics;
}

function normalizeUses(value) {
  if (Array.isArray(value)) return value.map(normalizeUses);
  if (!value || typeof value !== 'object') return value;
  const normalized = {};
  for (const [key, nested] of Object.entries(value)) {
    normalized[key] = key === 'uses' && typeof nested === 'string' && nested.includes('@')
      ? `${nested.slice(0, nested.indexOf('@'))}@<PIN>`
      : normalizeUses(nested);
  }
  return normalized;
}

function parseInputChanges() {
  const text = readFileSync(changePath, 'utf8');
  const section = text.split('## Upstream-mandated input changes\n')[1]?.split('\n## ')[0];
  if (section === undefined) throw new Error('Missing upstream-mandated input changes section.');
  const lines = section.split(/\r?\n/).filter((line) => line.trim());
  if (lines[0] !== 'action | input | baseline | replacement | immutable upstream source'
    || lines[1] !== '--- | --- | --- | --- | ---') {
    throw new Error('Malformed upstream-mandated input changes table header.');
  }
  const seen = new Set();
  return lines.slice(2).map((line) => {
    const fields = line.split('|').map((field) => field.trim());
    if (fields.length !== 5 || fields.some((field) => !field)) throw new Error(`Malformed input change row: ${line}`);
    const key = `${fields[0]}\0${fields[1]}`;
    if (seen.has(key)) throw new Error(`Duplicate input change row: ${fields[0]} ${fields[1]}`);
    if (!/^https:\/\/github\.com\//.test(fields[4])) throw new Error(`Input change source must be a GitHub URL: ${line}`);
    seen.add(key);
    return { action: fields[0], input: fields[1], baseline: fields[2], replacement: fields[3] };
  });
}

function applyInputChanges(baseline, current, changes) {
  const visit = (left, right) => {
    if (Array.isArray(left) && Array.isArray(right)) {
      for (let index = 0; index < Math.min(left.length, right.length); index += 1) visit(left[index], right[index]);
      return;
    }
    if (!left || typeof left !== 'object' || !right || typeof right !== 'object') return;
    if (typeof left.uses === 'string' && typeof right.uses === 'string') {
      const repository = left.uses.split('@')[0];
      for (const change of changes.filter(({ action }) => action === repository)) {
        const baseline = left.with?.[change.input];
        const replacement = right.with?.[change.input];
        const encode = (value) => value === undefined ? 'None' : String(value);
        if (encode(baseline) !== change.baseline || encode(replacement) !== change.replacement) {
          throw new Error(`Input change table does not match ${repository} ${change.input}.`);
        }
        left.with ??= {};
        right.with ??= {};
        left.with[change.input] = '<REVIEWED_INPUT_CHANGE>';
        right.with[change.input] = '<REVIEWED_INPUT_CHANGE>';
      }
    }
    for (const key of Object.keys(left)) {
      if (Object.hasOwn(right, key)) visit(left[key], right[key]);
    }
  };
  visit(baseline, current);
}

function sourceSha256(source) {
  return createHash('sha256').update(source).digest('hex');
}

function gitBlobId(source) {
  const bytes = Buffer.from(source);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function setupNodeVersions(workflow) {
  return Object.values(workflow.jobs ?? {}).flatMap((job) =>
    (job?.steps ?? [])
      .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/setup-node@'))
      .map((step) => String(step.with?.['node-version'])));
}

function checkoutByteDiagnostics() {
  const diagnostics = [];
  const environment = { ...process.env, GIT_ATTR_NOSYSTEM: '1', GIT_CONFIG_NOSYSTEM: '1' };
  const attributeFiles = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.gitattributes', '**/.gitattributes'],
    { encoding: 'utf8', env: environment },
  ).trim().split(/\r?\n/).filter(Boolean);
  if (JSON.stringify(attributeFiles) !== JSON.stringify(['.gitattributes'])
    || readFileSync('.gitattributes', 'utf8') !== '* text=auto eol=lf\n') {
    diagnostics.push(diagnostic(
      'WORKFLOW_TEXT_ATTRIBUTES',
      'The root .gitattributes must be the only attribute file and contain exactly * text=auto eol=lf.',
      '.gitattributes',
    ));
    return diagnostics;
  }
  const paths = [...workflowPaths, 'package-lock.json'];
  const attributes = execFileSync(
    'git',
    ['check-attr', 'text', 'eol', '--', ...paths],
    { encoding: 'utf8', env: environment },
  );
  for (const path of paths) {
    if (!attributes.includes(`${path}: text: auto`)
      || !attributes.includes(`${path}: eol: lf`)
      || hasCarriageReturn(readFileSync(path))
      || hasCarriageReturn(execFileSync('git', ['show', `HEAD:${path}`]))) {
      diagnostics.push(diagnostic(
        'WORKFLOW_TEXT_ATTRIBUTES',
        `Reviewed source bytes must use effective text=auto, eol=lf, and contain no carriage returns: ${path}.`,
        path,
      ));
    }
  }
  return diagnostics;
}

function artifactContract(workflow) {
  const jobs = workflow.jobs ?? {};
  const steps = (job) => jobs[job]?.steps ?? [];
  const actionStep = (job, repository, name) => steps(job).find((step) =>
    typeof step.uses === 'string' && step.uses.startsWith(`${repository}@`) && step.with?.name === name);
  const runText = (job) => steps(job).map((step) => step.run ?? '').join('\n');
  const releaseUpload = actionStep('validate', 'actions/upload-artifact', 'release-assets');
  const attestDownload = actionStep('attest', 'actions/download-artifact', 'release-assets');
  const attestationUpload = actionStep('attest', 'actions/upload-artifact', 'release-attestation');
  const releaseAssetsDownload = actionStep('github-release', 'actions/download-artifact', 'release-assets');
  const attestationDownload = actionStep('github-release', 'actions/download-artifact', 'release-attestation');
  return {
    releaseUpload: releaseUpload?.with?.path,
    attestDownload: attestDownload?.with?.path,
    attestationUpload: attestationUpload?.with?.path,
    releaseAssetsDownload: releaseAssetsDownload?.with?.path,
    attestationDownload: attestationDownload?.with?.path,
    publishDownloadsGithubRelease: runText('npm-publish').includes('gh release download "$RELEASE_TAG"'),
    attestConsumesReleaseAssets: runText('attest').includes('release:attest -- release-assets'),
    githubReleaseConsumesAssets: runText('github-release').includes('release-assets/*'),
    publishConsumesAssets: runText('npm-publish').includes('npm run --silent release:publish --')
      && runText('npm-publish').includes('--directory release-assets'),
  };
}

/** @id CODE-GITHUB-ACTIONS-NODE24-RUNTIME-002
 * @implements REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002 REQ-RELEASE-ASSET-PUBLISHING-004 REQ-GITHUB-ACTIONS-PROJECT-NODE24-001 REQ-GITHUB-ACTIONS-PROJECT-NODE24-002
 * @design DES-GITHUB-ACTIONS-NODE24-RUNTIME-002 DES-RELEASE-ASSET-PUBLISHING-006 DES-GITHUB-ACTIONS-PROJECT-NODE24-002
 */
function checkWorkflows() {
  const diagnostics = workflowRoot ? [] : checkoutByteDiagnostics();
  const workflowFixturePath = fixtureCurrentPath(fixturePath);
  const publishingFixturePath = fixtureCurrentPath(releasePublishingFixturePath);
  const fixture = readJson(workflowFixturePath);
  const releasePublishingFixture = readJson(publishingFixturePath);
  const expected = {
    '.github/workflows/ci.yml': {
      blobId: '9d50637ca015041aa6ab5b9e18dd5b2b30811dad',
      sourceSha256: '7e33bf761781450ff6bbc26107436fbe7ec75afa11592451a3e914fe4b0a8f91',
    },
    '.github/workflows/release.yml': {
      blobId: '9dcf0a6cfeaa855c67127e2af112a43fb0896292',
      sourceSha256: '8270e75010fedb0411dfeb60d6a3af0144ab3c5ce3f2405f01b04a512cef2e03',
    },
    '.github/workflows/npm-publish.yml': {
      blobId: '10f3101d44661d44d8cc3e1ab270841d2ccc6a3f',
      sourceSha256: '8f96f689963fd720ea9155203e2933aebf1f160a8d0b94911113b1ca81859610',
    },
  };
  if (fixture.schemaVersion !== 1 || fixture.baselineCommit !== '7f1f45297a5bef4413257c42071c12fba91cc9e8') {
    diagnostics.push(diagnostic('WORKFLOW_BASELINE_SCHEMA', 'Invalid workflow baseline fixture identity.', fixturePath));
    return diagnostics;
  }
  const reviewedReleasePublishing = {
    '.github/workflows/release.yml': {
      priorCommit: '46edcde9209cc2708c5d6669c98af9e55aa7c7cb',
      priorBlobId: 'a0013a4f5530c84f812242664523ea965dd67306',
      priorSourceSha256: '30aaa213cf5ed8158e374f5e9b71ac8dd3a7eb1c0551d5e274b9e6f8b3183f6a',
      changedLines: 3,
    },
    '.github/workflows/npm-publish.yml': {
      priorCommit: '46edcde9209cc2708c5d6669c98af9e55aa7c7cb',
      priorBlobId: 'ccb30e3b980a93fa9c323fb81944e5253257f2d7',
      priorSourceSha256: '4ccb354eb54c11ac9e8bf9b7d7925aad95d78292f985cad5e57367108733e616',
      changedLines: 1,
    },
  };
  if (releasePublishingFixture.schemaVersion !== 1
    || releasePublishingFixture.approvedChange !== 'CHANGE-0047') {
    diagnostics.push(diagnostic(
      'WORKFLOW_REVIEWED_BASELINE',
      'Invalid reviewed release publishing workflow baseline.',
      publishingFixturePath,
    ));
  }
  let changes;
  try {
    changes = parseInputChanges();
  } catch (error) {
    diagnostics.push(diagnostic('WORKFLOW_INPUT_CHANGE_TABLE', error instanceof Error ? error.message : String(error), changePath));
    changes = [];
  }
  for (const path of workflowPaths) {
    const record = fixture.workflows?.find((candidate) => candidate.path === path);
    if (!record || record.blobId !== expected[path].blobId
      || record.sourceSha256 !== expected[path].sourceSha256
      || sourceSha256(record.source) !== record.sourceSha256) {
      diagnostics.push(diagnostic('WORKFLOW_BASELINE_PROVENANCE', `Invalid baseline provenance for ${path}.`, workflowFixturePath));
      continue;
    }
    if (Object.hasOwn(reviewedReleasePublishing, path)) {
      const reviewed = reviewedReleasePublishing[path];
      const publishingRecord = releasePublishingFixture.workflows?.find((candidate) => candidate.path === path);
      const currentSource = readFileSync(currentPath(path), 'utf8');
      if (!publishingRecord
        || publishingRecord.priorCommit !== reviewed.priorCommit
        || publishingRecord.priorBlobId !== reviewed.priorBlobId
        || publishingRecord.priorSourceSha256 !== reviewed.priorSourceSha256
        || typeof publishingRecord.priorSource !== 'string'
        || !publishingRecord.priorSource.endsWith('\n')
        || sourceSha256(publishingRecord.priorSource) !== reviewed.priorSourceSha256
        || gitBlobId(publishingRecord.priorSource) !== reviewed.priorBlobId) {
        diagnostics.push(diagnostic(
          'WORKFLOW_REVIEWED_BASELINE',
          `Invalid reviewed publishing provenance for ${path}.`,
          publishingFixturePath,
        ));
        continue;
      }
      if (publishingRecord.sourceSha256 !== sourceSha256(currentSource)) {
        diagnostics.push(diagnostic('WORKFLOW_PROTECTED_DRIFT', `Protected workflow behavior changed in ${path}.`, path));
        continue;
      }
      const priorLines = publishingRecord.priorSource.split('\n');
      const currentLines = currentSource.split('\n');
      const differences = priorLines.flatMap((line, index) =>
        line === currentLines[index] ? [] : [{ prior: line, current: currentLines[index] }]);
      if (priorLines.length !== currentLines.length
        || differences.length !== reviewed.changedLines
        || differences.some(({ prior, current }) => {
          const match = /^(\s*)node-version: 22$/.exec(prior);
          return !match || current !== `${match[1]}node-version: 24`;
        })) {
        diagnostics.push(diagnostic('WORKFLOW_PROTECTED_DRIFT', `Protected workflow behavior changed in ${path}.`, path));
      }
      continue;
    }
    const baseline = normalizeUses(parse(record.source));
    const current = normalizeUses(parse(readFileSync(currentPath(path), 'utf8')));
    const currentCore = current.jobs?.['core-portability'];
    const currentCoreVersions = (currentCore?.steps ?? [])
      .filter((step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/setup-node@'))
      .map((step) => String(step.with?.['node-version']));
    if (currentCore?.name !== 'Core (${{ matrix.os }}, Node 24)'
      || JSON.stringify(currentCoreVersions) !== JSON.stringify(['24'])) {
      diagnostics.push(diagnostic('WORKFLOW_PROTECTED_DRIFT', `Protected workflow behavior changed in ${path}.`, path));
      continue;
    }
    currentCore.name = baseline.jobs['core-portability'].name;
    const baselineSetupNode = baseline.jobs['core-portability'].steps.find((step) =>
      typeof step?.uses === 'string' && step.uses.startsWith('actions/setup-node@'));
    const currentSetupNode = currentCore.steps.find((step) =>
      typeof step?.uses === 'string' && step.uses.startsWith('actions/setup-node@'));
    currentSetupNode.with['node-version'] = baselineSetupNode.with['node-version'];
    try {
      applyInputChanges(baseline, current, changes);
    } catch (error) {
      diagnostics.push(diagnostic('WORKFLOW_INPUT_CHANGE_TABLE', error instanceof Error ? error.message : String(error), changePath));
    }
    if (JSON.stringify(current) !== JSON.stringify(baseline)) {
      diagnostics.push(diagnostic('WORKFLOW_PROTECTED_DRIFT', `Protected workflow behavior changed in ${path}.`, path));
    }
  }
  const release = parse(readFileSync(currentPath('.github/workflows/release.yml'), 'utf8'));
  const publish = parse(readFileSync(currentPath('.github/workflows/npm-publish.yml'), 'utf8'));
  if (JSON.stringify(setupNodeVersions(release)) !== JSON.stringify(['24', '24', '24'])
    || JSON.stringify(setupNodeVersions(publish)) !== JSON.stringify(['24'])) {
    diagnostics.push(diagnostic(
      'WORKFLOW_PROTECTED_DRIFT',
      'Primary publishing workflows must use Node.js 24 for every setup-node step.',
      '.github/workflows/release.yml',
    ));
  }
  const packageJson = readJson('package.json');
  if (Object.hasOwn(packageJson, 'packageManager')) {
    diagnostics.push(diagnostic('SETUP_NODE_CACHE_DRIFT', 'package.json must omit packageManager for setup-node v5 cache compatibility.', 'package.json'));
  }
  const contract = artifactContract(release);
  const expectedContract = {
    releaseUpload: 'release-assets/',
    attestDownload: 'release-assets',
    attestationUpload: 'release-assets/musubix3-attestation.json',
    releaseAssetsDownload: 'release-assets',
    attestationDownload: 'release-assets',
    publishDownloadsGithubRelease: true,
    attestConsumesReleaseAssets: true,
    githubReleaseConsumesAssets: true,
    publishConsumesAssets: true,
  };
  if (JSON.stringify(contract) !== JSON.stringify(expectedContract)) {
    diagnostics.push(diagnostic('RELEASE_ARTIFACT_CONTRACT', 'Release artifact upload, download, or consumer paths changed.', '.github/workflows/release.yml'));
  }
  return diagnostics;
}

/** @id CODE-GITHUB-ACTIONS-NODE24-RUNTIME-003
 * @implements REQ-GITHUB-ACTIONS-NODE24-RUNTIME-003 REQ-GITHUB-ACTIONS-PROJECT-NODE24-003
 * @design DES-GITHUB-ACTIONS-NODE24-RUNTIME-003 DES-GITHUB-ACTIONS-PROJECT-NODE24-003
 */
function checkRunners() {
  const diagnostics = [];
  const ci = parse(readFileSync(currentPath('.github/workflows/ci.yml'), 'utf8'));
  const release = parse(readFileSync(currentPath('.github/workflows/release.yml'), 'utf8'));
  const publish = parse(readFileSync(currentPath('.github/workflows/npm-publish.yml'), 'utf8'));
  const matrix = ci.jobs?.['core-portability']?.strategy?.matrix?.os;
  if (JSON.stringify(matrix) !== JSON.stringify(['ubuntu-latest', 'windows-latest', 'macos-latest'])) {
    diagnostics.push(diagnostic('RUNNER_MATRIX_DRIFT', 'Core portability runner matrix changed.', '.github/workflows/ci.yml'));
  }
  for (const [path, workflow] of [
    ['.github/workflows/ci.yml', ci],
    ['.github/workflows/release.yml', release],
    ['.github/workflows/npm-publish.yml', publish],
  ]) {
    for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
      if (path.endsWith('/ci.yml') && name === 'core-portability') continue;
      if (job['runs-on'] !== 'ubuntu-latest') {
        diagnostics.push(diagnostic('RUNNER_POLICY_DRIFT', `${path} job ${name} must use ubuntu-latest.`, path));
      }
    }
  }
  const englishPath = projectDocumentPath('README.md');
  const japanesePath = projectDocumentPath('README-ja.md');
  const english = readFileSync(englishPath, 'utf8');
  const japanese = readFileSync(japanesePath, 'utf8');
  const anchors = [
    [english, 'GitHub-hosted runner policy'],
    [english, '`ubuntu-latest`, `windows-latest`, and `macos-latest`'],
    [english, 'hosted runner image changes'],
    [japanese, 'GitHub-hosted runner ポリシー'],
    [japanese, '`ubuntu-latest`、`windows-latest`、`macos-latest`'],
    [japanese, 'hosted runner image が変更'],
  ];
  if (anchors.some(([text, anchor]) => !text.replace(/\s+/g, ' ').includes(anchor))) {
    diagnostics.push(diagnostic('RUNNER_POLICY_DOCUMENTATION', 'Hosted runner policy documentation is incomplete.', 'README.md'));
  }
  const statements = [
    [englishPath, english, '- Core CI covers Node 24 on Linux, Windows, and macOS, while the Linux compatibility matrix tests Node 20 and Node 24.'],
    [englishPath, english, "  The actions' Node.js 24 implementation runtime is independent of the Node.js 20/24 versions tested for this package."],
    [englishPath, english, 'Core CI runs on Node 24 across Linux, Windows, and macOS, while the Linux compatibility matrix tests Node 20 and Node 24.'],
    [japanesePath, japanese, '- Core CIはNode 24をLinux、Windows、macOSで実行し、LinuxではNode 20/24の互換性も検証します。'],
    [japanesePath, japanese, '  Action 自体の Node.js 24 runtime は、package が検証する Node.js 20/24 とは別のものです。'],
    [japanesePath, japanese, 'Core CIはNode 24をLinux、Windows、macOSで実行し、Linuxのcompatibility matrixではNode 20とNode 24を検証します。'],
  ];
  for (const [path, source, statement] of statements) {
    if (!source.split(/\r?\n/).includes(statement)) {
      diagnostics.push(diagnostic(
        'PROJECT_NODE24_DOCUMENTATION',
        `${path} is missing exact project Node.js 24 statement: ${statement}`,
        path,
      ));
    }
  }
  return diagnostics;
}

/** @id CODE-GITHUB-ACTIONS-PROJECT-NODE24-EVIDENCE-001
 * @implements REQ-GITHUB-ACTIONS-PROJECT-NODE24-003
 * @design DES-GITHUB-ACTIONS-PROJECT-NODE24-003
 */
function checkProjectNode24Evidence() {
  const diagnostics = [];
  if (!existsSync(projectNode24ChangePath)) {
    return [diagnostic(
      'CHANGE_PROJECT_NODE24_EVIDENCE',
      'CHANGE-0047 evidence file is missing.',
      projectNode24ChangePath,
    )];
  }
  const source = readFileSync(projectNode24ChangePath, 'utf8');
  const frontMatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? '';
  const status = /^status:\s*(\S+)\s*$/m.exec(frontMatter)?.[1];
  const completedUrl = /^https:\/\/github\.com\/nahisaho\/musubix3\/actions\/runs\/\d+$/;
  const completedDeferred = /^https:\/\/github\.com\/nahisaho\/musubix3\/actions\/runs\/\d+; Node\.js 20 warning: absent$/;
  const anchors = [
    ['Post-merge CI run:', 'pending until the first merged CI execution.', completedUrl],
    ['Core ubuntu-latest conclusion:', 'pending.', /^success$/],
    ['Core windows-latest conclusion:', 'pending.', /^success$/],
    ['Core macos-latest conclusion:', 'pending.', /^success$/],
    ['Deferred release evidence:', 'pending until the next natural release execution.', completedDeferred],
    ['Deferred npm-publish evidence:', 'pending until the next natural publication.', completedDeferred],
  ];
  for (const [anchor, pending, completed] of anchors) {
    const matches = [...source.matchAll(new RegExp(`^- ${anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (.+)$`, 'gm'))];
    const value = matches[0]?.[1];
    const deferred = anchor.startsWith('Deferred ');
    const validValue = value === pending || (value !== undefined && completed.test(value));
    if (matches.length !== 1
      || !validValue
      || (status === 'completed' && !deferred && value === pending)) {
      diagnostics.push(diagnostic(
        'CHANGE_PROJECT_NODE24_EVIDENCE',
        `CHANGE-0047 has invalid or duplicate ${anchor} evidence.`,
        projectNode24ChangePath,
      ));
    }
  }
  return diagnostics;
}

function checkEvidence() {
  const diagnostics = checkProjectNode24Evidence();
  const change = readFileSync(changePath, 'utf8').replace(/\s+/g, ' ');
  const required = [
    'Requirements approval was recorded',
    'Design approval was recorded',
    'real failing Red and passing Green',
    'Strict trace coverage is design 1.0, implementation 1.0, and tests 1.0',
    'changed quality gate passed all required non-approval checks',
    'Deferred release/npm-publish evidence:',
  ];
  for (const text of required) {
    if (!change.includes(text)) {
      diagnostics.push(diagnostic('CHANGE_EVIDENCE_INCOMPLETE', `CHANGE-0021 is missing evidence text: ${text}.`, changePath));
    }
  }
  if (!/\b\d+ passed\/\d+ skipped tests\b/.test(change)) {
    diagnostics.push(diagnostic('CHANGE_EVIDENCE_INCOMPLETE', 'CHANGE-0021 is missing the full test result counts.', changePath));
  }
  const postMerge = /Post-merge CI evidence: (?:pending\b|https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/(\d+)\b)/.exec(change);
  if (!postMerge) {
    diagnostics.push(diagnostic('CHANGE_EVIDENCE_INCOMPLETE', 'CHANGE-0021 is missing post-merge CI status or a run URL.', changePath));
  } else if (postMerge[1]
    && (!change.includes(`gh run view ${postMerge[1]} --log`)
      || !change.includes('The following actions target Node.js 20'))) {
    diagnostics.push(diagnostic('CHANGE_EVIDENCE_INCOMPLETE', 'Completed post-merge CI evidence must include the exact log command and warning text.', changePath));
  }
  return diagnostics;
}

const check = process.argv[2];
if (check === 'lock') report(checkLock());
else if (check === 'workflows') report(checkWorkflows());
else if (check === 'runners') report(checkRunners());
else if (check === 'evidence') report(checkEvidence());
else {
  process.stderr.write('Usage: node scripts/check-github-actions.mjs <lock|workflows|runners|evidence>\n');
  process.exitCode = 2;
}
