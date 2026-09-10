---
schemaVersion: 1
feature: tdd-red-collection-guidance
---
# Surface the underlying vitest/jest suite failure when a Red attempt finds zero annotated tests

Source: GitHub issue #15 — a brand-new module referenced only by its test causes
vitest/jest to fail at collection time (0 tests executed) rather than at
assertion time. `tdd red` correctly reports this as invalid (`TDD_REPORT_INVALID`),
but the underlying `"No annotated TEST-* identities were found"` message gives no
hint that the cause is a collection/import failure, nor that the fix is to create
a compiling stub with intentionally-wrong behavior before calling `tdd red`.

## REQ-TDD-RED-COLLECTION-GUIDANCE-001: Include the suite failure message when a vitest/jest report has zero tests
Priority: should
Type: functional
Pattern: event-driven
Statement: When a vitest or jest adapter report contains zero annotated TEST-* identities, the system shall append any suite-level failure message found in that report to the thrown "No annotated TEST-* identities were found" error.
Acceptance: Given a vitest-shaped report whose single `testResults` entry has an empty `assertionResults` array, `status` "failed", and a `message` string (for example "Cannot find module '../src/foo.js' imported from ..."), calling `normalizeAdapterReport('vitest', report, undefined)` throws an error whose message contains both "No annotated TEST-* identities were found" and the suite's `message` text; a report with zero tests and no suite-level failure message (e.g. an empty `testResults` array) continues to throw the unchanged base message with no `undefined`/empty suffix.
