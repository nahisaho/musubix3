import { error, type Diagnostic } from '../../domain/src/index.js';
import { exists, readText, within } from './files.js';

export interface CommandConfig {
  name: string;
  command: string;
  args: string[];
  tddArgs?: string[];
  tddReport?: {
    format: 'musubix-json';
    path: string;
  };
  testReport?: {
    format: 'musubix-json';
    path: string;
  };
  mutationReport?: {
    format: 'musubix-mutation-json';
    path: string;
  };
  adapter?: 'vitest' | 'jest' | 'pytest' | 'go-test' | 'cargo' | 'junit';
  required: boolean;
  timeoutMs: number;
}

export interface ArchitectureRule {
  name: string;
  from: string;
  disallow: string[];
}

export interface FormalConfig {
  solver: 'auto' | 'none' | 'z3' | 'lean';
  minModeledFraction: number;
  timeoutMs: number;
}

export interface AttestationConfig {
  mode: 'off' | 'local' | 'ci-required';
  repository?: string;
  maxAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
  trustedPublicKeys: Array<{ id: string; publicKey: string }>;
  githubOidc?: GitHubOidcConfig;
}

export interface GitHubOidcConfig {
  mode: 'off' | 'strict';
  issuer?: 'https://token.actions.githubusercontent.com';
  audience?: string;
  repository?: string;
  workflow?: string;
  ref?: string;
  keyBinding?: 'public-key' | 'key-id';
}

export interface WorkflowConfig {
  mode: 'compatible' | 'strict';
  expectedSessionId?: string;
  maxAgeSeconds?: number;
  maxFutureSkewSeconds?: number;
  maxEventSkewMs?: number;
}

export interface CodeGraphConfig {
  mode: 'compatible' | 'strict';
}

export interface MutationConfig {
  mode: 'compatible' | 'strict';
}

export interface TddConfig {
  redPreflightCommands: string[];
}

export type QualityProfile = 'custom' | 'minimal' | 'recommended' | 'release';

export interface Config {
  schemaVersion: 1;
  language: 'auto' | 'en' | 'ja';
  qualityProfile: QualityProfile;
  commands: CommandConfig[];
  requiredChecks: string[];
  thresholds: { design: number; implementation: number; tests: number };
  architecture: { forbidCycles: boolean; rules: ArchitectureRule[] };
  codeGraph: CodeGraphConfig;
  formal: FormalConfig;
  mutation: MutationConfig;
  tdd: TddConfig;
  workflow: WorkflowConfig;
  attestation: AttestationConfig;
}

export interface PolicyBaseline {
  schemaVersion: 1;
  qualityProfile: QualityProfile;
  commands: CommandConfig[];
  requiredChecks: string[];
  thresholds: Config['thresholds'];
  architecture: Config['architecture'];
  codeGraph: Config['codeGraph'];
  formal: Pick<FormalConfig, 'solver' | 'minModeledFraction'>;
  mutation: MutationConfig;
  tdd: TddConfig;
  workflow: WorkflowConfig;
  attestation: AttestationConfig;
  requiredCommands: string[];
}

export const checkNames = ['requirements', 'design', 'constitution', 'trace', 'graph', 'formal', 'model-correspondence', 'mutation', 'workflow', 'tdd', 'change-history', 'change-completeness', 'performance', 'attestation', 'test-identities', 'commands'] as const;

export const defaultConfig: Config = {
  schemaVersion: 1,
  language: 'auto',
  qualityProfile: 'custom',
  commands: [],
  requiredChecks: ['requirements', 'design', 'constitution', 'trace', 'graph', 'commands'],
  thresholds: { design: 1, implementation: 1, tests: 1 },
  architecture: { forbidCycles: true, rules: [] },
  codeGraph: { mode: 'compatible' },
  formal: { solver: 'none', minModeledFraction: 0, timeoutMs: 12_000 },
  mutation: { mode: 'compatible' },
  tdd: { redPreflightCommands: [] },
  workflow: { mode: 'compatible', maxAgeSeconds: 3600, maxFutureSkewSeconds: 60, maxEventSkewMs: 1000 },
  attestation: {
    mode: 'local',
    maxAgeSeconds: 3600,
    maxFutureSkewSeconds: 60,
    trustedPublicKeys: [],
    githubOidc: { mode: 'off' },
  },
};

