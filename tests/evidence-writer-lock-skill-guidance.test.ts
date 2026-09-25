import { describe, expect, it } from 'vitest';
import { readText } from '../packages/analysis/src/index.js';

const skillPaths = [
  '.github/skills/sdd-change/SKILL.md',
  '.github/skills/sdd-implementation/SKILL.md',
  '.github/skills/sdd-quality/SKILL.md',
] as const;

describe('evidence writer lock skill guidance', () => {
  /** @id TEST-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001
   * @verifies REQ-EVIDENCE-WRITER-LOCK-006 REQ-EVIDENCE-WRITER-LOCK-ACQUISITION-ROLLBACK-001
   */
  it('TEST-EVIDENCE-WRITER-LOCK-SKILL-GUIDANCE-001 documents safe recovery in every protected workflow skill', async () => {
    for (const path of skillPaths) {
      const skill = await readText(process.cwd(), path);
      expect(skill.split(/\r?\n/).length, path).toBeLessThan(80);
      expect(skill, path).toContain('EVIDENCE_WRITER_LOCKED');
      expect(skill, path).toContain('.musubix/evidence/.writer-lock.json');
      expect(skill, path).toContain('npx musubix3 evidence unlock --recover');
      expect(skill, path).toContain('EVIDENCE_WRITER_LOCK_RECOVERY_UNSAFE');
      expect(skill, path).toContain('stop the blocked command');
      expect(skill, path).toContain('inspect its reported owner metadata');
      expect(skill, path).toContain('recorded owner is no longer active');
      expect(skill, path).toContain('Never blindly delete');
      expect(skill, path).toContain('force-steal');
      expect(skill, path).toContain('poll');
      expect(skill, path).toContain('automatic retry loops');
      expect(skill, path).toContain('including on Linux');
      expect(skill, path).toContain('macOS/Windows');
      expect(skill, path).toContain('operator review');
      expect(skill, path).toContain('targeted manual removal');
      expect(skill, path).toContain('only the exact reported path');
      expect(skill, path).toContain('Retry only after the active owner releases the lock');
      expect(skill, path).toContain('recovery succeeds');
      expect(skill, path).toContain('reviewed manual procedure completes');
      expect(skill, path).toContain('EVIDENCE_WRITER_LOCK_ROLLBACK_FAILED');
      expect(skill, path).toContain('lockRemoved');
      expect(skill, path).toContain('failed acquirer');
      expect(skill, path).toContain('no lease');
      expect(skill, path).toContain('automatic recovery is preferred after it exits');
      expect(skill, path).toContain('crash durability');
      expect(skill, path).toContain('owner metadata may be unavailable');
    }
  });
});
