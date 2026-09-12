---
schemaVersion: 1
feature: tdd-cycle-void
---
# TDD cycle void (human-audited correction for a dangling invalid cycle)

Source: GitHub Issue #1 (reopened; recurrence during Issue #20/CHANGE-0010).
`tdd-superseded-cycle-scoping` (Issue #11) already ignores an *earlier*
incomplete/invalid cycle for a test ID when a *later* cycle for the same
test ID has both a valid Red and a valid Green. It does not cover the
reverse ordering: a genuinely valid Red-Green cycle followed by a *later*,
dangling, invalid cycle for the same test ID (for example an accidental
`tdd red <test-id>` invocation after the feature was already Green,
recorded because of a copy/paste or targeting mistake). Because
supersession requires a *later* cycle with both phases valid, this trailing
invalid cycle is never superseded, so it permanently raises
`TDD_RED_MISSING`/`TDD_GREEN_MISSING`/`TDD_LEGACY_OR_UNSCOPED_EVIDENCE` for
that test ID. `.musubix/evidence/tdd.json` is append-only and hand-editing
is explicitly unsupported; the only currently tool-supported remedy is to
move `tdd.json` aside and re-record every cycle in the repository from
scratch, which for a project with many already-shipped, passing tests is
disproportionate: it either discards every other test's legitimate history
or requires reverting unrelated shipped code to fabricate fresh Red states.

This change adds an explicit, human-approved `tdd void <test-id>` command
that marks a single, verified-dangling trailing cycle as voided (an
appended, hash-chained record, never a deletion or edit), so `gate`/`tdd
validate` treat it the same way an earlier-cycle supersession is already
treated, without touching any other test's or cycle's evidence.

A native `rubber-duck` review of the first draft found the void record was
not required to be as tamper-evident/validator-enforced as the phase
evidence it suppresses, that multi-cycle (3+) and re-voiding-after-a-new-
cycle scenarios were under-specified (risking unintended, transitive
suppression), that an earlier cycle carrying its own void marker was not
excluded as a fallback, that `tdd migrate`'s interaction with a voided
latest cycle was unaddressed, and that the `tdd validate --json` void
payload's shape/scoping was too loose. This revision closes all of these.

## REQ-TDD-CYCLE-VOID-001: Reject voiding a cycle whose Green is already valid
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `tdd void <test-id>` is invoked and the latest recorded cycle for `<test-id>` has a valid Green phase, then the system shall reject the invocation and record no evidence.
Acceptance: Given a test ID whose latest cycle already has `green.valid ===
true`, `tdd void <test-id>` exits nonzero with an error naming the test ID
and stating the latest cycle is not dangling, and `.musubix/evidence/tdd.json`
and `.musubix/evidence/order.json` are byte-identical before and after the
call.

## REQ-TDD-CYCLE-VOID-002: Reject voiding when no earlier non-voided valid fallback cycle exists
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `tdd void <test-id>` is invoked and `<test-id>` has no earlier recorded, non-voided cycle with both a valid Red and a valid Green phase before its latest cycle, then the system shall reject the invocation and record no evidence.
Acceptance: Given a test ID whose latest cycle is invalid/incomplete but for
which no earlier cycle has both a valid Red and a valid Green, `tdd void
<test-id>` exits nonzero with an error stating there is no prior valid,
non-voided cycle to fall back to, and both evidence files are
byte-identical before and after the call. Given a test ID whose only
earlier valid Red-Green cycle is itself already voided, `tdd void
<test-id>` is rejected with the same error and no evidence is recorded,
since a voided cycle is never an eligible fallback.

## REQ-TDD-CYCLE-VOID-003: Require an explicit human approver, reason, and confirmation
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `tdd void <test-id>` is invoked without a non-empty `--approver` name, a non-empty `--reason` string, or the `--confirm` flag, then the system shall reject the invocation and record no evidence.
Acceptance: Omitting `--approver`, omitting `--reason`, omitting `--confirm`,
or supplying an empty/whitespace-only `--approver` or `--reason` each exit
nonzero with an error naming the missing/invalid option, and
`.musubix/evidence/tdd.json`/`.musubix/evidence/order.json` are unchanged in
every case.

## REQ-TDD-CYCLE-VOID-004: Record the void as a hash-chained, ordered, identity-bound evidence entry
Priority: must
Type: functional
Pattern: event-driven
Statement: When `tdd void <test-id>` succeeds, the system shall append a `void` payload (capturing the approver, reason, timestamp, `testId`, and `cycleId`) to the latest cycle for `<test-id>`, exactly one evidence-order entry stamped with that same `testId`/`cycleId`/`phase: "void"`, and exactly one matching `TddChainRecord` stamped with that same `testId`/`cycleId`/`phase: "void"` whose recorded hash covers that void payload, without modifying, reordering, or deleting any existing phase evidence for `<test-id>` or any other test ID.
Acceptance: After a successful `tdd void <test-id>`, the previously recorded
`red`/`green`/`refactor`/`migrate` entries for every cycle of `<test-id>`
are byte-identical to before the call; `.musubix/evidence/order.json` gains
exactly one new record whose `phase` is `void`, whose `testId`/`cycleId`
match the voided cycle, and whose `sequence` is one greater than the
previous maximum; the hash chain gains exactly one new `TddChainRecord`
with `phase: "void"`, matching `testId`/`cycleId`, whose
`phaseEvidenceSha256` is computed from the void payload and whose
`previousSha256` matches the prior chain record's `recordSha256`; every
other test ID's evidence is unchanged.

## REQ-TDD-CYCLE-VOID-005: Define valid void linkage as unique, identity-bound, and hash-consistent
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall treat a cycle's `void` payload as validly linked only when exactly one `order.json` record and exactly one `TddChainRecord` exist with `phase: "void"` and the same `testId`/`cycleId` as that payload, that chain record's `previousSha256` matches the prior chain record's `recordSha256`, and that chain record's `phaseEvidenceSha256` equals the recomputed hash of that exact void payload.
Acceptance: Given a void payload whose matching chain/order records carry a
different `testId` or `cycleId`, whose chain record has no matching
`order.json` entry, for which more than one `order.json` record or
`TddChainRecord` declares `phase: "void"` for that `testId`/`cycleId`, or
whose recomputed payload hash does not equal the chain record's
`phaseEvidenceSha256`, linkage is invalid under this definition; only a
payload with a single, identity-matched, hash-consistent chain and order
record pair is validly linked.

## REQ-TDD-CYCLE-VOID-006: Report malformed void evidence
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a cycle's `void` payload does not have valid linkage per REQ-TDD-CYCLE-VOID-005, then the system shall report a `tdd validate`/`gate` diagnostic naming that test ID's malformed void evidence.
Acceptance: Given a cycle with a `void` payload that fails any condition of
REQ-TDD-CYCLE-VOID-005 (missing/duplicate chain or order record, mismatched
`testId`/`cycleId`, or mismatched hash), `tdd validate --json` reports a
diagnostic identifying the malformed void evidence for that test ID.

## REQ-TDD-CYCLE-VOID-007: Do not suppress diagnostics for malformed void evidence
Priority: must
Type: functional
Pattern: state-driven
Statement: While a cycle's `void` payload lacks valid linkage per REQ-TDD-CYCLE-VOID-005, the system shall raise exactly the `TDD_RED_MISSING`/`TDD_GREEN_MISSING`/`TDD_LEGACY_OR_UNSCOPED_EVIDENCE` diagnostics that cycle would raise absent any `void` payload, in addition to the REQ-TDD-CYCLE-VOID-006 malformed-evidence diagnostic.
Acceptance: Given a cycle that would raise `TDD_RED_MISSING` absent any
void payload and instead carries a malformed `void` payload (missing chain
record, duplicate record, mismatched identity, or mismatched hash), `tdd
validate --json` still reports `TDD_RED_MISSING` for it, plus the
REQ-TDD-CYCLE-VOID-006 malformed-evidence diagnostic, and reports no
diagnostic the cycle would not otherwise have raised.

## REQ-TDD-CYCLE-VOID-008: Suppress missing/legacy diagnostics for a validly voided cycle
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall not raise `TDD_RED_MISSING`, `TDD_GREEN_MISSING`, or `TDD_LEGACY_OR_UNSCOPED_EVIDENCE` for a cycle whose `void` payload has valid linkage per REQ-TDD-CYCLE-VOID-005.
Acceptance: Given a test ID with three recorded cycles in order
valid-Red-Green, invalid, invalid, voiding only the newest cycle suppresses
that newest cycle's `TDD_RED_MISSING`/`TDD_GREEN_MISSING`/
`TDD_LEGACY_OR_UNSCOPED_EVIDENCE` diagnostics. Given both trailing invalid
cycles are separately, validly voided, both of their diagnostics are
suppressed under this same rule, independently and non-transitively.

## REQ-TDD-CYCLE-VOID-009: Preserve diagnostics for cycles that are not themselves validly voided
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall continue to raise `TDD_RED_MISSING`, `TDD_GREEN_MISSING`, and `TDD_LEGACY_OR_UNSCOPED_EVIDENCE`, unaffected, for every recorded cycle that is neither itself validly voided per REQ-TDD-CYCLE-VOID-005 nor already superseded under `tdd-superseded-cycle-scoping`.
Acceptance: Given a test ID with three recorded cycles in order
valid-Red-Green, invalid, invalid, voiding only the newest cycle leaves the
middle invalid cycle's `TDD_RED_MISSING`/`TDD_GREEN_MISSING`/
`TDD_LEGACY_OR_UNSCOPED_EVIDENCE` diagnostics unaffected (still reported),
and `gate` remains blocked on that middle cycle; voiding one cycle never
suppresses diagnostics for any cycle of that test ID other than the one it
directly voids.

## REQ-TDD-CYCLE-VOID-010: Use the nearest earlier non-voided valid cycle as the effective latest after voiding
Priority: must
Type: functional
Pattern: state-driven
Statement: While a test ID's latest recorded cycle has a validly linked void payload, the system shall treat the cycle with the greatest `order.json` Green-phase sequence strictly less than the voided cycle's own `order.json` void-phase sequence, among cycles for that test ID with a valid Red, a valid Green, and no validly linked void payload per REQ-TDD-CYCLE-VOID-005, as its effective latest cycle for `TDD_TEST_STALE` staleness comparison, using that cycle's own latest passing fingerprint (its Green fingerprint, or its Refactor/Migrate fingerprint when a later valid Refactor or Migrate record exists on it).
Acceptance: After voiding a dangling trailing cycle, `TDD_TEST_STALE` for
that test ID is computed against the fingerprint of the nearest earlier
non-voided valid cycle's latest passing phase (Green, or Refactor/Migrate
when present), identical to what it would have reported had the dangling
cycle never been recorded. Given two earlier non-voided valid cycles with
different fingerprints and an intervening voided/invalid cycle between
them, the one with the greater `order.json` sequence (the more recent of
the two) is selected as the effective latest cycle, not the older one.

