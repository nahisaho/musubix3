import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'release-assets');
const tarballs = readdirSync(directory).filter((name) => name.endsWith('.tgz'));
assert.equal(tarballs.length, 1, `expected one npm tarball in ${directory}`);
const npmCli = process.env.npm_execpath;
assert(npmCli, 'Run release publishing through npm so npm_execpath is available.');
const environment = { ...process.env };
if (!environment.NODE_AUTH_TOKEN) delete environment.NODE_AUTH_TOKEN;
execFileSync(process.execPath, [
  npmCli, 'publish', resolve(directory, tarballs[0]), '--provenance', '--access', 'public',
], { stdio: 'inherit', env: environment });
