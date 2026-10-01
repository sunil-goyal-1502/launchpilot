import { describe, expect, it } from 'vitest';
import type { DeploymentNode, DeploymentTopology, RepositoryArchitecture } from '@launchpilot/core';
import { deploymentPresentation } from '../../../packages/web/src/components/infrastructure/deployment-presentation';
const node = (id: string, technology: string, layer: DeploymentNode['layer'] = 'runtime'): DeploymentNode => ({ id, name: id, kind: 'application', technology, layer, basis: 'repository', owner: 'manifest', details: [], resourceIds: [id], evidenceIds: [] });
const graph = { resources: [], evidence: [] } as unknown as RepositoryArchitecture;
describe('deployment diagram aggregation', () => {
  it('merges a Service with its sole selected workload and preserves all paths and resources', () => {
    const topology = { nodes: [node('api', 'apps/v1/Deployment'), node('service', 'v1/Service', 'routing'), node('route', 'gateway.networking.k8s.io/v1/HTTPRoute', 'routing'), node('db', 'azurerm_postgresql_flexible_server', 'data')], workloads: [{ id: 'api' }], connections: [
      { id: 'selector', from: 'service', to: 'api', purpose: 'selects pods by labels', evidenceIds: [] },
      { id: 'ingress', from: 'route', to: 'service', purpose: 'routes HTTP to', evidenceIds: [] },
      { id: 'query', from: 'api', to: 'db', purpose: 'queries', evidenceIds: [] },
    ] } as unknown as DeploymentTopology;
    const result = deploymentPresentation(topology, graph);
    expect(result.cards.find(c => c.id === 'api')?.memberIds).toEqual(['api', 'service']);
    expect(result.cards.flatMap(c => c.memberIds).sort()).toEqual(topology.nodes.map(n => n.id).sort());
    expect(result.connections.find(e => e.connectionIds.includes('ingress'))?.to).toBe('api');
    expect(result.connections.find(e => e.connectionIds.includes('query'))).toMatchObject({ from: 'api', to: 'db' });
    expect(topology.nodes).toHaveLength(4);
  });
  it('does not merge a Service selecting multiple independent workloads', () => {
    const topology = { nodes: [node('a', 'apps/v1/Deployment'), node('b', 'apps/v1/Deployment'), node('service', 'v1/Service', 'routing')], workloads: [{ id: 'a' }, { id: 'b' }], connections: ['a','b'].map(to => ({ id: to, from: 'service', to, purpose: 'selects pods by labels', evidenceIds: [] })) } as unknown as DeploymentTopology;
    expect(deploymentPresentation(topology, graph).cards).toHaveLength(3);
  });
});
