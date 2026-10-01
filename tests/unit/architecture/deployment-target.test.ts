import { describe, expect, it, vi } from 'vitest';
import { selectCortexPlatformTarget } from '../../../packages/core/src/architecture/deployment-target';
import type { RepositoryArchitecture } from '../../../packages/core/src/types/architecture';
import { buildArchitectureBundle, generateArchitectureArtifact } from '../../../packages/core/src/architecture/iac';

function fixture(): RepositoryArchitecture {
  return { version: 1, id: 'a'.repeat(64), repoUrl: 'https://github.com/example/app', revision: 'a'.repeat(40), scannedAt: '',
    resources: [], connections: [], bindings: [], evidence: [], gaps: [], recommendations: [], deploymentUnits: [], deploymentContext: [],
    coverage: { filesScanned: 1, deploymentFiles: 1, files: [], excluded: [], limits: { maxFiles: 100, maxFileBytes: 10000, maxTotalBytes: 100000 }, truncated: false, runtimeVerified: false } };
}
function inputs() {
  const app = fixture(), platform = fixture(); platform.id = 'b'.repeat(64); platform.repoUrl = 'https://github.com/example/cortex'; platform.revision = 'b'.repeat(40);
  app.resources = [
    { id: 'source', name: 'backend', scope: 'backend', kind: 'application', technology: 'Python', origin: 'code', evidence: ['src'], attributes: {} },
    { id: 'legacy', name: 'old-db', scope: 'deploy/prod', kind: 'database', technology: 'cortex-postgresql', origin: 'declared', evidence: ['old'], attributes: {} },
  ];
  app.evidence = [{ id: 'src', file: 'backend/db.py', line: 1, endLine: 2, kind: 'code', summary: 'Reads database URL' }, { id: 'old', file: 'deploy/prod/app.yaml', line: 1, endLine: 3, kind: 'deployment', summary: 'Old provider' }];
  app.bindings = [{ id: 'db', consumerId: 'source', key: 'DATABASE_URL', source: 'environment', sourceId: 'legacy', resolved: true, sensitive: true, evidence: ['src'] }];
  platform.resources = [{ id: 'definition', name: 'insight-0-0-2', kind: 'module', scope: 'gitops/prod', technology: 'ApplicationDefinition', origin: 'declared', evidence: ['definition-ev'], attributes: { applicationId: 'insight', deploymentOwner: 'Cortex tenant operator / Argo CD', infrastructureMode: 'Terraform' } }];
  platform.evidence = [{ id: 'definition-ev', file: 'gitops/prod/definition.yaml', line: 1, endLine: 10, kind: 'deployment', summary: 'Current Cortex definition' }];
  platform.deploymentContext = [{ file: 'gitops/prod/definition.yaml', content: '{"kind":"ApplicationDefinition"}', redacted: true }];
  platform.deploymentUnits = [{ id: 'kubernetes:gitops/prod', root: 'gitops/prod', name: 'prod', format: 'kubernetes', resourceIds: ['definition'], files: ['gitops/prod/definition.yaml'], exportFormats: [] }];
  const input = { applicationId: 'insight', definitionName: 'insight-0-0-2', environment: 'production', unitIds: ['kubernetes:gitops/prod'] };
  return { app, platform, input };
}
describe('current Cortex target selection', () => {
  it('pins both repositories and carries source requirements without importing legacy infrastructure or mutating the old snapshot', () => {
    const { app, platform, input } = inputs(), before = JSON.stringify(app);
    const selected = selectCortexPlatformTarget(app, platform, input);
    expect(selected.id).not.toBe(app.id);
    expect(selected.deploymentTarget).toMatchObject({ kind: 'cortex-platform', environment: 'prod', revision: platform.revision });
    expect(selected.sources).toHaveLength(2);
    expect(selected.resources.map(r => r.id)).toEqual(['application:source', 'cortex:definition']);
    expect(selected.bindings[0]).toMatchObject({ consumerId: 'application:source', resolved: false });
    expect(selected.bindings[0].sourceId).toBeUndefined();
    expect(selected.evidence.find(e => e.id === 'cortex:definition-ev')).toMatchObject({ repoUrl: platform.repoUrl, revision: platform.revision, sourceFile: 'gitops/prod/definition.yaml' });
    expect(selected.deploymentUnits[0].files).toEqual(['cortex/gitops/prod/definition.yaml']);
    expect(JSON.stringify(app)).toBe(before);
    expect(selectCortexPlatformTarget(app, platform, input).id).toBe(selected.id);
  });
  it('rejects an unpinned, incomplete or legacy deployment snapshot', () => {
    const { app, platform, input } = inputs();
    expect(() => selectCortexPlatformTarget(app, { ...platform, revision: null }, input)).toThrow('pinned');
    expect(() => selectCortexPlatformTarget(app, { ...platform, coverage: { ...platform.coverage, truncated: true } }, input)).toThrow('Complete');
    expect(() => selectCortexPlatformTarget(app, platform, { ...input, definitionName: 'legacy' })).toThrow('current Cortex');
    platform.deploymentUnits[0].format = 'cortex';
    expect(() => selectCortexPlatformTarget(app, platform, input)).toThrow('legacy CortexApp');
  });
  it('assigns a new snapshot identity when the selected platform commit changes', () => {
    const { app, platform, input } = inputs();
    const old = selectCortexPlatformTarget(app, platform, input);
    expect(selectCortexPlatformTarget(app, { ...platform, revision: 'c'.repeat(40) }, input).id).not.toBe(old.id);
  });
  it('prevents current Cortex ownership from falling through to generic ARM generation or cached exports', async () => {
    const { app, platform, input } = inputs();
    const selected = selectCortexPlatformTarget(app, platform, input);
    const client = { analyzeStructured: vi.fn() };
    await expect(generateArchitectureArtifact(selected, {} as never, client as never)).rejects.toThrow('native tenant Terraform');
    expect(client.analyzeStructured).not.toHaveBeenCalled();
    expect(() => buildArchitectureBundle(selected, {} as never, {} as never)).toThrow('generic ARM wrapper');
  });
});
