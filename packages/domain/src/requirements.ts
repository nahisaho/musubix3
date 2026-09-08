import { duplicates, field, markdown } from './markdown.js';
import {
  error, ids, validation, type EarsPattern, type FormalConstraint, type PerformanceBudget,
  type Requirement, type Validation,
} from './types.js';

function explicitObject(text: string, fieldName: string, path: string, line: number, diagnostics: ReturnType<typeof error>[]): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be a JSON object');
    return value as Record<string, unknown>;
  } catch (cause) {
    diagnostics.push(error(`REQ_${fieldName.toUpperCase()}_SCHEMA`, `${fieldName} must be strict single-line JSON: ${cause instanceof Error ? cause.message : String(cause)}.`, path, line));
    return null;
  }
}

function exactKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function atom(value: unknown): value is string {
  return typeof value === 'string' && /^[\p{L}_][\p{L}\p{N}_.:-]{0,127}$/u.test(value);
}

const FORMAL_KEYS: Record<string, string[]> = {
  conditional: ['kind', 'condition', 'consequence', 'conditionValue', 'consequenceValue'],
  numeric: ['kind', 'metric', 'operator', 'value', 'unit'],
  temporal: ['kind', 'trigger', 'response', 'withinMs', 'afterMs'],
  transition: ['kind', 'from', 'event', 'to'],
};

const FORMAL_FIELDS: Record<string, string> = {
  condition: 'required identifier', consequence: 'required identifier',
  conditionValue: 'optional boolean', consequenceValue: 'optional boolean',
  metric: 'required identifier', operator: 'required one of <, <=, =, >=, >',
  value: 'required safe integer', unit: 'optional identifier',
  trigger: 'required identifier', response: 'required identifier',
  withinMs: 'required positive integer', afterMs: 'optional nonnegative integer',
  from: 'required identifier', event: 'required identifier', to: 'required identifier',
};

function formalReason(value: Record<string, unknown>): string {
  const kind = typeof value.kind === 'string' ? value.kind : '';
  const allowed = FORMAL_KEYS[kind];
  if (!allowed) {
    return `kind must be one of conditional, numeric, temporal, transition (received ${kind ? JSON.stringify(kind) : 'no kind'})`;
  }
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) return `kind ${kind} rejects unexpected key(s) ${unexpected.join(', ')}; allowed keys are ${allowed.join(', ')}`;
  const missing = allowed.filter((key) => key !== 'kind' && value[key] === undefined && !FORMAL_FIELDS[key]?.startsWith('optional'));
  if (missing.length) return `kind ${kind} is missing required key(s) ${missing.map((key) => `${key} (${FORMAL_FIELDS[key]})`).join(', ')}`;
  const invalid = allowed.filter((key) => key !== 'kind' && value[key] !== undefined);
  return `kind ${kind} has an invalid value for one of ${invalid.map((key) => `${key} (${FORMAL_FIELDS[key]})`).join(', ')}`;
}

function parseFormal(text: string, path: string, line: number, diagnostics: ReturnType<typeof error>[]): FormalConstraint | null {
  const value = explicitObject(text, 'formal', path, line, diagnostics);
  if (!value) return null;
  let constraint: FormalConstraint | null = null;
  if (value.kind === 'conditional'
    && exactKeys(value, ['kind', 'condition', 'consequence', 'conditionValue', 'consequenceValue'])
    && atom(value.condition) && atom(value.consequence)
    && (value.conditionValue === undefined || typeof value.conditionValue === 'boolean')
    && (value.consequenceValue === undefined || typeof value.consequenceValue === 'boolean')) {
    constraint = {
      kind: 'conditional',
      condition: value.condition,
      consequence: value.consequence,
      conditionValue: value.conditionValue !== false,
      consequenceValue: value.consequenceValue !== false,
    };
  } else if (value.kind === 'numeric'
    && exactKeys(value, ['kind', 'metric', 'operator', 'value', 'unit'])
    && atom(value.metric) && ['<', '<=', '=', '>=', '>'].includes(String(value.operator))
    && typeof value.value === 'number' && Number.isSafeInteger(value.value)
    && (value.unit === undefined || atom(value.unit))) {
    constraint = {
      kind: 'numeric',
      metric: value.metric,
      operator: value.operator as '<' | '<=' | '=' | '>=' | '>',
      value: value.value,
      ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
    };
  } else if (value.kind === 'temporal'
    && exactKeys(value, ['kind', 'trigger', 'response', 'withinMs', 'afterMs'])
    && atom(value.trigger) && atom(value.response)
    && (value.afterMs === undefined
      || (typeof value.afterMs === 'number' && Number.isSafeInteger(value.afterMs) && value.afterMs >= 0))
    && typeof value.withinMs === 'number' && Number.isSafeInteger(value.withinMs) && value.withinMs > 0) {
    constraint = {
      kind: 'temporal',
      trigger: value.trigger,
      response: value.response,
      withinMs: value.withinMs,
      ...(typeof value.afterMs === 'number' ? { afterMs: value.afterMs } : {}),
    };
  } else if (value.kind === 'transition'
    && exactKeys(value, ['kind', 'from', 'event', 'to'])
    && atom(value.from) && atom(value.event) && atom(value.to)) {
    constraint = { kind: 'transition', from: value.from, event: value.event, to: value.to };
  }
  if (!constraint) diagnostics.push(error('REQ_FORMAL_SCHEMA', `Formal must match the conditional, numeric, temporal, or transition constraint schema: ${formalReason(value)}.`, path, line));
  return constraint;
}

