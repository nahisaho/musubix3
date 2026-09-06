import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = resolve('.');
const work = resolve('.test-work', `package-${randomUUID()}`);
const consumer = resolve(work, 'consumer');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
mkdirSync(consumer, { recursive: true });
try {
  const packed = JSON.parse(execFileSync(npmCommand, ['pack', '--json', '--ignore-scripts', '--pack-destination', work], { cwd: root, encoding: 'utf8' }))[0];
  writeFileSync(resolve(consumer, 'package.json'), '{"name":"musubix3-smoke-consumer","private":true,"type":"module"}\n');
  execFileSync(npmCommand, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false', resolve(work, packed.filename)], { cwd: consumer, stdio: 'pipe' });
  const executable = resolve(consumer, 'node_modules/musubix3/dist/packages/cli/src/main.js');
  const run = (args) => execFileSync(process.execPath, [executable, ...args], { cwd: consumer, encoding: 'utf8' });
  const version = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version;
  assert.equal(run(['--version']).trim(), version);
  assert.equal(JSON.parse(run(['init', '--dry-run', '--json'])).dryRun, true);
  assert(!existsSync(resolve(consumer, '.musubix')));
  run(['init', '--json']);
  assert(existsSync(resolve(consumer, '.github/skills/sdd-formal-codegraph/SKILL.md')));
  assert.equal(JSON.parse(run(['status', '--json'])).initialized, true);
  execFileSync(process.execPath, ['--input-type=module', '-e', "const {validateRequirements}=await import('musubix3/domain'); if (!validateRequirements('## REQ-SMOKE-001: Smoke\\nStatement: The system shall respond.').valid) process.exit(1);"], { cwd: consumer, stdio: 'pipe' });
  execFileSync(process.execPath, ['--input-type=module', '-e', "const {githubOidcAudience}=await import('musubix3/attestation'); if (!githubOidcAudience('urn:smoke','key-id','key').includes('musubix3-key-id=key')) process.exit(1);"], { cwd: consumer, stdio: 'pipe' });
  const plugin = JSON.parse(readFileSync(resolve(consumer, 'node_modules/musubix3/plugin.json'), 'utf8'));
  assert.equal(plugin.skills, '.github/skills/');
  console.log(`Installed tarball verified: executable bin, ESM exports, init, status, assets, and hidden skills (${version}).`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
