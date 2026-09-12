import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { safePath } from './files.js';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertSlug(slug: string): string {
  if (!slugPattern.test(slug)) throw new Error(`Invalid feature slug "${slug}": must be lowercase kebab-case, e.g. "my-feature".`);
  return slug.toUpperCase();
}

function assertTitle(title: string | undefined, fallback: string): string {
  if (title === undefined) return fallback;
  if (!title.trim() || /[\r\n]/.test(title)) throw new Error(`Invalid --title "${title}": must be a non-empty, single-line value.`);
  return title;
}

// Exclusive creation (fs "wx" flag) makes the existing-file check atomic with the
// write itself, so a file created between an earlier `exists()` check and this
// call is never silently overwritten; EEXIST is translated into the required error.
async function scaffold(root: string, path: string, content: string): Promise<string> {
  const absolute = await safePath(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  try {
    await writeFile(absolute, content, { flag: 'wx' });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Refusing to overwrite existing file: ${path}`);
    throw cause;
  }
  return path;
}

/* @id CODE-REQUIREMENTS-DESIGN-SCAFFOLD-001
 * @implements REQ-REQUIREMENTS-DESIGN-SCAFFOLD-001 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-002 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-005 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-006
 * @design DES-REQUIREMENTS-DESIGN-SCAFFOLD-001
 */
export async function scaffoldRequirements(root: string, slug: string, options: { title?: string } = {}): Promise<string> {
  const id = assertSlug(slug);
  const title = assertTitle(options.title, 'Describe the requirement');
  const path = `.musubix/features/${slug}/requirements.md`;
  const content = `---
schemaVersion: 1
feature: ${slug}
---
# Requirements / 要求

## REQ-${id}-001: ${title}
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall TODO: describe the required behavior.
Acceptance: TODO: describe how this requirement will be verified.
`;
  return scaffold(root, path, content);
}

/* @id CODE-REQUIREMENTS-DESIGN-SCAFFOLD-002
 * @implements REQ-REQUIREMENTS-DESIGN-SCAFFOLD-003 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-004 REQ-REQUIREMENTS-DESIGN-SCAFFOLD-005
 * @design DES-REQUIREMENTS-DESIGN-SCAFFOLD-001
 */
export async function scaffoldDesign(root: string, slug: string): Promise<string> {
  const id = assertSlug(slug);
  const path = `.musubix/features/${slug}/design.md`;
  const content = `---
schemaVersion: 1
feature: ${slug}
---
# Design / 設計

## DES-${id}-001: Describe the component
Responsibilities: TODO: describe the component's responsibilities.
Interfaces: TODO: describe the component's interfaces.
Constraints: TODO: describe the component's constraints.
Requirements: REQ-${id}-001
ADRs: none — TODO: record a decision if one becomes relevant.
Depends-On: none
`;
  return scaffold(root, path, content);
}
