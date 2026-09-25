---
schemaVersion: 1
id: CHANGE-0040
summary: Report recovery durability failures after lock removal accurately
status: staged
---
# CHANGE-0040: evidence-writer-lock-recovery-durability

Source: GitHub Issue #42.

Requirements: REQ-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001

## Intent

Distinguish an unsafe recovery refusal that leaves the canonical lock untouched
from a post-unlink directory synchronization failure where the lock is already
absent but crash durability is uncertain.

## Classification

- Evidence writer-lock defect correction and diagnostic behavior change.

## Impact

- Split recovery unlink and post-unlink directory synchronization failure
  handling.
- Add a stable post-unlink durability error that reports the exact lock path,
  readable owner metadata, and `lockRemoved: true`.
- Keep pre-unlink recovery refusals on the existing
  `EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE` path with no mutation.
- Expose the distinct state consistently to analysis callers and JSON/human CLI
  output.
- Add deterministic tests for filesystem state, structured error fields, and
  rendered operator guidance.
- Update recovery documentation and help text without weakening strict
  directory synchronization.

## Verification

- The EARS requirement, design, and project constitution validate.
- TEST-EVIDENCE-WRITER-LOCK-RECOVERY-DURABILITY-001 recorded a genuine failing
  Red and passing Green; TEST-026 was subsequently covered by CHANGE-0041
  because its assertion changed after this change's original Red.
- Typecheck and build pass; the full suite reports 580 passed and 8 skipped.
- `pack:check` verifies 137 files and `pack:smoke` verifies the installed
  tarball.
- Strict trace and Code Graph gate pass. Formal reports
  `FORMAL_UNSUPPORTED` for this filesystem diagnostic requirement; no solver or
  behavioral-proof claim is made.
- CHANGE-0040's immutable `CHANGE_TEST_CHANGED_AFTER_RED` chronology diagnostic
  is waived only after CHANGE-0041 supplies the reviewed corrective Red/Green
  evidence.

## Residual risks

- A failed directory synchronization means current path absence is known but
  crash durability is not; operator guidance must not claim durable removal.
- Recovery remains fail-closed before unlink and never force-removes an
  unverified lock.
- A concurrent disappearance that causes `unlink` itself to return `ENOENT`
  remains on the pre-unlink unsafe boundary and is outside Issue #42, whose
  reproduction requires a successful unlink followed by synchronization
  failure.
- The initial and final owner observations have the same verified transaction
  identity; diagnostics intentionally retain the initially observed owner.
- Human output repeats guidance from the primary error message as dedicated
  lines because the approved CLI contract requires both the existing primary
  line and individually actionable guidance lines.
