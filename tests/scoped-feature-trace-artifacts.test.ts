// CHANGE-0038: TDD tests for REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-001..005.
// CHANGE-0038 (corrective Red-Implementation-Green batch): extended coverage for
// previously-untested acceptance clauses (Depends-On projection, unannotated
// unrelated files, musubix3 init / gate input-stability, trace impact parity,
// and design-stage/per-domain approval-manifest stability).
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approvalManifest, buildTrace, canonicalSort, canonicalTracePath, checkTrace, featureTraceProjection,
  loadConfig, loadTrace, readText, resolveNamedDomain, runGate, traceImpact, writeJson, writeText, type Runner,
} from '../packages/analysis/src/index.js';
import { install } from '../packages/cli/src/install.js';
import { processResult, project, repository } from './helpers.js';

// Scaffolds a second feature ("second") alongside the default "example" feature
// scaffolded by `project()`, and gives it its own code/test files. The two
// features' designs decide no common ADR, so they share no trace edge.
async function twoFeatureProject(): Promise<string> {
  const root = await project();
  await install(root, repository, { feature: 'second' });
  await writeText(root, '.musubix/features/second/design.md', (await readText(root, '.musubix/features/second/design.md'))
    .replace('ADRs: ADR-0001', 'ADRs: none — second feature introduces no new architectural decision.'));
  await writeText(root, 'src/second.ts', `/** @id CODE-SECOND-001
 * @implements REQ-SECOND-001
 * @design DES-SECOND-001
 */
export function secondReadiness() { return true; }
`);
  await writeText(root, 'src/second.test.ts', `import { secondReadiness } from './second.js';
/** @id TEST-SECOND-001
 * @verifies REQ-SECOND-001
 */
export function testSecondReadiness() { if (!secondReadiness()) throw new Error('not ready'); }
`);
  return root;
}

