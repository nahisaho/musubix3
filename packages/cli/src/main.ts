#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  c4Diagram, validateConstitution, validateDesign, validateRequirements, type Diagnostic,
} from '../../domain/src/index.js';
import {
  buildKnowledge, buildTrace, changedFiles, checkTrace, configLint, cycles, exists, files, formalCheck, graphGate,
  graphImpact, indexGraph, loadConfig, loadGraph, loadTrace, portable, projectStatus, queryKnowledge,
  formalDoctor, generateFormalArtifacts, readText, runGate, traceImpact, type Solver,
  changePhases, recordChangePhase, recordWorkflow, runTddPhase, sanitizeWorkflowLogFile,
  validateTddEvidence, verifyWorkflowLogFile, migrateTddFingerprint, voidTddCycle, type ChangePhase, type TddPhase,
  attestationSigningPayload, createUnsignedAttestation, githubOidcAudience, verifyEvidenceAttestation,
  mutationDoctor, mutationIdentity, validateMutationEvidence, validateModelCorrespondenceEvidence, within,
  approvalManifest, approvalStages, recordApproval, requireApproval,   requireDomainOption, requireValidateDomainOption, resolveDesignFileDomain, resolveNamedDomain,
  validateApprovals, validateApprovalsForDomain, type ApprovalStage,
  scaffoldCommands, scaffoldRequirements, scaffoldDesign,
  recordChangeWaiver,
} from '../../analysis/src/index.js';
import { install, pluginInstall, upgradeSkills } from './install.js';

const packageRoot = fileURLToPath(new URL('../../../../', import.meta.url));

function output(value: unknown, json: boolean, summary?: string): void {
  if (json || !summary) console.log(JSON.stringify(value, null, 2));
  else console.log(summary);
}

function result(value: { valid: boolean; diagnostics: Diagnostic[] }, json: boolean): void {
  output(value, json, `${value.valid ? 'PASS / 合格' : 'FAIL / 不合格'}\n${value.diagnostics.map((d) => `${d.severity} ${d.code}${d.path ? ` ${d.path}${d.line ? `:${d.line}` : ''}` : ''}: ${d.message}`).join('\n')}`.trim());
  if (!value.valid) process.exitCode = 1;
}

function common(command: Command): Command {
  return command.option('--root <directory>', 'Project root / プロジェクトルート', '.').option('--json', 'Machine-readable JSON');
}

function pathQuery(root: string, query: string): string {
  return portable(relative(root, resolve(root, query)));
}

