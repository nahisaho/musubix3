---
schemaVersion: 1
feature: change-record-recordedat-order
---
# Documenting and diagnosing `recordedAt` inversions in `change-record` chronology

Source: GitHub Issue #22. `change-record`'s phase evidence
(`.musubix/evidence/changes.json`, `ChangePhaseEvidence` in
`packages/analysis/src/change-evidence.ts`) stores both a logical `order`
field and a wall-clock `recordedAt` timestamp (`new Date().toISOString()`,
captured in `packages/analysis/src/change.ts`) per phase/batch entry.
`order` is the validated logical append sequence assigned by
`appendEvidenceOrder` from the shared, hash-linked, repository-wide
`.musubix/evidence/order.json` log (`packages/analysis/src/order.ts`); it is
shared across every `change` and `tdd` record in the repository, so a single
change's own entries can legitimately have non-contiguous `order` values
(for example 4, 9, 15) when other evidence is recorded between them. `gate`
(via `validateChangeEvidence`) verifies that each phase/batch entry's stored
`order` matches its corresponding record in that log
(`CHANGE_ORDER_MISMATCH`) and that certain phase pairs are correctly
sequenced (`CHANGE_PHASE_ORDER`); `trace check --strict` does not invoke
change-evidence validation at all and is out of scope for this feature.
`recordedAt` is captured independently at call time and is never compared
against `order` or against any other entry's `recordedAt` by any existing
validation. Because each phase/batch key can only be recorded once (a repeat
call is rejected before a new `recordedAt`/`order` pair could be written),
the discrepancy is not caused by re-recording a phase; it is caused by
`recordedAt` being an uncorrelated wall-clock capture (subject to system
clock adjustment or skew between sequential invocations, including across
different machines/processes) with no ordering guarantee relative to the
`order` sequence that governs correctness. Nothing in `gate`, the CLI's own
output, or the current README documents this discrepancy, so a reader
relying on `recordedAt` (rather than `order`) to reconstruct chronological
history gets a silently wrong answer.

This feature (a) documents, in the CLI's `change-record --help` output and in
`README.md`, that `order` — not `recordedAt` — is the field `change-record`/
`gate` verify and guarantee to be a correct logical append sequence per
change, and that `recordedAt` carries no such guarantee; and (b) adds a new,
non-blocking `gate` diagnostic, `CHANGE_RECORDEDAT_OUT_OF_ORDER`, reported by
`validateChangeEvidence`, that reports when a change's stored `recordedAt`
values are not monotonically non-decreasing in `order` sequence across its
`phases` entries and `effectiveBatches` TDD entries, so a caller is made
aware of the discrepancy without needing to manually inspect `changes.json`.

## REQ-CHANGE-RECORD-RECORDEDAT-ORDER-001: Document that `order`, not `recordedAt`, is the guaranteed logical-sequence chronology field
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall document, in both `change-record --help` output and `README.md`'s `change-record` reference, that the persisted `order` field (not `recordedAt`) is the field `change-record`/`gate` verify to be a correct logical append sequence per change, and that `recordedAt` is an independently captured wall-clock timestamp with no ordering guarantee relative to `order`.
Acceptance: Given `npx musubix3 change-record --help`, its output contains text stating `order` is the verified logical-sequence chronology field and `recordedAt` carries no ordering guarantee; given `README.md`, its `change-record` reference row or an adjoining note states the same, naming both `order` and `recordedAt` explicitly.

## REQ-CHANGE-RECORD-RECORDEDAT-ORDER-002: Report a non-blocking diagnostic when a change's `recordedAt` values are inverted relative to `order`
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a change has two order-adjacent valid evidence entries whose `recordedAt` values are inverted relative to their `order` sequence, then the system shall report a `CHANGE_RECORDEDAT_OUT_OF_ORDER` diagnostic for that change.
Acceptance: "Valid evidence entries" are drawn only from a change's `phases` map (`impact`, `requirements`, `design`, `quality`) and its `effectiveBatches()` TDD entries (`red`, `implementation`, `green`), restricted to entries whose `order` is a unique (non-duplicated among the change's own valid entries) integer and whose `recordedAt` is a string `s` satisfying `!Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s` (i.e. exactly the canonical `Date.prototype.toISOString()` output, not merely a parseable variant); any other `order`/`recordedAt` value (missing, non-integer, duplicated, non-string, non-canonical, or unparseable) excludes that entry from this comparison, and existing diagnostics such as `CHANGE_ORDER_MISMATCH`/`CHANGE_ORDER_MIGRATION_REQUIRED` continue to govern non-integer or duplicated `order` independently. An entry's label is: its own phase name, for a singular `phases` entry; `<phase>:<requirement-ID batch key>` for a proper-subset `tddBatches` entry (matching the label `recordChangePhase` already uses when appending that entry's `order` record); or plain `<phase>` for a legacy full-set batch entry folded from `change.phases` by `effectiveBatches()` (which shares its `order` record's plain-phase label, not a batch key). Valid entries are sorted by ascending `order`, and each consecutive pair in that sorted sequence is compared; equal `recordedAt` values are not an inversion. Given a change with three or more valid entries at non-contiguous `order` values (for example 4, 9, 15) where one or more consecutive pairs have an inverted `recordedAt` (the later-`order` entry has an earlier `recordedAt`), `validateChangeEvidence` reports exactly one `CHANGE_RECORDEDAT_OUT_OF_ORDER` diagnostic per such inverted consecutive pair, at `severity: 'warning'`, each naming the change ID and that pair's two entry labels; this diagnostic's presence never makes `gate` fail by itself, since `severity` is never `'error'`. Given the same change with `recordedAt` corrected to be monotonically non-decreasing in `order` sequence, no `CHANGE_RECORDEDAT_OUT_OF_ORDER` diagnostic is reported. Given a change whose legacy full-set phases (`phases.red`/`implementation`/`green`) are folded by `effectiveBatches()` into a synthetic batch alongside separate proper-subset `tddBatches` entries, each valid entry from both sources is counted exactly once, with no duplication between the synthetic batch and any `tddBatches` entry. In every case, `CHANGE_ORDER_MISMATCH` and `CHANGE_PHASE_ORDER` are reported or withheld exactly as they are today, unaffected by this new diagnostic.
