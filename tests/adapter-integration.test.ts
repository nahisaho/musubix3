import { existsSync } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  adapterInvocation,
  clearAdapterOutput,
  normalizeAdapterReport,
  readAdapterOutput,
  runProcess,
  type TestAdapter,
} from '../packages/analysis/src/index.js';
import { fixture, repository } from './helpers.js';

const requireNativeAdapters = process.env.MUSUBIX_RUN_NATIVE_ADAPTERS === '1';
const junitJar = process.env.JUNIT_CONSOLE_JAR;
const pytestPython = process.env.PYTEST_PYTHON ?? 'python3';

function available(command: string, args: string[] = ['--version']): boolean {
  return spawnSync(command, args, { stdio: 'ignore' }).status === 0;
}

function nativeTest(isAvailable: boolean): typeof it {
  return (isAvailable || requireNativeAdapters ? it : it.skip) as typeof it;
}

async function executeAdapter(
  adapter: TestAdapter,
  root: string,
  testId: string,
  testPath: string | undefined,
  command: string,
  baseArgs: string[] = [],
): Promise<ReturnType<typeof normalizeAdapterReport>> {
  const invocation = adapterInvocation(adapter, adapter, testId, testPath);
  const absoluteReportPath = resolve(root, invocation.reportPath);
  await clearAdapterOutput(invocation, absoluteReportPath);
  const result = await runProcess(command, [...baseArgs, ...invocation.args], { cwd: root, timeoutMs: 120_000 });
  expect(result, `${adapter} failed:\n${result.stdout}\n${result.stderr}`).toMatchObject({
    status: 'completed',
    exitCode: 0,
  });
  const report = await readAdapterOutput(invocation, absoluteReportPath, result.stdout);
  expect(report, `${adapter} did not create ${invocation.reportPath}`).not.toBeNull();
  return normalizeAdapterReport(adapter, report ?? '', testId);
}

describe('built-in adapter executable contracts', () => {
  nativeTest(existsSync(resolve(repository, 'node_modules/vitest/vitest.mjs')))(
    'executes and normalizes a targeted Vitest test',
    async () => {
      const root = await fixture({
        'tests/adapter.test.ts': `import { expect, test } from 'vitest';
test('TEST-ADAPTER-VITEST-001 selected', () => expect(2 + 2).toBe(4));
test('unrelated failure', () => expect(true).toBe(false));
`,
      });
      const report = await executeAdapter(
        'vitest',
        root,
        'TEST-ADAPTER-VITEST-001',
        'tests/adapter.test.ts',
        process.execPath,
        [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run'],
      );
      expect(report.tests).toEqual([{ id: 'TEST-ADAPTER-VITEST-001', status: 'passed' }]);
    },
  );

  nativeTest(existsSync(resolve(repository, 'node_modules/jest/bin/jest.js')))(
    'executes and normalizes a targeted Jest test',
    async () => {
      const root = await fixture({
        'adapter.test.cjs': `test('TEST-ADAPTER-JEST-002 selected', () => expect(2 + 2).toBe(4));
test('unrelated failure', () => expect(true).toBe(false));
`,
      });
      const report = await executeAdapter(
        'jest',
        root,
        'TEST-ADAPTER-JEST-002',
        'adapter.test.cjs',
        process.execPath,
        [
          resolve(repository, 'node_modules/jest/bin/jest.js'),
          '--runInBand',
          '--config',
          JSON.stringify({ rootDir: root, testEnvironment: 'node' }),
        ],
      );
      expect(report.tests).toEqual([{ id: 'TEST-ADAPTER-JEST-002', status: 'passed' }]);
    },
  );

  nativeTest(available(pytestPython, ['-c', 'import pytest_jsonreport']))(
    'executes and normalizes a targeted pytest test',
    async () => {
      const root = await fixture({
        'test_adapter.py': `def test_TEST_ADAPTER_PYTEST_003():
    assert 2 + 2 == 4

def test_unrelated_failure():
    assert False
`,
      });
      const report = await executeAdapter(
        'pytest',
        root,
        'TEST-ADAPTER-PYTEST-003',
        'test_adapter.py',
        pytestPython,
        ['-m', 'pytest', '-q'],
      );
      expect(report.tests).toEqual([{ id: 'TEST-ADAPTER-PYTEST-003', status: 'passed' }]);
    },
  );

  nativeTest(available('go', ['version']))(
    'executes and normalizes a targeted Go subtest',
    async () => {
      const root = await fixture({
        'go.mod': 'module example.com/musubix-adapter\n\ngo 1.20\n',
        'adapter_test.go': `package adapter

import "testing"

func TestAdapter(t *testing.T) {
    t.Run("TEST-ADAPTER-GO-004", func(t *testing.T) {})
    t.Run("unrelated failure", func(t *testing.T) { t.Fatal("must not run") })
}
`,
      });
      const report = await executeAdapter('go-test', root, 'TEST-ADAPTER-GO-004', 'adapter_test.go', 'go');
      expect(report.tests).toEqual([{ id: 'TEST-ADAPTER-GO-004', status: 'passed' }]);
    },
  );

  nativeTest(available('cargo', ['--version']))(
    'executes and normalizes a targeted Cargo test',
    async () => {
      const root = await fixture({
        'Cargo.toml': `[package]
name = "musubix_adapter"
version = "0.1.0"
edition = "2021"
`,
        'src/lib.rs': `#[test]
fn test_adapter_cargo_005() {
    assert_eq!(2 + 2, 4);
}

#[test]
fn unrelated_failure() {
    panic!("must not run");
}
`,
      });
      const report = await executeAdapter('cargo', root, 'TEST-ADAPTER-CARGO-005', 'src/lib.rs', 'cargo');
      expect(report.tests).toEqual([{ id: 'TEST-ADAPTER-CARGO-005', status: 'passed' }]);
    },
  );

  nativeTest(Boolean(junitJar) && available('java', ['-version']) && available('javac', ['-version']))(
    'executes and normalizes a targeted JUnit test',
    async () => {
      expect(junitJar, 'JUNIT_CONSOLE_JAR is required for native JUnit validation').toBeTruthy();
      if (!junitJar) return;
      await access(junitJar);
      const root = await fixture({
        'AdapterTest.java': `import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;
import static org.junit.jupiter.api.Assertions.fail;

class AdapterTest {
    @Test @Tag("TEST-ADAPTER-JUNIT-006") void test_TEST_ADAPTER_JUNIT_006() {}
    @Test void unrelatedFailure() { fail("must not run"); }
}
`,
      });
      await mkdir(resolve(root, 'classes'), { recursive: true });
      const compile = await runProcess(
        'javac',
        ['-cp', junitJar, '-d', 'classes', 'AdapterTest.java'],
        { cwd: root, timeoutMs: 120_000 },
      );
      expect(compile, compile.stderr).toMatchObject({ status: 'completed', exitCode: 0 });
      const report = await executeAdapter(
        'junit',
        root,
        'TEST-ADAPTER-JUNIT-006',
        undefined,
        'java',
        ['-jar', junitJar, 'execute', '--class-path', 'classes'],
      );
      expect(report.tests).toEqual([{ id: 'TEST-ADAPTER-JUNIT-006', status: 'passed' }]);
    },
  );
});
