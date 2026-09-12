import { describe, expect, it } from 'vitest';
import * as analysis from '../packages/analysis/src/index.js';
import { install } from '../packages/cli/src/install.js';
import { fixture, project, repository, tddResultRunner } from './helpers.js';

const {
  approvalManifest, domainOwning, domainsConfigured, featureOwningRequirement,
  loadApproval, loadConfig, parseConfig, readText, recordApproval, requireApproval, requireDomainOption,
  requireValidateDomainOption, resolveDesignFileDomain, resolveDomains, resolveNamedDomain, resolveRequirementDomain,
  runGate, runTddPhase, validateApprovals, validateApprovalsForDomain, validateApprovalsForFeatureGate,
  writeJson, writeText,
} = analysis;

/** Adds a second feature ("other") to a `project()` fixture, then configures
 * `approval.domains` to split "example" and "other" into two named domains. */
async function twoDomainProject(): Promise<string> {
  const root = await project();
  await install(root, repository, { feature: 'other' });
  const config = await loadConfig(root);
  config.approval = {
    mode: 'required',
    domains: [
      { name: 'domain-a', featureGlobs: ['example'] },
      { name: 'domain-b', featureGlobs: ['other'] },
    ],
  };
  await writeJson(root, '.musubix/config.json', config);
  return root;
}

async function approveDomain(root: string, stage: 'requirements' | 'design', domainName: string) {
  const config = await loadConfig(root);
  const domain = await resolveNamedDomain(root, config.approval, domainName);
  const manifest = await approvalManifest(root, stage, domain);
  return recordApproval(root, stage, `${domainName} reviewer`, manifest.artifactSha256, config.approval, domainName);
}

async function approveRepoWide(root: string, stage: 'requirements' | 'design' | 'release', approver: string) {
  const config = await loadConfig(root);
  const manifest = await approvalManifest(root, stage);
  return recordApproval(root, stage, approver, manifest.artifactSha256, config.approval);
}

describe('approval domain scoping (config, REQ-001)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-001
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-001
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-001 accepts well-formed domains and rejects malformed ones', () => {
    const base = { schemaVersion: 1, approval: { mode: 'required' } } as Record<string, unknown>;
    const ok = parseConfig({ ...base, approval: { mode: 'required', domains: [{ name: 'domain-a', featureGlobs: ['example'] }] } });
    expect(ok.approval.domains).toEqual([{ name: 'domain-a', featureGlobs: ['example'] }]);
    expect(domainsConfigured(ok.approval)).toBe(true);
    expect(domainsConfigured(parseConfig(base).approval)).toBe(false);
    expect(domainsConfigured(parseConfig({ ...base, approval: { mode: 'required', domains: [] } }).approval)).toBe(false);

    expect(() => parseConfig({ ...base, approval: { mode: 'required', domains: [{ name: 'Domain-A', featureGlobs: ['x'] }] } })).toThrow();
    expect(() => parseConfig({ ...base, approval: { mode: 'required', domains: [{ name: 'requirements', featureGlobs: ['x'] }] } })).toThrow();
    expect(() => parseConfig({
      ...base,
      approval: { mode: 'required', domains: [{ name: 'a', featureGlobs: ['x'] }, { name: 'a', featureGlobs: ['y'] }] },
    })).toThrow();
    expect(() => parseConfig({ ...base, approval: { mode: 'required', domains: [{ name: 'a', featureGlobs: [] }] } })).toThrow();
    expect(() => parseConfig({ ...base, approval: { mode: 'required', domains: [{ name: 'a', featureGlobs: [''] }] } })).toThrow();
    expect(() => parseConfig({ ...base, approval: { mode: 'required', domains: [{ name: 'a', featureGlobs: ['x/y'] }] } })).toThrow();
  });
});

describe('approval domain scoping (resolution, REQ-002/003/004)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-002
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-002
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-002 rejects a feature matched by more than one domain', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    config.approval.domains = [
      { name: 'domain-a', featureGlobs: ['example', '*'] },
      { name: 'domain-b', featureGlobs: ['other'] },
    ];
    await expect(resolveDomains(root, config.approval)).rejects.toThrow(/matches more than one/);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-003
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-003
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-003 rejects an existing feature directory owned by no domain', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    config.approval.domains = [{ name: 'domain-a', featureGlobs: ['example'] }];
    await expect(resolveDomains(root, config.approval)).rejects.toThrow(/not owned by any configured approval domain/);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-004
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-004
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-004 rejects a domain matching zero feature directories', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    config.approval.domains = [
      { name: 'domain-a', featureGlobs: ['example'] },
      { name: 'domain-b', featureGlobs: ['other'] },
      { name: 'domain-c', featureGlobs: ['nonexistent-*'] },
    ];
    await expect(resolveDomains(root, config.approval)).rejects.toThrow(/matches zero existing feature directories/);
  });
});

