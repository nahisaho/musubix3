import ts from 'typescript';
import { dirname, isAbsolute, posix, relative, resolve } from 'node:path';
import { error, type Diagnostic } from '../../domain/src/index.js';
import type { Config } from './config.js';
import { FILE_READ_CONCURRENCY, files, isSource, isTraceSource, mapWithConcurrency, portable, readText, snapshot, writeJson } from './files.js';

export interface ImportEdge {
  from: string;
  to: string;
  specifier: string;
  kind: 'import' | 'export' | 'dynamic' | 'require' | 'use' | 'mod' | 'include' | 'using';
  line: number;
  external: boolean;
}

export interface CodeSymbol {
  id: string;
  name: string;
  path: string;
  line: number;
  kind: string;
  container?: string;
}

export interface CodeGraph {
  schemaVersion: 1;
  generatedAt: string;
  files: string[];
  unsupportedFiles: string[];
  imports: ImportEdge[];
  entrypoints: Array<{ manifest: string; field: string; path: string }>;
  symbols: CodeSymbol[];
  calls: { path: string; line: number; expression: string; target: string | null }[];
  diagnostics: Diagnostic[];
  fingerprints: Record<string, string>;
}

export async function graphInputs(root: string): Promise<string[]> {
  return (await files(root)).filter((p) => isTraceSource(p) || /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json|go\.mod|pubspec\.yaml)$/.test(p));
}

/** @id CODE-BOUNDED-FILE-READ-CONCURRENCY-002
 * @implements REQ-BOUNDED-FILE-READ-CONCURRENCY-002
 * @design DES-BOUNDED-FILE-READ-CONCURRENCY-002
 */
