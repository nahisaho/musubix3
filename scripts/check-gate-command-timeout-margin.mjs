import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EXPECTED_REQUIRED_CHECKS = [
  'requirements',
  'design',
  'constitution',
  'trace',
  'graph',
  'commands',
];

const EXPECTED_TEST_TIMEOUT_MS = 305000;

const EXPECTED_REQUIRED_COMMANDS = [
  'requirements-design-scaffold-tests',
  'approval-tests',
  'approval-domain-scoping-tests',
  'typecheck',
  'build',
  'session-tests',
  'test',
  'pack-check',
  'pack-smoke',
  'cli-workflow-ux-tests',
  'tdd-fingerprint-scoping-tests',
  'tdd-fingerprint-migration-tests',
  'tdd-superseded-cycle-scoping-tests',
  'tdd-cycle-void-tests',
  'change-requirement-batches-tests',
  'change-quality-refresh-tests',
  'windows-core-portability-tests',
  'change-record-fail-fast-tests',
  'change-acceptance-heuristic-tests',
  'change-evidence-waiver-tests',
  'evidence-history-merge-tests',
  'workflow-evidence-waiver-tests',
  'workflow-waiver-bulk-recording-tests',
  'tdd-green-requirement-scoping-tests',
  'ears-id-diagnostic-messages-tests',
  'adapter-pattern-recognition-tests',
  'workflow-multi-session-verification-tests',
  'workflow-session-shutdown-tests',
  'tdd-red-collection-guidance-tests',
  'bounded-file-read-concurrency-tests',
  'attestation-evidence-stability-tests',
  'change-record-recordedat-order-tests',
  'upgrade-workflow-tests',
  'model-correspondence-evidence-guidance-tests',
  'tdd-adoption-warning-tests',
  'evidence-writer-lock-tests',
  'release-version-synchronization-tests',
  'release-approval-ordering-tests',
  'github-actions-node24-runtime-tests',
  'npm-audit-remediation-tests',
  'release-asset-publishing-tests',
];

function diagnostic(message, path) {
  return { code: 'GATE_COMMAND_TIMEOUT_MARGIN', message, path };
}

function numericField(source, name) {
  const match = new RegExp(`${name}:\\s*([\\d_]+)`).exec(source);
  return match ? Number(match[1].replaceAll('_', '')) : null;
}

function constitutionLimit(source, ruleId) {
  const match = new RegExp(`### ${ruleId}:[\\s\\S]*?Limit:\\s*(\\d+)`).exec(source);
  return match ? Number(match[1]) : null;
}

/** @id CODE-GATE-COMMAND-TIMEOUT-MARGIN-001
 * @implements REQ-GATE-COMMAND-TIMEOUT-MARGIN-001
 * @design DES-GATE-COMMAND-TIMEOUT-MARGIN-001 DES-GATE-COMMAND-TIMEOUT-MARGIN-002
 */
export function checkGateCommandTimeoutMargin(root = '.') {
  const configPath = resolve(root, '.musubix/config.json');
  const constitutionPath = resolve(root, '.musubix/constitution.md');
  const vitestPath = resolve(root, 'vitest.config.ts');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const constitution = readFileSync(constitutionPath, 'utf8');
  const vitest = readFileSync(vitestPath, 'utf8');
  const diagnostics = [];
  const commands = Array.isArray(config.commands) ? config.commands : [];
  const test = commands.find((command) => command?.name === 'test');

  if (test?.timeoutMs !== EXPECTED_TEST_TIMEOUT_MS) {
    diagnostics.push(diagnostic(
      `The required test command timeoutMs must be ${EXPECTED_TEST_TIMEOUT_MS}.`,
      configPath,
    ));
  }
  if (test?.command !== 'npm' || JSON.stringify(test?.args) !== JSON.stringify(['test']) || test?.required !== true) {
    diagnostics.push(diagnostic('The test command must remain required npm [\"test\"].', configPath));
  }
  const packSmoke = commands.find((command) => command?.name === 'pack-smoke');
  if (packSmoke?.timeoutMs !== 180000) {
    diagnostics.push(diagnostic('The pack-smoke timeoutMs must remain 180000.', configPath));
  }
  if (JSON.stringify(config.requiredChecks) !== JSON.stringify(EXPECTED_REQUIRED_CHECKS)) {
    diagnostics.push(diagnostic('requiredChecks changed from the reviewed set.', configPath));
  }
  const requiredCommands = commands
    .filter((command) => command?.required === true)
    .map((command) => command.name)
    .sort();
  if (JSON.stringify(requiredCommands) !== JSON.stringify([...EXPECTED_REQUIRED_COMMANDS].sort())) {
    diagnostics.push(diagnostic('The required command-name set changed.', configPath));
  }
  for (const ruleId of ['RULE-002', 'RULE-003']) {
    if (constitutionLimit(constitution, ruleId) !== 0) {
      diagnostics.push(diagnostic(`${ruleId} must retain limit 0.`, constitutionPath));
    }
  }
  if (!/include:\s*\[\s*(['"])tests\/\*\*\/\*\.test\.ts\1\s*\]/.test(vitest)) {
    diagnostics.push(diagnostic('Vitest include must remain tests/**/*.test.ts.', vitestPath));
  }
  if (numericField(vitest, 'testTimeout') !== 20000) {
    diagnostics.push(diagnostic('Vitest testTimeout must remain 20000.', vitestPath));
  }
  if (numericField(vitest, 'maxWorkers') !== 2) {
    diagnostics.push(diagnostic('Vitest maxWorkers must remain 2.', vitestPath));
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const report = checkGateCommandTimeoutMargin(process.env.GATE_COMMAND_TIMEOUT_MARGIN_ROOT ?? '.');
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.valid) process.exitCode = 1;
}
