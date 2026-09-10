---
schemaVersion: 1
feature: tdd-red-collection-guidance
---
# Surface vitest/jest suite failure message in the zero-tests guidance error

## DES-TDD-RED-COLLECTION-GUIDANCE-001: Append suite-level failure text to the zero-tests error
Responsibilities: In `packages/analysis/src/adapters.ts`'s `normalizeAdapterReport()`, when parsing a `vitest`/`jest` report, collect any non-empty `message`/`failureMessage` string found on a `testResults[]` entry that has zero `assertionResults`, in encounter order; when the final selected `tests` array is empty, append these collected suite messages (each on its own line, prefixed clearly, e.g. "Suite failure: <message>") to the existing "No annotated TEST-* identities were found in the ${adapter} report." error text, after any existing pytest-specific guidance suffix.
Interfaces: `normalizeAdapterReport(adapter: TestAdapter, text: string, targetTestId?: string): MusubixTestReport` — exported signature unchanged; only the thrown error's message text gains an optional appended suffix for `vitest`/`jest` when applicable.
Constraints: Must not change the function's return value or its behavior when at least one test is found. Must not throw for adapters other than `vitest`/`jest`, or when no suite in the report carries a failure message (existing base message stays unchanged, with no empty/undefined suffix). Must not affect the `pytest` guidance suffix already appended for that adapter.
Requirements: REQ-TDD-RED-COLLECTION-GUIDANCE-001
ADRs: none — a narrow error-message enrichment within the existing normalizeAdapterReport function, no new architectural boundary
Depends-On: none
