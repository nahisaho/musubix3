// CHANGE-0038: scoped per-feature trace projection + canonical trace.json (see DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001..004).
// CHANGE-0038 (corrective Red-Implementation-Green batch): re-proved TDD evidence inside the change's valid order window.
// CHANGE-0038 (2nd corrective batch): confirmed by expanded acceptance-clause test coverage; no behavior change.
// CHANGE-0038 (4th corrective batch): confirmed by persisted-file shared-node/Depends-On
// coverage (REQ-001) and cache-vs-fallback checkTrace equality coverage (REQ-004); no behavior change.
// CHANGE-0038 (5th corrective batch): re-bounded REQ-004's TDD evidence window
// after an earlier batch's order sequencing mistake; no behavior change.
// CHANGE-0038 (6th corrective batch): re-bounded REQ-004's window a second time
// after pairing it with REQ-005's own window fix; no behavior change.
import ts from 'typescript';
import { dirname, basename } from 'node:path';
import { error, ids, validateDesign, validateRequirements, type Diagnostic } from '../../domain/src/index.js';
import { exists, files, isArtifact, isSkillSource, isSource, isTraceSource, readText, snapshot, within, writeJson } from './files.js';
import { withEvidenceWriterLock } from './evidence-writer-lock.js';

export interface TraceNode {
  id: string;
  kind: 'requirement' | 'design' | 'code' | 'test' | 'adr';
  path: string;
  line: number;
  mandatory?: boolean;
}

export interface TraceEdge {
  from: string;
  to: string;
  relation: 'satisfies' | 'implements' | 'verifies' | 'decides' | 'depends-on';
}

export interface TraceGraph {
  schemaVersion: 1;
  generatedAt: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
  diagnostics: Diagnostic[];
  fingerprints: Record<string, string>;
}

/** @id CODE-SESSION-SCOPED-DEVELOPMENT-003
 * @implements REQ-SESSION-SCOPED-DEVELOPMENT-001 REQ-SESSION-SCOPED-DEVELOPMENT-002
 * @design DES-SESSION-SCOPED-DEVELOPMENT-002
 */
export async function traceInputs(root: string): Promise<string[]> {
  const projectFiles = await files(root);
  let isMusubixRepository = false;
  try {
    const packageManifest = JSON.parse(await readText(root, 'package.json')) as { name?: string };
    isMusubixRepository = packageManifest.name === 'musubix3';
  } catch {
    // Consumer projects do not need to trace musubix3's own Skill definitions.
  }
  return projectFiles.filter((path) => isArtifact(path) || isTraceSource(path) || (isMusubixRepository && isSkillSource(path)));
}

function typedCommentBlocks(text: string, path: string): { text: string; line: number }[] {
  // Parser-aware comment locations avoid treating template tails or regex text as comments.
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, ts.CommentRange>();
  const literals: { start: number; end: number }[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) || ts.isRegularExpressionLiteral(node) ||
      node.kind === ts.SyntaxKind.TemplateHead || node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail || node.kind === ts.SyntaxKind.JsxText) {
      literals.push({ start: node.kind === ts.SyntaxKind.JsxText ? node.pos : node.getStart(source), end: node.end });
    }
    for (const range of [
      ...ts.getLeadingCommentRanges(text, node.pos) ?? [],
      ...ts.getTrailingCommentRanges(text, node.end) ?? [],
    ]) ranges.set(range.pos, range);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...ranges.values()].filter((range) => !literals.some((literal) => range.pos >= literal.start && range.pos < literal.end))
    .sort((a, b) => a.pos - b.pos).map((range) => ({
    text: text.slice(range.pos, range.end), line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
  }));
}

