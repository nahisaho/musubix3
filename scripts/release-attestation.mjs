import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configPath = resolve(root, '.musubix/config.json');
const attestationPath = resolve(root, '.musubix/evidence/attestation.json');

function runCli(args) {
  return execFileSync(process.execPath, [resolve(root, 'dist/packages/cli/src/main.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
}

function requiredEnvironment(name) {
  const value = process.env[name];
  assert(value, `${name} is required`);
  return value;
}

async function requestOidcToken(audience) {
  const requestUrl = new URL(requiredEnvironment('ACTIONS_ID_TOKEN_REQUEST_URL'));
  assert.equal(requestUrl.protocol, 'https:', 'GitHub OIDC request URL must use HTTPS');
  requestUrl.searchParams.set('audience', audience);
  const response = await fetch(requestUrl, {
    headers: { Authorization: `Bearer ${requiredEnvironment('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}` },
  });
  assert(response.ok, `GitHub OIDC token request failed with HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(typeof body.value, 'string', 'GitHub OIDC response did not contain a token');
  return body.value;
}

export async function createGithubAttestation(outputDirectory = 'release-assets') {
  assert.equal(requiredEnvironment('GITHUB_ACTIONS'), 'true', 'attestation must run in GitHub Actions');
  assert.equal(requiredEnvironment('GITHUB_REPOSITORY'), 'nahisaho/musubix3', 'unexpected GitHub repository');
  const runId = requiredEnvironment('GITHUB_RUN_ID');
  const sha = requiredEnvironment('GITHUB_SHA').toLowerCase();
  assert.match(sha, /^[a-f0-9]{40}$/, 'GITHUB_SHA must be a full commit SHA');
  const workflow = requiredEnvironment('GITHUB_WORKFLOW');
  const ref = requiredEnvironment('GITHUB_REF');
  const keyId = `github-run-${runId}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`;
  const work = resolve(root, '.test-work/release-attestation');
  const privateKeyPath = resolve(work, 'private.pem');
  const publicKeyPath = resolve(work, 'public.pem');
  const tokenPath = resolve(work, 'oidc.jwt');
  const previousConfig = existsSync(configPath) ? readFileSync(configPath) : null;
  const previousAttestation = existsSync(attestationPath) ? readFileSync(attestationPath) : null;

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(dirname(configPath), { recursive: true });
  mkdirSync(dirname(attestationPath), { recursive: true });
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    chmodSync(privateKeyPath, 0o600);
    writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
    writeFileSync(configPath, `${JSON.stringify({
      schemaVersion: 1,
      attestation: {
        mode: 'ci-required',
        repository: 'nahisaho/musubix3',
        maxAgeSeconds: 600,
        maxFutureSkewSeconds: 60,
        trustedPublicKeys: [],
        githubOidc: {
          mode: 'strict',
          audience: 'https://github.com/nahisaho/musubix3/attestation',
          repository: 'nahisaho/musubix3',
          workflow,
          ref,
          keyBinding: 'public-key',
        },
      },
    }, null, 2)}\n`);

    const audienceResult = JSON.parse(runCli([
      'attestation', 'oidc-audience', '--key-id', keyId,
      '--public-key-file', '.test-work/release-attestation/public.pem', '--json',
    ]));
    const token = await requestOidcToken(audienceResult.audience);
    writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });

    const payload = JSON.parse(runCli([
      'attestation', 'payload', '--provider', 'github', '--run-id', runId,
      '--key-id', keyId, '--public-key-file', '.test-work/release-attestation/public.pem',
      '--github-oidc-token-file', '.test-work/release-attestation/oidc.jwt', '--json',
    ]));
    assert.equal(payload.unsigned.repository, 'nahisaho/musubix3');
    assert.equal(payload.unsigned.commitSha, sha);
    const signature = sign(null, Buffer.from(payload.signingPayload), privateKey).toString('base64');
    writeFileSync(attestationPath, `${JSON.stringify({ ...payload.unsigned, signature }, null, 2)}\n`);

    rmSync(privateKeyPath, { force: true });
    rmSync(work, { recursive: true, force: true });
    const verification = JSON.parse(runCli(['attestation', 'verify', '--json']));
    assert.equal(verification.valid, true, JSON.stringify(verification.diagnostics));
    assert.equal(verification.trust, 'github-oidc-ephemeral-key');

    const outputPath = resolve(root, outputDirectory, 'musubix3-attestation.json');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, readFileSync(attestationPath));
    return { outputPath, verification };
  } finally {
    rmSync(privateKeyPath, { force: true });
    rmSync(work, { recursive: true, force: true });
    if (previousConfig) writeFileSync(configPath, previousConfig);
    else rmSync(configPath, { force: true });
    if (previousAttestation) writeFileSync(attestationPath, previousAttestation);
    else rmSync(attestationPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createGithubAttestation(process.argv[2] ?? 'release-assets')
    .then((result) => console.log(JSON.stringify(result.verification, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack : error);
      process.exitCode = 1;
    });
}
