import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTrace, checkTrace, cycles, defaultConfig, graphGate, graphImpact, indexGraph, loadGraph, loadTrace,
  evidenceSnapshot, files, matchGlob, readText, traceImpact, writeText,
} from '../packages/analysis/src/index.js';
import { code, fixture, project } from './helpers.js';

describe('trace graph', () => {
  it('builds all five node kinds and complete mandatory coverage', async () => {
    const root = await project();
    const trace = await buildTrace(root);
    expect(trace.nodes.map((n) => n.kind)).toEqual(expect.arrayContaining(['requirement', 'design', 'code', 'test', 'adr']));
    expect((await checkTrace(root, trace, true)).valid).toBe(true);
    expect(await checkTrace(root, trace, true)).toMatchObject({
      coverageKind: 'link-coverage',
      mandatoryRequirements: 1,
      coverage: { design: 1, implementation: 1, tests: 1 },
    });
    const persisted = JSON.parse(await readText(root, '.musubix/features/example/trace.json'));
    expect(persisted).toEqual(trace);
    await unlink(resolve(root, '.musubix/cache/trace.json'));
    expect(await loadTrace(root)).toEqual(trace);
  });

  it('traverses bidirectionally with actual explanation paths', async () => {
    const trace = await buildTrace(await project());
    const fromReq = traceImpact(trace, 'REQ-EXAMPLE-001');
    expect(fromReq.find((r) => r.id === 'CODE-EXAMPLE-001')?.paths).toContainEqual(['REQ-EXAMPLE-001', 'CODE-EXAMPLE-001']);
    expect(fromReq.find((r) => r.id === 'ADR-0001')?.paths[0]).toEqual(['REQ-EXAMPLE-001', 'DES-EXAMPLE-001', 'ADR-0001']);
    expect(traceImpact(trace, 'src/service.test.ts').some((r) => r.id === 'REQ-EXAMPLE-001')).toBe(true);
    expect(() => traceImpact(trace, 'missing')).toThrow('not found');
  });

  it('reports missing coverage as warning or strict failure', async () => {
    const root = await project();
    await writeText(root, 'src/service.test.ts', 'export const untested = true;');
    const trace = await buildTrace(root);
    expect((await checkTrace(root, trace)).valid).toBe(true);
    expect((await checkTrace(root, trace, true)).valid).toBe(false);
    expect((await checkTrace(root, trace, true, { design: 1, implementation: 1, tests: 0 })).valid).toBe(true);
  });

  it('detects dangling links, duplicate annotation IDs and malformed targets', async () => {
    const root = await project();
    await writeText(root, 'src/duplicate.ts', code);
    await writeText(root, 'src/bad.ts', '/** @id CODE-BAD-001\n * @implements REQ-MISSING-001, malformed\n */\nexport {};');
    const report = await checkTrace(root, await buildTrace(root), true);
    expect(report.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['TRACE_DUPLICATE', 'TRACE_DANGLING', 'TRACE_ANNOTATION_TARGET']));
    expect(report.valid).toBe(false);
  });

  it('detects changed, added and deleted source paths', async () => {
    const root = await project();
    const trace = await buildTrace(root);
    await unlink(resolve(root, 'src/service.ts'));
    await writeText(root, 'src/new.ts', 'export {};');
    const report = await checkTrace(root, trace, true);
    expect(report.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['TRACE_STALE', 'TRACE_STALE_PATH']));
    expect(report.valid).toBe(false);
  });

  it('does not count string literals as annotation comments', async () => {
    const root = await project();
    await writeText(root, 'src/fake.ts', 'export const fake = "/** @id CODE-FAKE-001\\n * @implements REQ-EXAMPLE-001\\n */";');
    expect((await buildTrace(root)).nodes.some((n) => n.id === 'CODE-FAKE-001')).toBe(false);
    await writeText(root, 'src/no-id.ts', '/** @implements REQ-EXAMPLE-001 */\nexport {};');
    expect((await buildTrace(root)).diagnostics.some((d) => d.code === 'TRACE_ANNOTATION_ID')).toBe(true);
  });

  it('reads annotations from authoritative Rust and Python comments', async () => {
    const root = await project();
    await writeText(root, 'src/service.ts', 'export {};');
    await writeText(root, 'src/service.test.ts', 'export {};');
    await writeText(root, 'src/lib.rs', [
      '/**',
      ' * @id CODE-EXAMPLE-001',
      ' * @implements REQ-EXAMPLE-001',
      ' * @design DES-EXAMPLE-001',
      ' */',
      'pub fn service() {}',
      'const FAKE: &str = "/* @id CODE-FAKE-001 @implements REQ-EXAMPLE-001 */";',
    ].join('\n'));
    await writeText(root, 'tests/test_service.py', [
      '# @id TEST-EXAMPLE-001',
      '# @verifies REQ-EXAMPLE-001',
      'def test_service():',
      '    assert True',
      'FAKE = "# @id TEST-FAKE-001 @verifies REQ-EXAMPLE-001"',
    ].join('\n'));
    const trace = await buildTrace(root);
    expect(trace.nodes.find((node) => node.id === 'CODE-EXAMPLE-001')?.path).toBe('src/lib.rs');
    expect(trace.nodes.find((node) => node.id === 'TEST-EXAMPLE-001')?.path).toBe('tests/test_service.py');
    expect(trace.nodes.some((node) => node.id.includes('FAKE'))).toBe(false);
    expect((await checkTrace(root, trace, true)).valid).toBe(true);
  });

  it('reads Haskell, F#, Lua, and Visual Basic annotations without treating strings as comments', async () => {
    const root = await project();
    await writeText(root, 'src/native.hs', [
      '-- @id CODE-HASKELL-001',
      '-- @implements REQ-EXAMPLE-001',
      '{-',
      '@id CODE-HASKELL-002',
      '@implements REQ-EXAMPLE-001',
      '-}',
      '{- outer {- nested -} @id CODE-HASKELL-003 @implements REQ-EXAMPLE-001 -}',
      'fake = "-- @id CODE-FAKE-HASKELL-001 @implements REQ-EXAMPLE-001"',
    ].join('\n'));
    await writeText(root, 'src/native.lua', [
      '-- @id CODE-LUA-001',
      '-- @implements REQ-EXAMPLE-001',
      '--[[',
      '@id CODE-LUA-002',
      '@implements REQ-EXAMPLE-001',
      ']]',
      'local fake = "-- @id CODE-FAKE-LUA-001 @implements REQ-EXAMPLE-001"',
      'local long_fake = [[-- @id CODE-FAKE-LUA-002 @implements REQ-EXAMPLE-001]]',
    ].join('\n'));
    await writeText(root, 'src/Native.fs', [
      "let identity (value: 'T) = value",
      '(*',
      '@id CODE-FSHARP-001',
      '(* nested comment *)',
      '@implements REQ-EXAMPLE-001',
      '*)',
      'let fake = "(* @id CODE-FAKE-FSHARP-001 @implements REQ-EXAMPLE-001 *)"',
    ].join('\n'));
    await writeText(root, 'src/Native.vb', [
      "' @id CODE-VB-001",
      "' @implements REQ-EXAMPLE-001",
      'Dim separator = 1',
      "''' @id CODE-VB-002",
      "''' @implements REQ-EXAMPLE-001",
      'Dim fake = "\' @id CODE-FAKE-VB-001 @implements REQ-EXAMPLE-001"',
    ].join('\n'));
    const trace = await buildTrace(root);
    expect(trace.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'CODE-HASKELL-001', 'CODE-HASKELL-002', 'CODE-HASKELL-003',
      'CODE-FSHARP-001',
      'CODE-LUA-001', 'CODE-LUA-002',
      'CODE-VB-001', 'CODE-VB-002',
    ]));
    expect(trace.nodes.some((node) => node.id.includes('FAKE'))).toBe(false);
  });

  it('does not fabricate coverage from template tails or JSX content', async () => {
    const root = await project();
    await writeText(root, 'src/template.ts', 'export const text = `prefix ${42} /** @id CODE-FAKE-001\n * @implements REQ-EXAMPLE-001\n */`;');
    await writeText(root, 'src/component.tsx', 'export const view = <div>/** @id CODE-FAKE-002\n * @implements REQ-EXAMPLE-001\n */</div>;');
    const trace = await buildTrace(root);
    expect(trace.nodes.filter((n) => n.id.startsWith('CODE-FAKE'))).toEqual([]);
    expect(trace.diagnostics).toEqual([]);
  });

  it('allows implementation links through explicit design', async () => {
    const root = await project();
    await writeText(root, 'src/service.ts', code.replace(' * @implements REQ-EXAMPLE-001\n', ''));
    const trace = await buildTrace(root);
    expect((await checkTrace(root, trace, true)).coverage.implementation).toBe(1);
  });

  it('reports link coverage as not applicable when no requirements are mandatory', async () => {
    const root = await project();
    const requirements = await readText(root, '.musubix/features/example/requirements.md');
    await writeText(root, '.musubix/features/example/requirements.md', requirements.replace('Priority: must', 'Priority: should'));
    const report = await checkTrace(root, await buildTrace(root), true);
    expect(report.mandatoryRequirements).toBe(0);
    expect(report.coverage).toEqual({ design: null, implementation: null, tests: null });
  });
});

