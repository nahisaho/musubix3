import { error, validateRequirements, type Diagnostic, type Requirement } from '../../domain/src/index.js';
import type { CommandConfig, MutationConfig } from './config.js';
import { loadConfig } from './config.js';
import { digest, exists, files, readText, within, writeJson } from './files.js';
import { runProcess, type ProcessResult, type Runner } from './process.js';
import { checkTrace, loadTrace, type TraceGraph } from './trace.js';

export type MutationStatus = 'killed' | 'survived' | 'skipped' | 'error';

export interface MutationRecord {
  id: string;
  requirementId: string;
  testId: string;
  sourcePath: string;
  sourceSha256: string;
  testPath: string;
  testSha256: string;
  operator: string;
  location: { line: number; column: number };
  status: MutationStatus;
}

export interface MutationReport {
  schemaVersion: 1;
  mutants: MutationRecord[];
}

export interface MutationExecution {
  executionId: string;
  commandName: string;
  commandSha256: string;
  reportPath: string;
  reportSha256: string;
  processStatus: ProcessResult['status'];
  exitCode: number | null;
  mutants: MutationRecord[];
  recordSha256: string;
}

export interface MutationEvidence {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  executions: MutationExecution[];
}

export interface MutationDoctorEntry {
  ecosystem: 'javascript' | 'python' | 'go' | 'rust' | 'java' | 'dotnet' | 'php';
  engine: string;
  status: 'configured' | 'available' | 'missing';
  attemptedCommands: string[];
  output?: string;
  recommendation: string;
}