export const defaultPolicyBaseline: PolicyBaseline = {
  schemaVersion: 1,
  qualityProfile: defaultConfig.qualityProfile,
  commands: [],
  requiredChecks: [...defaultConfig.requiredChecks],
  thresholds: { ...defaultConfig.thresholds },
  architecture: { forbidCycles: defaultConfig.architecture.forbidCycles, rules: [...defaultConfig.architecture.rules] },
  codeGraph: { ...defaultConfig.codeGraph },
  formal: { solver: defaultConfig.formal.solver, minModeledFraction: defaultConfig.formal.minModeledFraction },
  mutation: { ...defaultConfig.mutation },
  tdd: { redPreflightCommands: [...defaultConfig.tdd.redPreflightCommands] },
  workflow: { ...defaultConfig.workflow },
  attestation: {
    ...defaultConfig.attestation,
    trustedPublicKeys: [...defaultConfig.attestation.trustedPublicKeys],
    githubOidc: { ...defaultConfig.attestation.githubOidc! },
  },
  requiredCommands: [],
};

function object(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${location} must be an object.`);
  return value as Record<string, unknown>;
}

function keys(value: Record<string, unknown>, allowed: string[], location: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown config key ${location}.${key}.`);
  }
}

function strings(value: unknown, location: string, allowEmpty = false): string[] {
  if (!Array.isArray(value) || !value.every((s) => typeof s === 'string' && !s.includes('\0') && (allowEmpty || s.length > 0))) throw new Error(`${location} must be an array of ${allowEmpty ? '' : 'nonempty '}strings without NUL bytes.`);
  return value as string[];
}

function optional(value: unknown, fallback: unknown): unknown {
  return value === undefined ? fallback : value;
}

function validateAdapterArgs(adapter: CommandConfig['adapter'], args: string[], name: string): void {
  if (!adapter) return;
  const owned = {
    vitest: ['--reporter', '--outputFile'],
    jest: ['--json', '--outputFile'],
    pytest: ['--json-report', '--json-report-file'],
    'go-test': ['-json', '-run'],
    cargo: ['--format'],
    junit: ['--scan-class-path', '--include-tag', '--reports-dir', '--fail-if-no-tests'],
  }[adapter];
  const conflict = args.find((arg) => owned.some((value) => arg === value || arg.startsWith(`${value}=`)));
  if (conflict) {
    throw new Error(`command ${name} args contain adapter-owned argument ${conflict}; remove it because the ${adapter} adapter adds targeted test/report arguments.`);
  }
}

const profileRequiredChecks: Record<Exclude<QualityProfile, 'custom'>, string[]> = {
  minimal: ['requirements', 'design', 'constitution', 'trace', 'graph', 'commands'],
  recommended: ['requirements', 'design', 'constitution', 'trace', 'graph', 'commands', 'test-identities', 'tdd'],
  release: [
    'requirements', 'design', 'constitution', 'trace', 'graph', 'formal', 'model-correspondence',
    'mutation', 'workflow', 'tdd', 'change-history', 'change-completeness', 'performance',
    'attestation', 'test-identities', 'commands',
  ],
};

function validateQualityProfile(config: Config): void {
  if (config.qualityProfile === 'custom') return;
  const missing = profileRequiredChecks[config.qualityProfile]
    .filter((check) => !config.requiredChecks.includes(check));
  if (missing.length) {
    throw new Error(`qualityProfile ${config.qualityProfile} requires checks: ${missing.join(', ')}.`);
  }
  if (config.qualityProfile !== 'minimal' && config.codeGraph.mode !== 'strict') {
    throw new Error(`qualityProfile ${config.qualityProfile} requires codeGraph.mode strict.`);
  }
  if (config.qualityProfile === 'release') {
    if (config.formal.solver === 'none' || config.formal.minModeledFraction <= 0) {
      throw new Error('qualityProfile release requires a formal solver and positive modeled coverage.');
    }
    if (config.mutation.mode !== 'strict') throw new Error('qualityProfile release requires mutation.mode strict.');
    if (config.workflow.mode !== 'strict') throw new Error('qualityProfile release requires workflow.mode strict.');
    if (config.attestation.mode !== 'ci-required') {
      throw new Error('qualityProfile release requires attestation.mode ci-required.');
    }
  }
}