describe('compiler graph', () => {
  it('excludes only manifest-scoped generated caches from stable inputs', async () => {
    const root = await fixture({
      'Root.sln': '',
      '.dotnet/cache.ts': 'export const generated = 1;',
      'gradle/build.gradle.kts': '',
      'gradle/.gradle/cache.ts': 'export const generated = 1;',
      'dart/pubspec.yaml': 'name: example\n',
      'dart/.dart_tool/cache.dart': 'void generated() {}',
      'swift/Package.swift': '// swift-tools-version: 6.0\n',
      'swift/.build/cache.swift': 'func generated() {}',
      'zig/build.zig.zon': '.{}',
      'zig/.zig-cache/cache.zig': 'pub fn generated() void {}',
      'zig/zig-out/cache.zig': 'pub fn generated() void {}',
      'dotnet/App.vbproj': '<Project />',
      'dotnet/.dotnet/cache.vb': 'Module Generated\nEnd Module',
      'plain/.gradle/source.ts': 'export const gradle = 1;',
      'plain/.dart_tool/source.dart': 'void dartSource() {}',
      'plain/.build/source.swift': 'func swiftSource() {}',
      'plain/.zig-cache/source.zig': 'pub fn zigCacheSource() void {}',
      'plain/zig-out/source.zig': 'pub fn zigOutSource() void {}',
      'plain/.dotnet/source.cs': 'class DotnetSource {}',
    });
    const tracked = await files(root);
    expect(tracked).toEqual(expect.arrayContaining([
      'plain/.gradle/source.ts',
      'plain/.dart_tool/source.dart',
      'plain/.build/source.swift',
      'plain/.zig-cache/source.zig',
      'plain/zig-out/source.zig',
      'plain/.dotnet/source.cs',
    ]));
    expect(tracked).not.toEqual(expect.arrayContaining([
      '.dotnet/cache.ts',
      'gradle/.gradle/cache.ts',
      'dart/.dart_tool/cache.dart',
      'swift/.build/cache.swift',
      'zig/.zig-cache/cache.zig',
      'zig/zig-out/cache.zig',
      'dotnet/.dotnet/cache.vb',
    ]));
    const before = await evidenceSnapshot(root);
    await writeText(root, 'gradle/.gradle/cache.ts', 'export const generated = 2;');
    await writeText(root, 'dart/.dart_tool/cache.dart', 'void generatedAgain() {}');
    await writeText(root, 'swift/.build/cache.swift', 'func generatedAgain() {}');
    await writeText(root, 'zig/.zig-cache/cache.zig', 'pub fn generatedAgain() void {}');
    await writeText(root, 'zig/zig-out/cache.zig', 'pub fn generatedAgain() void {}');
    await writeText(root, '.dotnet/cache.ts', 'export const generated = 2;');
    expect(await evidenceSnapshot(root)).toEqual(before);
    await writeText(root, 'plain/.gradle/source.ts', 'export const gradle = 2;');
    expect(await evidenceSnapshot(root)).not.toEqual(before);
  });

  it('indexes static, re-export, dynamic, require, symbols and call targets', async () => {
    const root = await fixture({
      'src/a.ts': 'export function work() { return 1; }',
      'src/b.ts': "import { work } from './a.js'; export const result = work();",
      'src/c.ts': "export { work } from './a.js'; const a = import('./a.js'); const b = require('./b.js');",
    });
    const graph = await indexGraph(root);
    expect(graph.imports.filter((e) => !e.external)).toHaveLength(4);
    expect(graph.symbols.some((s) => s.name === 'work')).toBe(true);
    expect(graph.calls.some((c) => c.expression === 'work' && c.target?.startsWith('src/a.ts#work'))).toBe(true);
    expect(graphImpact(graph, 'work').map((r) => r.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(graphImpact(graph, 'src/a.ts#work')).toEqual(graphImpact(graph, 'src/a.ts'));
    expect(cycles(graph)).toEqual([]);
  });

  it('resolves tsconfig path aliases and JS directory imports', async () => {
    const root = await fixture({
      'tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext', baseUrl: '.', paths: { '@/*': ['src/*'] }, allowJs: true } }),
      'src/lib/index.js': 'export const value = 1;',
      'src/main.ts': "import { value } from '@/lib'; export { value };",
    });
    const graph = await indexGraph(root);
    expect(graph.imports[0]).toMatchObject({ to: 'src/lib/index.js', external: false });
    expect(graph.diagnostics).toEqual([]);
  });

  it('resolves nearest nested tsconfig paths', async () => {
    const root = await fixture({
      'packages/app/tsconfig.json': JSON.stringify({ compilerOptions: { moduleResolution: 'Bundler', module: 'ESNext', baseUrl: '.', paths: { '@app/*': ['src/*'] } } }),
      'packages/app/src/a.ts': 'export const a = 1;',
      'packages/app/src/b.ts': "import { a } from '@app/a'; export { a };",
    });
    const graph = await indexGraph(root);
    expect(graph.imports[0]?.to).toBe('packages/app/src/a.ts');
  });

  it('resolves NodeNext import/require conditions according to usage', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({ type: 'module', imports: { '#service': { import: './esm.ts', require: './cjs.cts' } } }),
      'esm.ts': 'export const value = 1;',
      'cjs.cts': 'export const value = 2;',
      'main.ts': "import { value } from '#service'; export { value };",
      'legacy.cts': "const value = require('#service');",
    });
    const graph = await indexGraph(root);
    expect(graph.imports.find((e) => e.from === 'main.ts')?.to).toBe('esm.ts');
    expect(graph.imports.find((e) => e.from === 'legacy.cts')?.to).toBe('cjs.cts');
  });

  it('finds cycles, self cycles and enforces architecture globs', async () => {
    const root = await fixture({
      'src/domain/a.ts': "import '../ui/b.js'; export {};",
      'src/ui/b.ts': "import '../domain/a.js'; export {};",
      'self.js': "require('./self.js');",
    });
    const graph = await indexGraph(root);
    expect(cycles(graph)).toEqual([['self.js'], ['src/domain/a.ts', 'src/ui/b.ts']]);
    const gate = graphGate(graph, { forbidCycles: true, rules: [{ name: 'layers', from: 'src/domain/**', disallow: ['src/ui/**'] }] });
    expect(gate.valid).toBe(false);
    expect(gate.diagnostics.map((d) => d.code)).toContain('GRAPH_ARCHITECTURE');
    expect(graphGate(graph, { forbidCycles: false, rules: [] }).valid).toBe(true);
  });

  it('reports unresolved local and nonliteral imports honestly', async () => {
    const root = await fixture({ 'main.ts': "import './missing.js'; const path = './a.js'; import(path); import 'unknown-external';" });
    const graph = await indexGraph(root);
    expect(graph.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['GRAPH_UNRESOLVED', 'GRAPH_DYNAMIC', 'GRAPH_EXTERNAL_UNRESOLVED']));
    expect(graphGate(graph, defaultConfig.architecture).valid).toBe(false);
  });

  it('indexes Rust modules, uses, symbols and calls without proxy files', async () => {
    const root = await fixture({
      'src/lib.rs': 'mod policy;\nuse crate::policy::evaluate;\npub fn authorize() { evaluate(); }',
      'src/policy.rs': 'pub fn evaluate() {}',
      'tests/policy.rs': 'use crate::policy;\nfn scenario() { policy::evaluate(); }',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/lib.rs', 'src/policy.rs', 'tests/policy.rs']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/lib.rs', to: 'src/policy.rs', kind: 'mod', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/policy.rs', name: 'evaluate', kind: 'RustFn' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/lib.rs', expression: 'evaluate', target: expect.stringContaining('src/policy.rs#evaluate@') }));
  });

  it('indexes Python imports, declarations and direct calls', async () => {
    const root = await fixture({
      'src/app.py': 'from .service import run\n\ndef main():\n    run()\n',
      'src/service.py': 'def run():\n    return True\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/app.py', 'src/service.py']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/app.py', to: 'src/service.py', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/service.py', name: 'run', kind: 'PythonFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/app.py', expression: 'run', target: expect.stringContaining('src/service.py#run@') }));
  });

  it('indexes Go module imports, declarations and direct calls', async () => {
    const root = await fixture({
      'go.mod': 'module example.com/app\n\ngo 1.23\n',
      'main.go': 'package main\nimport "example.com/app/service"\nfunc main() { service.Run() }\n',
      'service/service.go': 'package service\nfunc Run() {}\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['main.go', 'service/service.go']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'main.go', to: 'service/service.go', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'service/service.go', name: 'Run', kind: 'GoFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'main.go', expression: 'service.Run', target: expect.stringContaining('service/service.go#Run@') }));
  });

  it('indexes Java package imports, types, methods and direct calls', async () => {
    const root = await fixture({
      'src/com/example/App.java': 'package com.example;\nimport com.example.Service;\npublic class App { public void start() { Service.run(); } }\n',
      'src/com/example/Service.java': 'package com.example;\npublic class Service { public static void run() {} }\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/com/example/App.java', 'src/com/example/Service.java']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/com/example/App.java', to: 'src/com/example/Service.java', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/com/example/Service.java', name: 'Service', kind: 'JavaClass' }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/com/example/Service.java', name: 'run', kind: 'JavaMethod' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/com/example/App.java', expression: 'Service.run', target: expect.stringContaining('src/com/example/Service.java#run@') }));
  });

  it('indexes C and C++ includes, types, functions and direct calls', async () => {
    const root = await fixture({
      'include/service.hpp': '#pragma once\nstruct Service { int run(); };\n',
      'src/main.cpp': '#include "../include/service.hpp"\nint helper() { return 1; }\nint main() { return helper(); }\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['include/service.hpp', 'src/main.cpp']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/main.cpp', to: 'include/service.hpp', kind: 'include', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'include/service.hpp', name: 'Service', kind: 'CppStruct' }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/main.cpp', name: 'helper', kind: 'CppFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/main.cpp', expression: 'helper', target: expect.stringContaining('src/main.cpp#helper@') }));
  });

  it('indexes CSharp using directives, types, methods and direct calls', async () => {
    const root = await fixture({
      'src/App.cs': 'using Example.Services;\nnamespace Example;\npublic class App { public void Start() { Service.Run(); } }\n',
      'src/Services/Service.cs': 'namespace Example.Services;\npublic static class Service { public static void Run() {} }\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/App.cs', 'src/Services/Service.cs']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.cs', to: 'src/Services/Service.cs', kind: 'using', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Services/Service.cs', name: 'Service', kind: 'CsharpClass' }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Services/Service.cs', name: 'Run', kind: 'CsharpMethod' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.cs', expression: 'Service.Run', target: expect.stringContaining('src/Services/Service.cs#Run@') }));
  });

  it('indexes PHP includes, namespace uses, types, functions and calls', async () => {
    const root = await fixture({
      'src/App.php': "<?php\nnamespace App;\nuse App\\Service\\Runner;\nrequire_once 'helpers.php';\ninclude $dynamicPath;\ndeclare(strict_types=1);\n$closure = function () use ($dynamicPath) {};\n$arrow = fn($value) => $value;\nfunction main(): void { helper(); Runner::run(); exit(0); }\n",
      'src/Service/Runner.php': '<?php\nnamespace App\\Service;\nclass Runner { public static function run(): void {} }\n',
      'src/helpers.php': '<?php\nfunction helper(): void {}\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/App.php', 'src/Service/Runner.php', 'src/helpers.php']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.php', to: 'src/Service/Runner.php', kind: 'use', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.php', to: 'src/helpers.php', kind: 'include', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Service/Runner.php', name: 'Runner', kind: 'PhpClass' }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/helpers.php', name: 'helper', kind: 'PhpFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.php', expression: 'helper', target: expect.stringContaining('src/helpers.php#helper@') }));
    expect(graph.calls.map((call) => call.expression)).not.toEqual(expect.arrayContaining(['function', 'declare', 'fn', 'use', 'exit']));
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({ code: 'GRAPH_DYNAMIC', path: 'src/App.php' }));
    expect(graphGate(graph, defaultConfig.architecture, { mode: 'strict' }).valid).toBe(false);
  });

  it('indexes R source dependencies, packages, functions and calls', async () => {
    const root = await fixture({
      'R/main.R': 'library(dplyr)\nsource("helpers.R")\nmain <- function() helper()\n',
      'R/helpers.R': 'helper <- function() TRUE\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['R/helpers.R', 'R/main.R']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'R/main.R', to: 'R/helpers.R', kind: 'include', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'R/main.R', to: 'r:dplyr', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'R/helpers.R', name: 'helper', kind: 'RFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'R/main.R', expression: 'helper', target: expect.stringContaining('R/helpers.R#helper@') }));
  });

  it('indexes Julia includes, modules, types, functions and calls', async () => {
    const root = await fixture({
      'src/App.jl': 'module App\ninclude("Utils.jl")\ninclude("Domain.jl")\nusing .Utils\nusing .Domain: WorkflowError\nfunction main()\n  run!()\nend\nend\n',
      'src/Domain.jl': 'module Domain\nstruct WorkflowError\n message::String\nend\nend\n',
      'src/Utils.jl': 'module Utils\nstruct Job\n id::Int\nend\nrun!() = true\nend\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/App.jl', 'src/Domain.jl', 'src/Utils.jl']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.jl', to: 'src/Utils.jl', kind: 'include', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.jl', to: 'src/Utils.jl', kind: 'import', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({
      from: 'src/App.jl', to: 'src/Domain.jl', specifier: 'Domain', kind: 'import', external: false,
    }));
    expect(graph.imports).not.toContainEqual(expect.objectContaining({ to: 'julia:WorkflowError' }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Utils.jl', name: 'Job', kind: 'JuliaType' }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Utils.jl', name: 'run!', kind: 'JuliaFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.jl', expression: 'run!', target: expect.stringContaining('src/Utils.jl#run!@') }));
  });

  it('indexes Kotlin imports, declarations and calls for source and script files', async () => {
    const root = await fixture({
      'src/App.kt': 'package demo\nimport demo.*\nimport kotlinx.coroutines.launch\nfun main() { run() }\n',
      'src/Model.kt': 'package demo\nclass Model\n',
      'src/Service.kt': 'package demo\nfun run() {}\n',
      'scripts/check.kts': '@file:Import("../src/Service.kt")\nfun check() = run()\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['scripts/check.kts', 'src/App.kt', 'src/Model.kt', 'src/Service.kt']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.kt', to: 'src/Service.kt', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.kt', to: 'src/Model.kt', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'scripts/check.kts', to: 'src/Service.kt', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'kotlin:kotlinx.coroutines.launch', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Service.kt', name: 'run', kind: 'KotlinFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.kt', expression: 'run', target: expect.stringContaining('src/Service.kt#run@') }));
  });

  it('indexes Ruby requires, declarations and calls', async () => {
    const root = await fixture({
      'config/setup.rb': 'def setup()\n  true\nend\n',
      'lib/app.rb': "require_relative 'helper'\nload 'config/setup.rb'\nrequire 'json'\ndef main()\n  helper()\nend\n",
      'lib/helper.rb': 'def helper()\n  true\nend\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['config/setup.rb', 'lib/app.rb', 'lib/helper.rb']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'lib/app.rb', to: 'lib/helper.rb', kind: 'require', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'lib/app.rb', to: 'config/setup.rb', kind: 'include', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'ruby:json', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'lib/helper.rb', name: 'helper', kind: 'RubyMethod' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'lib/app.rb', expression: 'helper', target: expect.stringContaining('lib/helper.rb#helper@') }));
  });

  it('indexes Swift imports, declarations and calls', async () => {
    const root = await fixture({
      'Sources/App.swift': 'import Foundation\nprivate(set) var state = 0\nfileprivate(set) var localState = 0\ninternal(set) var moduleState = 0\npackage(set) var packageState = 0\nfunc helper() {}\nfunc main() { helper() }\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['Sources/App.swift']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'swift:Foundation', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ name: 'helper', kind: 'SwiftFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ expression: 'helper', target: expect.stringContaining('Sources/App.swift#helper@') }));
    expect(graph.calls.map((call) => call.expression)).not.toEqual(expect.arrayContaining(['private', 'fileprivate', 'internal', 'package']));
  });

  it('indexes Dart local imports, declarations and calls', async () => {
    const root = await fixture({
      'packages/example/pubspec.yaml': 'name: example\n',
      'packages/example/lib/main.dart': "import 'package:example/service.dart' if (dart.library.io) 'native.dart';\nimport 'package:meta/meta.dart';\nvoid main() { run(); }\n",
      'packages/example/lib/native.dart': 'void nativeRun() {}\n',
      'packages/example/lib/service.dart': 'class Service {}\nvoid run() {}\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual([
      'packages/example/lib/main.dart',
      'packages/example/lib/native.dart',
      'packages/example/lib/service.dart',
    ]);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'packages/example/lib/main.dart', to: 'packages/example/lib/service.dart', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'packages/example/lib/main.dart', to: 'packages/example/lib/native.dart', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'dart:package:meta/meta.dart', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'packages/example/lib/service.dart', name: 'Service', kind: 'DartClass' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'packages/example/lib/main.dart', expression: 'run', target: expect.stringContaining('packages/example/lib/service.dart#run@') }));
  });

  it('indexes Scala imports, declarations and calls', async () => {
    const root = await fixture({
      'src/App.scala': 'package demo\nimport demo.{RiskCase as CaseAlias, RiskService, *}\nimport demo.RiskCase, demo.RiskService\nimport scala.collection.mutable\ndef main(): Unit = run()\n',
      'src/Extra.scala': 'package demo\nclass Extra\n',
      'src/RiskCase.scala': 'package demo\nclass RiskCase\n',
      'src/Service.scala': 'package demo\nobject RiskService\ndef run(): Unit = ()\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/App.scala', 'src/Extra.scala', 'src/RiskCase.scala', 'src/Service.scala']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.scala', to: 'src/Service.scala', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.scala', to: 'src/RiskCase.scala', specifier: 'demo.RiskCase', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.scala', to: 'src/Extra.scala', external: false }));
    expect(graph.imports.filter((edge) => edge.from === 'src/App.scala' && edge.specifier.startsWith('demo') && edge.external)).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'scala:scala.collection.mutable', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Service.scala', name: 'run', kind: 'ScalaMethod' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.scala', expression: 'run', target: expect.stringContaining('src/Service.scala#run@') }));
  });

  it('indexes Elixir module dependencies, declarations and calls for ex and exs', async () => {
    const root = await fixture({
      'lib/app.ex': 'defmodule Demo.App do\n  alias Demo.{Model, Service}\n  use GenServer\n  def main(), do: Service.run()\nend\n',
      'lib/model.ex': 'defmodule Demo.Model do\nend\n',
      'lib/service.ex': 'defmodule Demo.Service do\n  def run(), do: :ok\nend\n',
      'test/app_test.exs': 'Code.require_file("../lib/service.ex", __DIR__)\ndefmodule Demo.AppTest do\n  alias Demo.App\nend\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['lib/app.ex', 'lib/model.ex', 'lib/service.ex', 'test/app_test.exs']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'lib/app.ex', to: 'lib/service.ex', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'lib/app.ex', to: 'lib/model.ex', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'test/app_test.exs', to: 'lib/service.ex', kind: 'require', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'elixir:GenServer', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'lib/service.ex', name: 'run', kind: 'ElixirFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'lib/app.ex', expression: 'Service.run', target: expect.stringContaining('lib/service.ex#run@') }));
  });

  it('indexes Haskell modules, declarations and calls', async () => {
    const root = await fixture({
      'src/Main.hs': 'module Main where\nimport Service\nimport Data.Text\nmain = run ()\n',
      'src/Service.hs': 'module Service where\nrun _ = True\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/Main.hs', 'src/Service.hs']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/Main.hs', to: 'src/Service.hs', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'haskell:Data.Text', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Service.hs', name: 'run', kind: 'HaskellFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/Main.hs', expression: 'run', target: expect.stringContaining('src/Service.hs#run@') }));
  });

  it('does not index Dart or Haskell reserved words as functions', async () => {
    const graph = await indexGraph(await fixture({
      'control.dart': [
        'void main() {',
        '  if (true) {}',
        '  for (;;) {}',
        '  while (false) {}',
        '  switch (1) { default: break; }',
        '}',
      ].join('\n'),
      'control.hs': [
        'choose flag =',
        '  let value = if flag then 1 else 0',
        '  in value',
        'if condition = True',
        'then branch = branch',
        'else branch = branch',
      ].join('\n'),
    }));
    expect(graph.symbols.map((symbol) => symbol.name)).not.toEqual(expect.arrayContaining([
      'if', 'for', 'while', 'switch', 'let', 'then', 'else',
    ]));
  });

  it('indexes Lua requires, declarations and calls', async () => {
    const root = await fixture({
      'src/main.lua': 'local helper = require("helper")\nlocal socket = require("socket")\nhelper.run()\n',
      'helper.lua': 'local M = {}\nfunction M.run() return true end\nreturn M\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['helper.lua', 'src/main.lua']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/main.lua', to: 'helper.lua', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'lua:socket', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'helper.lua', name: 'run', kind: 'LuaFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/main.lua', expression: 'helper.run', target: expect.stringContaining('helper.lua#run@') }));
  });

  it('indexes Zig imports, declarations and calls', async () => {
    const root = await fixture({
      'src/main.zig': 'const std = @import("std");\nconst helper = @import("helper.zig");\npub fn main() void { helper.run(); }\n',
      'src/helper.zig': 'pub const Job = struct {};\npub fn run() void {}\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/helper.zig', 'src/main.zig']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/main.zig', to: 'src/helper.zig', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'zig:std', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/helper.zig', name: 'Job', kind: 'ZigStruct' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/main.zig', expression: 'helper.run', target: expect.stringContaining('src/helper.zig#run@') }));
  });

  it('indexes Solidity imports, declarations and calls', async () => {
    const root = await fixture({
      'contracts/App.sol': 'pragma solidity ^0.8.0;\nimport "contracts/Lib.sol";\nimport "@openzeppelin/contracts/token/ERC20/ERC20.sol";\ncontract App { function main() public { Lib.run(); } }\n',
      'contracts/Lib.sol': 'pragma solidity ^0.8.0;\nlibrary Lib { function run() internal {} }\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['contracts/App.sol', 'contracts/Lib.sol']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'contracts/App.sol', to: 'contracts/Lib.sol', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'solidity:@openzeppelin/contracts/token/ERC20/ERC20.sol', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'contracts/Lib.sol', name: 'Lib', kind: 'SolidityLibrary' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'contracts/App.sol', expression: 'Lib.run', target: expect.stringContaining('contracts/Lib.sol#run@') }));
  });

  it('indexes Objective-C imports, declarations and message calls while retaining Objective-C++', async () => {
    const root = await fixture({
      'src/App.m': '#import "Service.h"\n#import "Other.h"\n#import "Combined.h"\n#import <Foundation/Foundation.h>\nvoid start(void) { [Service run]; [A bar]; }\n',
      'src/Combined.h': '@interface A\n+ (void)foo;\n@end\n@interface B\n+ (void)bar;\n@end\n',
      'src/Combined.m': '@implementation A\n+ (void)foo {}\n@end\n@implementation B\n+ (void)bar {}\n@end\n',
      'src/Other.h': '@interface Other\n+ (void)run;\n@end\n',
      'src/Service.h': '@interface Service\n+ (void)run;\n+ (void)run:(id)value success:(BOOL)success;\n+ (void)run:(id)value failure:(BOOL)failure;\n@end\n',
      'src/Service.mm': '#import "Service.h"\n@implementation Service\n+ (void)run {}\n+ (void)run:(id)value success:(BOOL)success {}\n+ (void)run:(id)value failure:(BOOL)failure {}\n@end\n',
      'src/Targeted.m': '#import "Service.h"\nvoid targeted(void) { [Service run:value failure:NO]; }\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual([
      'src/App.m', 'src/Combined.h', 'src/Combined.m', 'src/Other.h',
      'src/Service.h', 'src/Service.mm', 'src/Targeted.m',
    ]);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.m', to: 'src/Service.h', kind: 'include', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'cpp:Foundation/Foundation.h', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Service.h', name: 'Service', kind: 'ObjectiveCInterface' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({
      path: 'src/App.m',
      expression: 'Service.run',
      target: expect.stringMatching(/^src\/Service\.mm#run@/),
    }));
    expect(graph.calls).toContainEqual(expect.objectContaining({
      path: 'src/Targeted.m',
      expression: 'Service.run:failure:',
      target: expect.stringMatching(/^src\/Service\.mm#run:failure:@/),
    }));
    expect(graph.calls.filter((call) => call.expression.startsWith('Service.')).every((call) => !call.target?.startsWith('src/Other.h#'))).toBe(true);
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.m', expression: 'A.bar', target: null }));
  });

  it('indexes F# loads, opens, declarations and calls for fs and fsx', async () => {
    const root = await fixture({
      'src/Service.fs': 'namespace Demo\nmodule Service =\n  let run () = ()\n',
      'src/App.fsx': '#load "Service.fs"\nopen Demo.Service\nopen System\nrun()\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/App.fsx', 'src/Service.fs']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.fsx', to: 'src/Service.fs', kind: 'include', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.fsx', to: 'src/Service.fs', kind: 'using', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'fsharp:System', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Service.fs', name: 'run', kind: 'FsharpValue' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.fsx', expression: 'run', target: expect.stringContaining('src/Service.fs#run@') }));
  });

  it('indexes Visual Basic namespaces, imports, declarations and calls', async () => {
    const root = await fixture({
      'src/App.vb': 'Imports Demo.Services, LimitsAlias = Demo.Limits, System\nModule App\n  Sub Main()\n    Service.Run()\n    LimitsAlias.Check()\n  End Sub\nEnd Module\n',
      'src/Limits.vb': 'Namespace Demo.Limits\n  Public Module Limits\n    Public Sub Check()\n    End Sub\n  End Module\nEnd Namespace\n',
      'src/Service.vb': 'Namespace Demo.Services\n  Public Class Service\n    Public Shared Sub Run()\n    End Sub\n  End Class\nEnd Namespace\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/App.vb', 'src/Limits.vb', 'src/Service.vb']);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.vb', to: 'src/Service.vb', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({
      from: 'src/App.vb', to: 'src/Limits.vb', specifier: 'LimitsAlias=Demo.Limits', external: false,
    }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ to: 'vb:System', external: true }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Service.vb', name: 'Service', kind: 'VbClass' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.vb', expression: 'Service.Run', target: expect.stringContaining('src/Service.vb#Run@') }));
  });

  it.each([
    ['Ruby', 'main.rb', "require_relative 'missing'\n"],
    ['Kotlin', 'main.kts', '@file:Import("missing.kts")\n'],
    ['Dart', 'main.dart', "import 'missing.dart';\n"],
    ['Elixir', 'main.exs', 'Code.require_file("missing.ex", __DIR__)\n'],
    ['Lua', 'main.lua', 'dofile("missing.lua")\n'],
    ['Zig', 'main.zig', 'const missing = @import("missing.zig");\n'],
    ['Solidity', 'main.sol', 'import "./Missing.sol";\n'],
    ['Objective-C', 'main.m', '#import "Missing.h"\n'],
    ['F#', 'main.fsx', '#load "Missing.fs"\n'],
  ])('reports unresolved explicit local %s dependencies', async (_language, path, source) => {
    const graph = await indexGraph(await fixture({ [path]: source }));
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({ code: 'GRAPH_UNRESOLVED', path }));
  });

  it('masks comments and strings in every added language adapter', async () => {
    const graph = await indexGraph(await fixture({
      'mask.kt': '// fun Fake() {}\nval text = "Fake()"\n',
      'mask.rb': '# def Fake()\ntext = "Fake()"\n',
      'mask.swift': '// func Fake() {}\nlet text = "Fake()"\n',
      'mask.dart': '// class Fake {}\nconst text = "Fake()";\n',
      'mask.scala': '// object Fake\nval text = "Fake()"\n',
      'mask.ex': '# def Fake(), do: :ok\ntext = "Fake()"\n',
      'mask.hs': '-- Fake _ = True\ntext = "Fake()"\n',
      'mask.lua': '-- function Fake() end\nlocal text = "Fake()"\n',
      'mask.zig': '// pub fn Fake() void {}\nconst text = "Fake()";\n',
      'mask.sol': '// contract Fake {}\nstring constant text = "Fake()";\n',
      'mask.m': '// @interface Fake\nNSString *text = @"[Fake run]";\n',
      'mask.fs': '// type Fake = class end\nlet text = "Fake()"\n',
      'mask.vb': "' Class Fake\nDim text = \"Fake()\"\n",
    }));
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.symbols.some((symbol) => symbol.name === 'Fake')).toBe(false);
    expect(graph.calls.some((call) => call.expression.includes('Fake'))).toBe(false);
  });

  it('ignores unrecognized extensions outside graph inputs', async () => {
    const root = await fixture({ 'src/service.pl': 'sub service { 1 }\n' });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual([]);
    expect(graph.unsupportedFiles).toEqual([]);
    expect(graph.diagnostics).not.toContainEqual(expect.objectContaining({ code: 'GRAPH_UNSUPPORTED_LANGUAGE' }));
  });

  it('refuses stale caches after source and config changes', async () => {
    const root = await fixture({ 'a.ts': 'export const a = 1;' });
    await indexGraph(root);
    expect((await loadGraph(root)).files).toEqual(['a.ts']);
    await writeText(root, 'a.ts', 'export const a = 2;');
    await expect(loadGraph(root)).rejects.toThrow('stale');
    await indexGraph(root);
    await writeText(root, 'tsconfig.json', '{}');
    await expect(loadGraph(root)).rejects.toThrow('stale');
  });

  it.each([
    ['src/a.ts', 'src/**', true], ['src/a.ts', '**/*.ts', true], ['a.ts', '**/*.ts', true],
    ['src/a/b.ts', 'src/*.ts', false], ['src/a.ts', 'src/?.ts', true],
    ['npm:express', 'npm:express', true], ['x+y.ts', 'x+y.ts', true],
  ])('matches %s to %s', (path, pattern, expected) => {
    expect(matchGlob(path, pattern)).toBe(expected);
  });
});
