import { basename } from 'node:path';
import {
  error, validateConstitution, validateDesign, validateRequirements, type Diagnostic,
} from '../../domain/src/index.js';
import type { ApprovalConfig } from './config.js';
import { digest, exists, files, readText, snapshot, within } from './files.js';
import {
  domainOwning, domainsConfigured, featureOwningDesignFile, featureOwningRequirement, resolveDomains,
  type ResolvedDomain,
} from './approval-domains.js';

export {
  domainsConfigured, domainOwning, featureOwningDesignFile, featureOwningRequirement, resolveDomains,
  type ResolvedDomain,
} from './approval-domains.js';

export const approvalStages = ['requirements', 'design', 'release'] as const;
export type ApprovalStage = typeof approvalStages[number];
export type ApprovalStatus = 'approved' | 'missing' | 'stale';

export interface ApprovalManifest {
  stage: ApprovalStage;
  domain?: string;
  features?: string[];
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
  domain?: string;
  required: boolean;
  present: boolean;
  status: ApprovalStatus;
  evidence: ApprovalEvidence | null;
  currentArtifactSha256: string;
  diagnostics: Diagnostic[];
}

export interface DomainApprovalValidation {
  name: string;
  stages: ApprovalStageValidation[];
}

export interface ApprovalValidation {
  schemaVersion: 1;
  mode: ApprovalConfig['mode'];
  present: boolean;
  valid: boolean;
  stages: ApprovalStageValidation[];
  domain?: string;
  domains?: DomainApprovalValidation[];
  release?: ApprovalStageValidation;
  diagnostics: Diagnostic[];
}

export function approvalPath(stage: ApprovalStage, domain?: string): string {
  return domain ? `.musubix/evidence/approvals/domains/${domain}/${stage}.json` : `.musubix/evidence/approvals/${stage}.json`;
}

const featureRequirementsPattern = /^\.musubix\/features\/([^/]+)\/requirements\.md$/;
const featureDesignPattern = /^\.musubix\/features\/([^/]+)\/design\.md$/;