function maskGenericStrings(text: string, path: string): string {
  const mask = (value: string): string => value.replace(/[^\r\n]/g, ' ');
  if (path.endsWith('.hs')) {
    return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])'/g, mask);
  }
  if (path.endsWith('.lua')) {
    return text.replace(/(?<!--)\[(=*)\[[\s\S]*?\]\1\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, mask);
  }
  if (path.endsWith('.vb')) {
    return text.replace(/"(?:[^"]|"")*"/g, mask);
  }
  const chars = [...text];
  const quotes = path.endsWith('.rs') || /\.(?:fs|fsx)$/.test(path) ? ['"'] : ['"', "'", '`'];
  for (let index = 0; index < chars.length; index += 1) {
    const quote = chars[index]!;
    if (!quotes.includes(quote)) continue;
    const triple = chars[index + 1] === quote && chars[index + 2] === quote;
    const endToken = triple ? quote.repeat(3) : quote;
    const start = index;
    index += endToken.length;
    while (index < chars.length) {
      if (!triple && chars[index] === '\\') {
        chars[index] = ' ';
        if (chars[index + 1] !== '\n' && chars[index + 1] !== '\r') chars[index + 1] = ' ';
        index += 2;
        continue;
      }
      if (text.startsWith(endToken, index)) {
        index += endToken.length - 1;
        break;
      }
      if (chars[index] !== '\n' && chars[index] !== '\r') chars[index] = ' ';
      index += 1;
    }
    for (let cursor = start; cursor <= index && cursor < chars.length; cursor += 1) {
      if (chars[cursor] !== '\n' && chars[cursor] !== '\r') chars[cursor] = ' ';
    }
  }
  return chars.join('');
}

