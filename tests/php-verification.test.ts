import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { validateRequirements } from '../packages/domain/src/index.js';
import { digest, indexGraph, mutationDoctor, loadConfig, parseConfig, readText, runTddPhase, validateTddEvidence, writeJson, writeText } from '../packages/analysis/src/index.js';
import { code, fixture, processResult, project, req, tddResultRunner } from './helpers.js';

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

const phpTest = `<?php
namespace Tests;

final class BillingTest
{
    /* @id TEST-EXAMPLE-002
     * @verifies REQ-EXAMPLE-001
     */
    public function testProration(): void
    {
        $this->assertSame(100, (new \\App\\Invoice())->total());
    }
}
`;

function messageFor(text: string, code: string): string {
  const diagnostic = validateRequirements(text).diagnostics.find((d) => d.code === code);
  expect(diagnostic, `expected a ${code} diagnostic`).toBeDefined();
  return diagnostic?.message ?? '';
}

describe('actionable requirement diagnostics', () => {
  it('names the offending kind, unexpected keys and missing keys in Formal schema errors', () => {
    expect(messageFor(`${req()}\nFormal: {"kind":"sequence","a":1}\n`, 'REQ_FORMAL_SCHEMA'))
      .toContain('kind must be one of conditional, numeric, temporal, transition');
    expect(messageFor(`${req()}\nFormal: {"kind":"transition","from":"a","event":"e","to":"b","extra":1}\n`, 'REQ_FORMAL_SCHEMA'))
      .toContain('rejects unexpected key(s) extra');
    expect(messageFor(`${req()}\nFormal: {"kind":"temporal","event":"e","response":"r","withinMs":5}\n`, 'REQ_FORMAL_SCHEMA'))
      .toContain('unexpected key(s) event');
    expect(messageFor(`${req()}\nFormal: {"kind":"temporal","trigger":"t","response":"r"}\n`, 'REQ_FORMAL_SCHEMA'))
      .toContain('missing required key(s) withinMs');
    expect(messageFor(`${req()}\nFormal: {"kind":"numeric","metric":"m","operator":"==","value":1}\n`, 'REQ_FORMAL_SCHEMA'))
      .toContain('operator (required one of <, <=, =, >=, >)');
  });

  it('explains that a statement may declare only one obligation', () => {
    const multiple = messageFor(
      `${req('When usage arrives, the system shall store the event and shall emit an audit record.')}\n`,
      'REQ_EARS',
    );
    expect(multiple).toContain('declares 2 obligations');
    expect(messageFor(`${req('the system responds quickly')}\n`, 'REQ_EARS')).not.toContain('obligations');
  });

  it('lists the valid pattern vocabulary when a declared pattern is wrong', () => {
    expect(messageFor(`${req('If a fault occurs, then the system shall alert.')}\nPattern: unwanted\n`, 'REQ_PATTERN'))
      .toContain('ubiquitous, event-driven, state-driven, unwanted-behavior, optional-feature, complex');
  });

  it('still accepts every valid Formal constraint kind', () => {
    const valid = [
      '{"kind":"conditional","condition":"a","consequence":"b"}',
      '{"kind":"numeric","metric":"m","operator":">=","value":1}',
      '{"kind":"temporal","trigger":"t","response":"r","withinMs":5}',
      '{"kind":"transition","from":"TRIAL","event":"activate","to":"ACTIVE"}',
    ];
    for (const [index, formal] of valid.entries()) {
      const result = validateRequirements(`${req('The system shall hold the constraint.', `REQ-PHP-${100 + index}`)}\nFormal: ${formal}\n`);
      expect(result.diagnostics.filter((d) => d.code === 'REQ_FORMAL_SCHEMA')).toEqual([]);
      expect(result.value[0]?.formal).not.toBeNull();
    }
  });
});

