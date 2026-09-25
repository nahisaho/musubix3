/** @id CODE-EVIDENCE-WRITER-LOCK-001
 * @implements REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-003 REQ-EVIDENCE-WRITER-LOCK-004 REQ-EVIDENCE-WRITER-LOCK-005 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 * @design DES-EVIDENCE-WRITER-LOCK-001 DES-EVIDENCE-WRITER-LOCK-002 DES-EVIDENCE-WRITER-LOCK-004 DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001 DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-002
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import {
  lstat,
  open,
  readFile,
  readlink,
  rmdir,
  unlink,
} from 'node:fs/promises';
import { hostname as systemHostname } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { assertEvidenceMergeReady } from './evidence-merge-guard.js';

const LOCK_RELATIVE_PATH = '.musubix/evidence/.writer-lock.json';
const STAGING_PREFIX = '.writer-lock.';

export type EvidenceWriterLockErrorCode =
  | 'EVIDENCE_WRITER_LOCKED'
  | 'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED'
  | 'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED'
  | 'EVIDENCE_WRITER_LOCK_RELEASE_FAILED'
  | 'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE'
  | 'EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED'
  | 'EVIDENCE_WRITER_CONTEXT_LOST';

export type EvidenceOperationClass = 'writer' | 'coordinated-reader' | 'exempt';

export const EVIDENCE_OPERATION_CLASSIFICATION = {
  writer: [
    'gate', 'evidence refresh', 'tdd red', 'tdd green', 'tdd refactor', 'tdd migrate', 'tdd void',
    'change waiver record', 'workflow-record', 'workflow-verify',
    'workflow waiver record', 'workflow waiver record-all', 'approval record',
    'evidence merge --recover', 'change quality-recover', 'trace build', 'graph index', 'graph gate', 'knowledge build',
    'formal check', 'formal generate',
  ],
  coordinatedReader: [
    'status', 'approval prepare', 'approval validate', 'design validate', 'design c4',
    'trace check', 'trace impact', 'graph impact', 'graph cycles', 'knowledge query',
    'mutation validate', 'model-correspondence validate', 'attestation payload',
    'attestation verify', 'tdd validate',
  ],
  exempt: [
    'help', 'version', 'plugin-install', 'requirements validate', 'requirements scaffold',
    'constitution validate', 'design scaffold', 'formal doctor', 'config lint', 'config scaffold',
    'mutation doctor', 'mutation identity', 'workflow-sanitize', 'attestation oidc-audience',
    'evidence unlock --recover',
  ],
  conditional: ['init', 'install', 'upgrade', 'change-record', 'evidence merge'],
} as const;

export const EVIDENCE_CONDITIONAL_OPERATION_MODES = [
  { operation: 'init', options: {}, classification: 'writer' },
  { operation: 'init', options: { dryRun: true }, classification: 'coordinated-reader' },
  { operation: 'install', options: {}, classification: 'writer' },
  { operation: 'install', options: { dryRun: true }, classification: 'coordinated-reader' },
  { operation: 'upgrade', options: {}, classification: 'writer' },
  { operation: 'upgrade', options: { dryRun: true }, classification: 'coordinated-reader' },
  { operation: 'change-record', options: {}, classification: 'writer' },
  { operation: 'change-record', options: { dryRun: true }, classification: 'coordinated-reader' },
  { operation: 'evidence merge', options: {}, classification: 'writer' },
  { operation: 'evidence merge', options: { dryRun: true }, classification: 'coordinated-reader' },
] as const satisfies readonly {
  operation: string;
  options: EvidenceOperationClassificationOptions;
  classification: EvidenceOperationClass;
}[];

export const EVIDENCE_WRITER_ANALYSIS_ENTRIES = [
  'adapter output capture',
  'adapter output clear',
  'approval record',
  'change waiver record',
  'change-record',
  'change quality-recover',
  'evidence merge',
  'evidence merge --recover',
  'evidence order append',
  'formal check',
  'formal generate',
  'gate',
  'graph index',
  'knowledge build',
  'model-correspondence evidence generate',
  'mutation evidence generate',
  'performance evidence generate',
  'protected write',
  'tdd <phase>',
  'tdd migrate',
  'tdd void',
  'trace build',
  'workflow waiver record',
  'workflow waiver record-all',
  'workflow-record',
  'workflow-verify',
] as const;

export interface EvidenceOperationClassificationOptions {
  dryRun?: boolean;
  recover?: boolean;
}

export function classifyEvidenceOperation(
  operation: string,
  options: EvidenceOperationClassificationOptions = {},
): EvidenceOperationClass {
  if (operation === 'init' || operation === 'install' || operation === 'upgrade') {
    return options.dryRun ? 'coordinated-reader' : 'writer';
  }
  if (operation === 'change-record') {
    return options.dryRun ? 'coordinated-reader' : 'writer';
  }
  if (operation === 'evidence merge') {
    return options.dryRun ? 'coordinated-reader' : 'writer';
  }
  if ((EVIDENCE_OPERATION_CLASSIFICATION.writer as readonly string[]).includes(operation)) return 'writer';
  if ((EVIDENCE_OPERATION_CLASSIFICATION.coordinatedReader as readonly string[]).includes(operation)) {
    return 'coordinated-reader';
  }
  if ((EVIDENCE_OPERATION_CLASSIFICATION.exempt as readonly string[]).includes(operation)) return 'exempt';
  throw new Error(`Unclassified evidence operation: ${operation}`);
}

export interface LinuxProcessFingerprint {
  platform: 'linux';
  bootId: string;
  pidNamespace: string;
  processStart: string;
}

export interface UnsupportedProcessFingerprint {
  platform: 'darwin' | 'win32' | 'aix' | 'android' | 'freebsd' | 'haiku' | 'openbsd' | 'sunos' | 'cygwin' | 'netbsd';
  supported: false;
}

export type EvidenceWriterProcessFingerprint =
  | LinuxProcessFingerprint
  | UnsupportedProcessFingerprint;

export interface EvidenceWriterLockOwner {
  schemaVersion: 1;
  canonicalRoot: string;
  command: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
  transactionId: string;
  processFingerprint: EvidenceWriterProcessFingerprint;
}

export interface EvidenceWriterUnknownOwner {
  schemaVersion: 'unknown';
  canonicalRoot: 'unknown';
  command: 'unknown';
  pid: 'unknown';
  hostname: 'unknown';
  acquiredAt: 'unknown';
  transactionId: 'unknown';
  processFingerprint: 'unknown';
}

export type EvidenceWriterLockErrorOwner = EvidenceWriterLockOwner | EvidenceWriterUnknownOwner;

export interface EvidenceWriterLockIdentity {
  dev: number;
  ino: number;
}

export type EvidenceDirectorySyncPolicy = 'allow-unsupported' | 'strict';

export interface EvidenceWriterLockDependencies {
  hostname?: () => string;
  platform?: () => NodeJS.Platform;
  resolveCanonicalRoot?: (root: string) => string;
  processFingerprint?: () => Promise<EvidenceWriterProcessFingerprint>;
  lockOwner?: (path: string) => Promise<EvidenceWriterLockOwner>;
  lockIdentity?: (path: string) => Promise<EvidenceWriterLockIdentity>;
  publishedLockIdentity?: (descriptor: number) => EvidenceWriterLockIdentity;
  rollbackUnlink?: (path: string) => Promise<void>;
  syncEvidenceDirectory?: (path: string, policy: EvidenceDirectorySyncPolicy) => Promise<void>;
  syncEvidenceDirectorySync?: (path: string, policy: EvidenceDirectorySyncPolicy) => void;
}

export interface EvidenceWriterRecoveryDependencies extends EvidenceWriterLockDependencies {
  processState?: (
    owner: EvidenceWriterLockOwner,
    currentFingerprint: EvidenceWriterProcessFingerprint,
  ) => Promise<'dead' | 'live' | 'reused' | 'indeterminate'>;
}

export interface EvidenceWriterLease {
  owner: EvidenceWriterLockOwner;
  release(): Promise<void>;
}

export type EvidenceWriterLockState =
  | { locked: false; lockPath: string }
  | { locked: true; lockPath: string; owner: EvidenceWriterLockOwner };

export interface EvidenceWriterRecoveryReport {
  action: 'nothing-to-recover' | 'recovered';
  recovered: boolean;
}

interface EvidenceWriterLeaseState {
  acquisition: Promise<EvidenceWriterLease>;
  references: number;
}

interface EvidenceWriterContext {
  token: symbol;
  leases: Map<string, EvidenceWriterLeaseState>;
  resolveCanonicalRoot: (root: string) => string;
  canonicalRoots: Map<string, string>;
}

interface ErrorOptions {
  lockPath: string;
  owner?: EvidenceWriterLockErrorOwner;
  cause?: unknown;
  guidance?: string[];
  rollbackError?: EvidenceWriterLockError;
  lockRemoved?: boolean;
}

export class EvidenceWriterLockError extends Error {
  readonly code: EvidenceWriterLockErrorCode;
  readonly lockPath: string;
  readonly owner: EvidenceWriterLockErrorOwner | undefined;
  readonly guidance: string[] | undefined;
  readonly rollbackError: EvidenceWriterLockError | undefined;
  readonly lockRemoved: boolean | undefined;

  constructor(code: EvidenceWriterLockErrorCode, message: string, options: ErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'EvidenceWriterLockError';
    this.code = code;
    this.lockPath = options.lockPath;
    this.owner = options.owner;
    this.guidance = options.guidance;
    this.rollbackError = options.rollbackError;
    this.lockRemoved = options.lockRemoved;
  }
}

export class EvidenceProtectedOutputError extends Error {
  readonly code = 'EVIDENCE_PROTECTED_OUTPUT_REJECTED';
  readonly path: string;

  constructor(path: string) {
    super(`Exempt operation output must not target protected project state: ${path}`);
    this.name = 'EvidenceProtectedOutputError';
    this.path = path;
  }
}

const ownerContext = new AsyncLocalStorage<EvidenceWriterContext>();

export function resolveEvidenceWriterCanonicalRoot(root: string): string {
  return realpathSync.native(resolve(root));
}

function contextCanonicalRoot(root: string): string {
  const context = ownerContext.getStore();
  if (context === undefined) return resolveEvidenceWriterCanonicalRoot(root);
  const absolute = resolve(root);
  const cached = context.canonicalRoots.get(absolute);
  if (cached !== undefined) return cached;
  const canonicalRoot = context.resolveCanonicalRoot(absolute);
  if (context.resolveCanonicalRoot(absolute) !== canonicalRoot) {
    throw new Error(`Canonical evidence root changed during coordination: ${absolute}`);
  }
  context.canonicalRoots.set(absolute, canonicalRoot);
  return canonicalRoot;
}

export function resolveEvidenceWriterCoordinatedRoot(root: string): string {
  return contextCanonicalRoot(root);
}

function errno(cause: unknown): string | undefined {
  return cause instanceof Error && 'code' in cause
    ? String((cause as NodeJS.ErrnoException).code)
    : undefined;
}

function lockPath(canonicalRoot: string): string {
  return resolve(canonicalRoot, LOCK_RELATIVE_PATH);
}

function evidenceDirectory(canonicalRoot: string): string {
  return resolve(canonicalRoot, '.musubix/evidence');
}

const WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_ERRORS = new Set(['EPERM', 'EINVAL', 'ENOTSUP']);

function isUnsupportedDirectorySync(cause: unknown, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && WINDOWS_UNSUPPORTED_DIRECTORY_SYNC_ERRORS.has(errno(cause) ?? '');
}

async function syncDirectory(
  path: string,
  platform: NodeJS.Platform,
  policy: EvidenceDirectorySyncPolicy,
  synchronize?: (path: string, policy: EvidenceDirectorySyncPolicy) => Promise<void>,
): Promise<void> {
  const handle = await open(path, 'r');
  try {
    try {
      if (synchronize) await synchronize(path, policy);
      else await handle.sync();
    } catch (cause) {
      if (policy !== 'allow-unsupported' || !isUnsupportedDirectorySync(cause, platform)) throw cause;
    }
  } finally {
    await handle.close();
  }
}

async function syncRecoveredEvidenceDirectoryStrict(
  canonicalRoot: string,
  dependencies: EvidenceWriterRecoveryDependencies,
): Promise<void> {
  await syncDirectory(
    evidenceDirectory(canonicalRoot),
    (dependencies.platform ?? (() => process.platform))(),
    'strict',
    dependencies.syncEvidenceDirectory,
  );
}

function syncDirectorySync(
  path: string,
  platform: NodeJS.Platform,
  policy: EvidenceDirectorySyncPolicy,
  synchronize?: (path: string, policy: EvidenceDirectorySyncPolicy) => void,
): void {
  const descriptor = openSync(path, 'r');
  try {
    try {
      if (synchronize) synchronize(path, policy);
      else fsyncSync(descriptor);
    } catch (cause) {
      if (policy !== 'allow-unsupported' || !isUnsupportedDirectorySync(cause, platform)) throw cause;
    }
  } finally {
    closeSync(descriptor);
  }
}

function isLinuxFingerprint(value: EvidenceWriterProcessFingerprint): value is LinuxProcessFingerprint {
  return value.platform === 'linux';
}

function parseProcessStart(stat: string): string {
  const commandEnd = stat.lastIndexOf(')');
  if (commandEnd === -1) throw new Error('Malformed Linux process stat.');
  const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/);
  const processStart = fieldsAfterCommand[19];
  if (processStart === undefined) throw new Error('Linux process stat has no start identity.');
  return processStart;
}

async function linuxFingerprint(pid = process.pid): Promise<LinuxProcessFingerprint> {
  const [bootId, pidNamespace, stat] = await Promise.all([
    readFile('/proc/sys/kernel/random/boot_id', 'utf8'),
    readlink(`/proc/${pid}/ns/pid`),
    readFile(`/proc/${pid}/stat`, 'utf8'),
  ]);
  return {
    platform: 'linux',
    bootId: bootId.trim(),
    pidNamespace,
    processStart: parseProcessStart(stat),
  };
}

async function defaultProcessFingerprint(): Promise<EvidenceWriterProcessFingerprint> {
  if (process.platform === 'linux') return linuxFingerprint();
  return {
    platform: process.platform as UnsupportedProcessFingerprint['platform'],
    supported: false,
  };
}

function defaultProcessFingerprintSync(): EvidenceWriterProcessFingerprint {
  if (process.platform === 'linux') {
    return {
      platform: 'linux',
      bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      pidNamespace: readlinkSync(`/proc/${process.pid}/ns/pid`),
      processStart: parseProcessStart(readFileSync(`/proc/${process.pid}/stat`, 'utf8')),
    };
  }
  return {
    platform: process.platform as UnsupportedProcessFingerprint['platform'],
    supported: false,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFingerprint(value: unknown): EvidenceWriterProcessFingerprint | undefined {
  if (!isRecord(value) || typeof value.platform !== 'string') return undefined;
  if (value.platform === 'linux') {
    return typeof value.bootId === 'string'
      && typeof value.pidNamespace === 'string'
      && typeof value.processStart === 'string'
      ? {
          platform: 'linux',
          bootId: value.bootId,
          pidNamespace: value.pidNamespace,
          processStart: value.processStart,
        }
      : undefined;
  }
  return value.supported === false
    ? {
        platform: value.platform as UnsupportedProcessFingerprint['platform'],
        supported: false,
      }
    : undefined;
}

function parseOwner(value: unknown): EvidenceWriterLockOwner | undefined {
  if (!isRecord(value)) return undefined;
  const processFingerprint = parseFingerprint(value.processFingerprint);
  if (
    value.schemaVersion !== 1
    || typeof value.canonicalRoot !== 'string'
    || typeof value.command !== 'string'
    || typeof value.pid !== 'number'
    || !Number.isSafeInteger(value.pid)
    || typeof value.hostname !== 'string'
    || typeof value.acquiredAt !== 'string'
    || typeof value.transactionId !== 'string'
    || processFingerprint === undefined
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    canonicalRoot: value.canonicalRoot,
    command: value.command,
    pid: value.pid,
    hostname: value.hostname,
    acquiredAt: value.acquiredAt,
    transactionId: value.transactionId,
    processFingerprint,
  };
}

async function readOwner(path: string): Promise<EvidenceWriterLockOwner> {
  return parseOwnerText(path, await readFile(path, 'utf8'));
}

function parseOwnerText(path: string, raw: string): EvidenceWriterLockOwner {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE',
      `Evidence writer lock metadata is malformed: ${path}`,
      { lockPath: path, cause },
    );
  }
  const owner = parseOwner(value);
  if (owner === undefined) {
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE',
      `Evidence writer lock metadata is incomplete: ${path}`,
      { lockPath: path },
    );
  }
  return owner;
}

async function defaultLockObservation(path: string): Promise<{
  owner: EvidenceWriterLockOwner;
  identity: EvidenceWriterLockIdentity;
}> {
  const handle = await open(path, 'r');
  try {
    const [raw, stats] = await Promise.all([handle.readFile('utf8'), handle.stat()]);
    return {
      owner: parseOwnerText(path, raw),
      identity: { dev: stats.dev, ino: stats.ino },
    };
  } finally {
    await handle.close();
  }
}

async function defaultLockIdentity(path: string): Promise<EvidenceWriterLockIdentity> {
  const stats = await lstat(path);
  return { dev: stats.dev, ino: stats.ino };
}

async function observeLock(
  path: string,
  dependencies: EvidenceWriterLockDependencies,
): Promise<{ owner: EvidenceWriterLockOwner; identity: EvidenceWriterLockIdentity }> {
  if (dependencies.lockOwner === undefined && dependencies.lockIdentity === undefined) {
    return defaultLockObservation(path);
  }
  const [owner, identity] = await Promise.all([
    (dependencies.lockOwner ?? readOwner)(path),
    (dependencies.lockIdentity ?? defaultLockIdentity)(path),
  ]);
  return { owner, identity };
}

async function readContendingOwner(path: string): Promise<EvidenceWriterLockOwner | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await readOwner(path);
    } catch (cause) {
      if (attempt === 1 || errno(cause) !== 'ENOENT') return undefined;
    }
  }
  return undefined;
}

function lockedError(path: string, owner?: EvidenceWriterLockOwner): EvidenceWriterLockError {
  const resolvedOwner: EvidenceWriterLockErrorOwner = owner ?? {
    schemaVersion: 'unknown',
    canonicalRoot: 'unknown',
    command: 'unknown',
    pid: 'unknown',
    hostname: 'unknown',
    acquiredAt: 'unknown',
    transactionId: 'unknown',
    processFingerprint: 'unknown',
  };
  const description = owner === undefined
    ? 'owner metadata unavailable'
    : `${owner.command} (pid ${owner.pid}, host ${owner.hostname}, acquired ${owner.acquiredAt}, transaction ${owner.transactionId})`;
  return new EvidenceWriterLockError(
    'EVIDENCE_WRITER_LOCKED',
    `Evidence writer lock is held at ${path}: ${description}.`,
    { lockPath: path, owner: resolvedOwner },
  );
}

function activeLease(canonicalRoot: string): EvidenceWriterLeaseState | undefined {
  const state = ownerContext.getStore()?.leases.get(canonicalRoot);
  return state !== undefined && state.references > 0 ? state : undefined;
}

function protectedPath(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(root, path)).split(sep).join('/');
  return rel === '.musubix/evidence'
    || rel.startsWith('.musubix/evidence/')
    || rel === '.musubix/cache'
    || rel.startsWith('.musubix/cache/')
    || /^\.musubix\/features\/[^/]+\/trace\.json$/.test(rel);
}

function configuredReportPattern(path: string): RegExp {
  const escaped = path
    .split(/(\{testId\}|\{testPath\}|\{reportPath\})/)
    .map((part) => {
      if (part === '{testId}') return '[^/]+';
      if (part === '{testPath}' || part === '{reportPath}') return '.+';
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${escaped}$`);
}

async function configuredReportPath(root: string, path: string): Promise<boolean> {
  const canonicalRoot = contextCanonicalRoot(root);
  const rel = relative(canonicalRoot, resolve(canonicalRoot, path)).split(sep).join('/');
  try {
    const raw = JSON.parse(await readFile(resolve(canonicalRoot, '.musubix/config.json'), 'utf8')) as unknown;
    if (!isRecord(raw) || !Array.isArray(raw.commands)) return false;
    for (const command of raw.commands) {
      if (!isRecord(command)) continue;
      for (const key of ['tddReport', 'testReport', 'mutationReport'] as const) {
        const report = command[key];
        if (isRecord(report) && typeof report.path === 'string' && configuredReportPattern(report.path).test(rel)) {
          return true;
        }
      }
    }
    return false;
  } catch (cause) {
    if (errno(cause) === 'ENOENT' || cause instanceof SyntaxError) return false;
    throw cause;
  }
}

function canonicalizeRootForAcquisition(
  root: string,
  resolveCanonicalRoot: (root: string) => string = resolveEvidenceWriterCanonicalRoot,
): { canonicalRoot: string; rootExisted: boolean } {
  const absolute = resolve(root);
  try {
    return { canonicalRoot: resolveCanonicalRoot(absolute), rootExisted: true };
  } catch (cause) {
    if (errno(cause) !== 'ENOENT') throw cause;
  }
  let ancestor = dirname(absolute);
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error(`No existing ancestor for project root: ${absolute}`);
    ancestor = parent;
  }
  const canonicalAncestor = resolveCanonicalRoot(ancestor);
  return {
    canonicalRoot: resolve(canonicalAncestor, relative(ancestor, absolute)),
    rootExisted: false,
  };
}

type RollbackLockClassification = 'own' | 'replacement' | 'unknown';

function rollbackGuidance(
  path: string,
  lockRemoved: boolean,
  classification: RollbackLockClassification,
): string[] {
  if (lockRemoved) {
    return [
      `Acquisition rollback unlinked ${path}, but crash durability is unconfirmed.`,
      `Inspect only the exact reported path ${path} before retrying.`,
    ];
  }
  if (classification === 'own') {
    return [
      `Acquisition rollback could not prove that the lock is absent at ${path}.`,
      'The recorded owner may be a live failed acquirer with no lease and will not release the retained lock.',
      `Automatic recovery is preferred after it exits; otherwise confirm no related acquisition is active before targeted manual removal of only the exact reported path ${path}.`,
    ];
  }
  if (classification === 'replacement') {
    return [
      `Acquisition rollback observed a replacement lock at ${path}.`,
      'The replacement lock must not be removed as failed-acquirer cleanup.',
      'Wait for its owner to release it or follow the normal reviewed recovery procedure.',
    ];
  }
  return [
    `Acquisition rollback could not prove that the lock is absent at ${path}.`,
    'The owner metadata may be unavailable; inspect the exact reported path before deciding whether recovery is safe.',
    `Confirm no related acquisition is active before targeted manual removal of only the exact reported path ${path}.`,
  ];
}

function rollbackError(
  path: string,
  lockRemoved: boolean,
  cause: unknown,
  classification: RollbackLockClassification,
  owner?: EvidenceWriterLockOwner,
): EvidenceWriterLockError {
  return new EvidenceWriterLockError(
    'EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED',
    `Failed to roll back evidence writer lock acquisition at ${path}.`,
    {
      lockPath: path,
      lockRemoved,
      cause,
      guidance: rollbackGuidance(path, lockRemoved, classification),
      ...(owner === undefined ? {} : { owner }),
    },
  );
}

/** @id CODE-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 * @implements REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
 * @design DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001 DES-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-002
 */