describe('approval domain scoping (CLI option validation, REQ-005/006/007)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-005
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-005
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-005 requires --domain for requirements/design when configured, and rejects unknown names', () => {
    const configured = { mode: 'required' as const, domains: [{ name: 'domain-a', featureGlobs: ['example'] }] };
    expect(() => requireDomainOption(configured, 'requirements', undefined)).toThrow(/domain-a/);
    expect(() => requireDomainOption(configured, 'design', undefined)).toThrow(/--domain is required/);
    expect(() => requireDomainOption(configured, 'requirements', 'unknown')).toThrow(/Unknown approval domain/);
    expect(() => requireDomainOption(configured, 'requirements', 'domain-a')).not.toThrow();
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-006
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-006
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-006 rejects --domain for the release stage whether or not domains are configured', () => {
    const configured = { mode: 'required' as const, domains: [{ name: 'domain-a', featureGlobs: ['example'] }] };
    const unconfigured = { mode: 'required' as const, domains: [] };
    expect(() => requireDomainOption(configured, 'release', 'domain-a')).toThrow(/always repository-wide/);
    expect(() => requireDomainOption(unconfigured, 'release', 'domain-a')).toThrow(/always repository-wide/);
    expect(() => requireDomainOption(configured, 'release', undefined)).not.toThrow();
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-007
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-007
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-007 rejects --domain on prepare/record/validate when domains are not configured', () => {
    const unconfigured = { mode: 'required' as const, domains: [] };
    expect(() => requireDomainOption(unconfigured, 'requirements', 'domain-a')).toThrow(/not configured/);
    expect(() => requireDomainOption(unconfigured, 'design', 'domain-a')).toThrow(/not configured/);
    expect(() => requireValidateDomainOption(unconfigured, 'domain-a')).toThrow(/not configured/);
    expect(() => requireValidateDomainOption(unconfigured, undefined)).not.toThrow();
  });
});

describe('approval domain scoping (validate breakdown, REQ-008/009/010)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-008
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-008
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-008 reports every domain plus release when validate omits --domain', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const report = await validateApprovals(root, config.approval);
    expect(report.domains?.map((d) => d.name).sort()).toEqual(['domain-a', 'domain-b']);
    expect(report.domains?.every((d) => d.stages.length === 2)).toBe(true);
    expect(report.release?.stage).toBe('release');
    expect(report.stages).toEqual([]);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-009
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-009
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-009 scopes validate --domain to only that domain, omitting release', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const report = await validateApprovalsForDomain(root, config.approval, 'domain-a');
    expect(report.domain).toBe('domain-a');
    expect(report.domains).toEqual([{ name: 'domain-a', stages: report.domains?.[0]?.stages }]);
    expect(report.release).toBeUndefined();
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-010
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-010
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-010 rejects validate for an unknown domain name', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    await expect(validateApprovalsForDomain(root, config.approval, 'nope')).rejects.toThrow(/Unknown approval domain/);
  });
});

