---
schemaVersion: 1
feature: approval-rebase-fast-reapproval
---
# Rebase-triggered re-approval friction reduction

## REQ-APPROVAL-REBASE-FAST-REAPPROVAL-001: Offer an opt-in fast re-approval path for rebase-only drift
Priority: must
Type: functional
Pattern: optional-feature
Statement: Where a human reviewer invokes `approval record <stage> --fast-reapprove --own-files <path...>` together with the already-required `--approver` `--artifact-sha256` and `--confirm` options, the system shall record a new approval for the current manifest hash through the fast re-approval path defined by REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002 through REQ-APPROVAL-REBASE-FAST-REAPPROVAL-005.
Acceptance: `approval record requirements --fast-reapprove --own-files <path...> --approver <name> --artifact-sha256 <hash> --confirm` succeeds and writes approval evidence when a prior approval exists, every `--own-files` path is unchanged since that prior approval, and `<hash>` matches the current manifest; the same flag combination is accepted for the `design` and `release` stages (including `--domain` where applicable) with identical semantics. Omitting `--fast-reapprove` leaves `approval record`'s existing behavior completely unchanged (no new required input, no new rejection).

## REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002: Never fast-reapprove when any of the change's own files changed
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If any path listed in `--own-files` is present in exactly one of the prior recorded approval's artifacts map and the current manifest's artifacts map (an add or a removal), or is present in both with a different SHA-256 (a modification), then the system shall reject the `--fast-reapprove` invocation without recording any new approval evidence, reporting exactly which `--own-files` paths changed and how (added, removed, or modified).
Acceptance: Modifying the content of one file passed via `--own-files` (while every other artifact is unchanged) causes `approval record <stage> --fast-reapprove --own-files <that-path> ...` to exit nonzero, naming that path as modified, with no write to the approval evidence file. The same rejection, naming the path as added, occurs when an `--own-files` path exists in the current manifest but not in the prior recorded approval's artifacts. The same rejection, naming the path as removed, occurs when an `--own-files` path exists in the prior recorded approval's artifacts but not in the current manifest. In every case the previously recorded evidence file is byte-for-byte unchanged afterward.

## REQ-APPROVAL-REBASE-FAST-REAPPROVAL-003: Require the same approver as the prior recorded decision
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If a prior recorded approval exists for that stage/domain and `--approver` does not match that prior approval's `approver` exactly, then the system shall reject the `--fast-reapprove` invocation without recording any new approval evidence, reporting that fast re-approval requires the original approver.
Acceptance: Running `--fast-reapprove` with a `--approver` value different from the prior recorded evidence's `approver` field exits nonzero with an error identifying the mismatch and writes no new evidence; running it with `--approver` exactly equal (including case) to the prior `approver` and otherwise-eligible succeeds.

## REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004: Require an existing prior approval and reject unknown own-files paths
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If no prior recorded approval exists for that stage/domain, or `--own-files` is omitted or empty, or any `--own-files` path is absent from both the prior approval's artifacts and the current manifest's artifacts, then the system shall reject the `--fast-reapprove` invocation without recording any new approval evidence, reporting the specific reason (no prior approval to fast-reapprove against, an empty own-files list, or an unrecognized own-files path).
Acceptance: `--fast-reapprove` on a stage/domain with no prior recorded evidence exits nonzero with an explicit "no prior approval" error; `--fast-reapprove --own-files` supplied with zero paths (or `--own-files` omitted entirely) exits nonzero with an explicit "own-files must list at least one path" error; supplying an `--own-files` path that is not a key in either the prior or current artifacts map exits nonzero naming that unrecognized path; none of these three cases writes evidence.

## REQ-APPROVAL-REBASE-FAST-REAPPROVAL-005: Preserve the full manifest hash integrity guarantee and require explicit confirmation
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `--fast-reapprove` is invoked without `--confirm`, or with an `--artifact-sha256` value that does not equal the freshly computed current full manifest hash, then the system shall reject the invocation without recording any approval evidence, exactly as `approval record` already rejects those same two conditions without `--fast-reapprove`.
Acceptance: `--fast-reapprove` without `--confirm` exits nonzero with the same "--confirm is required" error `approval record` already raises; `--fast-reapprove` with an `--artifact-sha256` value that does not equal the current full manifest hash exits nonzero with the same "manifest changed" error already raised without `--fast-reapprove`; in both cases no evidence is written; the recorded evidence's `artifactSha256`/`artifacts` fields, once a fast re-approval does succeed, are byte-for-byte identical to what a non-fast-reapprove `approval record` would have written for the same manifest state — `--fast-reapprove` never computes, infers, or accepts a partial or `--own-files`-scoped hash in place of the full manifest hash.

## REQ-APPROVAL-REBASE-FAST-REAPPROVAL-006: Record fast re-approval provenance for auditability
Priority: should
Type: functional
Pattern: event-driven
Statement: When a fast re-approval is recorded, the system shall persist `fastReapproval: true` and `priorArtifactSha256: <the superseded evidence's artifactSha256>` alongside the existing approval evidence fields, while a normal (non-fast) `approval record` continues to persist evidence with neither field present.
Acceptance: Approval evidence written by a successful `--fast-reapprove` invocation has `fastReapproval === true` and `priorArtifactSha256` equal to the immediately-prior recorded evidence's `artifactSha256`; approval evidence written by `approval record` without `--fast-reapprove` has neither `fastReapproval` nor `priorArtifactSha256` present; `approval validate`/`loadApproval` continue to accept both shapes as schema-valid.

## REQ-APPROVAL-REBASE-FAST-REAPPROVAL-007: Apply every existing approval record precondition unchanged
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall apply every existing `approval record` precondition — nonempty approver format, 64-character lowercase-hex artifact-sha256 format, domain-option validation, and the release stage's requirement that requirements and design are already approved for every domain with a passing non-approval gate — to a `--fast-reapprove` invocation exactly as it already applies them without `--fast-reapprove`.
Acceptance: `--fast-reapprove` with an empty/whitespace-only `--approver` is rejected with the same error as a non-fast `approval record`; `--fast-reapprove` with a malformed `--artifact-sha256` is rejected with the same error; `--fast-reapprove --domain <unknown>` is rejected with the same unknown-domain error; `approval record release --fast-reapprove ...` attempted while a domain's `requirements` or `design` approval is missing/stale, or while a non-approval required gate check fails, is rejected with the same preconditions-not-met errors `approval record release` already raises without `--fast-reapprove`.
