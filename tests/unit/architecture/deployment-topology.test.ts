import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scanRepositoryArchitecture } from '../../../packages/core/src/architecture/scanner';
import { buildDeploymentTopology, deploymentDocuments, deploymentCountSummary } from '../../../packages/core/src/architecture/deployment-topology';
import { buildCortexDeploymentBundle } from '../../../packages/core/src/architecture/cortex-bundle';
import { isRepositoryOnlyComponent, validateArchitecturePlan, type GroundedArchitecturePlan } from '../../../packages/core/src/architecture/planner';
import type { RepositoryArchitecture } from '../../../packages/core/src/types/architecture';
import { chooseDeploymentScope, materializeArchitectureDesign, inspectArchitectureDesign, type ArchitectureDesign, type DesignEdit } from '../../../packages/core/src/architecture/design';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function fixture(files: Record<string, unknown>) {
  const root = await mkdtemp(join(tmpdir(), 'lp-deployment-')); dirs.push(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), JSON.stringify(content)); }
  return scanRepositoryArchitecture(root, 'local://fixture');
}
const definition = { apiVersion: 'cortex.cortex.ai/v1alpha1', kind: 'ApplicationDefinition', metadata: { name: 'app-v2' }, spec: {
  capabilities: [{ id: 'main-db', name: 'cortex-postgresql' }, { id: 'cache', name: 'azure-redis' }, { id: 'redis', name: 'cortex-redis' }, { id: 'search', name: 'azure-search' }],
  components: [
    { name: 'frontend', image: 'registry.test:5000/web:v1', expose: true, replicas: 2, containerPort: 80, servicePort: 80 },
    { name: 'backend', image: 'registry.test/api:v1', replicas: 2, containerPort: 8000, uses: ['main-db'], initContainers: [{ name: 'migrate', image: 'registry.test/api:v1', command: ['alembic', 'upgrade', 'head'] }], env: [{ name: 'JWT_SECRET', valueFrom: { secretKeyRef: { name: '$(CORTEX_APP_NAME)-app-secrets', key: 'jwt-secret' } } }] },
    { name: 'indexer', image: 'registry.test/indexer:v1', replicas: 6, uses: ['search'] },
  ],
} };
const instance = { apiVersion: definition.apiVersion, kind: 'CortexApp', metadata: { name: 'sample', namespace: 'tenant' }, spec: { definitionRef: { name: 'app-v2' }, domain: 'app.example.test', componentImageTags: { frontend: 'pinned' }, capabilityProvisioningConfig: { search: { params: { replicaCount: '2', partitionCount: '1' } } } } };
function planFor(graph: RepositoryArchitecture): GroundedArchitecturePlan {
  const components = graph.resources.map((r, i) => ({ id: `c${i}`, name: r.name, kind: r.kind, technology: r.technology, deployment: r.origin === 'external' ? 'external' as const : 'workload' as const, basis: r.origin === 'external' ? 'external' as const : 'repository' as const, resourceIds: [r.id], evidenceIds: r.evidence, rationale: 'Preserve the declared owner' }));
  return { id: 'b'.repeat(64), architectureId: graph.id, provider: 'azure', unitIds: graph.deploymentUnits.map(u => u.id), model: 'test', createdAt: '', evidenceCoverage: { resources: graph.resources.length, bindings: graph.bindings.length, decisions: graph.gaps.length }, summary: 'Preserve Cortex', components, connections: [],
    configuration: graph.bindings.map(b => ({ name: b.key, consumerId: components.find(c => c.resourceIds.includes(b.consumerId))!.id, sourceId: components.find(c => c.resourceIds.includes(b.sourceId ?? b.consumerId))!.id, bindingIds: [b.id], evidenceIds: b.evidence, delivery: 'Preserve manifest contract', secret: b.sensitive, recommendation: 'Verify operator outputs' })),
    resourceDecisions: graph.resources.map(r => ({ resourceId: r.id, disposition: 'include', reason: 'Preserved', componentIds: [components.find(c => c.resourceIds.includes(r.id))!.id] })),
    decisions: graph.gaps.map(g => ({ id: g.id, title: 'Verify provider', recommendation: 'Verify exact operator configuration contract', rationale: g.message, evidenceIds: g.evidence, resolves: [g.id], componentIds: [] })), inputs: [],
    operations: (['availability', 'backup', 'observability', 'security', 'delivery', 'cost'] as const).map(concern => ({ concern, recommendation: 'Validate platform contract', rationale: 'External deployment owner', componentIds: [], evidenceIds: [] })),
  };
}

