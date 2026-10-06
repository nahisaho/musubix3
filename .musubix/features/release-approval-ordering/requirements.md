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
Acceptance: The repository-wide LF checkout rule required by REQ-GITHUB-ACTIONS-NODE24-RUNTIME-002 applies to tracked text release inputs so approval SHA-256 values do not drift solely because of checkout host. The release-preparation CLI exits nonzero, writes no stdout document, and writes exactly one JSON document to stderr with `{ valid: false, stage: "release", status, diagnostics }`; `status` is `missing` or `stale`; missing approval produces `diagnostics: []`, while stale approval reports every drifted artifact as `{ path, change, approvedSha256, currentSha256 }`, where `change` is `added`, `modified`, or `deleted`, an absent-side SHA-256 is null, paths are repository-relative with `/`, and entries use Unicode code-point path order; this approval report is separate from and does not extend the release-version diagnostic `reason` values or change successful `release-prepare.mjs` stdout framing.

## REQ-RELEASE-APPROVAL-ORDERING-004: Document the enforced release sequence
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The system shall document the enforced release sequence final metadata and changelog update, validation, explicit release approval, unchanged tag creation, and release preparation.
Acceptance: The release workflow sections in `README.md` and `README-ja.md` state the order and explain that any committed release-input change after approval requires renewed validation and approval; automated tests assert both documents contain the ordered sequence.

## REQ-RELEASE-APPROVAL-ORDERING-005: Exclude the fixed scratch-file convention from the untracked release manifest
Priority: must
Type: functional
Pattern: state-driven
Statement: While collecting untracked Git candidate paths for `approval prepare release` / `releaseCandidatePaths`, the system shall exclude only any path at or beneath `.musubix/scratch/` and any path whose final segment matches the fixed, case-sensitive `*.scratch.<ext>` naming convention, so operator-written ad hoc inspection or debug output does not change the release manifest hash, while every tracked (`git ls-files --cached`) release input remains included regardless of its name and every other untracked path remains included and still affects the hash exactly as before this change.
Acceptance: An untracked file at `.musubix/scratch/<anything>` (including nested paths) or whose final path segment matches the regular expression `^[^/]+\.scratch\.[^/.]+$` (a non-empty, slash-free name, then the literal infix `.scratch.`, then a single non-empty, dot-free, case-sensitive extension; for example `approval-prepare-release.scratch.json` and `relcheck-1.scratch.json` match, while `foo.scratch` with no extension, `foo.SCRATCH.JSON`, and `foo.scratch.tar.gz` with a second dot in the extension do **not** match and remain fully included) is absent from the `artifacts` map and `artifactSha256` input of `approvalManifest(root, 'release')` / `releaseCandidatePaths`, and repeatedly creating, rewriting, or deleting such a file across consecutive `approval prepare release --json` invocations never changes the reported hash. An ordinary untracked file that matches neither pattern (for example an uncommitted `src/uncommitted.ts`) continues to appear in `artifacts`/`artifactSha256` and continues to change the reported hash when added, modified, or removed, exactly as today, so this requirement narrows the untracked-candidate set by exactly these two fixed patterns and never degrades into excluding untracked files generally. A **tracked** file whose name matches either pattern (for example a committed `.musubix/scratch/README.md` or committed `notes.scratch.json`) is still included exactly like any other tracked release input, so the convention narrows only what counts as release-relevant scratch noise and cannot be used to hide a committed change from the manifest hash. The two patterns are fixed in source code and covered by automated tests; they are not configurable through `.musubix/config.json`, environment variables, or CLI flags, so expanding them requires a reviewed source change through the same `requirements`/`design`/TDD/quality gate as any other change to the release manifest. This is a distinct, independent mechanism from the `.gitignore`-based `--exclude-standard` filtering that REQ-RELEASE-APPROVAL-ORDERING-002 already relies on for tagged-approval comparison (for example `.test-tools/`): that mechanism depends on each repository's own `.gitignore` content and applies to tag-identity validation, whereas this requirement is a fixed, repository-independent exclusion applied specifically inside `releaseCandidateInventory`'s untracked-candidate collection for the `release` manifest, and it applies regardless of whether `.musubix/scratch/` or `*.scratch.<ext>` paths are also listed in `.gitignore`. `approval prepare requirements` and `approval prepare design` are unaffected, because their manifests are already limited to the fixed `constitution.md` / `features/*/requirements.md` / `features/*/design.md` / `decisions/ADR-*.md` allowlist and never include ad hoc untracked files. `README.md` and `README-ja.md` document `.musubix/scratch/` and the `*.scratch.<ext>` suffix as the only sanctioned location/naming convention for ad hoc operator inspection output during an approval or release session.
