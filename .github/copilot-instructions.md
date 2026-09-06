# musubix3

- Exclusively extend GitHub Copilot CLI with SDD skills and deterministic TypeScript checks.
- Follow the user's input language (Japanese or English). Use `.github/skills/sdd-*`.
- Prefer native Copilot planning, editing, research, review, security review and subagents.
  Do not add another agent runtime, MCP/LSP manager, memory store, REPL or watcher.
- Keep artifact IDs explicit; regenerate trace graphs. Never equate SAT with behavior.
- Report pass/fail/skipped honestly; missing required evidence blocks readiness.
- Validate changes with `npm run typecheck`, `npm run build`, `npm test`, and
  `npm run pack:check` when distribution changes. Do not publish without approval.
