import { createHash, createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';
import { error, type Diagnostic } from '../../domain/src/index.js';
import type { AttestationConfig } from './config.js';
import { digest, evidenceInputPaths, exists, files, readText, snapshot, within } from './files.js';
import { performanceEvidenceHead, validatePerformanceEvidence } from './performance.js';
import { mutationEvidenceHead, validateMutationEvidence } from './mutation.js';
import { modelCorrespondenceEvidenceHead, validateModelCorrespondenceEvidence } from './model-correspondence.js';
import { loadEvidenceOrder } from './order.js';
import { runProcess, type Runner } from './process.js';
import { workflowEvidenceHead, type WorkflowManifest } from './workflow.js';

export interface EvidenceAttestation {
  schemaVersion: 1;
  repository: string;
  commitSha: string;
  ci: { provider: 'github' | 'azure-pipelines' | 'generic'; runId: string };
  evidenceHeads: Record<string, string>;
  issuedAt: string;
  keyId: string;
  githubOidc?: {
    token: string;
    publicKey?: string;
  };
  signature: string;
}

export interface UnsignedAttestation extends Omit<EvidenceAttestation, 'signature'> {}

export type AttestationFetch = (
  url: string,
  init?: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface AttestationVerificationOptions {
  fetch?: AttestationFetch;
  now?: () => Date;
}

export type AttestationTrust =
  | 'none'
  | 'static-trusted-key'
  | 'github-oidc-ephemeral-key'
  | 'github-oidc-trusted-key';

export interface AttestationVerification {
  present: boolean;
  valid: boolean;
  status: 'off' | 'unsigned-local' | 'missing' | 'verified' | 'invalid';
  trust: AttestationTrust;
  diagnostics: Diagnostic[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function repositoryName(remote: string): string {
  return remote.trim().replace(/^git@github\.com:/, '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
}

export async function collectEvidenceHeads(root: string): Promise<Record<string, string>> {
  const heads: Record<string, string> = {};
  const load = async (path: string): Promise<Record<string, unknown> | null> =>
    await exists(within(root, path)) ? JSON.parse(await readText(root, path)) as Record<string, unknown> : null;
  const tdd = await load('.musubix/evidence/tdd.json');
  const chain = Array.isArray(tdd?.chain) ? tdd.chain as Array<Record<string, unknown>> : [];
  if (typeof chain.at(-1)?.recordSha256 === 'string') heads.tdd = chain.at(-1)!.recordSha256 as string;
  const workflow = await load('.musubix/evidence/workflow.json');
  const workflowHead = workflowEvidenceHead(workflow as unknown as WorkflowManifest | null);
  if (workflowHead) heads.workflow = workflowHead;
  const changes = await load('.musubix/evidence/changes.json');
  if (Array.isArray(changes?.changes)) heads.changes = digest(canonical(changes.changes));
  const order = await loadEvidenceOrder(root);
  if (order?.records.length) heads.order = order.records.at(-1)!.recordSha256;
  const formal = await load('.musubix/evidence/formal.json');
  if (formal) {
    const result = formal.result as Record<string, unknown> | undefined;
    const solver = result?.solver as Record<string, unknown> | undefined;
    heads.formal = digest(canonical({
      fingerprints: formal.fingerprints ?? {},
      totalRequirements: formal.totalRequirements,
      modeledRequirements: formal.modeledRequirements,
      modeledFraction: formal.modeledFraction,
      artifact: solver?.artifact ?? null,
      solverStatus: solver?.status,
      consistency: result?.consistency,
    }));
  }
  const performance = await load('.musubix/evidence/performance.json');
  if (performance) heads.performance = performanceEvidenceHead(performance);
  const mutation = await load('.musubix/evidence/mutation.json');
  if (mutation) heads.mutation = mutationEvidenceHead(mutation);
  const correspondence = await load('.musubix/evidence/model-correspondence.json');
  if (correspondence) heads.modelCorrespondence = modelCorrespondenceEvidenceHead(correspondence);
  const quality = await load('.musubix/evidence/quality.json');
  if (quality) {
    const checks = Array.isArray(quality.checks)
      ? (quality.checks as Array<Record<string, unknown>>).filter((check) => check.name !== 'attestation')
      : [];
    const metrics = quality.metrics && typeof quality.metrics === 'object' && !Array.isArray(quality.metrics)
      ? Object.fromEntries(Object.entries(quality.metrics as Record<string, unknown>)
        .filter(([name]) => name !== 'attestation.errors'))
      : {};
    heads.quality = digest(canonical({
      schemaVersion: quality.schemaVersion,
      mode: quality.mode,
      status: checks.every((check) => check.required !== true || check.status === 'pass') ? 'pass' : 'fail',
      checks: checks.map((check) => ({
        name: check.name,
        required: check.required,
        status: check.status,
        diagnostics: Array.isArray(check.diagnostics)
          ? (check.diagnostics as Array<Record<string, unknown>>).map((diagnostic) => ({
            code: diagnostic.code,
            severity: diagnostic.severity,
            path: diagnostic.path ?? null,
            line: diagnostic.line ?? null,
          }))
          : [],
      })),
      metrics,
    }));
  }
  const workspace = await snapshot(root, evidenceInputPaths(await files(root)));
  heads.workspace = digest(canonical(workspace));
  return Object.fromEntries(Object.entries(heads).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

async function gitIdentity(root: string, runner: Runner): Promise<{ repository: string; commitSha: string }> {
  const [remote, revision] = await Promise.all([
    runner('git', ['config', '--get', 'remote.origin.url'], { cwd: root, timeoutMs: 10_000 }),
    runner('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10_000 }),
  ]);
  if (remote.status !== 'completed' || remote.exitCode !== 0 || !remote.stdout.trim()) throw new Error('Repository remote.origin.url is unavailable.');
  if (revision.status !== 'completed' || revision.exitCode !== 0 || !/^[a-f0-9]{40,64}$/i.test(revision.stdout.trim())) {
    throw new Error('A committed Git HEAD is required for CI attestation.');
  }
  return { repository: repositoryName(remote.stdout), commitSha: revision.stdout.trim().toLowerCase() };
}

export async function createUnsignedAttestation(
  root: string,
  input: {
    provider: EvidenceAttestation['ci']['provider'];
    runId: string;
    keyId: string;
    issuedAt?: string;
    githubOidc?: UnsignedAttestation['githubOidc'];
  },
  runner: Runner = runProcess,
): Promise<UnsignedAttestation> {
  if (!input.runId.trim() || !/^[A-Za-z0-9._:-]+$/.test(input.keyId)) throw new Error('Attestation runId and keyId are required.');
  const identity = await gitIdentity(root, runner);
  return {
    schemaVersion: 1,
    ...identity,
    ci: { provider: input.provider, runId: input.runId },
    evidenceHeads: await collectEvidenceHeads(root),
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    keyId: input.keyId,
    ...(input.githubOidc ? { githubOidc: input.githubOidc } : {}),
  };
}

function currentCi(environment: NodeJS.ProcessEnv): (EvidenceAttestation['ci'] & { repository?: string; commitSha?: string }) | null {
  if (environment.GITHUB_ACTIONS === 'true' && environment.GITHUB_RUN_ID) {
    return {
      provider: 'github',
      runId: environment.GITHUB_RUN_ID,
      ...(environment.GITHUB_REPOSITORY ? { repository: environment.GITHUB_REPOSITORY } : {}),
      ...(environment.GITHUB_SHA ? { commitSha: environment.GITHUB_SHA.toLowerCase() } : {}),
    };
  }
  if (environment.TF_BUILD === 'True' && environment.BUILD_BUILDID) {
    return {
      provider: 'azure-pipelines',
      runId: environment.BUILD_BUILDID,
      ...(environment.BUILD_REPOSITORY_NAME ? { repository: environment.BUILD_REPOSITORY_NAME } : {}),
      ...(environment.BUILD_SOURCEVERSION ? { commitSha: environment.BUILD_SOURCEVERSION.toLowerCase() } : {}),
    };
  }
  if (environment.CI_PROVIDER && environment.CI_RUN_ID) return { provider: 'generic', runId: environment.CI_RUN_ID };
  return null;
}

function ed25519PublicKey(value: string): KeyObject {
  if (/BEGIN [A-Z ]*PRIVATE KEY/.test(value)) throw new Error('Private keys are not accepted.');
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Signing key is not Ed25519.');
  return key;
}

export function githubOidcAudience(
  audience: string,
  keyBinding: 'public-key' | 'key-id',
  keyId: string,
  publicKey?: string,
): string {
  if (!audience || audience.includes('#')) throw new Error('OIDC audience base must be nonempty and must not contain #.');
  if (!/^[A-Za-z0-9._:-]+$/.test(keyId)) throw new Error('OIDC keyId is invalid.');
  if (keyBinding === 'key-id') return `${audience}#musubix3-key-id=${encodeURIComponent(keyId)}`;
  if (!publicKey) throw new Error('OIDC public-key binding requires an Ed25519 public key.');
  const key = ed25519PublicKey(publicKey);
  const der = key.export({ type: 'spki', format: 'der' });
  return `${audience}#musubix3-key-sha256=${createHash('sha256').update(der).digest('base64url')}`;
}

function jwtPart(value: string): Record<string, unknown> {
  const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('JWT component is not an object.');
  return decoded as Record<string, unknown>;
}

function claimString(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name];
  return typeof value === 'string' && value ? value : null;
}

function claimNumber(claims: Record<string, unknown>, name: string): number | null {
  const value = claims[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function verifyGithubOidc(
  attestation: EvidenceAttestation,
  config: AttestationConfig,
  options: AttestationVerificationOptions,
  path: string,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  const oidc = config.githubOidc;
  if (oidc?.mode !== 'strict') return diagnostics;
  if (attestation.ci.provider !== 'github') {
    return [error('ATTESTATION_OIDC_PROVIDER', 'Strict GitHub OIDC requires ci.provider github.', path)];
  }
  if (!attestation.githubOidc?.token) {
    return [error('ATTESTATION_OIDC_MISSING', 'Strict GitHub OIDC requires a signed OIDC token in the attestation.', path)];
  }
  const issuer = oidc.issuer ?? 'https://token.actions.githubusercontent.com';
  const token = attestation.githubOidc.token;
  if (token.length > 64_000) return [error('ATTESTATION_OIDC_TOKEN', 'GitHub OIDC token is too large.', path)];
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  let signingInput: string;
  let signature: Buffer;
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw new Error('JWT must have three compact parts.');
    header = jwtPart(parts[0]!);
    claims = jwtPart(parts[1]!);
    signingInput = `${parts[0]}.${parts[1]}`;
    signature = Buffer.from(parts[2]!, 'base64url');
  } catch (cause) {
    return [error('ATTESTATION_OIDC_TOKEN', `GitHub OIDC token is malformed: ${cause instanceof Error ? cause.message : String(cause)}`, path)];
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
    diagnostics.push(error('ATTESTATION_OIDC_ALGORITHM', 'GitHub OIDC token must use RS256 and identify a signing key.', path));
  }

  let jwks: Record<string, unknown> | null = null;
  if (!diagnostics.length) {
    try {
      const fetcher = options.fetch ?? globalThis.fetch;
      if (!fetcher) throw new Error('fetch is unavailable');
      const metadataUrl = `${issuer}/.well-known/openid-configuration`;
      const metadataResponse = await fetcher(metadataUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!metadataResponse.ok) throw new Error(`issuer metadata returned HTTP ${metadataResponse.status}`);
      const metadata = await metadataResponse.json() as Record<string, unknown>;
      if (metadata.issuer !== issuer || typeof metadata.jwks_uri !== 'string') {
        throw new Error('issuer metadata does not match the configured GitHub issuer');
      }
      const jwksUrl = new URL(metadata.jwks_uri);
      if (jwksUrl.protocol !== 'https:' || jwksUrl.origin !== new URL(issuer).origin) {
        throw new Error('issuer metadata returned an untrusted JWKS URI');
      }
      const jwksResponse = await fetcher(jwksUrl.toString(), {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!jwksResponse.ok) throw new Error(`JWKS returned HTTP ${jwksResponse.status}`);
      jwks = await jwksResponse.json() as Record<string, unknown>;
    } catch (cause) {
      diagnostics.push(error('ATTESTATION_OIDC_FETCH', `Unable to retrieve GitHub OIDC verification keys: ${cause instanceof Error ? cause.message : String(cause)}.`, path));
    }
  }

  if (jwks) {
    const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
    const jwk = keys.find((candidate) => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const value = candidate as Record<string, unknown>;
      return value.kid === header.kid && value.kty === 'RSA'
        && (value.alg === undefined || value.alg === 'RS256')
        && (value.use === undefined || value.use === 'sig');
    });
    if (!jwk) diagnostics.push(error('ATTESTATION_OIDC_KEY', 'GitHub OIDC signing key was not found in the issuer JWKS.', path));
    else {
      try {
        const jwtKey = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
        if (jwtKey.asymmetricKeyType !== 'rsa'
          || !verify('RSA-SHA256', Buffer.from(signingInput!), jwtKey, signature!)) {
          diagnostics.push(error('ATTESTATION_OIDC_SIGNATURE', 'GitHub OIDC JWT signature verification failed.', path));
        }
      } catch {
        diagnostics.push(error('ATTESTATION_OIDC_SIGNATURE', 'GitHub OIDC JWT signature is malformed or unverifiable.', path));
      }
    }
  }

  if (claimString(claims!, 'iss') !== issuer) {
    diagnostics.push(error('ATTESTATION_OIDC_ISSUER', 'GitHub OIDC issuer claim does not match the configured issuer.', path));
  }
  try {
    const expectedAudience = githubOidcAudience(
      oidc.audience!,
      oidc.keyBinding ?? 'public-key',
      attestation.keyId,
      oidc.keyBinding === 'key-id' ? undefined : attestation.githubOidc.publicKey,
    );
    const audience = claims!.aud;
    if (!(audience === expectedAudience
      || Array.isArray(audience) && audience.every((entry) => typeof entry === 'string') && audience.includes(expectedAudience))) {
      diagnostics.push(error('ATTESTATION_OIDC_AUDIENCE', 'GitHub OIDC audience does not authorize this attestation signing key.', path));
    }
  } catch (cause) {
    diagnostics.push(error('ATTESTATION_OIDC_KEY_BINDING', cause instanceof Error ? cause.message : String(cause), path));
  }

  const now = (options.now ?? (() => new Date()))().getTime() / 1000;
  const skew = config.maxFutureSkewSeconds ?? 60;
  const exp = claimNumber(claims!, 'exp');
  const nbf = claimNumber(claims!, 'nbf');
  const iat = claimNumber(claims!, 'iat');
  if (exp === null || nbf === null || iat === null) {
    diagnostics.push(error('ATTESTATION_OIDC_TIME', 'GitHub OIDC token must contain numeric exp, nbf, and iat claims.', path));
  } else {
    if (now > exp + skew) diagnostics.push(error('ATTESTATION_OIDC_EXPIRED', 'GitHub OIDC token has expired.', path));
    if (nbf > now + skew) diagnostics.push(error('ATTESTATION_OIDC_NOT_BEFORE', 'GitHub OIDC token is not yet valid.', path));
    if (iat > now + skew) diagnostics.push(error('ATTESTATION_OIDC_ISSUED_AT', 'GitHub OIDC token iat is in the future.', path));
    if (nbf > exp || iat > exp) diagnostics.push(error('ATTESTATION_OIDC_TIME', 'GitHub OIDC token time claims are inconsistent.', path));
    const attestationTime = Date.parse(attestation.issuedAt) / 1000;
    if (attestationTime < iat - skew || attestationTime > exp + skew) {
      diagnostics.push(error('ATTESTATION_OIDC_ATTESTATION_TIME', 'Attestation was not issued during the OIDC token authorization window.', path));
    }
  }

  const expectedRepository = oidc.repository ?? config.repository ?? attestation.repository;
  if (claimString(claims!, 'repository') !== expectedRepository) {
    diagnostics.push(error('ATTESTATION_OIDC_REPOSITORY', 'GitHub OIDC repository claim does not match the attested repository.', path));
  }
  if (claimString(claims!, 'sha')?.toLowerCase() !== attestation.commitSha.toLowerCase()) {
    diagnostics.push(error('ATTESTATION_OIDC_COMMIT', 'GitHub OIDC sha claim does not match the attested commit.', path));
  }
  const runId = claims!.run_id;
  if ((typeof runId !== 'string' && typeof runId !== 'number') || String(runId) !== attestation.ci.runId) {
    diagnostics.push(error('ATTESTATION_OIDC_RUN', 'GitHub OIDC run_id claim does not match the attested CI run.', path));
  }
  if (oidc.workflow && claimString(claims!, 'workflow') !== oidc.workflow) {
    diagnostics.push(error('ATTESTATION_OIDC_WORKFLOW', 'GitHub OIDC workflow claim does not match the configured workflow.', path));
  }
  if (oidc.ref && claimString(claims!, 'ref') !== oidc.ref) {
    diagnostics.push(error('ATTESTATION_OIDC_REF', 'GitHub OIDC ref claim does not match the configured ref.', path));
  }
  return diagnostics;
}

export async function verifyEvidenceAttestation(
  root: string,
  config: AttestationConfig,
  runner: Runner = runProcess,
  environment: NodeJS.ProcessEnv = process.env,
  options: AttestationVerificationOptions = {},
): Promise<AttestationVerification> {
  if (config.mode === 'off') return { present: false, valid: true, status: 'off', trust: 'none', diagnostics: [] };
  const path = '.musubix/evidence/attestation.json';
  if (!await exists(within(root, path))) {
    const diagnostics = config.mode === 'ci-required'
      ? [error('ATTESTATION_MISSING', 'CI attestation is required but no signed attestation is present.', path)]
      : [];
    return {
      present: false,
      valid: config.mode !== 'ci-required',
      status: config.mode === 'ci-required' ? 'missing' : 'unsigned-local',
      trust: 'none',
      diagnostics,
    };
  }
  const diagnostics: Diagnostic[] = [];
  let attestation: EvidenceAttestation;
  try {
    attestation = JSON.parse(await readText(root, path)) as EvidenceAttestation;
    if (attestation.schemaVersion !== 1
      || Object.keys(attestation).some((key) => !['schemaVersion', 'repository', 'commitSha', 'ci', 'evidenceHeads', 'issuedAt', 'keyId', 'githubOidc', 'signature'].includes(key))
      || !attestation.repository || !/^[a-f0-9]{40,64}$/i.test(attestation.commitSha)
      || !['github', 'azure-pipelines', 'generic'].includes(attestation.ci?.provider)
      || !attestation.ci?.runId || Number.isNaN(Date.parse(attestation.issuedAt)) || !attestation.keyId
      || !attestation.evidenceHeads || !Object.keys(attestation.evidenceHeads).length
      || Object.values(attestation.evidenceHeads).some((head) => !/^[a-f0-9]{64}$/i.test(head))
      || typeof attestation.signature !== 'string') throw new Error('schema mismatch');
    if (attestation.githubOidc !== undefined) {
      if (!attestation.githubOidc || typeof attestation.githubOidc !== 'object'
        || Object.keys(attestation.githubOidc).some((key) => !['token', 'publicKey'].includes(key))
        || typeof attestation.githubOidc.token !== 'string' || !attestation.githubOidc.token
        || (attestation.githubOidc.publicKey !== undefined
          && (typeof attestation.githubOidc.publicKey !== 'string'
            || !attestation.githubOidc.publicKey.includes('BEGIN PUBLIC KEY')))) {
        throw new Error('GitHub OIDC proof schema mismatch');
      }
    }
  } catch (cause) {
    return {
      present: true,
      valid: false,
      status: 'invalid',
      trust: 'none',
      diagnostics: [error('ATTESTATION_SCHEMA', `Invalid attestation: ${cause instanceof Error ? cause.message : String(cause)}.`, path)],
    };
  }
  const trusted = config.trustedPublicKeys.find((key) => key.id === attestation.keyId);
  const strictOidc = config.githubOidc?.mode === 'strict';
  const keyBinding = config.githubOidc?.keyBinding ?? 'public-key';
  if (strictOidc && keyBinding === 'key-id' && attestation.githubOidc?.publicKey) {
    diagnostics.push(error('ATTESTATION_OIDC_KEY_BINDING', 'key-id binding must not carry an unrelated ephemeral public key.', path));
  }
  let signingKey: KeyObject | null = null;
  let trust: AttestationTrust = 'none';
  try {
    if (strictOidc && keyBinding === 'public-key') {
      if (!attestation.githubOidc?.publicKey) throw new Error('OIDC-authorized ephemeral mode requires githubOidc.publicKey.');
      signingKey = ed25519PublicKey(attestation.githubOidc.publicKey);
      trust = 'github-oidc-ephemeral-key';
    } else if (trusted) {
      signingKey = ed25519PublicKey(trusted.publicKey);
      trust = strictOidc ? 'github-oidc-trusted-key' : 'static-trusted-key';
    } else {
      diagnostics.push(error('ATTESTATION_KEY_UNTRUSTED', `Attestation key ${attestation.keyId} is not trusted.`, path));
    }
  } catch (cause) {
    diagnostics.push(error('ATTESTATION_SIGNATURE', cause instanceof Error ? cause.message : String(cause), path));
  }
  const issuedAt = Date.parse(attestation.issuedAt);
  const now = (options.now ?? (() => new Date()))().getTime();
  const futureSkewMs = (config.maxFutureSkewSeconds ?? 60) * 1000;
  const maxAgeMs = (config.maxAgeSeconds ?? 3600) * 1000;
  if (issuedAt > now + futureSkewMs) {
    diagnostics.push(error('ATTESTATION_FUTURE', 'Attestation issuedAt is beyond the configured future clock skew.', path));
  }
  if (now - issuedAt > maxAgeMs) {
    diagnostics.push(error('ATTESTATION_EXPIRED', 'Attestation is older than the configured maximum age.', path));
  }
  try {
    const identity = await gitIdentity(root, runner);
    if (config.repository && config.repository !== identity.repository) diagnostics.push(error('ATTESTATION_REPOSITORY', 'Configured repository does not match Git remote.origin.url.', path));
    if (attestation.repository !== (config.repository ?? identity.repository)) diagnostics.push(error('ATTESTATION_REPOSITORY', 'Attestation repository does not match the configured repository.', path));
    if (attestation.commitSha.toLowerCase() !== identity.commitSha) diagnostics.push(error('ATTESTATION_COMMIT', 'Attestation commit SHA does not match Git HEAD.', path));
  } catch (cause) {
    diagnostics.push(error('ATTESTATION_GIT', cause instanceof Error ? cause.message : String(cause), path));
  }
  const ci = currentCi(environment);
  if (config.mode === 'ci-required' && !ci) diagnostics.push(error('ATTESTATION_CI_CONTEXT', 'No supported CI provider/run context is available.', path));
  if (ci && (ci.provider !== attestation.ci.provider || ci.runId !== attestation.ci.runId)) diagnostics.push(error('ATTESTATION_CI_RUN', 'Attestation CI provider/run ID does not match the current CI run.', path));
  if (ci?.repository && ci.repository !== attestation.repository) diagnostics.push(error('ATTESTATION_CI_REPOSITORY', 'Attestation repository does not match the CI repository.', path));
  if (ci?.commitSha && ci.commitSha !== attestation.commitSha.toLowerCase()) diagnostics.push(error('ATTESTATION_CI_COMMIT', 'Attestation commit does not match the CI source revision.', path));
  const heads = await collectEvidenceHeads(root);
  if (canonical(heads) !== canonical(attestation.evidenceHeads)) diagnostics.push(error('ATTESTATION_EVIDENCE_HEAD', 'Attested evidence heads do not match current evidence.', path));
  const performance = await validatePerformanceEvidence(root);
  if (performance.budgets > 0 && !performance.valid) {
    diagnostics.push(error('ATTESTATION_PERFORMANCE_PROVENANCE', 'Attested performance evidence is no longer traceable to its configured command and fresh report.', path));
  }
  const mutation = await validateMutationEvidence(root);
  if (mutation.present && !mutation.valid) {
    diagnostics.push(error('ATTESTATION_MUTATION_PROVENANCE', 'Attested mutation evidence is no longer traceable to current source, tests, command, and report evidence.', path));
  }
  const correspondence = await validateModelCorrespondenceEvidence(root);
  if (correspondence.requirements > 0 && !correspondence.valid) {
    diagnostics.push(error('ATTESTATION_MODEL_CORRESPONDENCE', 'Attested model correspondence evidence is missing, stale, or unproved.', path));
  }
  if (strictOidc) diagnostics.push(...await verifyGithubOidc(attestation, config, options, path));
  if (signingKey) {
    const { signature, ...unsigned } = attestation;
    try {
      if (!verify(null, Buffer.from(canonical(unsigned)), signingKey, Buffer.from(signature, 'base64'))) {
        diagnostics.push(error('ATTESTATION_SIGNATURE', 'Ed25519 signature verification failed.', path));
      }
    } catch {
      diagnostics.push(error('ATTESTATION_SIGNATURE', 'Ed25519 signature is malformed or unverifiable.', path));
    }
  }
  return {
    present: true,
    valid: !diagnostics.length,
    status: diagnostics.length ? 'invalid' : 'verified',
    trust: diagnostics.length ? 'none' : trust,
    diagnostics,
  };
}

export function attestationSigningPayload(value: UnsignedAttestation): string {
  return canonical(value);
}