## REQ-TDD-CYCLE-VOID-011: Reject re-voiding an already-voided cycle
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `tdd void <test-id>` is invoked and `<test-id>`'s latest recorded cycle already has a validly linked void payload, then the system shall reject the invocation and record no additional evidence.
Acceptance: Calling `tdd void <test-id>` a second time for the same test ID
immediately after a successful void, with no new cycle recorded in between,
exits nonzero with an error stating the latest cycle is already voided, and
both evidence files are byte-identical before and after the second call.
Given a test ID whose voided cycle is later followed by a fresh, fully
valid Red-Green cycle, a subsequent `tdd void <test-id>` evaluates
REQ-TDD-CYCLE-VOID-001 through -002 against that new latest cycle and is
not rejected solely because an earlier cycle for the same test ID was
previously voided.

## REQ-TDD-CYCLE-VOID-012: Route `tdd migrate` around a voided latest cycle
Priority: must
Type: functional
Pattern: state-driven
Statement: While a test ID's latest recorded cycle has a validly linked void payload, the system shall evaluate `tdd migrate <test-id>` against the same nearest earlier non-voided valid Red-Green cycle selected by REQ-TDD-CYCLE-VOID-010, in place of the voided latest cycle.
Acceptance: Given a test ID whose latest cycle is validly voided and whose
REQ-TDD-CYCLE-VOID-010 effective-latest cycle has no existing `migrate`
record, `tdd migrate <test-id> --approver <name> --confirm` succeeds
against that effective-latest cycle exactly as if it were the latest
recorded cycle. Given that effective-latest cycle already has a `migrate`
record, `tdd migrate <test-id>` is rejected with the existing "already been
migrated" error, unaffected by the later voided cycle. Given an earlier
cycle has a valid Green but not a valid Red, that cycle is not selected as
the effective-latest cycle and `tdd migrate` does not target it.

## REQ-TDD-CYCLE-VOID-013: Surface scoped void evidence in `tdd validate --json`
Priority: should
Type: functional
Pattern: event-driven
Statement: When `tdd validate --json` runs and a cycle has a validly linked void payload, the system shall include a `void` object with `approver`, `reason`, and `recordedAt` fields on that cycle's own entry in the machine-readable output, identified by its `cycleId` and `testId`.
Acceptance: `tdd validate --json` output contains, on the entry for the
voided cycle's own `cycleId`/`testId`, a `void` object whose `approver`,
`reason`, and `recordedAt` exactly match the values persisted in that
cycle's `void` payload (as recorded by REQ-TDD-CYCLE-VOID-004); no other
cycle's entry (including earlier or later cycles of the same test ID)
carries that `void` object.
