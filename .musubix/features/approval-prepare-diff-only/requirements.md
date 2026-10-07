---
schemaVersion: 1
feature: approval-prepare-diff-only
---
# Approval prepare diff-only output

## REQ-APPROVAL-PREPARE-DIFF-ONLY-001: Offer an opt-in diff-only presentation
Priority: must
Type: functional
Pattern: optional-feature
Statement: Where a human reviewer invokes `approval prepare <stage> --json` with the additional `--diff-only` option, the system shall include a `changedFiles` field in the JSON output listing only the artifact paths whose content differs from the human reviewer's prior point of reference for that same stage (and domain, when applicable).
Acceptance: `approval prepare <stage> --json --diff-only` succeeds for every stage in `requirements`, `design`, `release`, and the output object has a `changedFiles` array property; omitting `--diff-only` leaves the output exactly as before (no `changedFiles` property present). `changedFiles` is a distinct, approval-evidence-relative concept from the pre-existing, unrelated git-diff `--changed` option used by `graph`/`gate` commands (which reports paths changed per `git status`/`git diff`, independent of any recorded approval); the two are never conflated or implemented by sharing the same helper.

## REQ-APPROVAL-PREPARE-DIFF-ONLY-002: Never weaken the existing integrity manifest
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `--diff-only` is supplied, then the system shall still compute and return `artifactSha256` and the full `artifacts` map exactly as `approval prepare <stage> --json` computes them without `--diff-only`, so the cryptographic manifest used by `approval record` is never reduced, filtered, or altered.
Acceptance: For an identical project state, `artifactSha256` and `artifacts` are byte-for-byte identical between a `--diff-only` and a non-`--diff-only` invocation of `approval prepare <stage> --json` for the same stage/domain; `approval record <stage> --artifact-sha256 <hash>` continues to require the full, unfiltered hash regardless of whether `--diff-only` was used to display it.

## REQ-APPROVAL-PREPARE-DIFF-ONLY-003: Compare against the last recorded approval of the same stage and domain
Priority: must
Type: functional
Pattern: event-driven
Statement: When `--diff-only` is supplied and a prior approval evidence record already exists for that same stage and domain, the system shall compute `changedFiles` as the sorted set of artifact paths whose recorded content differs between that prior approval's `artifacts` map and the current manifest's `artifacts` map, counting an added path, a removed path, or a path whose SHA-256 changed as "differs".
Acceptance: Given a previously recorded approval for `<stage>` (optionally `<domain>`), modifying exactly one previously-approved file's content, adding one new in-scope file, and removing one previously-approved file each cause that respective path to appear in `changedFiles`; every unmodified path present in both the prior approval and the current manifest is absent from `changedFiles`; `changedFiles` is sorted using the same deterministic code-point path ordering already used for manifest artifact keys, and contains no duplicates.

## REQ-APPROVAL-PREPARE-DIFF-ONLY-004: Report every current path as changed when no prior approval exists
Priority: must
Type: functional
Pattern: state-driven
Statement: While no prior approval evidence record exists for that same stage and domain, the system shall set `changedFiles` to every path currently present in the manifest's `artifacts` map, paired with an explicit note in the output stating that no prior approval was found and all current artifacts are shown.
Acceptance: `approval prepare <stage> --json --diff-only` run before any `approval record <stage>` has ever succeeded for that stage/domain returns `changedFiles` equal to `Object.keys(artifacts)` (sorted) and a string field (e.g. `diffOnlyBaseline: "none"`) distinguishing this case from the comparison case (`diffOnlyBaseline: "approved"`), so a human reviewer is never misled into believing an empty or partial list reflects a smaller true review scope.

## REQ-APPROVAL-PREPARE-DIFF-ONLY-005: Respect domain scoping for requirements/design diff comparisons
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured and `--domain <name>` is supplied for a `requirements` or `design` stage, the system shall compute `changedFiles` only against that same domain's own previously recorded approval evidence, never against another domain's or the undomained project-wide evidence.
Acceptance: With two configured domains `a` and `b` each independently approved, running `approval prepare requirements --domain a --json --diff-only` after only domain `b`'s files changed reports `changedFiles` as exactly empty (domain `a`'s own artifacts are unchanged); running `approval prepare requirements --domain b --json --diff-only` in the same state reports exactly `b`'s changed paths.

## REQ-APPROVAL-PREPARE-DIFF-ONLY-006: Keep the human-readable summary focused when diff-only is requested
Priority: should
Type: functional
Pattern: optional-feature
Statement: Where `--diff-only` is supplied without `--json`, the system shall print a console summary listing only `changedFiles` (plus the full `artifactSha256` and the `diffOnlyBaseline` state), instead of the full `artifacts` path listing used without `--diff-only`.
Acceptance: `approval prepare <stage> --diff-only` (no `--json`) run against a project with 300+ tracked artifacts and only 2 genuinely changed paths prints exactly those 2 paths (plus the hash and baseline note), not all 300+ paths; `approval prepare <stage>` without `--diff-only` is unchanged and still prints the full artifact path listing.

## REQ-APPROVAL-PREPARE-DIFF-ONLY-007: Fail fast on corrupted prior approval evidence
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a prior approval evidence file exists for that stage and domain but fails the existing approval-evidence schema validation, then the system shall reject the `--diff-only` invocation with the same schema-validation error it already raises for that file, rather than treating the stage as having no prior approval.
Acceptance: Given a tampered or schema-invalid `.musubix/evidence/approvals/<stage>.json` (or its domain-scoped path), `approval prepare <stage> --json --diff-only` exits nonzero and reports the same "Invalid `<stage>` approval evidence." error that `loadApproval` already raises elsewhere; it never silently falls back to `diffOnlyBaseline: "none"` or to listing all current paths as changed.
