import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { validateConstitution, validateDesign, validateRequirements, type Diagnostic, type Evidence } from '../../domain/src/index.js';
import { loadConfig, loadPolicyBaseline, policyDiagnostics, commandCwd, type Config } from './config.js';
import { digest, evidenceInputPaths, exists, files, readText, safePath, snapshot, within, writeJson } from './files.js';
import { graphGate, graphImpact, indexGraph } from './graph.js';
import { formalCheck, type FormalResult } from './formal.js';
import { validateWorkflow } from './workflow.js';
import { parseMusubixTestReport, validateTddEvidence, type MusubixTestReport } from './tdd.js';
import { validateChangeCompleteness, validateChangeEvidence } from './change.js';
import { activeWaivers, waiverEvidenceDiagnostics } from './change-waiver.js';
import { changedFiles, runProcess, type Runner } from './process.js';
import { buildTrace, checkTrace } from './trace.js';
import { adapterInvocation, clearAdapterOutput, mergeAdapterArgs, normalizeAdapterReport, readAdapterOutput } from './adapters.js';
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
import {
  domainOwning, domainsConfigured, resolveDomains, validateApprovals, validateApprovalsForFeatureGate,
  type ApprovalValidation,
} from './approval.js';

export interface GateReport {
  schemaVersion: 1;
  generatedAt: string;
  status: 'pass' | 'fail';
  checks: Evidence[];
  metrics: Record<string, number>;
  mode: 'full' | 'changed' | 'feature';
  feature: string | null;
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
  waivers?: Array<{ changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string }>;
  waiverDiagnostics?: Diagnostic[];
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
  return snapshot(root, evidenceInputPaths(await files(root)));
}

export function snapshotChanges(
  before: Record<string, string>,
  after: Record<string, string>,
): Array<{ path: string; change: 'added' | 'modified' | 'deleted'; beforeSha256?: string; afterSha256?: string }> {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((path) => {
    const beforeSha256 = before[path];
    const afterSha256 = after[path];
    if (beforeSha256 === afterSha256) return [];
    return [{
      path,
      change: beforeSha256 === undefined ? 'added' as const : afterSha256 === undefined ? 'deleted' as const : 'modified' as const,
      ...(beforeSha256 === undefined ? {} : { beforeSha256 }),
      ...(afterSha256 === undefined ? {} : { afterSha256 }),
    }];
  });
}

export function aggregateStatus(checks: Evidence[]): 'pass' | 'fail' {
  return checks.every((check) => !check.required || check.status === 'pass') ? 'pass' : 'fail';
}

/** @id CODE-CLI-WORKFLOW-UX-005
 * @implements REQ-CLI-WORKFLOW-UX-005
 * @design DES-CLI-WORKFLOW-UX-005
 */
