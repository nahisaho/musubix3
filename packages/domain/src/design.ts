import { duplicates, field, markdown, references } from './markdown.js';
import { error, ids, validation, type Component, type Validation } from './types.js';

export interface DesignContext {
  requirementIds?: ReadonlySet<string>;
  adrIds?: ReadonlySet<string>;
  designIds?: ReadonlySet<string>;
}

export function validateDesign(text: string, path = '<input>', context: DesignContext = {}): Validation<Component[]> {
  const parsed = markdown(text, path);
  const sections = parsed.sections.filter((s) => /^DES-/i.test(s.id));
  const diagnostics = [...parsed.diagnostics, ...duplicates(sections, path)];
  if (parsed.metadata.schemaVersion !== undefined && parsed.metadata.schemaVersion !== 1) diagnostics.push(error('DES_SCHEMA', 'Unsupported schemaVersion; expected 1.', path));
  if (!sections.length) diagnostics.push(error('DES_MISSING', 'No components found (## DES-FEATURE-001: Title).', path));
  /* @id CODE-DESIGN-ADR-NONE-EXEMPTION-001
   * @implements REQ-DESIGN-ADR-NONE-EXEMPTION-001 REQ-DESIGN-ADR-NONE-EXEMPTION-002 REQ-DESIGN-ADR-NONE-EXEMPTION-003
   * @design DES-DESIGN-ADR-NONE-EXEMPTION-001
   */
  const value = sections.map((s): Component => {
    if (!ids.design.test(s.id)) diagnostics.push(error('DES_ID', `Invalid design ID ${s.id}.`, path, s.line));
    if (!s.title) diagnostics.push(error('DES_TITLE', 'Component title is required.', path, s.line));
    const responsibility = field(s.body, 'Responsibilities|Responsibility|責務');
    const interfaces = field(s.body, 'Interfaces|Interface|インターフェース');
    const constraints = field(s.body, 'Constraints|制約');
    for (const [name, content] of Object.entries({ responsibility, interfaces, constraints })) {
      if (!content || /^(TODO|TBD|N\/A|未定)$/i.test(content)) diagnostics.push(error('DES_FIELD', `${s.id} requires concrete ${name}.`, path, s.line));
    }
    const requirements = references(field(s.body, 'Requirements|要求'), 'REQ');
    const adrField = field(s.body, 'ADRs|ADR|決定');
    const decisions = references(adrField, 'ADR');
    const dependencies = references(field(s.body, 'Depends-On|依存'), 'DES');
    if (!requirements.length) diagnostics.push(error('DES_REQUIREMENTS', `${s.id} must link requirements.`, path, s.line));
    if (!decisions.length) {
      const exemption = /^none(?:\s*[-–—:]\s*(.*))?$/i.exec(adrField.trim());
      if (exemption) {
        const reason = exemption[1]?.trim() ?? '';
        if (!reason || /^(TODO|TBD|N\/A|未定)$/i.test(reason)) diagnostics.push(error('DES_ADR_EXEMPTION_REASON', `${s.id} declares "none" but must give a concrete reason (e.g. "none — <reason>").`, path, s.line));
      } else {
        diagnostics.push(error('DES_ADR', `${s.id} must reference an ADR.`, path, s.line));
      }
    }
    for (const id of requirements) {
      if (!ids.requirement.test(id) || (context.requirementIds && !context.requirementIds.has(id))) diagnostics.push(error('DES_REQUIREMENT_LINK', `Unknown or invalid requirement ${id}.`, path, s.line));
    }
    for (const id of decisions) {
      if (!ids.adr.test(id) || (context.adrIds && !context.adrIds.has(id))) diagnostics.push(error('DES_ADR_LINK', `Unknown or invalid ADR ${id}.`, path, s.line));
    }
    for (const id of dependencies) {
      if (!ids.design.test(id) || (context.designIds && !context.designIds.has(id))) diagnostics.push(error('DES_DEPENDENCY', `Unknown or invalid component dependency ${id}.`, path, s.line));
    }
    return { id: s.id, title: s.title, responsibility, interfaces, constraints, requirements, decisions, dependencies, line: s.line };
  });
  return validation(value, diagnostics);
}

export function c4Diagram(components: Component[]): string {
  const quote = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/[<>\r\n]/g, ' ');
  const key = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = ['flowchart LR', '  subgraph System["System / システム"]'];
  for (const c of components) lines.push(`    ${key(c.id)}["${quote(c.id)}: ${quote(c.title)}<br/>${quote(c.responsibility)}"]`);
  lines.push('  end');
  for (const c of components) {
    for (const dependency of c.dependencies) lines.push(`  ${key(c.id)} --> ${key(dependency)}`);
  }
  return `${lines.join('\n')}\n`;
}
