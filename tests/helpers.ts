import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach } from 'vitest';
import {
  defaultConfig, digest, readText, runProcess, writeJson, writeText, type Config, type ProcessResult, type Runner,
} from '../packages/analysis/src/index.js';
import { install } from '../packages/cli/src/install.js';

// Recomputes the TDD append-only chain's per-record SHA-256 the same way
// `packages/analysis/src/tdd.ts`'s private `chainRecordSha256` does, so tests
// can simulate historical evidence states (e.g. a fingerprint recorded under
// a superseded algorithm) without breaking chain-hash validation.
export function digestChainRecord(value: unknown): string {
  return digest(JSON.stringify(value));
}

export const repository = resolve('.');
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

export async function fixture(initial: Record<string, string> = {}): Promise<string> {
  const root = resolve('.test-work', crypto.randomUUID());
  roots.push(root);
  await mkdir(root, { recursive: true });
  for (const [path, text] of Object.entries(initial)) await writeText(root, path, text);
  return root;
}

export const req = (statement = 'The system shall report its readiness.', id = 'REQ-EXAMPLE-001'): string =>
  `## ${id}: Readiness\nPriority: must\nStatement: ${statement}\n`;

export const code = `/** @id CODE-EXAMPLE-001
 * @implements REQ-EXAMPLE-001
 * @design DES-EXAMPLE-001
 */
export function readiness() { return true; }
`;
export const testCode = `import { readiness } from './service.js';
/** @id TEST-EXAMPLE-001
 * @verifies REQ-EXAMPLE-001
 */
export function testReadiness() { if (!readiness()) throw new Error('not ready'); }
`;

export async function project(): Promise<string> {
  const root = await fixture();
  // Isolate real `git` invocations from this repository's own history: without its
  // own .git, this fixture would let `git` walk up to the enclosing musubix3
  // checkout, leaking its (unbounded, growing) history into CLI command output.
  await runProcess('git', ['init', '-q'], { cwd: root, timeoutMs: 10_000 });
  await install(root, repository);
  await writeText(root, 'src/service.ts', code);
  await writeText(root, 'src/service.test.ts', testCode);
  const config: Config = {
    ...defaultConfig,
    approval: { mode: 'compatible', domains: [] },
    commands: [{
      name: 'test',
      command: process.execPath,
      args: [
        '-e',
        "const fs=require('fs'),p=process.argv[1];fs.mkdirSync(require('path').dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify({schemaVersion:1,tests:[{id:'TEST-EXAMPLE-001',status:'passed'}]}));console.log('real-check')",
        '{reportPath}',
      ],
      tddArgs: ['{testId}', '{reportPath}'],
      tddReport: { format: 'musubix-json', path: '.musubix/evidence/tdd-results/{testId}.json' },
      testReport: { format: 'musubix-json', path: '.musubix/evidence/test-results.json' },
      required: true,
      timeoutMs: 10_000,
    }],
  };
  await writeJson(root, '.musubix/config.json', config);
  const baseline = JSON.parse(await readText(root, '.musubix/policy-baseline.json')) as Config & { requiredCommands: string[] };
  baseline.approval = { mode: 'compatible', domains: [] };
  await writeJson(root, '.musubix/policy-baseline.json', baseline);
  return root;
}

export function tddResultRunner(root: string, status: 'passed' | 'failed' | 'skipped' | 'error', overrides: Partial<ProcessResult> = {}): Runner {
  return async (_command, args) => {
    const testId = args.find((arg) => /^TEST-/.test(arg));
    const reportPath = args.find((arg) => arg.includes('tdd-results/'));
    if (!testId || !reportPath) throw new Error('Missing structured TDD arguments.');
    await writeJson(root, reportPath, { schemaVersion: 1, tests: [{ id: testId, status }] });
    return processResult(overrides);
  };
}

export function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return { status: 'completed', exitCode: 0, stdout: '', stderr: '', durationMs: 1, ...overrides };
}

export const missingRunner: Runner = async () => processResult({ status: 'missing', exitCode: null, stderr: 'not installed' });
