import { createHash } from 'node:crypto';
import { error, validateRequirements, type Diagnostic, type FormalConstraint, type Requirement } from '../../domain/src/index.js';
import { runProcess, type ProcessResult, type Runner } from './process.js';
import { writeText } from './files.js';

export type Solver = 'auto' | 'none' | 'z3' | 'lean';
export type FormalFormat = 'smt2' | 'lean';
export type SolverStatus = 'not-requested' | 'missing' | 'sat' | 'unsat' | 'checked' | 'unknown' | 'timeout' | 'error';

export interface FormalLiteral {
  requirement: string;
  atom: string;
  positive: boolean;
}

export interface FormalConstraintEntry {
  requirement: string;
  constraint: FormalConstraint;
}

export interface FormalArtifact {
  format: FormalFormat;
  path: string;
  sha256: string;
  description: string;
}

export interface SolverReport {
  requested: Solver;
  name: string;
  command: string;
  version: string;
  status: SolverStatus;
  durationMs: number;
  output: string;
  artifact?: FormalArtifact;
}

export interface FormalResult {
  valid: boolean;
  abstraction: string;
  assumptions: string[];
  literals: FormalLiteral[];
  constraints: FormalConstraintEntry[];
  unsupported: string[];
  diagnostics: Diagnostic[];
  consistency: 'consistent' | 'inconsistent' | 'unknown';
  solver: SolverReport;
}

export interface FormalCheckOptions {
  solver?: Solver;
  timeoutMs?: number;
  z3Command?: string;
  leanCommand?: string;
}

export interface FormalGenerationResult {
  valid: boolean;
  consistency: FormalResult['consistency'];
  literals: FormalLiteral[];
  constraints: FormalConstraintEntry[];
  unsupported: string[];
  diagnostics: Diagnostic[];
  artifacts: FormalArtifact[];
}

export interface SolverDoctorEntry {
  name: 'z3' | 'lean';
  available: boolean;
  command: string;
  version: string;
  status: 'available' | 'missing' | 'timeout' | 'error';
  output: string;
}

export interface SolverDoctorResult {
  available: boolean;
  solvers: SolverDoctorEntry[];
}

interface FormalModel {
  validRequirements: boolean;
  literals: FormalLiteral[];
  constraints: FormalConstraintEntry[];
  unsupported: string[];
  diagnostics: Diagnostic[];
  consistency: FormalResult['consistency'];
}

interface SolverInvocation {
  name: 'z3' | 'lean';
  command: string;
  prefixArgs: string[];
}

const abstraction = 'Consistency of explicit branch-scoped conditional, exact unit-normalized integer numeric, bounded temporal interval, deterministic state-transition, and controlled unconditional Boolean constraints; not implementation correctness.';
const assumptions = [
  'Exact normalized subject/response pairs denote the same Boolean proposition.',
  'Explicit Formal JSON fields use only their documented closed-world constraint semantics.',
  'Temporal constraints model one nonnegative integer response delay in milliseconds within the intersection of declared afterMs/withinMs intervals, not scheduling or liveness.',
  'Numeric ms/s/min values share an exact millisecond dimension; bytes/kib/mib values share an exact byte dimension; other and incompatible units remain separate.',
  'State transitions require one target for each declared from-state/event pair; undeclared transitions are unconstrained.',
  'Copilot supplies candidate requirements; deterministic checks do not establish their truth.',
];

type NumericConstraint = Extract<FormalConstraint, { kind: 'numeric' }>;
type ComparisonOperator = NumericConstraint['operator'];

interface NormalizedNumeric {
  key: string;
  value: bigint;
}

function structuredKey(...parts: Array<string | boolean>): string {
  return JSON.stringify(parts);
}

function conditionalKey(constraint: Extract<FormalConstraint, { kind: 'conditional' }>): string {
  return structuredKey('conditional', constraint.condition, constraint.conditionValue, constraint.consequence);
}

function temporalKey(constraint: Extract<FormalConstraint, { kind: 'temporal' }>): string {
  return structuredKey('delay', constraint.trigger, constraint.response);
}

function transitionKey(constraint: Extract<FormalConstraint, { kind: 'transition' }>): string {
  return structuredKey('transition', constraint.from, constraint.event);
}

