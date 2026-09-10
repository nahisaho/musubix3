# Recognize language-specific token syntax in adapter ID matching and config lint design

## DES-ADAPTER-PATTERN-RECOGNITION-001: Loosen the ID trailing boundary and scope the package-pattern exemption to go-test
Responsibilities: In `packages/analysis/src/adapters.ts`, change `idOf()`'s trailing anchor from `\b` to `(?![0-9])`, keeping the `\d{3,}` quantifier greedy so a longer digit run is matched in full rather than truncated. In `packages/analysis/src/config.ts`, add `isGoPackagePattern(arg)` recognizing Go's `./...`/`pkg/...` recursive package-wildcard syntax, and in `configLint()` skip the `CONFIG_ORPHANED_PATH` diagnostic for an argument matching it only when `command.adapter === 'go-test'`.
Interfaces: `idOf(value: unknown): string | null` (internal to `adapters.ts`; signature unchanged, behavior loosened only at the trailing boundary). New internal helper `isGoPackagePattern(arg: string): boolean` in `config.ts`; `configLint(root: string): Promise<{ valid: boolean; diagnostics: Diagnostic[] }>`'s exported signature is unchanged.
Constraints: Must not change `idOf()`'s recognition for any input already recognized today (every existing adapter test must keep passing). Must not weaken `CONFIG_ORPHANED_PATH` for any command whose `adapter` is not `go-test`, nor for a go-test command's argument that is a genuinely missing path rather than a `./...`-shaped package pattern.
Requirements: REQ-ADAPTER-PATTERN-RECOGNITION-001 REQ-ADAPTER-PATTERN-RECOGNITION-002
ADRs: ADR-0015
