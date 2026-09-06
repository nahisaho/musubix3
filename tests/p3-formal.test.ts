import { describe, expect, it } from 'vitest';
import { validateRequirements } from '../packages/domain/src/index.js';
import {
  formalCheck, generateLean, generateSmt2,
} from '../packages/analysis/src/index.js';
import { fixture, req } from './helpers.js';

function explicit(statement: string, id: string, formal: object): string {
  return `${req(statement, id)}Acceptance: A deterministic test verifies the declared constraint.\nFormal: ${JSON.stringify(formal)}\n`;
}

describe('P3 strengthened explicit formal semantics', () => {
  it('accepts temporal lower bounds and rejects incompatible intervals', async () => {
    const text = [
      explicit('When a request arrives, the system shall wait before responding.', 'REQ-P3-001',
        { kind: 'temporal', trigger: 'request.arrived', response: 'response.sent', afterMs: 1000, withinMs: 5000 }),
      explicit('When a request arrives, the system shall respond in a later window.', 'REQ-P3-002',
        { kind: 'temporal', trigger: 'request.arrived', response: 'response.sent', afterMs: 6000, withinMs: 7000 }),
    ].join('\n');
    const report = await formalCheck(text, await fixture(), 'none');
    expect(report.constraints[0]?.constraint).toMatchObject({ kind: 'temporal', afterMs: 1000, withinMs: 5000 });
    expect(report.consistency).toBe('inconsistent');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORMAL_TEMPORAL_CONTRADICTION' }));
    expect(generateSmt2(report)).toContain('(>= n0 1000)');
    expect(generateSmt2(report)).toContain('(<= n0 5000)');

    const invalid = validateRequirements(`${req()}\nFormal: {"kind":"temporal","trigger":"request.arrived","response":"response.sent","afterMs":-1,"withinMs":5}\n`);
    expect(invalid.diagnostics).toContainEqual(expect.objectContaining({ code: 'REQ_FORMAL_SCHEMA' }));
  });

  it('normalizes compatible duration and size units using exact integers', async () => {
    const duration = await formalCheck([
      explicit('The system shall set a duration floor.', 'REQ-P3-010',
        { kind: 'numeric', metric: 'retention', operator: '>=', value: 1, unit: 's' }),
      explicit('The system shall set a duration ceiling.', 'REQ-P3-011',
        { kind: 'numeric', metric: 'retention', operator: '<=', value: 999, unit: 'ms' }),
    ].join('\n'), await fixture(), 'none');
    expect(duration.consistency).toBe('inconsistent');
    expect(duration.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORMAL_NUMERIC_CONTRADICTION' }));
    expect(generateSmt2(duration)).toContain('(>= n0 1000)');

    const size = await formalCheck([
      explicit('The system shall set an object size.', 'REQ-P3-012',
        { kind: 'numeric', metric: 'object.limit', operator: '=', value: 1, unit: 'mib' }),
      explicit('The system shall set the same object size.', 'REQ-P3-013',
        { kind: 'numeric', metric: 'object.limit', operator: '=', value: 1024, unit: 'kib' }),
    ].join('\n'), await fixture(), 'none');
    expect(size.consistency).toBe('consistent');
    expect(generateSmt2(size)).toContain('1048576');

    const exact = await formalCheck(explicit('The system shall retain data exactly.', 'REQ-P3-014',
      { kind: 'numeric', metric: 'retention', operator: '=', value: Number.MAX_SAFE_INTEGER, unit: 'min' }),
    await fixture(), 'none');
    expect(generateSmt2(exact)).toContain('540431955284459460000');
    expect(generateLean(exact)).toContain('540431955284459460000');
  });

  it('keeps incompatible unit dimensions separate', async () => {
    const report = await formalCheck([
      explicit('The system shall set a duration.', 'REQ-P3-020',
        { kind: 'numeric', metric: 'limit', operator: '=', value: 1, unit: 's' }),
      explicit('The system shall set a size.', 'REQ-P3-021',
        { kind: 'numeric', metric: 'limit', operator: '=', value: 1, unit: 'bytes' }),
    ].join('\n'), await fixture(), 'none');
    expect(report.consistency).toBe('consistent');
    expect(generateSmt2(report).match(/\(declare-fun n\d+ \(\) Int\)/g)).toHaveLength(2);
  });

  it('rejects conflicting consequences only within the same conditional branch', async () => {
    const conflicting = await formalCheck([
      explicit('When enabled, the system shall allow access.', 'REQ-P3-030',
        { kind: 'conditional', condition: 'feature.enabled', conditionValue: true, consequence: 'access.allowed', consequenceValue: true }),
      explicit('When enabled, the system shall deny access.', 'REQ-P3-031',
        { kind: 'conditional', condition: 'feature.enabled', conditionValue: true, consequence: 'access.allowed', consequenceValue: false }),
    ].join('\n'), await fixture(), 'none');
    expect(conflicting.consistency).toBe('inconsistent');
    expect(conflicting.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORMAL_CONDITIONAL_CONTRADICTION' }));

    const separate = await formalCheck([
      explicit('When enabled, the system shall allow access.', 'REQ-P3-032',
        { kind: 'conditional', condition: 'feature.enabled', conditionValue: true, consequence: 'access.allowed', consequenceValue: true }),
      explicit('When disabled, the system shall deny access.', 'REQ-P3-033',
        { kind: 'conditional', condition: 'feature.enabled', conditionValue: false, consequence: 'access.allowed', consequenceValue: false }),
    ].join('\n'), await fixture(), 'none');
    expect(separate.consistency).toBe('consistent');
    expect(generateSmt2(separate).match(/\(declare-fun q\d+ \(\) Bool\)/g)).toHaveLength(2);
  });

  it('keeps delimiter-containing formal identities collision-safe', async () => {
    const report = await formalCheck([
      explicit('The first response shall use one interval.', 'REQ-P3-034',
        { kind: 'temporal', trigger: 'a::b', response: 'c', afterMs: 10, withinMs: 20 }),
      explicit('The second response shall use another interval.', 'REQ-P3-035',
        { kind: 'temporal', trigger: 'a', response: 'b::c', afterMs: 30, withinMs: 40 }),
      explicit('The first transition shall choose running.', 'REQ-P3-036',
        { kind: 'transition', from: 'a::b', event: 'c', to: 'running' }),
      explicit('The second transition shall choose failed.', 'REQ-P3-037',
        { kind: 'transition', from: 'a', event: 'b::c', to: 'failed' }),
    ].join('\n'), await fixture(), 'none');
    expect(report.consistency).toBe('consistent');
    expect(report.diagnostics).not.toContainEqual(expect.objectContaining({
      code: expect.stringMatching(/FORMAL_(TEMPORAL|TRANSITION)_CONTRADICTION/),
    }));
    expect(generateSmt2(report).match(/\(declare-fun n\d+ \(\) Int\)/g)).toHaveLength(4);
  });

  it('encodes deterministic transition targets in generated artifacts', async () => {
    const report = await formalCheck([
      explicit('When start occurs, the system shall enter running.', 'REQ-P3-040',
        { kind: 'transition', from: 'idle', event: 'start', to: 'running' }),
      explicit('When stop occurs, the system shall enter idle.', 'REQ-P3-041',
        { kind: 'transition', from: 'running', event: 'stop', to: 'idle' }),
    ].join('\n'), await fixture(), 'none');
    expect(report.consistency).toBe('consistent');
    const smt = generateSmt2(report);
    const lean = generateLean(report);
    expect(smt).toContain('; transition-state 0: idle');
    expect(smt).toContain('; transition-state 1: running');
    expect(smt).toMatch(/\["transition","idle","start"\][\s\S]*\(assert \(! \(= n\d+ 1\)/);
    expect(smt).toMatch(/\["transition","running","stop"\][\s\S]*\(assert \(! \(= n\d+ 0\)/);
    expect(lean).toContain('def transitionStates : List String := ["idle", "running"]');
    expect(lean).toMatch(/n\d+ = 1/);
    expect(lean).toMatch(/n\d+ = 0/);
  });

  it.each([
    [
      explicit('The system shall set a fixed value.', 'REQ-P3-050',
        { kind: 'numeric', metric: 'workers', operator: '=', value: 1 }),
      'unsat',
    ],
    [
      [
        explicit('The system shall set a lower bound.', 'REQ-P3-051',
          { kind: 'numeric', metric: 'workers', operator: '>=', value: 2 }),
        explicit('The system shall set an upper bound.', 'REQ-P3-052',
          { kind: 'numeric', metric: 'workers', operator: '<=', value: 1 }),
      ].join('\n'),
      'sat',
    ],
  ])('keeps a %s solver disagreement fail-closed', async (text, solverAnswer) => {
    const report = await formalCheck(text, await fixture(), 'z3', async (_command, args) => ({
      status: 'completed',
      exitCode: 0,
      stdout: args.includes('-version') ? 'Z3 test' : `${solverAnswer}\n`,
      stderr: '',
      durationMs: 1,
    }));
    expect(report.valid).toBe(false);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORMAL_SOLVER_MISMATCH' }));
  });
});

describe.runIf(process.env.MUSUBIX_RUN_Z3 === '1')('P3 real Z3 integration', () => {
  it('agrees on conditional, temporal, numeric, and transition contradictions', async () => {
    const cases = [
      [
        explicit('When enabled, the system shall allow access.', 'REQ-P3-Z3-001',
          { kind: 'conditional', condition: 'feature.enabled', consequence: 'access.allowed' }),
        explicit('When enabled, the system shall deny access.', 'REQ-P3-Z3-002',
          { kind: 'conditional', condition: 'feature.enabled', consequence: 'access.allowed', consequenceValue: false }),
      ],
      [
        explicit('The response shall use one interval.', 'REQ-P3-Z3-003',
          { kind: 'temporal', trigger: 'request', response: 'response', afterMs: 10, withinMs: 20 }),
        explicit('The response shall use another interval.', 'REQ-P3-Z3-004',
          { kind: 'temporal', trigger: 'request', response: 'response', afterMs: 30, withinMs: 40 }),
      ],
      [
        explicit('The limit shall be at least one second.', 'REQ-P3-Z3-005',
          { kind: 'numeric', metric: 'latency', operator: '>=', value: 1, unit: 's' }),
        explicit('The limit shall be below one second.', 'REQ-P3-Z3-006',
          { kind: 'numeric', metric: 'latency', operator: '<', value: 1000, unit: 'ms' }),
      ],
      [
        explicit('The system shall enter running after start.', 'REQ-P3-Z3-007',
          { kind: 'transition', from: 'idle', event: 'start', to: 'running' }),
        explicit('The system shall enter failed after start.', 'REQ-P3-Z3-008',
          { kind: 'transition', from: 'idle', event: 'start', to: 'failed' }),
      ],
    ];
    for (const fragments of cases) {
      const report = await formalCheck(fragments.join('\n'), await fixture(), 'z3');
      expect(report.consistency).toBe('inconsistent');
      expect(report.solver.status).toBe('unsat');
      expect(report.valid).toBe(false);
      expect(report.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'FORMAL_SOLVER_MISMATCH' }));
    }
  });
});

describe.runIf(process.env.MUSUBIX_RUN_LEAN === '1')('P3 real Lean integration', () => {
  it('compiles consistent and inconsistent mixed models with the pinned toolchain', async () => {
    const consistent = [
      req('The system shall report readiness.', 'REQ-P3-LEAN-001'),
      explicit('When enabled, the system shall allow access.', 'REQ-P3-LEAN-002',
        { kind: 'conditional', condition: 'feature.enabled', consequence: 'access.allowed' }),
      explicit('The timeout shall be one second.', 'REQ-P3-LEAN-003',
        { kind: 'numeric', metric: 'timeout', operator: '=', value: 1, unit: 's' }),
      explicit('The response shall occur in its window.', 'REQ-P3-LEAN-004',
        { kind: 'temporal', trigger: 'request', response: 'response', afterMs: 100, withinMs: 1000 }),
      explicit('The system shall enter running after start.', 'REQ-P3-LEAN-005',
        { kind: 'transition', from: 'idle', event: 'start', to: 'running' }),
    ].join('\n');
    const consistentReport = await formalCheck(consistent, await fixture(), 'lean');
    expect(consistentReport).toMatchObject({ consistency: 'consistent', valid: true, solver: { status: 'checked' } });

    const inconsistent = [
      req('The system shall store data.', 'REQ-P3-LEAN-010'),
      req('The system shall not store data.', 'REQ-P3-LEAN-011'),
      explicit('The timeout shall be one second.', 'REQ-P3-LEAN-012',
        { kind: 'numeric', metric: 'timeout', operator: '=', value: 1000, unit: 'ms' }),
    ].join('\n');
    const inconsistentReport = await formalCheck(inconsistent, await fixture(), 'lean');
    expect(inconsistentReport).toMatchObject({ consistency: 'inconsistent', valid: false, solver: { status: 'checked' } });
    expect(generateLean(inconsistentReport)).not.toContain('decide');

    const temporalConflict = [
      req('The system shall report readiness.', 'REQ-P3-LEAN-020'),
      explicit('The response shall use one interval.', 'REQ-P3-LEAN-021',
        { kind: 'temporal', trigger: 'request', response: 'response', afterMs: 10, withinMs: 20 }),
      explicit('The response shall use another interval.', 'REQ-P3-LEAN-022',
        { kind: 'temporal', trigger: 'request', response: 'response', afterMs: 30, withinMs: 40 }),
    ].join('\n');
    expect(await formalCheck(temporalConflict, await fixture(), 'lean'))
      .toMatchObject({ consistency: 'inconsistent', valid: false, solver: { status: 'checked' } });

    const conditionalConflict = [
      req('The system shall report readiness.', 'REQ-P3-LEAN-030'),
      explicit('When enabled, the system shall allow access.', 'REQ-P3-LEAN-031',
        { kind: 'conditional', condition: 'feature.enabled', consequence: 'access.allowed' }),
      explicit('When enabled, the system shall deny access.', 'REQ-P3-LEAN-032',
        { kind: 'conditional', condition: 'feature.enabled', consequence: 'access.allowed', consequenceValue: false }),
    ].join('\n');
    expect(await formalCheck(conditionalConflict, await fixture(), 'lean'))
      .toMatchObject({ consistency: 'inconsistent', valid: false, solver: { status: 'checked' } });

    const transitionConflict = [
      req('The system shall report readiness.', 'REQ-P3-LEAN-040'),
      explicit('The system shall enter running after start.', 'REQ-P3-LEAN-041',
        { kind: 'transition', from: 'idle', event: 'start', to: 'running' }),
      explicit('The system shall enter failed after start.', 'REQ-P3-LEAN-042',
        { kind: 'transition', from: 'idle', event: 'start', to: 'failed' }),
    ].join('\n');
    expect(await formalCheck(transitionConflict, await fixture(), 'lean'))
      .toMatchObject({ consistency: 'inconsistent', valid: false, solver: { status: 'checked' } });
  });
});
