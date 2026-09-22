---
schemaVersion: 1
feature: release-approval-ordering
---
# Release approval ordering

## REQ-RELEASE-APPROVAL-ORDERING-001: Require current release approval before preparation
Priority: must
Type: functional
Pattern: complex
Statement: While release approval is required, when release preparation is requested for a tag, the system shall require current repository-wide release approval before creating, deleting, or replacing any release output.
Acceptance: In required mode, local and GitHub Actions release preparation fail nonzero for missing or stale release approval, preserve the complete pre-existing output tree byte-for-byte, and proceed only when the tagged release manifest is approved; in compatible mode, absence of approval does not add a new preparation failure.

## REQ-RELEASE-APPROVAL-ORDERING-002: Validate the approved tagged release identity
Priority: must
Type: functional
Pattern: event-driven
Statement: When release preparation validates a tag, the system shall require that the tag resolve to the commit being prepared and that the recorded release approval match the exact release-input manifest of that commit.
Acceptance: The tag resolves to `HEAD` for local preparation and to `GITHUB_SHA` in GitHub Actions; the approval comparison uses committed files from that tag after applying the release-manifest exclusions, so untracked or ignored CI scratch paths such as `.test-tools/` do not make current approval stale; local preparation also fails when any tracked release input in the working tree differs from the tagged content; any different tag target or added, modified, or deleted committed release input fails before output mutation, in addition to the version and tag checks required by REQ-RELEASE-VERSION-SYNCHRONIZATION-006 and REQ-RELEASE-VERSION-SYNCHRONIZATION-007.

## REQ-RELEASE-APPROVAL-ORDERING-003: Diagnose release approval drift
Priority: must
Type: functional
Pattern: state-driven
Statement: While release approval is missing or stale, the system shall return deterministic diagnostics that identify the approval state and every artifact added, modified, or deleted since the recorded approval.
Acceptance: The release-preparation CLI exits nonzero, writes no stdout document, and writes exactly one JSON document to stderr with `{ valid: false, stage: "release", status, diagnostics }`; `status` is `missing` or `stale`; missing approval produces `diagnostics: []`, while stale approval reports every drifted artifact as `{ path, change, approvedSha256, currentSha256 }`, where `change` is `added`, `modified`, or `deleted`, an absent-side SHA-256 is null, paths are repository-relative with `/`, and entries use Unicode code-point path order; this approval report is separate from and does not extend the release-version diagnostic `reason` values or change successful `release-prepare.mjs` stdout framing.

## REQ-RELEASE-APPROVAL-ORDERING-004: Document the enforced release sequence
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall document the enforced release sequence final metadata and changelog update, validation, explicit release approval, unchanged tag creation, and release preparation.
Acceptance: The release workflow sections in `README.md` and `README-ja.md` state the order and explain that any committed release-input change after approval requires renewed validation and approval; automated tests assert both documents contain the ordered sequence.
