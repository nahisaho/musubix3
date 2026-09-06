---
name: sdd-design
description: "Use when translating approved requirements into explicit components, interfaces, constraints, ADRs, and deterministic architecture diagrams. 設計・ADR・構成図の作成時に使用。"
---
# Design / 設計

Follow the user's input language (日本語 / English). Use Copilot's native planning,
editing, research and review to reason about alternatives; musubix3 validates
explicit artifacts, not generated prose quality.
After the work, run `npx musubix3 workflow-record sdd-design complete --status
completed` exactly once.

1. Read requirements and constitution; identify requirement IDs before designing.
2. Edit `.musubix/features/<slug>/design.md` with `## DES-FEATURE-001: Title`.
   Each component needs `Responsibilities:`, `Interfaces:`, `Constraints:`,
   `Requirements: REQ-FEATURE-001`, and `ADRs: ADR-0001`. Use `Depends-On:` for
   explicit component dependencies. Fields also accept Japanese labels.
3. Record real trade-offs under `.musubix/decisions/ADR-xxxx.md`: context, decision,
   rejected alternatives and consequences. Do not invent existing decisions.
4. Run `npx musubix3 design validate <file> --json` and
   `npx musubix3 design c4 <file>`. The Mermaid output reflects only declared
   components and dependencies; it is C4-like, not a full C4 model.
5. Run `npx musubix3 trace build` then `npx musubix3 trace check`.
   Do not hand-edit `trace.json`. Ask native review to inspect coupling and
   coverage; use `sdd-formal-codegraph` for compiler-based impact checks.
6. Hand off responsibilities, interfaces, constraints and IDs to implementation.