async function rollbackPublishedLock(
  path: string,
  directory: string,
  expectedCanonicalRoot: string,
  expectedTransactionId: string,
  publishedIdentity: EvidenceWriterLockIdentity | undefined,
  dependencies: EvidenceWriterLockDependencies,
): Promise<{ completed: true } | { completed: false; error: EvidenceWriterLockError }> {
  if (publishedIdentity === undefined) {
    let owner: EvidenceWriterLockOwner | undefined;
    try {
      owner = await (dependencies.lockOwner ?? readOwner)(path);
    } catch {
      owner = undefined;
    }
    const classification = owner === undefined
      ? 'unknown'
      : owner.canonicalRoot === expectedCanonicalRoot
        && owner.transactionId === expectedTransactionId
        ? 'own'
        : 'replacement';
    return {
      completed: false,
      error: rollbackError(
        path,
        false,
        new Error('Published lock identity was not captured.'),
        classification,
        owner,
      ),
    };
  }

  let observation: { owner: EvidenceWriterLockOwner; identity: EvidenceWriterLockIdentity };
  try {
    observation = await observeLock(path, dependencies);
  } catch (cause) {
    if (errno(cause) === 'ENOENT') return { completed: true };
    return { completed: false, error: rollbackError(path, false, cause, 'unknown') };
  }

  const { owner, identity } = observation;
  if (
    owner.canonicalRoot !== expectedCanonicalRoot
    || owner.transactionId !== expectedTransactionId
    || identity.dev !== publishedIdentity.dev
    || identity.ino !== publishedIdentity.ino
  ) {
    return {
      completed: false,
      error: rollbackError(
        path,
        false,
        new Error('Published lock identity changed before acquisition rollback.'),
        'replacement',
        owner,
      ),
    };
  }

  try {
    await (dependencies.rollbackUnlink ?? unlink)(path);
  } catch (cause) {
    if (errno(cause) === 'ENOENT') return { completed: true };
    return { completed: false, error: rollbackError(path, false, cause, 'own', owner) };
  }

  try {
    await syncDirectory(
      directory,
      (dependencies.platform ?? (() => process.platform))(),
      'allow-unsupported',
      dependencies.syncEvidenceDirectory,
    );
  } catch (cause) {
    return { completed: false, error: rollbackError(path, true, cause, 'own', owner) };
  }
  return { completed: true };
}

