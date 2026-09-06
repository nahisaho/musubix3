import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { validateConstitution, validateDesign, validateRequirements, type Diagnostic, type Evidence } from '../../domain/src/index.js';
import { loadConfig, loadPolicyBaseline, policyDiagnostics, type Config } from './config.js';
import { digest, exists, files, readText, safePath, snapshot, within, writeJson } from './files.js';
import { graphGate, graphImpact, indexGraph } from './graph.js';
import { formalCheck, type FormalResult } from './formal.js';
import { validateWorkflow } from './workflow.js';
import { parseMusubixTestReport, validateTddEvidence, type MusubixTestReport } from './tdd.js';
import { validateChangeCompleteness, validateChangeEvidence } from './change.js';
import { changedFiles, runProcess, type Runner } from './process.js';
import { buildTrace, checkTrace } from './trace.js';
import { adapterInvocation, clearAdapterOutput, normalizeAdapterReport, readAdapterOutput } from './adapters.js';
import {
  createPerformanceExecution, performanceCommandSha256, validatePerformanceEvidence,
  writePerformanceEvidence, type PerformanceExecution,
} from './performance.js';
import {
  createMutationExecution, mutationCommandSha256, parseMutationReport, validateMutationEvidence,
  writeMutationEvidence, type MutationExecution,
} from './mutation.js';
import {
  validateModelCorrespondenceEvidence, writeModelCorrespondenceEvidence,
} from './model-correspondence.js';
import { verifyEvidenceAttestation, type AttestationVerificationOptions } from './attestation.js';

export interface GateReport {
  schemaVersion: 1;
  generatedAt: string;
  status: 'pass' | 'fail';
  checks: Evidence[];
  metrics: Record<string, number>;
  mode: 'full' | 'changed';
  changed: string[] | null;
  impacted: string[];
  lastChangeAnalysis: {
    baseline: 'HEAD';
    head: string | null;
    changed: string[];
    impacted: string[];
    generatedAt: string;
  } | null;
  fingerprints: Record<string, string>;
}

export interface FormalEvidence {
  schemaVersion: 1;
  generatedAt: string;
  totalRequirements: number;
  modeledRequirements: number;
  modeledFraction: number;
  result: FormalResult;
  fingerprints: Record<string, string>;
}

export async function evidenceSnapshot(root: string): Promise<Record<string, string>> {
  return snapshot(root, (await files(root)).filter((path) =>
    !/^\.musubix\/features\/[^/]+\/trace\.json$/.test(path)
    && !path.endsWith('.tgz')
    && !/^\.github\/skills\//.test(path)
    && !/(?:^|\/)(?:logs?|session-logs)\//.test(path)
    && !/\.jsonl$/.test(path)));
}

export function aggregateStatus(checks: Evidence[]): 'pass' | 'fail' {
  return checks.every((check) => !check.required || check.status === 'pass') ? 'pass' : 'fail';
}

