import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { scanRepositoryArchitecture } from '../../../packages/core/src/architecture/scanner';
import { selectArchitectureScope } from '../../../packages/core/src/architecture/planner';
import { groupArchitectureResources, summarizeConnections, connectionCategory } from '../../../packages/web/src/components/infrastructure/architecture-groups';
import { layoutArchitecture, traceArchitectureColumns } from '../../../packages/web/src/components/infrastructure/architecture-layout';

describe('deployment diagram', () => {
  it('spreads a large workload neighborhood across horizontal columns without dropping components', () => {
    const items = ['frontend', 'bff', 'backend', 'agent', 'cortex', 'indexer', 'llm', 'translation', 'simulator'].map(id => ({ id, kind: 'application' }));
    const links = [{ from: 'frontend', to: 'bff' }, ...items.slice(2).map(item => ({ from: 'bff', to: item.id }))];
    const trace = traceArchitectureColumns(items, links, 'bff');
    expect(new Set(trace.items.map(item => item.id))).toEqual(new Set(items.map(item => item.id)));
    expect(trace.columns.every(column => column.items.length <= 3)).toBe(true);
    expect(trace.columns[0].items.map(item => item.id)).toEqual(['frontend']);
    expect(trace.columns[1].items.map(item => item.id)).toEqual(['bff']);
    expect(layoutArchitecture(trace.items, links.map((link, i) => ({ ...link, id: String(i), flow: 'traffic', label: 'HTTP' }))).edges).toHaveLength(links.length);
  });
  it('retains configuration delivery direction and categories through repeated overview aggregation', () => {
    const connections = ['loads DATABASE_URL', 'loads API_KEY'].map((relationship, i) => ({ id: String(i), from: 'app', to: 'secret', relationship, evidence: [String(i)], connectionIds: [String(i)] }));
    const combined = summarizeConnections(connections)[0];
    expect(combined.relationship).toBe('loads configuration (2 paths)');
    expect(combined.connectionIds).toEqual(['0', '1']);
    expect(connectionCategory('platform (3 paths)')).toBe('platform');
    expect(connectionCategory('uses identity (3 paths)')).toBe('identity');
    expect(connectionCategory(combined.relationship)).toBe('configuration');
  });
  it('combines a proven workload with its dedicated routing and identity while retaining all evidence and external links', async () => {
    const graph = await scanRepositoryArchitecture(join(process.cwd(), 'tests/fixtures/evidence-app'), 'local://fixture');
    const scoped = selectArchitectureScope(graph, ['kubernetes:deploy/prod']);
    const resources = scoped.resources.filter(r => r.origin !== 'code');
    const view = groupArchitectureResources(resources, graph.connections);
    expect(resources).toHaveLength(8);
    expect(view.resources).toHaveLength(5);
    const app = view.resources.find(r => r.kind === 'application')!;
    expect(app.facets.sort()).toEqual(['Deployment', 'Ingress', 'Service', 'ServiceAccount']);
    expect(app.memberIds).toHaveLength(4);
    expect(app.evidence).toHaveLength(4);
    expect(view.internalConnections.map(e => e.relationship).sort()).toEqual(['routes HTTP to', 'selects pods by labels', 'uses identity']);
    expect(view.connections.some(e => e.from === app.id && e.relationship.startsWith('loads DATABASE_URL'))).toBe(true);
    expect(view.connections.every(e => e.from !== e.to)).toBe(true);
    expect(new Set(view.resources.flatMap(r => r.memberIds))).toEqual(new Set(resources.map(r => r.id)));
    expect(groupArchitectureResources(resources, graph.connections, false).resources).toHaveLength(8);
  });
  it('keeps shared services and identities distinct and never combines resources by name alone', async () => {
    const graph = await scanRepositoryArchitecture(join(process.cwd(), 'tests/fixtures/evidence-app'), 'local://fixture');
    const app = graph.resources.find(r => /\/Deployment$/.test(r.technology))!;
    const shared = graph.resources.find(r => /\/ServiceAccount$/.test(r.technology))!;
    const service = graph.resources.find(r => /\/Service$/.test(r.technology))!;
    const second = { ...app, id: app.id + '-second' };
    const view = groupArchitectureResources([...graph.resources, second], [...graph.connections,
      { id: 'shared-identity', from: second.id, to: shared.id, relationship: 'uses identity', evidence: [] },
      { id: 'shared-service', from: service.id, to: second.id, relationship: 'selects pods by labels', evidence: [] },
    ]);
    expect(view.resources.find(r => r.id === shared.id)?.memberIds).toEqual([shared.id]);
    expect(view.resources.find(r => r.id === service.id)?.memberIds).toEqual([service.id]);
    expect(view.resources.find(r => r.id === second.id)?.memberIds).toEqual([second.id]);
  });
  it('aligns layers and routes forward, reverse and same-layer connections around every card', () => {
    const result = layoutArchitecture([
      { id: 'identity', stage: 0, row: 1 }, { id: 'vault', stage: 0, row: 0 },
      { id: 'app', stage: 1, row: 0 }, { id: 'db', stage: 2, row: 0 }, { id: 'cache', stage: 2, row: 1 },
    ], [
      { id: 'db-call', from: 'app', to: 'db', flow: 'traffic', label: 'PostgreSQL' },
      { id: 'cache-call', from: 'app', to: 'cache', flow: 'traffic', label: 'Redis' },
      { id: 'read-vault', from: 'app', to: 'vault', flow: 'configuration', label: 'Secret retrieval' },
      { id: 'vault-access', from: 'identity', to: 'vault', flow: 'identity', label: 'Secret access' },
    ]);
    expect(result.nodes.find(n => n.id === 'db')?.x).toBe(result.nodes.find(n => n.id === 'cache')?.x);
    expect(result.edges).toHaveLength(4);
    for (const edge of result.edges) for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1], b = edge.points[i];
      expect(a.x === b.x || a.y === b.y).toBe(true);
      for (const n of result.nodes) {
        const crosses = a.x === b.x ? a.x > n.x && a.x < n.x + n.width && Math.min(a.y, b.y) < n.y + n.height && Math.max(a.y, b.y) > n.y : a.y > n.y && a.y < n.y + n.height && Math.min(a.x, b.x) < n.x + n.width && Math.max(a.x, b.x) > n.x;
        expect(crosses, `${edge.id} crosses ${n.id}`).toBe(false);
      }
    }
  });
});
