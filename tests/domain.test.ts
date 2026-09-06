import { describe, expect, it } from 'vitest';
import { c4Diagram, classifyEars, validateConstitution, validateDesign, validateRequirements } from '../packages/domain/src/index.js';
import { readText } from '../packages/analysis/src/index.js';
import { repository, req } from './helpers.js';

describe('controlled EARS', () => {
  it.each([
    ['The system shall report readiness.', 'ubiquitous'],
    ['The system shall not disclose secrets.', 'ubiquitous'],
    ['When the user signs in, the system shall issue a session.', 'event-driven'],
    ['While the alarm is active, the system shall flash the light.', 'state-driven'],
    ['If an error occurs, then the system shall reject the request.', 'unwanted-behavior'],
    ['Where the premium feature is enabled, the system shall export reports.', 'optional-feature'],
    ['While the user is signed in, when a request arrives, the system shall return data.', 'complex'],
    ['Where a feature is enabled, while the service is ready, when an event occurs, the system shall log an event.', 'complex'],
    ['システムは準備状況を表示しなければならない。', 'ubiquitous'],
    ['システムは秘密を記録してはならない。', 'ubiquitous'],
    ['要求が到着したとき、システムは応答しなければならない。', 'event-driven'],
    ['処理が実行中の間、システムは状態を表示しなければならない。', 'state-driven'],
    ['もし異常が発生したならば、システムは停止しなければならない。', 'unwanted-behavior'],
    ['機能が有効な場合、システムは結果を表示しなければならない。', 'optional-feature'],
    ['準備ができている間、要求が到着したとき、システムは応答しなければならない。', 'complex'],
  ])('classifies %s', (statement, pattern) => {
    expect(classifyEars(statement)).toBe(pattern);
    expect(validateRequirements(req(statement)).valid).toBe(true);
  });

  it.each([
    '', 'The system should respond.', 'The system shall.', 'The system shall not.',
    'When, the system shall respond.', 'When an event occurs the system shall respond.',
    'If a fault occurs, the system shall stop.', 'Given a condition, the system shall respond.',
    'When x happens, when y happens, the system shall respond.',
    'The system shall respond. The system shall stop.',
    'システムは便利です。', '何か、システムは応答しなければならない。',
  ])('rejects malformed EARS %s', (statement) => {
    expect(classifyEars(statement)).toBeNull();
  });

  it('validates IDs, priorities, declarations, duplicates and frontmatter', () => {
    const report = validateRequirements(`---\na: [\n---\n${req('The system shall respond.', 'REQ-bad')}\nPriority: invalid\nPattern: complex\n${req()}\n${req()}`);
    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['MARKDOWN_FRONTMATTER', 'REQ_ID', 'REQ_PATTERN', 'DUPLICATE_ID']));
    expect(validateRequirements(req().replace('must', 'invalid')).diagnostics.some((d) => d.code === 'REQ_PRIORITY')).toBe(true);
    expect(validateRequirements(`${req()}\nType: non-functional\n`).value[0]?.type).toBe('non-functional');
    expect(validateRequirements(`${req()}\nType: invalid\n`).diagnostics.some((d) => d.code === 'REQ_TYPE')).toBe(true);
  });

  it('rejects normalized duplicate requirement statements', () => {
    const report = validateRequirements(req('The system shall respond.') + req('  THE system   shall respond! ', 'REQ-EXAMPLE-002'));
    expect(report.valid).toBe(false);
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'REQ_DUPLICATE_STATEMENT' }));
  });

  it('ignores fenced examples and reports missing entries', () => {
    expect(validateRequirements(`\`\`\`markdown\n${req()}\`\`\``).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'REQ_MISSING' })]));
    expect(validateRequirements('---\nversion: 1').valid).toBe(false);
    expect(validateRequirements('---\n- array\n---\n').valid).toBe(false);
    expect(validateRequirements('---\na: 1\na: 2\n---\n').valid).toBe(false);
  });

  it('supports Japanese field labels and defaults priority to mandatory', () => {
    const text = '## REQ-AUTH-001: 認証\n要求: システムは認証しなければならない。\nパターン: ubiquitous\n受入条件: 成功結果を確認する。';
    const report = validateRequirements(text);
    expect(report.valid).toBe(true);
    expect(report.value[0]?.priority).toBe('must');
  });
});

describe('constitution definitions', () => {
  it('accepts bundled versioned measurable principles', async () => {
    const report = validateConstitution(await readText(repository, 'assets/constitution.md'));
    expect(report.valid).toBe(true);
    expect(report.value.rules).toHaveLength(3);
  });

  it.each([
    ['# Empty', 'CONST_RULES_MISSING'],
    ['---\nversion: nope\n---', 'CONST_VERSION'],
    ['---\nversion: 1.0.0\n---\n## PRINC-001: Evidence', 'CONST_EMPTY_PRINCIPLE'],
    ['---\nversion: 1.0.0\n---\n### RULE-001: Orphan\nMetric: trace.errors\nLimit: 0', 'CONST_RULE'],
    ['---\nversion: 1.0.0\n---\n## PRINC-001: Evidence\n### RULE-001: Vague\nMetric: good.quality\nLimit: high', 'CONST_METRIC'],
    ['---\nversion: 1.0.0\n---\n## PRINC-001: Evidence\n### RULE-001: Limit\nMetric: trace.errors\nLimit: -1', 'CONST_LIMIT'],
  ])('rejects invalid policy definitions', (text, code) => {
    const report = validateConstitution(text);
    expect(report.valid).toBe(false);
    expect(report.diagnostics.some((d) => d.code === code)).toBe(true);
  });
});

describe('explicit designs', () => {
  it('validates fields, requirements and ADR references with context', async () => {
    const text = await readText(repository, 'assets/design.md');
    expect(validateDesign(text, 'design.md', { requirementIds: new Set(['REQ-EXAMPLE-001']), adrIds: new Set(['ADR-0001']) }).valid).toBe(true);
    const missing = validateDesign(text, 'design.md', { requirementIds: new Set(), adrIds: new Set() });
    expect(missing.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['DES_REQUIREMENT_LINK', 'DES_ADR_LINK']));
  });

  it('rejects missing and placeholder fields, IDs and absent links', () => {
    const report = validateDesign('## DES-bad: Bad\nResponsibilities: TODO\n');
    expect(report.valid).toBe(false);
    expect(report.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['DES_ID', 'DES_FIELD', 'DES_REQUIREMENTS', 'DES_ADR']));
    expect(validateDesign('# Design prose').valid).toBe(false);
  });

  it('generates deterministic diagrams only from explicit components', async () => {
    const text = (await readText(repository, 'assets/design.md')).replace('Depends-On: none', 'Depends-On: DES-EXAMPLE-002');
    const components = validateDesign(text).value;
    const diagram = c4Diagram(components);
    expect(diagram).toContain('DES_EXAMPLE_001 --> DES_EXAMPLE_002');
    expect(diagram).not.toContain('REQ_EXAMPLE');
    expect(c4Diagram(components)).toBe(diagram);
    expect(c4Diagram([{ ...components[0]!, title: '"] --> evil["' }])).not.toContain('[""] --> evil');
  });
});