export async function runGate(root: string, options: {
  changed?: boolean;
  runner?: Runner;
  config?: Config;
  environment?: NodeJS.ProcessEnv;
  attestationOptions?: AttestationVerificationOptions;
} = {}): Promise<GateReport> {
  const config = options.config ?? await loadConfig(root);
  const runner = options.runner ?? runProcess;
  const gateRunId = randomUUID();
  const changed = options.changed ? await changedFiles(root, runner) : null;
  const evidencePath = '.musubix/evidence/quality.json';
  const previous = await exists(within(root, evidencePath))
    ? JSON.parse(await readText(root, evidencePath)) as Partial<GateReport>
    : null;
  const before = await evidenceSnapshot(root);
  const paths = await files(root);
  const hasChangeDocuments = paths.some((path) => /^\.musubix\/changes\/CHANGE-\d+\.md$/.test(path));
  const checks: Evidence[] = [];
  const required = (name: string): boolean => config.requiredChecks.includes(name);
  const countErrors = (diagnostics: Diagnostic[]): number => diagnostics.filter((d) => d.severity === 'error').length;
  function add(name: string, present: boolean, diagnostics: Diagnostic[]): void {
    checks.push({
      name, required: required(name),
      status: !present ? 'skipped' : countErrors(diagnostics) ? 'fail' : 'pass',
      summary: !present ? 'No applicable artifact/input; not evaluated.' : `${countErrors(diagnostics)} error(s).`,
      diagnostics,
    });
  }
  const requirementPaths = paths.filter((p) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(p));
  const designPaths = paths.filter((p) => /^\.musubix\/features\/[^/]+\/design\.md$/.test(p));
  const requirements = await Promise.all(requirementPaths.map(async (p) => validateRequirements(await readText(root, p), p)));
  const requirementIds = new Set(requirements.flatMap((r) => r.value.map((req) => req.id)));
  const adrIds = new Set(paths.filter((p) => /^\.musubix\/decisions\/ADR-\d+\.md$/.test(p)).map((p) => p.split('/').at(-1)!.replace(/\.md$/, '')));
  const designTexts = await Promise.all(designPaths.map(async (path) => ({ path, text: await readText(root, path) })));
  const designIds = new Set(designTexts.flatMap(({ text }) => validateDesign(text).value.map((c) => c.id)));
  const designs = designTexts.map(({ path, text }) => validateDesign(text, path, { requirementIds, adrIds, designIds }));
  const reqDiagnostics = requirements.flatMap((r) => r.diagnostics);
  const designDiagnostics = designs.flatMap((d) => d.diagnostics);
  const policyBaseline = await loadPolicyBaseline(root);
  const policy = policyBaseline ? policyDiagnostics(config, policyBaseline, changed) : [];
  checks.push({
    name: 'policy',
    required: policyBaseline !== null,
    status: policyBaseline === null ? 'skipped' : policy.some((diagnostic) => diagnostic.severity === 'error') ? 'fail' : 'pass',
    summary: policyBaseline === null ? 'No trusted policy baseline is configured.' : `${policy.length} policy violation(s).`,
    diagnostics: policy,
  });
  add('requirements', requirementPaths.length > 0, reqDiagnostics);
  add('design', designPaths.length > 0, designDiagnostics);
  const constitutionPath = '.musubix/constitution.md';
  const constitution = await exists(within(root, constitutionPath)) ? validateConstitution(await readText(root, constitutionPath), constitutionPath) : null;
  add('constitution', constitution !== null, constitution?.diagnostics ?? []);
  const trace = await buildTrace(root);
  const traceResult = await checkTrace(root, trace, true, config.thresholds);
  add('trace', requirementPaths.length > 0, traceResult.diagnostics);
  const graph = await indexGraph(root);
  const graphResult = graphGate(graph, config.architecture, config.codeGraph);
  add('graph', graph.files.length > 0, graphResult.diagnostics);
  const formalText = (await Promise.all(requirementPaths.map(async (path) =>
    (await readText(root, path)).replace(/^---[\s\S]*?---\s*/, '')))).join('\n\n');
  const formalResult = await formalCheck(formalText, root, {
    solver: config.formal.solver,
    timeoutMs: config.formal.timeoutMs,
  }, runner);
  const totalRequirements = requirements.reduce((sum, result) => sum + result.value.length, 0);
  const modeledRequirements = new Set([
    ...formalResult.literals.map((literal) => literal.requirement),
    ...formalResult.constraints.map((constraint) => constraint.requirement),
  ]).size;
  const modeledFraction = totalRequirements ? modeledRequirements / totalRequirements : 0;
  const formalDiagnostics = [...formalResult.diagnostics];
  if (modeledFraction < config.formal.minModeledFraction) {
    formalDiagnostics.push({
      code: 'FORMAL_COVERAGE',
      severity: 'error',
      message: `Formal modeled fraction ${modeledFraction.toFixed(3)} is below required ${config.formal.minModeledFraction.toFixed(3)}.`,
    });
  }
  checks.push({
    name: 'formal',
    required: required('formal'),
    status: !requirementPaths.length ? 'skipped' : formalResult.valid && !formalDiagnostics.some((d) => d.severity === 'error') ? 'pass' : 'fail',
    summary: requirementPaths.length
      ? `${modeledRequirements}/${totalRequirements} requirements modeled; consistency ${formalResult.consistency}; solver ${formalResult.solver.status}.`
      : 'No requirements available for formal analysis.',
    diagnostics: formalDiagnostics,
    durationMs: formalResult.solver.durationMs,
  });
  const workflow = await validateWorkflow(root, config.workflow);
  checks.push({
    name: 'workflow',
    required: required('workflow') || workflow.present,
    status: !workflow.present ? 'skipped' : workflow.verified ? 'pass' : 'fail',
    summary: !workflow.present
      ? 'No workflow declarations are available.'
      : workflow.verified
        ? `${workflow.events} workflow declaration(s) across ${workflow.skills} Skill(s) reconciled with Copilot invocation events.`
        : `${workflow.events} workflow declaration(s) are not fully reconciled with Copilot invocation events.`,
    diagnostics: workflow.diagnostics,
  });
  const tdd = await validateTddEvidence(root);
  checks.push({
    name: 'tdd',
    required: required('tdd') || tdd.present || hasChangeDocuments,
    status: !tdd.present ? 'skipped' : tdd.valid ? 'pass' : 'fail',
    summary: tdd.present ? `${tdd.cycles} Red-Green TDD cycle(s) recorded.` : 'No TDD cycle evidence is available.',
    diagnostics: tdd.diagnostics,
  });
  const changes = await validateChangeEvidence(root);
  checks.push({
    name: 'change-history',
    required: required('change-history') || hasChangeDocuments,
    status: !changes.present ? 'skipped' : changes.valid ? 'pass' : 'fail',
    summary: changes.present ? `${changes.changes} staged change(s) checked for ordered artifact and TDD evidence.` : 'No staged change chronology evidence is available.',
    diagnostics: changes.diagnostics,
  });
  const completeness = await validateChangeCompleteness(root);
  const completenessCheck: Evidence = {
    name: 'change-completeness',
    required: required('change-completeness') || hasChangeDocuments,
    status: !completeness.present ? 'skipped' : completeness.valid ? 'pass' : 'fail',
    summary: completeness.present
      ? `${completeness.changes.filter((change) => change.valid).length}/${completeness.changes.length} staged change(s) have complete requirement, design, ADR, code, test, TDD and trace evidence.`
      : 'No staged change evidence is available.',
    diagnostics: completeness.diagnostics,
  };
  checks.push(completenessCheck);
  const formalEvidence: FormalEvidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totalRequirements,
    modeledRequirements,
    modeledFraction,
    result: formalResult,
    fingerprints: await snapshot(root, requirementPaths),
  };
  await writeJson(root, '.musubix/evidence/formal.json', formalEvidence);
  const commandChecks: Evidence[] = [];
  const structuredTests = new Map<string, MusubixTestReport['tests'][number][]>();
  const performanceExecutions: PerformanceExecution[] = [];
  const mutationExecutions: MutationExecution[] = [];
  const testReportDiagnostics: Diagnostic[] = [];
  const mutationReportDiagnostics: Diagnostic[] = [];
  let configuredTestReports = 0;
  for (const [commandIndex, command] of config.commands.entries()) {
    let reportPath: string | undefined;
    let adapterOutput: ReturnType<typeof adapterInvocation> | undefined;
    let adapterArgs: string[] = [];
    if (command.testReport) {
      configuredTestReports++;
      reportPath = command.testReport.path;
      const absolute = await safePath(root, reportPath);
      if (await exists(absolute)) await unlink(absolute);
    } else if (command.adapter) {
      configuredTestReports++;
      const invocation = adapterInvocation(command.adapter, command.name);
      adapterOutput = invocation;
      reportPath = invocation.reportPath;
      adapterArgs = invocation.args;
      await clearAdapterOutput(invocation, await safePath(root, reportPath));
    } else if (command.mutationReport) {
      reportPath = command.mutationReport.path;
      const absolute = await safePath(root, reportPath);
      if (await exists(absolute)) await unlink(absolute);
    }
    const args = reportPath
      ? [...command.args.map((arg) => arg.replaceAll('{reportPath}', reportPath)), ...adapterArgs]
      : command.args;
    const result = await runner(command.command, args, { cwd: root, timeoutMs: command.timeoutMs });
    commandChecks.push({
      name: `command:${command.name}`, required: command.required,
      status: result.status === 'missing' ? 'skipped' : result.status !== 'completed' || result.exitCode !== 0 ? 'fail' : 'pass',
      summary: `${command.command}: ${result.status}, exit ${result.exitCode ?? 'none'}.`,
      durationMs: result.durationMs, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    });
    if (reportPath && result.status === 'completed' && result.exitCode === 0) {
      const reportText = adapterOutput
        ? await readAdapterOutput(adapterOutput, await safePath(root, reportPath), result.stdout)
        : await exists(within(root, reportPath)) ? await readText(root, reportPath) : null;
      if (reportText === null) {
        (command.mutationReport ? mutationReportDiagnostics : testReportDiagnostics).push({
          code: command.mutationReport ? 'MUTATION_REPORT_MISSING' : 'TEST_REPORT_MISSING',
          severity: 'error',
          message: `${command.name} did not produce its configured structured ${command.mutationReport ? 'mutation' : 'test'} report.`,
          path: reportPath,
        });
      } else {
        try {
          if (command.mutationReport) {
            const report = parseMutationReport(reportText);
            mutationExecutions.push(createMutationExecution({
              executionId: digest(JSON.stringify({ gateRunId, commandIndex, commandName: command.name })),
              commandName: command.name,
              commandSha256: mutationCommandSha256(command.command, args),
              reportPath,
              reportSha256: digest(reportText),
              processStatus: result.status,
              exitCode: result.exitCode,
              mutants: report.mutants,
            }));
            continue;
          }
          const report = command.testReport
            ? parseMusubixTestReport(reportText)
            : normalizeAdapterReport(command.adapter!, reportText);
          const sourceKind = adapterOutput?.source ?? 'file';
          performanceExecutions.push(createPerformanceExecution({
            runId: gateRunId,
            executionId: digest(JSON.stringify({ runId: gateRunId, commandIndex, commandName: command.name })),
            commandName: command.name,
            commandSha256: performanceCommandSha256(command.command, args),
            reportPath,
            sourceKind,
            reportSha256: digest(reportText),
            processStatus: result.status,
            exitCode: result.exitCode,
            tests: report.tests,
          }));
          const seen = new Set<string>();
          for (const test of report.tests) {
            if (seen.has(test.id)) {
              testReportDiagnostics.push({
                code: 'TEST_REPORT_DUPLICATE_ID',
                severity: 'error',
                message: `${command.name} reported ${test.id} more than once.`,
                path: reportPath,
              });
            }
            seen.add(test.id);
            structuredTests.set(test.id, [...structuredTests.get(test.id) ?? [], test]);
          }
        } catch (cause) {
          testReportDiagnostics.push({
            code: 'TEST_REPORT_INVALID',
            severity: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
            path: reportPath,
          });
        }
      }
    }
  }
  checks.push(...commandChecks);
  const annotatedTestIds = trace.nodes.filter((node) => node.kind === 'test').map((node) => node.id);
  const executedTestIds = annotatedTestIds.filter((id) => structuredTests.get(id)?.some((test) => test.status === 'passed'));
  const identityDiagnostics = [
    ...testReportDiagnostics,
    ...annotatedTestIds.filter((id) => !executedTestIds.includes(id)).map((id) => ({
      code: 'TEST_ID_NOT_PASSED',
      severity: 'error' as const,
      message: `${id} was linked in source but not reported as passed by a successful structured test command.`,
    })),
  ];
  const identitiesPresent = annotatedTestIds.length > 0 && configuredTestReports > 0;
  checks.push({
    name: 'test-identities',
    required: required('test-identities'),
    status: !identitiesPresent
      ? 'skipped'
      : identityDiagnostics.length ? 'fail' : 'pass',
    summary: !annotatedTestIds.length
      ? 'No annotated test IDs are available.'
      : !configuredTestReports
        ? 'No structured command test report is configured.'
        : `${executedTestIds.length}/${annotatedTestIds.length} annotated test IDs passed in structured command reports.`,
    diagnostics: identityDiagnostics,
  });
  await writePerformanceEvidence(root, performanceExecutions, gateRunId);
  const performance = await validatePerformanceEvidence(root);
  checks.push({
    name: 'performance',
    required: required('performance') || performance.budgets > 0,
    status: performance.budgets === 0 ? 'skipped' : performance.valid ? 'pass' : 'fail',
    summary: performance.budgets === 0
      ? 'No deterministic performance budgets are declared.'
      : `${performance.budgets} deterministic operation budget(s) checked.`,
    diagnostics: performance.diagnostics,
  });
  if (config.commands.some((command) => command.mutationReport)) {
    await writeMutationEvidence(root, mutationExecutions, gateRunId);
  }
  const mutation = await validateMutationEvidence(root);
  mutation.diagnostics.unshift(...mutationReportDiagnostics);
  mutation.valid = mutation.valid && mutationReportDiagnostics.length === 0;
  checks.push({
    name: 'mutation',
    required: required('mutation') || (config.mutation.mode === 'strict' && mutation.requirements > 0) || mutation.present,
    status: !mutation.present ? mutation.valid ? 'skipped' : 'fail' : mutation.valid ? 'pass' : 'fail',
    summary: !mutation.present
      ? 'No mutation evidence is available.'
      : `${mutation.coveredRequirements.length}/${mutation.requirements} must functional requirement(s) have current linked killed mutants.`,
    diagnostics: mutation.diagnostics,
  });
  await writeModelCorrespondenceEvidence(root, trace, formalEvidence, performanceExecutions, gateRunId);
  const correspondence = await validateModelCorrespondenceEvidence(root);
  checks.push({
    name: 'model-correspondence',
    required: required('model-correspondence') || correspondence.requirements > 0,
    status: correspondence.requirements === 0 && !correspondence.present
      ? 'skipped'
      : correspondence.valid ? 'pass' : 'fail',
    summary: correspondence.requirements === 0
      ? 'No requirements with explicit Formal JSON are available.'
      : `${correspondence.coveredRequirements.length}/${correspondence.requirements} explicitly modeled requirement(s) correspond to current authoritative passing tests.`,
    diagnostics: correspondence.diagnostics,
  });
  const refreshedCompleteness = await validateChangeCompleteness(root);
  completenessCheck.status = !refreshedCompleteness.present ? 'skipped' : refreshedCompleteness.valid ? 'pass' : 'fail';
  completenessCheck.summary = refreshedCompleteness.present
    ? `${refreshedCompleteness.changes.filter((change) => change.valid).length}/${refreshedCompleteness.changes.length} staged change(s) have semantically complete evidence.`
    : 'No staged change evidence is available.';
  completenessCheck.diagnostics = refreshedCompleteness.diagnostics;
  const attestation = await verifyEvidenceAttestation(
    root,
    config.attestation,
    runner,
    options.environment ?? process.env,
    options.attestationOptions,
  );
  checks.push({
    name: 'attestation',
    required: required('attestation') || config.attestation.mode === 'ci-required' || attestation.present,
    status: attestation.status === 'off' || attestation.status === 'unsigned-local' ? 'skipped' : attestation.valid ? 'pass' : 'fail',
    summary: attestation.status === 'verified'
      ? attestation.trust === 'github-oidc-ephemeral-key'
        ? 'Evidence has a valid Ed25519 signature from an ephemeral key authorized by verified GitHub Actions OIDC claims.'
        : attestation.trust === 'github-oidc-trusted-key'
          ? 'Evidence has a valid trusted Ed25519 signature additionally authorized by verified GitHub Actions OIDC claims.'
          : 'Evidence is bound to the current repository, commit, CI run, and evidence heads by a statically trusted Ed25519 key.'
      : attestation.status === 'unsigned-local'
        ? 'Local evidence is explicitly unsigned.'
        : attestation.status === 'missing'
          ? 'Required CI attestation is missing.'
        : `Attestation status: ${attestation.status}.`,
    diagnostics: attestation.diagnostics,
  });
  checks.push({
    name: 'commands', required: required('commands'),
    status: !commandChecks.length ? 'skipped' : aggregateStatus(commandChecks) === 'fail' ? 'fail' : 'pass',
    summary: commandChecks.length ? `${commandChecks.length} configured command(s) executed; optional failures are nonblocking.` : 'No configured commands; build/test evidence is missing.',
  });
  const metrics: Record<string, number> = {
    'requirements.errors': countErrors(reqDiagnostics),
    'policy.errors': countErrors(policy),
    'design.errors': countErrors(designDiagnostics),
    'trace.errors': countErrors(traceResult.diagnostics),
    'graph.violations': countErrors(graphResult.diagnostics),
    'formal.errors': countErrors(formalDiagnostics),
    'formal.modeledFraction': modeledFraction,
    'commands.failures': commandChecks.filter((c) => c.status === 'fail').length,
    'commands.skipped': commandChecks.filter((c) => c.status === 'skipped').length + Number(!commandChecks.length),
    'tests.annotatedIds': annotatedTestIds.length,
    'tests.executedIds': executedTestIds.length,
    'tdd.cycles': tdd.cycles,
    'tdd.errors': countErrors(tdd.diagnostics),
    'changes.count': changes.changes,
    'changes.errors': countErrors(changes.diagnostics),
    'changes.complete': refreshedCompleteness.changes.filter((change) => change.valid).length,
    'changes.completenessErrors': countErrors(refreshedCompleteness.diagnostics),
    'performance.budgets': performance.budgets,
    'performance.errors': countErrors(performance.diagnostics),
    'mutation.requirements': mutation.requirements,
    'mutation.coveredRequirements': mutation.coveredRequirements.length,
    'mutation.mutants': mutation.mutants,
    'mutation.errors': countErrors(mutation.diagnostics),
    'modelCorrespondence.requirements': correspondence.requirements,
    'modelCorrespondence.coveredRequirements': correspondence.coveredRequirements.length,
    'modelCorrespondence.errors': countErrors(correspondence.diagnostics),
    'attestation.errors': countErrors(attestation.diagnostics),
    ...(traceResult.coverage.design === null ? {} : { 'coverage.design': traceResult.coverage.design }),
    ...(traceResult.coverage.implementation === null ? {} : { 'coverage.implementation': traceResult.coverage.implementation }),
    ...(traceResult.coverage.tests === null ? {} : { 'coverage.tests': traceResult.coverage.tests }),
  };
  if (constitution?.valid) {
    for (const rule of constitution.value.rules) {
      const checkName = rule.metric.split('.')[0]!;
      const evidence = checks.find((c) => c.name === checkName);
      const measured = metrics[rule.metric];
      checks.push({
        name: `constitution:${rule.id}`, required: required('constitution'),
        status: measured === undefined || !evidence || evidence.status === 'skipped' ? 'skipped' : measured <= rule.limit ? 'pass' : 'fail',
        summary: `${rule.metric} = ${measured ?? 'unavailable'}; maximum ${rule.limit}.`,
      });
    }
  }
  const after = await evidenceSnapshot(root);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    checks.push({ name: 'input-stability', required: true, status: 'fail', summary: 'Project inputs changed during gate execution. Re-run after generators/formatters finish.' });
  }
  const impacted = new Set<string>();
  for (const path of changed ?? []) {
    if (graph.files.includes(path)) for (const item of graphImpact(graph, path)) impacted.add(item.path);
  }
  const generatedAt = new Date().toISOString();
  const currentImpacted = [...impacted].sort();
  let lastChangeAnalysis = previous?.lastChangeAnalysis ?? null;
  if (options.changed) {
    const revision = await runner('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10_000 });
    lastChangeAnalysis = {
      baseline: 'HEAD',
      head: revision.status === 'completed' && revision.exitCode === 0 ? revision.stdout.trim() || null : null,
      changed: changed ?? [],
      impacted: currentImpacted,
      generatedAt,
    };
  }
  const report: GateReport = {
    schemaVersion: 1,
    generatedAt,
    status: aggregateStatus(checks),
    checks,
    metrics,
    mode: options.changed ? 'changed' : 'full',
    changed: options.changed ? changed : lastChangeAnalysis?.changed ?? null,
    impacted: options.changed ? currentImpacted : lastChangeAnalysis?.impacted ?? [],
    lastChangeAnalysis,
    fingerprints: after,
  };
  await writeJson(root, evidencePath, report);
  return report;
}

