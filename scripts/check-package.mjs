import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const pack = JSON.parse(execFileSync(process.execPath, [
    npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts',
  ], { cwd: directory, encoding: 'utf8' }))[0];
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkPackage();
  } catch (error) {
    if (!(error instanceof ReleaseVersionValidationError)) throw error;
    process.stderr.write(`${JSON.stringify(error.report)}\n`);
    process.exitCode = 1;
  }
}