function stagePaths(paths: string[], stage: ApprovalStage): string[] {
  const requirements = (path: string): boolean =>
    path === '.musubix/constitution.md' || featureRequirementsPattern.test(path);
  if (stage === 'requirements') return paths.filter(requirements).sort();
  if (stage === 'design') {
    return paths.filter((path) =>
      requirements(path)
      || featureDesignPattern.test(path)
      || /^\.musubix\/decisions\/ADR-\d+\.md$/.test(path)).sort();
  }
  return paths.filter((path) =>
    !/^\.musubix\/features\/[^/]+\/trace\.json$/.test(path)
    && !path.endsWith('.tgz')
    && !/(?:^|\/)(?:logs?|session-logs)\//.test(path)).sort();
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-003
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-011 REQ-APPROVAL-DOMAIN-SCOPING-012
 * @design DES-APPROVAL-DOMAIN-SCOPING-003
 */
async function domainStagePaths(root: string, stage: 'requirements' | 'design', domain: ResolvedDomain): Promise<string[]> {
  const allPaths = await files(root);
  const owns = (slug: string): boolean => domain.features.includes(slug);
  const base = allPaths.filter((path) => {
    if (path === '.musubix/constitution.md') return true;
    const slug = featureRequirementsPattern.exec(path)?.[1];
    return slug !== undefined && owns(slug);
  });
  if (stage === 'requirements') return base.sort();
  const designPaths = allPaths.filter((path) => {
    const slug = featureDesignPattern.exec(path)?.[1];
    return slug !== undefined && owns(slug);
  });
  const adrIds = new Set<string>();
  for (const path of designPaths) {
    for (const component of validateDesign(await readText(root, path), path).value) {
      for (const id of component.decisions) adrIds.add(id);
    }
  }
  const adrPaths = allPaths.filter((path) => /^\.musubix\/decisions\/ADR-\d+\.md$/.test(path) && adrIds.has(basename(path, '.md')));
  return [...base, ...designPaths, ...adrPaths].sort();
}

/** @id CODE-HUMAN-APPROVAL-GATES-001
 * @implements REQ-HUMAN-APPROVAL-GATES-001 REQ-HUMAN-APPROVAL-GATES-002 REQ-HUMAN-APPROVAL-GATES-003
 * @implements REQ-HUMAN-APPROVAL-GATES-004 REQ-HUMAN-APPROVAL-GATES-005 REQ-HUMAN-APPROVAL-GATES-006
 * @implements REQ-HUMAN-APPROVAL-GATES-007 REQ-HUMAN-APPROVAL-GATES-008
 * @design DES-APPROVAL-001 DES-APPROVAL-002 DES-APPROVAL-003
 */
/** @id CODE-APPROVAL-DOMAIN-SCOPING-007
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-011 REQ-APPROVAL-DOMAIN-SCOPING-012 REQ-APPROVAL-DOMAIN-SCOPING-013
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-014 REQ-APPROVAL-DOMAIN-SCOPING-023 REQ-APPROVAL-DOMAIN-SCOPING-024
 * @design DES-APPROVAL-DOMAIN-SCOPING-003
 */
export async function approvalManifest(root: string, stage: ApprovalStage, domain?: ResolvedDomain): Promise<ApprovalManifest> {
  if (domain && stage !== 'release') {
    const artifacts = await snapshot(root, await domainStagePaths(root, stage, domain));
    return {
      stage,
      domain: domain.name,
      features: domain.features,
      artifacts,
      artifactSha256: digest(JSON.stringify({ stage, domain: domain.name, features: domain.features, artifacts })),
    };
  }
  const artifacts = await snapshot(root, stagePaths(await files(root), stage));
  return { stage, artifacts, artifactSha256: digest(JSON.stringify({ stage, artifacts })) };
}

export async function loadApproval(root: string, stage: ApprovalStage, domain?: string): Promise<ApprovalEvidence | null> {
  const path = approvalPath(stage, domain);
  if (!await exists(within(root, path))) return null;
  const value = JSON.parse(await readText(root, path)) as Partial<ApprovalEvidence>;
  if (value.schemaVersion !== 1 || value.stage !== stage
    || typeof value.approver !== 'string' || !value.approver.trim()
    || typeof value.approvedAt !== 'string' || !Number.isFinite(Date.parse(value.approvedAt))
    || typeof value.artifactSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.artifactSha256)
    || !value.artifacts || typeof value.artifacts !== 'object' || Array.isArray(value.artifacts)
    || Object.entries(value.artifacts).some(([path, sha256]) => !path || path.startsWith('/')
      || path.includes('\0') || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))
    || (domain !== undefined && (value.domain !== domain || !Array.isArray(value.features) || value.features.some((f) => typeof f !== 'string')))) {
    throw new Error(`Invalid ${stage} approval evidence.`);
  }
  return value as ApprovalEvidence;
}

