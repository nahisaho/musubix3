# Contributing / コントリビューション

Use Node.js 20 or newer and npm. 日本語・英語の Issue / PR を歓迎します。

```sh
npm install
npm run typecheck
npm run build
npm test
npm run pack:check
npm run pack:smoke
```

Keep changes within `packages/domain` (pure artifact checks), `packages/analysis`
(filesystem/compiler/process evidence), or `packages/cli` (installation/commands).
Tests write isolated fixtures only under `.test-work/` and clean them afterward.
Use existing Vitest; no additional test framework is needed.

Add regression tests for malformed artifacts, stale caches and skipped checks.
Never replace missing execution evidence with a fabricated pass. Keep optional
solver tests injectable; real adapters must invoke the actual local tool.

Skills must remain concise and follow the user's Japanese/English input. Use
native Copilot planning, research, editing, review, security review and subagents.
Do not add orchestration, generic code generation, memory, MCP/LSP management,
watch daemons or a REPL. See both READMEs for the integration boundary.

Keep version fields in package manifests, CLI, plugin, marketplace and changelog
aligned. `plugin.json` at the repository root is the plugin source of truth.
Review npm package contents before releasing; never publish as part of tests.