const unitConversions = new Map<string, { dimension: string; canonical: string; factor: bigint }>([
  ['ms', { dimension: 'duration', canonical: 'ms', factor: 1n }],
  ['s', { dimension: 'duration', canonical: 'ms', factor: 1_000n }],
  ['min', { dimension: 'duration', canonical: 'ms', factor: 60_000n }],
  ['bytes', { dimension: 'size', canonical: 'bytes', factor: 1n }],
  ['kib', { dimension: 'size', canonical: 'bytes', factor: 1_024n }],
  ['mib', { dimension: 'size', canonical: 'bytes', factor: 1_048_576n }],
]);

function normalizeNumeric(constraint: NumericConstraint): NormalizedNumeric {
  const normalizedUnit = constraint.unit?.normalize('NFKC').toLowerCase();
  const conversion = normalizedUnit ? unitConversions.get(normalizedUnit) : undefined;
  const dimension = conversion
    ? `${conversion.dimension}(${conversion.canonical})`
    : normalizedUnit ? `unit(${normalizedUnit})` : 'unitless';
  return {
    key: structuredKey('metric', constraint.metric, dimension),
    value: BigInt(constraint.value) * (conversion?.factor ?? 1n),
  };
}

function satisfies(candidate: bigint, operator: ComparisonOperator, expected: bigint): boolean {
  return operator === '<' ? candidate < expected
    : operator === '<=' ? candidate <= expected
      : operator === '=' ? candidate === expected
        : operator === '>=' ? candidate >= expected
          : candidate > expected;
}

