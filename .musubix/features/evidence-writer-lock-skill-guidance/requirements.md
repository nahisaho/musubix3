---
schemaVersion: 1
feature: evidence-writer-lock-skill-guidance
---
# Safe evidence writer lock recovery guidance for SDD skills

Source: GitHub Issue #33.

## REQ-EVIDENCE-WRITER-LOCK-006: Guide SDD skill users through safe writer-lock recovery
Priority: must
Type: functional
Pattern: ubiquitous
Statement: The SDD skill distribution shall document safe recovery from `EVIDENCE_WRITER_LOCKED` in its change, implementation, and quality skills.
Acceptance: `.github/skills/sdd-change/SKILL.md`, `.github/skills/sdd-implementation/SKILL.md`, and `.github/skills/sdd-quality/SKILL.md` each contain fewer than 80 lines and contain the unbroken tokens `EVIDENCE_WRITER_LOCKED`, `.musubix/evidence/.writer-lock.json`, `npx musubix3 evidence unlock --recover`, and `EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`. In the same recovery guidance, each skill instructs the agent to stop the blocked command and inspect the reported canonical lock path and owner metadata; permits the Linux recovery command only after confirming that the recorded owner is no longer active; and explicitly forbids blind deletion and automatic retry loops, including polling or force stealing. Each skill states that `EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`, including a result on Linux, stops automated recovery and requires operator-reviewed inspection and targeted manual removal of only the exact reported lock path after confirming no related process is active. Each skill also states that platforms without all required automatic-recovery probes, including macOS and Windows, require that same operator-reviewed procedure rather than automatic removal. Each skill states that the blocked command may be retried only after the active owner releases the lock, `evidence unlock --recover` succeeds, or the operator completes that reviewed manual procedure. An authoritative automated test verifies every required recovery token, safety instruction, and line limit in all three source skill files. The package smoke test creates and installs an actual npm tarball, runs `init`, and verifies that the three skill files installed in the consumer project root contain the same required recovery guidance; a dry-run file-list check alone is insufficient.
