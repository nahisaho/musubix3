---
schemaVersion: 1
feature: approval-domain-scoping
---
# Approval domain scoping

## REQ-APPROVAL-DOMAIN-SCOPING-001: Configure named approval domains
Priority: must
Type: functional
Pattern: optional-feature
Statement: Where a project defines a non-empty `approval.domains` list (the "configured" state used by every other requirement in this feature), the system shall accept each entry as a lowercase kebab-case name distinct from the reserved words `requirements`, `design`, and `release`, paired with one or more feature-directory glob patterns matched against `.musubix/features/<slug>/`.
Acceptance: Config validation accepts `approval.domains` as an array of `{ name, featureGlobs }` entries with unique, lowercase-kebab-case, non-reserved names and at least one non-empty glob per entry; rejects any entry violating the name grammar or reserved-word list; and a config that omits `approval.domains` or sets it to `[]` is defined as not configured (identical to v0.1.16 behavior).

## REQ-APPROVAL-DOMAIN-SCOPING-002: Reject ambiguous domain assignment
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If any feature directory matches more than one configured domain's `featureGlobs`, then the system shall reject the configuration.
Acceptance: `config` validation (and any command that loads config) reports an error naming the feature directory and every conflicting domain name, and does not proceed as if a single domain owned that feature.

## REQ-APPROVAL-DOMAIN-SCOPING-003: Require full domain coverage
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `approval.domains` is configured and any existing `.musubix/features/<slug>/` directory matches no domain's `featureGlobs`, then the system shall reject the configuration.
Acceptance: `config` validation reports an error naming the unassigned feature directory; no command silently treats an unassigned feature as repo-wide or as an implicit domain of its own.

## REQ-APPROVAL-DOMAIN-SCOPING-004: Reject domains with no currently matching feature
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `approval.domains` is configured and a domain's `featureGlobs` currently match zero existing feature directories, then the system shall reject the configuration.
Acceptance: `config` validation reports an error naming the domain that matches no feature directory; a feature deletion that empties its domain, or a domain declared before any matching feature exists, both fail config loading with this error instead of leaving an unapprovable or vacuously-approved domain.

## REQ-APPROVAL-DOMAIN-SCOPING-005: Require an explicit domain for prepare and record
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured, the system shall require an explicit `--domain <name>` naming a configured domain for `approval prepare requirements|design` and `approval record requirements|design`.
Acceptance: With domains configured, omitting `--domain` on a `requirements`/`design` stage `prepare`/`record` invocation exits nonzero listing the configured domain names; supplying an unknown domain name exits nonzero.

## REQ-APPROVAL-DOMAIN-SCOPING-006: Reject a domain option for the release stage
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `--domain` is supplied to `approval prepare release` or `approval record release`, then the system shall reject the invocation regardless of whether `approval.domains` is configured.
Acceptance: `approval prepare release --domain <any>` and `approval record release --domain <any>` exit nonzero with an error stating the release stage is always repository-wide; the release stage's manifest, evidence path, and behavior are unchanged from v0.1.16 in every case. (`approval validate --domain` never reports release; see REQ-APPROVAL-DOMAIN-SCOPING-009.)

## REQ-APPROVAL-DOMAIN-SCOPING-007: Reject a domain option when domains are not configured
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is not configured, the system shall reject any `--domain` option passed to `approval prepare requirements|design`, `approval record requirements|design`, or `approval validate`.
Acceptance: Passing `--domain <name>` to `approval prepare`, `approval record` for the `requirements`/`design` stage, or `approval validate`, in a project without `approval.domains`, exits nonzero with an error stating domains are not configured.

## REQ-APPROVAL-DOMAIN-SCOPING-008: Report every domain when validate omits a domain
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured, the system shall report `approval validate` invoked without `--domain` with every configured domain's requirements/design status alongside the single repository-wide release status.
Acceptance: `approval validate --json` without `--domain` lists each configured domain's name with its requirements/design `approved`/`missing`/`stale` status and one `release` entry, matching the per-domain breakdown also required of `gate`/`status`.

## REQ-APPROVAL-DOMAIN-SCOPING-009: Scope validate to one configured domain when requested
Priority: must
Type: functional
Pattern: event-driven
Statement: When `approval validate --domain <name>` runs with `<name>` matching a configured domain, the system shall report only that domain's requirements/design status, omitting other domains and the release stage.
Acceptance: `approval validate --domain <name> --json` output contains exactly that domain's requirements/design entries (no other configured domain's entries, no `release` entry).

