import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { normalizeCortexPreview } from '../../../packages/core/src/architecture/cortex-platform';
import { appendCortexOutputWiring } from '../../../packages/core/src/architecture/cortex-wiring';
import type { RepositoryArchitecture } from '@launchpilot/core';
describe('Cortex Helm preview context', () => {
  it('applies the release namespace to known namespaced kinds without changing counts or cluster resources', () => {
    const output = normalizeCortexPreview(`---
# Source: app/templates/workload.yaml
apiVersion: apps/v1
kind: Deployment
metadata: {name: api}
spec: {replicas: 6}
---
apiVersion: v1
kind: Service
metadata: {name: api, namespace: explicit}
---
apiVersion: v1
kind: Namespace
metadata: {name: tenant}
---
apiVersion: custom.test/v1
kind: UnknownContract
metadata: {name: resource}
`, 'launchpilot-preview');
    const docs = parseAllDocuments(output).map(d=>d.toJS()).filter(Boolean);
    expect(docs[0].metadata.namespace).toBe('launchpilot-preview');
    expect(docs[0].spec.replicas).toBe(6);
    expect(docs[1].metadata.namespace).toBe('explicit');
    expect(docs[2].metadata.namespace).toBeUndefined();
    expect(docs[3].metadata.namespace).toBeUndefined();
    expect(output).toContain('# Source: app/templates/workload.yaml');
  });
  it('rejects invalid rendered manifests instead of saving an incomplete diagram', () => {
    expect(()=>normalizeCortexPreview('kind: [broken', 'preview')).toThrow('invalid YAML');
  });
  it('connects rendered consumers to their actual Terraform outputs, including uniquely named endpoint producers', () => {
    const graph = { resources: [
      { id: 'pod', name: 'indexer', technology: 'apps/v1/Deployment', scope: 'review/prod', evidence: ['pod-source'] },
      { id: 'db', name: 'azurerm_postgresql_flexible_server.app', technology: 'azurerm_postgresql_flexible_server', scope: 'infra/tenant/app/rag', evidence: [] },
      { id: 'search', name: 'azurerm_search_service.app', technology: 'azurerm_search_service', scope: 'infra/tenant/app/rag', evidence: [] },
    ], evidence: [{ id: 'pod-source', file: 'review/prod/rag.preview.yaml' }], bindings: [], connections: [] } as unknown as RepositoryArchitecture;
    const outputs = 'output "configmap" {\n  value = {\n    postgresHost = azurerm_postgresql_flexible_server.app.fqdn\n    searchEndpoint = "https://${local.search_name}.search.windows.net"\n    tenantId = var.tenant_id\n  }\n}\n';
    appendCortexOutputWiring(graph, { applicationId: 'rag', outputFile: 'infra/tenant/app/rag/outputs.tf', outputs,
      terraform: [{ file: 'infra/tenant/app/rag/search.tf', content: 'resource "azurerm_search_service" "app" {\n  name = local.search_name\n}' }],
      renderedFile: 'review/prod/rag.preview.yaml', rendered: 'apiVersion: apps/v1\nkind: Deployment\nmetadata: {name: indexer}\nspec:\n  template:\n    spec:\n      containers:\n      - name: indexer\n        env:\n        - {name: DB_HOST, value: UNRESOLVED_postgresHost}\n        - {name: SEARCH_URL, value: UNRESOLVED_searchEndpoint}\n        - {name: TENANT_ID, value: UNRESOLVED_tenantId}\n        - {name: PASSWORD, value: do-not-copy-value}\n',
    });
    expect(graph.connections.map(e=>[e.from,e.to])).toEqual([['pod','db'],['pod','search']]);
    expect(graph.bindings.find(b=>b.key==='appInfra.tenantId')?.resolved).toBe(false);
    expect(graph.evidence.find(e=>e.summary?.includes('appInfra.postgresHost'))?.line).toBe(3);
    expect(JSON.stringify(graph)).not.toContain('do-not-copy-value');
  });
});
