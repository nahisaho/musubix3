import { error, validateRequirements, type Diagnostic, type FormalConstraint, type Requirement } from '../../domain/src/index.js';
import { adapterInvocation, normalizeAdapterReport, readAdapterOutput } from './adapters.js';
import { loadConfig } from './config.js';
import { digest, exists, files, readText, snapshot, within, writeJson } from './files.js';
import type { FormalResult } from './formal.js';
import type { PerformanceExecution } from './performance.js';
import { parseMusubixTestReport } from './tdd.js';
import { checkTrace, loadTrace, type TraceGraph } from './trace.js';

export interface CorrespondenceTestEvidence {
  testId: string;
  testPath: string;
  testSha256: string;
  commandName: string;
  commandSha256: string;
  reportPath: string;
  reportSha256: string;
  provenanceSha256: string;
}

export interface ModelCorrespondenceEntry {
  requirementId: string;
  requirementPath: string;
  formalSha256: string;
  modelSha256: string;
  traceSha256: string;
  tests: CorrespondenceTestEvidence[];
}

export interface ModelCorrespondenceEvidence {
  schemaVersion: 1;
  runId: string;
  generatedAt: string;
  formalEvidenceSha256: string;
  traceEvidenceSha256: string;
  entries: ModelCorrespondenceEntry[];
}

interface FormalEvidenceShape {
  schemaVersion: 1;
  result: FormalResult;
  fingerprints: Record<string, string>;
}

