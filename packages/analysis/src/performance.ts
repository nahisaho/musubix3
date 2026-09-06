import { error, validateRequirements, type Diagnostic, type Requirement } from '../../domain/src/index.js';
import { adapterInvocation, normalizeAdapterReport, readAdapterOutput } from './adapters.js';
import { loadConfig, type CommandConfig } from './config.js';
import { digest, exists, files, readText, safePath, within, writeJson } from './files.js';
import type { ProcessResult } from './process.js';
import { parseMusubixTestReport, type MusubixTestReport } from './tdd.js';

type TestResult = MusubixTestReport['tests'][number];
export type PerformanceReportSourceKind = 'file' | 'directory' | 'stdout';

export interface PerformanceExecution {
  runId: string;
  executionId: string;
  commandName: string;
  commandSha256: string;
  reportPath: string;
  sourceKind: PerformanceReportSourceKind;
  reportSha256: string;
  processStatus: ProcessResult['status'];
  exitCode: number | null;
  tests: TestResult[];
  recordSha256: string;
}

export interface PerformanceProvenance {
  runId: string;
  executionId: string;
  commandName: string;
  commandSha256: string;
  reportPath: string;
  sourceKind: PerformanceReportSourceKind;
  reportSha256: string;
  testId: string;
  testStatus: TestResult['status'];
  counter: string;
  value: number;
  processStatus: ProcessResult['status'];
  exitCode: number | null;
  executionRecordSha256: string;
  recordSha256: string;
}

export interface PerformanceObservation {
  requirementId: string;
  testId: string;
  counter: string;
  observed: number | null;
  maximum: number;
  status: 'pass' | 'fail' | 'missing';
  provenance?: PerformanceProvenance;
}

export interface PerformanceEvidence {
  schemaVersion: 2;
  runId: string;
  generatedAt: string;
  executions: PerformanceExecution[];
  observations: PerformanceObservation[];
}