export async function indexGraph(root: string, persist = true): Promise<CodeGraph> {
  const paths = await graphInputs(root);
  const typedSources = paths.filter(isSource);
  const rustSources = paths.filter((path) => path.endsWith('.rs'));
  const pythonSources = paths.filter((path) => path.endsWith('.py'));
  const goSources = paths.filter((path) => path.endsWith('.go'));
  const javaSources = paths.filter((path) => path.endsWith('.java'));
  const cppSources = paths.filter((path) => /\.(?:c|cc|cpp|h|hh|hpp|m|mm)$/.test(path));
  const csharpSources = paths.filter((path) => path.endsWith('.cs'));
  const phpSources = paths.filter((path) => path.endsWith('.php'));
  const rSources = paths.filter((path) => /\.(?:r|R)$/.test(path));
  const juliaSources = paths.filter((path) => path.endsWith('.jl'));
  const kotlinSources = paths.filter((path) => /\.(?:kt|kts)$/.test(path));
  const rubySources = paths.filter((path) => path.endsWith('.rb'));
  const swiftSources = paths.filter((path) => path.endsWith('.swift'));
  const dartSources = paths.filter((path) => path.endsWith('.dart'));
  const scalaSources = paths.filter((path) => path.endsWith('.scala'));
  const elixirSources = paths.filter((path) => /\.(?:ex|exs)$/.test(path));
  const haskellSources = paths.filter((path) => path.endsWith('.hs'));
  const luaSources = paths.filter((path) => path.endsWith('.lua'));
  const zigSources = paths.filter((path) => path.endsWith('.zig'));
  const soliditySources = paths.filter((path) => path.endsWith('.sol'));
  const objectiveCSources = paths.filter((path) => /\.(?:m|mm)$/.test(path));
  const fsharpSources = paths.filter((path) => /\.(?:fs|fsx)$/.test(path));
  const vbSources = paths.filter((path) => path.endsWith('.vb'));
  const sources = [
    ...typedSources, ...rustSources, ...pythonSources, ...goSources, ...javaSources,
    ...cppSources, ...csharpSources, ...phpSources, ...rSources, ...juliaSources,
    ...kotlinSources, ...rubySources, ...swiftSources, ...dartSources, ...scalaSources,
    ...elixirSources, ...haskellSources, ...luaSources, ...zigSources, ...soliditySources,
    ...fsharpSources, ...vbSources,
  ].sort();
  const supported = new Set(sources);
  const unsupportedFiles = paths.filter((path) => isTraceSource(path) && !supported.has(path));
  const known = new Set(sources);
  const diagnostics: Diagnostic[] = [];
  if (unsupportedFiles.length) {
    diagnostics.push({
      code: 'GRAPH_UNSUPPORTED_LANGUAGE',
      severity: 'warning',
      message: `Dependency and call graph analysis is unavailable for ${unsupportedFiles.length} source file(s) in unsupported languages.`,
      path: unsupportedFiles[0]!,
    });
  }
  const configPaths = new Set(paths.filter((p) => /(?:^|\/)tsconfig\.json$/.test(p)));
  const optionsCache = new Map<string, ts.CompilerOptions>();
  function optionsFor(path: string): ts.CompilerOptions {
    let directory = dirname(path);
    let config: string | undefined;
    while (true) {
      const candidate = directory === '.' ? 'tsconfig.json' : `${directory}/tsconfig.json`;
      if (configPaths.has(candidate)) { config = candidate; break; }
      if (directory === '.') break;
      directory = dirname(directory);
    }
    const key = config ?? '<default>';
    const cached = optionsCache.get(key);
    if (cached) return cached;
    let options: ts.CompilerOptions = { allowJs: true, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022, noEmit: true };
    if (config) {
      const loaded = ts.readConfigFile(resolve(root, config), ts.sys.readFile);
      if (loaded.error) diagnostics.push(error('GRAPH_TSCONFIG', ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'), config));
      else {
        const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, resolve(root, dirname(config)));
        for (const d of parsed.errors.filter((d) => d.code !== 18003)) diagnostics.push(error('GRAPH_TSCONFIG', ts.flattenDiagnosticMessageText(d.messageText, '\n'), config));
        options = { ...options, ...parsed.options, noEmit: true };
      }
    }
    optionsCache.set(key, options);
    return options;
  }
  const program = ts.createProgram(typedSources.map((p) => resolve(root, p)), optionsFor('index.ts'));
  const checker = program.getTypeChecker();
  const graph: CodeGraph = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    files: sources,
    unsupportedFiles,
    imports: [],
    entrypoints: [],
    symbols: [],
    calls: [],
    diagnostics,
    fingerprints: await snapshot(root, paths),
  };
  for (const manifest of paths.filter((candidate) => candidate.endsWith('package.json'))) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(await readText(root, manifest)) as Record<string, unknown>;
    } catch {
      diagnostics.push(error('GRAPH_MANIFEST', 'package.json is not valid JSON.', manifest));
      continue;
    }
    const entries: Array<{ field: string; value: string }> = [];
    const collect = (field: string, candidate: unknown): void => {
      if (typeof candidate === 'string') entries.push({ field, value: candidate });
      else if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) collect(`${field}.${key}`, nested);
      }
    };
    for (const field of ['main', 'module', 'types', 'bin', 'exports'] as const) collect(field, value[field]);
    for (const entry of entries) {
      if (!entry.value.startsWith('.')) continue;
      const base = portable(relative(root, resolve(root, dirname(manifest), entry.value)));
      const candidates = [
        base,
        base.replace(/\.[cm]?js$/, '.ts'),
        base.replace(/\.[cm]?js$/, '.tsx'),
        `${base}/index.ts`,
        `${base}/index.js`,
      ];
      const target = candidates.find((candidate) => known.has(candidate));
      if (target && !graph.entrypoints.some((candidate) => candidate.manifest === manifest && candidate.field === entry.field && candidate.path === target)) {
        graph.entrypoints.push({ manifest, field: entry.field, path: target });
      }
    }
  }
  for (const path of typedSources) {
    const source = program.getSourceFile(resolve(root, path));
    if (!source) continue;
    const options = optionsFor(path);
    const lineOf = (node: ts.Node): number => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    function staticSpecifier(expression: ts.Expression, seen = new Set<ts.Node>(), allowIdentifier = false): string | null {
      if (seen.has(expression)) return null;
      seen.add(expression);
      if (ts.isStringLiteralLike(expression)) return expression.text;
      if (ts.isPropertyAccessExpression(expression) && expression.name.text === 'href') return staticSpecifier(expression.expression, seen, allowIdentifier);
      if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'URL') {
        const first = expression.arguments?.[0];
        const second = expression.arguments?.[1];
        if (first && ts.isStringLiteralLike(first) && second?.getText(source) === 'import.meta.url') return first.text;
      }
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
        && ['pathToFileURL', 'fileURLToPath'].includes(expression.expression.text) && expression.arguments[0]) {
        return staticSpecifier(expression.arguments[0], seen, allowIdentifier);
      }
      if (allowIdentifier && ts.isIdentifier(expression)) {
        let symbol = checker.getSymbolAtLocation(expression);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return staticSpecifier(declaration.initializer, seen, true);
      }
      if (ts.isTemplateExpression(expression)) {
        if (expression.head.text && /^[./]/.test(expression.head.text)) {
          const query = expression.head.text.search(/[?#]/);
          if (query > 0) return expression.head.text.slice(0, query);
        }
        if (!expression.head.text && expression.templateSpans.length) {
          const first = expression.templateSpans[0]!;
          const base = staticSpecifier(first.expression, seen, true);
          if (base && /^[?#]/.test(first.literal.text)) return base;
        }
      }
      return null;
    }
    function addImport(expression: ts.Expression, kind: ImportEdge['kind']): void {
      const staticValue = staticSpecifier(expression);
      if (staticValue === null) {
        diagnostics.push({ code: 'GRAPH_DYNAMIC', severity: 'warning', message: 'Nonliteral module loading is not statically resolved.', path, line: lineOf(expression) });
        return;
      }
      const suffix = staticValue.search(/[?#]/);
      const specifier = suffix > 0 ? staticValue.slice(0, suffix) : staticValue;
      const mode = kind === 'require' ? ts.ModuleKind.CommonJS
        : kind === 'dynamic' || !ts.isStringLiteralLike(expression) ? ts.ModuleKind.ESNext
          : ts.getModeForUsageLocation(source!, expression, options);
      const resolved = ts.resolveModuleName(specifier, source!.fileName, options, ts.sys, undefined, undefined, mode).resolvedModule;
      const target = resolved ? portable(relative(root, resolved.resolvedFileName)) : '';
      const local = target && !target.startsWith('../') && !isAbsolute(target) && !target.includes('node_modules/');
      const external = !local;
      if (!resolved && (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('#') ||
        Object.keys(options.paths ?? {}).some((pattern) => matchGlob(specifier, pattern.replace(/\*/g, '**'))))) {
        diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local import ${specifier}.`, path, lineOf(expression)));
      } else if (!resolved && !specifier.startsWith('node:')) {
        diagnostics.push({ code: 'GRAPH_EXTERNAL_UNRESOLVED', severity: 'warning', message: `Unresolved package ${specifier}; treated as external.`, path, line: lineOf(expression) });
      }
      if (local && !known.has(target) && !/\.d\.[cm]?ts$/.test(target)) {
        diagnostics.push(error('GRAPH_OUTSIDE_INDEX', `Local import ${specifier} resolves outside indexed sources (${target}).`, path, lineOf(expression)));
      }
      graph.imports.push({ from: path, to: local ? target : `npm:${specifier}`, specifier, kind, line: lineOf(expression), external });
    }
    function visit(node: ts.Node): void {
      if (ts.isImportDeclaration(node)) addImport(node.moduleSpecifier, 'import');
      else if (ts.isExportDeclaration(node) && node.moduleSpecifier) addImport(node.moduleSpecifier, 'export');
      else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) addImport(node.moduleReference.expression, 'require');
      else if (ts.isCallExpression(node)) {
        const argument = node.arguments[0];
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword && argument) addImport(argument, 'dynamic');
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require' && argument) addImport(argument, 'require');
        else {
          let symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(node.expression) ? node.expression.name : node.expression);
          if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
          const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
          const file = declaration?.getSourceFile();
          const targetPath = file ? portable(relative(root, file.fileName)) : '';
          const target = file && declaration && known.has(targetPath) ? `${targetPath}#${symbol?.name}@${file.getLineAndCharacterOfPosition(declaration.getStart(file)).line + 1}` : null;
          graph.calls.push({ path, line: lineOf(node), expression: node.expression.getText(source), target });
        }
      }
      if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node) || ts.isVariableDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) {
        const name = node.name.getText(source);
        graph.symbols.push({ id: `${path}#${name}@${lineOf(node)}`, name, path, line: lineOf(node), kind: ts.SyntaxKind[node.kind] });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const rustTexts = new Map(await mapWithConcurrency(rustSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of rustTexts) indexRustSymbols(path, text, graph);
  for (const [path, text] of rustTexts) indexRustRelations(path, text, known, graph);
  const pythonTexts = new Map(await mapWithConcurrency(pythonSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of pythonTexts) indexPythonSymbols(path, text, graph);
  for (const [path, text] of pythonTexts) indexPythonRelations(path, text, known, graph);
  const goTexts = new Map(await mapWithConcurrency(goSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of goTexts) indexGoSymbols(path, text, graph);
  const goModule = paths.includes('go.mod') ? /^module\s+(\S+)/m.exec(await readText(root, 'go.mod'))?.[1] ?? null : null;
  for (const [path, text] of goTexts) indexGoRelations(path, text, known, graph, goModule);
  const javaTexts = new Map(await mapWithConcurrency(javaSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const javaTypes = new Map<string, string>();
  for (const [path, text] of javaTexts) indexJavaSymbols(path, text, graph, javaTypes);
  for (const [path, text] of javaTexts) indexJavaRelations(path, text, graph, javaTypes);
  const cppTexts = new Map(await mapWithConcurrency(cppSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of cppTexts) indexCppSymbols(path, text, graph);
  for (const [path, text] of cppTexts) indexCppRelations(path, text, known, graph);
  const csharpTexts = new Map(await mapWithConcurrency(csharpSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const csharpTypes = new Map<string, string>();
  for (const [path, text] of csharpTexts) indexCsharpSymbols(path, text, graph, csharpTypes);
  for (const [path, text] of csharpTexts) indexCsharpRelations(path, text, graph, csharpTypes);
  const phpTexts = new Map(await mapWithConcurrency(phpSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const phpTypes = new Map<string, string>();
  for (const [path, text] of phpTexts) indexPhpSymbols(path, text, graph, phpTypes);
  for (const [path, text] of phpTexts) indexPhpRelations(path, text, known, graph, phpTypes);
  const rTexts = new Map(await mapWithConcurrency(rSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of rTexts) indexRSymbols(path, text, graph);
  for (const [path, text] of rTexts) indexRRelations(path, text, known, graph);
  const juliaTexts = new Map(await mapWithConcurrency(juliaSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const juliaModules = new Map<string, string>();
  for (const [path, text] of juliaTexts) indexJuliaSymbols(path, text, graph, juliaModules);
  for (const [path, text] of juliaTexts) indexJuliaRelations(path, text, known, graph, juliaModules);
  const kotlinTexts = new Map(await mapWithConcurrency(kotlinSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const kotlinDeclarations = new Map<string, string>();
  for (const [path, text] of kotlinTexts) indexKotlinSymbols(path, text, graph, kotlinDeclarations);
  for (const [path, text] of kotlinTexts) indexKotlinRelations(path, text, known, graph, kotlinDeclarations);
  const rubyTexts = new Map(await mapWithConcurrency(rubySources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of rubyTexts) indexRubySymbols(path, text, graph);
  for (const [path, text] of rubyTexts) indexRubyRelations(path, text, known, graph);
  const swiftTexts = new Map(await mapWithConcurrency(swiftSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of swiftTexts) indexSwiftSymbols(path, text, graph);
  for (const [path, text] of swiftTexts) indexSwiftRelations(path, text, graph);
  const dartTexts = new Map(await mapWithConcurrency(dartSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const dartPackages = new Map<string, string>();
  for (const manifest of paths.filter((path) => path.endsWith('pubspec.yaml'))) {
    const name = /^\s*name\s*:\s*([A-Za-z_]\w*)\s*$/m.exec(await readText(root, manifest))?.[1];
    if (name) dartPackages.set(dirname(manifest), name);
  }
  for (const [path, text] of dartTexts) indexDartSymbols(path, text, graph);
  for (const [path, text] of dartTexts) {
    let directory = dirname(path);
    let packageInfo: { directory: string; name: string } | null = null;
    while (true) {
      const name = dartPackages.get(directory);
      if (name) {
        packageInfo = { directory, name };
        break;
      }
      if (directory === '.') break;
      directory = dirname(directory);
    }
    indexDartRelations(path, text, known, graph, packageInfo);
  }
  const scalaTexts = new Map(await mapWithConcurrency(scalaSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const scalaDeclarations = new Map<string, string>();
  for (const [path, text] of scalaTexts) indexScalaSymbols(path, text, graph, scalaDeclarations);
  for (const [path, text] of scalaTexts) indexScalaRelations(path, text, graph, scalaDeclarations);
  const elixirTexts = new Map(await mapWithConcurrency(elixirSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const elixirModules = new Map<string, string>();
  for (const [path, text] of elixirTexts) indexElixirSymbols(path, text, graph, elixirModules);
  for (const [path, text] of elixirTexts) indexElixirRelations(path, text, known, graph, elixirModules);
  const haskellTexts = new Map(await mapWithConcurrency(haskellSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const haskellModules = new Map<string, string>();
  for (const [path, text] of haskellTexts) indexHaskellSymbols(path, text, graph, haskellModules);
  for (const [path, text] of haskellTexts) indexHaskellRelations(path, text, graph, haskellModules);
  const luaTexts = new Map(await mapWithConcurrency(luaSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of luaTexts) indexLuaSymbols(path, text, graph);
  for (const [path, text] of luaTexts) indexLuaRelations(path, text, known, graph);
  const zigTexts = new Map(await mapWithConcurrency(zigSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of zigTexts) indexZigSymbols(path, text, graph);
  for (const [path, text] of zigTexts) indexZigRelations(path, text, known, graph);
  const solidityTexts = new Map(await mapWithConcurrency(soliditySources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  for (const [path, text] of solidityTexts) indexSoliditySymbols(path, text, graph);
  for (const [path, text] of solidityTexts) indexSolidityRelations(path, text, known, graph);
  for (const [path, text] of cppTexts) indexObjectiveCSymbols(path, text, graph);
  for (const [path, text] of objectiveCSources.map((path) => [path, cppTexts.get(path)!] as const)) indexObjectiveCRelations(path, text, graph);
  const fsharpTexts = new Map(await mapWithConcurrency(fsharpSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const fsharpDeclarations = new Map<string, string>();
  for (const [path, text] of fsharpTexts) indexFsharpSymbols(path, text, graph, fsharpDeclarations);
  for (const [path, text] of fsharpTexts) indexFsharpRelations(path, text, graph, fsharpDeclarations);
  const vbTexts = new Map(await mapWithConcurrency(vbSources, FILE_READ_CONCURRENCY, async (path) => [path, await readText(root, path)] as const));
  const vbDeclarations = new Map<string, string>();
  for (const [path, text] of vbTexts) indexVbSymbols(path, text, graph, vbDeclarations);
  for (const [path, text] of vbTexts) indexVbRelations(path, text, graph, vbDeclarations);
  if (persist) await writeJson(root, '.musubix/cache/codegraph.json', graph);
  return graph;
}

function maskedRust(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"/g, (value) => value.replace(/[^\r\n]/g, ' '));
}

function rustTarget(from: string, specifier: string, known: Set<string>): string | null {
  const directory = dirname(from);
  const segments = specifier.split('::').filter(Boolean);
  let base = directory;
  if (segments[0] === 'crate') {
    base = 'src';
    segments.shift();
  } else {
    while (segments[0] === 'super') {
      base = dirname(base);
      segments.shift();
    }
    if (segments[0] === 'self') segments.shift();
  }
  for (let length = segments.length; length > 0; length -= 1) {
    const modulePath = segments.slice(0, length).join('/');
    for (const candidate of [`${base}/${modulePath}.rs`, `${base}/${modulePath}/mod.rs`]) {
      if (known.has(candidate)) return candidate;
    }
  }
  return null;
}

function indexRustSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskedRust(text);
  const lineOf = (index: number): number => searchable.slice(0, index).split(/\r?\n/).length;
  for (const match of searchable.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(fn|struct|enum|trait|type|const|static)\s+([A-Za-z_]\w*)/gm)) {
    const kind = match[1]!;
    const name = match[2]!;
    const line = lineOf(match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Rust${kind[0]!.toUpperCase()}${kind.slice(1)}` });
  }
}

function indexRustRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const searchable = maskedRust(text);
  const sourceLine = (index: number): number => lineOf(searchable, index);
  for (const match of searchable.matchAll(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)\s*;/gm)) {
    const specifier = match[1]!;
    const target = rustTarget(path, `self::${specifier}`, known);
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved Rust module ${specifier}.`, path, sourceLine(match.index)));
    graph.imports.push({ from: path, to: target ?? `crate:${specifier}`, specifier, kind: 'mod', line: sourceLine(match.index), external: !target });
  }
  for (const match of searchable.matchAll(/^\s*use\s+([^;{]+)(?:\{[^;]*\})?\s*;/gm)) {
    const specifier = match[1]!.trim().replace(/::$/, '');
    const target = /^(?:crate|self|super)::/.test(specifier) ? rustTarget(path, specifier, known) : null;
    graph.imports.push({ from: path, to: target ?? `crate:${specifier}`, specifier, kind: 'use', line: sourceLine(match.index), external: !target });
  }
  const symbolsByName = new Map<string, CodeSymbol[]>();
  for (const symbol of graph.symbols) {
    const entries = symbolsByName.get(symbol.name) ?? [];
    entries.push(symbol);
    symbolsByName.set(symbol.name, entries);
  }
  for (const match of searchable.matchAll(/\b([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\(/g)) {
    const expression = match[1]!;
    const prefix = searchable.slice(Math.max(0, match.index - 5), match.index);
    if (/\bfn\s+$/.test(prefix) || ['if', 'while', 'for', 'match', 'loop'].includes(expression)) continue;
    const name = expression.split('::').at(-1)!;
    const candidates = symbolsByName.get(name) ?? [];
    const target = candidates.length === 1 ? candidates[0]!.id : null;
    graph.calls.push({ path, line: sourceLine(match.index), expression, target });
  }
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split(/\r?\n/).length;
}

function maskWithPatterns(text: string, patterns: RegExp[]): string {
  let masked = text;
  for (const pattern of patterns) masked = masked.replace(pattern, (value) => value.replace(/[^\r\n]/g, ' '));
  return masked;
}

function addCalls(path: string, searchable: string, graph: CodeGraph, ignored: Set<string>, skipAnnotations = false): void {
  const symbols = new Map<string, CodeSymbol[]>();
  for (const symbol of graph.symbols) {
    const values = symbols.get(symbol.name) ?? [];
    values.push(symbol);
    symbols.set(symbol.name, values);
  }
  for (const match of searchable.matchAll(/\b([A-Za-z_]\w*!?(?:[.:]{1,2}[A-Za-z_]\w*!?)*)\s*\(/g)) {
    const expression = match[1]!;
    const name = expression.split(/::|\./).at(-1)!;
    const prefix = searchable.slice(Math.max(0, match.index - 24), match.index);
    if (ignored.has(name) || /\b(?:def|class|func|function|fn|fun|let|sub|new)\s+$/i.test(prefix)) continue;
    if (skipAnnotations && prefix.endsWith('@')) continue;
    const candidates = symbols.get(expression) ?? symbols.get(name) ?? [];
    graph.calls.push({ path, line: lineOf(searchable, match.index), expression, target: candidates.length === 1 ? candidates[0]!.id : null });
  }
}

function pythonTarget(from: string, specifier: string, known: Set<string>): string | null {
  let module = specifier;
  let base = '';
  if (module.startsWith('.')) {
    const dots = module.match(/^\.+/)![0].length;
    base = dirname(from);
    for (let index = 1; index < dots; index += 1) base = dirname(base);
    module = module.slice(dots);
  }
  const relativeModule = module.replace(/\./g, '/');
  return [
    `${base ? `${base}/` : ''}${relativeModule}.py`,
    `${base ? `${base}/` : ''}${relativeModule}/__init__.py`,
    `src/${relativeModule}.py`,
    `src/${relativeModule}/__init__.py`,
  ].find((candidate) => known.has(candidate)) ?? null;
}

function indexPythonSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/'''[\s\S]*?'''|"""[\s\S]*?"""/g, /#[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*(?:async\s+)?(def|class)\s+([A-Za-z_]\w*)/gm)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: match[1] === 'class' ? 'PythonClass' : 'PythonFunction' });
  }
}

function indexPythonRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/'''[\s\S]*?'''|"""[\s\S]*?"""/g, /#[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const addImport = (specifier: string, index: number): void => {
    const target = pythonTarget(path, specifier, known);
    graph.imports.push({ from: path, to: target ?? `python:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, index), external: !target });
  };
  for (const match of searchable.matchAll(/^\s*import\s+([^\r\n]+)/gm)) {
    for (const entry of match[1]!.split(',')) addImport(entry.trim().split(/\s+as\s+/)[0]!, match.index);
  }
  for (const match of searchable.matchAll(/^\s*from\s+([.\w]+)\s+import\s+/gm)) addImport(match[1]!, match.index);
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'def', 'class', 'return']));
}

function goTarget(specifier: string, moduleName: string | null, known: Set<string>): string | null {
  if (!moduleName || (specifier !== moduleName && !specifier.startsWith(`${moduleName}/`))) return null;
  const directory = specifier === moduleName ? '.' : specifier.slice(moduleName.length + 1);
  return [...known].filter((path) => path.endsWith('.go') && dirname(path) === directory).sort()[0] ?? null;
}

function indexGoSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"(?:\\.|[^"\\])*"|`[\s\S]*?`/g]);
  for (const match of searchable.matchAll(/^\s*(?:func\s+(?:\([^)]*\)\s*)?|type\s+|var\s+|const\s+)([A-Za-z_]\w*)/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    const prefix = match[0]!.trimStart();
    const kind = prefix.startsWith('func') ? 'GoFunction' : prefix.startsWith('type') ? 'GoType' : prefix.startsWith('const') ? 'GoConst' : 'GoVar';
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind });
  }
}

function indexGoRelations(path: string, text: string, known: Set<string>, graph: CodeGraph, moduleName: string | null): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g]);
  const imports: { specifier: string; index: number }[] = [];
  for (const match of searchable.matchAll(/^\s*import\s+(?:[A-Za-z_]\w*\s+)?["]([^"]+)["]/gm)) imports.push({ specifier: match[1]!, index: match.index });
  for (const block of searchable.matchAll(/^\s*import\s*\(([\s\S]*?)^\s*\)/gm)) {
    for (const match of block[1]!.matchAll(/(?:^|\n)\s*(?:[A-Za-z_]\w*\s+)?["]([^"]+)["]/g)) {
      imports.push({ specifier: match[1]!, index: block.index + match.index });
    }
  }
  for (const { specifier, index } of imports) {
    const target = goTarget(specifier, moduleName, known);
    graph.imports.push({ from: path, to: target ?? `go:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, index), external: !target });
  }
  addCalls(path, maskWithPatterns(searchable, [/"(?:\\.|[^"\\])*"|`[\s\S]*?`/g]), graph, new Set(['if', 'for', 'switch', 'select', 'func', 'go', 'defer']));
}

function indexJavaSymbols(path: string, text: string, graph: CodeGraph, types: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const packageName = /^\s*package\s+([\w.]+)\s*;/m.exec(searchable)?.[1] ?? '';
  for (const match of searchable.matchAll(/\b(class|interface|enum|record)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Java${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
    types.set(packageName ? `${packageName}.${name}` : name, path);
  }
  for (const match of searchable.matchAll(/\b(?:(?:public|protected|private|static|final|abstract|synchronized|native)\s+)*[\w<>\[\], ?]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:throws[^{]+)?\{/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'JavaMethod' });
  }
}

function indexJavaRelations(path: string, text: string, graph: CodeGraph, types: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+?)(?:\.\*)?\s*;/gm)) {
    const specifier = match[1]!;
    const target = types.get(specifier) ?? null;
    graph.imports.push({ from: path, to: target ?? `java:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, match.index), external: !target });
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new']), true);
}

function relativeTarget(from: string, specifier: string, known: Set<string>): string | null {
  const target = posix.normalize(posix.join(posix.dirname(from), specifier.replaceAll('\\', '/')));
  return known.has(target) ? target : null;
}

function indexCppSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/\b(class|struct|enum|union)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Cpp${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
  }
  for (const match of searchable.matchAll(/(?:^|[;}]\s*)(?:template\s*<[^;{}]+>\s*)?(?:[\w:<>]+\s+)+[*&\s]*([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'CppFunction' });
  }
}

function indexCppRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const commentsMasked = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/^\s*#\s*(?:include|import)\s*([<"])([^>"]+)[>"]/gm)) {
    const specifier = match[2]!;
    const quoted = match[1] === '"';
    const target = quoted ? relativeTarget(path, specifier, known) : null;
    if (quoted && !target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local include ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `cpp:${specifier}`, specifier, kind: 'include', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'switch', 'catch', 'sizeof', 'alignof', 'decltype']));
}

function indexCsharpSymbols(path: string, text: string, graph: CodeGraph, types: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /@"(?:""|[^"])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const namespace = /^\s*namespace\s+([\w.]+)\s*[;{]/m.exec(searchable)?.[1] ?? '';
  for (const match of searchable.matchAll(/\b(class|interface|enum|record|struct)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Csharp${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
    types.set(namespace ? `${namespace}.${name}` : name, path);
  }
  for (const match of searchable.matchAll(/\b(?:(?:public|protected|private|internal|static|virtual|override|abstract|async|sealed|partial)\s+)+[\w<>\[\],.?]+\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:where[^{]+)?\{/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'CsharpMethod' });
  }
}

function indexCsharpRelations(path: string, text: string, graph: CodeGraph, types: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /@"(?:""|[^"])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?([\w.]+)\s*;/gm)) {
    const specifier = match[1]!;
    const target = types.get(specifier) ?? [...types].find(([name]) => name.startsWith(`${specifier}.`))?.[1] ?? null;
    graph.imports.push({ from: path, to: target ?? `csharp:${specifier}`, specifier, kind: 'using', line: lineOf(searchable, match.index), external: !target });
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'lock', 'using', 'nameof', 'typeof', 'checked', 'unchecked']));
}

function indexPhpSymbols(path: string, text: string, graph: CodeGraph, types: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*|#[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const namespace = /^\s*namespace\s+([A-Za-z_][\w\\]*)\s*;/m.exec(searchable)?.[1] ?? '';
  for (const match of searchable.matchAll(/\b(class|interface|trait|enum)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Php${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
    types.set(namespace ? `${namespace}\\${name}` : name, path);
  }
  for (const match of searchable.matchAll(/\bfunction\s+&?\s*([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'PhpFunction' });
  }
}

function indexPhpRelations(path: string, text: string, known: Set<string>, graph: CodeGraph, types: Map<string, string>): void {
  const commentsMasked = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*|#[^\r\n]*/g]);
  const searchable = maskWithPatterns(commentsMasked, [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/\b(?:require_once|require|include_once|include)\b/g)) {
    const remainder = commentsMasked.slice(match.index + match[0].length);
    let expression = /^\s*(\([^;\r\n]*\)|[^;\r\n]*)/.exec(remainder)?.[1]?.trim() ?? '';
    if (expression.startsWith('(') && expression.endsWith(')')) expression = expression.slice(1, -1).trim();
    const quote = expression[0];
    let end = -1;
    if (quote === '"' || quote === "'") {
      for (let index = 1; index < expression.length; index += 1) {
        if (expression[index] === '\\') {
          index += 1;
          continue;
        }
        if (expression[index] === quote) {
          end = index;
          break;
        }
      }
    }
    const staticLiteral = end > 0 && expression.slice(end + 1).trim() === ''
      && !(quote === '"' && /(^|[^\\])\$/.test(expression.slice(1, end)));
    if (!staticLiteral) {
      graph.diagnostics.push({
        code: 'GRAPH_DYNAMIC',
        severity: 'warning',
        message: 'Nonliteral PHP module loading is not statically resolved.',
        path,
        line: lineOf(commentsMasked, match.index),
      });
      continue;
    }
    const specifier = expression.slice(1, end);
    const target = relativeTarget(path, specifier, known);
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local PHP include ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `php:${specifier}`, specifier, kind: 'include', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const namespace = /^\s*namespace\s+([A-Za-z_][\w\\]*)\s*;/m.exec(searchable)?.[1] ?? '';
  for (const match of searchable.matchAll(/^[ \t]*use\s+([A-Za-z_][\w\\]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w\\]*(?:\s+as\s+\w+)?)*)\s*;/gm)) {
    const line = lineOf(searchable, match.index);
    for (const entry of match[1]!.split(',')) {
      const specifier = entry.trim().split(/\s+as\s+/i)[0]!.trim();
      if (!specifier) continue;
      const target = types.get(specifier)
        ?? (namespace ? types.get(`${namespace}\\${specifier}`) ?? null : null);
      if (target === path) continue;
      graph.imports.push({ from: path, to: target ?? `php:${specifier}`, specifier, kind: 'use', line, external: !target });
    }
  }
  addCalls(path, searchable, graph, new Set([
    'if', 'for', 'foreach', 'while', 'switch', 'catch', 'isset', 'empty', 'echo',
    'function', 'declare', 'fn', 'use', 'exit', 'die',
    'include', 'include_once', 'require', 'require_once',
  ]));
}

function indexRSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/#[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*([A-Za-z.][\w.]*)\s*(?:<-|=)\s*function\s*\(/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'RFunction' });
  }
}

function indexRRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const commentsMasked = maskWithPatterns(text, [/#[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/\bsource\s*\(\s*["']([^"']+)["']/g)) {
    const specifier = match[1]!;
    const target = relativeTarget(path, specifier, known);
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local R source ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `r:${specifier}`, specifier, kind: 'include', line: lineOf(commentsMasked, match.index), external: !target });
  }
  for (const match of commentsMasked.matchAll(/\b(?:library|require)\s*\(\s*(?:package\s*=\s*)?["']?([A-Za-z][\w.]*)/g)) {
    const specifier = match[1]!;
    graph.imports.push({ from: path, to: `r:${specifier}`, specifier, kind: 'import', line: lineOf(commentsMasked, match.index), external: true });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'function', 'library', 'require', 'source']));
}

function indexJuliaSymbols(path: string, text: string, graph: CodeGraph, modules: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/#=[\s\S]*?=#/g, /#[^\r\n]*/g, /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*(?:baremodule|module)\s+([A-Za-z_]\w*)/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'JuliaModule' });
    modules.set(name, path);
  }
  for (const match of searchable.matchAll(/^\s*(?:(mutable)\s+)?(struct|abstract\s+type|primitive\s+type)\s+([A-Za-z_]\w*)/gm)) {
    const name = match[3]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'JuliaType' });
  }
  for (const match of searchable.matchAll(/^\s*function\s+([A-Za-z_]\w*!?)/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'JuliaFunction' });
  }
  for (const match of searchable.matchAll(/^\s*([A-Za-z_]\w*!?)\s*\([^=\r\n]*\)\s*=/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    if (!graph.symbols.some((symbol) => symbol.path === path && symbol.name === name && symbol.line === line)) {
      graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'JuliaFunction' });
    }
  }
}

function indexJuliaRelations(path: string, text: string, known: Set<string>, graph: CodeGraph, modules: Map<string, string>): void {
  const commentsMasked = maskWithPatterns(text, [/#=[\s\S]*?=#/g, /#[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/\binclude\s*\(\s*["']([^"']+)["']/g)) {
    const specifier = match[1]!;
    const target = relativeTarget(path, specifier, known);
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Julia include ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `julia:${specifier}`, specifier, kind: 'include', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*(?:using|import)\s+([^\r\n]+)/gm)) {
    const clause = match[1]!.trim();
    const entries = clause.includes(':') ? [clause.split(':', 1)[0]!] : clause.split(',');
    for (const entry of entries) {
      const specifier = entry.trim().replace(/^\.+/, '').split('.')[0]!;
      const target = modules.get(specifier) ?? null;
      graph.imports.push({ from: path, to: target ?? `julia:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, match.index), external: !target });
    }
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'function', 'macro', 'include', 'using', 'import']));
}

function declarationTargets(specifier: string, declarations: Map<string, string>): string[] {
  const exact = declarations.get(specifier);
  if (exact) return [exact];
  return [...new Set([...declarations]
    .filter(([name]) => name.startsWith(`${specifier}.`))
    .map(([, path]) => path))].sort();
}

function splitTopLevel(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if ('{(['.includes(character!)) depth += 1;
    else if ('})]'.includes(character!)) depth = Math.max(0, depth - 1);
    else if (character === ',' && depth === 0) {
      entries.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  entries.push(value.slice(start).trim());
  return entries.filter(Boolean);
}

function relativeFileTarget(from: string, specifier: string, known: Set<string>, suffixes: string[]): string | null {
  const normalized = specifier.replaceAll('\\', '/');
  const candidates = suffixes.map((suffix) => normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`);
  for (const candidate of candidates) {
    const target = relativeTarget(from, candidate, known);
    if (target) return target;
  }
  return null;
}

function projectFileTarget(specifier: string, known: Set<string>, suffixes: string[]): string | null {
  const normalized = posix.normalize(specifier.replaceAll('\\', '/')).replace(/^\.\//, '');
  if (normalized === '..' || normalized.startsWith('../') || posix.isAbsolute(normalized)) return null;
  return suffixes.map((suffix) => normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`)
    .find((candidate) => known.has(candidate)) ?? null;
}

function indexKotlinSymbols(path: string, text: string, graph: CodeGraph, declarations: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const packageName = /^\s*package\s+([\w.]+)/m.exec(searchable)?.[1] ?? '';
  for (const match of searchable.matchAll(/\b(?:(?:data|sealed|enum|annotation|value)\s+)?(class|interface|object|typealias)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Kotlin${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
    declarations.set(packageName ? `${packageName}.${name}` : name, path);
  }
  for (const match of searchable.matchAll(/\bfun\s+(?:<[^>]+>\s*)?(?:[\w?.<>]+\.)?([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'KotlinFunction' });
    declarations.set(packageName ? `${packageName}.${name}` : name, path);
  }
}

function indexKotlinRelations(path: string, text: string, known: Set<string>, graph: CodeGraph, declarations: Map<string, string>): void {
  const commentsMasked = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/@file:Import\s*\(\s*"([^"]+)"\s*\)/g)) {
    const specifier = match[1]!;
    const target = relativeFileTarget(path, specifier, known, ['', '.kt', '.kts']);
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Kotlin script import ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `kotlin:${specifier}`, specifier, kind: 'import', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*import\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)(?:\.\*)?(?:\s+as\s+\w+)?/gm)) {
    const specifier = match[1]!;
    const allTargets = declarationTargets(specifier, declarations);
    const targets = allTargets.filter((target) => target !== path);
    if (allTargets.length && !targets.length) continue;
    for (const target of targets.length ? targets : [null]) {
      graph.imports.push({ from: path, to: target ?? `kotlin:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, match.index), external: !target });
    }
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'when', 'catch', 'fun', 'class', 'interface', 'object']), true);
}

function indexRubySymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/^=begin\b[\s\S]*?^=end\b[^\r\n]*/gm, /#[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*(class|module)\s+([A-Z]\w*(?:::[A-Z]\w*)*)/gm)) {
    const name = match[2]!.split('::').at(-1)!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: match[1] === 'class' ? 'RubyClass' : 'RubyModule' });
  }
  for (const match of searchable.matchAll(/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'RubyMethod' });
  }
}

function indexRubyRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const commentsMasked = maskWithPatterns(text, [/^=begin\b[\s\S]*?^=end\b[^\r\n]*/gm, /#[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/^\s*(require_relative|require|load)\s*(?:\(\s*)?["']([^"']+)["']/gm)) {
    const directive = match[1]!;
    const specifier = match[2]!;
    const explicitlyLocal = directive === 'require_relative' || directive === 'load' || specifier.startsWith('.');
    const target = directive === 'require_relative'
      ? relativeFileTarget(path, specifier, known, ['', '.rb', '/init.rb'])
      : explicitlyLocal ? projectFileTarget(specifier, known, ['', '.rb', '/init.rb']) : null;
    if (explicitlyLocal && !target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Ruby dependency ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `ruby:${specifier}`, specifier, kind: directive === 'load' ? 'include' : 'require', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  addCalls(path, searchable, graph, new Set(['if', 'unless', 'while', 'until', 'for', 'def', 'class', 'module', 'require', 'require_relative', 'load']));
}

function indexSwiftSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g]);
  for (const match of searchable.matchAll(/\b(class|struct|enum|protocol|actor|typealias)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Swift${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
  }
  for (const match of searchable.matchAll(/\bfunc\s+([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'SwiftFunction' });
  }
}

function indexSwiftRelations(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g]);
  for (const match of searchable.matchAll(/^\s*(?:@\w+(?:\([^)]*\))?\s+)?import\s+(?:(?:class|struct|enum|protocol|func|var|let|typealias)\s+)?([\w.]+)/gm)) {
    const specifier = match[1]!;
    graph.imports.push({ from: path, to: `swift:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, match.index), external: true });
  }
  addCalls(path, searchable, graph, new Set([
    'if', 'for', 'while', 'switch', 'catch', 'func', 'init', 'deinit',
    'private', 'fileprivate', 'internal', 'package',
  ]));
}

function indexDartSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const reserved = new Set([
    'assert', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do',
    'else', 'enum', 'extends', 'false', 'final', 'finally', 'for', 'if', 'in', 'is',
    'new', 'null', 'rethrow', 'return', 'super', 'switch', 'this', 'throw', 'true',
    'try', 'var', 'void', 'while', 'with', 'yield',
  ]);
  for (const match of searchable.matchAll(/\b(class|enum|mixin|extension|typedef)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Dart${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
  }
  for (const match of searchable.matchAll(/^\s*(?:[\w<>,?[\] ]+\s+)([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:async\*?|sync\*)?\s*(?:=>|\{)/gm)) {
    const name = match[1]!;
    if (reserved.has(name)) continue;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'DartFunction' });
  }
}

function indexDartRelations(
  path: string,
  text: string,
  known: Set<string>,
  graph: CodeGraph,
  packageInfo: { directory: string; name: string } | null,
): void {
  const commentsMasked = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/^\s*(import|export|part)\s+([^;]+);/gm)) {
    const directive = match[1]!;
    for (const uri of match[2]!.matchAll(/["']([^"']+)["']/g)) {
      const specifier = uri[1]!;
      const packageMatch = /^package:([^/]+)\/(.+)$/.exec(specifier);
      const ownPackage = Boolean(packageMatch && packageInfo && packageMatch[1] === packageInfo.name);
      const ownPackagePath = ownPackage ? packageMatch![2]! : null;
      const explicitlyLocal = ownPackage || !/^(?:dart|package):/.test(specifier);
      const packageRoot = packageInfo?.directory === '.' ? '' : `${packageInfo?.directory}/`;
      const target = ownPackage
        ? [`${packageRoot}lib/${ownPackagePath}`, `${packageRoot}lib/${ownPackagePath}.dart`].find((candidate) => known.has(candidate)) ?? null
        : explicitlyLocal ? relativeFileTarget(path, specifier, known, ['', '.dart']) : null;
      if (explicitlyLocal && !target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Dart ${directive} ${specifier}.`, path, lineOf(commentsMasked, match.index)));
      graph.imports.push({ from: path, to: target ?? `dart:${specifier}`, specifier, kind: directive === 'part' ? 'include' : directive as 'import' | 'export', line: lineOf(commentsMasked, match.index), external: !target });
    }
  }
  const searchable = maskWithPatterns(commentsMasked, [/"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'switch', 'catch', 'assert', 'throw']));
}

function indexScalaSymbols(path: string, text: string, graph: CodeGraph, declarations: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const packageName = /^\s*package\s+([\w.]+)/m.exec(searchable)?.[1] ?? '';
  for (const match of searchable.matchAll(/\b(class|object|trait|enum|type)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Scala${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
    declarations.set(packageName ? `${packageName}.${name}` : name, path);
  }
  for (const match of searchable.matchAll(/\bdef\s+([A-Za-z_]\w*)\s*(?:\[|[(])/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'ScalaMethod' });
    declarations.set(packageName ? `${packageName}.${name}` : name, path);
  }
}

function indexScalaRelations(path: string, text: string, graph: CodeGraph, declarations: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*import\s+([^\r\n]+)/gm)) {
    const addedTargets = new Set<string>();
    for (const raw of splitTopLevel(match[1]!)) {
      const grouped = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.\{([^}]+)\}/.exec(raw);
      const wildcard = /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\.(?:_|\*)(?:\s|$)/.exec(raw);
      const specifiers = grouped
        ? grouped[2]!.split(',').map((entry) => entry.trim().split(/\s*(?:=>|\bas\b)\s*/)[0]!)
          .map((entry) => entry === '_' || entry === '*' ? grouped[1]! : `${grouped[1]}.${entry}`)
        : [wildcard?.[1] ?? /^([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/.exec(raw)?.[1]].filter((entry): entry is string => Boolean(entry));
      for (const specifier of specifiers) {
        const allTargets = declarationTargets(specifier, declarations);
        const targets = allTargets.filter((target) => target !== path);
        if (allTargets.length && !targets.length) continue;
        for (const target of targets.length ? targets : [null]) {
          if (target && addedTargets.has(target)) continue;
          if (target) addedTargets.add(target);
          graph.imports.push({ from: path, to: target ?? `scala:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, match.index), external: !target });
        }
      }
    }
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'match', 'catch', 'def', 'class', 'object', 'trait']), true);
}

function indexElixirSymbols(path: string, text: string, graph: CodeGraph, modules: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/~[A-Z]?[a-z]?(?:\/(?:\\.|[^\/\\])*\/|"(?:\\.|[^"\\])*")/g, /#[^\r\n]*/g, /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*defmodule\s+([A-Z]\w*(?:\.[A-Z]\w*)*)/gm)) {
    const fullName = match[1]!;
    const name = fullName.split('.').at(-1)!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'ElixirModule' });
    modules.set(fullName, path);
  }
  for (const match of searchable.matchAll(/^\s*(def|defp|defmacro|defmacrop)\s+([a-z_]\w*[!?]?)/gm)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    const kind = match[1]!.includes('macro') ? 'ElixirMacro' : 'ElixirFunction';
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind });
  }
}

function indexElixirRelations(path: string, text: string, known: Set<string>, graph: CodeGraph, modules: Map<string, string>): void {
  const commentsMasked = maskWithPatterns(text, [/#[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/\bCode\.(?:require_file|compile_file)\s*\(\s*"([^"]+)"\s*(?:,\s*__DIR__\s*)?\)/g)) {
    const specifier = match[1]!;
    const target = match[0].includes('__DIR__') || /^[.]/.test(specifier)
      ? relativeFileTarget(path, specifier, known, ['', '.ex', '.exs'])
      : [specifier, `${specifier}.ex`, `${specifier}.exs`].find((candidate) => known.has(candidate)) ?? null;
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Elixir file dependency ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `elixir:${specifier}`, specifier, kind: 'require', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/~[A-Z]?[a-z]?(?:\/(?:\\.|[^\/\\])*\/|"(?:\\.|[^"\\])*")/g, /"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*(alias|import|require|use)\s+([A-Z]\w*(?:\.[A-Z]\w*)*)(?:\.\{([^}]+)\})?/gm)) {
    const directive = match[1]!;
    const prefix = match[2]!;
    const specifiers = match[3]
      ? match[3].split(',').map((entry) => `${prefix}.${entry.trim()}`).filter((entry) => /(?:^|\.)[A-Z]\w*$/.test(entry))
      : [prefix];
    for (const specifier of specifiers) {
      const target = modules.get(specifier) ?? null;
      graph.imports.push({ from: path, to: target ?? `elixir:${specifier}`, specifier, kind: directive === 'use' ? 'use' : directive === 'require' ? 'require' : 'import', line: lineOf(searchable, match.index), external: !target });
    }
  }
  addCalls(path, searchable, graph, new Set(['if', 'unless', 'case', 'cond', 'for', 'with', 'def', 'defp', 'defmodule', 'alias', 'import', 'require', 'use']));
}

function indexHaskellSymbols(path: string, text: string, graph: CodeGraph, modules: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\{-[\s\S]*?-\}/g, /--[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const reserved = new Set([
    'as', 'case', 'class', 'data', 'default', 'deriving', 'do', 'else', 'foreign',
    'hiding', 'if', 'import', 'in', 'infix', 'infixl', 'infixr', 'instance', 'let',
    'module', 'newtype', 'of', 'qualified', 'then', 'type', 'where',
  ]);
  const moduleMatch = /^\s*module\s+([A-Z]\w*(?:\.[A-Z]\w*)*)/m.exec(searchable);
  if (moduleMatch) {
    const fullName = moduleMatch[1]!;
    const name = fullName.split('.').at(-1)!;
    const line = lineOf(searchable, moduleMatch.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'HaskellModule' });
    modules.set(fullName, path);
  }
  for (const match of searchable.matchAll(/^\s*(data|newtype|type|class)\s+(?:\([^)]*\)\s*=>\s*)?([A-Z]\w*)/gm)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Haskell${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
  }
  for (const match of searchable.matchAll(/^\s*([a-z_]\w*)\s+[^:=\r\n]*=/gm)) {
    const name = match[1]!;
    if (reserved.has(name)) continue;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'HaskellFunction' });
  }
}

function indexHaskellRelations(path: string, text: string, graph: CodeGraph, modules: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\{-[\s\S]*?-\}/g, /--[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*import\s+(?:qualified\s+)?([A-Z]\w*(?:\.[A-Z]\w*)*)/gm)) {
    const specifier = match[1]!;
    const target = modules.get(specifier) ?? null;
    graph.imports.push({ from: path, to: target ?? `haskell:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, match.index), external: !target });
  }
  addCalls(path, searchable, graph, new Set(['if', 'then', 'else', 'case', 'of', 'let', 'where', 'module', 'import']));
}

function luaTarget(specifier: string, known: Set<string>): string | null {
  const modulePath = specifier.replace(/\./g, '/');
  return projectFileTarget(modulePath, known, ['.lua', '/init.lua']);
}

function indexLuaSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/--\[(=*)\[[\s\S]*?\]\1\]/g, /--[^\r\n]*/g, /\[(=*)\[[\s\S]*?\]\1\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*(?:local\s+)?function\s+([A-Za-z_]\w*(?:[.:][A-Za-z_]\w*)*)\s*\(/gm)) {
    const name = match[1]!.split(/[.:]/).at(-1)!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'LuaFunction' });
  }
  for (const match of searchable.matchAll(/^\s*(?:local\s+)?([A-Za-z_]\w*)\s*=\s*function\s*\(/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'LuaFunction' });
  }
}

function indexLuaRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const commentsMasked = maskWithPatterns(text, [/--\[(=*)\[[\s\S]*?\]\1\]/g, /--[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/\b(require|dofile|loadfile)\s*(?:\(\s*)?["']([^"']+)["']/g)) {
    const directive = match[1]!;
    const specifier = match[2]!;
    const target = directive === 'require'
      ? luaTarget(specifier, known)
      : projectFileTarget(specifier, known, ['', '.lua']);
    const explicitlyLocal = directive !== 'require' || /^[./]/.test(specifier) || specifier.endsWith('.lua');
    if (explicitlyLocal && !target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Lua dependency ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `lua:${specifier}`, specifier, kind: directive === 'require' ? 'require' : 'include', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/\[(=*)\[[\s\S]*?\]\1\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'function', 'require', 'dofile', 'loadfile', 'type']));
}

function indexZigSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/\b(?:pub\s+|export\s+|extern\s+|inline\s+|noinline\s+)*fn\s+([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'ZigFunction' });
  }
  for (const match of searchable.matchAll(/\b(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*=\s*(struct|enum|union|opaque)\b/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Zig${match[2]![0]!.toUpperCase()}${match[2]!.slice(1)}` });
  }
}

function indexZigRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const commentsMasked = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/@import\s*\(\s*"([^"]+)"\s*\)/g)) {
    const specifier = match[1]!;
    const explicitlyLocal = /^[./]/.test(specifier) || specifier.endsWith('.zig');
    const target = explicitlyLocal ? relativeFileTarget(path, specifier, known, ['', '.zig']) : null;
    if (explicitlyLocal && !target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Zig import ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `zig:${specifier}`, specifier, kind: 'import', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'switch', 'catch', 'fn', 'asm', 'comptime']));
}

function indexSoliditySymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/\b(contract|library|interface|struct|enum)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Solidity${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
  }
  for (const match of searchable.matchAll(/\bfunction\s+([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'SolidityFunction' });
  }
}

function indexSolidityRelations(path: string, text: string, known: Set<string>, graph: CodeGraph): void {
  const commentsMasked = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/\bimport\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']\s*;/g)) {
    const specifier = match[1]!;
    const directProjectTarget = known.has(specifier) ? specifier : null;
    const explicitlyLocal = /^[.]/.test(specifier) || directProjectTarget !== null;
    const target = directProjectTarget ?? (explicitlyLocal ? relativeFileTarget(path, specifier, known, ['', '.sol']) : null);
    if (explicitlyLocal && !target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local Solidity import ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `solidity:${specifier}`, specifier, kind: 'import', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'require', 'assert', 'revert', 'function', 'modifier', 'constructor']));
}

function indexObjectiveCSymbols(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /@"(?:\\.|[^"\\])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/@(interface|implementation|protocol)\s+([A-Za-z_]\w*)/g)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    if (!graph.symbols.some((symbol) => symbol.path === path && symbol.name === name && symbol.line === line)) {
      graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `ObjectiveC${match[1]![0]!.toUpperCase()}${match[1]!.slice(1)}` });
    }
  }
  for (const match of searchable.matchAll(/^\s*[-+]\s*\([^)]*\)\s*([^;{\r\n]+)/gm)) {
    const signature = match[1]!;
    const components = [...signature.matchAll(/\b([A-Za-z_]\w*)\s*:/g)].map((component) => component[1]!);
    const name = components.length
      ? `${components.join(':')}:`
      : /^([A-Za-z_]\w*)/.exec(signature)?.[1];
    if (!name) continue;
    const line = lineOf(searchable, match.index);
    const preceding = searchable.slice(0, match.index);
    const ownerMatch = [...preceding.matchAll(/@(interface|implementation|protocol)\s+([A-Za-z_]\w*)|@end/g)].at(-1);
    const container = ownerMatch?.[2];
    graph.symbols.push({
      id: `${path}#${name}@${line}`,
      name,
      path,
      line,
      kind: 'ObjectiveCMethod',
      ...(container ? { container } : {}),
    });
  }
}