async function removeCreatedDirectoryIfEmpty(path: string, existed: boolean): Promise<void> {
  if (existed) return;
  try {
    await rmdir(path);
  } catch (cause) {
    if (!['ENOENT', 'ENOTEMPTY'].includes(errno(cause) ?? '')) throw cause;
  }
}

/** @id CODE-EVIDENCE-WRITER-LOCK-002
 * @implements REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-004
 * @design DES-EVIDENCE-WRITER-LOCK-001
 */
export async function acquireEvidenceWriterLock(
  root: string,
  command: string,
  dependencies: EvidenceWriterLockDependencies = {},
): Promise<EvidenceWriterLease> {
  let canonicalRoot = resolve(root);
  let rootExisted = true;
  let directory = evidenceDirectory(canonicalRoot);
  let canonicalLockPath = lockPath(canonicalRoot);
  let musubixDirectory = resolve(canonicalRoot, '.musubix');
  let musubixDirectoryExisted = true;
  let evidenceDirectoryExisted = true;
  let transactionId = '';
  let stagingPath = '';
  let owner: EvidenceWriterLockOwner | undefined;
  let publishedIdentity: EvidenceWriterLockIdentity | undefined;
  let published = false;
  let publicationRemoved = false;

  try {
    ({ canonicalRoot, rootExisted } = canonicalizeRootForAcquisition(root));
    directory = evidenceDirectory(canonicalRoot);
    canonicalLockPath = lockPath(canonicalRoot);
    musubixDirectory = resolve(canonicalRoot, '.musubix');
    musubixDirectoryExisted = existsSync(musubixDirectory);
    evidenceDirectoryExisted = existsSync(directory);
    transactionId = randomUUID();
    stagingPath = resolve(directory, `${STAGING_PREFIX}${transactionId}.json`);
    const processFingerprint = dependencies.processFingerprint === undefined
      ? defaultProcessFingerprintSync()
      : await dependencies.processFingerprint();
    owner = {
      schemaVersion: 1,
      canonicalRoot,
      command,
      pid: process.pid,
      hostname: (dependencies.hostname ?? systemHostname)(),
      acquiredAt: new Date().toISOString(),
      transactionId,
      processFingerprint,
    };
    mkdirSync(directory, { recursive: true });
    const staging = openSync(stagingPath, 'wx', 0o600);
    try {
      writeFileSync(staging, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
      fsyncSync(staging);

      try {
        linkSync(stagingPath, canonicalLockPath);
        published = true;
      } catch (cause) {
        if (errno(cause) === 'EEXIST') {
          throw lockedError(canonicalLockPath, await readContendingOwner(canonicalLockPath));
        }
        throw cause;
      }
      publishedIdentity = (dependencies.publishedLockIdentity
        ?? ((descriptor: number) => {
          const identity = fstatSync(descriptor);
          return { dev: identity.dev, ino: identity.ino };
        }))(staging);
    } finally {
      closeSync(staging);
    }
    syncDirectorySync(
      directory,
      (dependencies.platform ?? (() => process.platform))(),
      'allow-unsupported',
      dependencies.syncEvidenceDirectorySync,
    );
  } catch (cause) {
    let acquisitionRollbackError: EvidenceWriterLockError | undefined;
    if (published) {
      const rollback = await rollbackPublishedLock(
        canonicalLockPath,
        directory,
        canonicalRoot,
        transactionId,
        publishedIdentity,
        dependencies,
      );
      publicationRemoved = rollback.completed;
      if (!rollback.completed) acquisitionRollbackError = rollback.error;
    }
    if (!published && cause instanceof EvidenceWriterLockError) throw cause;
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      `Failed to acquire evidence writer lock at ${canonicalLockPath}.`,
      {
        lockPath: canonicalLockPath,
        cause,
        ...(acquisitionRollbackError === undefined ? {} : { rollbackError: acquisitionRollbackError }),
      },
    );
  } finally {
    if (stagingPath !== '') {
      try {
        unlinkSync(stagingPath);
      } catch (cause) {
        if (errno(cause) !== 'ENOENT' && !published) {
          throw new EvidenceWriterLockError(
            'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
            `Failed to clean evidence writer lock staging file at ${stagingPath}.`,
            { lockPath: canonicalLockPath, cause },
          );
        }
      }
    }
    if (!published || publicationRemoved) {
      try {
        await removeCreatedDirectoryIfEmpty(directory, evidenceDirectoryExisted);
        await removeCreatedDirectoryIfEmpty(musubixDirectory, musubixDirectoryExisted);
        await removeCreatedDirectoryIfEmpty(canonicalRoot, rootExisted);
      } catch {
        // Preserve the original acquisition or contention error.
      }
    }
  }

  if (owner === undefined || publishedIdentity === undefined) {
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      `Failed to construct evidence writer lock owner at ${canonicalLockPath}.`,
      { lockPath: canonicalLockPath },
    );
  }
  let released = false;
  return {
    owner,
    async release(): Promise<void> {
      if (released) return;
      try {
        const { owner: current, identity: currentIdentity } = await observeLock(
          canonicalLockPath,
          dependencies,
        );
        if (
          current.canonicalRoot !== canonicalRoot
          || current.transactionId !== transactionId
          || currentIdentity.dev !== publishedIdentity.dev
          || currentIdentity.ino !== publishedIdentity.ino
        ) {
          throw new EvidenceWriterLockError(
            'EVIDENCE_WRITER_LOCK_RELEASE_FAILED',
            `Refusing to release a replaced evidence writer lock at ${canonicalLockPath}.`,
            { lockPath: canonicalLockPath, owner: current },
          );
        }
        await unlink(canonicalLockPath);
        await syncDirectory(
          directory,
          (dependencies.platform ?? (() => process.platform))(),
          'allow-unsupported',
          dependencies.syncEvidenceDirectory,
        );
        released = true;
      } catch (cause) {
        if (cause instanceof EvidenceWriterLockError) throw cause;
        throw new EvidenceWriterLockError(
          'EVIDENCE_WRITER_LOCK_RELEASE_FAILED',
          `Failed to release evidence writer lock at ${canonicalLockPath}.`,
          { lockPath: canonicalLockPath, owner, cause },
        );
      }
      try {
        await removeCreatedDirectoryIfEmpty(directory, evidenceDirectoryExisted);
        await removeCreatedDirectoryIfEmpty(musubixDirectory, musubixDirectoryExisted);
        await removeCreatedDirectoryIfEmpty(canonicalRoot, rootExisted);
      } catch {
        // Directory cleanup is best-effort and does not affect lock release.
      }
    },
  };
}