describe('non-TypeScript TDD test fingerprints', () => {
  it('fingerprints an indented block annotation instead of hashing an empty slice', async () => {
    const root = await project();
    await writeText(root, 'tests/BillingTest.php', phpTest);
    const red = await runTddPhase(root, 'red', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    expect(red.valid).toBe(true);
    expect(red.testFingerprint).not.toBe(EMPTY_SHA256);
    expect(red.testFingerprint).toMatch(/^[0-9a-f]{64}$/);

    await writeText(root, 'tests/BillingTest.php', phpTest.replace('assertSame(100', 'assertSame(0'));
    await expect(runTddPhase(root, 'green', 'TEST-EXAMPLE-002', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'))).rejects.toThrow('The test changed after Red');
  });

  it('lists the known keys when a config key is unknown', () => {
    expect(() => parseConfig({ schemaVersion: 1, commands: [{ name: 'test', command: 'php', report: 'x' }] }))
      .toThrow(/Unknown config key command\.report\. Known keys at command are .*testReport/);
  });

  it('keeps loading a valid config unchanged', async () => {
    const root = await project();
    expect((await loadConfig(root)).commands[0]?.name).toBe('test');
    await writeJson(root, '.musubix/config.json', await loadConfig(root));
    expect((await loadConfig(root)).commands[0]?.testReport?.format).toBe('musubix-json');
  });
});

describe('PHP code graph relations', () => {
  it('resolves same-namespace trait composition and grouped use lists as internal imports', async () => {
    const root = await fixture({
      'src/TimestampTrait.php': '<?php\nnamespace App\\Domain;\ntrait TimestampTrait { public function now(): int { return 0; } }\n',
      'src/AuditTrait.php': '<?php\nnamespace App\\Domain;\ntrait AuditTrait { public function audit(): void {} }\n',
      'src/Invoice.php': '<?php\nnamespace App\\Domain;\nuse App\\Domain\\Money;\nfinal class Invoice {\n    use TimestampTrait, AuditTrait;\n}\n',
      'src/Money.php': '<?php\nnamespace App\\Domain;\nfinal class Money {}\n',
    });
    const graph = await indexGraph(root);
    for (const target of ['src/TimestampTrait.php', 'src/AuditTrait.php', 'src/Money.php']) {
      expect(graph.imports).toContainEqual(expect.objectContaining({
        from: 'src/Invoice.php', to: target, kind: 'use', external: false,
      }));
    }
    expect(graph.imports.filter((entry) => entry.from === 'src/Invoice.php' && entry.external)).toEqual([]);
  });

  it('keeps a self-referencing trait declaration out of the import edges', async () => {
    const root = await fixture({
      'src/Solo.php': '<?php\nnamespace App;\ntrait Solo { public function ping(): void {} }\nfinal class Uses { use Solo; }\n',
    });
    const graph = await indexGraph(root);
    expect(graph.imports.filter((entry) => entry.from === 'src/Solo.php')).toEqual([]);
  });
});

describe('TDD output reuse detection', () => {
  it('uses the structured report, not console output, so quiet runners are not false positives', async () => {
    const root = await project();
    await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'failed', { exitCode: 1 }));
    await writeText(root, 'src/service.ts', code.replace('return true', 'return false'));
    await runTddPhase(root, 'green', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test',
      tddResultRunner(root, 'passed'));
    const evidence = JSON.parse(await readText(root, '.musubix/evidence/tdd.json'));
    const [first] = evidence.cycles;
    evidence.cycles.push({
      ...first,
      testId: 'TEST-EXAMPLE-002',
      red: { ...first.red, reportSha256: digest('red-report-002') },
      green: { ...first.green, reportSha256: digest('green-report-002') },
    });
    await writeJson(root, '.musubix/evidence/tdd.json', evidence);
    const quiet = await validateTddEvidence(root);
    expect(quiet.diagnostics.filter((d) => d.code === 'TDD_EVIDENCE_REUSED')).toEqual([]);

    evidence.cycles[1].green.reportSha256 = first.green.reportSha256;
    await writeJson(root, '.musubix/evidence/tdd.json', evidence);
    expect((await validateTddEvidence(root)).diagnostics)
      .toContainEqual(expect.objectContaining({ code: 'TDD_EVIDENCE_REUSED', message: expect.stringContaining('green report evidence') }));
  });
});

describe('mutation doctor PHP guidance', () => {
  it('detects Composer projects and recommends Infection with a coverage driver', async () => {
    const root = await fixture({
      'composer.json': '{"name":"app/app","require-dev":{"phpunit/phpunit":"^11"}}',
      'src/Money.php': '<?php\nnamespace App;\nfinal class Money {}\n',
    });
    const report = await mutationDoctor(root, async () => processResult({ status: 'missing', exitCode: null }));
    const php = report.engines.find((entry) => entry.ecosystem === 'php');
    expect(php).toMatchObject({ engine: 'Infection', status: 'missing' });
    expect(php?.recommendation).toMatch(/Xdebug, PCOV or phpdbg/);
  });
});
