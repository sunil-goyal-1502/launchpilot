import { describe, it, expect, vi } from 'vitest';
import type { RepositoryArchitecture } from '../../../packages/core/src/types/architecture';
import { validateArchitecturePlan, recommendArchitecture, configurationReviewBatches, reviewConfigurationBatches, architecturePlanSchema, repairPlanEnums, attachResourceEvidence, type GroundedArchitecturePlan } from '../../../packages/core/src/architecture/planner';
import { validateArchitectureArtifact, buildArchitectureBundle, zipArchitectureBundle, type ArchitectureArtifact } from '../../../packages/core/src/architecture/iac';
import { encodePlanningContext, decodePlanningContext, translatePlanningIds } from '../../../packages/core/src/architecture/planning-context';
import { unzipSync, strFromU8 } from 'fflate';

function graph(): RepositoryArchitecture {
  return { version: 1, id: 'a'.repeat(64), repoUrl: 'local://fixture', revision: null, scannedAt: '2026-09-26', deploymentContext: [],
    resources: [{ id: 'app', name: 'api', kind: 'application', technology: 'Docker', scope: '.', origin: 'declared', evidence: ['ev-app'], attributes: {} }],
    evidence: [{ id: 'ev-app', file: 'compose.yaml', line: 1, endLine: 8, kind: 'deployment', summary: 'Application container' }], connections: [],
    bindings: [{ id: 'db-config', consumerId: 'app', key: 'DATABASE_URL', source: 'environment', sensitive: true, evidence: ['ev-app'], resolved: false }],
    deploymentUnits: [], gaps: [{ id: 'config-gap', code: 'configuration-input', message: 'Connection string input required', severity: 'warning', evidence: ['ev-app'] }], recommendations: [],
    coverage: { filesScanned: 1, deploymentFiles: 1, files: [], excluded: [], limits: { maxFiles: 100, maxFileBytes: 1000, maxTotalBytes: 10000 }, truncated: false, runtimeVerified: false },
  };
}
function plan(): GroundedArchitecturePlan {
  return { architectReviewVersion:1, id: 'b'.repeat(64), architectureId: 'a'.repeat(64), provider: 'azure', unitIds: [], model: 'test', createdAt: '', evidenceCoverage: { resources: 1, bindings: 1, decisions: 1 }, summary: 'Application using an externally managed database connection',
    components: [{ id: 'api', name: 'API', kind: 'application', technology: 'Azure Container Apps', basis: 'repository', deployment: 'provision', resourceIds: ['app'], evidenceIds: ['ev-app'], rationale: 'Host the evidenced workload' }, { id: 'database', name: 'Existing database', kind: 'database', technology: 'External PostgreSQL', basis: 'external', deployment: 'external', resourceIds: [], evidenceIds: [], rationale: 'Supply an explicit external database URL' }],
    connections: [{ from: 'api', to: 'database', basis: 'recommendation', purpose: 'TLS PostgreSQL', evidenceIds: ['ev-app'] }],
    configuration: [{ name: 'DATABASE_URL', consumerId: 'api', sourceId: 'database', delivery: 'Container App secret reference', secret: true, bindingIds: ['db-config'], evidenceIds: ['ev-app'], recommendation: 'Supply secret deployment input' }],
    decisions: [{ id: 'configure-db', title: 'Supply database endpoint', recommendation: 'Use a secure input', rationale: 'No provider is declared in the source', resolves: ['config-gap'], evidenceIds: ['ev-app'], componentIds: ['api', 'database'] }],
    resourceDecisions: [{ resourceId: 'app', disposition: 'include', componentIds: ['api'], reason: 'Preserved' }], inputs: [{ name: 'databaseUrl', description: 'Connection string', secret: true, evidenceIds: ['ev-app'] }],
    operations: (['availability', 'backup', 'observability', 'security', 'delivery', 'cost'] as const).map(concern => ({ concern, priority:'before-production' as const, limitation:'Deployment validation and physical placement need target inputs', impact:'Readiness is unverified', owner:'Platform owner', tradeoff:'Validation needs target access', verification:'Verify this revision in the selected target', topicIds: concern==='delivery' ? ['deployment-validation'] : [], recommendation: 'Explicit reviewed operation', rationale: 'Fixture operation', componentIds: ['api'], evidenceIds: ['ev-app'] })),
  };
}
function artifact(): ArchitectureArtifact {
  const resourceAddress = 'Microsoft.App/containerApps::api';
  return { id: 'c'.repeat(64), planId: 'b'.repeat(64), model: 'test', generatedAt: '', validation: { structural: true, cloudValidated: false, applied: false },
    supportingFiles: [],
    template: { $schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#', contentVersion: '1.0.0.0', parameters: { databaseUrl: { type: 'secureString' } }, resources: [{ type: 'Microsoft.App/containerApps', apiVersion: '2025-01-01', name: 'api', properties: { configuration: { secrets: [{ name: 'database-url', value: "[parameters('databaseUrl')]" }] }, template: { containers: [{ name: 'api', env: [{ name: 'DATABASE_URL', secretRef: 'database-url' }] }] } } }] },
    componentCoverage: [{ componentId: 'api', resourceAddresses: [resourceAddress], implementation: 'Container App' }, { componentId: 'database', resourceAddresses: [], implementation: 'External endpoint input' }],
    configurationCoverage: [{ name: 'DATABASE_URL', consumerId: 'api', resourceAddress, jsonPointer: '/properties/template/containers/0/env/0', explanation: 'Environment secret reference' }], deploymentSteps: ['Supply secure database URL and validate in target account'],
  };
}
describe('grounded plan and infrastructure completeness', () => {
  it('losslessly compresses repeated evidence while retaining optional fields and source text', () => {
    const source = graph();
    source.resources.push({ ...source.resources[0], id: 'second', attributes: { description: 'Reads environment variable DATABASE_URL' } });
    source.gaps.push({ id: 'code-gap', code: 'code-configuration-provider', scope: 'backend', message: 'Specify how DATABASE_URL reaches backend/src/settings.py; the same name occurs in deployment configuration, but source-to-workload ownership is not established.', severity: 'warning', evidence: ['ev-app'] });
    source.deploymentContext.push({ file: 'deploy.yaml', content: 'do not truncate any deployment definition', redacted: true });
    const encoded = encodePlanningContext(source);
    const restored = translatePlanningIds(decodePlanningContext(encoded.packet), encoded.originals);
    for (const key of ['resources', 'bindings', 'connections', 'evidence', 'gaps', 'deploymentContext'] as const) expect(restored[key]).toEqual(source[key]);
  });
  it('reviews a large scope in bounded batches and validates every original binding after merging', async () => {
    const source = graph();
    source.bindings = Array.from({ length: 241 }, (_, i) => ({ ...source.bindings[0], id: `binding-${i}` }));
    const grouped = configurationReviewBatches(source);
    expect(grouped.every(batch => batch.length <= 80)).toBe(true);
    expect(new Set(grouped.flat().map(binding => binding.id))).toEqual(new Set(source.bindings.map(binding => binding.id)));
    let batchCalls = 0;
    const client = { analyzeStructured: vi.fn(async (system: string, prompt: string) => {
      if (system.includes('SHARED-DESIGN pass')) {
        const { id, architectureId, provider, unitIds, model, createdAt, evidenceCoverage, ...body } = plan();
        return { result: { ...body, configuration: [] }, usage: { model: 'test' } };
      }
      batchCalls++;
      const packet = JSON.parse(prompt);
      const local = decodePlanningContext(packet.batch);
      return { result: { configuration: [{ ...plan().configuration[0], bindingIds: local.bindings.map((b: { id: string }) => b.id), evidenceIds: local.bindings[0].evidence }], inputs: [] }, usage: { model: 'test' } };
    }) };
    const result = await recommendArchitecture(source, [], client as never);
    expect(batchCalls).toBe(4);
    expect(result.reviewPasses).toBe(5);
    expect(result.configuration).toHaveLength(1);
    expect(new Set(result.configuration.flatMap(c => c.bindingIds))).toEqual(new Set(source.bindings.map(b => b.id)));
    expect(result.evidenceCoverage.bindings).toBe(241);
    expect(() => validateArchitecturePlan(result, source)).not.toThrow();
  });
  it('does not return a partial plan when a configuration batch omits its evidence', async () => {
    const source = graph();
    source.bindings = Array.from({ length: 181 }, (_, i) => ({ ...source.bindings[0], id: `binding-${i}` }));
    const client = { analyzeStructured: vi.fn(async (system: string) => {
      if (system.includes('SHARED-DESIGN pass')) {
        const { id, architectureId, provider, unitIds, model, createdAt, evidenceCoverage, ...body } = plan();
        return { result: { ...body, configuration: [] }, usage: { model: 'test' } };
      }
      return { result: { configuration: [], inputs: [] }, usage: { model: 'test' } };
    }) };
    await expect(recommendArchitecture(source, [], client as never)).rejects.toThrow('failed validation');
    expect(client.analyzeStructured.mock.calls.filter(([system]) => system.includes('SHARED-DESIGN pass'))).toHaveLength(1);
  });
  it('repairs only invalid enum values and derives missing citations from explicitly selected resources', async () => {
    const invalid: any = plan(); invalid.components[0].deployment = 'managed'; invalid.operations[0].concern = 'uptime';
    const { id, architectureId, provider, unitIds, model, createdAt, evidenceCoverage, ...body } = invalid;
    const parsed = architecturePlanSchema.safeParse(body); expect(parsed.success).toBe(false); if (parsed.success) return;
    const client = { analyzeStructured: vi.fn(async () => ({ result: { values: { F1: 'provision', F2: 'availability' } }, usage: { model: 'test' } })) };
    const repaired = await repairPlanEnums(body, parsed.error, client as never);
    expect(repaired.components[0].deployment).toBe('provision'); expect(repaired.operations[0].concern).toBe('availability');
    expect(repaired.resourceDecisions).toEqual(body.resourceDecisions);
    repaired.components[0].evidenceIds = [];
    expect(attachResourceEvidence(repaired, graph()).components[0].evidenceIds).toEqual(['ev-app']);
    const bad = { analyzeStructured: vi.fn(async () => ({ result: { values: { F1: 'invalid', F2: 'availability' } } })) };
    await expect(repairPlanEnums(body, parsed.error, bad as never)).rejects.toThrow('permitted value');
  });
  it('requests only missing bindings and keeps already validated configuration entries', async () => {
    const source = graph(); source.bindings = Array.from({ length: 3 }, (_, i) => ({ ...source.bindings[0], id: `binding-${i}` }));
    const sizes: number[] = [];
    const client = { analyzeStructured: vi.fn(async (_system: string, prompt: string) => {
      const local = decodePlanningContext(JSON.parse(prompt).batch); sizes.push(local.bindings.length);
      const covered = local.bindings.length === 3 ? local.bindings.slice(0, 2) : local.bindings;
      return { result: { configuration: [{ ...plan().configuration[0], bindingIds: covered.map((binding: {id: string}) => binding.id), evidenceIds: [] }], inputs: [] }, usage: { model: 'test' } };
    }) };
    const { id, architectureId, provider, unitIds, model, createdAt, evidenceCoverage, ...design } = plan();
    const result = await reviewConfigurationBatches(source, { ...design, configuration: [] }, client as never);
    expect(sizes).toEqual([3, 1]);
    expect(new Set(result.body.configuration.flatMap(c => c.bindingIds))).toEqual(new Set(source.bindings.map(b => b.id)));
    expect(result.body.configuration[0].evidenceIds).toEqual(['ev-app']);
  });
  it('requires every observation, binding and unresolved finding to be accounted for', () => {
    expect(() => validateArchitecturePlan(plan(), graph())).not.toThrow();
    for (const key of ['resourceDecisions', 'configuration', 'decisions'] as const) {
      const bad = plan(); bad[key] = [];
      expect(() => validateArchitecturePlan(bad, graph())).toThrow();
    }
    const bad = plan(); bad.components[0].evidenceIds = ['invented-source'];
    expect(() => validateArchitecturePlan(bad, graph())).toThrow('outside');
    const edge = plan(); edge.connections[0].basis = 'repository';
    expect(() => validateArchitecturePlan(edge, graph())).toThrow('no matching observed');
  });
  it('resolves citations to known graph records but still rejects invented evidence', () => {
    const source = graph();
    source.connections.push({ id: 'edge-known', from: 'app', to: 'app', relationship: 'observed connection', evidence: ['ev-app'] });
    const candidate = plan();
    candidate.operations[0].evidenceIds = ['edge-known'];
    candidate.decisions[0].evidenceIds = ['config-gap'];
    const resolved = attachResourceEvidence(candidate, source);
    expect(resolved.operations[0].evidenceIds).toEqual(['ev-app']);
    expect(() => validateArchitecturePlan(resolved, source)).not.toThrow();
    candidate.operations[0].evidenceIds = ['edge-invented'];
    expect(() => validateArchitecturePlan(attachResourceEvidence(candidate, source), source)).toThrow('outside');
  });
  it('requires an actual resource property for configuration and exact component coverage', () => {
    expect(() => validateArchitectureArtifact(artifact(), plan())).not.toThrow();
    const missing = artifact(); missing.componentCoverage = [];
    expect(() => validateArchitectureArtifact(missing, plan())).toThrow('Missing');
    const pointer = artifact(); pointer.configurationCoverage[0].jsonPointer = '/properties/notReallyWired';
    expect(() => validateArchitectureArtifact(pointer, plan())).toThrow('empty or missing');
    const omitted = artifact(); omitted.configurationCoverage = [];
    expect(() => validateArchitectureArtifact(omitted, plan())).toThrow('Missing implementation');
    const rogue = artifact(); rogue.template.resources.push({ name: 'unselected', type: 'Microsoft.Storage/storageAccounts', apiVersion: '2023-01-01' });
    expect(() => validateArchitectureArtifact(rogue, plan())).toThrow('outside the selected plan');
  });
  it('rejects literal credentials, secret defaults, missing parameters and executable resources', () => {
    const secret = artifact(); secret.template.parameters.databaseUrl.defaultValue = 'password';
    expect(() => validateArchitectureArtifact(secret, plan())).toThrow('must not have a default');
    const param = artifact(); param.template.resources[0].properties.password = "[parameters('absent')]";
    expect(() => validateArchitectureArtifact(param, plan())).toThrow('Undefined ARM parameter');
    const literal = artifact(); literal.template.resources[0].properties.password = 'do-not-export-me';
    expect(() => validateArchitectureArtifact(literal, plan())).toThrow('literal credential');
    const script = artifact(); script.template.resources[0].type = 'Microsoft.Resources/deploymentScripts';
    expect(() => validateArchitectureArtifact(script, plan())).toThrow('Executable');
  });
  it('exports both formats from the same graph with evidence, mappings, explicit null inputs and no account apply', () => {
    const files = buildArchitectureBundle(graph(), plan(), artifact());
    const tf = JSON.parse(files['main.tf.json']);
    expect(tf.resource.azapi_resource.architecture.body.properties.template).toContain('architecture.arm.json');
    expect(files['workload.bicep']).toContain("loadJsonContent('./architecture.arm.json')");
    expect(JSON.parse(files['deployment-parameters.example.json'])).toEqual({ databaseUrl: { value: null } });
    const archive = unzipSync(zipArchitectureBundle(files));
    expect(JSON.parse(strFromU8(archive['evidence.json'])).id).toBe(graph().id);
    expect(files['README.md']).toContain('NOT been validated against your Azure account');
    const wrong = artifact(); wrong.planId = 'mismatch';
    expect(() => buildArchitectureBundle(graph(), plan(), wrong)).toThrow('do not match');
  });
  it('repairs one rejected response and never returns a plan with fabricated evidence', async () => {
    const bad = plan(); bad.components[0].evidenceIds = ['fake'];
    const toBody = (value: GroundedArchitecturePlan) => { const { id, architectureId, provider, unitIds, model, createdAt, evidenceCoverage, ...body } = value; return body; };
    const client = { analyzeStructured: vi.fn().mockResolvedValueOnce({ result: toBody(bad), usage: { model: 'test' } }).mockResolvedValueOnce({ result: toBody(plan()), usage: { model: 'test' } }) };
    const result = await recommendArchitecture(graph(), [], client as never);
    expect(result.architectureId).toBe(graph().id);
    expect(client.analyzeStructured).toHaveBeenCalledTimes(2);
    const incomplete = graph(); incomplete.coverage.truncated = true;
    await expect(recommendArchitecture(incomplete, [], client as never)).rejects.toThrow('Increase the scan limits');
  });
});