export function createProgram(): Command {
  const program = new Command().name('musubix3').description('Evidence-driven SDD for GitHub Copilot CLI / 根拠に基づく仕様駆動開発').version('0.1.16');
  program.exitOverride();
  common(program.command('init').alias('install').description('Install repository skills and SDD artifacts (preserves existing files)'))
    .option('--dry-run', 'Preview without writing').option('--force', 'Replace bundled, managed paths only')
    .option('--feature <slug>', 'Starter feature directory', 'example')
    .action(async (options: { root: string; json?: boolean; dryRun?: boolean; force?: boolean; feature: string }) => {
      const report = await install(resolve(options.root), packageRoot, options);
      output(report, !!options.json, report.actions.map((a) => `${a.action.padEnd(10)} ${a.path}`).join('\n'));
    });
  common(program.command('upgrade').description('Refresh bundled skill files to match the installed musubix3 version; never touches config, constitution, or feature artifacts'))
    .option('--dry-run', 'Preview without writing')
    .action(async (options: { root: string; json?: boolean; dryRun?: boolean }) => {
      const report = await upgradeSkills(resolve(options.root), packageRoot, options);
      output(report, !!options.json, report.actions.map((a) => `${a.action.padEnd(10)} ${a.path}`).join('\n'));
    });
  program.command('plugin-install').description('Delegate plugin installation to native copilot plugin install')
    .option('--json').action(async (options: { json?: boolean }) => {
      const report = await pluginInstall(packageRoot);
      output(report, !!options.json, `${report.status}: ${report.stdout}${report.stderr}`);
      if (report.status !== 'completed' || report.exitCode !== 0) process.exitCode = 1;
    });

  const requirements = program.command('requirements').description('EARS requirement validation');
  common(requirements.command('validate <file>')).action(async (file: string, options: { root: string; json?: boolean }) => {
    const root = resolve(options.root);
    result(validateRequirements(await readText(root, file), portable(relative(root, resolve(root, file)))), !!options.json);
  });
  common(requirements.command('scaffold <slug>')).option('--title <text>', 'Placeholder entry heading title')
    .action(async (slug: string, options: { root: string; json?: boolean; title?: string }) => {
      const path = await scaffoldRequirements(resolve(options.root), slug, options.title === undefined ? {} : { title: options.title });
      output({ path }, !!options.json, `Created ${path}`);
    });
  const constitution = program.command('constitution').description('Versioned measurable policy validation');
  common(constitution.command('validate [file]')).action(async (file: string | undefined, options: { root: string; json?: boolean }) => {
    const path = file ?? '.musubix/constitution.md';
    result(validateConstitution(await readText(resolve(options.root), path), path), !!options.json);
  });
  const design = program.command('design').description('Explicit design component validation and diagrams');
  async function designResult(file: string, root: string): Promise<ReturnType<typeof validateDesign>> {
    const paths = await files(root);
    const ids = new Set<string>();
    for (const path of paths.filter((p) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(p))) {
      for (const requirement of validateRequirements(await readText(root, path)).value) ids.add(requirement.id);
    }
    const designIds = new Set<string>();
    for (const path of paths.filter((p) => /^\.musubix\/features\/[^/]+\/design\.md$/.test(p))) {
      for (const component of validateDesign(await readText(root, path)).value) designIds.add(component.id);
    }
    const text = await readText(root, file);
    for (const component of validateDesign(text).value) designIds.add(component.id);
    return validateDesign(text, file, {
      requirementIds: ids,
      designIds,
      adrIds: new Set(paths.filter((p) => /^\.musubix\/decisions\/ADR-\d+\.md$/.test(p)).map((p) => basename(p, '.md'))),
    });
  }
  common(design.command('validate <file>')).action(async (file: string, options: { root: string; json?: boolean }) => {
    const root = resolve(options.root);
    if (await exists(within(root, '.musubix/config.json'))) {
      const config = await loadConfig(root);
      const domain = await resolveDesignFileDomain(root, config.approval, portable(relative(root, resolve(root, file))));
      await requireApproval(root, 'requirements', config.approval, domain);
    }
    result(await designResult(file, root), !!options.json);
  });
  common(design.command('c4 <file>')).action(async (file: string, options: { root: string; json?: boolean }) => {
    const root = resolve(options.root);
    if (await exists(within(root, '.musubix/config.json'))) {
      const config = await loadConfig(root);
      const domain = await resolveDesignFileDomain(root, config.approval, portable(relative(root, resolve(root, file))));
      await requireApproval(root, 'requirements', config.approval, domain);
    }
    const report = await designResult(file, root);
    if (!report.valid) { result(report, !!options.json); return; }
    const diagram = c4Diagram(report.value);
    output({ diagram }, !!options.json, diagram);
  });
  common(design.command('scaffold <slug>')).action(async (slug: string, options: { root: string; json?: boolean }) => {
    const path = await scaffoldDesign(resolve(options.root), slug);
    output({ path }, !!options.json, `Created ${path}`);
  });

  const trace = program.command('trace').description('Generated requirement/design/code/test traceability');
  common(trace.command('build')).action(async (options: { root: string; json?: boolean }) => {
    const graph = await buildTrace(resolve(options.root));
    output(graph, !!options.json, `Trace: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graph.diagnostics.length} diagnostics.`);
    if (graph.diagnostics.some((d) => d.severity === 'error')) process.exitCode = 1;
  });
  common(trace.command('check')).option('--strict', 'Fail missing mandatory coverage')
    .action(async (options: { root: string; json?: boolean; strict?: boolean }) => {
      const root = resolve(options.root);
      result(await checkTrace(root, await loadTrace(root), !!options.strict), !!options.json);
    });
  common(trace.command('impact <id-or-path>')).action(async (query: string, options: { root: string; json?: boolean }) => {
    const root = resolve(options.root);
    const graph = await loadTrace(root);
    const freshness = await checkTrace(root, graph);
    const stale = freshness.diagnostics.some((d) => d.code.startsWith('TRACE_STALE'));
    if (stale) throw new Error('Trace graph is stale; run trace build before impact analysis.');
    const resolvedQuery = graph.nodes.some((n) => n.id === query) ? query : pathQuery(root, query);
    const impact = traceImpact(graph, resolvedQuery);
    /** @id CODE-CLI-WORKFLOW-UX-002
     * @implements REQ-CLI-WORKFLOW-UX-002
     * @design DES-CLI-WORKFLOW-UX-002
     */
    const summary = `bidirectional candidate-review range from ${resolvedQuery} (${impact.length} node(s)); not a list of required changes:\n`
      + impact.map((i) => `${i.id}`).join('\n');
    output(impact, !!options.json, summary);
  });

  const graph = program.command('graph').description('Compiler-based imports, symbols, calls and architecture');
  common(graph.command('index')).option('--changed', 'Report changed files; conservatively refresh full graph')
    .action(async (options: { root: string; json?: boolean; changed?: boolean }) => {
      const root = resolve(options.root);
      const changed = options.changed ? await changedFiles(root) : null;
      const indexed = await indexGraph(root);
      output({ ...indexed, changed }, !!options.json, `Graph: ${indexed.files.length} files, ${indexed.imports.length} imports, ${indexed.symbols.length} symbols.`);
      if (indexed.diagnostics.some((d) => d.severity === 'error')) process.exitCode = 1;
    });
  common(graph.command('impact <symbol-or-path>')).action(async (query: string, options: { root: string; json?: boolean }) => {
    const root = resolve(options.root);
    const indexed = await loadGraph(root);
    const normalized = indexed.files.includes(pathQuery(root, query)) ? pathQuery(root, query) : query;
    output(graphImpact(indexed, normalized), !!options.json);
  });
  common(graph.command('cycles')).action(async (options: { root: string; json?: boolean }) => {
    const found = cycles(await loadGraph(resolve(options.root)));
    output({ cycles: found }, !!options.json);
    if (found.length) process.exitCode = 1;
  });
  common(graph.command('gate')).action(async (options: { root: string; json?: boolean }) => {
    const root = resolve(options.root);
    const config = await loadConfig(root);
    result(graphGate(await indexGraph(root), config.architecture, config.codeGraph), !!options.json);
  });

  const knowledge = program.command('knowledge').description('Local artifact and Git evidence retrieval (TF-IDF, not GraphRAG)');
  common(knowledge.command('build')).action(async (options: { root: string; json?: boolean }) => {
    const index = await buildKnowledge(resolve(options.root));
    output(index, !!options.json, `Knowledge: ${index.documents.length} documents; git ${index.git.status}.`);
  });
  common(knowledge.command('query <text...>')).option('--limit <count>', 'Maximum results', '10')
    .action(async (query: string[], options: { root: string; json?: boolean; limit: string }) => {
      const limit = Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('--limit must be 1..100.');
      output(await queryKnowledge(resolve(options.root), query.join(' '), limit), !!options.json);
    });
  const formal = program.command('formal').description('Honest consistency checking of an explicit abstraction');
  common(formal.command('check <file>'))
    .option('--solver <solver>', 'auto | none | z3 | lean', 'auto')
    .option('--timeout <milliseconds>', 'Solver timeout', '12000')
    .option('--z3-command <path>', 'Z3 executable path (or MUSUBIX3_Z3)')
    .option('--lean-command <path>', 'Lean executable path (or MUSUBIX3_LEAN)')
    .action(async (file: string, options: {
      root: string; json?: boolean; solver: string; timeout: string; z3Command?: string; leanCommand?: string;
    }) => {
      if (!['auto', 'none', 'z3', 'lean'].includes(options.solver)) throw new Error('Unknown solver; use auto, none, z3, or lean.');
      const timeoutMs = Number(options.timeout);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error('--timeout must be 100..300000 milliseconds.');
      const root = resolve(options.root);
      const report = await formalCheck(await readText(root, file), root, {
        solver: options.solver as Solver,
        timeoutMs,
        ...(options.z3Command ? { z3Command: options.z3Command } : {}),
        ...(options.leanCommand ? { leanCommand: options.leanCommand } : {}),
      });
      output(report, !!options.json);
      if (!report.valid) process.exitCode = 1;
    });
  common(formal.command('generate <file>'))
    .option('--format <format>', 'both | smt2 | lean', 'both')
    .action(async (file: string, options: { root: string; json?: boolean; format: string }) => {
      if (!['both', 'smt2', 'lean'].includes(options.format)) throw new Error('Unknown format; use both, smt2, or lean.');
      const root = resolve(options.root);
      const formats = options.format === 'both' ? ['smt2', 'lean'] as const : [options.format as 'smt2' | 'lean'];
      const report = await generateFormalArtifacts(await readText(root, file), root, [...formats]);
      output(report, !!options.json, report.artifacts.map((entry) => `${entry.format}: ${entry.path}`).join('\n'));
      if (!report.valid) process.exitCode = 1;
    });
  common(formal.command('doctor'))
    .option('--timeout <milliseconds>', 'Probe timeout', '5000')
    .option('--z3-command <path>', 'Z3 executable path (or MUSUBIX3_Z3)')
    .option('--lean-command <path>', 'Lean executable path (or MUSUBIX3_LEAN)')
    .action(async (options: {
      root: string; json?: boolean; timeout: string; z3Command?: string; leanCommand?: string;
    }) => {
      const timeoutMs = Number(options.timeout);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) throw new Error('--timeout must be 100..300000 milliseconds.');
      const report = await formalDoctor(resolve(options.root), {
        timeoutMs,
        ...(options.z3Command ? { z3Command: options.z3Command } : {}),
        ...(options.leanCommand ? { leanCommand: options.leanCommand } : {}),
      });
      output(report, !!options.json, report.solvers.map((entry) =>
        `${entry.name}: ${entry.status}${entry.version ? ` (${entry.version})` : ''}`
        + `\n  attempted: ${entry.attemptedCommands.join(', ')}`
        + `\n  ${entry.recommendation}`).join('\n'));
    });
  async function executeGate(options: { root: string; json?: boolean; changed?: boolean; feature?: string }): Promise<void> {
    const report = await runGate(resolve(options.root), options);
    const scopeNote = report.mode === 'feature' ? ` [feature-scoped: ${report.feature}; not the repository-wide gate]` : '';
    output(report, !!options.json, `${report.status.toUpperCase()}${scopeNote}\n${report.checks.map((c) => `${c.status.padEnd(7)} ${c.name}${c.required ? ' [required]' : ' [optional]'}: ${c.summary}`).join('\n')}`);
    if (report.status !== 'pass') process.exitCode = 1;
  }
  common(program.command('gate').description('Run actual configured commands and deterministic SDD checks'))
    .option('--changed', 'Report changed/impacted files; keep all checks to avoid unsafe skips')
    .option('--feature <name>', 'Restrict requirements/design/trace/tdd/change checks to one feature; diagnostic view only, not a substitute for the repository-wide gate')
    .action(executeGate);
  const config = program.command('config').description('Inspect and validate .musubix/config.json');
  common(config.command('lint')).description('Report configured commands whose args reference nonexistent repository paths')
    .action(async (options: { root: string; json?: boolean }) => {
      result(await configLint(resolve(options.root)), !!options.json);
    });
  common(config.command('scaffold')).description('Propose native test-command entries for detected toolchains; never writes config.json')
    .action(async (options: { root: string; json?: boolean }) => {
      const proposals = await scaffoldCommands(resolve(options.root));
      output(
        proposals,
        !!options.json,
        proposals.length
          ? proposals.map((p) => `${p.toolchain} (${p.manifest}): ${p.name} -> ${p.command} ${p.args.join(' ')}`.trim()).join('\n')
          : 'No supported toolchain manifests detected.',
      );
    });
  const evidence = program.command('evidence').description('Refresh derived evidence in deterministic gate order');
  common(evidence.command('refresh'))
    .option('--changed', 'Preserve changed-file impact context while refreshing all checks')
    .action(executeGate);
  const mutation = program.command('mutation').description('Inspect and validate requirement-scoped mutation evidence');
  common(mutation.command('doctor')).action(async (options: { root: string; json?: boolean }) => {
    const report = await mutationDoctor(resolve(options.root));
    output(report, !!options.json, report.engines.length
      ? report.engines.map((entry) =>
        `${entry.ecosystem}/${entry.engine}: ${entry.status}`
        + `\n  attempted: ${entry.attemptedCommands.join(', ')}`
        + `\n  ${entry.recommendation}`).join('\n')
      : 'No supported project ecosystem was detected.');
  });
  common(mutation.command('validate')).action(async (options: { root: string; json?: boolean }) => {
    const report = await validateMutationEvidence(resolve(options.root));
    if (!options.json && !report.present) {
      console.log('No mutation evidence at .musubix/evidence/mutation.json; the gate converts a configured mutationReport into that file. Compatible mode does not require it.');
    }
    result(report, !!options.json);
  });
  common(mutation.command('identity <requirementId> <testId> <sourcePath> <operator> <line> <column>')
    .description('Compute the deterministic MUT-* identity a mutation report must declare'))
    .action((requirementId: string, testId: string, sourcePath: string, operator: string, line: string, column: string, options: { json?: boolean }) => {
      const location = { line: Number(line), column: Number(column) };
      if (!Number.isInteger(location.line) || location.line < 1 || !Number.isInteger(location.column) || location.column < 1) {
        throw new Error('line and column must be one-based positive integers.');
      }
      const id = mutationIdentity({ requirementId, testId, sourcePath, operator, location });
      output({ id, requirementId, testId, sourcePath, operator, location }, !!options.json, id);
    });
  const correspondence = program.command('model-correspondence')
    .description('Validate formal-model to authoritative passing-test correspondence');
  common(
    correspondence.command('validate')
      /* @id CODE-MODEL-CORRESPONDENCE-EVIDENCE-GUIDANCE-002 */
      .description('Validate model correspondence evidence (run `npx musubix3 evidence refresh` first to generate .musubix/evidence/model-correspondence.json)'),
  ).action(async (options: { root: string; json?: boolean }) => {
    const report = await validateModelCorrespondenceEvidence(resolve(options.root));
    result(report, !!options.json);
  });
  common(program.command('workflow-record <skill> <phase>').description('Record a self-reported workflow declaration'))
    .requiredOption('--status <status>', 'completed | skipped | failed')
    .option('--reason <text>', 'Reason for skipped or failed phases')
    .option('--command <text>', 'Command to hash without storing its contents')
    .action(async (skill: string, phase: string, options: {
      root: string; json?: boolean; status: string; reason?: string; command?: string;
    }) => {
      if (!['completed', 'skipped', 'failed'].includes(options.status)) throw new Error('--status must be completed, skipped, or failed.');
      const manifest = await recordWorkflow(resolve(options.root), {
        skill,
        phase,
        status: options.status as 'completed' | 'skipped' | 'failed',
        ...(options.reason ? { reason: options.reason } : {}),
        ...(options.command ? { command: options.command } : {}),
      });
      output(manifest, !!options.json, `Recorded ${skill}:${phase} as ${options.status}.`);
    });
  common(program.command('workflow-verify <log...>').description('Reconcile workflow declarations with Copilot JSONL Skill events'))
    .option('--strict', 'Require a complete Copilot JSONL transcript and successful terminal result')
    .option('--session-id <uuid>', 'Require the terminal result to identify this Copilot session')
    .action(async (logs: string[], options: { root: string; json?: boolean; strict?: boolean; sessionId?: string }) => {
      const root = resolve(options.root);
      const paths = logs.map((log) => resolve(log));
      for (const path of paths) {
        const info = await stat(path);
        if (!info.isFile()) throw new Error('Workflow log must be a file.');
      }
      const configured = (await loadConfig(root)).workflow;
      const mode = options.strict || options.sessionId ? 'strict' : configured.mode;
      const expectedSessionId = options.sessionId ?? configured.expectedSessionId;
      const manifest = await verifyWorkflowLogFile(root, paths.length === 1 ? paths[0]! : paths, {
        mode,
        ...(expectedSessionId ? { expectedSessionId } : {}),
        ...(configured.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: configured.maxAgeSeconds }),
        ...(configured.maxFutureSkewSeconds === undefined
          ? {}
          : { maxFutureSkewSeconds: configured.maxFutureSkewSeconds }),
        ...(configured.maxEventSkewMs === undefined ? {} : { maxEventSkewMs: configured.maxEventSkewMs }),
        ...(configured.maxTranscriptBytes === undefined ? {} : { maxBytes: configured.maxTranscriptBytes }),
        ...(configured.maxTranscriptLineBytes === undefined ? {} : { maxLineBytes: configured.maxTranscriptLineBytes }),
      });
      output(
        manifest,
        !!options.json,
        `Verified ${manifest.verification?.invocations.length ?? 0} Copilot Skill invocation event(s)`
          + `${manifest.verification?.sessionId ? ` in session ${manifest.verification.sessionId}` : ''}.`,
      );
    });
  common(program.command('workflow-sanitize <log> <output-file>').description('Write a privacy-minimized Skill lifecycle transcript'))
    .option('--session-id <uuid>', 'Replace the terminal session ID with a review-safe UUID')
    .action(async (log: string, outputFile: string, options: {
      root: string; json?: boolean; sessionId?: string;
    }) => {
      const root = resolve(options.root);
      const path = resolve(log);
      const info = await stat(path);
      if (!info.isFile()) throw new Error('Workflow log must be a file.');
      const configured = (await loadConfig(root)).workflow;
      const report = await sanitizeWorkflowLogFile(
        root,
        path,
        outputFile,
        options.sessionId,
        configured.maxEventSkewMs,
        configured.maxTranscriptBytes,
        configured.maxTranscriptLineBytes,
      );
      output(
        report,
        !!options.json,
        `Sanitized ${report.inputEvents} event(s) to ${report.outputEvents}; retained ${report.skillInvocations} Skill invocation(s).`,
      );
    });
  const attestation = program.command('attestation').description('Create and verify static-key or GitHub OIDC-authorized Ed25519 attestations');
  common(attestation.command('oidc-audience'))
    .requiredOption('--key-id <id>', 'Attestation signing-key identity')
    .option('--public-key-file <file>', 'Ephemeral Ed25519 public key PEM for public-key binding')
    .action(async (options: { root: string; json?: boolean; keyId: string; publicKeyFile?: string }) => {
      const root = resolve(options.root);
      const oidc = (await loadConfig(root)).attestation.githubOidc;
      if (oidc?.mode !== 'strict' || !oidc.audience) throw new Error('Strict GitHub OIDC attestation is not configured.');
      if (oidc.keyBinding === 'key-id' && options.publicKeyFile) {
        throw new Error('OIDC key-id binding must not use --public-key-file.');
      }
      const publicKey = options.publicKeyFile
        ? await readFile(resolve(root, options.publicKeyFile), 'utf8')
        : undefined;
      const audience = githubOidcAudience(oidc.audience, oidc.keyBinding ?? 'public-key', options.keyId, publicKey);
      output({ audience, keyBinding: oidc.keyBinding ?? 'public-key' }, !!options.json, audience);
    });
  common(attestation.command('payload'))
    .requiredOption('--provider <provider>', 'github | azure-pipelines | generic')
    .requiredOption('--run-id <id>', 'CI run identity')
    .requiredOption('--key-id <id>', 'Attestation signing-key identity')
    .option('--public-key-file <file>', 'Ephemeral Ed25519 public key PEM (never a private key)')
    .option('--github-oidc-token-file <file>', 'GitHub Actions OIDC JWT file')
    .action(async (options: {
      root: string;
      json?: boolean;
      provider: string;
      runId: string;
      keyId: string;
      publicKeyFile?: string;
      githubOidcTokenFile?: string;
    }) => {
      if (!['github', 'azure-pipelines', 'generic'].includes(options.provider)) throw new Error('Unknown attestation provider.');
      const root = resolve(options.root);
      const configured = (await loadConfig(root)).attestation.githubOidc;
      if (configured?.mode === 'strict' && options.provider !== 'github') {
        throw new Error('Strict GitHub OIDC attestation requires --provider github.');
      }
      if (configured?.mode === 'strict' && !options.githubOidcTokenFile) {
        throw new Error('Strict GitHub OIDC attestation requires --github-oidc-token-file.');
      }
      if (configured?.mode === 'strict' && (configured.keyBinding ?? 'public-key') === 'public-key' && !options.publicKeyFile) {
        throw new Error('OIDC public-key binding requires --public-key-file.');
      }
      if (configured?.mode === 'strict' && configured.keyBinding === 'key-id' && options.publicKeyFile) {
        throw new Error('OIDC key-id binding must not use --public-key-file.');
      }
      const publicKey = options.publicKeyFile
        ? await readFile(resolve(root, options.publicKeyFile), 'utf8')
        : undefined;
      const token = options.githubOidcTokenFile
        ? (await readFile(resolve(root, options.githubOidcTokenFile), 'utf8')).trim()
        : undefined;
      if (configured?.mode === 'strict') {
        githubOidcAudience(
          configured.audience!,
          configured.keyBinding ?? 'public-key',
          options.keyId,
          publicKey,
        );
      }
      const unsigned = await createUnsignedAttestation(root, {
        provider: options.provider as 'github' | 'azure-pipelines' | 'generic',
        runId: options.runId,
        keyId: options.keyId,
        ...(token ? { githubOidc: { token, ...(publicKey ? { publicKey } : {}) } } : {}),
      });
      output({ unsigned, signingPayload: attestationSigningPayload(unsigned) }, !!options.json, attestationSigningPayload(unsigned));
    });
  common(attestation.command('verify')).action(async (options: { root: string; json?: boolean }) => {
    const root = resolve(options.root);
    const report = await verifyEvidenceAttestation(root, (await loadConfig(root)).attestation);
    output(report, !!options.json, `${report.status}: ${report.valid ? 'valid' : 'invalid'}`);
    if (!report.valid) process.exitCode = 1;
  });
  common(program.command('change-record <change-id> <phase>')
    .description('Record an ordered staged-change fingerprint checkpoint; rejects an unchanged fingerprint since the preceding phase'))
    .requiredOption('--requirement <ids...>', 'Requirement IDs affected by this change')
    .option('--allow-unchanged', 'Record requirements even if unchanged since impact (defect fixes only)')
    .option('--dry-run', 'Preview the outcome without recording it')
    .action(async (changeId: string, phase: string, options: {
      root: string; json?: boolean; requirement: string[]; allowUnchanged?: boolean; dryRun?: boolean;
    }) => {
      if (!changePhases.includes(phase as ChangePhase)) throw new Error(`phase must be one of: ${changePhases.join(', ')}`);
      /** @id CODE-CHANGE-RECORD-FAIL-FAST-002
       * @implements REQ-CHANGE-RECORD-FAIL-FAST-007 REQ-CHANGE-RECORD-FAIL-FAST-009 REQ-CHANGE-RECORD-FAIL-FAST-010
       * @design DES-CHANGE-RECORD-FAIL-FAST-003 DES-CHANGE-RECORD-FAIL-FAST-004 DES-CHANGE-RECORD-FAIL-FAST-005
       */
      const changeOptions: { allowUnchanged?: boolean; dryRun?: boolean } = {};
      if (options.allowUnchanged !== undefined) changeOptions.allowUnchanged = options.allowUnchanged;
      if (options.dryRun !== undefined) changeOptions.dryRun = options.dryRun;
      const evidence = await recordChangePhase(resolve(options.root), changeId, phase as ChangePhase, options.requirement, changeOptions);
      output(evidence, !!options.json, options.dryRun ? `Would record ${changeId}:${phase}.` : `Recorded ${changeId}:${phase}.`);
    });
  const change = program.command('change').description('Change chronology and waiver evidence');
  const waiver = change.command('waiver').description('Record an audited, bounded downgrade of a recording-order-debt diagnostic');
  common(waiver.command('record <change-id> <code>')
    .description('Downgrade one currently-present waivable diagnostic from error to warning, as an appended, hash-chained record'))
    .option('--requirement <req-id>', 'Requirement ID this waiver applies to (required for requirement-scoped codes)')
    .option('--detail <value>', 'Structured detail scope this waiver applies to (required for detail-scoped codes)')
    .requiredOption('--approver <name>', 'Human approver recording this waiver')
    .requiredOption('--reason <text>', 'Reason this diagnostic is being waived')
    .option('--confirm', 'Confirm the waiver is reviewed and intended', false)
    .action(async (changeId: string, code: string, options: {
      root: string; json?: boolean; requirement?: string; detail?: string; approver: string; reason: string; confirm?: boolean;
    }) => {
      if (!options.confirm) throw new Error('Recording a change waiver requires --confirm.');
      const result = await recordChangeWaiver(resolve(options.root), changeId, code, options.requirement, options.detail, options.approver, options.reason);
      output(result, !!options.json, `WAIVER: PASS (${changeId}:${code}${options.requirement ? `:${options.requirement}` : ''}${options.detail ? `:${options.detail}` : ''})`);
    });
  const approval = program.command('approval').description('Prepare, record and validate explicit artifact-bound human approvals');
  common(approval.command('prepare <stage>').description('Show the exact artifact manifest a human must review'))
    .option('--domain <name>', 'Approval domain (required when approval.domains is configured, except for release)')
    .action(async (stage: string, options: { root: string; json?: boolean; domain?: string }) => {
      if (!approvalStages.includes(stage as ApprovalStage)) throw new Error(`stage must be one of: ${approvalStages.join(', ')}`);
      const root = resolve(options.root);
      const config = await loadConfig(root);
      requireDomainOption(config.approval, stage as ApprovalStage, options.domain);
      const domain = options.domain ? await resolveNamedDomain(root, config.approval, options.domain) : undefined;
      const manifest = await approvalManifest(root, stage as ApprovalStage, domain);
      output(manifest, !!options.json, `${stage} artifact manifest: ${manifest.artifactSha256}\n${Object.keys(manifest.artifacts).join('\n')}`);
    });
  common(approval.command('record <stage>'))
    .requiredOption('--approver <name>', 'Human approver name')
    .requiredOption('--artifact-sha256 <hash>', 'Exact manifest SHA-256 shown to and approved by the human')
    .requiredOption('--confirm', 'Explicitly confirm this human approval')
    .option('--domain <name>', 'Approval domain (required when approval.domains is configured, except for release)')
    .action(async (stage: string, options: {
      root: string; json?: boolean; approver: string; artifactSha256: string; confirm: boolean; domain?: string;
    }) => {
      if (!approvalStages.includes(stage as ApprovalStage)) {
        throw new Error(`stage must be one of: ${approvalStages.join(', ')}`);
      }
      if (options.confirm !== true) throw new Error('--confirm is required to record human approval.');
      const root = resolve(options.root);
      const config = await loadConfig(root);
      const evidence = await recordApproval(root, stage as ApprovalStage, options.approver, options.artifactSha256, config.approval, options.domain);
      output(evidence, !!options.json, `Recorded explicit ${stage} approval by ${evidence.approver} for ${evidence.artifactSha256}.`);
    });
  common(approval.command('validate'))
    .option('--domain <name>', 'Limit the report to one approval domain')
    .action(async (options: { root: string; json?: boolean; domain?: string }) => {
      const root = resolve(options.root);
      const config = await loadConfig(root);
      requireValidateDomainOption(config.approval, options.domain);
      const report = options.domain
        ? await validateApprovalsForDomain(root, config.approval, options.domain)
        : await validateApprovals(root, config.approval);
      const stages = report.domains ? [...report.domains.flatMap((d) => d.stages), ...(report.release ? [report.release] : [])] : report.stages;
      output(
        report,
        !!options.json,
        stages.map((stage) => `${stage.status.toUpperCase()} ${stage.stage}${stage.domain ? ` [${stage.domain}]` : ''}${stage.required ? ' [required]' : ''}`).join('\n'),
      );
      if (!report.valid) process.exitCode = 1;
    });
  const tdd = program.command('tdd').description(
    'Verified Red-Green-Refactor execution evidence. <test-id> requires two independent things: '
    + 'a trace-graph @id/@verifies doc comment above the test (for requirement linking), and a '
    + "matching native adapter report entry (adapter-specific: title substring for vitest/jest/pytest, "
    + "name suffix for go-test/cargo, an additional @Tag for junit, DisplayName for dotnet). "
    + 'See README.md "Adapter test-ID declaration reference" for the full table and worked examples.',
  );
  common(tdd.command('validate')).action(async (options: { root: string; json?: boolean }) => {
    const report = await validateTddEvidence(resolve(options.root));
    result(report, !!options.json);
  });
  for (const phase of ['red', 'green', 'refactor'] as const) {
    common(tdd.command(`${phase} <test-id>`))
      .requiredOption('--requirement <id>', 'Requirement ID verified by the test')
      .requiredOption('--command <name>', 'Configured command name to execute')
      .action(async (testId: string, options: {
        root: string; json?: boolean; requirement: string; command: string;
      }) => {
        const evidence = await runTddPhase(
          resolve(options.root),
          phase as TddPhase,
          testId,
          options.requirement,
          options.command,
        );
        output(evidence, !!options.json, `${phase.toUpperCase()}: ${evidence.valid ? 'PASS' : 'FAIL'} (${testId})`);
        if (!evidence.valid) process.exitCode = 1;
      });
  }
  common(tdd.command('migrate <test-id>'))
    .requiredOption('--approver <name>', 'Human approver recording this fingerprint migration')
    .option('--confirm', 'Confirm the migration is reviewed and intended', false)
    .action(async (testId: string, options: { root: string; json?: boolean; approver: string; confirm?: boolean }) => {
      if (!options.confirm) throw new Error('Fingerprint migration requires --confirm.');
      const root = resolve(options.root);
      const migration = await migrateTddFingerprint(root, testId, options.approver);
      output(
        migration,
        !!options.json,
        migration.migrated
          ? `MIGRATE: PASS (${testId}) ${migration.fromFingerprint} -> ${migration.toFingerprint}`
          : `MIGRATE: FAIL (${testId}) ${migration.reason}`,
      );
      if (!migration.migrated) process.exitCode = 1;
    });
  common(tdd.command('void <test-id>'))
    .requiredOption('--approver <name>', 'Human approver recording this void')
    .requiredOption('--reason <text>', 'Reason this dangling TDD cycle is being voided')
    .option('--confirm', 'Confirm the void is reviewed and intended', false)
    .action(async (testId: string, options: { root: string; json?: boolean; approver: string; reason: string; confirm?: boolean }) => {
      if (!options.confirm) throw new Error('Voiding a TDD cycle requires --confirm.');
      const root = resolve(options.root);
      const voidResult = await voidTddCycle(root, testId, options.approver, options.reason);
      output(
        voidResult,
        !!options.json,
        voidResult.voided
          ? `VOID: PASS (${testId}) cycle=${voidResult.cycleId}`
          : `VOID: FAIL (${testId}) ${voidResult.reason}`,
      );
      if (!voidResult.voided) process.exitCode = 1;
    });
  common(program.command('status').description('One-shot artifact and gate readiness summary'))
    .action(async (options: { root: string; json?: boolean }) => {
      const status = await projectStatus(resolve(options.root));
      const approvalSummary = status.approvals
        ? status.approvals.stages.map((stage) => `${stage.stage}=${stage.status}`).join(', ')
        : 'unconfigured';
      output(status, !!options.json, `SDD: ${status.initialized ? 'initialized / 初期化済み' : 'not initialized / 未初期化'}\nRequirement files: ${status.artifacts.requirements}; design files: ${status.artifacts.designs}; ADRs: ${status.artifacts.decisions}\nCode Graph: ${status.codeGraph?.mode ?? 'unconfigured'}\nApprovals: ${approvalSummary}\nGate: ${status.gate.status}; ready: ${status.gate.ready}\n${status.next.join('\n')}`);
    });
  return program;
}

async function main(): Promise<void> {
  try {
    await createProgram().parseAsync(process.argv);
  } catch (cause) {
    if (cause instanceof CommanderError && cause.exitCode === 0) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    if (process.argv.includes('--json')) console.log(JSON.stringify({ error: { code: 'CLI_ERROR', message } }));
    else console.error(`musubix3: ${message}`);
    process.exitCode = 2;
  }
}

await main();
import { readFile, stat } from 'node:fs/promises';
