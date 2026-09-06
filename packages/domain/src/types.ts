export type Severity = 'error' | 'warning';
export type CheckStatus = 'pass' | 'fail' | 'skipped';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  path?: string;
  line?: number;
}

export interface Validation<T> {
  valid: boolean;
  value: T;
  diagnostics: Diagnostic[];
}

export function validation<T>(value: T, diagnostics: Diagnostic[]): Validation<T> {
  return { valid: !diagnostics.some((d) => d.severity === 'error'), value, diagnostics };
}

export function error(code: string, message: string, path?: string, line?: number): Diagnostic {
  return { code, severity: 'error', message, ...(path ? { path } : {}), ...(line ? { line } : {}) };
}

export const ids = {
  requirement: /^REQ-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3,}$/,
  design: /^DES-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3,}$/,
  code: /^CODE-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3,}$/,
  test: /^TEST-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3,}$/,
  adr: /^ADR-\d{4,}$/,
};

export interface Requirement {
  id: string;
  title: string;
  statement: string;
  acceptance: string;
  priority: 'must' | 'should' | 'may';
  type: 'functional' | 'non-functional';
  pattern: EarsPattern | null;
  formal: FormalConstraint | null;
  performance: PerformanceBudget | null;
  line: number;
}

export type EarsPattern = 'ubiquitous' | 'event-driven' | 'state-driven' |
  'unwanted-behavior' | 'optional-feature' | 'complex';

export type FormalConstraint =
  | { kind: 'conditional'; condition: string; consequence: string; conditionValue: boolean; consequenceValue: boolean }
  | { kind: 'numeric'; metric: string; operator: '<' | '<=' | '=' | '>=' | '>'; value: number; unit?: string }
  | { kind: 'temporal'; trigger: string; response: string; withinMs: number; afterMs?: number }
  | { kind: 'transition'; from: string; event: string; to: string };

export interface PerformanceBudget {
  counter: string;
  max: number;
  testId: string;
  unit: 'operations';
}

export interface Component {
  id: string;
  title: string;
  responsibility: string;
  interfaces: string;
  constraints: string;
  requirements: string[];
  decisions: string[];
  dependencies: string[];
  line: number;
}

export interface ConstitutionRule {
  id: string;
  principle: string;
  metric: string;
  limit: number;
  line: number;
}

export interface Constitution {
  version: string;
  principles: string[];
  rules: ConstitutionRule[];
}

export interface Evidence {
  name: string;
  status: CheckStatus;
  required: boolean;
  summary: string;
  diagnostics?: Diagnostic[];
  durationMs?: number;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
}
