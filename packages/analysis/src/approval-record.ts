import type { ApprovalConfig } from './config.js';
import {
  approvalManifest, approvalPath, domainsConfigured, fastReapprovalEligibility, loadApproval, requireApproval,
  requireDomainOption, resolveDomains, validateStageArtifacts,
  type ApprovalEvidence, type ApprovalStage, type ResolvedDomain,
} from './approval.js';
import { writeJson } from './files.js';
import { runGate } from './gate.js';
import { withEvidenceWriterLock } from './evidence-writer-lock.js';

/** @id CODE-HUMAN-APPROVAL-GATES-002
 * @implements REQ-HUMAN-APPROVAL-GATES-001 REQ-HUMAN-APPROVAL-GATES-006
 * @design DES-APPROVAL-002 DES-APPROVAL-003
 */
/** @id CODE-APPROVAL-DOMAIN-SCOPING-016
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-005 REQ-APPROVAL-DOMAIN-SCOPING-006 REQ-APPROVAL-DOMAIN-SCOPING-007
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-013 REQ-APPROVAL-DOMAIN-SCOPING-014 REQ-APPROVAL-DOMAIN-SCOPING-015
 * @design DES-APPROVAL-DOMAIN-SCOPING-004
 */
export async function recordApproval(
  root: string,
  stage: ApprovalStage,
  approver: string,
  expectedArtifactSha256: string,
  config: ApprovalConfig,
  domainName?: string,
): Promise<ApprovalEvidence> {
  return withEvidenceWriterLock(root, 'approval record', () =>
    recordApprovalUnlocked(root, stage, approver, expectedArtifactSha256, config, domainName));
}

/** @id CODE-APPROVAL-REBASE-FAST-REAPPROVAL-002
 * @implements REQ-APPROVAL-REBASE-FAST-REAPPROVAL-007
 * @design DES-APPROVAL-REBASE-FAST-REAPPROVAL-002
 */
// Shared by recordApprovalUnlocked (unchanged behavior/position) and
// recordFastReapproval. Deliberately stops short of manifest computation and
// the empty-manifest/hash-match checks: those stay literal, unmoved statements
// in recordApprovalUnlocked, and are duplicated verbatim in recordFastReapproval,
// so neither path's statement order/count can silently diverge from the other.
async function validateRecordPreconditions(
  root: string,
  stage: ApprovalStage,
  approver: string,
  expectedArtifactSha256: string,
  config: ApprovalConfig,
  domainName?: string,
): Promise<{ normalizedApprover: string; domain: ResolvedDomain | undefined }> {
  const normalizedApprover = approver.trim();
  if (!normalizedApprover || normalizedApprover.includes('\0')) {
    throw new Error('Approver must be a nonempty name without NUL bytes.');
  }
  if (!/^[a-f0-9]{64}$/.test(expectedArtifactSha256)) {
    throw new Error('Expected approval artifact SHA-256 must be 64 lowercase hexadecimal characters.');
  }
  requireDomainOption(config, stage, domainName);
  const resolved = domainsConfigured(config) ? await resolveDomains(root, config) : [];
  const domain: ResolvedDomain | undefined = domainName ? resolved.find((d) => d.name === domainName) : undefined;
  await validateStageArtifacts(root, stage, domain);
  const requiredApproval: ApprovalConfig = { mode: 'required', domains: [] };
  if (stage === 'design') {
    await requireApproval(root, 'requirements', requiredApproval, domain);
  }
  if (stage === 'release') {
    for (const d of resolved) {
      await requireApproval(root, 'requirements', requiredApproval, d);
      await requireApproval(root, 'design', requiredApproval, d);
    }
    if (!resolved.length) await requireApproval(root, 'design', requiredApproval);
    const quality = await runGate(root);
    const blockers = quality.checks.filter((check) =>
      check.name !== 'approval' && check.required && check.status !== 'pass');
    if (blockers.length) {
      throw new Error(`Release approval requires passing non-approval quality checks: ${blockers.map((check) => check.name).join(', ')}.`);
    }
  }
  return { normalizedApprover, domain };
}

