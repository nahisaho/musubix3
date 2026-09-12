---
schemaVersion: 1
id: CHANGE-0009
summary: Add configurable approval domains to scope requirements/design approval per feature group
status: completed
---
# CHANGE-0009: Approval domain scoping

Requirements: REQ-APPROVAL-DOMAIN-SCOPING-001 REQ-APPROVAL-DOMAIN-SCOPING-002 REQ-APPROVAL-DOMAIN-SCOPING-003 REQ-APPROVAL-DOMAIN-SCOPING-004 REQ-APPROVAL-DOMAIN-SCOPING-005 REQ-APPROVAL-DOMAIN-SCOPING-006 REQ-APPROVAL-DOMAIN-SCOPING-007 REQ-APPROVAL-DOMAIN-SCOPING-008 REQ-APPROVAL-DOMAIN-SCOPING-009 REQ-APPROVAL-DOMAIN-SCOPING-010 REQ-APPROVAL-DOMAIN-SCOPING-011 REQ-APPROVAL-DOMAIN-SCOPING-012 REQ-APPROVAL-DOMAIN-SCOPING-013 REQ-APPROVAL-DOMAIN-SCOPING-014 REQ-APPROVAL-DOMAIN-SCOPING-015 REQ-APPROVAL-DOMAIN-SCOPING-016 REQ-APPROVAL-DOMAIN-SCOPING-017 REQ-APPROVAL-DOMAIN-SCOPING-018 REQ-APPROVAL-DOMAIN-SCOPING-019 REQ-APPROVAL-DOMAIN-SCOPING-020 REQ-APPROVAL-DOMAIN-SCOPING-021 REQ-APPROVAL-DOMAIN-SCOPING-022 REQ-APPROVAL-DOMAIN-SCOPING-023 REQ-APPROVAL-DOMAIN-SCOPING-024

## Intent

Resolve GitHub Issue #19: `approval prepare/record/validate` binds every
stage to a single repository-wide artifact manifest. In a `.musubix` repo
managing several independent features/services, any one feature's
`requirements.md`/`design.md` edit invalidates every other feature's already
current requirements/design approval, forcing unrelated approvers to
re-review and re-approve on every unrelated change. This risks approval
fatigue (rubber-stamping) as the number of managed features grows.

This change adds an optional, explicitly configured `approval.domains` list
that groups feature directories into named domains, so requirements/design
approval can be prepared/recorded/validated per domain instead of always
repo-wide. Per the user's explicit decision (2026-09-12), the `release`
stage remains repository-wide and out of scope for this change — it is not
addressed here.

A native `rubber-duck` review of the first requirements draft found four
blocking gaps, since closed by an expanded requirement set. A second
review of that revision found three further gaps in the expansion itself,
since also closed. Final closure map:
1. Domain scoping did not extend to the existing `design validate`/`tdd red`
   approval prerequisite gates (closed by
   `REQ-APPROVAL-DOMAIN-SCOPING-016`/`-017`/`-018`/`-023`).
2. `approval validate`'s domain/unknown-domain/no-domain semantics and its
   relationship to the release stage were ambiguous (closed by
   `REQ-APPROVAL-DOMAIN-SCOPING-006`/`-007`/`-008`/`-009`/`-010`).
3. Domain configuration/membership/rename changes had no defined
   invalidation semantics, and the first fix's claim that renaming
   produces `stale` contradicted evidence being keyed by domain name
   (closed by `REQ-APPROVAL-DOMAIN-SCOPING-011`/`-012`, which bind domain
   identity and resolved feature membership into the manifest and define
   renaming as retiring the old name — orphaning its evidence — and
   introducing a new name that reports `missing`, not `stale`).
4. Zero-feature domains (for example after feature deletion) had undefined,
   potentially permanently-blocking behavior (closed by
   `REQ-APPROVAL-DOMAIN-SCOPING-004`, which rejects such configurations
   outright).
5. `design validate <file>` for a file outside any domain-owned feature
   directory had undefined prerequisite behavior, risking a silent
   repo-wide fallback (closed by `REQ-APPROVAL-DOMAIN-SCOPING-017`, which
   rejects such invocations outright when domains are configured).