export function performanceEvidenceHead(evidence: Record<string, unknown>): string {
  const executions = Array.isArray(evidence.executions) ? evidence.executions : [];
  const observations = Array.isArray(evidence.observations) ? evidence.observations : [];
  const compareCanonical = (a: unknown, b: unknown): number => {
    const left = canonical(a);
    const right = canonical(b);
    return left < right ? -1 : left > right ? 1 : 0;
  };
  const stableExecutions = executions.map((value) => {
    const execution = value as Partial<PerformanceExecution>;
    return {
      commandName: execution.commandName,
      commandSha256: execution.commandSha256,
      reportPath: execution.reportPath,
      sourceKind: execution.sourceKind,
      processStatus: execution.processStatus,
      exitCode: execution.exitCode,
      tests: [...execution.tests ?? []].sort(compareCanonical),
    };
  }).sort(compareCanonical);
  const stableObservations = observations.map((value) => {
    const observation = value as Partial<PerformanceObservation>;
    const provenance = observation.provenance;
    return {
      requirementId: observation.requirementId,
      testId: observation.testId,
      counter: observation.counter,
      observed: observation.observed,
      maximum: observation.maximum,
      status: observation.status,
      ...(provenance ? {
        provenance: {
          commandName: provenance.commandName,
          commandSha256: provenance.commandSha256,
          reportPath: provenance.reportPath,
          sourceKind: provenance.sourceKind,
          testId: provenance.testId,
          testStatus: provenance.testStatus,
          counter: provenance.counter,
          value: provenance.value,
          processStatus: provenance.processStatus,
          exitCode: provenance.exitCode,
        },
      } : {}),
    };
  }).sort(compareCanonical);
  return digest(canonical({
    schemaVersion: evidence.schemaVersion,
    executions: stableExecutions,
    observations: stableObservations,
  }));
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

export function performanceCommandSha256(executable: string, args: string[]): string {
  return digest(canonical({ executable, arguments: args }));
}

function executionSha256(execution: Omit<PerformanceExecution, 'recordSha256'>): string {
  return digest(canonical(execution));
}

function provenanceSha256(provenance: Omit<PerformanceProvenance, 'recordSha256'>): string {
  return digest(canonical(provenance));
}

export function createPerformanceExecution(input: Omit<PerformanceExecution, 'recordSha256'>): PerformanceExecution {
  return { ...input, recordSha256: executionSha256(input) };
}

function createProvenance(
  execution: PerformanceExecution,
  test: TestResult,
  counter: string,
  value: number,
): PerformanceProvenance {
  const provenance: Omit<PerformanceProvenance, 'recordSha256'> = {
    runId: execution.runId,
    executionId: execution.executionId,
    commandName: execution.commandName,
    commandSha256: execution.commandSha256,
    reportPath: execution.reportPath,
    sourceKind: execution.sourceKind,
    reportSha256: execution.reportSha256,
    testId: test.id,
    testStatus: test.status,
    counter,
    value,
    processStatus: execution.processStatus,
    exitCode: execution.exitCode,
    executionRecordSha256: execution.recordSha256,
  };
  return { ...provenance, recordSha256: provenanceSha256(provenance) };
}

export async function requirementsWithBudgets(root: string): Promise<Requirement[]> {
  const result: Requirement[] = [];
  for (const path of (await files(root)).filter((entry) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(entry))) {
    result.push(...validateRequirements(await readText(root, path), path).value.filter((requirement) => requirement.performance));
  }
  return result;
}

export function performanceEvidence(
  requirements: Requirement[],
  executions: PerformanceExecution[],
  runId: string,
): PerformanceEvidence {
  const performanceTestIds = new Set(requirements.flatMap((requirement) =>
    requirement.performance ? [requirement.performance.testId] : []));
  const relevantExecutions = executions.filter((execution) =>
    execution.tests.some((test) => performanceTestIds.has(test.id)));
  const observations = requirements.flatMap((requirement): PerformanceObservation[] => {
    const budget = requirement.performance;
    if (!budget) return [];
    const candidates = relevantExecutions.flatMap((execution) => execution.tests
      .filter((test) => test.id === budget.testId && test.operations?.[budget.counter] !== undefined)
      .map((test) => ({ execution, test, value: test.operations![budget.counter]! })));
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    const observed = candidate?.value ?? null;
    const usable = candidate?.test.status === 'passed'
      && candidate.execution.processStatus === 'completed'
      && candidate.execution.exitCode === 0;
    return [{
      requirementId: requirement.id,
      testId: budget.testId,
      counter: budget.counter,
      observed,
      maximum: budget.max,
      status: !candidate || !usable ? 'missing' : observed! <= budget.max ? 'pass' : 'fail',
      ...(candidate ? { provenance: createProvenance(candidate.execution, candidate.test, budget.counter, candidate.value) } : {}),
    }];
  });
  return { schemaVersion: 2, runId, generatedAt: new Date().toISOString(), executions: relevantExecutions, observations };
}

export async function writePerformanceEvidence(
  root: string,
  executions: PerformanceExecution[],
  runId: string,
): Promise<PerformanceEvidence> {
  const evidence = performanceEvidence(await requirementsWithBudgets(root), executions, runId);
  await writeJson(root, '.musubix/evidence/performance.json', evidence);
  return evidence;
}

function configuredInvocation(command: CommandConfig): {
  reportPath: string;
  sourceKind: PerformanceReportSourceKind;
  args: string[];
} | null {
  if (command.testReport) {
    return {
      reportPath: command.testReport.path,
      sourceKind: 'file',
      args: command.args.map((arg) => arg.replaceAll('{reportPath}', command.testReport!.path)),
    };
  }
  if (command.adapter) {
    const invocation = adapterInvocation(command.adapter, command.name);
    return {
      reportPath: invocation.reportPath,
      sourceKind: invocation.source,
      args: [
        ...command.args.map((arg) => arg.replaceAll('{reportPath}', invocation.reportPath)),
        ...invocation.args,
      ],
    };
  }
  return null;
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validTest(test: TestResult): boolean {
  return !!test && typeof test.id === 'string'
    && ['passed', 'failed', 'skipped', 'error'].includes(test.status)
    && (test.operations === undefined || (!!test.operations && typeof test.operations === 'object'
      && !Array.isArray(test.operations)
      && Object.entries(test.operations).every(([name, count]) =>
        /^[\p{L}_][\p{L}\p{N}_.:-]{0,127}$/u.test(name)
        && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)));
}

function validObservationShape(observation: PerformanceObservation): boolean {
  return !!observation && typeof observation.requirementId === 'string'
    && typeof observation.testId === 'string' && typeof observation.counter === 'string'
    && (observation.observed === null || (Number.isSafeInteger(observation.observed) && observation.observed >= 0))
    && Number.isSafeInteger(observation.maximum) && observation.maximum >= 0
    && ['pass', 'fail', 'missing'].includes(observation.status);
}

async function currentReport(
  root: string,
  command: CommandConfig,
  execution: PerformanceExecution,
): Promise<{ text: string; tests: TestResult[] } | null> {
  const absolute = await safePath(root, execution.reportPath);
  const invocation = command.adapter ? adapterInvocation(command.adapter, command.name) : null;
  const text = invocation
    ? await readAdapterOutput(invocation, absolute, '')
    : await exists(absolute) ? await readText(root, execution.reportPath) : null;
  if (text === null) return null;
  const report = command.testReport
    ? parseMusubixTestReport(text)
    : normalizeAdapterReport(command.adapter!, text);
  return { text, tests: report.tests };
}

export async function validatePerformanceEvidence(root: string): Promise<{
  present: boolean;
  valid: boolean;
  budgets: number;
  validRequirements: string[];
  diagnostics: Diagnostic[];
}> {
  const requirements = await requirementsWithBudgets(root);
  if (!requirements.length) return { present: false, valid: true, budgets: 0, validRequirements: [], diagnostics: [] };
  const path = '.musubix/evidence/performance.json';
  if (!await exists(within(root, path))) {
    return { present: false, valid: false, budgets: requirements.length, validRequirements: [], diagnostics: [error('PERFORMANCE_EVIDENCE_MISSING', 'Deterministic performance budgets require structured operation-counter evidence.', path)] };
  }
  let value: PerformanceEvidence;
  try {
    value = JSON.parse(await readText(root, path)) as PerformanceEvidence;
  } catch (cause) {
    return { present: true, valid: false, budgets: requirements.length, validRequirements: [], diagnostics: [error('PERFORMANCE_EVIDENCE_SCHEMA', `Invalid performance evidence: ${cause instanceof Error ? cause.message : String(cause)}.`, path)] };
  }
  const diagnostics: Diagnostic[] = [];
  if (value.schemaVersion !== 2 || typeof value.runId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.runId)
    || Number.isNaN(Date.parse(value.generatedAt)) || !Array.isArray(value.executions)
    || !Array.isArray(value.observations) || !value.observations.every(validObservationShape)) {
    return { present: true, valid: false, budgets: requirements.length, validRequirements: [], diagnostics: [error('PERFORMANCE_EVIDENCE_SCHEMA', 'Invalid performance evidence.', path)] };
  }
  const config = await loadConfig(root);
  const executionIds = new Set<string>();
  const reportOwners = new Map<string, string>();
  for (const execution of value.executions) {
    if (!execution || execution.runId !== value.runId || !validHash(execution.executionId)
      || typeof execution.commandName !== 'string' || !validHash(execution.commandSha256)
      || typeof execution.reportPath !== 'string' || !['file', 'directory', 'stdout'].includes(execution.sourceKind)
      || !validHash(execution.reportSha256) || !['completed', 'missing', 'timeout', 'error'].includes(execution.processStatus)
      || (execution.exitCode !== null && !Number.isInteger(execution.exitCode))
      || !Array.isArray(execution.tests) || !execution.tests.every(validTest)
      || !validHash(execution.recordSha256)) {
      diagnostics.push(error('PERFORMANCE_PROVENANCE_SCHEMA', 'A performance execution provenance record is malformed.', path));
      continue;
    }
    const { recordSha256, ...unsigned } = execution;
    if (executionSha256(unsigned) !== recordSha256) {
      diagnostics.push(error('PERFORMANCE_PROVENANCE_TAMPERED', `Execution provenance ${execution.executionId} has an invalid record hash.`, path));
    }
    if (executionIds.has(execution.executionId)) {
      diagnostics.push(error('PERFORMANCE_REPORT_CONFLICT', `Execution provenance ${execution.executionId} is duplicated.`, path));
    }
    executionIds.add(execution.executionId);
    const previousOwner = reportOwners.get(execution.reportPath);
    if (previousOwner && previousOwner !== execution.executionId) {
      diagnostics.push(error('PERFORMANCE_REPORT_CONFLICT', `${execution.reportPath} is claimed by multiple command executions.`, path));
    }
    reportOwners.set(execution.reportPath, execution.executionId);
    const command = config.commands.find((candidate) => candidate.name === execution.commandName);
    const invocation = command ? configuredInvocation(command) : null;
    if (!command || !invocation || invocation.reportPath !== execution.reportPath
      || invocation.sourceKind !== execution.sourceKind
      || performanceCommandSha256(command.command, invocation.args) !== execution.commandSha256) {
      diagnostics.push(error('PERFORMANCE_COMMAND_MISMATCH', `${execution.commandName} is not traceable to the current configured report command.`, path));
    }
    if (execution.processStatus !== 'completed' || execution.exitCode !== 0) {
      diagnostics.push(error('PERFORMANCE_EXECUTION_FAILED', `${execution.commandName} did not complete successfully.`, path));
    }
    if (command && invocation) {
      try {
        const current = await currentReport(root, command, execution);
        if (!current || digest(current.text) !== execution.reportSha256) {
          diagnostics.push(error('PERFORMANCE_REPORT_TAMPERED', `${execution.reportPath} is missing or changed since the gate run.`, execution.reportPath));
        } else if (canonical(current.tests) !== canonical(execution.tests)) {
          diagnostics.push(error('PERFORMANCE_REPORT_MISMATCH', `${execution.reportPath} no longer normalizes to its recorded test results.`, execution.reportPath));
        }
      } catch {
        diagnostics.push(error('PERFORMANCE_REPORT_TAMPERED', `${execution.reportPath} is missing, malformed, or changed since the gate run.`, execution.reportPath));
      }
    }
  }
  const validRequirements: string[] = [];
  for (const requirement of requirements) {
    const budget = requirement.performance!;
    const matching = value.observations.filter((entry) => entry.requirementId === requirement.id);
    const observation = matching[0];
    if (matching.length !== 1 || !observation || observation.testId !== budget.testId
      || observation.counter !== budget.counter || observation.maximum !== budget.max) {
      diagnostics.push(error('PERFORMANCE_BUDGET_UNPROVEN', `${requirement.id} lacks one matching ${budget.counter} operation-budget observation.`, path));
      continue;
    }
    const candidates = value.executions.flatMap((execution) => execution.tests
      .filter((test) => test.id === budget.testId && test.operations?.[budget.counter] !== undefined)
      .map((test) => ({ execution, test, value: test.operations![budget.counter]! })));
    if (candidates.length > 1) {
      diagnostics.push(error('PERFORMANCE_REPORT_CONFLICT', `${budget.testId} reported ${budget.counter} from multiple command reports.`, path));
      continue;
    }
    const candidate = candidates[0];
    if (!observation.provenance || !candidate) {
      if (!candidate && value.executions.some((execution) => execution.tests.some((test) => test.id === budget.testId))) {
        diagnostics.push(error('PERFORMANCE_COUNTER_MISSING', `${budget.testId} did not report deterministic counter ${budget.counter}.`, path));
      }
      diagnostics.push(error('PERFORMANCE_PROVENANCE_MISSING', `${requirement.id} has no unique command/report provenance for ${budget.counter}.`, path));
      continue;
    }
    const provenance = observation.provenance;
    const { recordSha256, ...unsigned } = provenance;
    if (!validHash(recordSha256) || provenanceSha256(unsigned) !== recordSha256) {
      diagnostics.push(error('PERFORMANCE_PROVENANCE_TAMPERED', `${requirement.id} has an invalid observation provenance hash.`, path));
      continue;
    }
    const expected = createProvenance(candidate.execution, candidate.test, budget.counter, candidate.value);
    if (canonical(expected) !== canonical(provenance)
      || observation.observed !== candidate.value
      || provenance.runId !== value.runId) {
      diagnostics.push(error('PERFORMANCE_PROVENANCE_MISMATCH', `${requirement.id} does not match its command execution and report result.`, path));
      continue;
    }
    if (candidate.execution.processStatus !== 'completed' || candidate.execution.exitCode !== 0) {
      diagnostics.push(error('PERFORMANCE_EXECUTION_FAILED', `${budget.testId} is not traceable to a successful configured command.`, path));
    } else if (candidate.test.status !== 'passed') {
      diagnostics.push(error('PERFORMANCE_COUNTER_TEST_STATUS', `${budget.testId} reported ${budget.counter} from a ${candidate.test.status} test.`, path));
    } else if (observation.observed === null || observation.status === 'missing') {
      diagnostics.push(error('PERFORMANCE_COUNTER_MISSING', `${budget.testId} did not report deterministic counter ${budget.counter}.`, path));
    } else if (observation.observed > budget.max || observation.status !== 'pass') {
      diagnostics.push(error('PERFORMANCE_BUDGET_EXCEEDED', `${requirement.id} observed ${observation.observed} ${budget.counter} operations; maximum ${budget.max}.`, path));
    } else validRequirements.push(requirement.id);
  }
  return { present: true, valid: !diagnostics.length, budgets: requirements.length, validRequirements, diagnostics };
}
