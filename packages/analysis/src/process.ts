import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export interface ProcessResult {
  status: 'completed' | 'missing' | 'timeout' | 'error';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type Runner = (command: string, args: string[], options: { cwd: string; timeoutMs: number; input?: string }) => Promise<ProcessResult>;

export const runProcess: Runner = async (command, args, options) => new Promise((resolve) => {
  const start = performance.now();
  const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  let stdout = '';
  let stderr = '';
  let status: ProcessResult['status'] = 'completed';
  let settled = false;
  let killFallback: NodeJS.Timeout | undefined;
  const finish = (exitCode: number | null): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (killFallback) clearTimeout(killFallback);
    resolve({ status, exitCode, stdout, stderr, durationMs: Math.max(0, Math.round(performance.now() - start)) });
  };
  const timer = setTimeout(() => {
    status = 'timeout';
    // Stop this subprocess tree only; inherited output pipes must not hang the gate.
    if (child.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') stderr += String(cause); }
    } else child.kill('SIGKILL');
    killFallback = setTimeout(() => finish(null), 1_000);
    killFallback.unref();
  }, options.timeoutMs);
  child.stdout.on('data', (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-1_000_000); });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-1_000_000); });
  child.stdin.on('error', (cause: NodeJS.ErrnoException) => {
    if (cause.code !== 'EPIPE') { status = 'error'; stderr += cause.message; }
  });
  child.on('error', (cause: NodeJS.ErrnoException) => {
    status = cause.code === 'ENOENT' ? 'missing' : 'error';
    stderr += cause.message;
    finish(null);
  });
  child.on('close', finish);
  child.stdin.end(options.input ?? '');
});

export async function changedFiles(root: string, runner: Runner = runProcess): Promise<string[]> {
  const location = await runner('git', ['rev-parse', '--show-prefix'], { cwd: root, timeoutMs: 10_000 });
  if (location.status !== 'completed' || location.exitCode !== 0) throw new Error(`Cannot determine changed files: ${location.stderr}`);
  const prefix = location.stdout.replace(/\r?\n$/, '');
  const result = await runner('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.'], { cwd: root, timeoutMs: 10_000 });
  if (result.status !== 'completed' || result.exitCode !== 0) throw new Error(`Cannot determine changed files: ${result.stderr}`);
  const entries = result.stdout.split('\0');
  const paths = new Set<string>();
  const add = (path: string): void => {
    if (path.startsWith(prefix)) paths.add(path.slice(prefix.length));
  };
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.length < 4) continue;
    add(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) {
      const previous = entries[++i];
      if (previous) add(previous);
    }
  }
  return [...paths].sort();
}
