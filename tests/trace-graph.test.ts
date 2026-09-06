import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildTrace, checkTrace, cycles, defaultConfig, graphGate, graphImpact, indexGraph, loadGraph, loadTrace,
  matchGlob, readText, traceImpact, writeText,
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
      'src/App.php': "<?php\nnamespace App;\nuse App\\Service\\Runner;\nrequire_once 'helpers.php';\nfunction main(): void { helper(); Runner::run(); }\n",
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
      'src/App.jl': 'module App\ninclude("Utils.jl")\nusing .Utils\nfunction main()\n  run!()\nend\nend\n',
      'src/Utils.jl': 'module Utils\nstruct Job\n id::Int\nend\nrun!() = true\nend\n',
    });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual(['src/App.jl', 'src/Utils.jl']);
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.jl', to: 'src/Utils.jl', kind: 'include', external: false }));
    expect(graph.imports).toContainEqual(expect.objectContaining({ from: 'src/App.jl', to: 'src/Utils.jl', kind: 'import', external: false }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Utils.jl', name: 'Job', kind: 'JuliaType' }));
    expect(graph.symbols).toContainEqual(expect.objectContaining({ path: 'src/Utils.jl', name: 'run!', kind: 'JuliaFunction' }));
    expect(graph.calls).toContainEqual(expect.objectContaining({ path: 'src/App.jl', expression: 'run!', target: expect.stringContaining('src/Utils.jl#run!@') }));
  });

  it('reports languages without graph adapters as unsupported inputs', async () => {
    const root = await fixture({ 'src/service.kt': 'fun service() = true\n' });
    const graph = await indexGraph(root);
    expect(graph.files).toEqual([]);
    expect(graph.unsupportedFiles).toEqual(['src/service.kt']);
    expect(graph.diagnostics).toContainEqual(expect.objectContaining({
      code: 'GRAPH_UNSUPPORTED_LANGUAGE',
      severity: 'warning',
      path: 'src/service.kt',
    }));
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