async function useContextLease<T>(
  context: EvidenceWriterContext,
  canonicalRoot: string,
  command: string,
  operation: () => Promise<T>,
  dependencies: EvidenceWriterLockDependencies,
): Promise<T> {
  let state = context.leases.get(canonicalRoot);
  if (state === undefined) {
    const acquisition = acquireEvidenceWriterLock(canonicalRoot, command, dependencies);
    acquisition.catch(() => undefined);
    state = { acquisition, references: 0 };
    context.leases.set(canonicalRoot, state);
  }

  let lease: EvidenceWriterLease;
  try {
    lease = await state.acquisition;
  } catch (cause) {
    if (context.leases.get(canonicalRoot) === state) context.leases.delete(canonicalRoot);
    throw cause;
  }
  state.references += 1;

  let operationError: unknown;
  try {
    return await operation();
  } catch (cause) {
    operationError = cause;
    throw cause;
  } finally {
    state.references -= 1;
    if (state.references === 0 && context.leases.get(canonicalRoot) === state) {
      context.leases.delete(canonicalRoot);
      try {
        await lease.release();
      } catch (releaseError) {
        if (operationError === undefined) throw releaseError;
        if (operationError instanceof Error) {
          Object.defineProperty(operationError, 'evidenceWriterReleaseError', {
            configurable: true,
            enumerable: false,
            value: releaseError,
          });
        }
      }
    }
  }
}