export function parseConfig(input: unknown): Config {
  const value = object(input, 'config');
  keys(value, ['schemaVersion', 'language', 'qualityProfile', 'commands', 'requiredChecks', 'thresholds', 'architecture', 'codeGraph', 'formal', 'mutation', 'tdd', 'workflow', 'attestation'], 'config');
  if (value.schemaVersion !== 1) throw new Error('Unsupported config schemaVersion; expected 1.');
  const language = optional(value.language, 'auto');
  if (!['auto', 'en', 'ja'].includes(String(language))) throw new Error('language must be auto, en, or ja.');
  const qualityProfile = optional(value.qualityProfile, defaultConfig.qualityProfile);
  if (!['custom', 'minimal', 'recommended', 'release'].includes(String(qualityProfile))) {
    throw new Error('qualityProfile must be custom, minimal, recommended, or release.');
  }
  const requiredChecks = strings(optional(value.requiredChecks, defaultConfig.requiredChecks), 'requiredChecks');
  if (requiredChecks.some((s) => !checkNames.includes(s as typeof checkNames[number]))) throw new Error('Unknown required check.');
  const thresholds = { ...defaultConfig.thresholds };
  if (value.thresholds !== undefined) {
    const raw = object(value.thresholds, 'thresholds');
    keys(raw, Object.keys(thresholds), 'thresholds');
    for (const key of Object.keys(thresholds) as (keyof typeof thresholds)[]) {
      const threshold = optional(raw[key], thresholds[key]);
      if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error(`thresholds.${key} must be in [0, 1].`);
      thresholds[key] = threshold;
    }
  }
  const rawCommands = optional(value.commands, []);
  if (!Array.isArray(rawCommands)) throw new Error('commands must be an array.');
  const commands = rawCommands.map((raw: unknown): CommandConfig => {
    const c = object(raw, 'command');
    keys(c, ['name', 'command', 'args', 'tddArgs', 'tddReport', 'testReport', 'mutationReport', 'adapter', 'required', 'timeoutMs'], 'command');
    if (typeof c.name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(c.name)) throw new Error('Command name must be a simple nonempty identifier.');
    if (typeof c.command !== 'string' || !c.command.trim() || c.command.includes('\0')) throw new Error('Command executable must be nonempty.');
    if (c.required !== undefined && typeof c.required !== 'boolean') throw new Error('command.required must be boolean.');
    if (c.adapter !== undefined && !['vitest', 'jest', 'pytest', 'go-test', 'cargo', 'junit'].includes(String(c.adapter))) {
      throw new Error('command.adapter must be vitest, jest, pytest, go-test, cargo, or junit.');
    }
    const timeoutMs = optional(c.timeoutMs, 120_000);
    if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 3_600_000) throw new Error('Command timeoutMs must be 1..3600000.');
    const tddArgs = c.tddArgs === undefined ? undefined : strings(c.tddArgs, 'command.tddArgs', true);
    if (tddArgs && !tddArgs.some((arg) => arg.includes('{testId}') || arg.includes('{testPath}'))) {
      throw new Error('command.tddArgs must contain {testId} or {testPath}.');
    }
    let tddReport: CommandConfig['tddReport'];
    if (c.tddReport !== undefined) {
      const report = object(c.tddReport, 'command.tddReport');
      keys(report, ['format', 'path'], 'command.tddReport');
      if (report.format !== 'musubix-json') throw new Error('command.tddReport.format must be musubix-json.');
      if (typeof report.path !== 'string' || !report.path || report.path.includes('\0') || !report.path.includes('{testId}')) {
        throw new Error('command.tddReport.path must be a nonempty relative path containing {testId}.');
      }
      if (report.path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(report.path)) throw new Error('command.tddReport.path must be relative.');
      tddReport = { format: 'musubix-json', path: report.path };
    }
    if (!c.adapter && (tddArgs === undefined) !== (tddReport === undefined)) {
      throw new Error('command.tddArgs and command.tddReport must be configured together.');
    }
    let testReport: CommandConfig['testReport'];
    if (c.testReport !== undefined) {
      const report = object(c.testReport, 'command.testReport');
      keys(report, ['format', 'path'], 'command.testReport');
      if (report.format !== 'musubix-json') throw new Error('command.testReport.format must be musubix-json.');
      if (typeof report.path !== 'string' || !report.path || report.path.includes('\0') || report.path.includes('{testId}')) {
        throw new Error('command.testReport.path must be a nonempty aggregate report path without {testId}.');
      }
      if (report.path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(report.path)) throw new Error('command.testReport.path must be relative.');
      testReport = { format: 'musubix-json', path: report.path };
    }
    let mutationReport: CommandConfig['mutationReport'];
    if (c.mutationReport !== undefined) {
      const report = object(c.mutationReport, 'command.mutationReport');
      keys(report, ['format', 'path'], 'command.mutationReport');
      if (report.format !== 'musubix-mutation-json') {
        throw new Error('command.mutationReport.format must be musubix-mutation-json.');
      }
      if (typeof report.path !== 'string' || !report.path || report.path.includes('\0')
        || report.path.includes('{testId}') || report.path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(report.path)) {
        throw new Error('command.mutationReport.path must be a nonempty relative aggregate report path.');
      }
      mutationReport = { format: 'musubix-mutation-json', path: report.path };
    }
    if (mutationReport && (testReport || c.adapter)) {
      throw new Error('command.mutationReport cannot be combined with testReport or adapter.');
    }
    const args = strings(optional(c.args, []), 'command.args', true);
    const adapter = c.adapter as CommandConfig['adapter'];
    validateAdapterArgs(adapter, args, c.name);
    return {
      name: c.name,
      command: c.command,
      args,
      ...(tddArgs ? { tddArgs } : {}),
      ...(tddReport ? { tddReport } : {}),
      ...(testReport ? { testReport } : {}),
      ...(mutationReport ? { mutationReport } : {}),
      ...(adapter ? { adapter } : {}),
      required: c.required !== false,
      timeoutMs,
    };
  });
  if (new Set(commands.map((c) => c.name)).size !== commands.length) throw new Error('Command names must be unique.');
  const rawTdd = object(optional(value.tdd, {}), 'tdd');
  keys(rawTdd, ['redPreflightCommands'], 'tdd');
  const redPreflightCommands = strings(
    optional(rawTdd.redPreflightCommands, defaultConfig.tdd.redPreflightCommands),
    'tdd.redPreflightCommands',
  );
  if (new Set(redPreflightCommands).size !== redPreflightCommands.length) {
    throw new Error('tdd.redPreflightCommands must not contain duplicates.');
  }
  for (const name of redPreflightCommands) {
    const command = commands.find((candidate) => candidate.name === name);
    if (!command) throw new Error(`tdd.redPreflightCommands references unknown command ${name}.`);
    if (command.adapter || command.testReport || command.tddReport || command.mutationReport) {
      throw new Error(`TDD Red preflight command ${name} must be a plain command without test or mutation reports.`);
    }
  }
  const architecture = object(optional(value.architecture, {}), 'architecture');
  keys(architecture, ['forbidCycles', 'rules'], 'architecture');
  if (architecture.forbidCycles !== undefined && typeof architecture.forbidCycles !== 'boolean') throw new Error('architecture.forbidCycles must be boolean.');
  const rawRules = optional(architecture.rules, []);
  if (!Array.isArray(rawRules)) throw new Error('architecture.rules must be an array.');
  const rules = rawRules.map((raw: unknown): ArchitectureRule => {
    const r = object(raw, 'architecture rule');
    keys(r, ['name', 'from', 'disallow'], 'architecture rule');
    if (typeof r.name !== 'string' || !r.name || typeof r.from !== 'string' || !r.from) throw new Error('Architecture rules need name and from glob.');
    return { name: r.name, from: r.from, disallow: strings(r.disallow, 'rule.disallow') };
  });
  const rawCodeGraph = object(optional(value.codeGraph, {}), 'codeGraph');
  keys(rawCodeGraph, ['mode'], 'codeGraph');
  const codeGraphMode = optional(rawCodeGraph.mode, defaultConfig.codeGraph.mode);
  if (!['compatible', 'strict'].includes(String(codeGraphMode))) {
    throw new Error('codeGraph.mode must be compatible or strict.');
  }
  const rawFormal = object(optional(value.formal, {}), 'formal');
  keys(rawFormal, ['solver', 'minModeledFraction', 'timeoutMs'], 'formal');
  const solver = optional(rawFormal.solver, defaultConfig.formal.solver);
  if (!['auto', 'none', 'z3', 'lean'].includes(String(solver))) throw new Error('formal.solver must be auto, none, z3, or lean.');
  const minModeledFraction = optional(rawFormal.minModeledFraction, defaultConfig.formal.minModeledFraction);
  if (typeof minModeledFraction !== 'number' || !Number.isFinite(minModeledFraction) || minModeledFraction < 0 || minModeledFraction > 1) {
    throw new Error('formal.minModeledFraction must be in [0, 1].');
  }
  const formalTimeoutMs = optional(rawFormal.timeoutMs, defaultConfig.formal.timeoutMs);
  if (typeof formalTimeoutMs !== 'number' || !Number.isInteger(formalTimeoutMs) || formalTimeoutMs < 100 || formalTimeoutMs > 300_000) {
    throw new Error('formal.timeoutMs must be 100..300000.');
  }
  const rawMutation = object(optional(value.mutation, {}), 'mutation');
  keys(rawMutation, ['mode'], 'mutation');
  const mutationMode = optional(rawMutation.mode, defaultConfig.mutation.mode);
  if (!['compatible', 'strict'].includes(String(mutationMode))) {
    throw new Error('mutation.mode must be compatible or strict.');
  }
  const rawWorkflow = object(optional(value.workflow, {}), 'workflow');
  keys(rawWorkflow, ['mode', 'expectedSessionId', 'maxAgeSeconds', 'maxFutureSkewSeconds', 'maxEventSkewMs'], 'workflow');
  const workflowMode = optional(rawWorkflow.mode, defaultConfig.workflow.mode);
  if (!['compatible', 'strict'].includes(String(workflowMode))) {
    throw new Error('workflow.mode must be compatible or strict.');
  }
  if (rawWorkflow.expectedSessionId !== undefined
    && (typeof rawWorkflow.expectedSessionId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawWorkflow.expectedSessionId))) {
    throw new Error('workflow.expectedSessionId must be a UUID.');
  }
  if (rawWorkflow.expectedSessionId !== undefined && workflowMode !== 'strict') {
    throw new Error('workflow.expectedSessionId requires workflow.mode strict.');
  }
  const workflowMaxAgeSeconds = optional(rawWorkflow.maxAgeSeconds, defaultConfig.workflow.maxAgeSeconds);
  if (typeof workflowMaxAgeSeconds !== 'number' || !Number.isInteger(workflowMaxAgeSeconds)
    || workflowMaxAgeSeconds < 1 || workflowMaxAgeSeconds > 604_800) {
    throw new Error('workflow.maxAgeSeconds must be 1..604800.');
  }
  const workflowMaxFutureSkewSeconds = optional(
    rawWorkflow.maxFutureSkewSeconds,
    defaultConfig.workflow.maxFutureSkewSeconds,
  );
  if (typeof workflowMaxFutureSkewSeconds !== 'number' || !Number.isInteger(workflowMaxFutureSkewSeconds)
    || workflowMaxFutureSkewSeconds < 0 || workflowMaxFutureSkewSeconds > 600) {
    throw new Error('workflow.maxFutureSkewSeconds must be 0..600.');
  }
  const workflowMaxEventSkewMs = optional(rawWorkflow.maxEventSkewMs, defaultConfig.workflow.maxEventSkewMs);
  if (typeof workflowMaxEventSkewMs !== 'number' || !Number.isInteger(workflowMaxEventSkewMs)
    || workflowMaxEventSkewMs < 0 || workflowMaxEventSkewMs > 60_000) {
    throw new Error('workflow.maxEventSkewMs must be 0..60000.');
  }
  const rawAttestation = object(optional(value.attestation, {}), 'attestation');
  keys(rawAttestation, [
    'mode', 'repository', 'maxAgeSeconds', 'maxFutureSkewSeconds', 'trustedPublicKeys', 'githubOidc',
  ], 'attestation');
  const mode = optional(rawAttestation.mode, defaultConfig.attestation.mode);
  if (!['off', 'local', 'ci-required'].includes(String(mode))) throw new Error('attestation.mode must be off, local, or ci-required.');
  if (rawAttestation.repository !== undefined && (typeof rawAttestation.repository !== 'string' || !rawAttestation.repository.trim())) {
    throw new Error('attestation.repository must be a nonempty string.');
  }
  const maxAgeSeconds = optional(rawAttestation.maxAgeSeconds, defaultConfig.attestation.maxAgeSeconds);
  if (typeof maxAgeSeconds !== 'number' || !Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 1 || maxAgeSeconds > 604_800) {
    throw new Error('attestation.maxAgeSeconds must be 1..604800.');
  }
  const maxFutureSkewSeconds = optional(rawAttestation.maxFutureSkewSeconds, defaultConfig.attestation.maxFutureSkewSeconds);
  if (typeof maxFutureSkewSeconds !== 'number' || !Number.isInteger(maxFutureSkewSeconds)
    || maxFutureSkewSeconds < 0 || maxFutureSkewSeconds > 600) {
    throw new Error('attestation.maxFutureSkewSeconds must be 0..600.');
  }
  const rawKeys = optional(rawAttestation.trustedPublicKeys, []);
  if (!Array.isArray(rawKeys)) throw new Error('attestation.trustedPublicKeys must be an array.');
  const trustedPublicKeys = rawKeys.map((raw): AttestationConfig['trustedPublicKeys'][number] => {
    const key = object(raw, 'attestation public key');
    keys(key, ['id', 'publicKey'], 'attestation public key');
    if (typeof key.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(key.id)
      || typeof key.publicKey !== 'string' || !key.publicKey.includes('BEGIN PUBLIC KEY')) {
      throw new Error('Attestation keys need a simple id and PEM publicKey.');
    }
    return { id: key.id, publicKey: key.publicKey };
  });
  if (new Set(trustedPublicKeys.map((key) => key.id)).size !== trustedPublicKeys.length) throw new Error('Attestation key IDs must be unique.');
  const rawGithubOidc = object(optional(rawAttestation.githubOidc, {}), 'attestation.githubOidc');
  keys(rawGithubOidc, ['mode', 'issuer', 'audience', 'repository', 'workflow', 'ref', 'keyBinding'], 'attestation.githubOidc');
  const githubOidcMode = optional(rawGithubOidc.mode, defaultConfig.attestation.githubOidc?.mode ?? 'off');
  if (!['off', 'strict'].includes(String(githubOidcMode))) {
    throw new Error('attestation.githubOidc.mode must be off or strict.');
  }
  const githubIssuer = optional(rawGithubOidc.issuer, 'https://token.actions.githubusercontent.com');
  if (githubIssuer !== 'https://token.actions.githubusercontent.com') {
    throw new Error('attestation.githubOidc.issuer must be https://token.actions.githubusercontent.com.');
  }
  const githubAudience = rawGithubOidc.audience;
  if (githubOidcMode === 'strict'
    && (typeof githubAudience !== 'string' || !githubAudience.trim()
      || githubAudience.includes('\0') || githubAudience.includes('#'))) {
    throw new Error('attestation.githubOidc.audience must be nonempty and contain no # in strict mode.');
  }
  for (const key of ['repository', 'workflow', 'ref'] as const) {
    const claim = rawGithubOidc[key];
    if (claim !== undefined && (typeof claim !== 'string' || !claim.trim() || claim.includes('\0'))) {
      throw new Error(`attestation.githubOidc.${key} must be a nonempty string.`);
    }
  }
  const keyBinding = optional(rawGithubOidc.keyBinding, 'public-key');
  if (!['public-key', 'key-id'].includes(String(keyBinding))) {
    throw new Error('attestation.githubOidc.keyBinding must be public-key or key-id.');
  }
  if (githubOidcMode === 'strict' && mode !== 'ci-required') {
    throw new Error('attestation.githubOidc.mode strict requires attestation.mode ci-required.');
  }
  if (typeof rawAttestation.repository === 'string' && typeof rawGithubOidc.repository === 'string'
    && rawAttestation.repository !== rawGithubOidc.repository) {
    throw new Error('attestation.githubOidc.repository must match attestation.repository.');
  }
  const config: Config = {
    schemaVersion: 1,
    language: language as Config['language'],
    qualityProfile: qualityProfile as QualityProfile,
    commands,
    requiredChecks,
    thresholds,
    architecture: { forbidCycles: architecture.forbidCycles !== false, rules },
    codeGraph: { mode: codeGraphMode as CodeGraphConfig['mode'] },
    formal: { solver: solver as FormalConfig['solver'], minModeledFraction, timeoutMs: formalTimeoutMs },
    mutation: { mode: mutationMode as MutationConfig['mode'] },
    tdd: { redPreflightCommands },
    workflow: {
      mode: workflowMode as WorkflowConfig['mode'],
      ...(typeof rawWorkflow.expectedSessionId === 'string' ? { expectedSessionId: rawWorkflow.expectedSessionId } : {}),
      maxAgeSeconds: workflowMaxAgeSeconds,
      maxFutureSkewSeconds: workflowMaxFutureSkewSeconds,
      maxEventSkewMs: workflowMaxEventSkewMs,
    },
    attestation: {
      mode: mode as AttestationConfig['mode'],
      ...(typeof rawAttestation.repository === 'string' ? { repository: rawAttestation.repository } : {}),
      maxAgeSeconds,
      maxFutureSkewSeconds,
      trustedPublicKeys,
      githubOidc: githubOidcMode === 'strict'
        ? {
          mode: 'strict',
          issuer: 'https://token.actions.githubusercontent.com',
          audience: githubAudience as string,
          ...(typeof rawGithubOidc.repository === 'string' ? { repository: rawGithubOidc.repository } : {}),
          ...(typeof rawGithubOidc.workflow === 'string' ? { workflow: rawGithubOidc.workflow } : {}),
          ...(typeof rawGithubOidc.ref === 'string' ? { ref: rawGithubOidc.ref } : {}),
          keyBinding: keyBinding as 'public-key' | 'key-id',
        }
        : { mode: 'off' },
    },
  };
  validateQualityProfile(config);
  return config;
}

