---
schemaVersion: 1
feature: change-record-recordedat-order
---
# Design: `recordedAt` chronology documentation and out-of-order diagnostic

## DES-CHANGE-RECORD-RECORDEDAT-ORDER-001: `recordedAt`/`order` documentation
Responsibilities: Document, in `change-record --help` output and in
`README.md`'s `change-record` reference section, that `order` (not
`recordedAt`) is the field `gate` (via `validateChangeEvidence`) verifies to
be a correct, repository-wide logical append sequence per change, and that
`recordedAt` is an independently captured wall-clock timestamp with no
ordering guarantee relative to `order`.
Interfaces: `packages/cli/src/main.ts`'s `change-record` command
`.description()`/help text (Commander.js); `README.md`'s `change-record`
CLI reference row/adjoining note.
Constraints: Must not alter `change-record`'s existing exit codes, flags, or
JSON output shape. Must name both `order` and `recordedAt` explicitly, so a
reader searching either term finds the clarification.
Requirements: REQ-CHANGE-RECORD-RECORDEDAT-ORDER-001
ADRs: none - documentation-only change; no alternative approach was rejected

## DES-CHANGE-RECORD-RECORDEDAT-ORDER-002: `CHANGE_RECORDEDAT_OUT_OF_ORDER` diagnostic
Responsibilities: Within `validateChangeEvidence` (`packages/analysis/src/change.ts`),
for each change, collect its "valid entries" — from `change.phases`
(`impact`, `requirements`, `design`, `quality`) and from
`effectiveBatches(change)` (`packages/analysis/src/change-evidence.ts`)
(`red`, `implementation`, `green` per batch) — in two stages: first gather
all candidate entries with an integer `order`; count occurrences by integer
`order` value and retain only entries whose `order` occurs exactly once
among that change's own candidates (an entry sharing its `order` with any
other candidate entry is excluded from both stages that follow); then, from
the remaining entries, keep only those whose `recordedAt` satisfies
`typeof item.recordedAt === 'string' && !Number.isNaN(Date.parse(item.recordedAt))
&& new Date(item.recordedAt).toISOString() === item.recordedAt`. Sort the
resulting valid entries ascending by `order`; for each consecutive pair
where the later-`order` entry's `recordedAt` is strictly earlier than the
earlier-`order` entry's `recordedAt`, push one
`{ code: 'CHANGE_RECORDEDAT_OUT_OF_ORDER', severity: 'warning', changeId,
message }` diagnostic naming both entries' labels. A singular `phases`
entry's label is its own phase name; a proper-subset `tddBatches` entry's
label is `${batchPhase}:${key}` (`key = batchKey(batch.requirementIds)`,
already used identically when appending that entry's order record); a
legacy full-set batch entry folded in by `effectiveBatches()`
(`key === batchKey(change.requirementIds)`) uses the plain `batchPhase`
label, matching its own order record's label exactly as the existing
`CHANGE_ORDER_MISMATCH` loop (`change.ts`'s `isFullSet` branch) already
does.
Interfaces: A new internal helper, `collectRecordedAtEntries(change):
{ label: string; order: number; recordedAt: string }[]`, called once per
`change` inside the existing `for (const change of evidence.changes)` loop
in `validateChangeEvidence`, after the existing per-change diagnostic
blocks (order-mismatch/phase-order/unchanged-content checks) that loop
already performs. No new exported CLI flags; the diagnostic surfaces
through `gate`'s existing `--json` output and human-readable report exactly
like all other `change` diagnostics.
Constraints: Never emits `severity: 'error'` (must never affect `gate`'s
pass/fail computation for the `change` check by itself, per
`validation()`'s `severity === 'error'` rule in
`packages/domain/src/types.ts`). Must not read or duplicate the
`CHANGE_ORDER_MISMATCH`/`CHANGE_PHASE_ORDER`/`CHANGE_ORDER_MIGRATION_REQUIRED`
logic already in `validateChangeEvidence`; entries excluded from those
checks by malformed `order` are also excluded here. Must not report more
than one diagnostic per consecutive out-of-order pair (no pairwise/O(n²)
scan). Must be pure with respect to existing evidence files (reads
`changes.json` data already loaded by `validateChangeEvidence`; writes
nothing).
Requirements: REQ-CHANGE-RECORD-RECORDEDAT-ORDER-002
ADRs: ADR-0027
