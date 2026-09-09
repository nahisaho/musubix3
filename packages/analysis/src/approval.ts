import { basename } from 'node:path';
import {
  error, validateConstitution, validateDesign, validateRequirements, type Diagnostic,
} from '../../domain/src/index.js';
import type { ApprovalConfig } from './config.js';
import { digest, exists, files, readText, snapshot, within } from './files.js';

export const approvalStages = ['requirements', 'design', 'release'] as const;
export type ApprovalStage = typeof approvalStages[number];
export type ApprovalStatus = 'approved' | 'missing' | 'stale';

export interface ApprovalManifest {
  stage: ApprovalStage;
  artifacts: Record<string, string>;
  artifactSha256: string;
}

export interface ApprovalEvidence extends ApprovalManifest {
  schemaVersion: 1;
  approver: string;
  approvedAt: string;
}

export interface ApprovalStageValidation {
  stage: ApprovalStage;
  required: boolean;
  present: boolean;
  status: ApprovalStatus;
  evidence: ApprovalEvidence | null;
  currentArtifactSha256: string;
  diagnostics: Diagnostic[];
}

export interface ApprovalValidation {
  schemaVersion: 1;
  mode: ApprovalConfig['mode'];
  present: boolean;
  valid: boolean;
  stages: ApprovalStageValidation[];
  diagnostics: Diagnostic[];
}

function approvalPath(stage: ApprovalStage): string {
  return `.musubix/evidence/approvals/${stage}.json`;
}

function stagePaths(paths: string[], stage: ApprovalStage): string[] {
  const requirements = (path: string): boolean =>
    path === '.musubix/constitution.md' || /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(path);
  if (stage === 'requirements') return paths.filter(requirements).sort();
  if (stage === 'design') {
    return paths.filter((path) =>
      requirements(path)
      || /^\.musubix\/features\/[^/]+\/design\.md$/.test(path)
      || /^\.musubix\/decisions\/ADR-\d+\.md$/.test(path)).sort();
  }
  return paths.filter((path) =>
    !/^\.musubix\/features\/[^/]+\/trace\.json$/.test(path)
    && !path.endsWith('.tgz')
    && !/(?:^|\/)(?:logs?|session-logs)\//.test(path)).sort();
}

/** @id CODE-HUMAN-APPROVAL-GATES-001
 * @implements REQ-HUMAN-APPROVAL-GATES-001 REQ-HUMAN-APPROVAL-GATES-002 REQ-HUMAN-APPROVAL-GATES-003
 * @implements REQ-HUMAN-APPROVAL-GATES-004 REQ-HUMAN-APPROVAL-GATES-005 REQ-HUMAN-APPROVAL-GATES-006
 * @implements REQ-HUMAN-APPROVAL-GATES-007 REQ-HUMAN-APPROVAL-GATES-008
 * @design DES-APPROVAL-001 DES-APPROVAL-002 DES-APPROVAL-003
 */
export async function approvalManifest(root: string, stage: ApprovalStage): Promise<ApprovalManifest> {
  const artifacts = await snapshot(root, stagePaths(await files(root), stage));
  return { stage, artifacts, artifactSha256: digest(JSON.stringify({ stage, artifacts })) };
}

export async function loadApproval(root: string, stage: ApprovalStage): Promise<ApprovalEvidence | null> {
  const path = approvalPath(stage);
  if (!await exists(within(root, path))) return null;
  const value = JSON.parse(await readText(root, path)) as Partial<ApprovalEvidence>;
  if (value.schemaVersion !== 1 || value.stage !== stage
    || typeof value.approver !== 'string' || !value.approver.trim()
    || typeof value.approvedAt !== 'string' || !Number.isFinite(Date.parse(value.approvedAt))
    || typeof value.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.artifactSha256)
    || !value.artifacts || typeof value.artifacts !== 'object' || Array.isArray(value.artifacts)
    || Object.entries(value.artifacts).some(([path, sha256]) => !path || path.startsWith('/')
      || path.includes('\0') || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))) {
    throw new Error(`Invalid ${stage} approval evidence.`);
  }
  return value as ApprovalEvidence;
}