/** @id CODE-EVIDENCE-WRITER-LOCK-003
 * @implements REQ-EVIDENCE-WRITER-LOCK-003 REQ-EVIDENCE-WRITER-LOCK-004
 * @design DES-EVIDENCE-WRITER-LOCK-002
 */
export async function withEvidenceWriterLock<T>(
  root: string,
  command: string,
  operation: () => Promise<T>,
  dependencies: EvidenceWriterLockDependencies = {},
): Promise<T> {
  const existing = ownerContext.getStore();
  const resolveCanonicalRoot = existing?.resolveCanonicalRoot
    ?? dependencies.resolveCanonicalRoot
    ?? resolveEvidenceWriterCanonicalRoot;
  let canonicalRoot: string;
  try {
    ({ canonicalRoot } = canonicalizeRootForAcquisition(root, resolveCanonicalRoot));
  } catch (cause) {
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      `Failed to resolve evidence writer project root: ${resolve(root)}.`,
      { lockPath: lockPath(resolve(root)), cause },
    );
  }
  if (existing !== undefined) {
    return useContextLease(existing, canonicalRoot, command, operation, dependencies);
  }
  const context: EvidenceWriterContext = {
    token: Symbol('evidence-writer-owner'),
    leases: new Map(),
    resolveCanonicalRoot,
    canonicalRoots: new Map(),
  };
  return ownerContext.run(
    context,
    () => useContextLease(context, canonicalRoot, command, operation, dependencies),
  );
}