## REQ-APPROVAL-DOMAIN-SCOPING-010: Reject validate for an unknown domain
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `approval validate --domain <name>` runs and `<name>` does not match any configured domain, then the system shall reject the invocation.
Acceptance: `approval validate --domain <unknown> --json` exits nonzero with an error listing the configured domain names, without reporting any domain's or release's status.

## REQ-APPROVAL-DOMAIN-SCOPING-011: Bind domain requirements manifest to domain identity and owned artifacts
Priority: must
Type: functional
Pattern: event-driven
Statement: When `approval prepare|record requirements --domain <name>` runs, the system shall compute the manifest from the domain's name, its current resolved and sorted set of owned feature directories, `.musubix/constitution.md`, and only the `requirements.md` files of features currently owned by that domain.
Acceptance: Recomputing a domain's requirements manifest hash is unaffected by adding, changing, or removing another domain's `requirements.md` files; changing a file owned by the target domain, `constitution.md`, or the domain's resolved owned-feature set (for example after reassigning a feature) changes that domain's manifest hash, making prior approval for that name stale. Renaming a domain is defined as retiring the old name (its evidence file becomes orphaned and is no longer evaluated) and introducing a new name with no evidence, which `approval validate --domain <new-name>` reports as `missing`, not `stale`.

## REQ-APPROVAL-DOMAIN-SCOPING-012: Bind domain design manifest to domain identity and owned artifacts
Priority: must
Type: functional
Pattern: event-driven
Statement: When `approval prepare|record design --domain <name>` runs, the system shall compute the manifest from that domain's requirements manifest inputs plus only that domain's `design.md` files and only the `ADR-*.md` files referenced by those design files.
Acceptance: Recomputing a domain's design manifest hash is unaffected by adding, changing, or removing another domain's `design.md` or referenced ADR files; changing a `design.md`/referenced ADR file owned by the target domain, or any change covered by REQ-APPROVAL-DOMAIN-SCOPING-011, changes that domain's manifest hash.

## REQ-APPROVAL-DOMAIN-SCOPING-013: Constitution changes invalidate every domain
Priority: must
Type: functional
Pattern: state-driven
Statement: While any domain has current requirements or design approval, the system shall report that approval as stale when `.musubix/constitution.md` changes.
Acceptance: Editing `constitution.md` and running `approval validate --domain <name>` for every configured domain reports each previously-approved requirements/design stage as `stale`.

## REQ-APPROVAL-DOMAIN-SCOPING-014: Domain manifests are the exclusive relevant-artifact definition in domain mode
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured, the system shall determine requirements/design approval staleness solely from the domain-scoped manifest defined by REQ-APPROVAL-DOMAIN-SCOPING-011/012/013, in place of the repository-wide manifest defined by REQ-HUMAN-APPROVAL-GATES-003.
Acceptance: With domains configured, a requirements/design-relevant artifact change outside every domain's bound inputs (for example another domain's files) does not change any domain's stale status; REQ-HUMAN-APPROVAL-GATES-003's repository-wide manifest continues to govern the release stage and every stage when domains are not configured.

## REQ-APPROVAL-DOMAIN-SCOPING-015: Store domain evidence distinctly
Priority: must
Type: functional
Pattern: event-driven
Statement: When a domain-scoped requirements or design approval is recorded, the system shall persist it at an evidence path that is distinct per domain name and distinct from the non-domain (repo-wide) evidence path for that stage.
Acceptance: Recording domain A's requirements approval does not create, modify, or invalidate domain B's evidence file or the pre-existing repo-wide `.musubix/evidence/approvals/<stage>.json`; each domain's evidence file independently reports approved/missing/stale via `approval validate --domain <name>`.

