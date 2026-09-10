---
schemaVersion: 1
feature: bounded-file-read-concurrency
---
# Bounded file-read concurrency for large projects

Source: GitHub issue #17 — `musubix3 init` crashed with `EMFILE: too many
open files` on a project containing a large vendored source tree
(thousands of trace-eligible files) not covered by the standard
exclusion list. `files.ts#snapshot` and the per-language source loaders in
`graph.ts` read every matched file concurrently via a single unbounded
`Promise.all(paths.map(readFile))`, so project size directly maps to
simultaneously-open file descriptors.

## REQ-BOUNDED-FILE-READ-CONCURRENCY-001: Bound concurrent file reads during trace fingerprinting
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall read file contents for trace fingerprint snapshots using a bounded-concurrency pool that never has more than a fixed, small maximum number of files open at once, regardless of how many files are being snapshotted.
Acceptance: Given a path list containing more entries than the concurrency limit, snapshotting that list completes successfully and returns the same digest for every path as reading them one at a time; at no point during the read does the number of concurrently in-flight file reads exceed the configured limit.

## REQ-BOUNDED-FILE-READ-CONCURRENCY-002: Bound concurrent file reads during Code Graph source loading
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall load per-language source file text for Code Graph indexing using the same bounded-concurrency pool as trace fingerprinting, instead of one unbounded `Promise.all` per language.
Acceptance: Given a source list for any supported language containing more entries than the concurrency limit, loading that language's texts for `graph index` completes successfully and returns the same text for every path as reading them one at a time; at no point does the number of concurrently in-flight reads for that language exceed the configured limit.
