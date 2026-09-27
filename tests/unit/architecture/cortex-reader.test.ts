import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scanRepositoryArchitecture } from '../../../packages/core/src/architecture/scanner';
import { groupArchitectureResources, overviewArchitecture } from '../../../packages/web/src/components/infrastructure/architecture-groups';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture(files: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'lp-cortex-')); dirs.push(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), typeof content === 'string' ? content : JSON.stringify(content, null, 2)); }
  return scanRepositoryArchitecture(root, 'local://fixture');
}
const definition = {
  apiVersion: 'cortex.cortex.ai/v1alpha1', kind: 'ApplicationDefinition', metadata: { name: 'test-v2' }, spec: {
    capabilities: [{ id: 'db', name: 'cortex-postgresql' }, { id: 'ai', name: 'azure-openai' }],
    components: [
      { name: 'frontend', expose: true, image: 'test/frontend:v1', env: [{ name: 'BACKEND_URL', value: 'http://$(CORTEX_APP_NAME)-backend:8000' }] },
      { name: 'backend', image: 'test/backend:v1', uses: ['db', 'ai'], env: [{ name: 'API_KEY', value: 'NEVER_EXPOSE_LITERAL' }], volumeMounts: [{ name: 'settings', mountPath: '/etc/config' }] },
    ],
    secretInjection: { ai: { secretName: '$(CORTEX_APP_NAME)-ai', env: [{ key: 'endpoint', name: 'AI_ENDPOINT' }, { key: 'api-key', name: 'AI_KEY' }] } },
    configMaps: [{ name: '$(CORTEX_APP_NAME)-settings', data: { 'config.yaml': 'debug: false' } }],
    volumes: [{ name: 'settings', configMap: { name: '$(CORTEX_APP_NAME)-settings' } }],
  },
};
const instance = { apiVersion: definition.apiVersion, kind: 'CortexApp', metadata: { name: 'test', namespace: 'tenant' }, spec: {
  definitionRef: { name: 'test-v2' }, domain: 'example.test', componentImageTags: { backend: '123' },
  componentConfig: { backend: { env: [{ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 'external-db', key: 'uri' } } }] } },
} };

describe('Cortex and mixed deployment evidence', () => {
  it('expands actual Cortex contracts and overlays without combining identically named environments', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance, 'deploy/qa/definitions/definition.yaml': definition, 'deploy/qa/instances/app.yaml': instance });
    expect(graph.deploymentUnits.map(u => u.id).sort()).toEqual(['cortex:deploy/prod', 'cortex:deploy/qa']);
    const prod = graph.deploymentUnits.find(u => u.id === 'cortex:deploy/prod')!;
    const resources = graph.resources.filter(r => prod.resourceIds.includes(r.id));
    const backend = resources.find(r => r.name === 'backend')!, frontend = resources.find(r => r.name === 'frontend')!;
    expect(backend.attributes.imageTagOverride).toBe('123');
    expect(resources.filter(r => r.kind === 'application')).toHaveLength(2);
    expect(resources.filter(r => r.attributes.capabilityId && r.kind !== 'secret')).toHaveLength(2);
    expect(graph.connections.some(e => e.from === frontend.id && e.to === backend.id && e.relationship === 'connects using BACKEND_URL')).toBe(true);
    expect(graph.connections.every(e => !prod.resourceIds.includes(e.from) || prod.resourceIds.includes(e.to))).toBe(true);
    const injected = graph.bindings.find(b => b.consumerId === backend.id && b.key === 'AI_ENDPOINT')!;
    expect(injected.resolved).toBe(true);
    expect(graph.resources.find(r => r.id === injected.sourceId)?.name).toBe('test-ai');
    const database = graph.bindings.find(b => b.consumerId === backend.id && b.key === 'DATABASE_URL')!;
    expect(database.sourceKey).toBe('uri'); expect(database.resolved).toBe(false);
    expect(graph.resources.find(r => r.id === database.sourceId)?.origin).toBe('external');
    expect(JSON.stringify(graph)).not.toContain('NEVER_EXPOSE_LITERAL');
    expect(graph.deploymentContext.find(c => c.file === 'deploy/prod/definition.yaml')?.content).toContain('$(CORTEX_APP_NAME)-ai');
    for (const edge of graph.connections) { expect(graph.resources.some(r => r.id === edge.from)).toBe(true); expect(graph.resources.some(r => r.id === edge.to)).toBe(true); }
    const grouped = groupArchitectureResources(resources, graph.connections);
    const overview = overviewArchitecture(grouped.resources, grouped.connections);
    expect(new Set(overview.resources.flatMap(r => r.memberIds))).toEqual(new Set(resources.filter(r => r.attributes.diagramRole !== 'deployment-metadata').map(r => r.id)));
    expect(overview.connections.every(e => e.from !== e.to)).toBe(true);
    const source = resources.find(r => r.name === 'test-ai')!;
    const path = grouped.connections.find(e => e.from === source.id && e.to === backend.id)!;
    expect(path.connectionIds).toHaveLength(2);
    expect(path.evidence.length).toBeGreaterThan(0);
  });
  it('does not misclassify CI templates or local bind mounts and never invents empty hostname resources', async () => {
    const graph = await fixture({
      'azure-pipelines/templates/build.yaml': 'parameters: []\nsteps:\n- script: echo ${{ parameters.target }}\n',
      'compose.yaml': { services: { api: { image: 'app:v1', volumes: ['./backend:/app', { type: 'bind', source: './config', target: '/etc/config' }, 'database:/data'], environment: { AUTH_ENDPOINT: 'spicedb:50051' } } }, volumes: { database: {} } },
    });
    expect(graph.deploymentUnits.some(u => u.format === 'helm')).toBe(false);
    expect(graph.deploymentUnits.find(u => u.format === 'workflow')?.files).toEqual(['azure-pipelines/templates/build.yaml']);
    expect(graph.resources.filter(r => r.kind === 'storage').map(r => r.name)).toEqual(['database']);
    expect(graph.resources.some(r => r.name === '' || r.name === 'unresolved')).toBe(false);
    expect(graph.resources.find(r => r.name === 'api')?.attributes.localMounts).toContain('./backend');
  });
  it('keeps unresolved Cortex instances in the inventory and does not match definitions from another environment', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/qa/instances/app.yaml': instance });
    expect(graph.resources.some(r => r.technology === 'Unresolved CortexApp instance')).toBe(true);
    expect(graph.gaps.some(g => g.message.includes('unresolved') && g.scope === 'deploy/qa')).toBe(true);
  });
});
