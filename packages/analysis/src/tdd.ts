import { unlink } from 'node:fs/promises';
import ts from 'typescript';
import { error, type Diagnostic } from '../../domain/src/index.js';
import { loadConfig, commandCwd } from './config.js';
import { digest, evidenceInputPaths, exists, files, isSource, readText, safePath, snapshot, within, writeJson } from './files.js';
import { runProcess, type Runner } from './process.js';
import { buildTrace, type TraceNode } from './trace.js';
import { adapterInvocation, clearAdapterOutput, mergeAdapterArgs, normalizeAdapterReport, readAdapterOutput } from './adapters.js';
import { appendEvidenceOrder, evidenceOrderRecord, inspectEvidenceOrder, type validateEvidenceOrderLog } from './order.js';
import { requireApproval, resolveRequirementDomain } from './approval.js';
import type { MusubixTestReport } from './test-report.js';
export type { MusubixTestReport } from './test-report.js';

export type TddPhase = 'red' | 'green' | 'refactor';

export interface TddPhaseEvidence {
  phase: TddPhase;
  valid: boolean;
  scoped?: boolean;
  resultObserved?: boolean;
  testStatus?: 'passed' | 'failed' | 'skipped' | 'error';
  reportSha256?: string;
  commandSha256: string;
  outputSha256: string;
  exitCode: number | null;
  durationMs: number;
  testFingerprint: string;
  sourceFingerprint?: string;
  executionId?: string;
  order?: number;
  recordedAt: string;
  diagnostics: Diagnostic[];
}

export type TddChainPhase = TddPhase | 'migrate' | 'void';

export interface TddMigrationEvidence {
  phase: 'migrate';
  fromFingerprint: string;
  toFingerprint: string;
  approver: string;
  order?: number;
  recordedAt: string;
}

export interface TddVoidEvidence {
  phase: 'void';
  approver: string;
  reason: string;
  order?: number;
  recordedAt: string;
}

export interface TddCycle {
  cycleId?: string;
  requirementId: string;
  testId: string;
  testPath: string;
  commandName: string;
  red: TddPhaseEvidence;
  green?: TddPhaseEvidence;
  refactor?: TddPhaseEvidence;
  migrate?: TddMigrationEvidence;
  void?: TddVoidEvidence;
}

export interface TddChainRecord {
  sequence: number;
  cycleId: string;
  requirementId: string;
  testId: string;
  testPath: string;
  commandName: string;
  phase: TddChainPhase;
  phaseEvidenceSha256: string;
  previousSha256: string | null;
  recordSha256: string;
}

export interface TddEvidence {
  schemaVersion: 1;
  cycles: TddCycle[];
  chain?: TddChainRecord[];
}

function render(value: string, testId: string, testPath: string, reportPath: string): string {
  return value.replaceAll('{testId}', testId).replaceAll('{testPath}', testPath).replaceAll('{reportPath}', reportPath);
}

export function parseMusubixTestReport(text: string): MusubixTestReport {
  const value = JSON.parse(text) as MusubixTestReport;
  if (value.schemaVersion !== 1 || !Array.isArray(value.tests)) throw new Error('Invalid structured TDD report.');
  for (const test of value.tests) {
    if (!test || typeof test.id !== 'string' || !['passed', 'failed', 'skipped', 'error'].includes(test.status)) {
      throw new Error('Invalid structured TDD test result.');
    }
    if (test.operations !== undefined && (!test.operations || typeof test.operations !== 'object' || Array.isArray(test.operations)
      || Object.entries(test.operations).some(([name, count]) => !/^[\p{L}_][\p{L}\p{N}_.:-]{0,127}$/u.test(name)
        || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0))) {
      throw new Error('Structured test operations must be nonnegative integer counters.');
    }
  }
  return value;
}

function chainRecordSha256(record: Omit<TddChainRecord, 'recordSha256'>): string {
  return digest(JSON.stringify(record));
}

function appendChainRecord(evidence: TddEvidence, cycle: TddCycle, phase: TddChainPhase, phaseEvidence: unknown): void {
  if (!cycle.cycleId) throw new Error('TDD cycle ID is required for append-only evidence.');
  if (!evidence.chain) {
    if (evidence.cycles.some((entry) => entry !== cycle)) {
      throw new Error('Existing TDD evidence lacks an append-only hash chain; regenerate it before recording new phases.');
    }
    evidence.chain = [];
  }
  const previous = evidence.chain.at(-1);
  const payload: Omit<TddChainRecord, 'recordSha256'> = {
    sequence: evidence.chain.length + 1,
    cycleId: cycle.cycleId,
    requirementId: cycle.requirementId,
    testId: cycle.testId,
    testPath: cycle.testPath,
    commandName: cycle.commandName,
    phase,
    phaseEvidenceSha256: digest(JSON.stringify(phaseEvidence)),
    previousSha256: previous?.recordSha256 ?? null,
  };
  evidence.chain.push({ ...payload, recordSha256: chainRecordSha256(payload) });
}

async function sourceFingerprint(root: string, testPath: string, excludedPaths: string[] = []): Promise<string> {
  const excluded = new Set(excludedPaths);
  const paths = evidenceInputPaths(await files(root)).filter((path) =>
    path !== testPath && !excluded.has(path));
  return digest(JSON.stringify(await snapshot(root, paths)));
}