function constraintDiagnostics(constraints: FormalConstraintEntry[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const numeric = new Map<string, Array<{ requirement: string; operator: ComparisonOperator; value: bigint }>>();
  const temporal = new Map<string, FormalConstraintEntry[]>();
  const transitions = new Map<string, FormalConstraintEntry[]>();
  const conditionals = new Map<string, FormalConstraintEntry[]>();
  for (const entry of constraints) {
    const constraint = entry.constraint;
    if (constraint.kind === 'numeric') {
      const normalized = normalizeNumeric(constraint);
      numeric.set(normalized.key, [...numeric.get(normalized.key) ?? [], {
        requirement: entry.requirement,
        operator: constraint.operator,
        value: normalized.value,
      }]);
    } else if (constraint.kind === 'temporal') {
      const key = temporalKey(constraint);
      temporal.set(key, [...temporal.get(key) ?? [], entry]);
    } else if (constraint.kind === 'transition') {
      const key = transitionKey(constraint);
      transitions.set(key, [...transitions.get(key) ?? [], entry]);
    } else {
      const key = conditionalKey(constraint);
      conditionals.set(key, [...conditionals.get(key) ?? [], entry]);
    }
  }
  for (const entries of numeric.values()) {
    const candidates = new Set<bigint>();
    for (const entry of entries) {
      candidates.add(entry.value);
      candidates.add(entry.value - 1n);
      candidates.add(entry.value + 1n);
    }
    if (![...candidates].some((candidate) => entries.every((entry) => satisfies(candidate, entry.operator, entry.value)))) {
      diagnostics.push(error('FORMAL_NUMERIC_CONTRADICTION', `${entries.map((entry) => entry.requirement).join(', ')} impose incompatible numeric bounds.`));
    }
  }
  for (const entries of temporal.values()) {
    const intervals = entries.map((entry) => entry.constraint as Extract<FormalConstraint, { kind: 'temporal' }>);
    const lower = intervals.reduce((maximum, interval) => Math.max(maximum, interval.afterMs ?? 0), 0);
    const upper = intervals.reduce((minimum, interval) => Math.min(minimum, interval.withinMs), Number.MAX_SAFE_INTEGER);
    if (lower > upper) {
      diagnostics.push(error('FORMAL_TEMPORAL_CONTRADICTION', `${entries.map((entry) => entry.requirement).join(', ')} impose incompatible response-delay intervals.`));
    }
  }
  for (const entries of transitions.values()) {
    const targets = new Set(entries.map((entry) => (entry.constraint as Extract<FormalConstraint, { kind: 'transition' }>).to));
    if (targets.size > 1) {
      diagnostics.push(error('FORMAL_TRANSITION_CONTRADICTION', `${entries.map((entry) => entry.requirement).join(', ')} require different targets for the same transition.`));
    }
  }
  for (const entries of conditionals.values()) {
    const values = new Set(entries.map((entry) => (entry.constraint as Extract<FormalConstraint, { kind: 'conditional' }>).consequenceValue));
    if (values.size > 1) {
      diagnostics.push(error('FORMAL_CONDITIONAL_CONTRADICTION', `${entries.map((entry) => entry.requirement).join(', ')} require opposing consequences under the same condition branch.`));
    }
  }
  return diagnostics;
}

function literal(requirement: Requirement): FormalLiteral | null {
  // Trigger overlap and domain equivalence must not be guessed.
  if (requirement.pattern !== 'ubiquitous') return null;
  const english = /^(?:the|a|an)\s+(.+?)\s+shall\s+(not\s+)?(.+?)[.!]?$/i.exec(requirement.statement);
  const japanese = /^(.+?)は(.+?)(してはならない|してはいけない|しなければならない)[。.]?$/.exec(requirement.statement);
  if (!english && !japanese) return null;
  const subject = (english?.[1] ?? japanese?.[1] ?? '').trim();
  const response = (english?.[3] ?? japanese?.[2] ?? '').replace(/[。.]$/, '').trim();
  if (/\b(and|or|unless|except|if|when|while|within|at least|at most)\b|[<>=\d]/i.test(response)) return null;
  if (/(?:かつ|又は|若しくは|場合|とき|間|以内|以上|以下)|\d/.test(response)) return null;
  const atom = structuredKey(
    subject.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(),
    response.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(),
  );
  const japaneseNegative = japanese?.[3] === 'してはならない' || japanese?.[3] === 'してはいけない';
  return { requirement: requirement.id, atom, positive: english ? !english[2] : !japaneseNegative };
}

function buildModel(text: string): FormalModel {
  const requirements = validateRequirements(text);
  const literals: FormalLiteral[] = [];
  const constraints: FormalConstraintEntry[] = [];
  const unsupported: string[] = [];
  for (const requirement of requirements.value) {
    if (requirement.formal) {
      constraints.push({ requirement: requirement.id, constraint: requirement.formal });
      continue;
    }
    const parsed = literal(requirement);
    if (parsed) literals.push(parsed);
    else unsupported.push(requirement.id);
  }
  const diagnostics = [...requirements.diagnostics];
  for (const id of unsupported) {
    diagnostics.push({
      code: 'FORMAL_UNSUPPORTED',
      severity: 'warning',
      message: `${id} is outside the unconditional English/Japanese Boolean abstraction; it was not checked for consistency.`,
    });
  }
  for (let i = 0; i < literals.length; i++) {
    for (let j = i + 1; j < literals.length; j++) {
      const first = literals[i]!;
      const second = literals[j]!;
      if (first.atom === second.atom && first.positive !== second.positive) {
        diagnostics.push(error('FORMAL_CONTRADICTION', `${first.requirement} contradicts ${second.requirement} in the propositional abstraction.`));
      }
    }
  }
  diagnostics.push(...constraintDiagnostics(constraints));
  const inconsistent = diagnostics.some((diagnostic) => diagnostic.code.includes('CONTRADICTION'));
  return {
    validRequirements: requirements.valid,
    literals,
    constraints,
    unsupported,
    diagnostics,
    consistency: inconsistent ? 'inconsistent' : (literals.length || constraints.length) && requirements.valid ? 'consistent' : 'unknown',
  };
}

function atomsOf(model: FormalModel): string[] {
  return [...new Set(model.literals.map((entry) => entry.atom))].sort();
}

function assertionName(requirement: string, index: number): string {
  return `${requirement.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_${index}`;
}

export function generateSmt2(model: Pick<FormalModel, 'literals'> & Partial<Pick<FormalModel, 'constraints'>>): string {
  const constraints = model.constraints ?? [];
  const atoms = atomsOf({ ...model, constraints, validRequirements: true, unsupported: [], diagnostics: [], consistency: 'unknown' });
  const atomName = (entry: FormalLiteral): string => `p${atoms.indexOf(entry.atom)}`;
  const conditionalScenarios = [...new Set(constraints.flatMap((entry) => entry.constraint.kind === 'conditional'
    ? [conditionalKey(entry.constraint)] : []))].sort();
  const integerVariables = [...new Set(constraints.flatMap((entry) => entry.constraint.kind === 'numeric'
    ? [normalizeNumeric(entry.constraint).key]
    : entry.constraint.kind === 'temporal' ? [temporalKey(entry.constraint)]
      : entry.constraint.kind === 'transition' ? [transitionKey(entry.constraint)] : []))].sort();
  const states = [...new Set(constraints.flatMap((entry) => entry.constraint.kind === 'transition' ? [entry.constraint.to] : []))].sort();
  const integerName = (key: string): string => `n${integerVariables.indexOf(key)}`;
  const explicit = constraints.flatMap((entry, index): string[] => {
    const constraint = entry.constraint;
    const named = (suffix: string, value: string): string =>
      `(assert (! ${value} :named ${assertionName(entry.requirement, index)}_${suffix}))`;
    if (constraint.kind === 'conditional') {
      const scenario = conditionalKey(constraint);
      const consequence = `q${conditionalScenarios.indexOf(scenario)}`;
      return [named('conditional', constraint.consequenceValue ? consequence : `(not ${consequence})`)];
    }
    if (constraint.kind === 'numeric') {
      const normalized = normalizeNumeric(constraint);
      return [named('numeric', `(${constraint.operator} ${integerName(normalized.key)} ${normalized.value})`)];
    }
    if (constraint.kind === 'temporal') {
      const variable = integerName(temporalKey(constraint));
      return [
        named('after', `(>= ${variable} ${constraint.afterMs ?? 0})`),
        named('deadline', `(<= ${variable} ${constraint.withinMs})`),
      ];
    }
    return [named('transition', `(= ${integerName(transitionKey(constraint))} ${states.indexOf(constraint.to)})`)];
  });
  return [
    '; Generated by musubix3. This checks only the documented explicit constraint model.',
    '(set-logic QF_UFLIA)',
    '(set-option :produce-unsat-cores true)',
    ...atoms.map((atom, index) => `; p${index}: ${atom}\n(declare-fun p${index} () Bool)`),
    ...conditionalScenarios.map((scenario, index) => `; q${index}: consequence under ${scenario}\n(declare-fun q${index} () Bool)`),
    ...integerVariables.map((name, index) => `; n${index}: ${name}\n(declare-fun n${index} () Int)`),
    ...states.map((state, index) => `; transition-state ${index}: ${state}`),
    ...model.literals.map((entry, index) =>
      `(assert (! ${entry.positive ? atomName(entry) : `(not ${atomName(entry)})`} :named ${assertionName(entry.requirement, index)}))`),
    ...explicit,
    '(check-sat)',
  ].join('\n');
}

export function generateLean(model: Pick<FormalModel, 'literals' | 'consistency'> & Partial<Pick<FormalModel, 'constraints'>>): string {
  const constraints = model.constraints ?? [];
  const atoms = atomsOf({ ...model, constraints, validRequirements: true, unsupported: [], diagnostics: [] });
  const parameters = atoms.map((_, index) => `(p${index} : Bool)`).join(' ');
  const atomName = (entry: FormalLiteral): string => `p${atoms.indexOf(entry.atom)}`;
  const expression = model.literals.map((entry) => entry.positive ? atomName(entry) : `!${atomName(entry)}`).join(' && ') || 'true';
  const quantified = atoms.length
    ? `∃ ${atoms.map((_, index) => `p${index}`).join(' ')} : Bool, obligations ${atoms.map((_, index) => `p${index}`).join(' ')} = true`
    : 'obligations = true';
  const booleanContradiction = model.literals.some((entry, index) =>
    model.literals.slice(index + 1).some((other) => other.atom === entry.atom && other.positive !== entry.positive));
  const explicitInconsistent = booleanContradiction || constraintDiagnostics(constraints)
    .some((diagnostic) => diagnostic.code.includes('CONTRADICTION'));
  const proposition = booleanContradiction ? `¬ (${quantified})` : quantified;
  const literalWitnesses = atoms.map((atom) => model.literals.find((entry) => entry.atom === atom)?.positive !== false);
  const lines = [
    ...(constraints.length ? ['import Lean.Elab.Tactic.Omega', ''] : []),
    '/- Generated by musubix3.',
    '   This checks the normalized machine-readable abstraction,',
    '   not correctness of the requirements or implementation. -/',
    `def obligations ${parameters} : Bool := ${expression}`,
    '',
    `theorem requirements_abstraction : ${proposition} := by`,
    ...(atoms.length === 0
      ? ['  rfl']
      : booleanContradiction
        ? ['  simp [obligations]']
        : [`  refine ⟨${literalWitnesses.map(String).join(', ')}, ?_⟩`, '  simp [obligations]']),
  ];
  if (constraints.length) {
    const conditionalScenarios = [...new Set(constraints.flatMap((entry) => entry.constraint.kind === 'conditional'
      ? [conditionalKey(entry.constraint)] : []))].sort();
    const integerVariables = [...new Set(constraints.flatMap((entry) => entry.constraint.kind === 'numeric'
      ? [normalizeNumeric(entry.constraint).key]
      : entry.constraint.kind === 'temporal' ? [temporalKey(entry.constraint)]
        : entry.constraint.kind === 'transition' ? [transitionKey(entry.constraint)] : []))].sort();
    const states = [...new Set(constraints.flatMap((entry) => entry.constraint.kind === 'transition' ? [entry.constraint.to] : []))].sort();
    const booleanParameters = [
      ...atoms.map((_, index) => `p${index}`),
      ...conditionalScenarios.map((_, index) => `q${index}`),
    ];
    const integerParameters = integerVariables.map((_, index) => `n${index}`);
    const declarations = [
      ...booleanParameters.map((name) => `(${name} : Bool)`),
      ...integerParameters.map((name) => `(${name} : Int)`),
    ].join(' ');
    const propositions = [
      ...model.literals.map((entry) => `${atomName(entry)} = ${entry.positive ? 'true' : 'false'}`),
      ...constraints.flatMap((entry): string[] => {
        const constraint = entry.constraint;
        if (constraint.kind === 'conditional') {
          const scenario = conditionalKey(constraint);
          return [`q${conditionalScenarios.indexOf(scenario)} = ${constraint.consequenceValue ? 'true' : 'false'}`];
        }
        if (constraint.kind === 'numeric') {
          const normalized = normalizeNumeric(constraint);
          return [`n${integerVariables.indexOf(normalized.key)} ${constraint.operator} ${normalized.value}`];
        }
        if (constraint.kind === 'temporal') {
          const variable = `n${integerVariables.indexOf(temporalKey(constraint))}`;
          return [`${constraint.afterMs ?? 0} ≤ ${variable}`, `${variable} ≤ ${constraint.withinMs}`];
        }
        return [`n${integerVariables.indexOf(transitionKey(constraint))} = ${states.indexOf(constraint.to)}`];
      }),
    ];
    const explicitExpression = propositions.join(' ∧ ') || 'True';
    const existential = [
      ...booleanParameters.map((name) => `${name} : Bool`),
      ...integerParameters.map((name) => `${name} : Int`),
    ].reduceRight((body, declaration) => `∃ ${declaration}, ${body}`, `explicitObligations ${[...booleanParameters, ...integerParameters].join(' ')}`.trim());
    const booleanWitnesses = booleanParameters.map((name) => {
      const index = Number(name.slice(1));
      if (name.startsWith('p')) return model.literals.find((entry) => atoms.indexOf(entry.atom) === index)?.positive !== false;
      return constraints.find((entry) => entry.constraint.kind === 'conditional'
        && conditionalScenarios.indexOf(conditionalKey(entry.constraint)) === index)
        ?.constraint.kind === 'conditional'
        ? (constraints.find((entry) => entry.constraint.kind === 'conditional'
          && conditionalScenarios.indexOf(conditionalKey(entry.constraint)) === index)!
          .constraint as Extract<FormalConstraint, { kind: 'conditional' }>).consequenceValue
        : true;
    });
    const integerWitnesses = integerVariables.map((key) => {
      const temporalEntries = constraints.filter((entry) =>
        entry.constraint.kind === 'temporal' && temporalKey(entry.constraint) === key);
      if (temporalEntries.length) {
        return constraints
          .filter((entry) => entry.constraint.kind === 'temporal' && temporalKey(entry.constraint) === key)
          .reduce((maximum, entry) => Math.max(maximum,
            (entry.constraint as Extract<FormalConstraint, { kind: 'temporal' }>).afterMs ?? 0), 0);
      }
      const transitionEntry = constraints.find((candidate) =>
        candidate.constraint.kind === 'transition' && transitionKey(candidate.constraint) === key);
      if (transitionEntry) {
        const entry = constraints.find((candidate) => candidate.constraint.kind === 'transition'
          && transitionKey(candidate.constraint) === key);
        return entry?.constraint.kind === 'transition' ? states.indexOf(entry.constraint.to) : 0;
      }
      const entries = constraints.filter((entry) => entry.constraint.kind === 'numeric'
        && normalizeNumeric(entry.constraint).key === key)
        .map((entry) => {
          const constraint = entry.constraint as NumericConstraint;
          return { operator: constraint.operator, value: normalizeNumeric(constraint).value };
        });
      const candidates = new Set(entries.flatMap((entry) => [entry.value - 1n, entry.value, entry.value + 1n]));
      return [...candidates].find((candidate) => entries.every((entry) =>
        satisfies(candidate, entry.operator, entry.value))) ?? entries[0]?.value ?? 0n;
    });
    const contradictoryAtom = atoms.findIndex((atom) => {
      const values = new Set(model.literals.filter((entry) => entry.atom === atom).map((entry) => entry.positive));
      return values.size > 1;
    });
    const contradictoryConditional = conditionalScenarios.findIndex((scenario) => {
      const values = new Set(constraints
        .filter((entry) => entry.constraint.kind === 'conditional'
          && conditionalKey(entry.constraint) === scenario)
        .map((entry) => (entry.constraint as Extract<FormalConstraint, { kind: 'conditional' }>).consequenceValue));
      return values.size > 1;
    });
    const contradictoryBoolean = contradictoryAtom >= 0
      ? `p${contradictoryAtom}`
      : contradictoryConditional >= 0 ? `q${contradictoryConditional}` : undefined;
    lines.push(
      '',
      'def explicitConstraints : List (String × String) := [',
      constraints.map((entry) => `  (${JSON.stringify(entry.requirement)}, ${JSON.stringify(JSON.stringify(entry.constraint))})`).join(',\n'),
      ']',
      ...(states.length ? [
        '',
        `def transitionStates : List String := [${states.map((state) => JSON.stringify(state)).join(', ')}]`,
      ] : []),
      '',
      `def explicitObligations ${declarations} : Prop := ${explicitExpression}`,
      '',
      `theorem explicit_constraints_${explicitInconsistent ? 'inconsistent' : 'consistent'} : ${explicitInconsistent ? `¬ (${existential})` : existential} := by`,
      ...(!explicitInconsistent
        ? [`  refine ⟨${[...booleanWitnesses.map(String), ...integerWitnesses].join(', ')}, ?_⟩`, '  simp [explicitObligations]']
        : [
          '  intro h',
          `  rcases h with ⟨${[...booleanParameters, ...integerParameters, 'h'].join(', ')}⟩`,
          contradictoryBoolean
            ? `  cases ${contradictoryBoolean} <;> simp [explicitObligations] at h`
            : '  simp [explicitObligations] at h <;> omega',
        ]),
    );
  }
  return lines.join('\n');
}

function artifact(format: FormalFormat, path: string, content: string): FormalArtifact {
  return {
    format,
    path,
    sha256: createHash('sha256').update(content).digest('hex'),
    description: format === 'smt2'
      ? 'SMT-LIB2 consistency problem for the documented explicit constraint model.'
      : 'Lean translation and deterministic checks for the normalized constraint model.',
  };
}

async function writeArtifact(root: string, format: FormalFormat, content: string): Promise<FormalArtifact> {
  const path = format === 'smt2'
    ? '.musubix/cache/formal/requirements.smt2'
    : '.musubix/cache/formal/Requirements.lean';
  await writeText(root, path, `${content}\n`);
  return artifact(format, path, `${content}\n`);
}

export async function generateFormalArtifacts(
  text: string,
  root: string,
  formats: FormalFormat[] = ['smt2', 'lean'],
): Promise<FormalGenerationResult> {
  const model = buildModel(text);
  const artifacts: FormalArtifact[] = [];
  if (model.validRequirements && (model.literals.length || model.constraints.length)) {
    for (const format of [...new Set(formats)]) {
      artifacts.push(await writeArtifact(root, format, format === 'smt2' ? generateSmt2(model) : generateLean(model)));
    }
  }
  return {
    valid: model.validRequirements && (model.literals.length > 0 || model.constraints.length > 0),
    consistency: model.consistency,
    literals: model.literals,
    constraints: model.constraints,
    unsupported: model.unsupported,
    diagnostics: model.diagnostics,
    artifacts,
  };
}

function commandFor(name: 'z3' | 'lean', options: FormalCheckOptions): SolverInvocation[] {
  if (name === 'z3') return [{ name, command: options.z3Command ?? process.env.MUSUBIX3_Z3 ?? 'z3', prefixArgs: [] }];
  const configured = options.leanCommand ?? process.env.MUSUBIX3_LEAN;
  if (configured) return [{ name, command: configured, prefixArgs: [] }];
  return [
    { name, command: 'lean', prefixArgs: [] },
    { name, command: 'lake', prefixArgs: ['env', 'lean'] },
  ];
}

async function probe(invocation: SolverInvocation, root: string, timeoutMs: number, runner: Runner): Promise<ProcessResult> {
  return runner(invocation.command, [...invocation.prefixArgs, invocation.name === 'z3' ? '-version' : '--version'], { cwd: root, timeoutMs });
}

async function findSolver(
  name: 'z3' | 'lean',
  root: string,
  timeoutMs: number,
  options: FormalCheckOptions,
  runner: Runner,
): Promise<{ invocation?: SolverInvocation; probe: ProcessResult }> {
  let last: ProcessResult = { status: 'missing', exitCode: null, stdout: '', stderr: '', durationMs: 0 };
  for (const invocation of commandFor(name, options)) {
    last = await probe(invocation, root, timeoutMs, runner);
    if (last.status !== 'missing') return { invocation, probe: last };
  }
  return { probe: last };
}

function probeStatus(result: ProcessResult): SolverDoctorEntry['status'] {
  if (result.status === 'missing') return 'missing';
  if (result.status === 'timeout') return 'timeout';
  if (result.status !== 'completed' || result.exitCode !== 0) return 'error';
  return 'available';
}

export async function formalDoctor(
  root: string,
  options: FormalCheckOptions = {},
  runner: Runner = runProcess,
): Promise<SolverDoctorResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const solvers: SolverDoctorEntry[] = [];
  for (const name of ['z3', 'lean'] as const) {
    const found = await findSolver(name, root, timeoutMs, options, runner);
    const status = probeStatus(found.probe);
    const invocation = found.invocation ?? commandFor(name, options)[0]!;
    const output = (found.probe.stdout + found.probe.stderr).trim();
    solvers.push({
      name,
      available: status === 'available',
      command: [invocation.command, ...invocation.prefixArgs].join(' '),
      version: status === 'available' ? output.split(/\r?\n/, 1)[0] ?? '' : '',
      status,
      output,
    });
  }
  return { available: solvers.some((entry) => entry.available), solvers };
}