## Scope

- `REQ-APPROVAL-DOMAIN-SCOPING-001`/`-002`/`-003`/`-004`: new
  `approval.domains` config (`{name, featureGlobs}[]`) with a lowercase
  kebab-case, non-reserved name grammar; every existing feature directory
  must be assigned to exactly one domain and every domain must currently
  match at least one feature when domains are configured (fail closed on
  overlap, omission, or emptiness).
- `REQ-APPROVAL-DOMAIN-SCOPING-005`/`-006`/`-007`: `approval
  prepare/record requirements|design --domain <name>` — required when
  domains are configured, rejected when they are not; `release`
  commands always reject `--domain`.
- `REQ-APPROVAL-DOMAIN-SCOPING-008`/`-009`/`-010`: `approval validate`
  without `--domain` reports every domain plus release; with a known
  `--domain`, reports only that domain (no release); an unknown domain
  name is rejected.
- `REQ-APPROVAL-DOMAIN-SCOPING-011`/`-012`/`-013`/`-014`: domain-scoped
  manifests bind domain identity, resolved feature membership, and
  domain-owned requirements/design/ADR artifacts plus the cross-cutting
  `constitution.md`, replacing the repo-wide manifest as the relevant-
  artifact definition only while domains are configured.
- `REQ-APPROVAL-DOMAIN-SCOPING-015`: domain evidence stored under a
  domain-qualified path distinct per domain and from the existing
  repo-wide evidence file.
- `REQ-APPROVAL-DOMAIN-SCOPING-016`/`-017`/`-018`: `design validate`/
  `tdd red` gate on the current requirements/design approval of the
  domain owning the relevant feature/requirement, not the whole
  repository; a `design validate` target outside every domain is
  rejected outright.
- `REQ-APPROVAL-DOMAIN-SCOPING-019`/`-020`: `gate --feature <name>`
  evaluates the `approval` check's requirements/design portion against
  only the owning domain, while `release` stays repository-wide exactly
  as today.
- `REQ-APPROVAL-DOMAIN-SCOPING-021`/`-022`: full-repo `gate`/`status`
  report a per-domain requirements/design breakdown and require every
  domain current for overall `approval.valid`.
- `REQ-APPROVAL-DOMAIN-SCOPING-023`: every evaluation site for a domain
  (`prepare`, `record`, `validate`, `gate`, and the `design validate`/
  `tdd red` prerequisite checks) recomputes the identical scoped manifest.
- `REQ-APPROVAL-DOMAIN-SCOPING-024`: projects that do not configure
  `approval.domains` behave byte-identically to v0.1.16 (no new mandatory
  flags, single repo-wide manifest/evidence file, unaffected `release`
  stage, unaffected `design validate`/`tdd red` prerequisite behavior).

## Out of scope

- Domain scoping of the `release` approval stage (explicit user decision;
  may be a future change/issue).
- Any change to `REQ-HUMAN-APPROVAL-GATES-*` acceptance criteria; those
  requirements' existing behavior is preserved unchanged for the
  no-domains-configured case (`REQ-APPROVAL-DOMAIN-SCOPING-024`) and for
  the release stage in every case (`REQ-APPROVAL-DOMAIN-SCOPING-014`).
- Any migration tooling for renaming a domain without losing prior
  approval; renaming is treated as a new domain identity that requires
  fresh approval (`REQ-APPROVAL-DOMAIN-SCOPING-011`), by design.

## Other impacts

- `packages/analysis/src/approval.ts`, `packages/analysis/src/config.ts`,
  `packages/analysis/src/gate.ts`, `packages/analysis/src/tdd.ts`,
  `packages/cli/src/main.ts` require changes (per `graph impact
  packages/analysis/src/approval.ts`, ripples into
  `approval-record.ts`, `attestation.ts`, `change.ts`,
  `model-correspondence.ts`, `performance.ts`, `mutation.ts`).
- README documents the new `approval.domains` config and `--domain` flag.
- `ADR-0002` (artifact-bound staged human approvals) needs a companion ADR
  documenting the domain-scoping decision, the domain-identity-in-manifest
  invalidation rule, and the constitution cross-cutting-invalidation rule.
