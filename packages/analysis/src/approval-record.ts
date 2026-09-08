import type { ApprovalConfig } from './config.js';
import {
  approvalManifest, requireApproval, validateStageArtifacts,
  type ApprovalEvidence, type ApprovalStage,
} from './approval.js';
import { writeJson } from './files.js';
import { runGate } from './gate.js';

/** @id CODE-HUMAN-APPROVAL-GATES-002
 * @implements REQ-HUMAN-APPROVAL-GATES-001 REQ-HUMAN-APPROVAL-GATES-006
 * @design DES-APPROVAL-002 DES-APPROVAL-003
 */
export async function recordApproval(
  root: string,
  stage: ApprovalStage,
  approver: string,
  expectedArtifactSha256: string,
): Promise<ApprovalEvidence> {
  const normalizedApprover = approver.trim();
  if (!normalizedApprover || normalizedApprover.includes('\0')) {
    throw new Error('Approver must be a nonempty name without NUL bytes.');
  }
  if (!/^[a-f0-9]{64}$/.test(expectedArtifactSha256)) {
    throw new Error('Expected approval artifact SHA-256 must be 64 lowercase hexadecimal characters.');
  }
  await validateStageArtifacts(root, stage);
  const requiredApproval: ApprovalConfig = { mode: 'required' };
  if (stage === 'design' || stage === 'release') await requireApproval(root, 'requirements', requiredApproval);
  if (stage === 'release') {
    await requireApproval(root, 'design', requiredApproval);
    const quality = await runGate(root);
    const blockers = quality.checks.filter((check) =>
      check.name !== 'approval' && check.required && check.status !== 'pass');
    if (blockers.length) {
      throw new Error(`Release approval requires passing non-approval quality checks: ${blockers.map((check) => check.name).join(', ')}.`);
    }
  }
  const manifest = await approvalManifest(root, stage);
  if (!Object.keys(manifest.artifacts).length) throw new Error(`No artifacts are available for ${stage} approval.`);
  if (manifest.artifactSha256 !== expectedArtifactSha256) {
    throw new Error(`Approval artifact manifest changed: expected ${expectedArtifactSha256}, current ${manifest.artifactSha256}. Review the current manifest before approving.`);
  }
  const evidence: ApprovalEvidence = {
    schemaVersion: 1,
    ...manifest,
    approver: normalizedApprover,
    approvedAt: new Date().toISOString(),
  };
  await writeJson(root, `.musubix/evidence/approvals/${stage}.json`, evidence);
  return evidence;
}
