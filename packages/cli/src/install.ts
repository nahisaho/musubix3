// CHANGE-0038: scaffold install no longer copies stale canonical graph into new feature trace.json (DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001).
// CHANGE-0038 (corrective Red-Implementation-Green batch): re-proved TDD evidence inside the change's valid order window.
// CHANGE-0038 (2nd corrective batch): confirmed by expanded acceptance-clause test coverage; no behavior change.
// CHANGE-0038 (3rd corrective batch): install now restores a missing canonical
// graph and uses the change-detecting writer for the feature trace too.
// CHANGE-0038 (4th corrective batch): genuinely reports 'replace' (not stale
// 'preserve') when canonical-missing recovery actually rewrites the feature
// trace; proved via temporary regression injection.
// CHANGE-0038 (5th corrective batch): the same 'replace'-reporting fix above
// is also attributed to REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002, since
// CODE-SCOPED-FEATURE-TRACE-ARTIFACTS-008 implements both requirements.
import { readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertCoordinatedEvidenceRead,
  buildTrace,
  canonicalSort,
  canonicalTracePath,
  defaultConfig,
  defaultPolicyBaseline,
  exists,
  featureTraceProjection,
  readText,
  safePath,
  writeJson,
  writeText,
  writeTraceIfChanged,
  runProcess,
  withEvidenceWriterLock,
  type Runner,
} from '../../analysis/src/index.js';

export const skillNames = ['sdd-change', 'sdd-requirements', 'sdd-design', 'sdd-implementation', 'sdd-traceability', 'sdd-quality', 'sdd-knowledge', 'sdd-formal-codegraph', 'sdd-issue-report'] as const;

export interface InstallAction {
  path: string;
  action: 'create' | 'replace' | 'preserve' | 'unchanged' | 'merge';
}

export async function install(root: string, packageRoot: string, options: { dryRun?: boolean; force?: boolean; feature?: string } = {}): Promise<{ dryRun: boolean; actions: InstallAction[] }> {
  root = resolve(root);
  if (options.dryRun) {
    if (await exists(root)) await assertCoordinatedEvidenceRead(root);
    return installUnlocked(root, packageRoot, options);
  }
  return withEvidenceWriterLock(root, 'init', () => installUnlocked(root, packageRoot, options));
}

