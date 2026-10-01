import { describe, expect, it, vi } from 'vitest';
import { collectCortexTerraform } from '../../../packages/core/src/architecture/cortex-native';
import { compileNativeCortexEdits } from '../../../packages/core/src/architecture/cortex-native-design';
import { consolidateImplementationReviews } from '../../../packages/core/src/architecture/planner';
import { terraformSizingResolver } from '../../../packages/core/src/architecture/terraform-sizing';

describe('native Cortex export', () => {
  it('includes disabled local modules, recursive dependencies and static templates', async () => {
    const files = {
      'infra/tenant/apps.tf': 'module "active" {\n source = "./app/active"\n}\nmodule "disabled" {\n source = "./app/disabled"\n count = 0\n}',
      'infra/tenant/app/active/main.tf': 'module "shared" {\n source = "../../../modules/shared"\n}',
      'infra/tenant/app/disabled/main.tf': 'locals { content = templatefile("${path.module}/settings.json", {}) }',
      'infra/tenant/app/disabled/settings.json': '{"enabled":false}',
      'infra/modules/shared/main.tf': 'resource "azurerm_resource_group" "app" {}',
    };
    const result = await collectCortexTerraform({ revision: 'a'.repeat(40), files: Object.keys(files), read: async f => files[f as keyof typeof files] }, ['infra/tenant']);
    expect(result).toEqual(files);
  });
  it('rejects module paths that leave the snapshot and unpinned remote modules', async () => {
    for (const source of ['../../../../outside', 'registry/module/cloud']) await expect(collectCortexTerraform({ revision: 'a'.repeat(40), files: ['infra/tenant/main.tf'], read: async () => `module "unsafe" {\n source = "${source}"\n}` }, ['infra/tenant'])).rejects.toThrow();
  });
  it('maps a pod edit to the actual Helm setting and refuses ambiguous templates', () => {
    const graph = { evidence: [{ id: 'ev', derivedFrom: ['services/rag/chart/templates/indexer.yaml'] }], deploymentContext: [{ file: 'cortex/services/rag/chart/templates/indexer.yaml', content: 'kind: Deployment\nspec:\n  replicas: {{ .Values.indexer.replicas | default 1 }}\n' }], deploymentPreparation: { charts: [{ applicationId: 'rag', path: 'services/rag/chart' }] } };
    const topology = { nodes: [], workloads: [{ id: 'indexer', name: 'indexer', controller: 'Deployment', evidenceIds: ['ev'] }] };
    const design = { edits: [{ type: 'update-component', id: 'indexer', replicas: 7, fields: {} }] };
    expect(compileNativeCortexEdits(graph as never, design as never, topology as never)).toEqual({ issues: [], overrides: { rag: { indexer: { replicas: 7 } } } });
    graph.deploymentContext[0].content += '\nkind: Deployment\nspec:\n  replicas: {{ .Values.other.replicas }}\n';
    expect(compileNativeCortexEdits(graph as never, design as never, topology as never).issues[0].severity).toBe('blocker');
  });
  it('labels actual module sizing defaults and never substitutes them for caller overrides', () => {
    const graph = { deploymentContext: [{file:'infra/tenant/apps.tf',content:'module "app" {\n source = "./app/insight"\n}'},{file:'infra/tenant/app/insight/variables.tf',content:'variable "sku" {\n default = "GP_Standard_D4ds_v5"\n}'}] };
    const resource = {scope:'infra/tenant/app/insight'};
    expect(terraformSizingResolver(graph as never)(resource as never,'var.sku')).toEqual({value:'GP_Standard_D4ds_v5',defaulted:true});
    graph.deploymentContext[0].content='module "app" {\n source = "./app/insight"\n sku = var.tenant_sku\n}';
    expect(terraformSizingResolver(graph as never)(resource as never,'var.sku')).toEqual({value:'var.tenant_sku',defaulted:false});
  });
});

describe('complete review consolidation', () => {
  const reviews = [{ role: 'selected', file: 'chart.yaml', findings: 'Keep declared workloads', evidenceIds: [] }];
  it('uses the actual context budget instead of rejecting a complete summary at an arbitrary 14k limit', async () => {
    const client = { analyzeStructured: vi.fn(async () => ({ result: { groups: [{ partIds: ['F1'], constraints: 'x'.repeat(15000) }] } })) };
    const result = await consolidateImplementationReviews(reviews as never, client as never, 20000);
    expect(result.context.groups[0].constraints.length).toBe(15000);
    expect(result.context.parts).toHaveLength(1);
  });
  it('still requires every part and repairs oversized summaries without silently truncating', async () => {
    const client = { analyzeStructured: vi.fn().mockResolvedValueOnce({ result: { groups: [{ partIds: ['F1'], constraints: 'x'.repeat(21000) }] } }).mockResolvedValueOnce({ result: { groups: [{ partIds: ['F1'], constraints: 'Exact owner and concrete deployment constraints retained' }] } }), invalidateStructuredResponse: vi.fn() };
    const result = await consolidateImplementationReviews(reviews as never, client as never, 20000);
    expect(result.calls).toBe(2);
    expect(client.invalidateStructuredResponse).toHaveBeenCalledOnce();
    const missing = { analyzeStructured: vi.fn(async () => ({ result: { groups: [{ partIds: ['F2'], constraints: 'Wrong source' }] } })) };
    await expect(consolidateImplementationReviews(reviews as never, missing as never)).rejects.toThrow('cover every implementation part');
  });
});