export async function validateApprovalStage(
  root: string,
  stage: ApprovalStage,
  config: ApprovalConfig,
): Promise<ApprovalStageValidation> {
  const current = await approvalManifest(root, stage);
  const present = await exists(within(root, approvalPath(stage)));
  let evidence: ApprovalEvidence | null;
  try {
    evidence = await loadApproval(root, stage);
  } catch (cause) {
    const required = config.mode === 'required';
    const diagnostics = [error(
      'APPROVAL_SCHEMA',
      cause instanceof Error ? cause.message : String(cause),
      approvalPath(stage),
    )];
    return { stage, required, present, status: 'stale', evidence: null, currentArtifactSha256: current.artifactSha256, diagnostics };
  }
  const required = config.mode === 'required';
  if (!evidence) {
    const diagnostics = required
      ? [error('APPROVAL_MISSING', `Current ${stage} approval is required.`, approvalPath(stage))]
      : [];
    return { stage, required, present: false, status: 'missing', evidence: null, currentArtifactSha256: current.artifactSha256, diagnostics };
  }
  const stale = evidence.artifactSha256 !== current.artifactSha256
    || JSON.stringify(evidence.artifacts) !== JSON.stringify(current.artifacts);
  const diagnostics = stale
    ? [error('APPROVAL_STALE', `${stage} approval does not match the current artifact manifest.`, approvalPath(stage))]
    : [];
  return {
    stage,
    required,
    present: true,
    status: stale ? 'stale' : 'approved',
    evidence,
    currentArtifactSha256: current.artifactSha256,
    diagnostics,
  };
}

export async function validateApprovals(root: string, config: ApprovalConfig): Promise<ApprovalValidation> {
  const stages = await Promise.all(approvalStages.map((stage) => validateApprovalStage(root, stage, config)));
  const diagnostics = stages.flatMap((stage) => stage.diagnostics);
  return {
    schemaVersion: 1,
    mode: config.mode,
    present: stages.some((stage) => stage.present),
    valid: diagnostics.length === 0,
    stages,
    diagnostics,
  };
}

/** @id CODE-CLI-WORKFLOW-UX-003
 * @implements REQ-CLI-WORKFLOW-UX-003
 * @design DES-CLI-WORKFLOW-UX-003
 */
export async function requireApproval(root: string, stage: ApprovalStage, config: ApprovalConfig): Promise<void> {
  if (config.mode !== 'required') return;
  const result = await validateApprovalStage(root, stage, config);
  if (result.status !== 'approved') {
    throw new Error(`${stage} approval is ${result.status}; record explicit current approval before continuing. Run \`musubix3 approval validate\` for a full per-stage status.`);
  }
}

export async function validateStageArtifacts(root: string, stage: ApprovalStage): Promise<void> {
  const paths = await files(root);
  const requirementPaths = paths.filter((path) => /^\.musubix\/features\/[^/]+\/requirements\.md$/.test(path));
  if (!requirementPaths.length) throw new Error('Approval requires at least one requirements artifact.');
  const requirementResults = await Promise.all(requirementPaths.map(async (path) =>
    validateRequirements(await readText(root, path), path)));
  const requirementError = requirementResults.flatMap((result) => result.diagnostics)
    .find((diagnostic) => diagnostic.severity === 'error');
  if (requirementError) throw new Error(`Approval requires valid requirements: ${requirementError.message}`);
  if (paths.includes('.musubix/constitution.md')) {
    const constitutionError = validateConstitution(
      await readText(root, '.musubix/constitution.md'),
      '.musubix/constitution.md',
    ).diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (constitutionError) throw new Error(`Approval requires a valid constitution: ${constitutionError.message}`);
  }
  if (stage === 'requirements') return;
  const requirementIds = new Set(requirementResults.flatMap((result) => result.value.map((requirement) => requirement.id)));
  const designPaths = paths.filter((path) => /^\.musubix\/features\/[^/]+\/design\.md$/.test(path));
  if (!designPaths.length) throw new Error('Design approval requires at least one design artifact.');
  const designIds = new Set<string>();
  for (const path of designPaths) {
    for (const component of validateDesign(await readText(root, path), path).value) designIds.add(component.id);
  }
  const adrIds = new Set(paths.filter((path) => /^\.musubix\/decisions\/ADR-\d+\.md$/.test(path))
    .map((path) => basename(path, '.md')));
  for (const path of designPaths) {
    const designError = validateDesign(await readText(root, path), path, { requirementIds, designIds, adrIds })
      .diagnostics.find((diagnostic) => diagnostic.severity === 'error');
    if (designError) throw new Error(`Approval requires valid design: ${designError.message}`);
  }
}