export interface MutationDoctorReport {
  available: boolean;
  configured: boolean;
  engines: MutationDoctorEntry[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function mutationCommandSha256(executable: string, args: string[]): string {
  return digest(canonical({ executable, arguments: args }));
}

export function mutationIdentity(record: Pick<MutationRecord,
  'requirementId' | 'testId' | 'sourcePath' | 'operator' | 'location'>): string {
  return `MUT-${digest(canonical({
    requirementId: record.requirementId,
    testId: record.testId,
    sourcePath: record.sourcePath,
    operator: record.operator,
    location: record.location,
  })).slice(0, 16).toUpperCase()}`;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validRelativePath(value: unknown): value is string {
  return typeof value === 'string' && !!value && !value.includes('\0')
    && !value.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(value)
    && !value.split(/[\\/]/).includes('..');
}

function recordDiagnosis(record: MutationRecord): string | null {
  if (!record || typeof record !== 'object') return 'record must be an object';
  if (typeof record.id !== 'string') return 'id must be a string';
  if (typeof record.requirementId !== 'string') return 'requirementId must be a string';
  if (typeof record.testId !== 'string') return 'testId must be a string';
  if (!validRelativePath(record.sourcePath)) return 'sourcePath must be a relative path inside the project';
  if (!validHash(record.sourceSha256)) return 'sourceSha256 must be a lowercase 64-character SHA-256 hex digest';
  if (!validRelativePath(record.testPath)) return 'testPath must be a relative path inside the project';
  if (!validHash(record.testSha256)) return 'testSha256 must be a lowercase 64-character SHA-256 hex digest';
  if (typeof record.operator !== 'string' || !/^[\p{L}_][\p{L}\p{N}_.:-]{0,127}$/u.test(record.operator)) {
    return 'operator must be a short identifier-like string';
  }
  if (!record.location || !Number.isInteger(record.location.line) || record.location.line <= 0
    || !Number.isInteger(record.location.column) || record.location.column <= 0) {
    return 'location.line and location.column must be one-based positive integers';
  }
  if (!['killed', 'survived', 'skipped', 'error'].includes(record.status)) {
    return 'status must be killed, survived, skipped or error';
  }
  return null;
}

function validRecord(record: MutationRecord): boolean {
  return recordDiagnosis(record) === null;
}

export function parseMutationReport(text: string): MutationReport {
  const value = JSON.parse(text) as MutationReport;
  if (value.schemaVersion !== 1) {
    throw new Error('Invalid schema-v1 mutation report: schemaVersion must be the number 1.');
  }
  if (!Array.isArray(value.mutants)) {
    throw new Error('Invalid schema-v1 mutation report: mutants must be an array.');
  }
  for (const [index, record] of value.mutants.entries()) {
    const reason = recordDiagnosis(record);
    if (reason) throw new Error(`Invalid schema-v1 mutation report: mutants[${index}] ${reason}.`);
  }
  return value;
}

function executionHash(execution: Omit<MutationExecution, 'recordSha256'>): string {
  return digest(canonical(execution));
}

export function createMutationExecution(input: Omit<MutationExecution, 'recordSha256'>): MutationExecution {
  return { ...input, recordSha256: executionHash(input) };
}

export async function writeMutationEvidence(
  root: string,
  executions: MutationExecution[],
  runId: string,
): Promise<MutationEvidence> {
  const evidence: MutationEvidence = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    executions,
  };
  await writeJson(root, '.musubix/evidence/mutation.json', evidence);
  return evidence;
}

export function mutationEvidenceHead(evidence: Record<string, unknown>): string {
  const executions = Array.isArray(evidence.executions) ? evidence.executions : [];
  return digest(canonical({
    schemaVersion: evidence.schemaVersion,
    executions: executions.map((entry) => {
      const execution = entry as Partial<MutationExecution>;
      return {
        commandName: execution.commandName,
        commandSha256: execution.commandSha256,
        reportPath: execution.reportPath,
        processStatus: execution.processStatus,
        exitCode: execution.exitCode,
        mutants: execution.mutants ?? [],
      };
    }).sort((a, b) => canonical(a).localeCompare(canonical(b))),
  }));
}

async function functionalMustRequirements(root: string): Promise<Requirement[]> {
  const result: Requirement[] = [];
  const paths = (await files(root)).filter((path) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(path));
  for (const path of paths) {
    result.push(...validateRequirements(await readText(root, path), path).value
      .filter((requirement) => requirement.priority === 'must' && requirement.type === 'functional'));
  }
  return result;
}

function configuredMutation(command: CommandConfig): { reportPath: string; args: string[] } | null {
  if (!command.mutationReport) return null;
  return {
    reportPath: command.mutationReport.path,
    args: command.args.map((arg) => arg.replaceAll('{reportPath}', command.mutationReport!.path)),
  };
}

function sourceImplements(trace: TraceGraph, sourceId: string, requirementId: string): boolean {
  if (trace.edges.some((edge) =>
    edge.from === sourceId && edge.to === requirementId && edge.relation === 'implements')) return true;
  const designs = trace.edges.filter((edge) =>
    edge.to === requirementId && edge.relation === 'satisfies').map((edge) => edge.from);
  return trace.edges.some((edge) =>
    edge.from === sourceId && designs.includes(edge.to) && edge.relation === 'implements');
}

export async function mutationDoctor(
  root: string,
  runner: Runner = runProcess,
): Promise<MutationDoctorReport> {
  const projectFiles = new Set(await files(root));
  const config = await exists(within(root, '.musubix/config.json')) ? await loadConfig(root) : null;
  const configured = config?.commands.filter((command) => command.mutationReport) ?? [];
  if (configured.length) {
    return {
      available: false,
      configured: true,
      engines: configured.map((command) => ({
        ecosystem: projectFiles.has('Cargo.toml') ? 'rust'
          : projectFiles.has('go.mod') ? 'go'
            : projectFiles.has('pom.xml') ? 'java'
              : [...projectFiles].some((path) => /\.(?:cs|fs|vb)proj$/i.test(path)) ? 'dotnet'
              : [...projectFiles].some((path) => path.endsWith('.py')) ? 'python'
                : projectFiles.has('composer.json') ? 'php'
                  : 'javascript',
        engine: command.name,
        status: 'configured',
        attemptedCommands: [`${command.command} ${command.args.join(' ')}`.trim()],
        recommendation: `Mutation command ${command.name} is configured; run the gate to verify executable availability and report generation.`,
      })),
    };
  }
  const candidates: Array<{
    ecosystem: MutationDoctorEntry['ecosystem'];
    engine: string;
    command: string;
    args: string[];
    present: boolean;
    recommendation: string;
  }> = [
    {
      ecosystem: 'javascript',
      engine: 'StrykerJS',
      command: 'npx',
      args: ['--no-install', 'stryker', '--version'],
      present: projectFiles.has('package.json'),
      recommendation: 'Install @stryker-mutator/core locally and configure a command.mutationReport adapter script.',
    },
    {
      ecosystem: 'python',
      engine: 'mutmut',
      command: 'mutmut',
      args: ['--version'],
      present: projectFiles.has('pyproject.toml') || projectFiles.has('requirements.txt')
        || [...projectFiles].some((path) => path.endsWith('.py')),
      recommendation: 'Install mutmut in the project virtual environment; remove existing __pycache__ directories before each mutation run, then use python -B -m mutmut and python -B -m pytest to prevent new .pyc files before converting results to the musubix mutation schema.',
    },
    {
      ecosystem: 'go',
      engine: 'go-mutesting',
      command: 'go-mutesting',
      args: ['--version'],
      present: projectFiles.has('go.mod'),
      recommendation: 'Install go-mutesting or an equivalent pinned Go mutation engine and emit a musubix mutation report.',
    },
    {
      ecosystem: 'rust',
      engine: 'cargo-mutants',
      command: 'cargo',
      args: ['mutants', '--version'],
      present: projectFiles.has('Cargo.toml'),
      recommendation: 'Install cargo-mutants with a pinned version and configure a deterministic mutation report converter.',
    },
    {
      ecosystem: 'java',
      engine: 'PIT',
      command: 'pitest',
      args: ['--version'],
      present: projectFiles.has('pom.xml') || projectFiles.has('build.gradle') || projectFiles.has('build.gradle.kts'),
      recommendation: 'Configure the PIT Maven or Gradle plugin and convert its report to the musubix mutation schema.',
    },
    {
      ecosystem: 'php',
      engine: 'Infection',
      command: 'vendor/bin/infection',
      args: ['--version'],
      present: projectFiles.has('composer.json'),
      recommendation: 'Install infection/infection with Composer and enable a coverage driver (Xdebug, PCOV or phpdbg); Infection cannot run without one. Convert its report to the musubix mutation schema, or drive PHPUnit directly with a deterministic mutation runner that emits that schema.',
    },
    {
      ecosystem: 'dotnet',
      engine: 'Stryker.NET',
      command: 'dotnet',
      args: ['tool', 'run', 'dotnet-stryker', '--', '--version'],
      present: [...projectFiles].some((path) => /\.(?:cs|fs|vb)proj$/i.test(path)),
      recommendation: 'Install dotnet-stryker through a pinned local tool manifest and convert its report to the musubix mutation schema.',
    },
  ];
  const engines: MutationDoctorEntry[] = [];
  for (const candidate of candidates.filter((entry) => entry.present)) {
    const result = await runner(candidate.command, candidate.args, { cwd: root, timeoutMs: 5000 });
    const available = result.status === 'completed' && result.exitCode === 0;
    engines.push({
      ecosystem: candidate.ecosystem,
      engine: candidate.engine,
      status: available ? 'available' : 'missing',
      attemptedCommands: [`${candidate.command} ${candidate.args.join(' ')}`],
      ...((result.stdout || result.stderr) ? { output: `${result.stdout}\n${result.stderr}`.trim() } : {}),
      recommendation: available
        ? `${candidate.engine} is available; configure a command with mutationReport before requiring strict mutation evidence.`
        : candidate.recommendation,
    });
  }
  return {
    available: engines.some((entry) => entry.status === 'available'),
    configured: false,
    engines,
  };
}

export async function validateMutationEvidence(
  root: string,
  configOverride?: MutationConfig,
): Promise<{
  present: boolean;
  valid: boolean;
  requirements: number;
  coveredRequirements: string[];
  mutants: number;
  diagnostics: Diagnostic[];
}> {
  const requirements = await functionalMustRequirements(root);
  const path = '.musubix/evidence/mutation.json';
  if (!await exists(within(root, path))) {
    const mutationConfig = configOverride ?? (await exists(within(root, '.musubix/config.json'))
      ? (await loadConfig(root)).mutation
      : { mode: 'compatible' });
    const required = mutationConfig.mode === 'strict' && requirements.length > 0;
    return {
      present: false,
      valid: !required,
      requirements: requirements.length,
      coveredRequirements: [],
      mutants: 0,
      diagnostics: required
        ? [error('MUTATION_EVIDENCE_MISSING', 'Strict mutation mode requires fresh schema-v1 mutation evidence.', path)]
        : [],
    };
  }
  const config = await loadConfig(root);
  let value: MutationEvidence;
  try {
    value = JSON.parse(await readText(root, path)) as MutationEvidence;
  } catch (cause) {
    return {
      present: true, valid: false, requirements: requirements.length, coveredRequirements: [], mutants: 0,
      diagnostics: [error('MUTATION_EVIDENCE_SCHEMA', `Invalid mutation evidence: ${cause instanceof Error ? cause.message : String(cause)}.`, path)],
    };
  }
  if (value.schemaVersion !== 1 || typeof value.runId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runId)
    || Number.isNaN(Date.parse(value.generatedAt)) || !Array.isArray(value.executions)) {
    return {
      present: true, valid: false, requirements: requirements.length, coveredRequirements: [], mutants: 0,
      diagnostics: [error('MUTATION_EVIDENCE_SCHEMA', 'Invalid mutation evidence.', path)],
    };
  }
  const diagnostics: Diagnostic[] = [];
  let trace: TraceGraph;
  try {
    trace = await loadTrace(root);
    const traceCheck = await checkTrace(root, trace, true);
    if (!traceCheck.valid) diagnostics.push(error('MUTATION_TRACE_STALE', 'Mutation evidence requires a fresh valid trace graph.', path));
  } catch {
    return {
      present: true, valid: false, requirements: requirements.length, coveredRequirements: [], mutants: 0,
      diagnostics: [error('MUTATION_TRACE_STALE', 'Mutation evidence requires generated trace evidence.', path)],
    };
  }
  const nodes = new Map(trace.nodes.map((node) => [node.id, node]));
  const currentFingerprints: Record<string, string> = {};
  const evidencePaths = new Set<string>();
  for (const execution of value.executions) {
    if (!execution || !Array.isArray(execution.mutants)) continue;
    for (const mutant of execution.mutants) {
      if (!mutant || typeof mutant !== 'object') continue;
      if (typeof mutant.sourcePath === 'string') evidencePaths.add(mutant.sourcePath);
      if (typeof mutant.testPath === 'string') evidencePaths.add(mutant.testPath);
    }
  }
  for (const candidate of evidencePaths) {
    try {
      const absolute = within(root, candidate);
      if (await exists(absolute)) currentFingerprints[candidate] = digest(await readText(root, candidate));
    } catch {
      diagnostics.push(error('MUTATION_PATH', `Mutation evidence contains an unsafe or unreadable path: ${candidate}.`, path));
    }
  }
  const identities = new Map<string, MutationRecord>();
  const locations = new Map<string, MutationRecord>();
  const executionIds = new Set<string>();
  const reportOwners = new Map<string, string>();
  const covered = new Set<string>();
  for (const execution of value.executions) {
    if (!execution || !validHash(execution.executionId) || typeof execution.commandName !== 'string'
      || !validHash(execution.commandSha256) || !validRelativePath(execution.reportPath)
      || !validHash(execution.reportSha256) || execution.processStatus !== 'completed'
      || execution.exitCode !== 0 || !Array.isArray(execution.mutants)
      || !execution.mutants.every(validRecord) || !validHash(execution.recordSha256)) {
      diagnostics.push(error('MUTATION_PROVENANCE_SCHEMA', 'A mutation execution provenance record is malformed.', path));
      continue;
    }
    const { recordSha256, ...unsigned } = execution;
    if (executionHash(unsigned) !== recordSha256) {
      diagnostics.push(error('MUTATION_PROVENANCE_TAMPERED', `Mutation execution ${execution.executionId} has an invalid record hash.`, path));
    }
    if (executionIds.has(execution.executionId)) {
      diagnostics.push(error('MUTATION_EXECUTION_DUPLICATE', `Mutation execution ${execution.executionId} is duplicated.`, path));
    }
    executionIds.add(execution.executionId);
    const reportOwner = reportOwners.get(execution.reportPath);
    if (reportOwner && reportOwner !== execution.executionId) {
      diagnostics.push(error('MUTATION_REPORT_CONFLICT', `${execution.reportPath} is claimed by multiple mutation executions.`, path));
    }
    reportOwners.set(execution.reportPath, execution.executionId);
    const command = config.commands.find((candidate) => candidate.name === execution.commandName);
    const configured = command ? configuredMutation(command) : null;
    if (!command || !configured || configured.reportPath !== execution.reportPath
      || mutationCommandSha256(command.command, configured.args) !== execution.commandSha256) {
      diagnostics.push(error('MUTATION_COMMAND_MISMATCH', `${execution.commandName} is not traceable to the current configured mutation command.`, path));
    }
    if (!await exists(within(root, execution.reportPath))) {
      diagnostics.push(error('MUTATION_REPORT_STALE', `${execution.reportPath} is missing.`, execution.reportPath));
    } else {
      try {
        const text = await readText(root, execution.reportPath);
        const report = parseMutationReport(text);
        if (digest(text) !== execution.reportSha256 || canonical(report.mutants) !== canonical(execution.mutants)) {
          diagnostics.push(error('MUTATION_REPORT_STALE', `${execution.reportPath} changed since the mutation command ran.`, execution.reportPath));
        }
      } catch {
        diagnostics.push(error('MUTATION_REPORT_STALE', `${execution.reportPath} is malformed or changed.`, execution.reportPath));
      }
    }
    for (const mutant of execution.mutants) {
      const expectedId = mutationIdentity(mutant);
      if (mutant.id !== expectedId) {
        diagnostics.push(error('MUTATION_IDENTITY', `${mutant.id} is not the deterministic identity ${expectedId}.`, path));
      }
      const previous = identities.get(mutant.id);
      if (previous) {
        diagnostics.push(error(
          canonical(previous) === canonical(mutant) ? 'MUTATION_DUPLICATE' : 'MUTATION_CONFLICT',
          `${mutant.id} is reported more than once${canonical(previous) === canonical(mutant) ? '' : ' with conflicting evidence'}.`,
          path,
        ));
      } else identities.set(mutant.id, mutant);
      const locationKey = canonical({
        requirementId: mutant.requirementId,
        sourcePath: mutant.sourcePath,
        operator: mutant.operator,
        location: mutant.location,
      });
      const locationOwner = locations.get(locationKey);
      if (locationOwner && locationOwner.id !== mutant.id) {
        diagnostics.push(error('MUTATION_CONFLICT', `${mutant.sourcePath}:${mutant.location.line}:${mutant.location.column} has conflicting mutant identities.`, path));
      } else locations.set(locationKey, mutant);
      const requirement = requirements.find((candidate) => candidate.id === mutant.requirementId);
      if (!requirement) {
        diagnostics.push(error('MUTATION_REQUIREMENT', `${mutant.id} is not linked to a must functional requirement.`, path));
      }
      const test = nodes.get(mutant.testId);
      if (!test || test.kind !== 'test' || test.path !== mutant.testPath
        || !trace.edges.some((edge) => edge.from === mutant.testId
          && edge.to === mutant.requirementId && edge.relation === 'verifies')) {
        diagnostics.push(error('MUTATION_TEST_UNLINKED', `${mutant.testId} is not an authoritative test for ${mutant.requirementId}.`, path));
      }
      const source = trace.nodes.find((node) => node.kind === 'code' && node.path === mutant.sourcePath
        && sourceImplements(trace, node.id, mutant.requirementId));
      if (!source) diagnostics.push(error('MUTATION_SOURCE_UNLINKED', `${mutant.sourcePath} is not authoritative implementation for ${mutant.requirementId}.`, path));
      if (currentFingerprints[mutant.sourcePath] !== mutant.sourceSha256) {
        diagnostics.push(error('MUTATION_SOURCE_STALE', `${mutant.id} source fingerprint is stale.`, mutant.sourcePath));
      }
      if (currentFingerprints[mutant.testPath] !== mutant.testSha256) {
        diagnostics.push(error('MUTATION_TEST_STALE', `${mutant.id} test fingerprint is stale.`, mutant.testPath));
      }
      if (mutant.status !== 'killed') {
        diagnostics.push(error('MUTATION_NOT_KILLED', `${mutant.id} status is ${mutant.status}; killed is required.`, path));
      }
      if (requirement && test?.kind === 'test' && source && mutant.status === 'killed'
        && currentFingerprints[mutant.sourcePath] === mutant.sourceSha256
        && currentFingerprints[mutant.testPath] === mutant.testSha256) covered.add(mutant.requirementId);
    }
  }
  for (const requirement of requirements) {
    if (!covered.has(requirement.id)) {
      diagnostics.push(error('MUTATION_REQUIREMENT_UNCOVERED', `${requirement.id} has no current linked killed mutant.`, path));
    }
  }
  return {
    present: true,
    valid: !diagnostics.length,
    requirements: requirements.length,
    coveredRequirements: [...covered].sort(),
    mutants: value.executions.reduce((sum, execution) =>
      sum + (execution && Array.isArray(execution.mutants) ? execution.mutants.length : 0), 0),
    diagnostics,
  };
}
