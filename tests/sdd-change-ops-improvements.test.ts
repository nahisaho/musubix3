import { expect, it } from 'vitest';
import { readText } from '../packages/analysis/src/index.js';

/** @id TEST-SDD-CHANGE-OPS-IMPROVEMENTS-001
 * @verifies REQ-SDD-CHANGE-OPS-IMPROVEMENTS-001 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-002 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-003 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-004 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-005 REQ-SDD-CHANGE-OPS-IMPROVEMENTS-006
 */
it('TEST-SDD-CHANGE-OPS-IMPROVEMENTS-001 documents Issue #61 workflow guidance in the sdd-change skill', async () => {
  const skill = await readText(process.cwd(), '.github/skills/sdd-change/SKILL.md');

  expect(skill).toMatch(/Strict order checklist[\s\S]*tdd red[\s\S]*change-record red[\s\S]*implementation edit[\s\S]*change-record implementation[\s\S]*tdd green[\s\S]*change-record green/i);
  expect(skill).toMatch(/Do not run `tdd green` before `change-record implementation`/);
  expect(skill).toContain('Never batch `tdd green` calls ahead of `change-record implementation`.');

  expect(skill).toContain('git log origin/main..HEAD');
  expect(skill).toContain('git log HEAD..origin/main');
  expect(skill).toMatch(/rebase onto `origin\/main` especially around other in-flight changes merging to `main`/);
  expect(skill).toContain('refresh against `origin/main` before release time');

  expect(skill).toMatch(/Use at most 3 rounds total/);
  expect(skill).toMatch(/round 1 may review the full artifact set, rounds 2-3 must be diff-only/i);
  expect(skill).toMatch(/stop after round 3 and summarize unresolved findings/i);
  expect(skill).toContain('ask a human whether to continue with fixes or proceed as-is');
  expect(skill).toMatch(/build a REQ↔acceptance self-check matrix/);
  expect(skill).toMatch(/build a REQ↔DES↔ADR traceability\/self-check table/);
  expect(skill).toMatch(/scope the prompt to logic\/contradiction\/acceptance\/consistency issues/i);
  expect(skill).toMatch(/pre-state known constraints\/decisions/i);
  expect(skill).toContain('review related requirements/design/ADR artifacts together in one pass');

  expect(skill).toMatch(/Confirm the `CHANGELOG\.md` entry was added/);
  expect(skill).toContain('Confirm the `CHANGELOG.md` entry was added before release approval.');
  expect(skill).toContain('Confirm the `CHANGELOG.md` entry was added before the change is treated as release-ready.');
  expect(skill).toContain('Confirm the `CHANGELOG.md` entry was added in the quality checklist.');
  expect(skill).toMatch(/Use `gate --changed --json` plus `status --json` for intermediate confidence/);
  expect(skill).toContain('Reserve the full `gate --json` for final release-candidate confirmation only.');
  expect(skill).toMatch(/run the full `gate --json` once as the final confirmation/i);
});