/** @id CODE-EVIDENCE-WRITER-LOCK-004
 * @implements REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002
 * @design DES-EVIDENCE-WRITER-LOCK-001
 */
export async function readEvidenceWriterLock(root: string): Promise<EvidenceWriterLockState> {
  const canonicalRoot = contextCanonicalRoot(root);
  const path = lockPath(canonicalRoot);
  try {
    return { locked: true, lockPath: path, owner: await readOwner(path) };
  } catch (cause) {
    if (errno(cause) === 'ENOENT') return { locked: false, lockPath: path };
    throw cause;
  }
}

/** @id CODE-EVIDENCE-WRITER-LOCK-005
 * @implements REQ-EVIDENCE-WRITER-LOCK-003
 * @design DES-EVIDENCE-WRITER-LOCK-002
 */
export async function assertEvidenceWriterOwned(root: string): Promise<void> {
  const canonicalRoot = contextCanonicalRoot(root);
  const state = activeLease(canonicalRoot);
  if (state === undefined) {
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_CONTEXT_LOST',
      `Evidence writer ownership context is unavailable for ${canonicalRoot}.`,
      { lockPath: lockPath(canonicalRoot) },
    );
  }
  await state.acquisition;
}

/** @id CODE-EVIDENCE-WRITER-LOCK-007
 * @implements REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-003
 * @design DES-EVIDENCE-WRITER-LOCK-002 DES-EVIDENCE-WRITER-LOCK-003
 */