export async function loadConfig(root: string): Promise<Config> {
  const path = '.musubix/config.json';
  if (!await exists(within(root, path))) throw new Error('Missing .musubix/config.json; run musubix3 init.');
  return parseConfig(JSON.parse(await readText(root, path)) as unknown);
}

export function parsePolicyBaseline(input: unknown): PolicyBaseline {
  const value = object(input, 'policy baseline');
  keys(value, [
    'schemaVersion', 'qualityProfile', 'commands', 'requiredChecks', 'thresholds', 'architecture', 'codeGraph', 'formal',
    'mutation', 'tdd', 'workflow', 'attestation', 'requiredCommands',
  ], 'policy baseline');
  if (value.schemaVersion !== 1) throw new Error('Unsupported policy baseline schemaVersion; expected 1.');
  const parsed = parseConfig({
    schemaVersion: 1,
    qualityProfile: value.qualityProfile,
    requiredChecks: value.requiredChecks,
    thresholds: value.thresholds,
    architecture: value.architecture,
    codeGraph: value.codeGraph,
    formal: value.formal,
    mutation: value.mutation,
    tdd: value.tdd,
    workflow: value.workflow,
    attestation: value.attestation,
    commands: value.commands,
  });
  return {
    schemaVersion: 1,
    qualityProfile: parsed.qualityProfile,
    commands: parsed.commands,
    requiredChecks: parsed.requiredChecks,
    thresholds: parsed.thresholds,
    architecture: parsed.architecture,
    codeGraph: parsed.codeGraph,
    formal: { solver: parsed.formal.solver, minModeledFraction: parsed.formal.minModeledFraction },
    mutation: parsed.mutation,
    tdd: parsed.tdd,
    workflow: parsed.workflow,
    attestation: parsed.attestation,
    requiredCommands: strings(optional(value.requiredCommands, []), 'requiredCommands'),
  };
}

