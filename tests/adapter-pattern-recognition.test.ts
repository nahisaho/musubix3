import { expect, it } from 'vitest';
import { normalizeAdapterReport, configLint } from '../packages/analysis/src/index.js';
import { project } from './helpers.js';

/** @id TEST-ADAPTER-PATTERN-RECOGNITION-001
 * @verifies REQ-ADAPTER-PATTERN-RECOGNITION-001
 */
it('TEST-ADAPTER-PATTERN-RECOGNITION-001 recognizes a go-test ID with a descriptive suffix directly after its digits', () => {
  const report = normalizeAdapterReport('go-test', '{"Action":"pass","Test":"Test_TEST_LOGI_005_AssignsMinimalDistanceVehicle"}\n');
  expect(report.tests).toEqual([{ id: 'TEST-LOGI-005', status: 'passed' }]);

  // A longer digit run must still be matched in full, not truncated to 3 digits.
  const longer = normalizeAdapterReport('go-test', '{"Action":"pass","Test":"Test_TEST_LOGI_0051_AssignsVehicle"}\n');
  expect(longer.tests).toEqual([{ id: 'TEST-LOGI-0051', status: 'passed' }]);

  const cargoReport = normalizeAdapterReport('cargo', 'test test_TEST_LOGI_006_returns_when_no_vehicle_available ... ok\n');
  expect(cargoReport.tests).toEqual([{ id: 'TEST-LOGI-006', status: 'passed' }]);
});

/** @id TEST-ADAPTER-PATTERN-RECOGNITION-002
 * @verifies REQ-ADAPTER-PATTERN-RECOGNITION-002
 */
it('TEST-ADAPTER-PATTERN-RECOGNITION-002 does not flag a go-test ./... package pattern as an orphaned path', async () => {
  const root = await project();
  const { readText, writeJson } = await import('../packages/analysis/src/index.js');
  const config = JSON.parse(await readText(root, '.musubix/config.json'));
  config.commands.push({
    name: 'go-package-wildcard-tests',
    command: 'go',
    args: ['test', '-C', 'services/route-service', './...'],
    adapter: 'go-test',
    required: false,
    timeoutMs: 10_000,
  });
  await writeJson(root, '.musubix/config.json', config);

  const report = await configLint(root);
  expect(report.diagnostics.some((d) => d.code === 'CONFIG_ORPHANED_PATH' && d.message.includes('./...'))).toBe(false);
  // A genuinely missing path on the same command must still be reported.
  expect(report.diagnostics.some((d) => d.code === 'CONFIG_ORPHANED_PATH' && d.message.includes('services/route-service'))).toBe(true);
});