async function installUnlocked(root: string, packageRoot: string, options: { dryRun?: boolean; force?: boolean; feature?: string }): Promise<{ dryRun: boolean; actions: InstallAction[] }> {
  const feature = options.feature ?? 'example';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature)) throw new Error('Feature slug must be lowercase kebab-case.');
  const planned = new Map<string, string>();
  for (const name of skillNames) {
    const directory = `.github/skills/${name}`;
    const entries = await readdir(resolve(packageRoot, directory), { withFileTypes: true });
    // Bundled skills intentionally contain no executable scripts.
    for (const entry of entries) {
      if (!entry.isFile()) throw new Error(`Unexpected skill asset: ${directory}/${entry.name}`);
      planned.set(`${directory}/${entry.name}`, await readText(packageRoot, `${directory}/${entry.name}`));
    }
  }
  planned.set('.musubix/config.json', `${JSON.stringify(defaultConfig, null, 2)}\n`);
  planned.set('.musubix/policy-baseline.json', `${JSON.stringify(defaultPolicyBaseline, null, 2)}\n`);
  planned.set('.musubix/constitution.md', await readText(packageRoot, 'assets/constitution.md'));
  const featureAsset = async (name: string): Promise<string> => (await readText(packageRoot, `assets/${name}.md`))
    .replace(/feature: example/g, `feature: ${feature}`)
    .replace(/(REQ|DES)-EXAMPLE-/g, `$1-${feature.toUpperCase()}-`);
  planned.set(`.musubix/features/${feature}/requirements.md`, await featureAsset('requirements'));
  planned.set(`.musubix/features/${feature}/design.md`, await featureAsset('design'));
  planned.set('.musubix/decisions/ADR-0001.md', await readText(packageRoot, 'assets/ADR-0001.md'));
  planned.set('.musubix/evidence/quality.json', `${JSON.stringify({ schemaVersion: 1, status: 'skipped', generatedAt: null, checks: [], reason: 'No checks have run. Configure commands and run musubix3 gate.' }, null, 2)}\n`);
  const actions: InstallAction[] = [];
  const writes = new Map<string, string>();
  for (const [path, content] of planned) {
    const absolute = await safePath(root, path);
    const present = await exists(absolute);
    const equal = present && await readText(root, path) === content;
    const action = !present ? 'create' : equal ? 'unchanged' : options.force ? 'replace' : 'preserve';
    actions.push({ path, action });
    if (action === 'create' || action === 'replace') writes.set(path, content);
  }
  const ignorePath = await safePath(root, '.gitignore');
  const oldIgnore = await exists(ignorePath) ? await readText(root, '.gitignore') : '';
  const requiredIgnores = [
    '/.musubix/cache/',
    '/.musubix/evidence/.writer-lock.json',
    '/.musubix/evidence/.writer-lock.*.json',
  ];
  const ignored = new Set(oldIgnore.split(/\r?\n/).map((line) => line.trim()));
  const missingIgnores = requiredIgnores.filter((entry) => !ignored.has(entry));
  if (missingIgnores.length > 0) {
    writes.set('.gitignore', `${oldIgnore}${oldIgnore && !oldIgnore.endsWith('\n') ? '\n' : ''}\n# musubix3 generated coordination files\n${missingIgnores.join('\n')}\n`);
    actions.push({ path: '.gitignore', action: oldIgnore ? 'merge' : 'create' });
  } else actions.push({ path: '.gitignore', action: 'unchanged' });
  /** @id CODE-SCOPED-FEATURE-TRACE-ARTIFACTS-008
   * @implements REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003
   * @design DES-SCOPED-FEATURE-TRACE-ARTIFACTS-002 DES-SCOPED-FEATURE-TRACE-ARTIFACTS-003
   */
  const tracePath = `.musubix/features/${feature}/trace.json`;
  const traceExists = await exists(await safePath(root, tracePath));
  const canonicalExists = await exists(await safePath(root, canonicalTracePath));
  const generateTrace = !traceExists || !canonicalExists || options.force;
  const traceAction: InstallAction = { path: tracePath, action: !traceExists ? 'create' : options.force ? 'replace' : 'preserve' };
  actions.push(traceAction);
  const cachePath = await safePath(root, '.musubix/cache');
  if (!options.dryRun) {
    await mkdir(root, { recursive: true });
    for (const [path, text] of writes) await writeText(root, path, text);
    await mkdir(cachePath, { recursive: true });
    if (generateTrace) {
      const trace = await buildTrace(root, false);
      const traceWritten = await writeTraceIfChanged(root, tracePath, featureTraceProjection(trace, `.musubix/features/${feature}`));
      // A feature trace that already existed (so the action above defaulted to
      // 'preserve') may still be rewritten here when it's regenerated to
      // restore a missing canonical graph; reflect that actual outcome.
      if (traceExists && !options.force && traceWritten) traceAction.action = 'replace';
      await writeJson(root, '.musubix/cache/trace.json', trace);
      await writeTraceIfChanged(root, canonicalTracePath, canonicalSort(trace));
    }
  }
  return { dryRun: options.dryRun ?? false, actions };
}

/* @id CODE-UPGRADE-WORKFLOW-001
 * @implements REQ-UPGRADE-WORKFLOW-001 REQ-UPGRADE-WORKFLOW-002
 * @design DES-UPGRADE-WORKFLOW-001
 */
export async function upgradeSkills(root: string, packageRoot: string, options: { dryRun?: boolean } = {}): Promise<{ dryRun: boolean; actions: InstallAction[] }> {
  root = resolve(root);
  if (options.dryRun) {
    await assertCoordinatedEvidenceRead(root);
    return upgradeSkillsUnlocked(root, packageRoot, options);
  }
  return withEvidenceWriterLock(root, 'upgrade', () => upgradeSkillsUnlocked(root, packageRoot, options));
}

async function upgradeSkillsUnlocked(root: string, packageRoot: string, options: { dryRun?: boolean }): Promise<{ dryRun: boolean; actions: InstallAction[] }> {
  const planned = new Map<string, string>();
  for (const name of skillNames) {
    const directory = `.github/skills/${name}`;
    const entries = await readdir(resolve(packageRoot, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) throw new Error(`Unexpected skill asset: ${directory}/${entry.name}`);
      planned.set(`${directory}/${entry.name}`, await readText(packageRoot, `${directory}/${entry.name}`));
    }
  }
  const actions: InstallAction[] = [];
  const writes = new Map<string, string>();
  for (const [path, content] of planned) {
    const absolute = await safePath(root, path);
    const present = await exists(absolute);
    const equal = present && await readText(root, path) === content;
    const action = !present ? 'create' : equal ? 'unchanged' : 'replace';
    actions.push({ path, action });
    if (action === 'create' || action === 'replace') writes.set(path, content);
  }
  if (!options.dryRun) {
    await mkdir(root, { recursive: true });
    for (const [path, text] of writes) await writeText(root, path, text);
  }
  return { dryRun: options.dryRun ?? false, actions };
}

export async function pluginInstall(packageRoot: string, runner: Runner = runProcess): Promise<Awaited<ReturnType<Runner>>> {
  return runner('copilot', ['plugin', 'install', resolve(packageRoot)], { cwd: resolve(packageRoot), timeoutMs: 120_000 });
}