describe('separate physical deployment topology', () => {
  it('uses the selected cloud for additions while preserving existing provider contracts', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance });
    for (const [cloud, edge, vault] of [['aws', 'CloudFront', 'Secrets Manager'], ['gcp', 'Cloud Armor', 'Secret Manager']] as const) {
      const topology = buildDeploymentTopology(graph, graph.deploymentUnits.map(u => u.id), undefined, cloud);
      expect(topology.nodes.find(n => n.id === 'target-edge-waf')?.technology).toContain(edge);
      expect(topology.nodes.find(n => n.id === 'target-vault')?.technology).toContain(vault);
      expect(topology.nodes.some(n => n.basis === 'recommendation' && /Azure/.test(n.technology))).toBe(false);
      expect(topology.nodes.some(n => n.technology.includes('azure-search'))).toBe(true);
      expect(() => buildCortexDeploymentBundle(graph, { ...planFor(graph), provider: cloud })).toThrow('supports Azure only');
    }
  });
  const draft = (graph: RepositoryArchitecture, edits: DesignEdit[] = []): ArchitectureDesign => ({ version: 1, id: 'd'.repeat(64), architectureId: graph.id, unitIds: graph.deploymentUnits.map(u => u.id), revision: edits.length, edits, createdAt: '', updatedAt: '' });
  it('does not export Cortex 2 definitions through the legacy CortexApp compiler even when the source filename is shared', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance });
    graph.deploymentContext.push({ file: 'deploy/prod/definition.yaml', content: JSON.stringify({
      apiVersion: definition.apiVersion, kind: 'ApplicationDefinition', metadata: { name: 'current-platform-app' },
      spec: { applicationId: 'insight', infrastructure: { mode: 'Terraform' }, capabilities: { cookiePolicy: 'StripAll' } },
    }), redacted: true });
    for (const design of [undefined, draft(graph)]) {
      const files = buildCortexDeploymentBundle(graph, planFor(graph), design);
      const manifests = Object.entries(files).filter(([path]) => path.startsWith('support/cortex/')).map(([, body]) => JSON.parse(body));
      expect(manifests.map(m => m.metadata.name).sort()).toEqual(['app-v2', 'sample']);
    }
  });
  it('creates a proposed edge and vault without waiting for a second model review and selects an explicit environment', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance, 'deploy/preprod/definition.yaml': definition, 'deploy/preprod/instances/app.yaml': instance });
    expect(chooseDeploymentScope(graph).unitIds).toEqual(['cortex:deploy/prod']);
    expect(chooseDeploymentScope(graph, 'preprod').unitIds).toEqual(['cortex:deploy/preprod']);
    expect(chooseDeploymentScope(graph, 'qa').requiresChoice).toBe(true);
    const topology = buildDeploymentTopology(graph, ['cortex:deploy/prod']);
    expect(topology.nodes.find(n => n.id === 'target-edge-waf')?.basis).toBe('recommendation');
    expect(topology.nodes.find(n => n.id === 'target-vault')?.basis).toBe('recommendation');
  });
  it('exports changed replicas and image overrides, a new workload, rewired URLs and removals while retaining immutable evidence', async () => {
    const d = structuredClone(definition) as any;
    d.spec.components[0].env = [{ name: 'API_URL', value: 'http://$(CORTEX_APP_NAME)-backend:8000/v1' }];
    const graph = await fixture({ 'deploy/prod/definition.yaml': d, 'deploy/prod/instances/app.yaml': instance });
    const before = JSON.stringify(graph), base = buildDeploymentTopology(graph, draft(graph).unitIds);
    const front = base.workloads.find(w => w.name === 'sample-frontend')!.id, backend = base.workloads.find(w => w.name === 'sample-backend')!.id;
    const edge = base.connections.find(e => e.from === front && e.to === backend && e.purpose.includes('API_URL'))!;
    const design = draft(graph, [
      { type: 'update-component', id: front, fields: {}, replicas: 4, image: 'registry.test/web:reviewed' },
      { type: 'add-component', id: 'user-api', fields: { name: 'New API', kind: 'application', technology: 'Container workload', layer: 'runtime', owner: 'Cortex operator', description: 'Replacement API' }, workload: { componentName: 'new-api', image: 'registry.test/api:v2', replicas: 3, port: 8080, exposed: false } },
      { type: 'put-connection', connection: { id: edge.id, from: front, to: 'user-api', purpose: 'API requests', binding: { type: 'environment', key: 'API_URL', protocol: 'http', port: 8080 } } },
      { type: 'remove-component', id: backend },
    ]);
    expect(inspectArchitectureDesign(graph, design).filter(i => i.severity === 'blocker')).toEqual([]);
    const files = buildCortexDeploymentBundle(graph, planFor(graph), design);
    const manifests = Object.keys(files).filter(f => f.startsWith('support/cortex/')).map(f => JSON.parse(files[f]));
    const exported = manifests.find(m => m.kind === 'ApplicationDefinition'), app = manifests.find(m => m.kind === 'CortexApp');
    expect(exported.spec.components.map((c: any) => c.name)).toEqual(['frontend', 'indexer', 'new-api']);
    expect(exported.spec.components[0]).toMatchObject({ replicas: 4, image: 'registry.test/web:reviewed', env: [{ name: 'API_URL', value: 'http://$(CORTEX_APP_NAME)-new-api:8080/v1' }] });
    expect(app.spec.componentImageTags.frontend).toBeUndefined();
    expect(JSON.parse(files['deployment-topology.json']).totals.applicationPods).toBe(13);
    expect(JSON.parse(files['architecture-design.json']).revision).toBe(4);
    expect(JSON.parse(files['repository-resource-ownership.json']).find((r: any) => r.resourceId === backend).implementation).toContain('Removed');
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('supports capability additions using an observed provider contract and compiles capability connections', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance });
    const base = buildDeploymentTopology(graph, draft(graph).unitIds), backend = base.workloads.find(w => w.name === 'sample-backend')!.id;
    const source = graph.resources.find(r => r.attributes.provider === 'azure-redis')!;
    const design = draft(graph, [
      { type: 'add-component', id: 'new-cache', fields: { name: 'Session cache', kind: 'cache', technology: source.technology, layer: 'data', owner: 'Cortex operator', description: 'Dedicated session cache' }, capability: { templateResourceId: source.id, capabilityId: 'session-cache', config: { defaultParams: { sku: 'Standard' } }, parameters: { capacity: '1' } } },
      { type: 'put-connection', connection: { id: 'use-session-cache', from: backend, to: 'new-cache', purpose: 'Session storage', binding: { type: 'capability' } } },
    ]);
    const files = buildCortexDeploymentBundle(graph, planFor(graph), design);
    const manifests = Object.keys(files).filter(f => f.startsWith('support/cortex/')).map(f => JSON.parse(files[f]));
    expect(manifests.find(m => m.kind === 'ApplicationDefinition').spec.capabilities.at(-1)).toMatchObject({ id: 'session-cache', name: 'azure-redis' });
    expect(manifests.find(m => m.kind === 'ApplicationDefinition').spec.components.find((c: any) => c.name === 'backend').uses).toContain('session-cache');
    expect(manifests.find(m => m.kind === 'CortexApp').spec.capabilityProvisioningConfig['session-cache']).toEqual({ params: { capacity: '1' } });
  });
  it('does not silently export unsupported migrations, disconnected managed origins or unimplemented custom additions', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance });
    const base = buildDeploymentTopology(graph, draft(graph).unitIds);
    const edge = base.connections.find(e => e.from === 'target-edge-waf')!;
    const changed = draft(graph, [{ type: 'remove-connection', id: edge.id }]);
    expect(inspectArchitectureDesign(graph, changed).some(i => i.severity === 'blocker')).toBe(true);
    expect(() => buildCortexDeploymentBundle(graph, planFor(graph), changed)).toThrow('origin');
    const custom = draft(graph, [{ type: 'add-component', id: 'custom', fields: { name: 'Custom store', kind: 'database', technology: 'Custom database', layer: 'data', owner: 'Terraform / Bicep', description: '' } }]);
    expect(() => buildCortexDeploymentBundle(graph, planFor(graph), custom)).toThrow('infrastructure implementation');
    const withoutEdge = draft(graph, [{ type: 'remove-component', id: 'target-edge-waf' }]);
    const files = buildCortexDeploymentBundle(graph, planFor(graph), withoutEdge);
    expect(JSON.parse(files['architecture.arm.json']).resources.some((r: any) => r.type.startsWith('Microsoft.Cdn'))).toBe(false);
    expect(materializeArchitectureDesign(graph, withoutEdge).controls.find(c => c.id === 'edge-waf')?.decision).toBe('not-selected');
  });
  it('counts replicas per pod template, preserves init placement, instance tags and distinct cache capabilities', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance, 'deploy/qa/definition.yaml': definition, 'deploy/qa/instances/app.yaml': instance });
    const topology = buildDeploymentTopology(graph, ['cortex:deploy/prod']);
    expect(topology.totals).toEqual({ workloads: 3, applicationPods: 10, unspecifiedWorkloads: 0, applicationContainers: 10, initContainers: 1 });
    expect(topology.workloads.find(w => w.name === 'sample-backend')!.containers.map(c => c.role)).toEqual(['application', 'init']);
    expect(topology.workloads.find(w => w.name === 'sample-frontend')!.containers[0].image).toBe('registry.test:5000/web:pinned');
    expect(topology.nodes.filter(n => n.kind === 'cache').map(n => n.name).sort()).toEqual(['cache', 'redis']);
    expect(topology.nodes.find(n => n.name === 'search')!.details).toContain('Replicas: 2');
    expect(topology.nodes.find(n => n.name === 'main-db')!.details.join()).toContain('not declared');
    expect(topology.nodes.every(n => !n.id.includes('deploy/qa'))).toBe(true);
  });
  it('keeps multiple containers together and applies the documented Kubernetes replica default', async () => {
    const deployment = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', namespace: 'prod' }, spec: { replicas: 3, selector: { matchLabels: { app: 'api' } }, template: { metadata: { labels: { app: 'api' } }, spec: { containers: [{ name: 'api', image: 'api:v1' }, { name: 'proxy', image: 'proxy:v1' }], initContainers: [{ name: 'bootstrap', image: 'bootstrap:v1' }] } } } };
    const unknown = structuredClone(deployment) as any; unknown.metadata.name = 'worker'; delete unknown.spec.replicas;
    const graph = await fixture({ 'deploy/prod/api.yaml': deployment, 'deploy/prod/worker.yaml': unknown });
    const topology = buildDeploymentTopology(graph, graph.deploymentUnits.map(u => u.id));
    expect(topology.workloads).toHaveLength(2);
    expect(topology.totals.applicationPods).toBe(4);
    expect(topology.totals.applicationContainers).toBe(8);
    expect(topology.totals.unspecifiedWorkloads).toBe(0);
    expect(topology.workloads.find(w => w.name === 'worker')?.countNote).toBe('Kubernetes default: replicas omitted');
    expect(topology.workloads.find(w => w.name === 'api')!.containers).toHaveLength(3);
  });
  it('separates batch parallelism, autoscaling bounds and node-dependent DaemonSets from steady replicas', async () => {
    const pod = { containers: [{ name: 'app', image: 'app:v1' }], initContainers: [{ name: 'init', image: 'app:v1' }] };
    const graph = await fixture({ 'deploy/prod/all.yaml': { kind: 'List', apiVersion: 'v1', items: [
      { kind: 'Deployment', apiVersion: 'apps/v1', metadata: { name: 'api' }, spec: { replicas: 3, template: { spec: pod } } },
      { kind: 'HorizontalPodAutoscaler', apiVersion: 'autoscaling/v2', metadata: { name: 'api' }, spec: { scaleTargetRef: { kind: 'Deployment', name: 'api' }, minReplicas: 2, maxReplicas: 8 } },
      { kind: 'Job', apiVersion: 'batch/v1', metadata: { name: 'migration' }, spec: { parallelism: 2, template: { spec: pod } } },
      { kind: 'CronJob', apiVersion: 'batch/v1', metadata: { name: 'cleanup' }, spec: { jobTemplate: { spec: { template: { spec: pod } } } } },
      { kind: 'DaemonSet', apiVersion: 'apps/v1', metadata: { name: 'agent' }, spec: { template: { spec: pod } } },
    ] } });
    const topology = buildDeploymentTopology(graph, graph.deploymentUnits.map(u=>u.id));
    expect(deploymentCountSummary(topology)).toMatchObject({ applicationPods: 3, applicationContainers: 3, steadyWorkloads: 2, batchJobs: 2, unspecifiedWorkloads: 1, minPods: 2, maxPods: 8 });
    expect(topology.workloads.find(w=>w.name==='migration')?.jobParallelism).toBe(2);
    expect(topology.workloads.find(w=>w.name==='cleanup')?.jobParallelism).toBe(1);
    expect(topology.workloads.find(w=>w.name==='agent')?.replicas).toBeNull();
  });
  it('connects Gateway API HTTPRoutes to their actual backend Services', async () => {
    const graph = await fixture({ 'deploy/prod/route.yaml': { apiVersion: 'gateway.networking.k8s.io/v1', kind: 'HTTPRoute', metadata: { name: 'api' }, spec: { rules: [{ backendRefs: [{ name: 'api', port: 80 }] }] } }, 'deploy/prod/service.yaml': { apiVersion: 'v1', kind: 'Service', metadata: { name: 'api' }, spec: { ports: [{ port: 80 }] } } });
    const topology = buildDeploymentTopology(graph, graph.deploymentUnits.map(u=>u.id));
    const route = topology.nodes.find(n=>n.technology.endsWith('/HTTPRoute'))!, service = topology.nodes.find(n=>n.technology.endsWith('/Service'))!;
    expect(topology.connections).toContainEqual(expect.objectContaining({ from: route.id, to: service.id, purpose: 'routes HTTP to' }));
  });
  it('exports original operator contracts, proposed Azure additions and explicit platform checks without fictitious ARM workloads', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance });
    const plan = planFor(graph);
    const files = buildCortexDeploymentBundle(graph, plan);
    const preserved = Object.keys(files).filter(f => f.startsWith('support/cortex/')).map(f => JSON.parse(files[f]));
    expect(preserved).toEqual(deploymentDocuments(graph, plan.unitIds).map(d => d.value));
    const arm = JSON.parse(files['architecture.arm.json']);
    expect(arm.resources.some((r: any) => /managedClusters|flexibleServers|containerApps|redis/i.test(r.type))).toBe(false);
    expect(arm.resources.some((r: any) => r.type === 'Microsoft.Cdn/profiles/securityPolicies')).toBe(true);
    expect(arm.resources.some((r: any) => r.type === 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials')).toBe(true);
    expect(arm.resources.some((r: any) => r.type === 'Microsoft.Network/privateEndpoints')).toBe(true);
    const sync = JSON.parse(files['support/secret-sync.template.json']);
    expect(sync.items.find((r: any) => r.kind === 'ExternalSecret').spec.data).toEqual([{ secretKey: 'jwt-secret', remoteRef: { key: 'jwt-secret' } }]);
    expect(JSON.parse(files['configuration-coverage.json']).map((c: any) => c.bindingId).sort()).toEqual(graph.bindings.map(b => b.id).sort());
    expect(JSON.parse(files['deployment-topology.json'])).toEqual(buildDeploymentTopology(graph, plan.unitIds, plan));
    expect(JSON.parse(files['deployment-readiness.json']).status).toBe('platform-validation-required');
    expect(files['workload.bicep']).toContain("loadJsonContent('./architecture.arm.json')");
    expect(files['main.tf.json']).toContain('architecture.arm.json');
  });
  it('does not turn development-only reviews into runtime resources or let a runtime component hide as tooling', async () => {
    const graph = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance });
    const plan = planFor(graph), first = plan.components[0];
    expect(isRepositoryOnlyComponent(plan, first.id)).toBe(false);
    first.deployment = 'repository-only';
    expect(() => validateArchitecturePlan(plan, graph)).toThrow('development-only');
    for (const decision of plan.resourceDecisions) if (decision.componentIds.includes(first.id)) decision.disposition = 'development-only';
    expect(isRepositoryOnlyComponent(plan, first.id)).toBe(true);
  });
  it('fails closed for redacted literals and multiple application instances', async () => {
    const d = structuredClone(definition) as any;
    d.spec.components[0].env = [{ name: 'PASSWORD', value: 'not-for-export' }];
    const graph = await fixture({ 'deploy/prod/definition.yaml': d, 'deploy/prod/instances/app.yaml': instance });
    expect(() => buildCortexDeploymentBundle(graph, planFor(graph))).toThrow('redacted literal');
    const many = await fixture({ 'deploy/prod/definition.yaml': definition, 'deploy/prod/instances/app.yaml': instance, 'deploy/prod/instances/second.yaml': { ...instance, metadata: { name: 'second', namespace: 'another' } } });
    expect(() => buildCortexDeploymentBundle(many, planFor(many))).toThrow('one resolved');
  });
});
