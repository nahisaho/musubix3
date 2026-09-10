# EARS and requirement-ID diagnostic message improvements design

## DES-EARS-ID-DIAGNOSTIC-MESSAGES-001: Specific EARS failure reasons and an explicit ID-pattern message
Responsibilities: Add `earsFailureReason(statement): string | undefined` in
`packages/domain/src/requirements.ts`. When `classifyEars()` has already
returned `null` for a single-obligation statement, this helper: (a) detects
a pronoun or bare-noun subject immediately before `shall` (the segment after
the last comma preceding `shall` that does not start with "the"/"a"/"an")
and returns a message naming the offending subject text plus a valid-subject
example; (b) detects a prefix containing both an `if ...  then` construct
and a `while`/`when`/`where` keyword and returns a message naming the
specific clause keywords found. `validateRequirements()` appends this
reason (when present) to the existing `REQ_EARS` message, after its
existing obligation-count reason. Separately, change the `REQ_ID`
diagnostic's message in `validateRequirements()` to state the expected
`REQ-<FEATURE>-<digits>` pattern alongside the rejected ID.
Interfaces: New export `earsFailureReason(statement: string): string |
undefined` from `packages/domain/src/requirements.ts` (and re-exported from
`packages/domain/src/index.ts` alongside `classifyEars`). No change to
`classifyEars(statement: string): EarsPattern | null`'s signature or
behavior. `validateRequirements()`'s exported signature is unchanged; only
two diagnostic message strings (`REQ_EARS`, `REQ_ID`) gain additional text.
Constraints: Must not change any statement's classification outcome
(`classifyEars()` return value) for any input, including every case already
covered by `tests/domain.test.ts`'s classification table. Must not change
diagnostic codes (`REQ_EARS`, `REQ_ID`) or remove any existing message
content; only append additional, specific text. Must not fire the pronoun/
bare-subject or mixed-clause-form reasons for a statement with more than one
obligation (`shall`/しなければならない 等); that case keeps its existing
obligation-count-only reason.
Requirements: REQ-EARS-ID-DIAGNOSTIC-MESSAGES-001 REQ-EARS-ID-DIAGNOSTIC-MESSAGES-002 REQ-EARS-ID-DIAGNOSTIC-MESSAGES-003
ADRs: ADR-0014