function parsePerformance(text: string, path: string, line: number, diagnostics: ReturnType<typeof error>[]): PerformanceBudget | null {
  const value = explicitObject(text, 'performance', path, line, diagnostics);
  if (!value) return null;
  if (!exactKeys(value, ['counter', 'max', 'testId', 'unit'])
    || !atom(value.counter)
    || typeof value.max !== 'number' || !Number.isSafeInteger(value.max) || value.max < 0
    || typeof value.testId !== 'string' || !ids.test.test(value.testId)
    || (value.unit !== undefined && value.unit !== 'operations')) {
    diagnostics.push(error('REQ_PERFORMANCE_SCHEMA', 'Performance must contain counter, nonnegative integer max, TEST-* testId, and optional unit \"operations\".', path, line));
    return null;
  }
  return { counter: value.counter, max: value.max, testId: value.testId, unit: 'operations' };
}

export function classifyEars(statement: string): EarsPattern | null {
  const s = statement.trim().replace(/\s+/g, ' ');
  if ((s.match(/\bshall\b/gi) ?? []).length > 1 || (s.match(/しなければならない|してはならない|してはいけない|すること/g) ?? []).length > 1) return null;
  const english = /^(?:(.*,\s*(?:then\s+)?))?((?:the|a|an)\s+[^,]+?)\s+shall\s+(.+)$/i.exec(s);
  if (english) {
    const prefix = (english[1] ?? '').trim();
    if (!english[3]?.replace(/^not\s*/i, '').replace(/[.!]/g, '').trim()) return null;
    if (!prefix) return 'ubiquitous';
    if (/^if\s+.+,\s*then\s*$/i.test(prefix)) return 'unwanted-behavior';
    const clauses = [...prefix.matchAll(/(?:^|,\s*)(while|when|where)\s+([^,]+)/gi)];
    if (clauses.length && clauses.every((c) => c[2]?.trim())) {
      const reconstructed = clauses.map((c) => `${c[1]} ${c[2]}`).join(', ');
      if (reconstructed.toLowerCase() !== prefix.replace(/,\s*$/, '').toLowerCase()) return null;
      const kinds = new Set(clauses.map((c) => c[1]?.toLowerCase()));
      if (clauses.length > 1 && kinds.size > 1) return 'complex';
      if (clauses.length === 1) {
        return ({ when: 'event-driven', while: 'state-driven', where: 'optional-feature' } as const)[clauses[0]?.[1]?.toLowerCase() as 'when' | 'while' | 'where'] ?? null;
      }
    }
    return null;
  }
  // Japanese uses an explicit topic subject and obligation marker; free prose is deliberately not inferred.
  const japanese = /^(?:(.*)[、,]\s*)?([^、,]+?)は(.+?)(?:しなければならない|してはならない|してはいけない|すること)[。.]?$/.exec(s);
  if (!japanese || !japanese[2]?.trim() || !japanese[3]?.trim()) return null;
  const prefix = japanese[1]?.trim() ?? '';
  if (!prefix) return 'ubiquitous';
  if (/^もし.+ならば$/.test(prefix)) return 'unwanted-behavior';
  const clauses = prefix.split(/[、,]\s*/).filter(Boolean);
  const kinds = clauses.map((c) => /.+(?:とき|時)$/.test(c) ? 'event-driven' : /.+(?:間|中)$/.test(c) ? 'state-driven' : /.+場合$/.test(c) ? 'optional-feature' : null);
  if (kinds.some((k) => !k)) return null;
  if (kinds.length > 1 && new Set(kinds).size > 1) return 'complex';
  return kinds.length === 1 ? kinds[0] as EarsPattern : null;
}

