import { expect, it } from 'vitest';
import { normalizeAdapterReport } from '../packages/analysis/src/index.js';

/** @id TEST-TDD-RED-COLLECTION-GUIDANCE-001
 * @verifies REQ-TDD-RED-COLLECTION-GUIDANCE-001
 */
it('TEST-TDD-RED-COLLECTION-GUIDANCE-001 appends the vitest suite collection-failure message when zero tests are found', () => {
  const report = JSON.stringify({
    testResults: [
      {
        assertionResults: [],
        status: 'failed',
        message: "Cannot find module '../src/foo.js' imported from /repo/tests/foo.test.ts",
        name: '/repo/tests/foo.test.ts',
      },
    ],
  });

  expect(() => normalizeAdapterReport('vitest', report)).toThrow(
    "No annotated TEST-* identities were found in the vitest report.",
  );
  try {
    normalizeAdapterReport('vitest', report);
    expect.unreachable();
  } catch (cause) {
    expect((cause as Error).message).toContain("Cannot find module '../src/foo.js' imported from /repo/tests/foo.test.ts");
  }

  // No suite-level failure message present: base message is unchanged, no empty/undefined suffix.
  const emptyReport = JSON.stringify({ testResults: [] });
  expect(() => normalizeAdapterReport('vitest', emptyReport)).toThrow(
    /^No annotated TEST-\* identities were found in the vitest report\.$/,
  );
});