function genericCommentBlocks(text: string, path: string): { text: string; line: number }[] {
  const searchable = maskGenericStrings(text, path);
  const matches: { text: string; index: number; end: number }[] = [];
  const nestedBlock = path.endsWith('.hs')
    ? { open: '{-', close: '-}' }
    : /\.(?:fs|fsx)$/.test(path)
      ? { open: '(*', close: '*)' }
      : undefined;
  if (nestedBlock) {
    for (let start = searchable.indexOf(nestedBlock.open); start >= 0; start = searchable.indexOf(nestedBlock.open, start + nestedBlock.open.length)) {
      let depth = 1;
      let cursor = start + nestedBlock.open.length;
      while (cursor < searchable.length && depth > 0) {
        if (searchable.startsWith(nestedBlock.open, cursor)) {
          depth += 1;
          cursor += nestedBlock.open.length;
        } else if (searchable.startsWith(nestedBlock.close, cursor)) {
          depth -= 1;
          cursor += nestedBlock.close.length;
        } else {
          cursor += 1;
        }
      }
      if (depth !== 0) break;
      const original = text.slice(start, cursor);
      if (/@(id|implements|verifies|design)\b/.test(original)) {
        matches.push({ text: original, index: start, end: cursor });
      }
      start = cursor - nestedBlock.open.length;
    }
  }
  const patterns = path.endsWith('.hs')
    ? [/(?:^[ \t]*--[^\r\n]*(?:\r?\n|$))+/gm]
    : /\.(?:fs|fsx)$/.test(path)
      ? [/(?:^[ \t]*\/\/[^\r\n]*(?:\r?\n|$))+/gm]
    : path.endsWith('.lua')
      ? [/--\[(=*)\[[\s\S]*?\]\1\]/g, /(?:^[ \t]*--(?!\[=*\[)[^\r\n]*(?:\r?\n|$))+/gm]
      : path.endsWith('.vb')
        ? [/(?:^[ \t]*'[^\r\n]*(?:\r?\n|$))+/gm]
        : [
            /\/\*[\s\S]*?\*\//g,
            /(?:^[ \t]*\/\/[^\r\n]*(?:\r?\n|$))+/gm,
            /(?:^[ \t]*#[^\r\n]*(?:\r?\n|$))+/gm,
          ];
  for (const pattern of patterns) {
    for (const match of searchable.matchAll(pattern)) {
      if (match.index !== undefined) {
        const original = text.slice(match.index, match.index + match[0].length);
        const end = match.index + match[0].length;
        if (/@(id|implements|verifies|design)\b/.test(original)
          && !matches.some((existing) => match.index! < existing.end && end > existing.index)) {
          matches.push({ text: original, index: match.index, end });
        }
      }
    }
  }
  return matches.sort((a, b) => a.index - b.index).map((match) => ({
    text: match.text,
    line: text.slice(0, match.index).split(/\r?\n/).length,
  }));
}

export function commentBlocks(text: string, path: string): { text: string; line: number }[] {
  return isSource(path) ? typedCommentBlocks(text, path) : genericCommentBlocks(text, path);
}

/** @id CODE-SCOPED-FEATURE-TRACE-ARTIFACTS-003
 * @implements REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003
 * @design DES-SCOPED-FEATURE-TRACE-ARTIFACTS-003
 */
export const canonicalTracePath = '.musubix/trace.json';

function diagnosticSortKey(diagnostic: Diagnostic): string {
  return `${diagnostic.path ?? ''}\u0000${String(diagnostic.line ?? -1).padStart(20, '0')}\u0000${diagnostic.code}\u0000${diagnostic.severity}\u0000${diagnostic.message}\u0000${JSON.stringify(diagnostic)}`;
}

/** @id CODE-SCOPED-FEATURE-TRACE-ARTIFACTS-001
 * @implements REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-001 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003
 * @design DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001
 */
export function canonicalSort(graph: TraceGraph): TraceGraph {
  const nodes = [...graph.nodes].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const edges = [...graph.edges].sort((a, b) => {
    const keyA = `${a.from}\u0000${a.to}\u0000${a.relation}`;
    const keyB = `${b.from}\u0000${b.to}\u0000${b.relation}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  const diagnostics = [...graph.diagnostics].sort((a, b) => {
    const keyA = diagnosticSortKey(a);
    const keyB = diagnosticSortKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });
  const fingerprints = Object.fromEntries(Object.keys(graph.fingerprints).sort().map((path) => [path, graph.fingerprints[path]!]));
  return { schemaVersion: graph.schemaVersion, generatedAt: graph.generatedAt, nodes, edges, diagnostics, fingerprints };
}

/** @id CODE-SCOPED-FEATURE-TRACE-ARTIFACTS-002
 * @implements REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-001
 * @design DES-SCOPED-FEATURE-TRACE-ARTIFACTS-001
 */
export function featureTraceProjection(graph: TraceGraph, featureDir: string): TraceGraph {
  const prefix = `${featureDir}/`;
  const owned = graph.nodes.filter((n) => n.path.startsWith(prefix)).map((n) => n.id);
  const nodeIds = new Set(owned);
  const queue = [...owned];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of graph.edges) {
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : undefined;
      if (next !== undefined && !nodeIds.has(next)) {
        nodeIds.add(next);
        queue.push(next);
      }
    }
  }
  const nodes = graph.nodes.filter((n) => nodeIds.has(n.id));
  const edges = graph.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  const paths = new Set(nodes.map((n) => n.path));
  const diagnostics = graph.diagnostics.filter((d) => d.path !== undefined && paths.has(d.path));
  const fingerprints = Object.fromEntries(Object.entries(graph.fingerprints).filter(([path]) => paths.has(path)));
  return canonicalSort({ schemaVersion: graph.schemaVersion, generatedAt: graph.generatedAt, nodes, edges, diagnostics, fingerprints });
}

function sameIgnoringGeneratedAt(a: TraceGraph, b: TraceGraph): boolean {
  return JSON.stringify({ ...a, generatedAt: null }) === JSON.stringify({ ...b, generatedAt: null });
}

/** @id CODE-SCOPED-FEATURE-TRACE-ARTIFACTS-004
 * @implements REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003
 * @design DES-SCOPED-FEATURE-TRACE-ARTIFACTS-002
 */
export async function writeTraceIfChanged(root: string, path: string, graph: TraceGraph): Promise<boolean> {
  let existing: TraceGraph | undefined;
  try {
    existing = JSON.parse(await readText(root, path)) as TraceGraph;
  } catch {
    existing = undefined;
  }
  if (existing && sameIgnoringGeneratedAt(existing, graph)) return false;
  await writeJson(root, path, graph);
  return true;
}

export async function buildTrace(root: string, persist = true): Promise<TraceGraph> {
  if (persist) return withEvidenceWriterLock(root, 'trace build', () => buildTraceUnlocked(root, true));
  return buildTraceUnlocked(root, false);
}

async function buildTraceUnlocked(root: string, persist: boolean): Promise<TraceGraph> {
  const paths = await traceInputs(root);
  const graph: TraceGraph = { schemaVersion: 1, generatedAt: new Date().toISOString(), nodes: [], edges: [], diagnostics: [], fingerprints: await snapshot(root, paths) };
  const add = (node: TraceNode): void => {
    if (graph.nodes.some((n) => n.id === node.id)) graph.diagnostics.push(error('TRACE_DUPLICATE', `Duplicate global ID ${node.id}.`, node.path, node.line));
    else graph.nodes.push(node);
  };
  for (const path of paths) {
    const text = await readText(root, path);
    if (isArtifact(path) && path.endsWith('/requirements.md')) {
      const result = validateRequirements(text, path);
      graph.diagnostics.push(...result.diagnostics);
      for (const req of result.value) add({ id: req.id, kind: 'requirement', path, line: req.line, mandatory: req.priority === 'must' });
    } else if (isArtifact(path) && path.endsWith('/design.md')) {
      const result = validateDesign(text, path);
      graph.diagnostics.push(...result.diagnostics);
      for (const component of result.value) {
        add({ id: component.id, kind: 'design', path, line: component.line });
        for (const req of component.requirements) graph.edges.push({ from: component.id, to: req, relation: 'satisfies' });
        for (const adr of component.decisions) graph.edges.push({ from: adr, to: component.id, relation: 'decides' });
        for (const dep of component.dependencies) graph.edges.push({ from: component.id, to: dep, relation: 'depends-on' });
      }
    } else if (path.startsWith('.musubix/decisions/')) {
      add({ id: basename(path, '.md'), kind: 'adr', path, line: 1 });
    } else if (isTraceSource(path) || isSkillSource(path)) {
      if (path.endsWith('.py')) {
        for (const match of text.matchAll(/("""|''')[\s\S]*?\1/g)) {
          if (match.index !== undefined && /@(id|implements|verifies|design)\b/.test(match[0])) {
            graph.diagnostics.push({
              code: 'TRACE_ANNOTATION_IN_PYTHON_DOCSTRING',
              severity: 'warning',
              message: 'Python trace annotations in docstrings are ignored; move them to consecutive # comment lines.',
              path,
              line: text.slice(0, match.index).split(/\r?\n/).length,
            });
          }
        }
      }
      for (const block of commentBlocks(text, path)) {
        const annotations = [...block.text.matchAll(/@(implements|verifies|design)\s+([^\r\n*]+)/g)];
        if (!annotations.length) continue;
        const id = /@id\s+(\S+)/.exec(block.text)?.[1];
        const kind = annotations.some((a) => a[1] === 'verifies') ? 'test' : 'code';
        if (!id || !ids[kind].test(id)) {
          graph.diagnostics.push(error('TRACE_ANNOTATION_ID', `Annotation block requires @id ${kind === 'test' ? 'TEST' : 'CODE'}-FEATURE-001.`, path, block.line));
          continue;
        }
        add({ id, kind, path, line: block.line });
        for (const annotation of annotations) {
          const relation = annotation[1] === 'verifies' ? 'verifies' : 'implements';
          const prefix = annotation[1] === 'design' ? 'DES' : 'REQ';
          const targets = (annotation[2] ?? '').split(/[\s,]+/).filter(Boolean);
          for (const target of targets) {
            if (!target.startsWith(`${prefix}-`) || !(prefix === 'DES' ? ids.design : ids.requirement).test(target)) {
              graph.diagnostics.push(error('TRACE_ANNOTATION_TARGET', `Invalid @${annotation[1]} target ${target}.`, path, block.line));
            }
            graph.edges.push({ from: id, to: target, relation });
          }
        }
      }
    }
  }
  if (persist) {
    await writeJson(root, '.musubix/cache/trace.json', graph);
    await writeTraceIfChanged(root, canonicalTracePath, canonicalSort(graph));
    const features = new Set(paths.filter((p) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(p)).map(dirname));
    for (const feature of features) await writeTraceIfChanged(root, `${feature}/trace.json`, featureTraceProjection(graph, feature));
  }
  return graph;
}

function validTraceShape(value: unknown): value is TraceGraph {
  const graph = value as TraceGraph;
  return !!graph && graph.schemaVersion === 1 && Array.isArray(graph.nodes) && Array.isArray(graph.edges)
    && !!graph.fingerprints && Array.isArray(graph.diagnostics);
}

/** @id CODE-SCOPED-FEATURE-TRACE-ARTIFACTS-006
 * @implements REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-004
 * @design DES-SCOPED-FEATURE-TRACE-ARTIFACTS-004
 */
export async function loadTrace(root: string): Promise<TraceGraph> {
  const path = await exists(within(root, '.musubix/cache/trace.json')) ? '.musubix/cache/trace.json' :
    await exists(within(root, canonicalTracePath)) ? canonicalTracePath : undefined;
  if (!path) throw new Error('Trace graph missing; run musubix3 trace build.');
  const value = JSON.parse(await readText(root, path)) as TraceGraph;
  if (!validTraceShape(value)) throw new Error('Invalid trace graph; rebuild it.');
  return value;
}

export interface TraceCheck {
  valid: boolean;
  diagnostics: Diagnostic[];
  coverageKind: 'link-coverage';
  mandatoryRequirements: number;
  coverage: { design: number | null; implementation: number | null; tests: number | null };
}

export async function checkTrace(root: string, graph: TraceGraph, strict = false, thresholds = { design: 1, implementation: 1, tests: 1 }): Promise<TraceCheck> {
  const diagnostics = [...graph.diagnostics];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) diagnostics.push(error('TRACE_DANGLING', `${edge.from} → ${edge.to} (${edge.relation}) has a missing endpoint.`));
  }
  for (const node of graph.nodes) {
    if (!await exists(within(root, node.path))) diagnostics.push(error('TRACE_STALE_PATH', `Missing source for ${node.id}.`, node.path));
  }
  const current = await snapshot(root, await traceInputs(root));
  const allPaths = new Set([...Object.keys(current), ...Object.keys(graph.fingerprints)]);
  for (const path of allPaths) {
    if (current[path] !== graph.fingerprints[path]) diagnostics.push(error('TRACE_STALE', 'Trace inputs changed; run trace build.', path));
  }
  const mandatory = graph.nodes.filter((n) => n.kind === 'requirement' && n.mandatory);
  const counts = { design: 0, implementation: 0, tests: 0 };
  if (!graph.nodes.some((n) => n.kind === 'requirement')) diagnostics.push(error('TRACE_NO_REQUIREMENTS', 'No requirements in trace graph.'));
  for (const requirement of mandatory) {
    const designs = graph.edges.filter((e) => e.to === requirement.id && e.relation === 'satisfies' && nodes.get(e.from)?.kind === 'design').map((e) => e.from);
    const coverage = {
      design: designs.length > 0,
      implementation: graph.edges.some((e) => e.relation === 'implements' && (e.to === requirement.id || designs.includes(e.to)) && nodes.get(e.from)?.kind === 'code'),
      tests: graph.edges.some((e) => e.to === requirement.id && e.relation === 'verifies' && nodes.get(e.from)?.kind === 'test'),
    };
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      if (coverage[key]) counts[key]++;
      else diagnostics.push({ code: 'TRACE_UNCOVERED', severity: 'warning', message: `${requirement.id} lacks ${key}.`, path: requirement.path, line: requirement.line });
    }
  }
  const coverage: TraceCheck['coverage'] = { design: null, implementation: null, tests: null };
  for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
    coverage[key] = mandatory.length ? counts[key] / mandatory.length : null;
    if (coverage[key] !== null && coverage[key] < thresholds[key]) {
      diagnostics.push({ code: 'TRACE_COVERAGE', severity: strict ? 'error' : 'warning', message: `${key} link coverage ${coverage[key]} is below ${thresholds[key]}.` });
    }
  }
  return {
    valid: !diagnostics.some((d) => d.severity === 'error'),
    diagnostics,
    coverageKind: 'link-coverage',
    mandatoryRequirements: mandatory.length,
    coverage,
  };
}

export interface Impact {
  id: string;
  paths: string[][];
}

export function traceImpact(graph: TraceGraph, query: string): Impact[] {
  const starts = graph.nodes.filter((n) => n.id === query || n.path === query).map((n) => n.id);
  if (!starts.length) throw new Error(`Trace ID or path not found: ${query}`);
  const results = new Map<string, string[][]>();
  for (const start of starts) {
    const queue: string[][] = [[start]];
    const seen = new Set([start]);
    for (let i = 0; i < queue.length; i++) {
      const path = queue[i]!;
      const current = path.at(-1)!;
      const neighbors = graph.edges.flatMap((e) => e.from === current ? [e.to] : e.to === current ? [e.from] : []).sort();
      for (const next of neighbors) {
        if (seen.has(next)) continue;
        seen.add(next);
        const chain = [...path, next];
        queue.push(chain);
        results.set(next, [...(results.get(next) ?? []), chain]);
      }
    }
  }
  return [...results.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, paths]) => ({ id, paths }));
}