export async function validateApprovalStage(
  root: string,
  stage: ApprovalStage,
  config: ApprovalConfig,
  domain?: ResolvedDomain,
): Promise<ApprovalStageValidation> {
  const current = await approvalManifest(root, stage, domain);
  const path = approvalPath(stage, domain?.name);
  const present = await exists(within(root, path));
  let evidence: ApprovalEvidence | null;
  try {
    evidence = await loadApproval(root, stage, domain?.name);
  } catch (cause) {
    const required = config.mode === 'required';
    const diagnostics = [error(
      'APPROVAL_SCHEMA',
      cause instanceof Error ? cause.message : String(cause),
      path,
    )];
    return { stage, ...(domain ? { domain: domain.name } : {}), required, present, status: 'stale', evidence: null, currentArtifactSha256: current.artifactSha256, diagnostics };
  }
  const required = config.mode === 'required';
  if (!evidence) {
    const diagnostics = required
      ? [error('APPROVAL_MISSING', `Current ${stage} approval is required.`, path)]
      : [];
    return { stage, ...(domain ? { domain: domain.name } : {}), required, present: false, status: 'missing', evidence: null, currentArtifactSha256: current.artifactSha256, diagnostics };
  }
  const stale = evidence.artifactSha256 !== current.artifactSha256
    || JSON.stringify(evidence.artifacts) !== JSON.stringify(current.artifacts);
  const diagnostics = stale
    ? [error('APPROVAL_STALE', `${stage} approval does not match the current artifact manifest.`, path)]
    : [];
  return {
    stage,
    ...(domain ? { domain: domain.name } : {}),
    required,
    present: true,
    status: stale ? 'stale' : 'approved',
    evidence,
    currentArtifactSha256: current.artifactSha256,
    diagnostics,
  };
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-004
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-008 REQ-APPROVAL-DOMAIN-SCOPING-021 REQ-APPROVAL-DOMAIN-SCOPING-022
 * @design DES-APPROVAL-DOMAIN-SCOPING-004
 */
export async function validateApprovals(root: string, config: ApprovalConfig): Promise<ApprovalValidation> {
  if (!domainsConfigured(config)) {
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
  const resolved = await resolveDomains(root, config);
  const domains = await Promise.all(resolved.map(async (domain): Promise<DomainApprovalValidation> => ({
    name: domain.name,
    stages: await Promise.all((['requirements', 'design'] as const).map((stage) => validateApprovalStage(root, stage, config, domain))),
  })));
  const release = await validateApprovalStage(root, 'release', config);
  const diagnostics = [...domains.flatMap((d) => d.stages.flatMap((s) => s.diagnostics)), ...release.diagnostics];
  return {
    schemaVersion: 1,
    mode: config.mode,
    present: domains.some((d) => d.stages.some((s) => s.present)) || release.present,
    valid: diagnostics.length === 0,
    stages: [],
    domains,
    release,
    diagnostics,
  };
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-008
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-009 REQ-APPROVAL-DOMAIN-SCOPING-010
 * @design DES-APPROVAL-DOMAIN-SCOPING-004
 */
export async function validateApprovalsForDomain(root: string, config: ApprovalConfig, domainName: string): Promise<ApprovalValidation> {
  const resolved = await resolveDomains(root, config);
  const domain = resolved.find((d) => d.name === domainName);
  if (!domain) {
    throw new Error(`Unknown approval domain "${domainName}"; configured domains: ${config.domains.map((d) => d.name).join(', ')}.`);
  }
  const stages = await Promise.all((['requirements', 'design'] as const).map((stage) => validateApprovalStage(root, stage, config, domain)));
  const diagnostics = stages.flatMap((s) => s.diagnostics);
  return {
    schemaVersion: 1,
    mode: config.mode,
    present: stages.some((s) => s.present),
    valid: diagnostics.length === 0,
    stages: [],
    domain: domainName,
    domains: [{ name: domainName, stages }],
    diagnostics,
  };
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-006
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-019 REQ-APPROVAL-DOMAIN-SCOPING-020
 * @design DES-APPROVAL-DOMAIN-SCOPING-006
 */
export async function validateApprovalsForFeatureGate(root: string, config: ApprovalConfig, domainName: string): Promise<ApprovalValidation> {
  const base = await validateApprovalsForDomain(root, config, domainName);
  const release = await validateApprovalStage(root, 'release', config);
  const diagnostics = [...base.diagnostics, ...release.diagnostics];
  return { ...base, release, diagnostics, valid: diagnostics.length === 0 };
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-009
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-005 REQ-APPROVAL-DOMAIN-SCOPING-006 REQ-APPROVAL-DOMAIN-SCOPING-007
 * @design DES-APPROVAL-DOMAIN-SCOPING-004
 */
export function requireDomainOption(config: ApprovalConfig, stage: ApprovalStage, domain: string | undefined): void {
  if (stage === 'release') {
    if (domain !== undefined) throw new Error('The release stage is always repository-wide; --domain is not accepted for release.');
    return;
  }
  if (domainsConfigured(config)) {
    if (domain === undefined) {
      throw new Error(`--domain is required for the ${stage} stage because approval.domains is configured; configured domains: ${config.domains.map((d) => d.name).join(', ')}.`);
    }
    if (!config.domains.some((d) => d.name === domain)) {
      throw new Error(`Unknown approval domain "${domain}"; configured domains: ${config.domains.map((d) => d.name).join(', ')}.`);
    }
  } else if (domain !== undefined) {
    throw new Error('--domain is not accepted because approval.domains is not configured.');
  }
}

export function requireValidateDomainOption(config: ApprovalConfig, domain: string | undefined): void {
  if (!domainsConfigured(config)) {
    if (domain !== undefined) throw new Error('--domain is not accepted because approval.domains is not configured.');
    return;
  }
  if (domain !== undefined && !config.domains.some((d) => d.name === domain)) {
    throw new Error(`Unknown approval domain "${domain}"; configured domains: ${config.domains.map((d) => d.name).join(', ')}.`);
  }
}

/** @id CODE-CLI-WORKFLOW-UX-003
 * @implements REQ-CLI-WORKFLOW-UX-003
 * @design DES-CLI-WORKFLOW-UX-003
 */
/** @id CODE-APPROVAL-DOMAIN-SCOPING-005
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-016 REQ-APPROVAL-DOMAIN-SCOPING-017 REQ-APPROVAL-DOMAIN-SCOPING-018
 * @design DES-APPROVAL-DOMAIN-SCOPING-005
 */
export async function requireApproval(root: string, stage: ApprovalStage, config: ApprovalConfig, domain?: ResolvedDomain): Promise<void> {
  if (config.mode !== 'required') return;
  const result = await validateApprovalStage(root, stage, config, domain);
  if (result.status !== 'approved') {
    const scope = domain ? ` for domain "${domain.name}"` : '';
    throw new Error(`${stage} approval${scope} is ${result.status}; record explicit current approval before continuing. Run \`musubix3 approval validate\` for a full per-stage status.`);
  }
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-010
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-016 REQ-APPROVAL-DOMAIN-SCOPING-017 REQ-APPROVAL-DOMAIN-SCOPING-018
 * @design DES-APPROVAL-DOMAIN-SCOPING-005
 */
export async function resolveOwningDomainOrThrow(root: string, config: ApprovalConfig, slug: string): Promise<ResolvedDomain | undefined> {
  if (!domainsConfigured(config)) return undefined;
  const resolved = await resolveDomains(root, config);
  const name = domainOwning(resolved, slug);
  if (!name) {
    throw new Error(`Feature "${slug}" is not owned by any configured approval domain.`);
  }
  return resolved.find((d) => d.name === name);
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-011
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-005 REQ-APPROVAL-DOMAIN-SCOPING-013
 * @design DES-APPROVAL-DOMAIN-SCOPING-004
 */
export async function resolveNamedDomain(root: string, config: ApprovalConfig, domainName: string): Promise<ResolvedDomain> {
  const resolved = await resolveDomains(root, config);
  const domain = resolved.find((d) => d.name === domainName);
  if (!domain) {
    throw new Error(`Unknown approval domain "${domainName}"; configured domains: ${config.domains.map((d) => d.name).join(', ')}.`);
  }
  return domain;
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-012
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-017
 * @design DES-APPROVAL-DOMAIN-SCOPING-005
 */
export async function resolveDesignFileDomain(root: string, config: ApprovalConfig, file: string): Promise<ResolvedDomain | undefined> {
  if (!domainsConfigured(config)) return undefined;
  const slug = featureOwningDesignFile(file);
  if (!slug) throw new Error(`${file} is outside every configured approval domain; design validate/c4 requires a path of the form .musubix/features/<slug>/design.md.`);
  return resolveOwningDomainOrThrow(root, config, slug);
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-013
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-016
 * @design DES-APPROVAL-DOMAIN-SCOPING-005
 */
export async function resolveRequirementDomain(root: string, config: ApprovalConfig, requirementId: string): Promise<ResolvedDomain | undefined> {
  if (!domainsConfigured(config)) return undefined;
  const slug = await featureOwningRequirement(root, requirementId);
  return resolveOwningDomainOrThrow(root, config, slug);
}

export async function validateStageArtifacts(root: string, stage: ApprovalStage, domain?: ResolvedDomain): Promise<void> {
  const paths = await files(root);
  const owns = (slug: string): boolean => !domain || domain.features.includes(slug);
  const requirementPaths = paths.filter((path) => {
    const slug = featureRequirementsPattern.exec(path)?.[1];
    return slug !== undefined && owns(slug);
  });
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
  const designPaths = paths.filter((path) => {
    const slug = featureDesignPattern.exec(path)?.[1];
    return slug !== undefined && owns(slug);
  });
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