export async function runGate(root: string, options: {
  changed?: boolean;
  feature?: string;
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
  const featureDir = options.feature ? `.musubix/features/${options.feature}/` : null;
  if (featureDir && !paths.some((p) => p.startsWith(featureDir))) {
    throw new Error(`Unknown feature "${options.feature}"; no artifacts found under ${featureDir}.`);
  }
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
  const featureRequirementIds = featureDir
    ? new Set(requirements.filter((_, i) => requirementPaths[i]!.startsWith(featureDir)).flatMap((r) => r.value.map((req) => req.id)))
    : null;
  const featureDesignIds = featureDir
    ? new Set(designs.filter((_, i) => designPaths[i]!.startsWith(featureDir)).flatMap((d) => d.value.map((c) => c.id)))
    : null;
  function scopedToFeature(diagnostic: Diagnostic): boolean {
    if (!featureDir) return true;
    if (diagnostic.path?.startsWith(featureDir)) return true;
    const ids = [...featureRequirementIds!, ...featureDesignIds!];
    return ids.some((id) => diagnostic.message.includes(id));
  }
  const policyBaseline = await loadPolicyBaseline(root);
  const policy = policyBaseline ? policyDiagnostics(config, policyBaseline, changed) : [];
  checks.push({
    name: 'policy',
    required: policyBaseline !== null,
    status: policyBaseline === null ? 'skipped' : policy.some((diagnostic) => diagnostic.severity === 'error') ? 'fail' : 'pass',
    summary: policyBaseline === null ? 'No trusted policy baseline is configured.' : `${policy.length} policy violation(s).`,
    diagnostics: policy,
  });
  add('requirements', requirementPaths.length > 0, reqDiagnostics.filter(scopedToFeature));
  add('design', designPaths.length > 0, designDiagnostics.filter(scopedToFeature));
  const constitutionPath = '.musubix/constitution.md';
  const constitution = await exists(within(root, constitutionPath)) ? validateConstitution(await readText(root, constitutionPath), constitutionPath) : null;
  add('constitution', constitution !== null, constitution?.diagnostics ?? []);
  const trace = await buildTrace(root);
  const traceResult = await checkTrace(root, trace, true, config.thresholds);
  add('trace', requirementPaths.length > 0, traceResult.diagnostics.filter(scopedToFeature));
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
  const tddDiagnostics = tdd.diagnostics.filter(scopedToFeature);
  checks.push({
    name: 'tdd',
    required: required('tdd') || tdd.present || hasChangeDocuments,
    status: !tdd.present ? 'skipped' : (featureDir ? countErrors(tddDiagnostics) === 0 : tdd.valid) ? 'pass' : 'fail',
    summary: tdd.present ? `${tdd.cycles} Red-Green TDD cycle(s) recorded.` : 'No TDD cycle evidence is available.',
    diagnostics: tddDiagnostics,
  });
  const changes = await validateChangeEvidence(root);
  const changeDiagnostics = changes.diagnostics.filter(scopedToFeature);
  checks.push({
    name: 'change-history',
    required: required('change-history') || hasChangeDocuments,
    status: !changes.present ? 'skipped' : (featureDir ? countErrors(changeDiagnostics) === 0 : changes.valid) ? 'pass' : 'fail',
    summary: changes.present ? `${changes.changes} staged change(s) checked for ordered artifact and TDD evidence.` : 'No staged change chronology evidence is available.',
    diagnostics: changeDiagnostics,
  });
  const completeness = await validateChangeCompleteness(root);
  const completenessDiagnostics = completeness.diagnostics.filter(scopedToFeature);
  const completenessCheck: Evidence = {
    name: 'change-completeness',
    required: required('change-completeness') || hasChangeDocuments,
    status: !completeness.present ? 'skipped' : (featureDir ? countErrors(completenessDiagnostics) === 0 : completeness.valid) ? 'pass' : 'fail',
    summary: completeness.present
      ? `${completeness.changes.filter((change) => change.valid).length}/${completeness.changes.length} staged change(s) have complete requirement, design, ADR, code, test, TDD and trace evidence.`
      : 'No staged change evidence is available.',
    diagnostics: completenessDiagnostics,
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
    const configuredArgs = reportPath
      ? command.args.map((arg) => arg.replaceAll('{reportPath}', reportPath))
      : command.args;
    const args = command.adapter
      ? mergeAdapterArgs(command.adapter, configuredArgs, adapterArgs)
      : configuredArgs;
    const result = await runner(command.command, args, { cwd: commandCwd(root, command), timeoutMs: command.timeoutMs });
    const commandCheck: Evidence = {
      name: `command:${command.name}`, required: command.required,
      status: result.status === 'missing' ? 'skipped' : result.status !== 'completed' || result.exitCode !== 0 ? 'fail' : 'pass',
      summary: `${command.command}: ${result.status}, exit ${result.exitCode ?? 'none'}.`,
      durationMs: result.durationMs, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr,
    };
    commandChecks.push(commandCheck);
    if (reportPath && result.status === 'completed' && result.exitCode === 0) {
      const reportText = adapterOutput
        ? await readAdapterOutput(adapterOutput, await safePath(root, reportPath), result.stdout)
        : await exists(within(root, reportPath)) ? await readText(root, reportPath) : null;
      if (reportText === null) {
        const diagnostic: Diagnostic = {
          code: command.mutationReport ? 'MUTATION_REPORT_MISSING' : 'TEST_REPORT_MISSING',
          severity: 'error',
          message: `${command.name} did not produce its configured structured ${command.mutationReport ? 'mutation' : 'test'} report.`,
          path: reportPath,
        };
        if (command.mutationReport) mutationReportDiagnostics.push(diagnostic);
        else if (command.required) testReportDiagnostics.push(diagnostic);
        commandCheck.status = 'fail';
        commandCheck.diagnostics = [...commandCheck.diagnostics ?? [], diagnostic];
        commandCheck.summary = `${commandCheck.summary} Structured evidence is missing.`;
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
          const skippedTests = report.tests.filter((test) => test.status === 'skipped');
          const unsuccessfulTests = report.tests.filter((test) => test.status === 'failed' || test.status === 'error');
          const executedTests = report.tests.filter((test) => test.status !== 'skipped');
          const executionDiagnostics: Diagnostic[] = [];
          if (!executedTests.length) {
            executionDiagnostics.push({
              code: skippedTests.length ? 'TEST_REPORT_ALL_SKIPPED' : 'TEST_REPORT_NO_EXECUTED_TESTS',
              severity: 'error',
              message: skippedTests.length
                ? `${command.name} reported ${skippedTests.length} skipped test(s) and no executed tests.`
                : `${command.name} reported no executed tests.`,
              path: reportPath,
            });
          } else if (skippedTests.length) {
            executionDiagnostics.push({
              code: 'TEST_REPORT_SKIPPED',
              severity: 'error',
              message: `${command.name} reported ${skippedTests.length} skipped test(s); required test commands must execute every reported test.`,
              path: reportPath,
            });
          }
          executionDiagnostics.push(...skippedTests.map((test) => ({
            code: 'TEST_ID_SKIPPED',
            severity: 'error' as const,
            message: `${test.id} was reported as skipped, not executed.`,
            path: reportPath,
          })));
          executionDiagnostics.push(...unsuccessfulTests.map((test) => ({
            code: 'TEST_ID_NOT_PASSED',
            severity: 'error' as const,
            message: `${test.id} reported ${test.status} despite a successful command exit.`,
            path: reportPath,
          })));
          const seen = new Set<string>();
          for (const test of report.tests) {
            if (seen.has(test.id)) {
              executionDiagnostics.push({
                code: 'TEST_REPORT_DUPLICATE_ID',
                severity: 'error',
                message: `${command.name} reported ${test.id} more than once.`,
                path: reportPath,
              });
            }
            seen.add(test.id);
          }
          if (executionDiagnostics.length) {
            commandCheck.status = 'fail';
            commandCheck.summary = `${commandCheck.summary} Structured test evidence is incomplete.`;
            commandCheck.diagnostics = executionDiagnostics;
            if (command.required) testReportDiagnostics.push(...executionDiagnostics);
          } else {
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
            for (const test of report.tests) {
              structuredTests.set(test.id, [...structuredTests.get(test.id) ?? [], test]);
            }
          }
        } catch (cause) {
          const diagnostic: Diagnostic = {
            code: command.mutationReport ? 'MUTATION_REPORT_INVALID' : 'TEST_REPORT_INVALID',
            severity: 'error',
            message: cause instanceof Error ? cause.message : String(cause),
            path: reportPath,
          };
          if (command.mutationReport) mutationReportDiagnostics.push(diagnostic);
          else if (command.required) testReportDiagnostics.push(diagnostic);
          commandCheck.status = 'fail';
          commandCheck.diagnostics = [...commandCheck.diagnostics ?? [], diagnostic];
          commandCheck.summary = `${commandCheck.summary} Structured ${command.mutationReport ? 'mutation' : 'test'} evidence is invalid.`;
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
  const refreshedCompletenessDiagnostics = refreshedCompleteness.diagnostics.filter(scopedToFeature);
  completenessCheck.status = !refreshedCompleteness.present ? 'skipped' : (featureDir ? countErrors(refreshedCompletenessDiagnostics) === 0 : refreshedCompleteness.valid) ? 'pass' : 'fail';
  completenessCheck.summary = refreshedCompleteness.present
    ? `${refreshedCompleteness.changes.filter((change) => change.valid).length}/${refreshedCompleteness.changes.length} staged change(s) have semantically complete evidence.`
    : 'No staged change evidence is available.';
  completenessCheck.diagnostics = refreshedCompletenessDiagnostics;
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
  const domainsOn = domainsConfigured(config.approval);
  let approvals: ApprovalValidation;
  if (featureDir && domainsOn) {
    const resolvedDomains = await resolveDomains(root, config.approval);
    const owningDomain = domainOwning(resolvedDomains, options.feature!);
    if (!owningDomain) throw new Error(`Feature "${options.feature}" is not owned by any configured approval domain.`);
    approvals = await validateApprovalsForFeatureGate(root, config.approval, owningDomain);
  } else {
    approvals = await validateApprovals(root, config.approval);
  }
  const approvalStages = domainsOn
    ? [...(approvals.domains?.flatMap((d) => d.stages) ?? []), ...(approvals.release ? [approvals.release] : [])]
    : approvals.stages;
  checks.push({
    name: 'approval',
    required: required('approval') || config.approval.mode === 'required' || approvals.present,
    status: !approvals.present && config.approval.mode === 'compatible'
      ? 'skipped'
      : approvals.valid ? 'pass' : 'fail',
    summary: `${approvalStages.filter((stage) => stage.status === 'approved').length}/${approvalStages.length} approval stage(s) are current.`,
    diagnostics: approvals.diagnostics,
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
    'approval.errors': countErrors(approvals.diagnostics),
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
  const inputChanges = snapshotChanges(before, after);
  if (inputChanges.length) {
    checks.push({
      name: 'input-stability',
      required: true,
      status: 'fail',
      summary: `Project inputs changed during gate execution (${inputChanges.length} path(s)). Re-run after generators/formatters finish.`,
      diagnostics: inputChanges.map((change) => ({
        code: `INPUT_${change.change.toUpperCase()}`,
        severity: 'error',
        path: change.path,
        message: `${change.path} was ${change.change} during gate execution`
          + `${change.beforeSha256 ? `; before=${change.beforeSha256}` : ''}`
          + `${change.afterSha256 ? `; after=${change.afterSha256}` : ''}.`,
      })),
    });
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
  const featureScopedCheckNames = new Set(['requirements', 'design', 'trace', 'tdd', 'change-history', 'change-completeness']);
  if (domainsOn) featureScopedCheckNames.add('approval');
  const [waivers, waiverDiagnostics] = await Promise.all([activeWaivers(root), waiverEvidenceDiagnostics(root)]);
  const report: GateReport = {
    schemaVersion: 1,
    generatedAt,
    status: aggregateStatus(featureDir ? checks.filter((c) => featureScopedCheckNames.has(c.name)) : checks),
    checks,
    metrics,
    mode: featureDir ? 'feature' : options.changed ? 'changed' : 'full',
    feature: options.feature ?? null,
    changed: options.changed ? changed : lastChangeAnalysis?.changed ?? null,
    impacted: options.changed ? currentImpacted : lastChangeAnalysis?.impacted ?? [],
    lastChangeAnalysis,
    fingerprints: after,
    waivers,
    waiverDiagnostics,
  };
  if (!featureDir) await writeJson(root, evidencePath, report);
  return report;
}

export async function projectStatus(root: string): Promise<{
  initialized: boolean;
  artifacts: { requirements: number; designs: number; decisions: number };
  codeGraph: Config['codeGraph'] | null;
  approvals: ApprovalValidation | null;
  gate: { status: 'pass' | 'fail' | 'skipped' | 'stale'; generatedAt: string | null; ready: boolean };
  next: string[];
  waivers: Array<{ changeId: string; code: string; requirementId?: string; detail?: string; approver: string; reason: string; recordedAt: string }>;
  waiverDiagnostics: Diagnostic[];
}> {
  const paths = await files(root);
  const initialized = paths.includes('.musubix/config.json');
  const config = initialized ? await loadConfig(root) : null;
  const codeGraph = config?.codeGraph ?? null;
  const approvals = config ? await validateApprovals(root, config.approval) : null;
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
  if (status === 'pass' && approvals?.valid === false) status = 'stale';
  const [waivers, waiverDiagnostics] = await Promise.all([activeWaivers(root), waiverEvidenceDiagnostics(root)]);
  return {
    initialized,
    artifacts,
    codeGraph,
    approvals,
    gate: { status, generatedAt, ready: initialized && status === 'pass' && approvals?.valid === true },
    waivers,
    waiverDiagnostics,
    next: !initialized
      ? ['musubix3 init']
      : approvals && !approvals.valid
        ? approvals.domains
          ? [
            ...approvals.domains.flatMap((d) => d.stages.filter((stage) =>
              stage.status !== 'approved' && (stage.required || stage.present))
              .flatMap((stage) => [
                `musubix3 approval prepare ${stage.stage} --domain ${d.name}`,
                `musubix3 approval record ${stage.stage} --approver <name> --artifact-sha256 <approved-hash> --domain ${d.name} --confirm`,
              ])),
            ...(approvals.release && approvals.release.status !== 'approved' && (approvals.release.required || approvals.release.present)
              ? ['musubix3 approval prepare release', 'musubix3 approval record release --approver <name> --artifact-sha256 <approved-hash> --confirm']
              : []),
          ]
          : approvals.stages.filter((stage) =>
            stage.status !== 'approved' && (stage.required || stage.present))
            .flatMap((stage) => [
              `musubix3 approval prepare ${stage.stage}`,
              `musubix3 approval record ${stage.stage} --approver <name> --artifact-sha256 <approved-hash> --confirm`,
            ])
        : status !== 'pass' ? ['musubix3 trace build', 'musubix3 gate'] : [],
  };
}