describe('approval domain scoping (manifest binding, REQ-011/012/013/014)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-011
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-011
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-011 binds the requirements manifest to only the owning domain\'s artifacts', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const domainA = await resolveNamedDomain(root, config.approval, 'domain-a');
    const before = await approvalManifest(root, 'requirements', domainA);
    expect(Object.keys(before.artifacts).sort()).toEqual(['.musubix/constitution.md', '.musubix/features/example/requirements.md']);

    // Changing the other domain's requirements does not affect domain-a's manifest hash.
    const otherPath = '.musubix/features/other/requirements.md';
    await writeText(root, otherPath, `${await readText(root, otherPath)}\n`);
    const afterOtherChanged = await approvalManifest(root, 'requirements', domainA);
    expect(afterOtherChanged.artifactSha256).toBe(before.artifactSha256);

    // Changing domain-a's own requirements.md changes its manifest hash.
    const ownPath = '.musubix/features/example/requirements.md';
    await writeText(root, ownPath, `${await readText(root, ownPath)}\n`);
    const afterOwnChanged = await approvalManifest(root, 'requirements', domainA);
    expect(afterOwnChanged.artifactSha256).not.toBe(before.artifactSha256);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-012
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-012
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-012 binds the design manifest to only the owning domain\'s design/ADR artifacts', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const domainA = await resolveNamedDomain(root, config.approval, 'domain-a');
    const before = await approvalManifest(root, 'design', domainA);
    expect(Object.keys(before.artifacts)).toContain('.musubix/features/example/design.md');
    expect(Object.keys(before.artifacts)).not.toContain('.musubix/features/other/design.md');

    const otherDesignPath = '.musubix/features/other/design.md';
    const otherDesignText = await readText(root, otherDesignPath);
    await writeText(root, otherDesignPath, `${otherDesignText}\n`);
    const afterOtherChanged = await approvalManifest(root, 'design', domainA);
    expect(afterOtherChanged.artifactSha256).toBe(before.artifactSha256);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-013
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-013
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-013 invalidates every domain approval when the constitution changes', async () => {
    const root = await twoDomainProject();
    await approveDomain(root, 'requirements', 'domain-a');
    await approveDomain(root, 'requirements', 'domain-b');
    const config = await loadConfig(root);
    const constitutionText = await readText(root, '.musubix/constitution.md');
    await writeText(root, '.musubix/constitution.md', `${constitutionText}\n`);
    const reportA = await validateApprovalsForDomain(root, config.approval, 'domain-a');
    const reportB = await validateApprovalsForDomain(root, config.approval, 'domain-b');
    expect(reportA.domains?.[0]?.stages[0]?.status).toBe('stale');
    expect(reportB.domains?.[0]?.stages[0]?.status).toBe('stale');
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-014
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-014
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-014 ignores artifacts outside every domain\'s bound inputs when domains are configured', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const domainA = await resolveNamedDomain(root, config.approval, 'domain-a');
    const before = await approvalManifest(root, 'requirements', domainA);
    // Adding an unrelated top-level file does not change domain-a's manifest.
    await writeText(root, 'unrelated.md', 'scratch\n');
    const after = await approvalManifest(root, 'requirements', domainA);
    expect(after.artifactSha256).toBe(before.artifactSha256);
  });
});

describe('approval domain scoping (distinct evidence storage, REQ-015)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-015
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-015
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-015 stores each domain\'s evidence independently of other domains and repo-wide evidence', async () => {
    const root = await twoDomainProject();
    await approveDomain(root, 'requirements', 'domain-a');
    const config = await loadConfig(root);
    const evidenceA = await loadApproval(root, 'requirements', 'domain-a');
    const evidenceB = await loadApproval(root, 'requirements', 'domain-b');
    const repoWide = await loadApproval(root, 'requirements');
    expect(evidenceA?.approver).toBe('domain-a reviewer');
    expect(evidenceB).toBeNull();
    expect(repoWide).toBeNull();
    const reportA = await validateApprovalsForDomain(root, config.approval, 'domain-a');
    const reportB = await validateApprovalsForDomain(root, config.approval, 'domain-b');
    expect(reportA.domains?.[0]?.stages[0]?.status).toBe('approved');
    expect(reportB.domains?.[0]?.stages[0]?.status).toBe('missing');
  });
});

describe('approval domain scoping (design/TDD prerequisite gating, REQ-016/017/018)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-016
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-016
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-016 blocks a design-owning domain\'s requirement until only that domain approves', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const domainA = await resolveDesignFileDomain(root, config.approval, '.musubix/features/example/design.md');
    await expect(requireApproval(root, 'requirements', config.approval, domainA)).rejects.toThrow(/requirements approval.*is missing/);
    await approveDomain(root, 'requirements', 'domain-a');
    await expect(requireApproval(root, 'requirements', config.approval, domainA)).resolves.toBeUndefined();
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-017
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-017
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-017 rejects a design file outside every domain-owned feature directory', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    await expect(resolveDesignFileDomain(root, config.approval, 'scratch/design.md')).rejects.toThrow(/outside every configured approval domain/);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-018
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-018
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-018 blocks TDD Red for a requirement until only its owning domain\'s design approves', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const requirementSlug = await featureOwningRequirement(root, 'REQ-EXAMPLE-001');
    expect(requirementSlug).toBe('example');
    const domainA = await resolveRequirementDomain(root, config.approval, 'REQ-EXAMPLE-001');
    expect(domainA?.name).toBe('domain-a');
    await expect(requireApproval(root, 'design', config.approval, domainA)).rejects.toThrow(/design approval.*is missing/);
    await approveDomain(root, 'requirements', 'domain-a');
    await approveDomain(root, 'design', 'domain-a');
    await expect(requireApproval(root, 'design', config.approval, domainA)).resolves.toBeUndefined();
    const evidence = await runTddPhase(root, 'red', 'TEST-EXAMPLE-001', 'REQ-EXAMPLE-001', 'test', tddResultRunner(root, 'failed', { exitCode: 1 }));
    expect(evidence.valid).toBe(true);
  });
});

