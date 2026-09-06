import ts from 'typescript';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { error, type Diagnostic } from '../../domain/src/index.js';
import type { Config } from './config.js';
import { files, isSource, isTraceSource, portable, readText, snapshot, writeJson } from './files.js';

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
  return (await files(root)).filter((p) => isTraceSource(p) || /(?:^|\/)(?:tsconfig[^/]*\.json|package\.json|go\.mod)$/.test(p));
}

export async function indexGraph(root: string, persist = true): Promise<CodeGraph> {
  const paths = await graphInputs(root);
  const typedSources = paths.filter(isSource);
  const rustSources = paths.filter((path) => path.endsWith('.rs'));
  const pythonSources = paths.filter((path) => path.endsWith('.py'));
  const goSources = paths.filter((path) => path.endsWith('.go'));
  const javaSources = paths.filter((path) => path.endsWith('.java'));
  const cppSources = paths.filter((path) => /\.(?:c|cc|cpp|h|hh|hpp)$/.test(path));
  const csharpSources = paths.filter((path) => path.endsWith('.cs'));
  const phpSources = paths.filter((path) => path.endsWith('.php'));
  const rSources = paths.filter((path) => /\.(?:r|R)$/.test(path));
  const juliaSources = paths.filter((path) => path.endsWith('.jl'));
  const sources = [
    ...typedSources, ...rustSources, ...pythonSources, ...goSources, ...javaSources,
    ...cppSources, ...csharpSources, ...phpSources, ...rSources, ...juliaSources,
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
  const rustTexts = new Map(await Promise.all(rustSources.map(async (path) => [path, await readText(root, path)] as const)));
  for (const [path, text] of rustTexts) indexRustSymbols(path, text, graph);
  for (const [path, text] of rustTexts) indexRustRelations(path, text, known, graph);
  const pythonTexts = new Map(await Promise.all(pythonSources.map(async (path) => [path, await readText(root, path)] as const)));
  for (const [path, text] of pythonTexts) indexPythonSymbols(path, text, graph);
  for (const [path, text] of pythonTexts) indexPythonRelations(path, text, known, graph);
  const goTexts = new Map(await Promise.all(goSources.map(async (path) => [path, await readText(root, path)] as const)));
  for (const [path, text] of goTexts) indexGoSymbols(path, text, graph);
  const goModule = paths.includes('go.mod') ? /^module\s+(\S+)/m.exec(await readText(root, 'go.mod'))?.[1] ?? null : null;
  for (const [path, text] of goTexts) indexGoRelations(path, text, known, graph, goModule);
  const javaTexts = new Map(await Promise.all(javaSources.map(async (path) => [path, await readText(root, path)] as const)));
  const javaTypes = new Map<string, string>();
  for (const [path, text] of javaTexts) indexJavaSymbols(path, text, graph, javaTypes);
  for (const [path, text] of javaTexts) indexJavaRelations(path, text, graph, javaTypes);
  const cppTexts = new Map(await Promise.all(cppSources.map(async (path) => [path, await readText(root, path)] as const)));
  for (const [path, text] of cppTexts) indexCppSymbols(path, text, graph);
  for (const [path, text] of cppTexts) indexCppRelations(path, text, known, graph);
  const csharpTexts = new Map(await Promise.all(csharpSources.map(async (path) => [path, await readText(root, path)] as const)));
  const csharpTypes = new Map<string, string>();
  for (const [path, text] of csharpTexts) indexCsharpSymbols(path, text, graph, csharpTypes);
  for (const [path, text] of csharpTexts) indexCsharpRelations(path, text, graph, csharpTypes);
  const phpTexts = new Map(await Promise.all(phpSources.map(async (path) => [path, await readText(root, path)] as const)));
  const phpTypes = new Map<string, string>();
  for (const [path, text] of phpTexts) indexPhpSymbols(path, text, graph, phpTypes);
  for (const [path, text] of phpTexts) indexPhpRelations(path, text, known, graph, phpTypes);
  const rTexts = new Map(await Promise.all(rSources.map(async (path) => [path, await readText(root, path)] as const)));
  for (const [path, text] of rTexts) indexRSymbols(path, text, graph);
  for (const [path, text] of rTexts) indexRRelations(path, text, known, graph);
  const juliaTexts = new Map(await Promise.all(juliaSources.map(async (path) => [path, await readText(root, path)] as const)));
  const juliaModules = new Map<string, string>();
  for (const [path, text] of juliaTexts) indexJuliaSymbols(path, text, graph, juliaModules);
  for (const [path, text] of juliaTexts) indexJuliaRelations(path, text, known, graph, juliaModules);
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

function addCalls(path: string, searchable: string, graph: CodeGraph, ignored: Set<string>): void {
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
    if (ignored.has(name) || /\b(?:def|class|func|function|fn|new)\s+$/.test(prefix)) continue;
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
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'switch', 'catch', 'synchronized', 'return', 'new']));
}

function relativeTarget(from: string, specifier: string, known: Set<string>): string | null {
  const target = portable(resolve('/', dirname(from), specifier).slice(1));
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
  for (const match of commentsMasked.matchAll(/^\s*#\s*include\s*([<"])([^>"]+)[>"]/gm)) {
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
  for (const match of commentsMasked.matchAll(/\b(?:require|require_once|include|include_once)\s*(?:\(\s*)?['"]([^'"]+)['"]/g)) {
    const specifier = match[1]!;
    const target = relativeTarget(path, specifier, known);
    if (!target) graph.diagnostics.push(error('GRAPH_UNRESOLVED', `Unresolved local PHP include ${specifier}.`, path, lineOf(commentsMasked, match.index)));
    graph.imports.push({ from: path, to: target ?? `php:${specifier}`, specifier, kind: 'include', line: lineOf(commentsMasked, match.index), external: !target });
  }
  const searchable = maskWithPatterns(commentsMasked, [/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g]);
  for (const match of searchable.matchAll(/^\s*use\s+([A-Za-z_][\w\\]*)(?:\s+as\s+\w+)?\s*;/gm)) {
    const specifier = match[1]!;
    const target = types.get(specifier) ?? null;
    graph.imports.push({ from: path, to: target ?? `php:${specifier}`, specifier, kind: 'use', line: lineOf(searchable, match.index), external: !target });
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'isset', 'empty', 'echo', 'include', 'require']));
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
    for (const entry of match[1]!.split(',')) {
      const specifier = entry.trim().replace(/^\.*/, '').split(':')[0]!.trim().split('.')[0]!;
      const target = modules.get(specifier) ?? null;
      graph.imports.push({ from: path, to: target ?? `julia:${specifier}`, specifier, kind: 'import', line: lineOf(searchable, match.index), external: !target });
    }
  }
  addCalls(path, searchable, graph, new Set(['if', 'for', 'while', 'function', 'macro', 'include', 'using', 'import']));
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