export async function assertCoordinatedEvidenceRead(root: string): Promise<void> {
  let canonicalRoot: string;
  try {
    canonicalRoot = contextCanonicalRoot(root);
  } catch (cause) {
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      `Failed to resolve evidence reader project root: ${resolve(root)}.`,
      { lockPath: lockPath(resolve(root)), cause },
    );
  }
  if (activeLease(canonicalRoot) !== undefined) return;
  const path = lockPath(canonicalRoot);
  try {
    await lstat(path);
  } catch (cause) {
    if (errno(cause) === 'ENOENT') return;
    throw new EvidenceWriterLockError(
      'EVIDENCE_WRITER_LOCK_ACQUIRE_FAILED',
      `Failed to inspect evidence writer lock at ${path}.`,
      { lockPath: path, cause },
    );
  }
  throw lockedError(path, await readContendingOwner(path));
}

/** @id CODE-EVIDENCE-WRITER-LOCK-008
 * @implements REQ-EVIDENCE-WRITER-LOCK-001 REQ-EVIDENCE-WRITER-LOCK-002 REQ-EVIDENCE-WRITER-LOCK-003 REQ-EVIDENCE-WRITER-LOCK-005
 * @design DES-EVIDENCE-WRITER-LOCK-002 DES-EVIDENCE-WRITER-LOCK-003 DES-EVIDENCE-WRITER-LOCK-004
 */
export async function assertProtectedPathReady(
  root: string,
  path: string,
  access: 'read' | 'write',
): Promise<void> {
  if (!protectedPath(root, path) && !await configuredReportPath(root, path)) return;
  if (access === 'write') await assertEvidenceWriterOwned(root);
  else await assertCoordinatedEvidenceRead(root);
  await assertEvidenceMergeReady(root);
}

export async function withProtectedEvidenceWrite<T>(
  root: string,
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!protectedPath(root, path) && !await configuredReportPath(root, path)) return operation();
  const canonicalRoot = contextCanonicalRoot(root);
  if (activeLease(canonicalRoot) !== undefined) return operation();
  return withEvidenceWriterLock(root, 'protected write', operation);
}

export async function assertEvidenceOutputUnprotected(root: string, path: string): Promise<void> {
  if (protectedPath(root, path) || await configuredReportPath(root, path)) {
    throw new EvidenceProtectedOutputError(resolve(path));
  }
}

