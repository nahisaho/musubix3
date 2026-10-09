import assert from 'node:assert/strict';
import { firstPackEntry } from './pack-json.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  inspectReleaseVersionSurfaces,
  ReleaseVersionValidationError,
} from './release-version.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** @id CODE-RELEASE-VERSION-SYNCHRONIZATION-004
 * @implements REQ-RELEASE-VERSION-SYNCHRONIZATION-006
 * @design DES-RELEASE-VERSION-SYNCHRONIZATION-004
 */
export function checkPackage(directory = root) {
  const pkg = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  const inspected = inspectReleaseVersionSurfaces(directory, pkg.version);
  if (!inspected.report.valid) throw new ReleaseVersionValidationError(inspected.report);

  const npmCli = process.env.npm_execpath;
  assert(npmCli, 'Run this check through npm so npm_execpath is available.');
  const pack = firstPackEntry(execFileSync(process.execPath, [
    npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts',
  ], { cwd: directory, encoding: 'utf8' }));
  const files = new Set(pack.files.map((file) => file.path));
  const manifest = JSON.parse(readFileSync(resolve(directory, 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(readFileSync(resolve(directory, '.github/plugin/marketplace.json'), 'utf8'));
  assert.equal(manifest.skills, '.github/skills/');
  assert.equal(marketplace.plugins[0].source, '.');
  assert.equal(marketplace.plugins[0].name, manifest.name);
  const skills = ['change', 'requirements', 'design', 'implementation', 'traceability', 'quality', 'knowledge', 'formal-codegraph', 'issue-report'];
  for (const required of [
    'plugin.json', '.github/plugin/marketplace.json', pkg.bin.musubix3,
    'dist/packages/domain/src/index.js', 'dist/packages/analysis/src/index.js',
    'dist/packages/analysis/src/attestation.js',
    'assets/constitution.md', 'assets/requirements.md', 'assets/design.md', 'assets/ADR-0001.md',
    'README.md', 'README-ja.md', 'LICENSE',
    ...skills.map((name) => `.github/skills/sdd-${name}/SKILL.md`),
  ]) assert(files.has(required), `Package is missing ${required}`);
  assert(![...files].some((path) => path.startsWith('tests/') || path.startsWith('.test-work/')));
  const message = `Package verified: ${pack.filename}, ${files.size} files, ${skills.length} skills.`;
  console.log(message);
  return { pack, files, skills };
}

/** @id CODE-CHANGE-EVIDENCE-WAIVER-030
 * @implements REQ-CHANGE-EVIDENCE-WAIVER-019
 * @design DES-CHANGE-EVIDENCE-WAIVER-007
 * Independent of `checkPackage`: never called from inside it, never
 * changes its signature/synchrony/contract. Dynamically imports the
 * packaged `change-waiver.js` (ESM, so only dynamic `import()` can load
 * it) and functionally asserts the CHANGE-0028/CHANGE-0029
 * severity-downgrade fix for a resolved (`condition: 'false'`)
 * `CHANGE_WAIVER_STALE` scope is present, reproducing the exact gap
 * Issue #55 found in the published `musubix3@0.1.20` package.
 */
export async function assertWaiverStaleSeverityFix(directory) {
  const waiverModuleUrl = pathToFileURL(resolve(directory, 'dist/packages/analysis/src/change-waiver.js')).href;
  const { reportWaiverEvidenceDiagnostics } = await import(waiverModuleUrl);
  assert.equal(
    typeof reportWaiverEvidenceDiagnostics,
    'function',
    `${waiverModuleUrl} does not export reportWaiverEvidenceDiagnostics; cannot verify the Issue #55 waiver stale-severity fix.`,
  );
  const record = {
    changeId: 'CHANGE-0000',
    code: 'CHANGE_REQUIREMENTS_UNCHANGED',
    approver: 'pack-check',
    reason: 'Synthetic resolved-debt scope used only to verify the packaged severity-downgrade fix.',
    recordedAt: new Date(0).toISOString(),
    snapshotVersion: 1,
    snapshotHash: 'synthetic-before',
    order: 1,
    previousSha256: '0'.repeat(64),
    payloadSha256: '1'.repeat(64),
  };
  const waiverContext = {
    loaded: { schemaVersion: 1, waivers: [record], malformed: false },
    order: { valid: true, records: [] },
    linkage: [{ valid: true }],
    currentHash: ['synthetic-after'],
    condition: ['false'],
  };
  const diagnostics = reportWaiverEvidenceDiagnostics(waiverContext);
  const stale = diagnostics.filter((diagnostic) => diagnostic.code === 'CHANGE_WAIVER_STALE');
  const matches = stale.length === 1
    && stale[0].severity === 'warning'
    && typeof stale[0].message === 'string'
    && stale[0].message.includes('replacement waiver is not required');
  if (!matches) {
    throw new Error(
      `Packaged ${waiverModuleUrl} failed the Issue #55 waiver stale-severity regression check: expected exactly `
      + 'one CHANGE_WAIVER_STALE diagnostic with severity "warning" and a message containing '
      + `"replacement waiver is not required" for a resolved (condition=false) waiver scope, but got `
      + `${JSON.stringify(diagnostics)}. Rebuild dist before packaging/publishing.`,
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkPackage();
  } catch (error) {
    if (!(error instanceof ReleaseVersionValidationError)) throw error;
    process.stderr.write(`${JSON.stringify(error.report)}\n`);
    process.exitCode = 1;
  }
  try {
    await assertWaiverStaleSeverityFix(root);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
