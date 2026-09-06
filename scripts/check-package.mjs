import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run this check through npm so npm_execpath is available.');
const pack = JSON.parse(execFileSync(process.execPath, [
  npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts',
], { encoding: 'utf8' }))[0];
const files = new Set(pack.files.map((file) => file.path));
const manifest = JSON.parse(readFileSync('plugin.json', 'utf8'));
const marketplace = JSON.parse(readFileSync('.github/plugin/marketplace.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
assert.equal(manifest.skills, '.github/skills/');
assert.equal(manifest.version, pkg.version);
assert.equal(marketplace.plugins[0].source, '.');
assert.equal(marketplace.plugins[0].name, manifest.name);
assert.equal(marketplace.plugins[0].version, pkg.version);
const skills = ['change', 'requirements', 'design', 'implementation', 'traceability', 'quality', 'knowledge', 'formal-codegraph'];
for (const required of [
  'plugin.json', '.github/plugin/marketplace.json', pkg.bin.musubix3,
  'dist/packages/domain/src/index.js', 'dist/packages/analysis/src/index.js',
  'dist/packages/analysis/src/attestation.js',
  'assets/constitution.md', 'assets/requirements.md', 'assets/design.md', 'assets/ADR-0001.md',
  'README.md', 'README-ja.md', 'LICENSE',
  ...skills.map((name) => `.github/skills/sdd-${name}/SKILL.md`),
]) assert(files.has(required), `Package is missing ${required}`);
assert(![...files].some((path) => path.startsWith('tests/') || path.startsWith('.test-work/')));
console.log(`Package verified: ${pack.filename}, ${files.size} files, ${skills.length} skills.`);