async function recordApprovalUnlocked(
  root: string,
  stage: ApprovalStage,
  approver: string,
  expectedArtifactSha256: string,
  config: ApprovalConfig,
  domainName?: string,
): Promise<ApprovalEvidence> {
  const { normalizedApprover, domain } = await validateRecordPreconditions(
    root, stage, approver, expectedArtifactSha256, config, domainName);
  const manifest = await approvalManifest(root, stage, domain);
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
  await writeJson(root, approvalPath(stage, domainName), evidence);
  return evidence;
}

/** @id CODE-APPROVAL-REBASE-FAST-REAPPROVAL-003
 * @implements REQ-APPROVAL-REBASE-FAST-REAPPROVAL-001 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-002
 * @implements REQ-APPROVAL-REBASE-FAST-REAPPROVAL-003 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-004
 * @implements REQ-APPROVAL-REBASE-FAST-REAPPROVAL-005 REQ-APPROVAL-REBASE-FAST-REAPPROVAL-006
 * @implements REQ-APPROVAL-REBASE-FAST-REAPPROVAL-007
 * @design DES-APPROVAL-REBASE-FAST-REAPPROVAL-002
 */
export async function recordFastReapproval(
  root: string,
  stage: ApprovalStage,
  approver: string,
  expectedArtifactSha256: string,
  ownFiles: string[],
  config: ApprovalConfig,
  domainName?: string,
): Promise<ApprovalEvidence> {
  return withEvidenceWriterLock(root, 'approval record', () =>
    recordFastReapprovalUnlocked(root, stage, approver, expectedArtifactSha256, ownFiles, config, domainName));
}

async function recordFastReapprovalUnlocked(
  root: string,
  stage: ApprovalStage,
  approver: string,
  expectedArtifactSha256: string,
  ownFiles: string[],
  config: ApprovalConfig,
  domainName?: string,
): Promise<ApprovalEvidence> {
  const { normalizedApprover, domain } = await validateRecordPreconditions(
    root, stage, approver, expectedArtifactSha256, config, domainName);
  // Steps 1-7 below follow DES-APPROVAL-REBASE-FAST-REAPPROVAL-002's fixed
  // check order exactly, so each REQ-002/003/004/005 scenario (which varies
  // exactly one condition at a time) deterministically surfaces its own error.
  const manifest = await approvalManifest(root, stage, domain); // (1)
  if (!Object.keys(manifest.artifacts).length) throw new Error(`No artifacts are available for ${stage} approval.`);
  const previous = await loadApproval(root, stage, domainName); // (2)
  if (!previous) throw new Error(`No prior ${stage} approval exists to fast-reapprove against.`);
  if (!ownFiles.length) throw new Error('--own-files must list at least one path.'); // (3)
  const knownPaths = new Set([...Object.keys(previous.artifacts), ...Object.keys(manifest.artifacts)]);
  const unknownOwnFiles = ownFiles.filter((path) => !knownPaths.has(path)); // (4)
  if (unknownOwnFiles.length) {
    throw new Error(`--own-files lists unrecognized path(s): ${unknownOwnFiles.join(', ')}.`);
  }
  if (normalizedApprover !== previous.approver) { // (5)
    throw new Error(`Fast re-approval requires the original approver (${previous.approver}).`);
  }
  if (manifest.artifactSha256 !== expectedArtifactSha256) { // (6)
    throw new Error(`Approval artifact manifest changed: expected ${expectedArtifactSha256}, current ${manifest.artifactSha256}. Review the current manifest before approving.`);
  }
  const eligibility = fastReapprovalEligibility(previous, manifest, ownFiles); // (7)
  if (!eligibility.eligible) {
    // 'no-own-files'/'unknown-own-files' are already rejected above by steps
    // (3)/(4); only 'own-files-changed' can reach here.
    const summary = (eligibility as { changes: { path: string; change: 'added' | 'modified' | 'deleted' }[] }).changes
      .map((change) => `${change.path} (${change.change === 'deleted' ? 'removed' : change.change})`)
      .join(', ');
    throw new Error(`Fast re-approval rejected: own file(s) changed: ${summary}.`);
  }
  const evidence: ApprovalEvidence = {
    schemaVersion: 1,
    ...manifest,
    approver: previous.approver,
    approvedAt: new Date().toISOString(),
    fastReapproval: true,
    priorArtifactSha256: previous.artifactSha256,
  };
  await writeJson(root, approvalPath(stage, domainName), evidence);
  return evidence;
}
