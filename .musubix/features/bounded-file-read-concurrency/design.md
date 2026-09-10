---
schemaVersion: 1
feature: bounded-file-read-concurrency
---
# Bounded file-read concurrency for large projects design

## DES-BOUNDED-FILE-READ-CONCURRENCY-001: Shared bounded-concurrency file-read helper
Responsibilities: Provide `mapWithConcurrency(items, limit, worker)` that runs at most `limit` `worker` calls concurrently over `items` and returns results in input order; use it in `snapshot()` to compute path→digest fingerprints without opening more than `limit` files at once.
Interfaces: New exported `mapWithConcurrency()` in `packages/analysis/src/files.ts`; `snapshot()` in the same file is rewritten to call it instead of an unbounded `Promise.all`.
Constraints: Fixed concurrency limit of 256; return value and ordering of `snapshot()` are unchanged (`Record<string, string>` keyed by path); no new external dependency.
Requirements: REQ-BOUNDED-FILE-READ-CONCURRENCY-001
ADRs: ADR-0018
Depends-On: none

## DES-BOUNDED-FILE-READ-CONCURRENCY-002: Bounded per-language source loading in Code Graph
Responsibilities: Replace each per-language `Promise.all(sources.map(async (path) => [path, await readText(root, path)]))` loader in `graph.ts` with a call to `mapWithConcurrency`, preserving the existing `Map<string, string>` result per language.
Interfaces: Per-language loaders in `packages/analysis/src/graph.ts` (Rust, Python, Go, Java, C/C++, C#, PHP, R, Julia, Kotlin, Ruby, Swift, Dart, Scala, Elixir, Haskell, Lua, Zig, Solidity, F#, VB); imports `mapWithConcurrency` from `files.ts`.
Constraints: Each language's resulting `Map` keys/values and iteration order used by downstream graph construction are unchanged; no language loader opens more than the shared concurrency limit of files at once.
Requirements: REQ-BOUNDED-FILE-READ-CONCURRENCY-002
ADRs: ADR-0018
Depends-On: DES-BOUNDED-FILE-READ-CONCURRENCY-001
