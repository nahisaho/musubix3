# TDD per-test fingerprint scoping design

## DES-TDD-FINGERPRINT-SCOPING-001: AST-scoped test fingerprint resolution
Responsibilities: Given a `TraceNode` for a test, locate exactly the AST call
expression that the test's leading `@id TEST-*` trace-annotation comment
documents (the innermost `it(...)`/`test(...)`/similar call whose leading
comment starts at that annotation), regardless of nesting depth inside
`describe(...)` blocks, and hash only the annotation-comment-through-call-end
text span. Fall back to the existing comment-marker-delimited slice only when
no such call expression can be resolved (e.g. non-source test files, or a
source file where the annotation does not immediately precede a call
expression).
Interfaces: `testFingerprint(root, test): Promise<string>` (internal to
`packages/analysis/src/tdd.ts`; behavior-only change, no signature change).
Constraints: Must not change the computed fingerprint for any test whose
declaration is a top-level statement (current passing behavior). Must not
require a signature or evidence-schema change: `TddCycle.testFingerprint`
stays a plain SHA-256 hex string. Must resolve the call expression by walking
all descendant statements/expressions of the source file (not only top-level
statements), matching the smallest call expression whose relevant leading
JSDoc/comment range covers the annotation's `@id TEST-<id>` text, so that
sibling tests declared before or after it in the same `describe(...)` block
never affect its fingerprint.
Requirements: REQ-TDD-FINGERPRINT-SCOPING-001
ADRs: ADR-0008
