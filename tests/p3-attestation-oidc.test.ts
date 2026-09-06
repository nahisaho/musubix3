import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  attestationSigningPayload, createUnsignedAttestation, defaultConfig,
  githubOidcAudience, parseConfig, verifyEvidenceAttestation, writeJson,
  runGate, type AttestationConfig, type AttestationFetch, type Runner,
} from '../packages/analysis/src/index.js';
import { fixture, processResult } from './helpers.js';

const issuer = 'https://token.actions.githubusercontent.com';
const jwksUri = 'https://token.actions.githubusercontent.com/.well-known/jwks';
const repository = 'owner/repository';
const commitSha = 'a'.repeat(40);

function gitRunner(): Runner {
  return async (_command, args) => processResult({
    stdout: args[0] === 'config' ? `${repository}.git\n` : `${commitSha}\n`,
  });
}

function jwt(
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  claims: Record<string, unknown>,
  headerOverrides: Record<string, unknown> = {},
): string {
  const header = Buffer.from(JSON.stringify({
    alg: 'RS256', kid: 'github-key', typ: 'JWT', ...headerOverrides,
  })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

function oidcFetch(publicKey: ReturnType<typeof generateKeyPairSync>['publicKey']): AttestationFetch {
  const jwk = publicKey.export({ format: 'jwk' });
  return async (url) => {
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return new Response(JSON.stringify({ issuer, jwks_uri: jwksUri }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url === jwksUri) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'github-key', alg: 'RS256', use: 'sig' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };
}

function strictConfig(overrides: Partial<AttestationConfig['githubOidc']> = {}): AttestationConfig {
  return {
    mode: 'ci-required',
    repository,
    maxAgeSeconds: 600,
    maxFutureSkewSeconds: 30,
    trustedPublicKeys: [],
    githubOidc: {
      mode: 'strict',
      issuer,
      audience: 'https://musubix.dev/attestation',
      keyBinding: 'public-key',
      workflow: 'release.yml',
      ref: 'refs/heads/main',
      ...overrides,
    },
  };
}

describe('P3 attestation freshness and GitHub Actions OIDC provenance', () => {
  it('parses bounded freshness and opt-in strict OIDC configuration', () => {
    expect(defaultConfig.attestation).toMatchObject({
      mode: 'local',
      maxAgeSeconds: 3600,
      maxFutureSkewSeconds: 60,
      trustedPublicKeys: [],
      githubOidc: { mode: 'off' },
    });
    expect(parseConfig({
      schemaVersion: 1,
      attestation: {
        mode: 'ci-required',
        maxAgeSeconds: 300,
        maxFutureSkewSeconds: 10,
        githubOidc: {
          mode: 'strict',
          audience: 'https://musubix.dev/attestation',
          repository,
          workflow: 'release.yml',
          ref: 'refs/heads/main',
          keyBinding: 'public-key',
        },
      },
    }).attestation.githubOidc).toMatchObject({
      mode: 'strict',
      issuer,
      audience: 'https://musubix.dev/attestation',
      repository,
    });
    expect(() => parseConfig({ schemaVersion: 1, attestation: { maxAgeSeconds: 0 } }))
      .toThrow('attestation.maxAgeSeconds');
    expect(() => parseConfig({
      schemaVersion: 1,
      attestation: { githubOidc: { mode: 'strict' } },
    })).toThrow('attestation.githubOidc.audience');
    expect(() => githubOidcAudience(
      'https://musubix.dev/attestation',
      'public-key',
      'run-key',
      '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
    )).toThrow('Private keys are not accepted');
  });

  it('preserves static trusted Ed25519 mode while rejecting stale and future attestations', async () => {
    const root = await fixture({ 'source.txt': 'stable' });
    const runner = gitRunner();
    const now = new Date('2026-09-06T12:00:00.000Z');
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const config: AttestationConfig = {
      mode: 'ci-required',
      repository,
      maxAgeSeconds: 300,
      maxFutureSkewSeconds: 30,
      trustedPublicKeys: [{
        id: 'static-key',
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      }],
      githubOidc: { mode: 'off' },
    };
    const write = async (issuedAt: string): Promise<void> => {
      const unsigned = await createUnsignedAttestation(root, {
        provider: 'github', runId: '42', keyId: 'static-key', issuedAt,
      }, runner);
      await writeJson(root, '.musubix/evidence/attestation.json', {
        ...unsigned,
        signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), privateKey).toString('base64'),
      });
    };

    await write('2026-09-06T11:50:00.000Z');
    expect((await verifyEvidenceAttestation(root, config, runner, {
      GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42',
    }, { now: () => now })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'ATTESTATION_EXPIRED' }));

    await write('2026-09-06T12:01:00.000Z');
    expect((await verifyEvidenceAttestation(root, config, runner, {
      GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42',
    }, { now: () => now })).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'ATTESTATION_FUTURE' }));
  });

  it('verifies GitHub OIDC identity and authorizes an ephemeral Ed25519 public key', async () => {
    const root = await fixture({ 'source.txt': 'stable' });
    const runner = gitRunner();
    const now = new Date('2026-09-06T12:00:00.000Z');
    const seconds = Math.floor(now.getTime() / 1000);
    const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = generateKeyPairSync('ed25519');
    const signerPublicKey = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const audience = githubOidcAudience(
      'https://musubix.dev/attestation',
      'public-key',
      'run-key',
      signerPublicKey,
    );
    const token = jwt(oidcKeys.privateKey, {
      iss: issuer,
      aud: audience,
      exp: seconds + 300,
      nbf: seconds - 10,
      iat: seconds - 10,
      repository,
      sha: commitSha,
      run_id: '42',
      workflow: 'release.yml',
      ref: 'refs/heads/main',
    });
    const unsigned = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '42',
      keyId: 'run-key',
      issuedAt: now.toISOString(),
      githubOidc: { token, publicKey: signerPublicKey },
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), signer.privateKey).toString('base64'),
    });

    const report = await verifyEvidenceAttestation(root, strictConfig(), runner, {
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '42',
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: commitSha,
      GITHUB_WORKFLOW: 'release.yml',
      GITHUB_REF: 'refs/heads/main',
    }, { fetch: oidcFetch(oidcKeys.publicKey), now: () => now });
    expect(report).toMatchObject({ valid: true, status: 'verified', trust: 'github-oidc-ephemeral-key' });
  });

  it('rejects claim/key substitution and fails closed when metadata is unavailable', async () => {
    const root = await fixture({ 'source.txt': 'stable' });
    const runner = gitRunner();
    const now = new Date('2026-09-06T12:00:00.000Z');
    const seconds = Math.floor(now.getTime() / 1000);
    const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = generateKeyPairSync('ed25519');
    const signerPublicKey = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const token = jwt(oidcKeys.privateKey, {
      iss: issuer,
      aud: githubOidcAudience('https://musubix.dev/attestation', 'public-key', 'run-key', signerPublicKey),
      exp: seconds + 300,
      nbf: seconds - 10,
      iat: seconds - 10,
      repository: 'other/repository',
      sha: commitSha,
      run_id: '42',
      workflow: 'release.yml',
      ref: 'refs/heads/main',
    });
    const unsigned = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '42',
      keyId: 'run-key',
      issuedAt: now.toISOString(),
      githubOidc: { token, publicKey: signerPublicKey },
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), signer.privateKey).toString('base64'),
    });

    const claimFailure = await verifyEvidenceAttestation(root, strictConfig(), runner, {}, {
      fetch: oidcFetch(oidcKeys.publicKey),
      now: () => now,
    });
    expect(claimFailure.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'ATTESTATION_OIDC_REPOSITORY' }));

    const substitute = generateKeyPairSync('ed25519');
    const substitutePublicKey = substitute.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const substituted = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '42',
      keyId: 'run-key',
      issuedAt: now.toISOString(),
      githubOidc: { token, publicKey: substitutePublicKey },
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...substituted,
      signature: sign(null, Buffer.from(attestationSigningPayload(substituted)), substitute.privateKey).toString('base64'),
    });
    expect((await verifyEvidenceAttestation(root, strictConfig(), runner, {}, {
      fetch: oidcFetch(oidcKeys.publicKey),
      now: () => now,
    })).diagnostics).toContainEqual(expect.objectContaining({ code: 'ATTESTATION_OIDC_AUDIENCE' }));

    const offline = await verifyEvidenceAttestation(root, strictConfig(), runner, {}, {
      fetch: async () => { throw new Error('offline'); },
      now: () => now,
    });
    expect(offline).toMatchObject({ valid: false, status: 'invalid' });
    expect(offline.diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'ATTESTATION_OIDC_FETCH' }));
  });

  it('validates issuer, audience, JWT times, commit, run, workflow, and ref claims', async () => {
    const root = await fixture({ 'source.txt': 'stable' });
    const runner = gitRunner();
    const now = new Date('2026-09-06T12:00:00.000Z');
    const seconds = Math.floor(now.getTime() / 1000);
    const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = generateKeyPairSync('ed25519');
    const publicKey = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const token = jwt(oidcKeys.privateKey, {
      iss: 'https://invalid.example',
      aud: 'wrong-audience',
      exp: seconds - 120,
      nbf: seconds + 120,
      iat: seconds + 120,
      repository,
      sha: 'b'.repeat(40),
      run_id: '99',
      workflow: 'other.yml',
      ref: 'refs/heads/other',
    });
    const unsigned = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '42',
      keyId: 'run-key',
      issuedAt: now.toISOString(),
      githubOidc: { token, publicKey },
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), signer.privateKey).toString('base64'),
    });
    const diagnostics = (await verifyEvidenceAttestation(root, strictConfig(), runner, {}, {
      fetch: oidcFetch(oidcKeys.publicKey),
      now: () => now,
    })).diagnostics;
    for (const code of [
      'ATTESTATION_OIDC_ISSUER',
      'ATTESTATION_OIDC_AUDIENCE',
      'ATTESTATION_OIDC_EXPIRED',
      'ATTESTATION_OIDC_NOT_BEFORE',
      'ATTESTATION_OIDC_ISSUED_AT',
      'ATTESTATION_OIDC_COMMIT',
      'ATTESTATION_OIDC_RUN',
      'ATTESTATION_OIDC_WORKFLOW',
      'ATTESTATION_OIDC_REF',
    ]) expect(diagnostics).toContainEqual(expect.objectContaining({ code }));
  });

  it('can bind OIDC authorization to a statically trusted key ID', async () => {
    const root = await fixture({ 'source.txt': 'stable' });
    const runner = gitRunner();
    const now = new Date('2026-09-06T12:00:00.000Z');
    const seconds = Math.floor(now.getTime() / 1000);
    const oidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = generateKeyPairSync('ed25519');
    const publicKey = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const token = jwt(oidcKeys.privateKey, {
      iss: issuer,
      aud: githubOidcAudience('https://musubix.dev/attestation', 'key-id', 'static-key'),
      exp: seconds + 300,
      nbf: seconds - 10,
      iat: seconds - 10,
      repository,
      sha: commitSha,
      run_id: '42',
    });
    const unsigned = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '42',
      keyId: 'static-key',
      issuedAt: now.toISOString(),
      githubOidc: { token },
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), signer.privateKey).toString('base64'),
    });
    const config = strictConfig({ keyBinding: 'key-id' });
    delete config.githubOidc!.workflow;
    delete config.githubOidc!.ref;
    config.trustedPublicKeys = [{ id: 'static-key', publicKey }];
    expect(await verifyEvidenceAttestation(root, config, runner, {
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '42',
      GITHUB_REPOSITORY: repository,
      GITHUB_SHA: commitSha,
    }, {
      fetch: oidcFetch(oidcKeys.publicKey),
      now: () => now,
    })).toMatchObject({ valid: true, trust: 'github-oidc-trusted-key' });
  });

  it.each([
    ['bad signature', {}, 'ATTESTATION_OIDC_SIGNATURE'],
    ['unsupported algorithm', { alg: 'HS256' }, 'ATTESTATION_OIDC_ALGORITHM'],
    ['unknown key ID', { kid: 'unknown-key' }, 'ATTESTATION_OIDC_KEY'],
  ])('rejects %s', async (_name, header, expectedCode) => {
    const root = await fixture({ 'source.txt': 'stable' });
    const runner = gitRunner();
    const now = new Date('2026-09-06T12:00:00.000Z');
    const seconds = Math.floor(now.getTime() / 1000);
    const trustedOidcKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const tokenKeys = expectedCode === 'ATTESTATION_OIDC_SIGNATURE'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : trustedOidcKeys;
    const signer = generateKeyPairSync('ed25519');
    const publicKey = signer.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const token = jwt(tokenKeys.privateKey, {
      iss: issuer,
      aud: githubOidcAudience('https://musubix.dev/attestation', 'public-key', 'run-key', publicKey),
      exp: seconds + 300,
      nbf: seconds - 10,
      iat: seconds - 10,
      repository,
      sha: commitSha,
      run_id: '42',
      workflow: 'release.yml',
      ref: 'refs/heads/main',
    }, header);
    const unsigned = await createUnsignedAttestation(root, {
      provider: 'github',
      runId: '42',
      keyId: 'run-key',
      issuedAt: now.toISOString(),
      githubOidc: { token, publicKey },
    }, runner);
    await writeJson(root, '.musubix/evidence/attestation.json', {
      ...unsigned,
      signature: sign(null, Buffer.from(attestationSigningPayload(unsigned)), signer.privateKey).toString('base64'),
    });
    expect((await verifyEvidenceAttestation(root, strictConfig(), runner, {}, {
      fetch: oidcFetch(trustedOidcKeys.publicKey),
      now: () => now,
    })).diagnostics).toContainEqual(expect.objectContaining({ code: expectedCode }));
  });

  it('reports missing CI-required attestation as missing and gate-blocking', async () => {
    const root = await fixture();
    expect(await verifyEvidenceAttestation(root, strictConfig(), gitRunner(), {
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: '42',
    })).toMatchObject({ present: false, valid: false, status: 'missing' });
    const gate = await runGate(root, {
      config: { ...defaultConfig, attestation: strictConfig() },
      runner: gitRunner(),
      environment: { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '42' },
    });
    expect(gate.checks.find((check) => check.name === 'attestation'))
      .toMatchObject({ required: true, status: 'fail', summary: 'Required CI attestation is missing.' });
  });
});
