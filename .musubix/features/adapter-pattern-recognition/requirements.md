---
schemaVersion: 1
feature: adapter-pattern-recognition
---
# Recognize language-specific token syntax in adapter ID matching and config lint

Source: GitHub Issues #7, #9, found during a real multi-language trial
project against musubix3@0.1.11. Both are cases where a generic token
pattern (a filesystem-path-like regex; a word-boundary regex) misreads a
language-specific syntax it was never designed to recognize: Go's `./...`
recursive package wildcard is not a filesystem path, and Go/Rust identifiers
cannot contain the non-word character a trailing word-boundary requires
immediately after a test ID's digits.

## REQ-ADAPTER-PATTERN-RECOGNITION-001: Recognize a descriptive suffix after a test ID's digits
Priority: must
Type: functional
Pattern: event-driven
Statement: When a go-test or cargo adapter's raw test report contains a test identifier ending in the annotated TEST-ID's digits immediately followed by further identifier characters instead of a non-word character, the system shall still recognize that TEST-ID rather than requiring the digits to be the identifier's exact final characters.
Acceptance: Given a Go test function named so its identifier contains `TEST_LOGI_005` immediately followed by descriptive text such as `AssignsMinimalDistanceVehicle` with no separating non-word character, the go-test adapter recognizes `TEST-LOGI-005` as the test's ID. Given a raw report token containing `TEST-LOGI-0051` where `0051` is itself the full numeric ID segment, the recognized ID still includes all four digits rather than being cut short at three.

## REQ-ADAPTER-PATTERN-RECOGNITION-002: Do not flag a Go package-pattern argument as an orphaned path
Priority: must
Type: functional
Pattern: event-driven
Statement: When a configured command whose adapter is go-test has an argument matching Go's recursive package-pattern syntax, the system shall exclude that argument from the CONFIG_ORPHANED_PATH filesystem-existence check.
Acceptance: Given a go-test adapter command configured with an argument `./...`, `config lint` reports no CONFIG_ORPHANED_PATH diagnostic for that argument, while a command with a genuinely missing repository-relative path argument still reports CONFIG_ORPHANED_PATH for that argument, and a non-go-test command with a literal `./...`-shaped argument is unaffected only insofar as this exclusion never applies to it.