async function defaultProcessState(
  owner: EvidenceWriterLockOwner,
  currentFingerprint: EvidenceWriterProcessFingerprint,
): Promise<'dead' | 'live' | 'reused' | 'indeterminate'> {
  if (!isLinuxFingerprint(currentFingerprint) || !isLinuxFingerprint(owner.processFingerprint)) {
    return 'indeterminate';
  }
  try {
    const target = await linuxFingerprint(owner.pid);
    return target.processStart === owner.processFingerprint.processStart ? 'live' : 'reused';
  } catch (cause) {
    return errno(cause) === 'ENOENT' ? 'dead' : 'indeterminate';
  }
}

function recoveryUnsafe(
  path: string,
  owner: EvidenceWriterLockOwner | undefined,
  reason: string,
  cause?: unknown,
): EvidenceWriterLockError {
  const guidance = [
    `Inspect ${path} and confirm that no related process is active.`,
    `If recovery remains unsafe, back up the file and remove only ${path} after manual verification.`,
  ];
  return new EvidenceWriterLockError(
    'EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE',
    `Cannot safely recover evidence writer lock at ${path}: ${reason} ${guidance.join(' ')}`,
    {
      lockPath: path,
      ...(owner === undefined ? {} : { owner }),
      ...(cause === undefined ? {} : { cause }),
      guidance,
    },
  );
}

/** @id CODE-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 * @implements REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 * @design DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 */
function recoveryDurabilityFailed(
  path: string,
  owner: EvidenceWriterLockOwner,
  cause: unknown,
): EvidenceWriterLockError {
  const guidance = [
    `The canonical lock path ${path} is absent now, but crash durability is unconfirmed.`,
    `Inspect only the exact reported path ${path} before retrying.`,
  ];
  return new EvidenceWriterLockError(
    'EVIDENCE_WRITER_LOCK_RECOVERY_DURABILITY_FAILED',
    `Recovered evidence writer lock at ${path}, but the containing directory could not be synchronized. ${guidance.join(' ')}`,
    {
      lockPath: path,
      owner,
      cause,
      lockRemoved: true,
      guidance,
    },
  );
}

/** @id CODE-EVIDENCE-WRITER-LOCK-006
 * @implements REQ-EVIDENCE-WRITER-LOCK-004 REQ-EVIDENCE-WRITER-LOCK-005 REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 * @design DES-EVIDENCE-WRITER-LOCK-004 DES-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001
 */
export async function recoverEvidenceWriterLock(
  root: string,
  dependencies: EvidenceWriterRecoveryDependencies = {},
): Promise<EvidenceWriterRecoveryReport> {
  const canonicalRoot = (dependencies.resolveCanonicalRoot
    ?? resolveEvidenceWriterCanonicalRoot)(root);
  const path = lockPath(canonicalRoot);
  let owner: EvidenceWriterLockOwner;
  let initialIdentity: EvidenceWriterLockIdentity;
  try {
    ({ owner, identity: initialIdentity } = await observeLock(path, dependencies));
  } catch (cause) {
    if (errno(cause) === 'ENOENT') {
      return { action: 'nothing-to-recover', recovered: false };
    }
    throw recoveryUnsafe(path, undefined, 'owner metadata could not be inspected.', cause);
  }

  const currentHostname = (dependencies.hostname ?? systemHostname)();
  if (owner.hostname !== currentHostname) {
    throw recoveryUnsafe(path, owner, 'the lock belongs to a different host.');
  }
  if (owner.canonicalRoot !== canonicalRoot) {
    throw recoveryUnsafe(path, owner, 'the recorded canonical root does not match.');
  }

  let currentFingerprint: EvidenceWriterProcessFingerprint;
  try {
    currentFingerprint = await (dependencies.processFingerprint ?? defaultProcessFingerprint)();
  } catch (cause) {
    throw recoveryUnsafe(path, owner, 'the current process fingerprint is unavailable.', cause);
  }
  if (
    !isLinuxFingerprint(owner.processFingerprint)
    || !isLinuxFingerprint(currentFingerprint)
    || owner.processFingerprint.bootId !== currentFingerprint.bootId
    || owner.processFingerprint.pidNamespace !== currentFingerprint.pidNamespace
  ) {
    throw recoveryUnsafe(path, owner, 'host process identity cannot be matched conclusively.');
  }

  let processState: 'dead' | 'live' | 'reused' | 'indeterminate';
  try {
    processState = await (dependencies.processState ?? defaultProcessState)(owner, currentFingerprint);
  } catch (cause) {
    throw recoveryUnsafe(path, owner, 'owner process liveness could not be determined.', cause);
  }
  if (processState === 'live') throw lockedError(path, owner);
  if (processState !== 'dead') {
    throw recoveryUnsafe(path, owner, `owner process state is ${processState}.`);
  }

  let finalOwner: EvidenceWriterLockOwner;
  let finalIdentity: EvidenceWriterLockIdentity;
  try {
    ({ owner: finalOwner, identity: finalIdentity } = await observeLock(path, dependencies));
  } catch (cause) {
    throw recoveryUnsafe(path, owner, 'the lock could not be revalidated before removal.', cause);
  }
  if (
    finalOwner.transactionId !== owner.transactionId
    || finalIdentity.dev !== initialIdentity.dev
    || finalIdentity.ino !== initialIdentity.ino
  ) {
    throw recoveryUnsafe(path, finalOwner, 'the lock changed during recovery.');
  }

  try {
    await unlink(path);
  } catch (cause) {
    throw recoveryUnsafe(path, owner, 'the verified lock could not be removed.', cause);
  }
  try {
    await syncRecoveredEvidenceDirectoryStrict(canonicalRoot, dependencies);
  } catch (cause) {
    throw recoveryDurabilityFailed(path, owner, cause);
  }
  return { action: 'recovered', recovered: true };
}