export async function projectStatus(root: string): Promise<{
  initialized: boolean;
  artifacts: { requirements: number; designs: number; decisions: number };
  codeGraph: Config['codeGraph'] | null;
  gate: { status: 'pass' | 'fail' | 'skipped' | 'stale'; generatedAt: string | null; ready: boolean };
  next: string[];
}> {
  const paths = await files(root);
  const initialized = paths.includes('.musubix/config.json');
  const codeGraph = initialized ? (await loadConfig(root)).codeGraph : null;
  const artifacts = {
    requirements: paths.filter((p) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(p)).length,
    designs: paths.filter((p) => /^\.musubix\/features\/[^/]+\/design\.md$/.test(p)).length,
    decisions: paths.filter((p) => /^\.musubix\/decisions\/ADR-\d+\.md$/.test(p)).length,
  };
  const evidencePath = '.musubix/evidence/quality.json';
  let status: 'pass' | 'fail' | 'skipped' | 'stale' = 'skipped';
  let generatedAt: string | null = null;
  if (await exists(within(root, evidencePath))) {
    const evidence = JSON.parse(await readText(root, evidencePath)) as Partial<GateReport>;
    if (evidence.schemaVersion !== 1 || !['pass', 'fail', 'skipped'].includes(String(evidence.status))) throw new Error('Invalid quality evidence; run gate.');
    if (evidence.status === 'pass' || evidence.status === 'fail') {
      status = evidence.fingerprints && JSON.stringify(evidence.fingerprints) === JSON.stringify(await evidenceSnapshot(root)) ? evidence.status : 'stale';
      if (status === 'pass' && (!evidence.checks?.length || aggregateStatus(evidence.checks) !== 'pass')) status = 'stale';
      if (status === 'pass') {
        const performance = await validatePerformanceEvidence(root);
        if (performance.budgets > 0 && !performance.valid) status = 'stale';
        const mutation = await validateMutationEvidence(root);
        if ((mutation.present || mutation.requirements > 0) && !mutation.valid) status = 'stale';
        const correspondence = await validateModelCorrespondenceEvidence(root);
        if (correspondence.requirements > 0 && !correspondence.valid) status = 'stale';
      }
    }
    generatedAt = evidence.generatedAt ?? null;
  }
  return {
    initialized, artifacts, codeGraph, gate: { status, generatedAt, ready: initialized && status === 'pass' },
    next: !initialized ? ['musubix3 init'] : status !== 'pass' ? ['musubix3 trace build', 'musubix3 gate'] : [],
  };
}