describe('approval domain scoping (gate/status scoping, REQ-019/020/021/022)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-019
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-019
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-019 scopes gate --feature\'s approval check to the owning domain only', async () => {
    const root = await twoDomainProject();
    await approveDomain(root, 'requirements', 'domain-a');
    await approveDomain(root, 'design', 'domain-a');
    const report = await runGate(root, { feature: 'example' });
    const approvalCheck = report.checks.find((check) => check.name === 'approval');
    expect(approvalCheck?.status).toBe('fail'); // release is still unapproved and included, see REQ-020.
    const config = await loadConfig(root);
    const featureGate = await validateApprovalsForFeatureGate(root, config.approval, 'domain-a');
    expect(featureGate.domains?.[0]?.stages.every((s) => s.status === 'approved')).toBe(true);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-020
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-020
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-020 keeps the release stage repository-wide inside gate --feature', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const featureGate = await validateApprovalsForFeatureGate(root, config.approval, 'domain-a');
    expect(featureGate.release?.stage).toBe('release');
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-021
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-021
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-021 reports a per-domain breakdown in full-repo gate', async () => {
    const root = await twoDomainProject();
    const report = await runGate(root);
    const approvalCheck = report.checks.find((check) => check.name === 'approval');
    expect(approvalCheck).toBeDefined();
    const config = await loadConfig(root);
    const full = await validateApprovals(root, config.approval);
    expect(full.domains?.length).toBe(2);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-022
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-022
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-022 requires every domain and release current for overall validity', async () => {
    const root = await twoDomainProject();
    await approveDomain(root, 'requirements', 'domain-a');
    await approveDomain(root, 'design', 'domain-a');
    // domain-b is left unapproved.
    const config = await loadConfig(root);
    const full = await validateApprovals(root, config.approval);
    expect(full.valid).toBe(false);
  });
});

describe('approval domain scoping (consistent recomputation, REQ-023) and backward compatibility (REQ-024)', () => {
  /** @id TEST-APPROVAL-DOMAIN-SCOPING-023
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-023
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-023 computes the identical manifest hash at every evaluation site', async () => {
    const root = await twoDomainProject();
    const config = await loadConfig(root);
    const domainA = await resolveNamedDomain(root, config.approval, 'domain-a');
    const prepareHash = (await approvalManifest(root, 'requirements', domainA)).artifactSha256;
    const validateHash = (await validateApprovalsForDomain(root, config.approval, 'domain-a')).domains?.[0]?.stages[0]?.currentArtifactSha256;
    const gateHash = (await validateApprovalsForFeatureGate(root, config.approval, 'domain-a')).domains?.[0]?.stages[0]?.currentArtifactSha256;
    expect(validateHash).toBe(prepareHash);
    expect(gateHash).toBe(prepareHash);
  });

  /** @id TEST-APPROVAL-DOMAIN-SCOPING-024
   * @verifies REQ-APPROVAL-DOMAIN-SCOPING-024
   */
  it('TEST-APPROVAL-DOMAIN-SCOPING-024 preserves the pre-existing repo-wide behavior without domains configured', async () => {
    const root = await project();
    const config = await loadConfig(root);
    config.approval = { mode: 'required', domains: [] };
    await writeJson(root, '.musubix/config.json', config);
    expect(domainOwning([], 'example')).toBeNull();
    const evidence = await approveRepoWide(root, 'requirements', 'Reviewer');
    expect(evidence.domain).toBeUndefined();
    expect(evidence.features).toBeUndefined();
    const report = await validateApprovals(root, config.approval);
    expect(report.domains).toBeUndefined();
    expect(report.release).toBeUndefined();
    expect(report.stages.length).toBe(3);
  });
});