function initialResult(model: FormalModel, requested: Solver): FormalResult {
  return {
    valid: model.validRequirements && model.consistency === 'consistent' && (model.literals.length > 0 || model.constraints.length > 0),
    abstraction,
    assumptions,
    literals: model.literals,
    constraints: model.constraints,
    unsupported: model.unsupported,
    diagnostics: model.diagnostics,
    consistency: model.consistency,
    solver: {
      requested,
      name: requested,
      command: '',
      version: '',
      status: 'not-requested',
      durationMs: 0,
      output: '',
    },
  };
}

function executionStatus(execution: ProcessResult): 'missing' | 'timeout' | 'error' | undefined {
  if (execution.status === 'missing') return 'missing';
  if (execution.status === 'timeout') return 'timeout';
  if (execution.status !== 'completed' || execution.exitCode !== 0) return 'error';
  return undefined;
}

export async function formalCheck(
  text: string,
  root: string,
  solverOrOptions: Solver | FormalCheckOptions = 'auto',
  runner: Runner = runProcess,
): Promise<FormalResult> {
  const options = typeof solverOrOptions === 'string' ? { solver: solverOrOptions } : solverOrOptions;
  const requested = options.solver ?? 'auto';
  const timeoutMs = options.timeoutMs ?? 12_000;
  const model = buildModel(text);
  const result = initialResult(model, requested);
  if (!model.validRequirements || requested === 'none' || (!model.literals.length && !model.constraints.length)) {
    result.solver.output = !model.validRequirements
      ? 'Invalid requirement syntax; solver not run.'
      : !model.literals.length && !model.constraints.length
        ? 'No supported obligations; solver not run.'
        : 'Solver execution disabled.';
    return result;
  }

  let selected: { invocation: SolverInvocation; probe: ProcessResult } | undefined;
  for (const candidate of requested === 'auto' ? ['z3', 'lean'] as const : [requested]) {
    const found = await findSolver(candidate, root, Math.min(timeoutMs, 5_000), options, runner);
    if (!found.invocation && found.probe.status === 'missing') continue;
    if (!found.invocation || probeStatus(found.probe) !== 'available') {
      const invocation = found.invocation ?? commandFor(candidate, options)[0]!;
      result.solver = {
        requested,
        name: candidate,
        command: [invocation.command, ...invocation.prefixArgs].join(' '),
        version: '',
        status: found.probe.status === 'timeout' ? 'timeout' : 'error',
        durationMs: found.probe.durationMs,
        output: (found.probe.stderr || found.probe.stdout).trim(),
      };
      result.valid = false;
      return result;
    }
    selected = { invocation: found.invocation, probe: found.probe };
    break;
  }
  if (!selected) {
    result.solver = {
      requested,
      name: requested,
      command: '',
      version: '',
      status: 'missing',
      durationMs: 0,
      output: 'No requested solver installed; deterministic checks only.',
    };
    if (requested !== 'auto') result.valid = false;
    return result;
  }

  const version = (selected.probe.stdout + selected.probe.stderr).trim().split(/\r?\n/, 1)[0] ?? '';
  const command = [selected.invocation.command, ...selected.invocation.prefixArgs].join(' ');
  if (selected.invocation.name === 'z3') {
    const script = generateSmt2(model);
    const generated = await writeArtifact(root, 'smt2', script);
    const execution = await runner(
      selected.invocation.command,
      [...selected.invocation.prefixArgs, '-in', '-smt2', `-T:${Math.max(1, Math.ceil(timeoutMs / 1_000))}`],
      { cwd: root, timeoutMs, input: `${script}\n` },
    );
    const failed = executionStatus(execution);
    const answer = execution.stdout.trim();
    const status: SolverStatus = failed ?? (answer === 'sat' ? 'sat' : answer === 'unsat' ? 'unsat' : 'unknown');
    result.solver = {
      requested,
      name: 'z3',
      command,
      version,
      status,
      durationMs: execution.durationMs,
      output: (execution.stdout + execution.stderr).trim(),
      artifact: generated,
    };
    if (status === 'unsat') result.consistency = 'inconsistent';
    if (status === 'sat') result.consistency = 'consistent';
    if (status !== 'sat' || model.consistency !== 'consistent') result.valid = false;
    if ((status === 'sat' && model.consistency === 'inconsistent') || (status === 'unsat' && model.consistency === 'consistent')) {
      result.diagnostics.push(error('FORMAL_SOLVER_MISMATCH', 'Z3 result disagrees with the deterministic contradiction check.'));
    }
  } else {
    const script = generateLean(model);
    const generated = await writeArtifact(root, 'lean', script);
    const execution = await runner(
      selected.invocation.command,
      [...selected.invocation.prefixArgs, generated.path],
      { cwd: root, timeoutMs },
    );
    const failed = executionStatus(execution);
    const status: SolverStatus = failed ?? 'checked';
    result.solver = {
      requested,
      name: 'lean',
      command,
      version,
      status,
      durationMs: execution.durationMs,
      output: (execution.stdout + execution.stderr).trim()
        || (status === 'checked'
          ? `Lean checked the ${model.consistency === 'inconsistent' ? 'unsatisfiability' : 'satisfiability'} theorem for the normalized constraint model.`
          : ''),
      artifact: generated,
    };
    if (status !== 'checked') result.valid = false;
  }
  return result;
}