function indexObjectiveCRelations(path: string, text: string, graph: CodeGraph): void {
  const searchable = maskWithPatterns(text, [/\/\*[\s\S]*?\*\//g, /\/\/[^\r\n]*/g, /@"(?:\\.|[^"\\])*"|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/\[\s*([A-Za-z_]\w*)\s+([^\]\r\n]+)\]/g)) {
    const receiver = match[1]!;
    const message = match[2]!;
    const components = [...message.matchAll(/\b([A-Za-z_]\w*)\s*:/g)].map((component) => component[1]!);
    const selector = components.length
      ? `${components.join(':')}:`
      : /^([A-Za-z_]\w*)/.exec(message)?.[1];
    if (!selector) continue;
    const candidates = graph.symbols.filter((symbol) =>
      symbol.name === selector && symbol.kind === 'ObjectiveCMethod' && symbol.container === receiver);
    const implementation = candidates.find((candidate) =>
      graph.symbols.some((symbol) => symbol.path === candidate.path
        && symbol.name === receiver && symbol.kind === 'ObjectiveCImplementation'));
    const target = implementation?.id ?? (candidates.length === 1 ? candidates[0]!.id : null);
    graph.calls.push({ path, line: lineOf(searchable, match.index), expression: `${receiver}.${selector}`, target });
  }
}

function indexFsharpSymbols(path: string, text: string, graph: CodeGraph, declarations: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/\(\*[\s\S]*?\*\)/g, /\/\/[^\r\n]*/g, /@"(?:""|[^"])*"|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  const namespaceName = /^\s*namespace\s+([\w.]+)/m.exec(searchable)?.[1] ?? '';
  const moduleMatches = [...searchable.matchAll(/^\s*module\s+(?:rec\s+)?([\w.]+)/gm)];
  for (const moduleMatch of moduleMatches) {
    const declaredName = moduleMatch[1]!;
    const fullName = namespaceName && !declaredName.includes('.') ? `${namespaceName}.${declaredName}` : declaredName;
    const name = declaredName.split('.').at(-1)!;
    const line = lineOf(searchable, moduleMatch.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'FsharpModule' });
    declarations.set(fullName, path);
  }
  const firstModule = moduleMatches[0]?.[1];
  const scope = firstModule
    ? namespaceName && !firstModule.includes('.') ? `${namespaceName}.${firstModule}` : firstModule
    : namespaceName;
  for (const match of searchable.matchAll(/^\s*type\s+([A-Za-z_]\w*)/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'FsharpType' });
    declarations.set(scope ? `${scope}.${name}` : name, path);
  }
  for (const match of searchable.matchAll(/^\s*let\s+(?:inline\s+|rec\s+|private\s+|internal\s+)*([A-Za-z_]\w*)\b/gm)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'FsharpValue' });
    declarations.set(scope ? `${scope}.${name}` : name, path);
  }
}

