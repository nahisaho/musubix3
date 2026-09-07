import { describe, expect, it, vi } from 'vitest';
import {
  buildKnowledge, formalCheck, formalDoctor, generateFormalArtifacts, generateLean, generateSmt2,
  queryKnowledge, rankDocuments, readText, tokenize, writeText,
  type KnowledgeDocument, type Runner,
} from '../packages/analysis/src/index.js';
import { fixture, missingRunner, processResult, req } from './helpers.js';

describe('honest formal abstraction', () => {
  it('detects normalized opposing obligations without a solver', async () => {
    const runner = vi.fn(missingRunner);
    const report = await formalCheck(req('The system shall store data.') + req('The SYSTEM shall not STORE data.', 'REQ-EXAMPLE-002'), await fixture(), 'none', runner);
    expect(report.valid).toBe(false);
    expect(report.consistency).toBe('inconsistent');
    expect(report.diagnostics.some((d) => d.code === 'FORMAL_CONTRADICTION')).toBe(true);
    expect(runner).not.toHaveBeenCalled();
    expect(report.solver.status).toBe('not-requested');
  });

  it('lists unsupported semantics and returns unknown for an empty abstraction', async () => {
    const report = await formalCheck(req('When an event occurs, the system shall respond.') + req('The system shall respond within 5 seconds.', 'REQ-EXAMPLE-002'), await fixture(), 'none');
    expect(report.unsupported).toEqual(['REQ-EXAMPLE-001', 'REQ-EXAMPLE-002']);
    expect(report.consistency).toBe('unknown');
    expect(report.valid).toBe(false);
    expect(report.abstraction).toContain('not implementation correctness');
  });

  it('does not equate different subjects or responses', async () => {
    const report = await formalCheck(req('The worker shall store data.') + req('The service shall not store data.', 'REQ-EXAMPLE-002'), await fixture(), 'none');
    expect(report.consistency).toBe('consistent');
    expect(report.valid).toBe(true);
  });

  it('models Japanese unconditional obligations and prohibitions', async () => {
    const positive = `## REQ-JA-001: 保存
Priority: must
Pattern: ubiquitous
Statement: システムはデータを保存しなければならない。
`;
    const negative = `## REQ-JA-002: 保存禁止
Priority: must
Pattern: ubiquitous
Statement: システムはデータを保存してはならない。
`;
    const report = await formalCheck(positive + negative, await fixture(), 'none');
    expect(report.literals).toEqual([
      { requirement: 'REQ-JA-001', atom: '["システム","データを保存"]', positive: true },
      { requirement: 'REQ-JA-002', atom: '["システム","データを保存"]', positive: false },
    ]);
    expect(report.consistency).toBe('inconsistent');
  });

  it('does not reject ordinary Japanese characters as logical conjunctions', async () => {
    const statement = `## REQ-JA-003: API
Priority: must
Pattern: ubiquitous
Statement: システムは操作を公開 API として提供しなければならない。
`;
    const report = await formalCheck(statement, await fixture(), 'none');
    expect(report.literals).toEqual([
      { requirement: 'REQ-JA-003', atom: '["システム","操作を公開 api として提供"]', positive: true },
    ]);
  });

  it('distinguishes auto missing solvers from an explicitly required missing solver', async () => {
    const root = await fixture();
    const auto = await formalCheck(req(), root, 'auto', missingRunner);
    expect(auto.valid).toBe(true);
    expect(auto.solver.status).toBe('missing');
    const explicit = await formalCheck(req(), root, 'z3', missingRunner);
    expect(explicit.valid).toBe(false);
    expect(explicit.solver.status).toBe('missing');
  });

  it('generates real SMT-LIB and only accepts actual solver outcomes', async () => {
    const runner = vi.fn<Runner>(async (_cmd, args) => args.includes('-version') ? processResult({ stdout: 'Z3 4.x' }) : processResult({ stdout: 'sat\n' }));
    const root = await fixture();
    const report = await formalCheck(req(), root, 'z3', runner);
    expect(report.solver.status).toBe('sat');
    expect(runner.mock.calls[0]?.[1]).toEqual(['-version']);
    expect(runner.mock.calls[1]?.[1]).toEqual(['-in', '-smt2', '-T:12']);
    expect(runner.mock.calls[1]?.[2].input).toContain('(declare-fun p0 () Bool)');
    expect(runner.mock.calls[1]?.[2].input).toContain(':named req_example_001_0');
    expect(await readText(root, '.musubix/cache/formal/requirements.smt2')).toContain('(check-sat)');
    expect(report.solver.version).toBe('Z3 4.x');
    expect(report.solver.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    [processResult({ stdout: 'unknown\n' }), 'unknown'],
    [processResult({ status: 'timeout', exitCode: null }), 'timeout'],
    [processResult({ exitCode: 1, stderr: 'bad input' }), 'error'],
    [processResult({ stdout: 'unsat\n' }), 'unsat'],
    [processResult({ stdout: 'sat\nwarning junk' }), 'unknown'],
  ])('reports failed/nonpositive solver results without proof claims', async (execution, status) => {
    const runner: Runner = async (_cmd, args) => args.includes('-version') ? processResult() : execution;
    const report = await formalCheck(req(), await fixture(), 'z3', runner);
    expect(report.solver.status).toBe(status);
    expect(report.valid).toBe(false);
  });

  it('writes a Lean satisfiability theorem and actually invokes the adapter', async () => {
    const runner = vi.fn<Runner>(async (_command, args) =>
      args.includes('--version') ? processResult({ stdout: 'Lean 4.20.0\n' }) : processResult());
    const root = await fixture();
    const report = await formalCheck(req(), root, 'lean', runner);
    expect(report.solver.status).toBe('checked');
    expect(runner.mock.calls[1]?.slice(0, 2)).toEqual(['lean', ['.musubix/cache/formal/Requirements.lean']]);
    const source = await readText(root, '.musubix/cache/formal/Requirements.lean');
    expect(source).toContain('theorem requirements_abstraction : ∃ p0 : Bool, obligations p0 = true := by');
    expect(source).toContain('refine ⟨true, ?_⟩');
    expect(source).not.toContain('decide');
    expect(source).not.toContain('sorry');
    expect(report.solver.version).toBe('Lean 4.20.0');
  });

  it('generates an actual Lean unsatisfiability theorem for contradictions', () => {
    const literals = [
      { requirement: 'REQ-A-001', atom: '["system","store data"]', positive: true },
      { requirement: 'REQ-A-002', atom: '["system","store data"]', positive: false },
    ];
    expect(generateLean({ literals, consistency: 'inconsistent' })).toContain(
      'theorem requirements_abstraction : ¬ (∃ p0 : Bool, obligations p0 = true) := by',
    );
    expect(generateSmt2({ literals })).toContain('(set-option :produce-unsat-cores true)');
  });

  it('generates both reproducible artifacts without requiring installed solvers', async () => {
    const root = await fixture();
    const generated = await generateFormalArtifacts(req(), root);
    expect(generated.valid).toBe(true);
    expect(generated.artifacts.map((entry) => entry.format)).toEqual(['smt2', 'lean']);
    for (const entry of generated.artifacts) {
      expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(await readText(root, entry.path)).not.toBe('');
    }
  });

  it('reports solver versions and falls back to lake env lean', async () => {
    const runner = vi.fn<Runner>(async (command, args) => {
      if (command === 'z3') return processResult({ status: 'missing', exitCode: null });
      if (command === 'lean') return processResult({ status: 'missing', exitCode: null });
      if (command === 'lake' && args.join(' ') === 'env lean --version') return processResult({ stdout: 'Lean 4.20.0\n' });
      return processResult({ exitCode: 1 });
    });
    const doctor = await formalDoctor(await fixture(), {}, runner);
    expect(doctor.available).toBe(true);
    expect(doctor.solvers).toEqual([
      expect.objectContaining({
        name: 'z3',
        status: 'missing',
        attemptedCommands: ['z3'],
        recommendation: expect.stringContaining('MUSUBIX3_Z3'),
      }),
      expect.objectContaining({
        name: 'lean',
        status: 'available',
        command: 'lake env lean',
        attemptedCommands: ['lean', 'lake env lean'],
        version: 'Lean 4.20.0',
        recommendation: 'Ready.',
      }),
    ]);
  });

  it('honors configured commands and timeout bounds in solver execution', async () => {
    const runner = vi.fn<Runner>(async (_command, args) =>
      args.includes('-version') ? processResult({ stdout: 'Z3 custom' }) : processResult({ stdout: 'sat\n', durationMs: 12 }));
    const report = await formalCheck(req(), await fixture(), { solver: 'z3', timeoutMs: 2_500, z3Command: '/opt/z3' }, runner);
    expect(runner.mock.calls[0]?.[0]).toBe('/opt/z3');
    expect(runner.mock.calls[1]?.[1]).toContain('-T:3');
    expect(runner.mock.calls[1]?.[2].timeoutMs).toBe(2_500);
    expect(report.solver).toMatchObject({ command: '/opt/z3', durationMs: 12, status: 'sat' });
  });

  it('does not invoke solvers on invalid requirements', async () => {
    const runner = vi.fn(missingRunner);
    expect((await formalCheck(req('The system should respond.'), await fixture(), 'auto', runner)).valid).toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('local TF-IDF and Git evidence', () => {
  const documents: KnowledgeDocument[] = [
    { id: 'auth', path: 'auth.md', text: 'authentication tokens sessions authentication', kind: 'artifact' },
    { id: 'cache', path: 'cache.md', text: 'cache storage cache expiration', kind: 'artifact' },
    { id: 'ja', path: 'ja.md', text: '認証要求とセッションの期限', kind: 'artifact' },
  ];
  it('ranks deterministically and returns nothing for unrelated words', () => {
    expect(rankDocuments(documents, 'authentication')[0]?.document.id).toBe('auth');
    expect(rankDocuments(documents, 'cache')[0]?.document.id).toBe('cache');
    expect(rankDocuments(documents, 'doesnotexist')).toEqual([]);
    expect(rankDocuments(documents, '')).toEqual([]);
    expect(rankDocuments([], 'cache')).toEqual([]);
    expect(rankDocuments(documents, 'sessions tokens', 1)).toHaveLength(1);
    expect(rankDocuments(documents, '認証')[0]?.document.id).toBe('ja');
    expect(tokenize('認証要求')).toContain('認証');
  });

  it('persists artifact index with explicitly skipped Git evidence', async () => {
    const root = await fixture({ 'README.md': 'Authentication decisions and tokens.' });
    const index = await buildKnowledge(root, missingRunner);
    expect(index.git.status).toBe('skipped');
    expect((await queryKnowledge(root, 'authentication', 10, missingRunner)).stale).toBe(false);
    await writeText(root, 'README.md', 'Updated authentication.');
    expect((await queryKnowledge(root, 'authentication', 10, missingRunner)).stale).toBe(true);
  });

  it('indexes bounded Git co-change and author-directory evidence', async () => {
    const root = await fixture({ 'a.md': 'auth', 'docs/b.md': 'session' });
    const runner: Runner = async (_command, args) => processResult({
      stdout: args[0] === 'log' ? '\x1e0123456789\x1fFixture Author\n\na.md\ndocs/b.md\n' : '0123456789\n',
    });
    const index = await buildKnowledge(root, runner);
    expect(index.git.status).toBe('indexed');
    expect(index.documents.filter((d) => d.kind === 'co-change')).toHaveLength(1);
    expect(index.documents.filter((d) => d.kind === 'author-directory')).toHaveLength(2);
    expect((await queryKnowledge(root, 'session', 10, runner)).stale).toBe(false);
  });
});
