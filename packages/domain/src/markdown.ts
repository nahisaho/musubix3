import { parseDocument } from 'yaml';
import { error, type Diagnostic } from './types.js';

export interface Section {
  id: string;
  title: string;
  body: string;
  line: number;
  level: number;
}

export function markdown(text: string, path = '<input>'): {
  metadata: Record<string, unknown>;
  sections: Section[];
  diagnostics: Diagnostic[];
} {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  const diagnostics: Diagnostic[] = [];
  let metadata: Record<string, unknown> = {};
  let start = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
    if (end === -1) {
      diagnostics.push(error('MARKDOWN_FRONTMATTER', 'Unterminated YAML frontmatter.', path, 1));
      start = lines.length;
    } else {
      const doc = parseDocument(lines.slice(1, end).join('\n'), { uniqueKeys: true });
      if (doc.errors.length) {
        diagnostics.push(error('MARKDOWN_FRONTMATTER', doc.errors.map((e) => e.message).join('; '), path, 1));
      } else {
        const value: unknown = doc.toJSON();
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          metadata = value as Record<string, unknown>;
        } else {
          diagnostics.push(error('MARKDOWN_FRONTMATTER', 'Frontmatter must be a mapping.', path, 1));
        }
      }
      start = end + 1;
    }
  }
  const sections: Section[] = [];
  let current: Section | undefined;
  let fence: string | undefined;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = delimiter;
      else if (delimiter[0] === fence[0] && delimiter.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{2,6})\s+([A-Za-z]+-[^\s:：]+)(?:\s*[:：-]\s*|\s+)?(.*)$/.exec(line);
    if (heading) {
      current = { id: heading[2] ?? '', title: heading[3]?.trim() ?? '', body: '', line: i + 1, level: heading[1]?.length ?? 2 };
      sections.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  return { metadata, sections, diagnostics };
}

export function field(body: string, names: string): string {
  return new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?(?:${names})(?:\\*\\*)?\\s*[:：]\\s*(.+)$`, 'im').exec(body)?.[1]?.trim() ?? '';
}

export function references(text: string, prefix: string): string[] {
  return [...new Set(text.match(new RegExp(`\\b${prefix}-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\\b`, 'g')) ?? [])];
}

export function duplicates(sections: Section[], path: string): Diagnostic[] {
  const seen = new Set<string>();
  return sections.flatMap((section) => {
    if (seen.has(section.id)) return [error('DUPLICATE_ID', `Duplicate ID ${section.id}.`, path, section.line)];
    seen.add(section.id);
    return [];
  });
}