function indexFsharpRelations(path: string, text: string, graph: CodeGraph, declarations: Map<string, string>): void {
  const commentsMasked = maskWithPatterns(text, [/\(\*[\s\S]*?\*\)/g, /\/\/[^\r\n]*/g]);
  for (const match of commentsMasked.matchAll(/^\s*#load\s+@"([^"]+)"|^\s*#load\s+"([^"]+)"/gm)) {
    const specifier = match[1] ?? match[2]!;
    const target = relativeFileTarget(path, specifier, new Set(graph.files), ['', '.fs', '.fsx']);
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local F# load ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `fsharp:${specifier}`, specifier, kind: 'include', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/@"(?:""|[^"])*"|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*open\s+(?:type\s+)?([\w.]+)/gm)) {
    const specifier = match[1]!;
    const allTargets = declarationTargets(specifier, declarations);
    const targets = allTargets.filter((target) => target !== path);
    if (allTargets.length && !targets.length) continue;
    for (const target of targets.length ? targets : [null]) {
      graph.imports.push({ from: path, to: target ?? `fsharp:${specifier}`, specifier, kind: 'using', line: lineOf(searchable, match.index), external: !target });
    }
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'match', 'function', 'fun', 'let', 'use', 'open', 'type']));
}

function indexVbSymbols(path: string, text: string, graph: CodeGraph, declarations: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/'[^\r\n]*/g, /"(?:[^"]|"")*"/g]);
  const namespaceName = /^\s*Namespace\s+([\w.]+)/im.exec(searchable)?.[1] ?? '';
  for (const match of searchable.matchAll(/^\s*(?:(?:Public|Private|Friend|Protected|Partial|MustInherit|NotInheritable)\s+)*(Class|Module|Interface|Structure|Enum)\s+([A-Za-z_]\w*)/gim)) {
    const name = match[2]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: `Vb${match[1]![0]!.toUpperCase()}${match[1]!.slice(1).toLowerCase()}` });
    declarations.set(namespaceName ? `${namespaceName}.${name}` : name, path);
  }
  for (const match of searchable.matchAll(/^\s*(?:(?:Public|Private|Friend|Protected|Shared|Overrides|Overridable|MustOverride|Async|Iterator|Partial)\s+)*(?:Sub|Function)\s+([A-Za-z_]\w*)\s*\(/gim)) {
    const name = match[1]!;
    const line = lineOf(searchable, match.index);
    graph.symbols.push({ id: `${path}#${name}@${line}`, name, path, line, kind: 'VbMethod' });
    declarations.set(namespaceName ? `${namespaceName}.${name}` : name, path);
  }
}