export function validateRequirements(text: string, path = '<input>'): Validation<Requirement[]> {
  const parsed = markdown(text, path);
  const sections = parsed.sections.filter((s) => /^REQ-/i.test(s.id));
  const diagnostics = [...parsed.diagnostics, ...duplicates(sections, path)];
  if (parsed.metadata.schemaVersion !== undefined && parsed.metadata.schemaVersion !== 1) diagnostics.push(error('REQ_SCHEMA', 'Unsupported schemaVersion; expected 1.', path));
  if (!sections.length) diagnostics.push(error('REQ_MISSING', 'No requirement headings found (## REQ-FEATURE-001: Title).', path));
  const value: Requirement[] = sections.map((section) => {
    if (!ids.requirement.test(section.id)) diagnostics.push(error('REQ_ID', `Invalid requirement ID ${section.id}.`, path, section.line));
    if (!section.title) diagnostics.push(error('REQ_TITLE', 'Requirement title is required.', path, section.line));
    const rawPriority = field(section.body, 'Priority|優先度').toLowerCase() || 'must';
    if (!['must', 'should', 'may'].includes(rawPriority)) diagnostics.push(error('REQ_PRIORITY', 'Priority must be must, should, or may.', path, section.line));
    const rawType = field(section.body, 'Type|種別').toLowerCase() || 'functional';
    if (!['functional', 'non-functional'].includes(rawType)) {
      diagnostics.push(error('REQ_TYPE', 'Requirement type must be functional or non-functional.', path, section.line));
    }
    const statement = field(section.body, 'Statement|要求') || section.body.split('\n')
      .filter((line) => !/^\s*(?:[-*]\s+)?(?:\*\*)?(Priority|Type|Pattern|Acceptance|Formal|Performance|優先度|種別|パターン|受入条件|形式制約|性能予算)(?:\*\*)?\s*[:：]/i.test(line))
      .join(' ').trim();
    const pattern = classifyEars(statement);
    if (!pattern) {
      const normalized = statement.trim().replace(/\s+/g, ' ');
      const obligations = (normalized.match(/\bshall\b/gi) ?? []).length
        + (normalized.match(/しなければならない|してはならない|してはいけない|すること/g) ?? []).length;
      const reason = obligations > 1
        ? ` This statement declares ${obligations} obligations; split it so exactly one "shall"/obligation remains per requirement.`
        : '';
      diagnostics.push(error(
        'REQ_EARS',
        `Use one complete controlled EARS statement.${reason} English example: "When an event occurs, the system shall respond." Japanese example: "イベントが発生したとき、APIは応答しなければならない。"`,
        path,
        section.line,
      ));
    }
    const declared = field(section.body, 'Pattern|パターン').toLowerCase();
    if (declared && declared !== pattern) {
      diagnostics.push(error('REQ_PATTERN', `Declared pattern ${declared} does not match detected pattern ${pattern ?? 'invalid'}. Valid patterns are ubiquitous, event-driven, state-driven, unwanted-behavior, optional-feature, complex.`, path, section.line));
    }
    const acceptance = field(section.body, 'Acceptance|受入条件');
    const formal = parseFormal(field(section.body, 'Formal|形式制約'), path, section.line, diagnostics);
    const performance = parsePerformance(field(section.body, 'Performance|性能予算'), path, section.line, diagnostics);
    if (performance && rawType !== 'non-functional') {
      diagnostics.push(error('REQ_PERFORMANCE_TYPE', 'Deterministic performance budgets are only valid on non-functional requirements.', path, section.line));
    }
    return {
      id: section.id,
      title: section.title,
      priority: rawPriority as Requirement['priority'],
      type: rawType as Requirement['type'],
      statement,
      pattern,
      acceptance,
      formal,
      performance,
      line: section.line,
    };
  });
  const statements = new Map<string, Requirement>();
  for (const requirement of value) {
    const normalized = requirement.statement.normalize('NFKC').toLowerCase().replace(/[。.!]/g, '').replace(/\s+/g, ' ').trim();
    const previous = statements.get(normalized);
    if (previous) {
      diagnostics.push(error('REQ_DUPLICATE_STATEMENT', `${requirement.id} duplicates the normalized statement of ${previous.id}.`, path, requirement.line));
    } else statements.set(normalized, requirement);
  }
  return validation(value, diagnostics);
}