## REQ-APPROVAL-DOMAIN-SCOPING-016: Gate design validation on the owning domain's requirements approval
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured and requirements approval is mandatory, the system shall block `design validate <file>` until the domain owning `<file>`'s feature directory has current requirements approval.
Acceptance: `design validate <file>` for a `design.md` path under a domain-owned feature directory exits nonzero when the owning domain D's requirements approval is missing or stale, and proceeds once domain D's requirements approval (and only domain D's) is current, unaffected by other domains' approval state. (For `<file>` outside every domain, see REQ-APPROVAL-DOMAIN-SCOPING-017.)

## REQ-APPROVAL-DOMAIN-SCOPING-017: Reject design validation of a file outside every domain
Priority: must
Type: functional
Pattern: unwanted-behavior
Statement: If `approval.domains` is configured and `<file>` given to `design validate <file>` is not a `design.md` path under any domain-owned feature directory, then the system shall reject the invocation.
Acceptance: `design validate <file>` for a path outside `.musubix/features/<slug>/design.md` of a domain-owned feature (for example a scratch file or a feature pending domain assignment) exits nonzero with an error identifying `<file>` as outside any configured domain, instead of silently applying a repository-wide or no prerequisite check.

## REQ-APPROVAL-DOMAIN-SCOPING-018: Gate TDD Red on the owning domain's design approval
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured and design approval is mandatory, the system shall block `tdd red <test-id> --requirement <req-id>` until the domain owning `<req-id>`'s feature directory has current design approval.
Acceptance: `tdd red` for a requirement owned by domain D exits unsuccessfully when domain D's design approval is missing or stale, and reaches the configured test runner once domain D's design approval (and only domain D's) is current, unaffected by other domains' approval state.

## REQ-APPROVAL-DOMAIN-SCOPING-019: Scope gate --feature approval check to the owning domain
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured, the system shall evaluate `gate --feature <name>`'s `approval` check requirements/design portion using only the domain that owns `<name>`'s feature directory.
Acceptance: `gate --feature <name> --json` reports the `approval` check's requirements/design status and diagnostics based solely on the owning domain's manifest/evidence, unaffected by other domains' staleness.

## REQ-APPROVAL-DOMAIN-SCOPING-020: Keep release stage repository-wide under feature scoping
Priority: must
Type: functional
Pattern: state-driven
Statement: While `gate --feature <name>` evaluates the `approval` check, the system shall continue evaluating the `release` stage repository-wide exactly as when `--feature` is omitted.
Acceptance: `release`-stage staleness caused by any project file continues to affect a `gate --feature <name>` run identically to a full-repo `gate` run, regardless of which domain owns `<name>`.

## REQ-APPROVAL-DOMAIN-SCOPING-021: Report per-domain breakdown in full-repo gate/status
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured, the system shall report `gate`/`status` run without `--feature` with a per-domain requirements/design approval breakdown.
Acceptance: `gate --json`/`status --json` output lists each configured domain's name alongside its requirements/design `approved`/`missing`/`stale` status.

## REQ-APPROVAL-DOMAIN-SCOPING-022: Require every domain current for overall approval validity
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured, the system shall report `approval.valid` as true only when every configured domain's requirements/design stages and the repo-wide release stage are current.
Acceptance: `approval.valid` is `false` if any single domain's requirements/design stage is not `approved`, even when every other domain and the release stage are current.

## REQ-APPROVAL-DOMAIN-SCOPING-023: Recompute the identical scoped manifest across every evaluation site
Priority: must
Type: functional
Pattern: state-driven
Statement: While `approval.domains` is configured, the system shall use the same domain-scoped manifest definition (REQ-APPROVAL-DOMAIN-SCOPING-011/012) for `approval validate --domain`, the `approval` check inside `gate`, and the prerequisite checks in REQ-APPROVAL-DOMAIN-SCOPING-016/018.
Acceptance: For any domain D, the manifest SHA-256 reported by `approval prepare requirements|design --domain D`, the one evaluated by `approval validate --domain D`, the one evaluated inside `gate --feature <name-owned-by-D>`, and the one evaluated by `design validate`/`tdd red` prerequisite checks for D's features are identical for the same repository state.

## REQ-APPROVAL-DOMAIN-SCOPING-024: Preserve existing behavior without domains
Priority: must
Type: functional
Pattern: optional-feature
Statement: Where a project does not configure `approval.domains` (omitted or empty), the system shall use the existing single repository-wide manifest and evidence file for every stage exactly as in musubix3 v0.1.16.
Acceptance: For a config without `approval.domains`, `approval prepare/record/validate`, `design validate`, `tdd red`, `gate`, and `status` produce output identical in structure and meaning to the pre-existing (v0.1.16) implementation, and no existing command invocation that omitted `--domain` starts failing.
