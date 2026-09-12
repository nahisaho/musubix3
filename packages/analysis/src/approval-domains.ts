import { validateRequirements } from '../../domain/src/index.js';
import { matchGlob } from './graph.js';
import type { ApprovalConfig, DomainConfig } from './config.js';
import { files, readText } from './files.js';

export interface ResolvedDomain {
  name: string;
  features: string[];
}

const featureRequirementsPattern = /^\.musubix\/features\/([^/]+)\/requirements\.md$/;
const featureDesignPattern = /^\.musubix\/features\/([^/]+)\/design\.md$/;

export function domainsConfigured(config: ApprovalConfig): boolean {
  return config.domains.length > 0;
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-002
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-002 REQ-APPROVAL-DOMAIN-SCOPING-003 REQ-APPROVAL-DOMAIN-SCOPING-004
 * @design DES-APPROVAL-DOMAIN-SCOPING-002
 */
export async function resolveDomains(root: string, config: ApprovalConfig): Promise<ResolvedDomain[]> {
  const domains = config.domains;
  if (domains.length === 0) return [];
  const slugs = [...new Set((await files(root))
    .map((path) => featureRequirementsPattern.exec(path)?.[1])
    .filter((slug): slug is string => !!slug))].sort();

  const owners = new Map<string, string[]>();
  for (const slug of slugs) {
    const matching = domains.filter((domain: DomainConfig) => domain.featureGlobs.some((glob) => matchGlob(slug, glob)));
    owners.set(slug, matching.map((domain) => domain.name).sort());
  }

  for (const slug of slugs) {
    const matching = owners.get(slug)!;
    if (matching.length === 0) {
      throw new Error(`Feature "${slug}" is not owned by any configured approval domain; every feature directory must match exactly one domain's featureGlobs.`);
    }
    if (matching.length > 1) {
      throw new Error(`Feature "${slug}" matches more than one configured approval domain: ${matching.join(', ')}; every feature directory must match exactly one domain.`);
    }
  }

  const resolved: ResolvedDomain[] = domains.map((domain: DomainConfig) => ({
    name: domain.name,
    features: slugs.filter((slug) => owners.get(slug)![0] === domain.name).sort(),
  }));

  for (const domain of resolved) {
    if (domain.features.length === 0) {
      throw new Error(`Approval domain "${domain.name}" matches zero existing feature directories; remove it or add a matching feature.`);
    }
  }

  return resolved;
}

export function domainOwning(resolved: ResolvedDomain[], slug: string): string | null {
  return resolved.find((domain) => domain.features.includes(slug))?.name ?? null;
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-014
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-016
 * @design DES-APPROVAL-DOMAIN-SCOPING-005
 */
export async function featureOwningRequirement(root: string, requirementId: string): Promise<string> {
  const paths = (await files(root)).filter((path) => featureRequirementsPattern.test(path));
  const owners: string[] = [];
  for (const path of paths) {
    const slug = featureRequirementsPattern.exec(path)![1]!;
    const result = validateRequirements(await readText(root, path), path);
    if (result.value.some((requirement) => requirement.id === requirementId)) owners.push(slug);
  }
  if (owners.length === 0) throw new Error(`Requirement ${requirementId} was not found in any feature's requirements.md.`);
  if (owners.length > 1) throw new Error(`Requirement ${requirementId} is defined in more than one feature: ${owners.join(', ')}.`);
  return owners[0]!;
}

/** @id CODE-APPROVAL-DOMAIN-SCOPING-015
 * @implements REQ-APPROVAL-DOMAIN-SCOPING-017
 * @design DES-APPROVAL-DOMAIN-SCOPING-005
 */
export function featureOwningDesignFile(file: string): string | null {
  const match = featureDesignPattern.exec(file);
  return match ? match[1]! : null;
}
