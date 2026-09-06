import ts from 'typescript';
import { dirname, basename } from 'node:path';
import { error, ids, validateDesign, validateRequirements, type Diagnostic } from '../../domain/src/index.js';
import { exists, files, isArtifact, isSource, isTraceSource, readText, snapshot, within, writeJson } from './files.js';

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

export async function traceInputs(root: string): Promise<string[]> {
  return (await files(root)).filter((path) => isArtifact(path) || isTraceSource(path));
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
  const chars = [...text];
  const quotes = path.endsWith('.rs') ? ['"'] : ['"', "'", '`'];
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
  const matches: { text: string; index: number }[] = [];
  for (const pattern of [
    /\/\*[\s\S]*?\*\//g,
    /(?:^[ \t]*\/\/[^\r\n]*(?:\r?\n|$))+/gm,
    /(?:^[ \t]*#[^\r\n]*(?:\r?\n|$))+/gm,
  ]) {
    for (const match of searchable.matchAll(pattern)) {
      if (match.index !== undefined) {
        const original = text.slice(match.index, match.index + match[0].length);
        if (/@(id|implements|verifies|design)\b/.test(original)) {
          matches.push({ text: original, index: match.index });
        }
      }
    }
  }
  return matches.sort((a, b) => a.index - b.index).map((match) => ({
    text: match.text,
    line: text.slice(0, match.index).split(/\r?\n/).length,
  }));
}

function commentBlocks(text: string, path: string): { text: string; line: number }[] {
  return isSource(path) ? typedCommentBlocks(text, path) : genericCommentBlocks(text, path);
}

export async function buildTrace(root: string, persist = true): Promise<TraceGraph> {
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
    } else if (isTraceSource(path)) {
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
    const features = new Set(paths.filter((p) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(p)).map(dirname));
    for (const feature of features) await writeJson(root, `${feature}/trace.json`, graph);
  }
  return graph;
}

export async function loadTrace(root: string): Promise<TraceGraph> {
  const path = await exists(within(root, '.musubix/cache/trace.json')) ? '.musubix/cache/trace.json' :
    (await files(root)).find((p) => /^\.musubix\/features\/[^/]+\/trace\.json$/.test(p));
  if (!path) throw new Error('Trace graph missing; run musubix3 trace build.');
  const value = JSON.parse(await readText(root, path)) as TraceGraph;
  if (value.schemaVersion !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges) || !value.fingerprints || !Array.isArray(value.diagnostics)) throw new Error('Invalid trace graph; rebuild it.');
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
