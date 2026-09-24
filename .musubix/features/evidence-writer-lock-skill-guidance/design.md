---
schemaVersion: 1
feature: evidence-writer-lock-skill-guidance
---
# Safe evidence writer lock recovery guidance design

## DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001: Compact recovery guidance in three SDD skills
Responsibilities: Add one equivalent recovery paragraph to
`.github/skills/sdd-change/SKILL.md`,
`.github/skills/sdd-implementation/SKILL.md`, and
`.github/skills/sdd-quality/SKILL.md`. Each paragraph tells the agent to stop
after `EVIDENCE_WRITER_LOCKED`, inspect the owner metadata and exact canonical
`.musubix/evidence/.writer-lock.json` path, wait for a live owner to release the
lock, and avoid blind deletion, force stealing, polling, or automatic retries.
It permits Linux recovery with
`npx musubix3 evidence unlock --recover` only after confirming the owner is no
longer active. It treats `EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE`, including on
Linux, and platforms without all required probes, including macOS and Windows,
as an operator-reviewed manual-inspection path that may remove only the exact
reported lock after confirming no related process is active. Retrying is
allowed only after owner release, successful automatic recovery, or completed
operator-reviewed remediation. Add
`CODE-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001`,
`CODE-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-002`, and
`CODE-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-003` to the change,
implementation, and quality skills respectively; each block implements
`REQ-EVIDENCE-WRITER-LOCK-006` and links this design component.
Interfaces: The distributed `sdd-change`, `sdd-implementation`, and
`sdd-quality` Markdown instructions.
Constraints: Preserve the existing instruction order and the literals verified
by `TEST-SESSION-SCOPED-DEVELOPMENT-001` and
`TEST-SESSION-SCOPED-DEVELOPMENT-002`. Keep each complete skill below 80 lines
using the same `text.split(/\r?\n/).length < 80` measurement, compacting
existing wrapped paragraphs and blank lines, including the top-level workflow
prose, without deleting steps, changing meaning, or changing the internal
whitespace of asserted substrings. Run `tests/cli-package.test.ts` as a
regression check. Do not change CLI writer-lock behavior, recommend force
recovery, or add retry automation.
Requirements: REQ-EVIDENCE-WRITER-LOCK-006
ADRs: ADR-0031

## DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-002: Source skill guidance contract test
Responsibilities: Add
`tests/evidence-writer-lock-skill-guidance.test.ts` with
`TEST-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001`. Read the three authoritative
skill files and assert the four unbroken required tokens, fewer than 80 lines,
the stop-and-inspect instruction, the Linux inactive-owner precondition, the
blind-deletion/force-stealing/polling/automatic-retry prohibitions, the
unsupported-platform and Linux-unsafe manual path, and the three permitted
retry conditions. Add the test file to the existing
`evidence-writer-lock-tests` command. Keep `adapter: "vitest"` and omit
`tddArgs`/`tddReport`, allowing `adapterInvocation` to append the authoritative
test path, `-t <TEST-ID>`, JSON reporter, and fresh native report path to the
configured command.
Interfaces: Vitest test command `evidence-writer-lock-tests` and test ID
`TEST-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001`.
Constraints: The test must fail against the pre-change skill content, must not
accept token fragments split across lines, and must read source files rather
than generated copies. The selected Red/Green execution must contain exactly
the one named test, and the line-count assertion must use
`text.split(/\r?\n/).length < 80`. Record Red after adding the test and command
registration but before changing any skill or the package smoke script. Before
Green, implement both DES-001 and DES-003 so the non-test
`scripts/smoke-package.mjs` change advances the TDD source fingerprint even
though `.github/skills/**` is excluded from `evidenceInputPaths`.
Requirements: REQ-EVIDENCE-WRITER-LOCK-006
ADRs: ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001

## DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-003: Installed tarball guidance verification
Responsibilities: Extend `scripts/smoke-package.mjs`, after installing the
actual npm tarball and running `init`, to read the three skill files from the
consumer project root and verify that each is byte-identical to its
corresponding repository source file. Combined with DES-002's direct semantic
assertions on those source files, byte equality proves that the installed
copies contain the reviewed guidance without duplicating its token list.
Annotate the smoke implementation as
`CODE-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-004`, implementing
`REQ-EVIDENCE-WRITER-LOCK-006` and linking this design component.
Interfaces: Existing `npm run pack:smoke` command and its temporary consumer
project.
Constraints: Keep the existing `finally` cleanup, do not substitute
`npm pack --dry-run`, and do not treat source inspection without installed-copy
comparison as package proof. The test must verify the copies installed by the
packaged CLI's `init` flow. Existing initialized projects receive the new skill
content through the existing `musubix3 upgrade` path, whose replace behavior
remains covered by the upgrade workflow tests.
Requirements: REQ-EVIDENCE-WRITER-LOCK-006
ADRs: ADR-0031
Depends-On: DES-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001
