import { expect, it } from 'vitest';
import { validateRequirements } from '../packages/domain/src/index.js';
import { req } from './helpers.js';

/** @id TEST-EARS-ID-DIAGNOSTIC-MESSAGES-001
 * @verifies REQ-EARS-ID-DIAGNOSTIC-MESSAGES-001
 */
it('TEST-EARS-ID-DIAGNOSTIC-MESSAGES-001 names a pronoun subject and shows a valid-subject example', () => {
  const report = validateRequirements(req('When an event occurs, it shall respond.'));
  const message = report.diagnostics.find((d) => d.code === 'REQ_EARS')?.message ?? '';
  expect(message).toContain('"it"');
  expect(message).toMatch(/the <system\/component> shall/i);
});

/** @id TEST-EARS-ID-DIAGNOSTIC-MESSAGES-002
 * @verifies REQ-EARS-ID-DIAGNOSTIC-MESSAGES-002
 */
it('TEST-EARS-ID-DIAGNOSTIC-MESSAGES-002 names the specific clause forms mixed', () => {
  const report = validateRequirements(req('While the alarm is active, if a fault occurs, then the system shall stop.'));
  const message = report.diagnostics.find((d) => d.code === 'REQ_EARS')?.message ?? '';
  expect(message).toMatch(/if\s*\.\.\.,?\s*then/i);
  expect(message).toMatch(/\bwhile\b/i);
});

/** @id TEST-EARS-ID-DIAGNOSTIC-MESSAGES-003
 * @verifies REQ-EARS-ID-DIAGNOSTIC-MESSAGES-003
 */
it('TEST-EARS-ID-DIAGNOSTIC-MESSAGES-003 states the expected requirement-ID pattern', () => {
  const report = validateRequirements(req('The system shall report readiness.', 'REQ-LOGI-008B'));
  const message = report.diagnostics.find((d) => d.code === 'REQ_ID')?.message ?? '';
  expect(message).toMatch(/REQ-<FEATURE>-<digits>/);
});
