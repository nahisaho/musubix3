import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.github/workflows/npm-publish.yml',
];
const lockPath = 'scripts/github-actions-lock.json';
const fixturePath = 'tests/fixtures/github-actions-node24-runtime/baseline.json';
const workflowRoot = process.env.GITHUB_ACTIONS_WORKFLOW_ROOT;
const changePath = process.env.GITHUB_ACTIONS_CHANGE_PATH ?? '.musubix/changes/CHANGE-0021.md';
const shaPattern = /^[0-9a-f]{40}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function currentPath(path) {
  return workflowRoot ? resolve(workflowRoot, path) : path;
}

function diagnostic(code, message, path) {
  return { code, message, ...(path ? { path } : {}) };
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
 * @implements REQ-GITHUB-ACTIONS-NODE24-RUNTIME-001
 * @design DES-GITHUB-ACTIONS-NODE24-RUNTIME-001
 */
function checkLock() {
  const diagnostics = [];
  const lock = readJson(lockPath);
  const fixture = readJson(fixturePath);
  if (lock.schemaVersion !== 1 || !Array.isArray(lock.actions)) {
    return [diagnostic('ACTION_LOCK_SCHEMA', 'Action lock must use schemaVersion 1 with an actions array.', lockPath)];
  }
  const references = workflowPaths.flatMap(actionReferences);
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
  const publishDownload = actionStep('npm-publish', 'actions/download-artifact', 'release-assets');
  return {
    releaseUpload: releaseUpload?.with?.path,
    attestDownload: attestDownload?.with?.path,
    attestationUpload: attestationUpload?.with?.path,
    releaseAssetsDownload: releaseAssetsDownload?.with?.path,
    attestationDownload: attestationDownload?.with?.path,
    publishDownload: publishDownload?.with?.path,
    attestConsumesReleaseAssets: runText('attest').includes('release:attest -- release-assets'),
    githubReleaseConsumesAssets: runText('github-release').includes('release-assets/*'),
    publishConsumesAssets: runText('npm-publish').includes('release:publish -- release-assets'),
  };
}

/** @id CODE-GITHUB-ACTIONS-NODE24-RUNTIME-002
 * @implements REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002
 * @design DES-GITHUB-ACTIONS-NODE24-RUNTIME-002
 */
function checkWorkflows() {
  const diagnostics = [];
  const fixture = readJson(fixturePath);
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
      diagnostics.push(diagnostic('WORKFLOW_BASELINE_PROVENANCE', `Invalid baseline provenance for ${path}.`, fixturePath));
      continue;
    }
    const baseline = normalizeUses(parse(record.source));
    const current = normalizeUses(parse(readFileSync(currentPath(path), 'utf8')));
    try {
      applyInputChanges(baseline, current, changes);
    } catch (error) {
      diagnostics.push(diagnostic('WORKFLOW_INPUT_CHANGE_TABLE', error instanceof Error ? error.message : String(error), changePath));
    }
    if (JSON.stringify(current) !== JSON.stringify(baseline)) {
      diagnostics.push(diagnostic('WORKFLOW_PROTECTED_DRIFT', `Protected workflow behavior changed in ${path}.`, path));
    }
  }
  const packageJson = readJson('package.json');
  if (Object.hasOwn(packageJson, 'packageManager')) {
    diagnostics.push(diagnostic('SETUP_NODE_CACHE_DRIFT', 'package.json must omit packageManager for setup-node v5 cache compatibility.', 'package.json'));
  }
  const contract = artifactContract(parse(readFileSync(currentPath('.github/workflows/release.yml'), 'utf8')));
  const expectedContract = {
    releaseUpload: 'release-assets/',
    attestDownload: 'release-assets',
    attestationUpload: 'release-assets/musubix3-attestation.json',
    releaseAssetsDownload: 'release-assets',
    attestationDownload: 'release-assets',
    publishDownload: 'release-assets',
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
 * @implements REQ-GITHUB-ACTIONS-NODE24-RUNTIME-003
 * @design DES-GITHUB-ACTIONS-NODE24-RUNTIME-003
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
  const english = readFileSync('README.md', 'utf8');
  const japanese = readFileSync('README-ja.md', 'utf8');
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
  return diagnostics;
}

function checkEvidence() {
  const diagnostics = [];
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