// Collect every statement in the file, at any nesting depth (not just the
// top level), in source order. A test's leading `@id TEST-*` comment is only
// ever attached as leading trivia of its own statement (e.g. the `it(...)`
// expression statement), so scanning the full tree — rather than only
// `source.statements` — finds that statement even when it is nested inside a
// shared `describe(...)` block, without ever matching a sibling test's
// statement (each sibling's own leading comment differs).
/** @id CODE-TDD-FINGERPRINT-SCOPING-001
 * @implements REQ-TDD-FINGERPRINT-SCOPING-001
 * @design DES-TDD-FINGERPRINT-SCOPING-001
 */
function collectStatements(node: ts.Node, out: ts.Statement[]): void {
  if (ts.isStatement(node)) out.push(node);
  ts.forEachChild(node, (child) => collectStatements(child, out));
}

async function testFingerprint(root: string, test: TraceNode): Promise<string> {
  const text = await readText(root, test.path);
  const lines = text.split(/\r?\n/);
  const start = lines.slice(0, Math.max(0, test.line - 1)).join('\n').length + (test.line > 1 ? 1 : 0);
  if (isSource(test.path)) {
    const source = ts.createSourceFile(test.path, text, ts.ScriptTarget.Latest, true);
    const statements: ts.Statement[] = [];
    collectStatements(source, statements);
    const declaration = statements.find((statement) => statement.getStart(source) >= start);
    if (declaration) return digest(text.slice(start, declaration.end).trim());
  }
  const lineEnd = text.indexOf('\n', start);
  const searchFrom = lineEnd < 0 ? text.length : lineEnd + 1;
  const next = text.slice(searchFrom).search(/^[ \t]*(?:\/\*+|\/\/|#).*?@id\s+TEST-/m);
  return digest(text.slice(start, next < 0 ? text.length : searchFrom + next).trim());
}

// The pre-REQ-TDD-FINGERPRINT-SCOPING-001 algorithm (top-level statements
// only). Retained solely so `migrateTddFingerprint` can prove a stored
// fingerprint still matches what this superseded algorithm computes from
// current source text, before moving a cycle onto the corrected algorithm
// above. Must never be used for any other (live) fingerprint computation.
/** @id CODE-TDD-FINGERPRINT-MIGRATION-001
 * @implements REQ-TDD-FINGERPRINT-MIGRATION-001
 * @design DES-TDD-FINGERPRINT-MIGRATION-001
 */
export async function legacyTestFingerprint(root: string, test: TraceNode): Promise<string> {
  const text = await readText(root, test.path);
  const lines = text.split(/\r?\n/);
  const start = lines.slice(0, Math.max(0, test.line - 1)).join('\n').length + (test.line > 1 ? 1 : 0);
  if (isSource(test.path)) {
    const source = ts.createSourceFile(test.path, text, ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find((statement) => statement.getStart(source) >= start);
    if (declaration) return digest(text.slice(start, declaration.end).trim());
  }
  const lineEnd = text.indexOf('\n', start);
  const searchFrom = lineEnd < 0 ? text.length : lineEnd + 1;
  const next = text.slice(searchFrom).search(/^[ \t]*(?:\/\*+|\/\/|#).*?@id\s+TEST-/m);
  return digest(text.slice(start, next < 0 ? text.length : searchFrom + next).trim());
}

export interface TddMigrationResult {
  migrated: boolean;
  testId: string;
  fromFingerprint?: string;
  toFingerprint?: string;
  reason?: string;
}

export async function migrateTddFingerprint(root: string, testId: string, approver: string): Promise<TddMigrationResult> {
  if (!approver) throw new Error('An approver is required to migrate TDD fingerprint evidence.');
  const evidence = await loadTddEvidence(root);
  if (!evidence) throw new Error('No TDD evidence found.');
  let cycle = evidence.cycles.filter((entry) => entry.testId === testId).at(-1);
  if (!cycle) throw new Error(`No TDD cycle found for ${testId}.`);
  const order = await inspectEvidenceOrder(root);
  /** @id CODE-TDD-CYCLE-VOID-006
   * @implements REQ-TDD-CYCLE-VOID-012
   * @design DES-TDD-CYCLE-VOID-006
   */
  if (voidLinkage(evidence, order, cycle).valid) {
    const validlyVoided = new Set(evidence.cycles.filter((entry) => voidLinkage(evidence, order, entry).valid));
    const effective = effectiveLatestCycle(evidence, order, validlyVoided, testId, cycle);
    if (effective) cycle = effective;
  }
  if (!cycle.cycleId) throw new Error(`${testId} lacks a cycle ID; regenerate its evidence before migrating.`);
  if (!cycle.green?.valid) throw new Error(`${testId} has no valid Green phase to migrate.`);
  if (cycle.migrate) throw new Error(`${testId} has already been migrated.`);
  const trace = await buildTrace(root);
  const test = trace.nodes.find((node) => node.kind === 'test' && node.id === testId);
  if (!test) throw new Error(`Annotated test ID not found: ${testId}`);
  const latestPhase = cycle.refactor?.valid ? cycle.refactor : cycle.green;
  const storedFingerprint = latestPhase.testFingerprint;
  const legacyCurrent = await legacyTestFingerprint(root, test);
  if (legacyCurrent !== storedFingerprint) {
    return {
      migrated: false,
      testId,
      reason: `${testId}'s recorded fingerprint does not match its current source under the superseded algorithm; this is real drift, not an algorithm-only change. Run a genuine Red/Green cycle instead.`,
    };
  }
  const toFingerprint = await testFingerprint(root, test);
  const record: TddMigrationEvidence = {
    phase: 'migrate',
    fromFingerprint: storedFingerprint,
    toFingerprint,
    approver,
    recordedAt: new Date().toISOString(),
  };
  record.order = (await appendEvidenceOrder(root, { kind: 'tdd', entityId: cycle.cycleId, phase: 'migrate' })).sequence;
  cycle.migrate = record;
  appendChainRecord(evidence, cycle, 'migrate', record);
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);
  return { migrated: true, testId, fromFingerprint: storedFingerprint, toFingerprint };
}

export async function loadTddEvidence(root: string): Promise<TddEvidence | null> {
  const path = '.musubix/evidence/tdd.json';
  if (!await exists(within(root, path))) return null;
  const value = JSON.parse(await readText(root, path)) as TddEvidence;
  if (value.schemaVersion !== 1 || !Array.isArray(value.cycles)) throw new Error('Invalid TDD evidence.');
  return value;
}

/** Answers "is this cycle's recorded phase evidence genuinely intact" against
 * both the monotonic order log and the append-only hash chain, reused for
 * void-linkage validation (REQ-TDD-CYCLE-VOID-005..007) and for Green-candidate
 * verification when resolving an effective latest cycle (REQ-TDD-CYCLE-VOID-010).
 */
function phaseLinkageValid(
  order: ReturnType<typeof validateEvidenceOrderLog>,
  chain: TddChainRecord[] | undefined,
  cycle: TddCycle,
  phase: TddChainPhase,
  phaseEvidence: unknown,
): boolean {
  if (!order.valid || !cycle.cycleId || !chain) return false;
  const phaseOrder = phase === 'void' ? cycle.void?.order : phase === 'migrate' ? cycle.migrate?.order : cycle[phase]?.order;
  if (phaseOrder === undefined) return false;
  const orderRecord = evidenceOrderRecord(order.records, 'tdd', cycle.cycleId, phase);
  if (!orderRecord || orderRecord.sequence !== phaseOrder) return false;
  if (phase === 'void' && orderRecord.testId !== cycle.testId) return false;
  const matches = chain.filter((record) => record.phase === phase && record.cycleId === cycle.cycleId && record.testId === cycle.testId);
  if (matches.length !== 1) return false;
  const record = matches[0]!;
  const index = chain.indexOf(record);
  const expectedPrevious = index === 0 ? null : chain[index - 1]!.recordSha256;
  const { recordSha256, ...payload } = record;
  return recordSha256 === chainRecordSha256(payload)
    && record.previousSha256 === expectedPrevious
    && record.phaseEvidenceSha256 === digest(JSON.stringify(phaseEvidence));
}

/** @id CODE-TDD-CYCLE-VOID-002
 * @implements REQ-TDD-CYCLE-VOID-005, REQ-TDD-CYCLE-VOID-006, REQ-TDD-CYCLE-VOID-007
 * @design DES-TDD-CYCLE-VOID-002
 */
function voidLinkage(
  evidence: TddEvidence,
  order: ReturnType<typeof validateEvidenceOrderLog>,
  cycle: TddCycle,
): { valid: boolean; reason?: string } {
  if (!cycle.void) return { valid: false };
  if (phaseLinkageValid(order, evidence.chain, cycle, 'void', cycle.void)) return { valid: true };
  let reason = 'an invalid monotonic evidence order log';
  if (order.valid) {
    if (!cycle.cycleId || cycle.void.order === undefined) {
      reason = 'a missing order record reference';
    } else {
      const orderRecord = evidenceOrderRecord(order.records, 'tdd', cycle.cycleId, 'void');
      if (!orderRecord || orderRecord.sequence !== cycle.void.order) reason = 'a missing or mismatched order record';
      else if (orderRecord.testId !== cycle.testId) reason = 'an order record testId mismatch';
      else if (!evidence.chain) reason = 'a missing hash chain';
      else {
        const matches = evidence.chain.filter((record) =>
          record.phase === 'void' && record.cycleId === cycle.cycleId && record.testId === cycle.testId);
        reason = matches.length === 0
          ? 'a missing chain record'
          : matches.length > 1
            ? 'a duplicate chain record'
            : 'a broken predecessor or payload hash link';
      }
    }
  }
  return { valid: false, reason: `${cycle.testId}'s void evidence is malformed: ${reason}.` };
}

/** Resolves the effective latest cycle for `testId` when its actual latest
 * cycle (`voidedCycle`) is validly voided, per REQ-TDD-CYCLE-VOID-010: the
 * eligible, non-voided candidate with the greatest verified Green order
 * sequence strictly before the void's own order sequence.
 */
/** @id CODE-TDD-CYCLE-VOID-004
 * @implements REQ-TDD-CYCLE-VOID-010
 * @design DES-TDD-CYCLE-VOID-004
 */
function effectiveLatestCycle(
  evidence: TddEvidence,
  order: ReturnType<typeof validateEvidenceOrderLog>,
  validlyVoidedCycles: Set<TddCycle>,
  testId: string,
  voidedCycle: TddCycle,
): TddCycle | undefined {
  if (!voidedCycle.cycleId) return undefined;
  const voidRecord = evidenceOrderRecord(order.records, 'tdd', voidedCycle.cycleId, 'void');
  if (!voidRecord) return undefined;
  let best: { cycle: TddCycle; sequence: number } | undefined;
  for (const candidate of evidence.cycles) {
    if (candidate.testId !== testId || candidate === voidedCycle) continue;
    if (!candidate.red.valid || !candidate.green?.valid) continue;
    if (validlyVoidedCycles.has(candidate)) continue;
    if (!candidate.cycleId) continue;
    if (!phaseLinkageValid(order, evidence.chain, candidate, 'green', candidate.green)) continue;
    const record = evidenceOrderRecord(order.records, 'tdd', candidate.cycleId, 'green');
    if (!record || record.sequence >= voidRecord.sequence) continue;
    if (!best || record.sequence > best.sequence) best = { cycle: candidate, sequence: record.sequence };
  }
  return best?.cycle;
}

export interface TddVoidResult {
  voided: boolean;
  testId: string;
  cycleId?: string;
  reason?: string;
}

/** @id CODE-TDD-CYCLE-VOID-001
 * @implements REQ-TDD-CYCLE-VOID-001, REQ-TDD-CYCLE-VOID-002, REQ-TDD-CYCLE-VOID-003, REQ-TDD-CYCLE-VOID-004, REQ-TDD-CYCLE-VOID-011
 * @design DES-TDD-CYCLE-VOID-001, DES-TDD-CYCLE-VOID-005
 */
export async function voidTddCycle(root: string, testId: string, approver: string, reason: string): Promise<TddVoidResult> {
  if (!approver?.trim()) throw new Error('An approver is required to void a TDD cycle.');
  if (!reason?.trim()) throw new Error('A reason is required to void a TDD cycle.');
  const evidence = await loadTddEvidence(root);
  if (!evidence) throw new Error('No TDD evidence found.');
  const cycle = evidence.cycles.filter((entry) => entry.testId === testId).at(-1);
  if (!cycle) throw new Error(`No TDD cycle found for ${testId}.`);
  if (cycle.green?.valid) throw new Error(`${testId}'s latest cycle has a valid Green phase; only a dangling cycle can be voided.`);
  if (cycle.void) throw new Error(`${testId}'s latest cycle is already voided.`);
  if (!cycle.cycleId) throw new Error(`${testId} lacks a cycle ID; regenerate its evidence before voiding.`);
  if (!evidence.chain && evidence.cycles.some((entry) => entry !== cycle)) {
    throw new Error('Existing TDD evidence lacks an append-only hash chain; regenerate it before recording new phases.');
  }
  const order = await inspectEvidenceOrder(root);
  const earlierCycles = evidence.cycles.slice(0, evidence.cycles.indexOf(cycle)).filter((entry) => entry.testId === testId);
  const eligibleFallback = earlierCycles.some((entry) =>
    entry.red.valid && entry.green?.valid && !voidLinkage(evidence, order, entry).valid);
  if (!eligibleFallback) {
    return {
      voided: false,
      testId,
      reason: `${testId} has no earlier valid, non-voided Red-Green cycle to fall back on; voiding would leave it with no coverage.`,
    };
  }
  const record: TddVoidEvidence = { phase: 'void', approver, reason, recordedAt: new Date().toISOString() };
  record.order = (await appendEvidenceOrder(root, { kind: 'tdd', entityId: cycle.cycleId, phase: 'void', testId: cycle.testId })).sequence;
  cycle.void = record;
  appendChainRecord(evidence, cycle, 'void', record);
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);
  return { voided: true, testId, cycleId: cycle.cycleId };
}

export async function runTddPhase(
  root: string,
  phase: TddPhase,
  testId: string,
  requirementId: string,
  commandName: string,
  runner: Runner = runProcess,
): Promise<TddPhaseEvidence> {
  const config = await loadConfig(root);
  if (phase === 'red') {
    const domain = await resolveRequirementDomain(root, config.approval, requirementId);
    await requireApproval(root, 'design', config.approval, domain);
  }
  const command = config.commands.find((entry) => entry.name === commandName);
  if (!command) throw new Error(`Configured command not found: ${commandName}`);
  if ((!command.tddArgs?.length || !command.tddReport) && !command.adapter) {
    throw new Error(`Configured command ${commandName} needs tddArgs and a structured tddReport.`);
  }
  if (phase === 'red') {
    for (const name of config.tdd.redPreflightCommands) {
      const preflight = config.commands.find((entry) => entry.name === name)!;
      const execution = await runner(preflight.command, preflight.args, {
        cwd: commandCwd(root, preflight),
        timeoutMs: preflight.timeoutMs,
      });
      if (execution.status !== 'completed' || execution.exitCode !== 0) {
        throw new Error(`TDD Red preflight command ${name} failed with status ${execution.status} and exit code ${execution.exitCode ?? 'none'}.`);
      }
    }
  }
  const trace = await buildTrace(root);
  const test = trace.nodes.find((node) => node.kind === 'test' && node.id === testId);
  if (!test) throw new Error(`Annotated test ID not found: ${testId}`);
  if (!trace.edges.some((edge) => edge.from === testId && edge.to === requirementId && edge.relation === 'verifies')) {
    throw new Error(`${testId} does not verify ${requirementId}.`);
  }
  const currentFingerprint = await testFingerprint(root, test);
  const evidence: TddEvidence = await loadTddEvidence(root) ?? { schemaVersion: 1, cycles: [], chain: [] };
  if (evidence.cycles.some((cycle) =>
    [cycle.red, cycle.green, cycle.refactor].some((item) => item && !Number.isInteger(item.order)))) {
    throw new Error('Existing TDD evidence lacks monotonic order; regenerate it before recording new phases.');
  }
  /* @id CODE-TDD-GREEN-REQUIREMENT-SCOPING-001
   * @implements REQ-TDD-GREEN-REQUIREMENT-SCOPING-001 REQ-TDD-GREEN-REQUIREMENT-SCOPING-002
   * @design DES-TDD-GREEN-REQUIREMENT-SCOPING-001
   */
  // Match a non-Red phase to the pending cycle for this exact (testId,
  // requirementId) pair, not merely the latest cycle for testId: one test ID
  // can have more than one independently pending cycle for different
  // requirement IDs. All validation for the phase runs here, before the test
  // command executes and before appendEvidenceOrder is called below, so a
  // rejection never leaks an order-log entry that could block a later,
  // correctly-matched recording for the same cycle.
  const previous = evidence.cycles
    .filter((cycle) => cycle.testId === testId && cycle.requirementId === requirementId)
    .at(-1);
  if (phase !== 'red') {
    if (!previous) throw new Error(`${phase} must use the same requirement and command as Red.`);
    if (previous.commandName !== commandName) throw new Error(`${phase} must use the same requirement and command as Red.`);
    if (!previous.red.valid) throw new Error(`A valid Red phase is required before ${phase}.`);
    if (previous.red.testFingerprint !== currentFingerprint) throw new Error('The test changed after Red; run the Red phase again.');
    if (phase === 'refactor' && !previous.green?.valid) throw new Error('A valid Green phase is required before Refactor.');
  }
  const adapter = command.adapter ? adapterInvocation(command.adapter, command.name, testId, test.path) : null;
  const reportPath = command.tddReport
    ? render(command.tddReport.path, testId, test.path, '')
    : adapter!.reportPath;
  const reportAbsolute = await safePath(root, reportPath);
  if (adapter) await clearAdapterOutput(adapter, reportAbsolute);
  else if (await exists(reportAbsolute)) await unlink(reportAbsolute);
  const targetedArgs = command.tddArgs
    ? command.tddArgs.map((arg) => render(arg, testId, test.path, reportPath))
    : adapter!.args;
  const configuredArgs = command.args.map((arg) => render(arg, testId, test.path, reportPath));
  const args = command.adapter
    ? mergeAdapterArgs(command.adapter, configuredArgs, targetedArgs)
    : [...configuredArgs, ...targetedArgs];
  const execution = await runner(command.command, args, { cwd: commandCwd(root, command), timeoutMs: command.timeoutMs });
  const output = `${execution.stdout}\n${execution.stderr}`;
  const diagnostics: Diagnostic[] = [];
  let reportText: string | null = null;
  let testStatus: TddPhaseEvidence['testStatus'];
  if (adapter) {
    reportText = await readAdapterOutput(adapter, reportAbsolute, execution.stdout);
  } else if (await exists(reportAbsolute)) {
    reportText = await readText(root, reportPath);
  }
  if (reportText === null) {
    diagnostics.push(error('TDD_REPORT_MISSING', `${testId} did not produce a fresh structured TDD report.`, reportPath));
  }
  if (reportText !== null) {
    try {
      const report = command.tddReport
        ? parseMusubixTestReport(reportText)
        : normalizeAdapterReport(command.adapter!, reportText, testId);
      if (report.tests.length !== 1 || report.tests[0]?.id !== testId) {
        diagnostics.push(error('TDD_REPORT_NOT_SCOPED', `${testId} must be the only test result in the structured report.`, reportPath));
      } else {
        testStatus = report.tests[0].status;
        const expectedStatus = phase === 'red' ? 'failed' : 'passed';
        if (testStatus !== expectedStatus) {
          diagnostics.push(error('TDD_TARGET_RESULT', `${phase} requires ${testId} to report ${expectedStatus}, observed ${testStatus}.`, reportPath));
        }
      }
    } catch (cause) {
      diagnostics.push(error('TDD_REPORT_INVALID', cause instanceof Error ? cause.message : String(cause), reportPath));
    }
  }
  const expectedExit = phase === 'red' ? 'nonzero' : 'zero';
  const exitValid = execution.status === 'completed' && (phase === 'red' ? execution.exitCode !== 0 : execution.exitCode === 0);
  if (!exitValid) diagnostics.push(error('TDD_PHASE_RESULT', `${phase} requires a completed command with ${expectedExit} exit status.`));
  if (!Number.isSafeInteger(execution.durationMs) || execution.durationMs < 0) {
    diagnostics.push(error('TDD_DURATION_INVALID', `${phase} produced an invalid execution duration; archive the invalid evidence and regenerate this cycle from a clean Red baseline.`));
  }
  const currentSourceFingerprint = await sourceFingerprint(root, test.path, [reportPath]);
  if (phase === 'green' && previous?.red.sourceFingerprint === currentSourceFingerprint) {
    diagnostics.push(error('TDD_GREEN_WITHOUT_SOURCE_CHANGE', `${testId} has no non-test project change between Red and Green.`, test.path));
  }
  const cycleId = phase === 'red' ? crypto.randomUUID() : previous?.cycleId;
  if (!cycleId) throw new Error(`A cycle ID is required before recording ${phase}.`);
  const result: TddPhaseEvidence = {
    phase,
    valid: !diagnostics.length,
    scoped: true,
    resultObserved: testStatus === (phase === 'red' ? 'failed' : 'passed'),
    ...(testStatus ? { testStatus } : {}),
    ...(reportText === null ? {} : { reportSha256: digest(reportText) }),
    commandSha256: digest(JSON.stringify([command.command, args])),
    outputSha256: digest(output),
    exitCode: execution.exitCode,
    durationMs: execution.durationMs,
    testFingerprint: currentFingerprint,
    sourceFingerprint: currentSourceFingerprint,
    executionId: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
    diagnostics,
  };
  result.order = (await appendEvidenceOrder(root, {
    kind: 'tdd',
    entityId: cycleId,
    phase,
  })).sequence;
  if (phase === 'red') {
    const cycle: TddCycle = { cycleId, requirementId, testId, testPath: test.path, commandName, red: result };
    evidence.cycles.push(cycle);
    appendChainRecord(evidence, cycle, phase, result);
  } else {
    previous![phase] = result;
    appendChainRecord(evidence, previous!, phase, result);
  }
  await writeJson(root, '.musubix/evidence/tdd.json', evidence);
  return result;
}

export async function validateTddEvidence(root: string): Promise<{
  present: boolean; valid: boolean; diagnostics: Diagnostic[]; cycles: number;
  voided: Array<{ testId: string; cycleId: string; void: { approver: string; reason: string; recordedAt: string } }>;
}> {
  const evidence = await loadTddEvidence(root);
  if (!evidence?.cycles.length) return { present: false, valid: false, diagnostics: [], cycles: 0, voided: [] };
  const diagnostics: Diagnostic[] = [];
  const order = await inspectEvidenceOrder(root);
  diagnostics.push(...order.diagnostics);
  if (!evidence.chain) {
    diagnostics.push(error('TDD_CHAIN_MISSING', 'TDD evidence lacks the append-only hash chain.'));
  } else {
    const records = new Map<string, TddChainRecord>();
    for (const [index, record] of evidence.chain.entries()) {
      const expectedSequence = index + 1;
      const expectedPrevious = index === 0 ? null : evidence.chain[index - 1]!.recordSha256;
      const { recordSha256, ...payload } = record;
      if (record.sequence !== expectedSequence) {
        diagnostics.push(error('TDD_CHAIN_SEQUENCE', `TDD chain record ${record.sequence} is out of order; expected ${expectedSequence}.`));
      }
      if (record.previousSha256 !== expectedPrevious) {
        diagnostics.push(error('TDD_CHAIN_LINK', `TDD chain record ${record.sequence} does not link to the preceding record.`));
      }
      if (recordSha256 !== chainRecordSha256(payload)) {
        diagnostics.push(error('TDD_CHAIN_HASH_MISMATCH', `TDD chain record ${record.sequence} has an invalid SHA-256.`));
      }
      const key = `${record.cycleId}:${record.phase}`;
      if (records.has(key)) diagnostics.push(error('TDD_CHAIN_PHASE_DUPLICATE', `${key} appears more than once in the TDD chain.`));
      records.set(key, record);
    }
    for (const cycle of evidence.cycles) {
      for (const phase of ['red', 'green', 'refactor', 'migrate', 'void'] as const) {
        const phaseEvidence = cycle[phase];
        if (!phaseEvidence) continue;
        const key = `${cycle.cycleId ?? 'missing'}:${phase}`;
        const record = records.get(key);
        if (!record) {
          diagnostics.push(error('TDD_CHAIN_PHASE_MISSING', `${cycle.testId}:${phase} is absent from the TDD hash chain.`, cycle.testPath));
          continue;
        }
        if (record.requirementId !== cycle.requirementId
          || record.testId !== cycle.testId
          || record.testPath !== cycle.testPath
          || record.commandName !== cycle.commandName
          || record.phaseEvidenceSha256 !== digest(JSON.stringify(phaseEvidence))) {
          diagnostics.push(error('TDD_CHAIN_PAYLOAD_MISMATCH', `${cycle.testId}:${phase} does not match its immutable TDD chain record.`, cycle.testPath));
        }
        records.delete(key);
      }
    }
    for (const record of records.values()) {
      diagnostics.push(error('TDD_CHAIN_ORPHAN', `TDD chain record ${record.sequence} has no matching cycle phase.`));
    }
  }
  const latestCycles = new Map<string, TddCycle>();
  for (const cycle of evidence.cycles) latestCycles.set(cycle.testId, cycle);
  /** @id CODE-TDD-SUPERSEDED-CYCLE-SCOPING-001
   * @implements REQ-TDD-SUPERSEDED-CYCLE-SCOPING-001
   */
  const supersededCycles = new Set<TddCycle>();
  {
    const cyclesByTest = new Map<string, TddCycle[]>();
    for (const cycle of evidence.cycles) {
      const list = cyclesByTest.get(cycle.testId);
      if (list) list.push(cycle); else cyclesByTest.set(cycle.testId, [cycle]);
    }
    for (const cycles of cyclesByTest.values()) {
      for (let index = 0; index < cycles.length; index++) {
        if (cycles.slice(index + 1).some((later) => later.red.valid && later.green?.valid)) {
          supersededCycles.add(cycles[index]!);
        }
      }
    }
  }
  /** @id CODE-TDD-CYCLE-VOID-003
   * @implements REQ-TDD-CYCLE-VOID-008, REQ-TDD-CYCLE-VOID-009
   * @design DES-TDD-CYCLE-VOID-003
   */
  const validlyVoidedCycles = new Set<TddCycle>();
  const voided: Array<{ testId: string; cycleId: string; void: { approver: string; reason: string; recordedAt: string } }> = [];
  for (const cycle of evidence.cycles) {
    if (!cycle.void) continue;
    const linkage = voidLinkage(evidence, order, cycle);
    if (linkage.valid) {
      validlyVoidedCycles.add(cycle);
      /** @id CODE-TDD-CYCLE-VOID-005
       * @implements REQ-TDD-CYCLE-VOID-013
       * @design DES-TDD-CYCLE-VOID-007
       * One `voided` entry per validly-voided cycle, keyed by that cycle's
       * own `cycleId`/`testId`, carrying its own `void` payload verbatim.
       */
      voided.push({
        testId: cycle.testId,
        cycleId: cycle.cycleId!,
        void: { approver: cycle.void.approver, reason: cycle.void.reason, recordedAt: cycle.void.recordedAt },
      });
    } else {
      diagnostics.push(error('TDD_VOID_EVIDENCE_MALFORMED', linkage.reason!, cycle.testPath));
    }
  }
  const trace = await buildTrace(root, false);
  for (const requirement of trace.nodes.filter((node) => node.kind === 'requirement' && node.mandatory)) {
    const verifiedTests = trace.edges
      .filter((edge) => edge.relation === 'verifies' && edge.to === requirement.id)
      .map((edge) => edge.from);
    const covered = evidence.cycles.some((cycle) =>
      cycle.requirementId === requirement.id
      && verifiedTests.includes(cycle.testId)
      && cycle.red.valid
      && cycle.green?.valid);
    if (!covered) {
      diagnostics.push(error(
        'TDD_REQUIREMENT_UNCOVERED',
        `${requirement.id} has no valid Red-Green cycle from an authoritative verifying test.`,
        requirement.path,
        requirement.line,
      ));
    }
  }
  for (const cycle of evidence.cycles) {
    for (const phase of ['red', 'green', 'refactor'] as const) {
      const item = cycle[phase];
      if (!item) continue;
      if (!Number.isSafeInteger(item.durationMs) || item.durationMs < 0) {
        diagnostics.push(error('TDD_DURATION_INVALID', `${cycle.testId}:${phase} has an invalid execution duration; archive the invalid evidence and regenerate this cycle from a clean Red baseline.`, cycle.testPath));
      }
      if (!cycle.cycleId || !Number.isInteger(item.order)) {
        diagnostics.push(error('TDD_ORDER_MIGRATION_REQUIRED', `${cycle.testId}:${phase} lacks monotonic order evidence; archive legacy evidence and regenerate the complete cycle instead of editing append-only records.`, cycle.testPath));
        continue;
      }
      const record = evidenceOrderRecord(order.records, 'tdd', cycle.cycleId, phase);
      if (!record || record.sequence !== item.order) {
        diagnostics.push(error('TDD_ORDER_MISMATCH', `${cycle.testId}:${phase} does not match the monotonic evidence order log.`, cycle.testPath));
      }
    }
    if (cycle.green?.order !== undefined && cycle.red.order !== undefined && cycle.green.order <= cycle.red.order) {
      diagnostics.push(error('TDD_ORDER_SEQUENCE', `${cycle.testId}:green is not after Red in monotonic evidence order.`, cycle.testPath));
    }
    if (cycle.refactor?.order !== undefined && cycle.green?.order !== undefined && cycle.refactor.order <= cycle.green.order) {
      diagnostics.push(error('TDD_ORDER_SEQUENCE', `${cycle.testId}:refactor is not after Green in monotonic evidence order.`, cycle.testPath));
    }
    if (cycle.migrate) {
      if (!cycle.cycleId || !Number.isInteger(cycle.migrate.order)) {
        diagnostics.push(error('TDD_ORDER_MIGRATION_REQUIRED', `${cycle.testId}:migrate lacks monotonic order evidence; archive legacy evidence and regenerate the complete cycle instead of editing append-only records.`, cycle.testPath));
      } else {
        const record = evidenceOrderRecord(order.records, 'tdd', cycle.cycleId, 'migrate');
        if (!record || record.sequence !== cycle.migrate.order) {
          diagnostics.push(error('TDD_ORDER_MISMATCH', `${cycle.testId}:migrate does not match the monotonic evidence order log.`, cycle.testPath));
        }
      }
      const latestNonMigrateOrder = cycle.refactor?.valid ? cycle.refactor.order : cycle.green?.order;
      if (cycle.migrate.order !== undefined && latestNonMigrateOrder !== undefined && cycle.migrate.order <= latestNonMigrateOrder) {
        diagnostics.push(error('TDD_ORDER_SEQUENCE', `${cycle.testId}:migrate is not after Green/Refactor in monotonic evidence order.`, cycle.testPath));
      }
      if (!cycle.migrate.approver) {
        diagnostics.push(error('TDD_LEGACY_OR_UNSCOPED_EVIDENCE', `${cycle.testId}:migrate lacks a recorded human approver.`, cycle.testPath));
      }
    }
    if (!supersededCycles.has(cycle) && !validlyVoidedCycles.has(cycle)
      && (!cycle.red.scoped || !cycle.red.resultObserved || cycle.red.testStatus !== 'failed' || !cycle.red.reportSha256 || !cycle.red.sourceFingerprint || !cycle.red.executionId)) {
      diagnostics.push(error('TDD_LEGACY_OR_UNSCOPED_EVIDENCE', `${cycle.testId} lacks test-scoped execution provenance; archive the legacy cycle and regenerate it from a clean Red baseline: move .musubix/evidence/tdd.json aside and re-record every cycle with tdd red/green/refactor. There is no partial prune command; hand-editing the evidence is not supported.`, cycle.testPath));
    }
    if (!supersededCycles.has(cycle) && !validlyVoidedCycles.has(cycle) && !cycle.red.valid) diagnostics.push(error('TDD_RED_MISSING', `${cycle.testId} has no valid failing Red phase; archive it and regenerate the complete cycle by moving .musubix/evidence/tdd.json aside and re-recording every cycle.`, cycle.testPath));
    if (!supersededCycles.has(cycle) && !validlyVoidedCycles.has(cycle) && !cycle.green?.valid) diagnostics.push(error('TDD_GREEN_MISSING', `${cycle.testId} has no valid passing Green phase; archive it and regenerate the complete cycle by moving .musubix/evidence/tdd.json aside and re-recording every cycle.`, cycle.testPath));
    if (cycle.green?.valid) {
      if (!cycle.green.scoped || !cycle.green.resultObserved || cycle.green.testStatus !== 'passed' || !cycle.green.reportSha256 || !cycle.green.sourceFingerprint || !cycle.green.executionId) {
        diagnostics.push(error('TDD_LEGACY_OR_UNSCOPED_EVIDENCE', `${cycle.testId} Green lacks test-scoped execution provenance.`, cycle.testPath));
      }
      const actualLatest = latestCycles.get(cycle.testId);
      // Effective-latest resolution for TDD_TEST_STALE (REQ-TDD-CYCLE-VOID-010)
      // is implemented by the shared `effectiveLatestCycle` helper, annotated
      // as CODE-TDD-CYCLE-VOID-004 above.
      const isStaleTarget = actualLatest === cycle
        || (actualLatest !== undefined && validlyVoidedCycles.has(actualLatest)
          && effectiveLatestCycle(evidence, order, validlyVoidedCycles, cycle.testId, actualLatest) === cycle);
      if (isStaleTarget) {
        const test = trace.nodes.find((node) => node.kind === 'test' && node.id === cycle.testId);
        const current = test ? await testFingerprint(root, test) : undefined;
        const candidates: Array<{ order: number; fingerprint: string }> = [];
        if (cycle.green.order !== undefined) candidates.push({ order: cycle.green.order, fingerprint: cycle.green.testFingerprint });
        if (cycle.refactor?.valid && cycle.refactor.order !== undefined) {
          candidates.push({ order: cycle.refactor.order, fingerprint: cycle.refactor.testFingerprint });
        }
        if (cycle.migrate?.order !== undefined) candidates.push({ order: cycle.migrate.order, fingerprint: cycle.migrate.toFingerprint });
        const latest = candidates.sort((a, b) => b.order - a.order)[0];
        if (latest && current !== latest.fingerprint) diagnostics.push(error('TDD_TEST_STALE', `${cycle.testId} changed after its latest passing TDD phase.`, cycle.testPath));
      }
      if (cycle.red.sourceFingerprint === cycle.green.sourceFingerprint) {
        diagnostics.push(error('TDD_GREEN_WITHOUT_SOURCE_CHANGE', `${cycle.testId} has no non-test project change between Red and Green.`, cycle.testPath));
      }
    }
    if (cycle.green && cycle.green.commandSha256 !== cycle.red.commandSha256) {
      diagnostics.push(error('TDD_COMMAND_CHANGED', `${cycle.testId} used a different command between Red and Green.`, cycle.testPath));
    }
    if (cycle.refactor && cycle.refactor.commandSha256 !== cycle.red.commandSha256) {
      diagnostics.push(error('TDD_COMMAND_CHANGED', `${cycle.testId} used a different command during Refactor.`, cycle.testPath));
    }
    if (cycle.refactor?.valid && (!cycle.refactor.scoped || !cycle.refactor.resultObserved || cycle.refactor.testStatus !== 'passed' || !cycle.refactor.reportSha256 || !cycle.refactor.sourceFingerprint || !cycle.refactor.executionId)) {
      diagnostics.push(error('TDD_LEGACY_OR_UNSCOPED_EVIDENCE', `${cycle.testId} Refactor lacks test-scoped execution provenance.`, cycle.testPath));
    }
  }
  for (const phase of ['red', 'green', 'refactor'] as const) {
    const hashes = new Map<string, TddCycle>();
    for (const cycle of evidence.cycles) {
      const item = cycle[phase];
      if (!item) continue;
      // The structured report names the selected test, so it is the authoritative
      // reuse signal; console output alone collides for quiet runners.
      const key = item.reportSha256 ? `report:${item.reportSha256}` : `output:${item.outputSha256}`;
      const previous = hashes.get(key);
      if (previous && previous.testId !== cycle.testId) {
        diagnostics.push(error(
          'TDD_EVIDENCE_REUSED',
          `${previous.testId} and ${cycle.testId} reuse identical ${phase} ${item.reportSha256 ? 'report' : 'output'} evidence.`,
          cycle.testPath,
        ));
      } else hashes.set(key, cycle);
    }
  }
  return { present: true, valid: !diagnostics.length, diagnostics, cycles: evidence.cycles.length, voided };
}