export async function loadPolicyBaseline(root: string): Promise<PolicyBaseline | null> {
  const path = '.musubix/policy-baseline.json';
  return await exists(within(root, path))
    ? parsePolicyBaseline(JSON.parse(await readText(root, path)) as unknown)
    : null;
}

export function policyDiagnostics(config: Config, baseline: PolicyBaseline, changed: string[] | null = null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const profileRank: Record<QualityProfile, number> = { custom: 0, minimal: 1, recommended: 2, release: 3 };
  if (profileRank[config.qualityProfile] < profileRank[baseline.qualityProfile]) {
    diagnostics.push(error('POLICY_QUALITY_PROFILE', `qualityProfile cannot be weakened below ${baseline.qualityProfile}.`));
  }
  for (const check of baseline.requiredChecks) {
    if (!config.requiredChecks.includes(check)) diagnostics.push(error('POLICY_REQUIRED_CHECK', `Required check ${check} was removed from the trusted baseline.`));
  }
  for (const key of Object.keys(baseline.thresholds) as (keyof Config['thresholds'])[]) {
    if (config.thresholds[key] < baseline.thresholds[key]) diagnostics.push(error('POLICY_THRESHOLD', `thresholds.${key} is weaker than the trusted baseline.`));
  }
  if (baseline.architecture.forbidCycles && !config.architecture.forbidCycles) diagnostics.push(error('POLICY_CYCLES', 'Cycle detection was disabled below the trusted baseline.'));
  for (const rule of baseline.architecture.rules) {
    if (!config.architecture.rules.some((candidate) => JSON.stringify(candidate) === JSON.stringify(rule))) {
      diagnostics.push(error('POLICY_ARCHITECTURE', `Architecture rule ${rule.name} was removed or changed from the trusted baseline.`));
    }
  }
  if (baseline.codeGraph.mode === 'strict' && config.codeGraph.mode !== 'strict') {
    diagnostics.push(error('POLICY_CODE_GRAPH_MODE', 'codeGraph.mode cannot be weakened below strict as required by the trusted baseline.'));
  }
  if (config.formal.minModeledFraction < baseline.formal.minModeledFraction) {
    diagnostics.push(error('POLICY_FORMAL_COVERAGE', 'formal.minModeledFraction is weaker than the trusted baseline.'));
  }
  if (baseline.formal.solver !== 'none' && config.formal.solver !== baseline.formal.solver) {
    diagnostics.push(error('POLICY_FORMAL_SOLVER', `formal.solver must remain ${baseline.formal.solver} as required by the trusted baseline.`));
  }
  if (baseline.mutation.mode === 'strict' && config.mutation.mode !== 'strict') {
    diagnostics.push(error('POLICY_MUTATION_MODE', 'mutation.mode cannot be weakened below strict as required by the trusted baseline.'));
  }
  for (const command of baseline.tdd.redPreflightCommands) {
    const baselineCommand = baseline.commands.find((candidate) => candidate.name === command);
    const configuredCommand = config.commands.find((candidate) => candidate.name === command);
    if (!config.tdd.redPreflightCommands.includes(command) || !configuredCommand) {
      diagnostics.push(error('POLICY_TDD_PREFLIGHT', `TDD Red preflight command ${command} was removed from the trusted baseline.`));
    } else if (baselineCommand && JSON.stringify(configuredCommand) !== JSON.stringify(baselineCommand)) {
      diagnostics.push(error('POLICY_TDD_PREFLIGHT', `TDD Red preflight command ${command} differs from the trusted baseline definition.`));
    }
  }
  if (baseline.workflow.mode === 'strict') {
    if (config.workflow.mode !== 'strict') {
      diagnostics.push(error('POLICY_WORKFLOW_MODE', 'workflow.mode cannot be weakened below strict as required by the trusted baseline.'));
    }
    if (baseline.workflow.expectedSessionId
      && config.workflow.expectedSessionId?.toLowerCase() !== baseline.workflow.expectedSessionId.toLowerCase()) {
      diagnostics.push(error('POLICY_WORKFLOW_SESSION', 'workflow.expectedSessionId must remain bound to the trusted baseline session.'));
    }
    if ((config.workflow.maxAgeSeconds ?? 3600) > (baseline.workflow.maxAgeSeconds ?? 3600)) {
      diagnostics.push(error('POLICY_WORKFLOW_MAX_AGE', 'workflow.maxAgeSeconds is weaker than the trusted baseline.'));
    }
    if ((config.workflow.maxFutureSkewSeconds ?? 60) > (baseline.workflow.maxFutureSkewSeconds ?? 60)) {
      diagnostics.push(error('POLICY_WORKFLOW_FUTURE_SKEW', 'workflow.maxFutureSkewSeconds is weaker than the trusted baseline.'));
    }
    if ((config.workflow.maxEventSkewMs ?? 1000) > (baseline.workflow.maxEventSkewMs ?? 1000)) {
      diagnostics.push(error('POLICY_WORKFLOW_EVENT_SKEW', 'workflow.maxEventSkewMs is weaker than the trusted baseline.'));
    }
  }
  if (baseline.attestation.mode === 'ci-required') {
    if (config.attestation.mode !== 'ci-required') {
      diagnostics.push(error('POLICY_ATTESTATION_MODE', 'attestation.mode cannot be weakened below ci-required as required by the trusted baseline.'));
    }
    if (baseline.attestation.repository && config.attestation.repository !== baseline.attestation.repository) {
      diagnostics.push(error('POLICY_ATTESTATION_REPOSITORY', 'attestation.repository must remain bound to the trusted baseline repository.'));
    }
    if ((config.attestation.maxAgeSeconds ?? 3600) > (baseline.attestation.maxAgeSeconds ?? 3600)) {
      diagnostics.push(error('POLICY_ATTESTATION_MAX_AGE', 'attestation.maxAgeSeconds is weaker than the trusted baseline.'));
    }
    if ((config.attestation.maxFutureSkewSeconds ?? 60) > (baseline.attestation.maxFutureSkewSeconds ?? 60)) {
      diagnostics.push(error('POLICY_ATTESTATION_FUTURE_SKEW', 'attestation.maxFutureSkewSeconds is weaker than the trusted baseline.'));
    }
    for (const key of baseline.attestation.trustedPublicKeys) {
      if (!config.attestation.trustedPublicKeys.some((candidate) =>
        candidate.id === key.id && candidate.publicKey === key.publicKey)) {
        diagnostics.push(error('POLICY_ATTESTATION_KEY', `Trusted attestation key ${key.id} was removed or changed.`));
      }
    }
  }
  if (baseline.attestation.githubOidc?.mode === 'strict') {
    const oidc = config.attestation.githubOidc;
    if (oidc?.mode !== 'strict') {
      diagnostics.push(error('POLICY_ATTESTATION_OIDC_MODE', 'attestation.githubOidc.mode cannot be weakened below strict.'));
    }
    if (oidc?.keyBinding !== baseline.attestation.githubOidc.keyBinding) {
      diagnostics.push(error('POLICY_ATTESTATION_OIDC_BINDING', 'attestation.githubOidc.keyBinding must remain bound to the trusted baseline.'));
    }
    for (const key of ['issuer', 'audience', 'repository', 'workflow', 'ref'] as const) {
      const expected = baseline.attestation.githubOidc[key];
      if (expected !== undefined && oidc?.[key] !== expected) {
        diagnostics.push(error('POLICY_ATTESTATION_OIDC_IDENTITY', `attestation.githubOidc.${key} must match the trusted baseline.`));
      }
    }
  }
  for (const name of baseline.requiredCommands) {
    if (!config.commands.some((command) => command.name === name && command.required)) {
      diagnostics.push(error('POLICY_COMMAND', `Required command ${name} was removed or made optional.`));
    }
  }
  if (changed?.includes('.musubix/policy-baseline.json')) {
    diagnostics.push(error('POLICY_APPROVAL_REQUIRED', 'The trusted policy baseline changed; independent approval is required before readiness can pass.'));
  }
  return diagnostics;
}