describe('scoped feature trace artifacts', () => {
  /** @id TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-001
   * @verifies REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-001
   */
  it('TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-001 projects each feature trace.json to its own reachable nodes, excluding an unrelated feature, including a shared node', async () => {
    const root = await twoFeatureProject();
    const trace = await buildTrace(root);
    const examplePersisted = JSON.parse(await readText(root, '.musubix/features/example/trace.json'));
    const secondPersisted = JSON.parse(await readText(root, '.musubix/features/second/trace.json'));
    expect(examplePersisted).toEqual(featureTraceProjection(trace, '.musubix/features/example'));
    expect(secondPersisted).toEqual(featureTraceProjection(trace, '.musubix/features/second'));
    const exampleIds: string[] = examplePersisted.nodes.map((n: { id: string }) => n.id);
    const secondIds: string[] = secondPersisted.nodes.map((n: { id: string }) => n.id);
    // The two features share no trace edge (each decides its own, distinct ADR), so each
    // projection contains only its own nodes and excludes the other feature's.
    expect(exampleIds).toEqual(expect.arrayContaining(['REQ-EXAMPLE-001', 'DES-EXAMPLE-001', 'CODE-EXAMPLE-001', 'TEST-EXAMPLE-001', 'ADR-0001']));
    expect(secondIds).toEqual(expect.arrayContaining(['REQ-SECOND-001', 'DES-SECOND-001', 'CODE-SECOND-001', 'TEST-SECOND-001']));
    expect(exampleIds).not.toEqual(expect.arrayContaining(['REQ-SECOND-001', 'CODE-SECOND-001']));
    expect(secondIds).not.toEqual(expect.arrayContaining(['REQ-EXAMPLE-001', 'CODE-EXAMPLE-001', 'ADR-0001']));

    // A single code node whose annotations link it to requirements owned by two
    // different features must appear in both features' projections.
    await writeText(root, 'src/shared.ts', `/** @id CODE-SHARED-001
 * @implements REQ-EXAMPLE-001 REQ-SECOND-001
 */
export function shared() { return true; }
`);
    const sharedTrace = await buildTrace(root);
    const exampleProjection = featureTraceProjection(sharedTrace, '.musubix/features/example');
    const secondProjection = featureTraceProjection(sharedTrace, '.musubix/features/second');
    const examplePersistedShared = JSON.parse(await readText(root, '.musubix/features/example/trace.json'));
    const secondPersistedShared = JSON.parse(await readText(root, '.musubix/features/second/trace.json'));
    expect(examplePersistedShared).toEqual(exampleProjection);
    expect(secondPersistedShared).toEqual(secondProjection);
    expect(exampleProjection.nodes.map((n) => n.id)).toContain('CODE-SHARED-001');
    expect(secondProjection.nodes.map((n) => n.id)).toContain('CODE-SHARED-001');
    // Each feature's persisted edges must include the shared node's
    // `implements` edge connecting it to that feature's own requirement, and
    // its fingerprint (keyed by `src/shared.ts`) must be present too.
    expect(exampleProjection.edges).toContainEqual({ from: 'CODE-SHARED-001', to: 'REQ-EXAMPLE-001', relation: 'implements' });
    expect(secondProjection.edges).toContainEqual({ from: 'CODE-SHARED-001', to: 'REQ-SECOND-001', relation: 'implements' });
    expect(Object.keys(exampleProjection.fingerprints)).toContain('src/shared.ts');
    expect(Object.keys(secondProjection.fingerprints)).toContain('src/shared.ts');

    // A third feature whose design `Depends-On` references a component owned by
    // another feature must have its persisted projection include the
    // depended-on component, its owning requirement, and any ADR it decides.
    await install(root, repository, { feature: 'third' });
    await writeText(root, '.musubix/features/third/design.md', (await readText(root, '.musubix/features/third/design.md'))
      .replace('Depends-On: none', 'Depends-On: DES-EXAMPLE-001')
      .replace('ADRs: ADR-0001', 'ADRs: none — third feature depends on example, introduces no new architectural decision.'));
    const dependentTrace = await buildTrace(root);
    const thirdProjection = featureTraceProjection(dependentTrace, '.musubix/features/third');
    const thirdPersisted = JSON.parse(await readText(root, '.musubix/features/third/trace.json'));
    expect(thirdPersisted).toEqual(thirdProjection);
    const thirdIds = thirdProjection.nodes.map((n) => n.id);
    expect(thirdIds).toEqual(expect.arrayContaining(['DES-EXAMPLE-001', 'REQ-EXAMPLE-001', 'ADR-0001']));
    // The depends-on edge itself, and the depended-on design node's owning
    // requirement/ADR diagnostics/fingerprints, must be part of the same
    // persisted projection (not merely transitively-reachable node IDs).
    expect(thirdProjection.edges).toContainEqual({ from: 'DES-THIRD-001', to: 'DES-EXAMPLE-001', relation: 'depends-on' });
    expect(thirdProjection.edges).toContainEqual({ from: 'ADR-0001', to: 'DES-EXAMPLE-001', relation: 'decides' });
    expect(Object.keys(thirdProjection.fingerprints)).toEqual(expect.arrayContaining([
      '.musubix/features/example/design.md', '.musubix/features/example/requirements.md', '.musubix/decisions/ADR-0001.md',
    ]));
  });

  /** @id TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-002
   * @verifies REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002
   */
  it('TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-002 leaves an unrelated feature trace.json byte-identical on rebuild', async () => {
    const root = await twoFeatureProject();
    await buildTrace(root);
    const before = await readText(root, '.musubix/features/second/trace.json');
    await writeText(root, 'src/service.ts', `/** @id CODE-EXAMPLE-001
 * @implements REQ-EXAMPLE-001
 * @design DES-EXAMPLE-001
 */
export function readiness() { return true; } // changed only for example
`);
    await buildTrace(root);
    const after = await readText(root, '.musubix/features/second/trace.json');
    expect(after).toEqual(before);

    // Adding a new, unrelated source file with no trace annotation at all must
    // also leave the other feature's persisted projection untouched.
    await writeText(root, 'src/unannotated.ts', 'export const noop = (): void => {};\n');
    await buildTrace(root);
    expect(await readText(root, '.musubix/features/second/trace.json')).toEqual(before);

    // The same unchanged project rebuilt twice in succession produces
    // byte-identical per-feature projections once the build timestamp is
    // disregarded (both rebuilds above already left `second` byte-identical,
    // including its `generatedAt` field, confirming full byte stability).
    await buildTrace(root);
    expect(await readText(root, '.musubix/features/second/trace.json')).toEqual(before);
  });

  /** @id TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-003
   * @verifies REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-002 REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-003
   */
  it('TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-003 persists a deterministic tracked canonical full graph', async () => {
    const root = await twoFeatureProject();
    const ignore = await readText(root, '.gitignore');
    expect(ignore).not.toContain(canonicalTracePath.replace('.musubix/', '/.musubix/'));
    // `musubix3 init` (i.e. `install()`, already run twice by `twoFeatureProject()`
    // via `project()` and the second feature's scaffolding) must itself have
    // already created `.musubix/trace.json`, before any explicit `trace build`.
    const fromInit = await readText(root, canonicalTracePath);
    expect(JSON.parse(fromInit).nodes.length).toBeGreaterThan(0);
    const first = await buildTrace(root);
    const firstCanonical = await readText(root, canonicalTracePath);
    expect(JSON.parse(firstCanonical)).toEqual(canonicalSort(first));
    await buildTrace(root);
    const secondCanonical = await readText(root, canonicalTracePath);
    expect(secondCanonical).toEqual(firstCanonical);

    // When `gate` runs `trace build` as part of a quality command and
    // `.musubix/trace.json` is regenerated mid-run, the gate's input-stability
    // check must not report it as modified.
    const mutated = firstCanonical.replace('"nodes"', '"nodes"  ');
    const runner: Runner = async () => {
      await writeText(root, canonicalTracePath, mutated);
      return processResult();
    };
    const report = await runGate(root, { runner });
    expect(report.checks.find((c) => c.name === 'input-stability')?.diagnostics ?? [])
      .not.toContainEqual(expect.objectContaining({ path: canonicalTracePath }));

    // Installing a feature whose own trace.json already exists, but whose
    // canonical `.musubix/trace.json` is missing (e.g. a pre-#49 checkout),
    // must still restore the canonical graph, while leaving the feature's own
    // trace.json byte-for-byte untouched if its reachable content is unchanged
    // (the change-detecting writer applies to every code path that writes a
    // feature trace.json, not only `trace build`).
    const beforeFeatureTrace = await readText(root, '.musubix/features/second/trace.json');
    await unlink(resolve(root, canonicalTracePath));
    const recovery = await install(root, repository, { feature: 'second' });
    const restored = await readText(root, canonicalTracePath);
    expect(JSON.parse(restored).nodes.length).toBeGreaterThan(0);
    expect(await readText(root, '.musubix/features/second/trace.json')).toEqual(beforeFeatureTrace);
    // The reported action for the feature trace path must reflect that it was
    // genuinely left untouched (byte-identical, per the assertion above), not
    // merely assumed 'preserve' regardless of whether a rewrite actually
    // happened during canonical-missing recovery.
    expect(recovery.actions).toContainEqual({ path: '.musubix/features/second/trace.json', action: 'preserve' });

    // Conversely, when the feature's reachable content genuinely changed
    // since its persisted trace.json was last written, canonical-missing
    // recovery must both rewrite the file and report that rewrite accurately
    // as 'replace', not the stale 'preserve' default.
    await writeText(root, 'src/second-extra.ts', `/** @id CODE-SECOND-002
 * @implements REQ-SECOND-001
 */
export function secondExtra() { return 'extra'; }
`);
    await unlink(resolve(root, canonicalTracePath));
    const recovery2 = await install(root, repository, { feature: 'second' });
    expect(await readText(root, '.musubix/features/second/trace.json')).not.toEqual(beforeFeatureTrace);
    expect(recovery2.actions).toContainEqual({ path: '.musubix/features/second/trace.json', action: 'replace' });
  });

  /** @id TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-004
   * @verifies REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-004
   */
  it('TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-004 falls back to the canonical full graph without losing genuinely dangling nodes', async () => {
    const root = await twoFeatureProject();
    await writeText(root, 'src/orphan.ts', `/** @id CODE-ORPHAN-001
 * @implements REQ-ORPHAN-001
 */
export function orphan() { return true; }
`);
    const built = await buildTrace(root);
    const cacheImpact = traceImpact(built, 'CODE-ORPHAN-001');
    await unlink(resolve(root, '.musubix/cache/trace.json'));
    const fallback = await loadTrace(root);
    expect(fallback).toEqual(canonicalSort(built));
    expect(fallback.nodes.map((n) => n.id)).toContain('CODE-ORPHAN-001');
    // `trace impact` loaded from the canonical fallback must report an
    // identical impact set to the same query run immediately after `trace build`.
    expect(traceImpact(fallback, 'CODE-ORPHAN-001')).toEqual(cacheImpact);
    const check = await checkTrace(root, fallback, true);
    expect(check.diagnostics).toContainEqual(expect.objectContaining({
      code: 'TRACE_DANGLING',
      message: expect.stringContaining('CODE-ORPHAN-001 → REQ-ORPHAN-001'),
    }));
    // The cache-backed `trace check --strict` result (diagnostics, coverage,
    // validity) must be identical to the canonical-fallback result for the
    // same graph content.
    const cacheCheck = await checkTrace(root, built, true);
    expect(check).toEqual(cacheCheck);
  });

  /** @id TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-005
   * @verifies REQ-SCOPED-FEATURE-TRACE-ARTIFACTS-005
   */
  it('TEST-SCOPED-FEATURE-TRACE-ARTIFACTS-005 leaves the requirements approval manifest hash unaffected by trace rebuilds', async () => {
    const root = await twoFeatureProject();
    await buildTrace(root);
    const before = await approvalManifest(root, 'requirements');
    const beforeDesign = await approvalManifest(root, 'design');
    await writeText(root, 'src/second.ts', `/** @id CODE-SECOND-001
 * @implements REQ-SECOND-001
 * @design DES-SECOND-001
 */
export function secondReadiness() { return true; } // changed only for second
`);
    await buildTrace(root);
    const after = await approvalManifest(root, 'requirements');
    expect(after.artifactSha256).toEqual(before.artifactSha256);
    // The design-stage manifest (which additionally includes design.md and ADRs)
    // must be equally unaffected by a trace-only rebuild of an unrelated feature.
    const afterDesign = await approvalManifest(root, 'design');
    expect(afterDesign.artifactSha256).toEqual(beforeDesign.artifactSha256);

    // With `approval.domains` configured, the *other* domain's per-domain
    // requirements/design manifests must likewise be unaffected by a trace
    // rebuild triggered by a change confined to the domain being edited.
    const config = await loadConfig(root);
    config.approval = {
      mode: 'required',
      domains: [
        { name: 'domain-example', featureGlobs: ['example'] },
        { name: 'domain-second', featureGlobs: ['second'] },
      ],
    };
    await writeJson(root, '.musubix/config.json', config);
    const exampleDomain = await resolveNamedDomain(root, config.approval, 'domain-example');
    const secondDomain = await resolveNamedDomain(root, config.approval, 'domain-second');
    const beforeExampleReq = await approvalManifest(root, 'requirements', exampleDomain);
    const beforeExampleDesign = await approvalManifest(root, 'design', exampleDomain);
    const beforeSecondReq = await approvalManifest(root, 'requirements', secondDomain);
    // Editing the *second* feature's own requirements/design docs (the actual
    // inputs to domain-scoped manifests, per `domainStagePaths`) must not
    // change the *example* domain's manifest at all, proving per-domain
    // scoping actually filters by owning feature rather than including
    // every feature's spec files.
    await writeText(root, '.musubix/features/second/requirements.md', `${await readText(root, '.musubix/features/second/requirements.md')}\n<!-- domain-scoping touch -->\n`);
    await writeText(root, '.musubix/features/second/design.md', `${await readText(root, '.musubix/features/second/design.md')}\n<!-- domain-scoping touch -->\n`);
    await buildTrace(root);
    expect((await approvalManifest(root, 'requirements', exampleDomain)).artifactSha256)
      .toEqual(beforeExampleReq.artifactSha256);
    expect((await approvalManifest(root, 'design', exampleDomain)).artifactSha256)
      .toEqual(beforeExampleDesign.artifactSha256);
    // The *second* domain's own manifest, in contrast, must change — proving
    // the comparison above is a genuine scoping check, not a no-op where
    // nothing ever changes regardless of which feature is edited.
    expect((await approvalManifest(root, 'requirements', secondDomain)).artifactSha256)
      .not.toEqual(beforeSecondReq.artifactSha256);
  });
});