function indexVbRelations(path: string, text: string, graph: CodeGraph, declarations: Map<string, string>): void {
  const searchable = maskWithPatterns(text, [/'[^\r\n]*/g, /"(?:[^"]|"")*"/g]);
  for (const match of searchable.matchAll(/^\s*Imports\s+([^\r\n]+)/gim)) {
    for (const clause of splitTopLevel(match[1]!)) {
      const parsed = /^(?:([A-Za-z_]\w*)\s*=\s*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)$/.exec(clause);
      if (!parsed) continue;
      const alias = parsed[1];
      const targetSpecifier = parsed[2]!;
      const specifier = alias ? `${alias}=${targetSpecifier}` : targetSpecifier;
      const allTargets = declarationTargets(targetSpecifier, declarations);
      const targets = allTargets.filter((target) => target !== path);
      if (allTargets.length && !targets.length) continue;
      for (const target of targets.length ? targets : [null]) {
        graph.imports.push({ from: path, to: target ?? `vb:${targetSpecifier}`, specifier, kind: 'using', line: lineOf(searchable, match.index), external: !target });
      }
    }
  }
  addCalls(path, searchable, graph, new Set(['If', 'For', 'While', 'Select', 'Catch', 'SyncLock', 'Sub', 'Function', 'GetType', 'NameOf']));
}

export async function loadGraph(root: string): Promise<CodeGraph> {
  const graph = JSON.parse(await readText(root, '.musubix/cache/codegraph.json')) as CodeGraph;
  if (graph.schemaVersion !== 1 || !Array.isArray(graph.files) || !Array.isArray(graph.imports) || !Array.isArray(graph.symbols) || !graph.fingerprints) throw new Error('Invalid graph cache; run graph index.');
  const current = await snapshot(root, await graphInputs(root));
  if (JSON.stringify(current) !== JSON.stringify(graph.fingerprints)) throw new Error('Code graph is stale; run graph index.');
  return graph;
}

export function graphImpact(graph: CodeGraph, query: string): { path: string; via: string[] }[] {
  const roots = graph.files.includes(query) ? [query] : [...new Set(graph.symbols.filter((s) => s.name === query || s.id === query || `${s.path}#${s.name}` === query).map((s) => s.path))];
  if (!roots.length) throw new Error(`Code symbol or path not found: ${query}`);
  const results = new Map(roots.map((path) => [path, { path, via: [path] }]));
  const queue = [...results.values()];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i]!;
    for (const edge of graph.imports.filter((edge) => !edge.external && edge.to === current.path)) {
      if (results.has(edge.from)) continue;
      const impact = { path: edge.from, via: [...current.via, edge.from] };
      results.set(edge.from, impact);
      queue.push(impact);
    }
  }
  return [...results.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function cycles(graph: Pick<CodeGraph, 'files' | 'imports'>): string[][] {
  const adjacency = new Map(graph.files.map((file) => [file, graph.imports.filter((e) => e.from === file && !e.external).map((e) => e.to)]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  let count = 0;
  function visit(node: string): void {
    index.set(node, count);
    low.set(node, count++);
    stack.push(node);
    onStack.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(node, Math.min(low.get(node)!, index.get(next)!));
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let next: string;
      do {
        next = stack.pop()!;
        onStack.delete(next);
        component.push(next);
      } while (next !== node);
      if (component.length > 1 || adjacency.get(node)?.includes(node)) result.push(component.sort());
    }
  }
  for (const file of graph.files) if (!index.has(file)) visit(file);
  return result.sort((a, b) => a.join().localeCompare(b.join()));
}

export function matchGlob(path: string, glob: string): boolean {
  let expression = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { i++; expression += '(?:.*/)?'; }
      else expression += '.*';
    } else if (c === '*') expression += '[^/]*';
    else if (c === '?') expression += '[^/]';
    else expression += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`${expression}$`).test(path);
}

export function graphGate(
  graph: CodeGraph,
  config: Config['architecture'],
  codeGraph: Config['codeGraph'] = { mode: 'compatible' },
): { valid: boolean; diagnostics: Diagnostic[]; cycles: string[][] } {
  const diagnostics = graph.diagnostics.map((diagnostic) =>
    codeGraph.mode === 'strict' && diagnostic.code === 'GRAPH_DYNAMIC'
      ? {
          ...diagnostic,
          severity: 'error' as const,
          message: `${diagnostic.message} Strict Code Graph mode requires statically resolvable module loading.`,
        }
      : diagnostic);
  const components = cycles(graph);
  if (config.forbidCycles) {
    for (const component of components) diagnostics.push(error('GRAPH_CYCLE', `Dependency cycle: ${component.join(' ↔ ')}.`));
  }
  for (const rule of config.rules) {
    for (const edge of graph.imports) {
      if (matchGlob(edge.from, rule.from) && rule.disallow.some((pattern) => matchGlob(edge.to, pattern))) diagnostics.push(error('GRAPH_ARCHITECTURE', `${rule.name}: ${edge.from} must not depend on ${edge.to}.`, edge.from, edge.line));
    }
  }
  return { valid: !diagnostics.some((d) => d.severity === 'error'), diagnostics, cycles: components };
}
