---
schemaVersion: 1
feature: requirements-design-scaffold
---
# Requirements / 要求

## REQ-REQUIREMENTS-DESIGN-SCAFFOLD-001: Scaffold requirements.md / requirements.md の雛形生成
Priority: must
Type: functional
Pattern: event-driven
Statement: When a user runs `musubix3 requirements scaffold <slug>` for a valid slug whose `.musubix/features/<slug>/requirements.md` does not yet exist, the system shall create the `.musubix/features/<slug>/` directory if absent and write a `requirements.md` file containing exactly one placeholder entry `## REQ-<SLUG>-001:` with `Priority: must`, `Type: functional`, `Pattern: ubiquitous`, a valid EARS `Statement:` field whose obligation clause begins with `TODO:`, and an `Acceptance:` field beginning with `TODO:`.
Acceptance: Running `musubix3 requirements scaffold my-feature` on a project without `.musubix/features/my-feature/requirements.md` creates that directory and file; `musubix3 requirements validate .musubix/features/my-feature/requirements.md --json` reports `valid: true` with exactly one entry whose ID is `REQ-MY-FEATURE-001`, `priority` is `must`, `type` is `functional`, `pattern` is `ubiquitous`, `statement` contains the substring `TODO:`, and `acceptance` starts with `TODO:`.

## REQ-REQUIREMENTS-DESIGN-SCAFFOLD-002: Refuse to overwrite existing requirements.md / 既存 requirements.md の上書き拒否
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `.musubix/features/<slug>/requirements.md` already exists, then the `musubix3 requirements scaffold <slug>` command shall exit with a non-zero status and an error message naming the existing path without modifying the file.
Acceptance: Running `musubix3 requirements scaffold <slug>` a second time for the same slug, or for a slug whose `requirements.md` was hand-authored, leaves the file's content byte-for-byte unchanged, returns a non-zero exit code, and prints an error mentioning `.musubix/features/<slug>/requirements.md`.

## REQ-REQUIREMENTS-DESIGN-SCAFFOLD-003: Scaffold design.md / design.md の雛形生成
Priority: should
Type: functional
Pattern: event-driven
Statement: When a user runs `musubix3 design scaffold <slug>` for a valid slug whose `.musubix/features/<slug>/design.md` does not yet exist, the system shall create the `.musubix/features/<slug>/` directory if absent and write a `design.md` file containing exactly one placeholder entry `## DES-<SLUG>-001:` with `Responsibilities:`, `Interfaces:`, and `Constraints:` fields each beginning with `TODO:`, a `Requirements: REQ-<SLUG>-001` field, and an `ADRs: none — TODO: record a decision if one becomes relevant.` field.
Acceptance: Running `musubix3 design scaffold my-feature` on a project that already has `.musubix/features/my-feature/requirements.md` with `REQ-MY-FEATURE-001` and no existing `design.md` creates `design.md`; `musubix3 design validate .musubix/features/my-feature/design.md --json` reports `valid: true` with exactly one entry whose ID is `DES-MY-FEATURE-001` and whose `requirements` array contains `REQ-MY-FEATURE-001`.

## REQ-REQUIREMENTS-DESIGN-SCAFFOLD-004: Refuse to overwrite existing design.md / 既存 design.md の上書き拒否
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `.musubix/features/<slug>/design.md` already exists, then the `musubix3 design scaffold <slug>` command shall exit with a non-zero status and an error message naming the existing path without modifying the file.
Acceptance: Running `musubix3 design scaffold <slug>` a second time for the same slug, or for a slug whose `design.md` was hand-authored, leaves the file's content byte-for-byte unchanged, returns a non-zero exit code, and prints an error mentioning `.musubix/features/<slug>/design.md`.

## REQ-REQUIREMENTS-DESIGN-SCAFFOLD-005: Reject unsafe or malformed slugs / 不正なスラッグの拒否
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If the `<slug>` argument given to `musubix3 requirements scaffold` or `musubix3 design scaffold` does not match the lowercase kebab-case pattern `^[a-z0-9]+(-[a-z0-9]+)*$`, then the system shall exit with a non-zero status and an error message naming the invalid slug without creating or modifying any file or directory.
Acceptance: Running `musubix3 requirements scaffold ../../escape`, `musubix3 requirements scaffold Foo_Bar`, or `musubix3 design scaffold ../../escape` returns a non-zero exit code, prints an error mentioning the rejected slug, and creates no new file or directory outside or inside `.musubix/features/`.

## REQ-REQUIREMENTS-DESIGN-SCAFFOLD-006: Custom scaffold title / カスタムタイトル指定
Priority: may
Type: functional
Pattern: optional-feature
Statement: Where a `--title <text>` option with non-empty single-line text is supplied to `musubix3 requirements scaffold <slug>`, the system shall use that text as the heading title of the placeholder entry instead of the generic default title.
Acceptance: Running `musubix3 requirements scaffold my-feature --title "Report readiness"` writes a `requirements.md` whose heading line is `## REQ-MY-FEATURE-001: Report readiness`; running the command with a `--title` value containing a newline or only whitespace exits with a non-zero status and an error, creating no file.
