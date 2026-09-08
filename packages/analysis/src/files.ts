import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.test-work', '.next', 'vendor', '__pycache__']);
const pythonVirtualEnvironmentRoots = new Set(['.venv', 'venv']);

export function portable(path: string): string {
  return path.split(sep).join('/');
}

export function within(root: string, path: string): string {
  const absolute = resolve(root, path);
  const rel = relative(resolve(root), absolute);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path escapes project root: ${path}`);
  return absolute;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw cause;
  }
}

export async function safePath(root: string, path: string): Promise<string> {
  const absolute = within(root, path);
  let cursor = resolve(root);
  const segments = relative(cursor, absolute).split(sep).filter(Boolean);
  for (const part of ['', ...segments]) {
    if (part) cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error(`Refusing symbolic link: ${cursor}`);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    }
  }
  return absolute;
}

export async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    const hasCargoOrMavenManifest = entries.some((entry) =>
      entry.isFile() && (entry.name === 'Cargo.toml' || entry.name === 'pom.xml'));
    const hasGradleManifest = entries.some((entry) =>
      entry.isFile() && ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].includes(entry.name));
    const hasDartManifest = entries.some((entry) => entry.isFile() && entry.name === 'pubspec.yaml');
    const hasSwiftManifest = entries.some((entry) => entry.isFile() && entry.name === 'Package.swift');
    const hasZigManifest = entries.some((entry) =>
      entry.isFile() && (entry.name === 'build.zig' || entry.name === 'build.zig.zon'));
    const hasDotnetProject = entries.some((entry) =>
      entry.isFile() && (/\.sln$/i.test(entry.name) || /\.(?:cs|fs|vb)proj$/i.test(entry.name)));
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      const path = portable(relative(root, absolute));
      if (entry.isDirectory()) {
        const isPythonVirtualEnvironment = pythonVirtualEnvironmentRoots.has(entry.name)
          && await isRegularFile(resolve(absolute, 'pyvenv.cfg'));
        if (!excluded.has(entry.name)
          && !(entry.name === 'target' && hasCargoOrMavenManifest)
          && !(entry.name === '.gradle' && hasGradleManifest)
          && !(entry.name === '.dart_tool' && hasDartManifest)
          && !(entry.name === '.build' && hasSwiftManifest)
          && !((entry.name === '.zig-cache' || entry.name === 'zig-out') && hasZigManifest)
          && !(entry.name === '.dotnet' && hasDotnetProject)
          && !((entry.name === 'bin' || entry.name === 'obj') && hasDotnetProject)
          && !isPythonVirtualEnvironment
          && path !== '.nuget/packages'
          && path !== '.musubix/cache'
          && path !== '.musubix/evidence') await walk(absolute);
      } else if (entry.isFile()) {
        result.push(path);
      }
    }
  }
  await walk(resolve(root));
  return result;
}

export async function readText(root: string, path: string): Promise<string> {
  return readFile(await safePath(root, path), 'utf8');
}

export async function writeText(root: string, path: string, text: string): Promise<void> {
  const target = await safePath(root, path);
  await mkdir(dirname(target), { recursive: true });
  // Same-directory atomic replacement; no operating-system temporary directories.
  const staging = `${target}.${process.pid}.${crypto.randomUUID()}.writing`;
  try {
    await writeFile(staging, text, { flag: 'wx' });
    await rename(staging, target);
  } finally {
    if (await exists(staging)) await unlink(staging);
  }
}

export async function writeJson(root: string, path: string, value: unknown): Promise<void> {
  await writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

export function digest(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function isSource(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
}

export function isTraceSource(path: string): boolean {
  return /\.(?:[cm]?[jt]sx?|rs|py|go|java|kt|kts|cs|c|cc|cpp|h|hh|hpp|rb|php|swift|dart|scala|ex|exs|hs|lua|zig|sol|m|mm|fs|fsx|vb|[rR]|jl)$/.test(path)
    && !/\.d\.[cm]?ts$/.test(path);
}

export function isArtifact(path: string): boolean {
  return /^\.musubix\/features\/[^/]+\/(?:requirements|design)\.md$/.test(path) ||
    /^\.musubix\/decisions\/ADR-\d+\.md$/.test(path);
}

export function evidenceInputPaths(paths: string[]): string[] {
  return paths.filter((path) =>
    !/^\.musubix\/features\/[^/]+\/trace\.json$/.test(path)
    && !path.endsWith('.tgz')
    && !/^\.github\/skills\//.test(path)
    && !/(?:^|\/)(?:logs?|session-logs)\//.test(path));
}

export async function snapshot(root: string, paths: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(paths.map(async (path) => [path, digest(await readFile(await safePath(root, path)))] as const));
  return Object.fromEntries(entries);
}
