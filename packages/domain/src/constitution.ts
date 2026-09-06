import { duplicates, field, markdown } from './markdown.js';
import { error, validation, type Constitution, type ConstitutionRule, type Validation } from './types.js';

export const constitutionMetrics = [
  'requirements.errors', 'design.errors', 'trace.errors', 'graph.violations',
  'commands.failures', 'commands.skipped',
] as const;

export function validateConstitution(text: string, path = '<input>'): Validation<Constitution> {
  const parsed = markdown(text, path);
  const version = String(parsed.metadata.version ?? '');
  const diagnostics = [...parsed.diagnostics, ...duplicates(parsed.sections, path)];
  if (!/^\d+\.\d+\.\d+$/.test(version)) diagnostics.push(error('CONST_VERSION', 'Frontmatter version must be a semantic version (e.g. 1.0.0).', path, 1));
  const principles: string[] = [];
  const rules: ConstitutionRule[] = [];
  let principle = '';
  for (const section of parsed.sections) {
    if (/^PRINC-/i.test(section.id)) {
      principle = section.id;
      principles.push(principle);
      if (!/^PRINC-\d{3,}$/.test(principle) || !section.title) diagnostics.push(error('CONST_PRINCIPLE', 'Principles need a PRINC-001 ID and title.', path, section.line));
    } else if (/^RULE-/i.test(section.id)) {
      if (!/^RULE-\d{3,}$/.test(section.id) || !section.title || !principle) diagnostics.push(error('CONST_RULE', 'Rules need a RULE-001 ID, title, and preceding principle.', path, section.line));
      const metric = field(section.body, 'Metric|指標');
      const rawLimit = field(section.body, 'Limit|上限');
      const limit = Number(rawLimit);
      if (!constitutionMetrics.includes(metric as typeof constitutionMetrics[number])) diagnostics.push(error('CONST_METRIC', `Unsupported metric ${metric || '(missing)'}. Supported: ${constitutionMetrics.join(', ')}.`, path, section.line));
      if (!rawLimit || !Number.isFinite(limit) || limit < 0) diagnostics.push(error('CONST_LIMIT', 'A measurable nonnegative numeric upper limit is required.', path, section.line));
      rules.push({ id: section.id, principle, metric, limit, line: section.line });
    }
  }
  if (!principles.length) diagnostics.push(error('CONST_PRINCIPLES_MISSING', 'At least one versioned principle is required.', path));
  if (!rules.length) diagnostics.push(error('CONST_RULES_MISSING', 'At least one measurable rule is required.', path));
  for (const id of principles) {
    if (!rules.some((r) => r.principle === id)) diagnostics.push(error('CONST_EMPTY_PRINCIPLE', `${id} has no measurable rules.`, path));
  }
  return validation({ version, principles, rules }, diagnostics);
}
