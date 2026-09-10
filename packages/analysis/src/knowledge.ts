import { dirname } from 'node:path';
import { FILE_READ_CONCURRENCY, files, mapWithConcurrency, readText, snapshot, writeJson } from './files.js';
import { runProcess, type Runner } from './process.js';

export interface KnowledgeDocument {
  id: string;
  path: string;
  text: string;
  kind: 'artifact' | 'co-change' | 'author-directory';
}

export interface KnowledgeIndex {
  schemaVersion: 1;
  generatedAt: string;
  documents: KnowledgeDocument[];
  git: { status: 'indexed' | 'skipped'; reason: string; head: string | null };
  fingerprints: Record<string, string>;
}

export function tokenize(text: string): string[] {
  const normalized = text.normalize('NFKC').toLowerCase();
  const tokens: string[] = normalized.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [];
  for (const run of normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []) {
    const characters = [...run];
    if (characters.length === 1) tokens.push(run);
    else for (let i = 0; i < characters.length - 1; i++) tokens.push(characters.slice(i, i + 2).join(''));
  }
  return tokens;
}

export function rankDocuments(documents: KnowledgeDocument[], query: string, limit = 10): { document: KnowledgeDocument; score: number }[] {
  const terms = documents.map((doc) => tokenize(doc.text));
  const frequency = new Map<string, number>();
  for (const termsInDoc of terms) {
    for (const term of new Set(termsInDoc)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  }
  function vector(tokens: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const token of tokens) if (frequency.has(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const [term, count] of counts) counts.set(term, (1 + Math.log(count)) * (1 + Math.log((documents.length + 1) / ((frequency.get(term) ?? 0) + 1))));
    return counts;
  }
  const queryVector = vector(tokenize(query));
  const norm = (v: Map<string, number>): number => Math.sqrt([...v.values()].reduce((sum, n) => sum + n * n, 0));
  const queryNorm = norm(queryVector);
  if (!queryNorm) return [];
  return documents.map((document, i) => {
    const v = vector(terms[i] ?? []);
    const dot = [...queryVector].reduce((sum, [term, weight]) => sum + weight * (v.get(term) ?? 0), 0);
    return { document, score: dot / ((norm(v) || 1) * queryNorm) };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id)).slice(0, limit);
}

async function artifactPaths(root: string): Promise<string[]> {
  return (await files(root)).filter((p) => p.endsWith('.md'));
}

/** @id CODE-BOUNDED-FILE-READ-CONCURRENCY-003
 * @implements REQ-BOUNDED-FILE-READ-CONCURRENCY-003
 * @design DES-BOUNDED-FILE-READ-CONCURRENCY-003
 */
export async function buildKnowledge(root: string, runner: Runner = runProcess): Promise<KnowledgeIndex> {
  const paths = await artifactPaths(root);
  const documents: KnowledgeDocument[] = await mapWithConcurrency(paths, FILE_READ_CONCURRENCY, async (path) => ({ id: path, path, text: await readText(root, path), kind: 'artifact' as const }));
  const log = await runner('git', ['log', '-100', '--format=%x1e%H%x1f%an', '--name-only', '--no-renames'], { cwd: root, timeoutMs: 10_000 });
  const git: KnowledgeIndex['git'] = { status: 'skipped', reason: log.stderr.trim() || log.status, head: null };
  if (log.status === 'completed' && log.exitCode === 0) {
    git.status = 'indexed';
    git.reason = 'Last 100 commits; at most 30 paths per commit. Correlation, not ownership or causality.';
    const cochange = new Map<string, number>();
    const authors = new Map<string, number>();
    for (const record of log.stdout.split('\x1e').filter(Boolean)) {
      const [header = '', ...lines] = record.trim().split('\n');
      const [hash = '', author = 'unknown'] = header.split('\x1f');
      git.head ??= hash;
      const changed = [...new Set(lines.filter(Boolean))].sort().slice(0, 30);
      for (const directory of new Set(changed.map(dirname))) {
        const key = `${author}\x1f${directory}`;
        authors.set(key, (authors.get(key) ?? 0) + 1);
      }
      for (let i = 0; i < changed.length; i++) {
        for (let j = i + 1; j < changed.length; j++) {
          const key = `${changed[i]}\x1f${changed[j]}`;
          cochange.set(key, (cochange.get(key) ?? 0) + 1);
        }
      }
    }
    for (const [key, count] of cochange) {
      const [first = '', second = ''] = key.split('\x1f');
      documents.push({ id: `co-change:${key}`, path: first, kind: 'co-change', text: `${first} and ${second} changed together in ${count} commits.` });
    }
    for (const [key, count] of authors) {
      const [author = '', directory = ''] = key.split('\x1f');
      documents.push({ id: `author:${key}`, path: directory, kind: 'author-directory', text: `${author} contributed to ${directory} in ${count} commits.` });
    }
  }
  const index: KnowledgeIndex = { schemaVersion: 1, generatedAt: new Date().toISOString(), documents, git, fingerprints: await snapshot(root, paths) };
  await writeJson(root, '.musubix/cache/knowledge.json', index);
  return index;
}

export async function queryKnowledge(root: string, query: string, limit = 10, runner: Runner = runProcess): Promise<{ results: ReturnType<typeof rankDocuments>; stale: boolean; git: KnowledgeIndex['git'] }> {
  const index = JSON.parse(await readText(root, '.musubix/cache/knowledge.json')) as KnowledgeIndex;
  if (index.schemaVersion !== 1 || !Array.isArray(index.documents) || !index.fingerprints || !index.git) throw new Error('Invalid knowledge cache; run knowledge build.');
  const head = await runner('git', ['rev-parse', 'HEAD'], { cwd: root, timeoutMs: 10_000 });
  const currentHead = head.status === 'completed' && head.exitCode === 0 ? head.stdout.trim() : null;
  const stale = JSON.stringify(await snapshot(root, await artifactPaths(root))) !== JSON.stringify(index.fingerprints) || index.git.head !== currentHead;
  return { results: rankDocuments(index.documents, query, limit), stale, git: index.git };
}