type ExplicitRequirement = Omit<Requirement, 'formal'> & { formal: FormalConstraint; path: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function validRelativePath(value: unknown): value is string {
  return typeof value === 'string' && !!value && !value.includes('\0')
    && !value.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(value)
    && !value.split(/[\\/]/).includes('..');
}

function formalHash(formal: FormalConstraint): string {
  return digest(canonical(formal));
}

function modelHash(requirementId: string, formal: FormalConstraint): string {
  return digest(canonical({ requirement: requirementId, constraint: formal }));
}

function traceHash(trace: TraceGraph): string {
  return digest(canonical({
    nodes: trace.nodes.map(({ id, kind, path, line, mandatory }) => ({ id, kind, path, line, mandatory: mandatory ?? false })),
    edges: trace.edges,
    fingerprints: trace.fingerprints,
  }));
}

function testProvenanceHash(test: Omit<CorrespondenceTestEvidence, 'provenanceSha256'>): string {
  return digest(canonical(test));
}

function formalEvidenceHash(formal: FormalEvidenceShape): string {
  return digest(canonical({
    fingerprints: formal.fingerprints,
    literals: formal.result.literals,
    constraints: formal.result.constraints,
    unsupported: formal.result.unsupported,
    consistency: formal.result.consistency,
    solver: {
      requested: formal.result.solver.requested,
      name: formal.result.solver.name,
      command: formal.result.solver.command,
      version: formal.result.solver.version,
      status: formal.result.solver.status,
      artifact: formal.result.solver.artifact ?? null,
    },
  }));
}

async function explicitRequirements(root: string): Promise<ExplicitRequirement[]> {
  const result: ExplicitRequirement[] = [];
  for (const path of (await files(root)).filter((entry) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(entry))) {
    result.push(...validateRequirements(await readText(root, path), path).value
      .filter((requirement): requirement is Omit<Requirement, 'formal'> & { formal: FormalConstraint } => requirement.formal !== null)
      .map((requirement) => ({ ...requirement, path })));
  }
  return result;
}

export async function writeModelCorrespondenceEvidence(
  root: string,
  trace: TraceGraph,
  formalEvidence: FormalEvidenceShape,
  executions: PerformanceExecution[],
  runId: string,
): Promise<ModelCorrespondenceEvidence> {
  const requirements = await explicitRequirements(root);
  const fingerprints = await snapshot(root, [...new Set(trace.nodes
    .filter((node) => node.kind === 'test').map((node) => node.path))]);
  const entries = requirements.map((requirement): ModelCorrespondenceEntry => {
    const linked = new Set(trace.edges.filter((edge) =>
      edge.to === requirement.id && edge.relation === 'verifies').map((edge) => edge.from));
    const tests = executions.flatMap((execution) => execution.tests
      .filter((test) => linked.has(test.id) && test.status === 'passed'
        && execution.processStatus === 'completed' && execution.exitCode === 0)
      .flatMap((test): CorrespondenceTestEvidence[] => {
        const node = trace.nodes.find((candidate) => candidate.kind === 'test' && candidate.id === test.id);
        if (!node) return [];
        const provenance: Omit<CorrespondenceTestEvidence, 'provenanceSha256'> = {
          testId: test.id,
          testPath: node.path,
          testSha256: fingerprints[node.path]!,
          commandName: execution.commandName,
          commandSha256: execution.commandSha256,
          reportPath: execution.reportPath,
          reportSha256: execution.reportSha256,
        };
        return [{ ...provenance, provenanceSha256: testProvenanceHash(provenance) }];
      }));
    return {
      requirementId: requirement.id,
      requirementPath: requirement.path,
      formalSha256: formalHash(requirement.formal),
      modelSha256: modelHash(requirement.id, requirement.formal),
      traceSha256: traceHash(trace),
      tests,
    };
  });
  const evidence: ModelCorrespondenceEvidence = {
    schemaVersion: 1,
    runId,
    generatedAt: new Date().toISOString(),
    formalEvidenceSha256: formalEvidenceHash(formalEvidence),
    traceEvidenceSha256: traceHash(trace),
    entries,
  };
  await writeJson(root, '.musubix/evidence/model-correspondence.json', evidence);
  return evidence;
}

export function modelCorrespondenceEvidenceHead(evidence: Record<string, unknown>): string {
  const entries = Array.isArray(evidence.entries) ? evidence.entries : [];
  return digest(canonical({
    schemaVersion: evidence.schemaVersion,
    formalEvidenceSha256: evidence.formalEvidenceSha256,
    traceEvidenceSha256: evidence.traceEvidenceSha256,
    entries: entries.map((value) => {
      const entry = value as Partial<ModelCorrespondenceEntry>;
      return {
        requirementId: entry.requirementId,
        requirementPath: entry.requirementPath,
        formalSha256: entry.formalSha256,
        modelSha256: entry.modelSha256,
        traceSha256: entry.traceSha256,
        tests: (entry.tests ?? []).map((test) => ({
          testId: test.testId,
          testPath: test.testPath,
          testSha256: test.testSha256,
          commandName: test.commandName,
          commandSha256: test.commandSha256,
          reportPath: test.reportPath,
        })).sort((a, b) => canonical(a).localeCompare(canonical(b))),
      };
    }).sort((a, b) => canonical(a).localeCompare(canonical(b))),
  }));
}

async function currentReport(root: string, commandName: string, reportPath: string): Promise<{
  commandSha256: string;
  reportSha256: string;
  passed: Set<string>;
} | null> {
  const config = await loadConfig(root);
  const command = config.commands.find((candidate) => candidate.name === commandName);
  if (!command || (!command.testReport && !command.adapter)) return null;
  const invocation = command.adapter ? adapterInvocation(command.adapter, command.name) : null;
  const configuredPath = command.testReport?.path ?? invocation!.reportPath;
  if (configuredPath !== reportPath) return null;
  const args = [
    ...command.args.map((arg) => arg.replaceAll('{reportPath}', configuredPath)),
    ...invocation?.args ?? [],
  ];
  const absolute = within(root, reportPath);
  const text = invocation
    ? await readAdapterOutput(invocation, absolute, '')
    : await exists(absolute) ? await readText(root, reportPath) : null;
  if (text === null) return null;
  const report = command.testReport
    ? parseMusubixTestReport(text)
    : normalizeAdapterReport(command.adapter!, text);
  return {
    commandSha256: digest(canonical({ executable: command.command, arguments: args })),
    reportSha256: digest(text),
    passed: new Set(report.tests.filter((test) => test.status === 'passed').map((test) => test.id)),
  };
}

export async function validateModelCorrespondenceEvidence(root: string): Promise<{
  present: boolean;
  valid: boolean;
  requirements: number;
  coveredRequirements: string[];
  diagnostics: Diagnostic[];
}> {
  const requirements = await explicitRequirements(root);
  const path = '.musubix/evidence/model-correspondence.json';
  if (!await exists(within(root, path))) {
    return {
      present: false,
      valid: requirements.length === 0,
      requirements: requirements.length,
      coveredRequirements: [],
      diagnostics: requirements.length
        ? [error('MODEL_CORRESPONDENCE_MISSING', 'Requirements with explicit Formal JSON require model correspondence evidence.', path)]
        : [],
    };
  }
  let value: ModelCorrespondenceEvidence;
  let formalEvidence: FormalEvidenceShape;
  try {
    value = JSON.parse(await readText(root, path)) as ModelCorrespondenceEvidence;
    formalEvidence = JSON.parse(await readText(root, '.musubix/evidence/formal.json')) as FormalEvidenceShape;
  } catch (cause) {
    return {
      present: true, valid: false, requirements: requirements.length, coveredRequirements: [],
      diagnostics: [error('MODEL_CORRESPONDENCE_SCHEMA', `Invalid correspondence/formal evidence: ${cause instanceof Error ? cause.message : String(cause)}.`, path)],
    };
  }
  if (value.schemaVersion !== 1 || !Array.isArray(value.entries)
    || typeof value.runId !== 'string' || Number.isNaN(Date.parse(value.generatedAt))
    || !/^[a-f0-9]{64}$/.test(value.formalEvidenceSha256)
    || !/^[a-f0-9]{64}$/.test(value.traceEvidenceSha256)
    || formalEvidence.schemaVersion !== 1 || !formalEvidence.result || !formalEvidence.fingerprints) {
    return {
      present: true, valid: false, requirements: requirements.length, coveredRequirements: [],
      diagnostics: [error('MODEL_CORRESPONDENCE_SCHEMA', 'Invalid model correspondence evidence.', path)],
    };
  }
  const diagnostics: Diagnostic[] = [];
  let trace: TraceGraph;
  try {
    trace = await loadTrace(root);
    const checkedTrace = await checkTrace(root, trace, true);
    if (!checkedTrace.valid) diagnostics.push(error('MODEL_CORRESPONDENCE_TRACE_STALE', 'Generated trace evidence is missing, stale, or invalid.', path));
  } catch {
    return {
      present: true, valid: false, requirements: requirements.length, coveredRequirements: [],
      diagnostics: [error('MODEL_CORRESPONDENCE_TRACE_STALE', 'Generated trace evidence is missing or invalid.', path)],
    };
  }
  const currentTraceHash = traceHash(trace);
  if (value.traceEvidenceSha256 !== currentTraceHash) {
    diagnostics.push(error('MODEL_CORRESPONDENCE_TRACE_STALE', 'Correspondence trace fingerprint does not match the current generated trace.', path));
  }
  if (value.formalEvidenceSha256 !== formalEvidenceHash(formalEvidence)) {
    diagnostics.push(error('MODEL_CORRESPONDENCE_FORMAL_TAMPERED', 'Correspondence formal evidence fingerprint is invalid.', path));
  }
  const requirementFingerprints = await snapshot(root, requirements.map((requirement) => requirement.path));
  for (const requirement of requirements) {
    if (formalEvidence.fingerprints[requirement.path] !== requirementFingerprints[requirement.path]) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_FORMAL_STALE', `${requirement.id} formal input fingerprint is stale.`, requirement.path, requirement.line));
    }
    const modeled = formalEvidence.result.constraints.filter((entry) => entry.requirement === requirement.id);
    if (modeled.length !== 1 || canonical(modeled[0]?.constraint) !== canonical(requirement.formal)) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_MODEL_STALE', `${requirement.id} has no unique current formal model entry.`, requirement.path, requirement.line));
    }
  }
  const covered = new Set<string>();
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (!entry || typeof entry.requirementId !== 'string' || !validRelativePath(entry.requirementPath)
      || !/^[a-f0-9]{64}$/.test(entry.formalSha256) || !/^[a-f0-9]{64}$/.test(entry.modelSha256)
      || !/^[a-f0-9]{64}$/.test(entry.traceSha256) || !Array.isArray(entry.tests)) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_SCHEMA', 'A correspondence entry is malformed.', path));
      continue;
    }
    if (seen.has(entry.requirementId)) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_DUPLICATE', `${entry.requirementId} has duplicate correspondence entries.`, path));
    }
    seen.add(entry.requirementId);
    const requirement = requirements.find((candidate) => candidate.id === entry.requirementId);
    if (!requirement || requirement.path !== entry.requirementPath) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_REQUIREMENT', `${entry.requirementId} is not a current requirement with explicit Formal JSON.`, path));
      continue;
    }
    if (entry.formalSha256 !== formalHash(requirement.formal)
      || entry.modelSha256 !== modelHash(requirement.id, requirement.formal)
      || entry.traceSha256 !== currentTraceHash) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_STALE', `${entry.requirementId} model or trace fingerprint is stale.`, path));
    }
    let validTests = 0;
    for (const test of entry.tests) {
      if (!test || typeof test.testId !== 'string' || !validRelativePath(test.testPath)
        || !/^[a-f0-9]{64}$/.test(test.testSha256) || typeof test.commandName !== 'string'
        || !/^[a-f0-9]{64}$/.test(test.commandSha256) || !validRelativePath(test.reportPath)
        || !/^[a-f0-9]{64}$/.test(test.reportSha256)
        || !/^[a-f0-9]{64}$/.test(test.provenanceSha256)) {
        diagnostics.push(error('MODEL_CORRESPONDENCE_SCHEMA', `A test evidence entry for ${entry.requirementId} is malformed.`, path));
        continue;
      }
      const { provenanceSha256, ...provenance } = test;
      if (testProvenanceHash(provenance) !== provenanceSha256) {
        diagnostics.push(error('MODEL_CORRESPONDENCE_PROVENANCE_TAMPERED', `${test.testId} correspondence provenance was changed.`, path));
        continue;
      }
      const node = trace.nodes.find((candidate) => candidate.id === test.testId && candidate.kind === 'test');
      if (!node || node.path !== test.testPath || !trace.edges.some((edge) =>
        edge.from === test.testId && edge.to === requirement.id && edge.relation === 'verifies')) {
        diagnostics.push(error('MODEL_CORRESPONDENCE_TEST_UNLINKED', `${test.testId} is not an authoritative trace-linked test for ${requirement.id}.`, path));
        continue;
      }
      const fingerprint = (await snapshot(root, [test.testPath]))[test.testPath];
      if (fingerprint !== test.testSha256) {
        diagnostics.push(error('MODEL_CORRESPONDENCE_TEST_STALE', `${test.testId} fingerprint is stale.`, test.testPath));
        continue;
      }
      try {
        const report = await currentReport(root, test.commandName, test.reportPath);
        if (!report || report.commandSha256 !== test.commandSha256
          || report.reportSha256 !== test.reportSha256 || !report.passed.has(test.testId)) {
          diagnostics.push(error('MODEL_CORRESPONDENCE_TEST_NOT_PASSED', `${test.testId} lacks a current passing structured command report.`, test.reportPath));
          continue;
        }
      } catch {
        diagnostics.push(error('MODEL_CORRESPONDENCE_TEST_NOT_PASSED', `${test.testId} report is missing, malformed, or stale.`, test.reportPath));
        continue;
      }
      validTests++;
    }
    if (!validTests) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_UNPROVED', `${requirement.id} has no current authoritative passing test evidence.`, path));
    } else covered.add(requirement.id);
  }
  for (const requirement of requirements) {
    if (!seen.has(requirement.id)) {
      diagnostics.push(error('MODEL_CORRESPONDENCE_UNPROVED', `${requirement.id} has no correspondence entry.`, requirement.path, requirement.line));
    }
  }
  return {
    present: true,
    valid: !diagnostics.length,
    requirements: requirements.length,
    coveredRequirements: [...covered].sort(),
    diagnostics,
  };
}
