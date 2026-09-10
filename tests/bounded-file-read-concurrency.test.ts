import { describe, expect, it, vi } from 'vitest';
import { buildKnowledge, indexGraph, mapWithConcurrency, snapshot } from '../packages/analysis/src/index.js';
import { fixture } from './helpers.js';

const tracker = vi.hoisted(() => ({ enabled: false, inFlight: 0, maxInFlight: 0 }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (tracker.enabled) {
        tracker.inFlight += 1;
        tracker.maxInFlight = Math.max(tracker.maxInFlight, tracker.inFlight);
      }
      try {
        return await actual.readFile(...args);
      } finally {
        if (tracker.enabled) tracker.inFlight -= 1;
      }
    },
  };
});

describe('bounded file-read concurrency for large projects', () => {
  /** @id TEST-BOUNDED-FILE-READ-CONCURRENCY-001
   * @verifies REQ-BOUNDED-FILE-READ-CONCURRENCY-001
   */
  it('TEST-BOUNDED-FILE-READ-CONCURRENCY-001 never exceeds the concurrency limit and preserves order', async () => {
    const limit = 8;
    const items = Array.from({ length: 97 }, (_, index) => index);
    let inFlight = 0;
    let maxInFlight = 0;
    const results = await mapWithConcurrency(items, limit, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
      inFlight -= 1;
      return item * 2;
    });
    expect(maxInFlight).toBeLessThanOrEqual(limit);
    expect(results).toEqual(items.map((item) => item * 2));
  });

  /** @id TEST-BOUNDED-FILE-READ-CONCURRENCY-002
   * @verifies REQ-BOUNDED-FILE-READ-CONCURRENCY-001
   */
  it('TEST-BOUNDED-FILE-READ-CONCURRENCY-002 snapshots a large path list without exceeding the OS file-descriptor limit', async () => {
    const files: Record<string, string> = {};
    const paths: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      const path = `many/file-${index}.txt`;
      files[path] = `content-${index}`;
      paths.push(path);
    }
    const root = await fixture(files);
    tracker.enabled = true;
    tracker.inFlight = 0;
    tracker.maxInFlight = 0;
    let result: Record<string, string>;
    try {
      result = await snapshot(root, paths);
    } finally {
      tracker.enabled = false;
    }
    expect(Object.keys(result)).toHaveLength(400);
    expect(result['many/file-0.txt']).toBeDefined();
    expect(tracker.maxInFlight).toBeLessThanOrEqual(256);
  });

  /** @id TEST-BOUNDED-FILE-READ-CONCURRENCY-003
   * @verifies REQ-BOUNDED-FILE-READ-CONCURRENCY-002
   */
  it('TEST-BOUNDED-FILE-READ-CONCURRENCY-003 bounds concurrent reads while Code Graph loads a language with many source files', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 300; index += 1) {
      files[`pkg/module_${index}.py`] = `def f_${index}():\n    return ${index}\n`;
    }
    const root = await fixture(files);
    tracker.enabled = true;
    tracker.inFlight = 0;
    tracker.maxInFlight = 0;
    try {
      const graph = await indexGraph(root, false);
      expect(graph.files.filter((path) => path.endsWith('.py'))).toHaveLength(300);
    } finally {
      tracker.enabled = false;
    }
    expect(tracker.maxInFlight).toBeLessThanOrEqual(256);
  });

  /** @id TEST-BOUNDED-FILE-READ-CONCURRENCY-004
   * @verifies REQ-BOUNDED-FILE-READ-CONCURRENCY-003
   */
  it('TEST-BOUNDED-FILE-READ-CONCURRENCY-004 bounds concurrent reads while knowledge build loads many Markdown documents', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 300; index += 1) {
      files[`docs/note-${index}.md`] = `# Note ${index}\ncontent ${index}\n`;
    }
    const root = await fixture(files);
    tracker.enabled = true;
    tracker.inFlight = 0;
    tracker.maxInFlight = 0;
    try {
      const knowledge = await buildKnowledge(root);
      expect(knowledge.documents.filter((d) => d.kind === 'artifact' && d.path.startsWith('docs/note-'))).toHaveLength(300);
    } finally {
      tracker.enabled = false;
    }
    expect(tracker.maxInFlight).toBeLessThanOrEqual(256);
  });
});
