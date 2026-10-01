import { describe, expect, it, vi } from 'vitest';
import type { RepositoryArchitecture } from '../../../packages/core/src/types/architecture';
import type { DeploymentTopology, DeploymentWorkload } from '../../../packages/core/src/architecture/deployment-topology';
import { deploymentEnvironments, reviewDeploymentControls, relatedDeploymentContext } from '../../../packages/core/src/architecture/experience';
import { estimateArchitectureCost, cpuCores, memoryGiB } from '../../../packages/core/src/architecture/cost';
import { reviewDeploymentFiles, reviewRelatedDeploymentFiles, consolidateImplementationReviews, selectArchitectureScope, validateRecommendationReuse, type ArchitecturePlanBody } from '../../../packages/core/src/architecture/planner';
import type { LLMProvider } from '../../../packages/core/src/agents/ai-analyzer/llm-provider';

function graph(): RepositoryArchitecture { return { version: 1, id: 'a'.repeat(64), repoUrl: 'local://test', revision: 'test', scannedAt: '', resources: [], connections: [], bindings: [], evidence: [], deploymentUnits: [], gaps: [], recommendations: [], deploymentContext: [], coverage: { filesScanned: 1, deploymentFiles: 0, files: [], excluded: [], limits: { maxFiles: 100, maxFileBytes: 100000, maxTotalBytes: 1000000 }, truncated: false, runtimeVerified: false } }; }
function add(g: RepositoryArchitecture, id: string, root: string, files: Record<string, string>, format: 'helm' | 'cortex' | 'workflow' | 'kubernetes' = 'cortex') {
  g.deploymentUnits.push({ id, name: root, root, format, resourceIds: [], files: Object.keys(files), exportFormats: [] });
  for (const [file, content] of Object.entries(files)) { g.deploymentContext.push({ file, content, redacted: true }); g.evidence.push({ id: `ev-${file}`, file, line: 1, endLine: 1, kind: 'deployment', summary: 'Fixture declaration' }); }
}
function topology(workloads: DeploymentWorkload[]): DeploymentTopology { return { version: 1, architectureId: 'a', unitIds: [], owner: 'Existing Kubernetes', namespaces: [], nodes: [], connections: [], controls: [], workloads, limitations: [], totals: { workloads: workloads.length, applicationPods: workloads.reduce((n,w) => n+(w.replicas ?? 0),0), unspecifiedWorkloads: workloads.filter(w=>w.replicas===null).length, applicationContainers: workloads.length, initContainers: 0 } }; }
function workload(replicas: number | null = 2): DeploymentWorkload { return { id: 'api', name: 'api', owner: 'Kubernetes', controller: 'Deployment', namespace: 'app', replicas, replicaBasis: 'repository', exposed: true, file: 'deploy/prod/api.yaml', pointer: '', resourceIds: [], evidenceIds: [], containers: [{ name: 'api', image: 'app:test', role: 'application', ports: [], requests: { cpu: '500m', memory: '1Gi' }, limits: {} }] }; }

describe('environment-first evidence review', () => {
  it('reviews every selected file part separately from related context and rejects incomplete consolidation', async () => {
    const g = graph();
    g.deploymentContext = [{ file: 'infra/main.tf', content: 'x'.repeat(80001), redacted: true }];
    g.relatedDeploymentContext = [{ file: 'chart/optional.yaml', content: 'y', redacted: true }];
    const source = JSON.stringify(g), seen: string[] = [];
    const client = { analyzeStructured: vi.fn(async (_system: string, input: string) => {
      const { files } = JSON.parse(input); seen.push(...files.map((f: {content: string}) => f.content));
      return { result: { reviews: files.map((f: {id: string}) => ({ id: f.id, findings: 'Preserve this declared implementation and its provider boundary.' })) }, usage: { model: 'test' } };
    }) } as unknown as LLMProvider;
    const selected = await reviewDeploymentFiles(g, client, 'azure', 'selected');
    const related = await reviewDeploymentFiles(g, client, 'azure', 'related', true);
    expect(seen.join('')).toBe('x'.repeat(80001) + 'y');
    expect(selected.reviews.every(r => r.role === 'selected')).toBe(true);
    expect(related.reviews.every(r => r.role === 'related')).toBe(true);
    const reviews = [...selected.reviews, ...related.reviews];
    const merge = { analyzeStructured: vi.fn(async (_system: string, input: string) => ({ result: { groups: [{ partIds: JSON.parse(input).map((r: {id: string}) => r.id), constraints: 'Native infrastructure is selected; optional templates are reuse evidence.' }] } })) } as unknown as LLMProvider;
    expect((await consolidateImplementationReviews(reviews, merge)).context.parts).toHaveLength(3);
    const broken = { analyzeStructured: vi.fn().mockResolvedValue({ result: { groups: [{ partIds: ['F1'], constraints: 'Incomplete' }] } }) } as unknown as LLMProvider;
    await expect(consolidateImplementationReviews(reviews, broken)).rejects.toThrow('coverage validation');
    expect(JSON.stringify(g)).toBe(source);
  });
  it('shows each actual environment once and keeps Helm/workflows as related definitions', () => {
    const g = graph();
    for (const env of ['prod', 'preprod', 'qa']) add(g, env, `deploy/cortex/${env}`, { [`deploy/cortex/${env}/app.yaml`]: 'kind: CortexApp' });
    add(g, 'chart', 'helm/app', { 'helm/app/Chart.yaml': 'name: app', 'helm/app/values-qa.yaml': 'replicaCount: 2', 'helm/app/templates/network.yaml': 'kind: NetworkPolicy' }, 'helm');
    add(g, 'pipeline', 'azure-pipelines', { 'azure-pipelines/deploy.yml': 'steps: []' }, 'workflow');
    const envs = deploymentEnvironments(g);
    expect(envs.map(e => e.id)).toEqual(['prod','preprod','qa']);
    expect(envs.find(e=>e.id==='qa')).toMatchObject({ unitIds: ['qa'], alternativeUnitIds: ['chart'] });
  });
  it('keeps staging, UAT and custom named environments distinct from preprod/QA', () => {
    const g = graph();
    for (const env of ['preprod','staging','qa','uat','performance']) add(g, env, `environments/${env}`, { [`environments/${env}/app.yaml`]: 'kind: Deployment' });
    expect(deploymentEnvironments(g).map(e=>e.id).sort()).toEqual(['performance','preprod','qa','staging','uat']);
  });
  it('does not apply prod overlays to QA or count an unrendered or disabled chart as deployed', () => {
    const g=graph(); add(g,'qa','deploy/qa',{'deploy/qa/app.yaml':'kind: Deployment'});
    add(g,'helm','helm/app',{'helm/app/templates/network.yaml':'{{- if .Values.networkPolicy.enabled }}\nkind: NetworkPolicy\n{{- end }}','helm/app/values-qa.yaml':'networkPolicy:\n  enabled: false','helm/app/values-prod.yaml':'kind: SecretStore'},'helm');
    const findings=reviewDeploymentControls(g,['qa']);
    expect(findings.find(f=>f.id==='network-policy')?.status).toBe('available');
    expect(findings.find(f=>f.id==='secret-store')?.status).toBe('missing');
    expect(relatedDeploymentContext(g,['qa']).some(f=>f.file.includes('values-prod'))).toBe(false);
    expect(selectArchitectureScope(g,['qa']).deploymentContext).toHaveLength(1);
    expect(selectArchitectureScope(g,['qa']).relatedDeploymentContext?.some(f=>f.file.includes('templates/network'))).toBe(true);
  });
  it('filters values overlays even when both environments share one selected Helm chart', () => {
    const g=graph();add(g,'helm','helm/app',{'helm/app/Chart.yaml':'name: app','helm/app/values-qa.yaml':'replicaCount: 2','helm/app/values-prod.yaml':'replicaCount: 12'},'helm');
    const qa=selectArchitectureScope(g,['helm'],'qa');
    expect(qa.deploymentContext.map(f=>f.file)).toEqual(['helm/app/Chart.yaml','helm/app/values-qa.yaml']);
    expect(qa.evidence.some(e=>e.file.includes('values-prod'))).toBe(false);
  });
  it('reuses selected native controls and does not interpret comments as evidence', () => {
    const g=graph();add(g,'qa','deploy/qa',{'deploy/qa/network.yaml':'kind: NetworkPolicy\nmetadata:\n  name: api','deploy/qa/app.yaml':'# Add a SecretStore later\nkind: Deployment'});
    const f=reviewDeploymentControls(g,['qa']);
    expect(f.find(c=>c.id==='network-policy')?.status).toBe('declared');
    expect(f.find(c=>c.id==='secret-store')?.status).toBe('missing');
  });
  it('requires reuse evidence for a proposed duplicate and recognizes disabled Helm telemetry', () => {
    const g=graph();add(g,'qa','deploy/qa',{'deploy/qa/app.yaml':'kind: Deployment'});
    add(g,'helm','helm/app',{'helm/app/templates/network.yaml':'kind: NetworkPolicy','helm/app/values.yaml':JSON.stringify({global:{otelPythonInstrumentation:{enabled:false}},template:'{{ example }}'})},'helm');
    const controls=reviewDeploymentControls(g,['qa']);
    expect(controls.find(c=>c.id==='telemetry')?.status).toBe('disabled');
    const component={id:'policy',name:'Policy',kind:'network',technology:'Kubernetes NetworkPolicy',basis:'recommendation' as const,deployment:'provision' as const,resourceIds:[],evidenceIds:[] as string[],rationale:'Create another policy'};
    const body={components:[component],decisions:[]} as unknown as ArchitecturePlanBody;
    expect(()=>validateRecommendationReuse(body,controls)).toThrow('already has an implementation');
    component.evidenceIds=controls.find(c=>c.id==='network-policy')!.evidenceIds;component.rationale='Reuse the existing Helm implementation after rendering its selected values.';
    expect(()=>validateRecommendationReuse(body,controls)).not.toThrow();
  });
  it('reviews every part of oversized related files and rejects partial coverage', async () => {
    const g=graph();g.relatedDeploymentContext=[{file:'helm/templates/app.yaml',content:'x'.repeat(110000),redacted:true},{file:'helm/values.yaml',content:'y'.repeat(30000),redacted:true}];
    const seen: string[]=[];
    const client={analyzeStructured:vi.fn(async (_system:string,input:string)=>{const files=JSON.parse(input).files as {id:string;content:string}[];seen.push(...files.map(f=>f.content));return {result:{reviews:files.map(f=>({id:f.id,findings:'Conditional chart; requires values and render validation.'}))},usage:{model:'test'}};})} as unknown as LLMProvider;
    const result=await reviewRelatedDeploymentFiles(g,client,'aws');
    expect(result.reviews).toHaveLength(4);expect(seen.join('')).toBe('x'.repeat(110000)+'y'.repeat(30000));
    expect(result.calls).toBeGreaterThan(1);
    const broken={analyzeStructured:vi.fn().mockResolvedValue({result:{reviews:[]},usage:{model:'test'}})} as unknown as LLMProvider;
    await expect(reviewRelatedDeploymentFiles(g,broken,'gcp')).rejects.toThrow('coverage validation');
  });
  it('preserves distinct YAML documents from the same file with unique review IDs', async () => {
    const g=graph();
    g.relatedDeploymentContext=[
      {file:'helm/large.yaml',content:'x'.repeat(80000),redacted:true},
      {file:'ops/api.yaml',content:JSON.stringify({kind:'Service',metadata:{name:'api'}}),redacted:true},
      {file:'ops/api.yaml',content:JSON.stringify({kind:'Deployment',metadata:{name:'api'}}),redacted:true},
      {file:'ops/data.yaml',content:JSON.stringify({kind:'Secret',metadata:{name:'data'}}),redacted:true},
      {file:'ops/data.yaml',content:JSON.stringify({kind:'Service',metadata:{name:'data'}}),redacted:true},
      {file:'ops/data.yaml',content:JSON.stringify({kind:'StatefulSet',metadata:{name:'data'}}),redacted:true},
    ];
    const seen:Array<{id:string;file:string;content:string}>=[];
    const client={analyzeStructured:vi.fn(async (_system:string,input:string)=>{
      const {files}=JSON.parse(input); seen.push(...files);
      return {result:{reviews:files.map((f:{id:string})=>({id:f.id,findings:'Retain this document and its existing deployment owner.'}))},usage:{model:'test'}};
    })} as unknown as LLMProvider;
    const result=await reviewRelatedDeploymentFiles(g,client,'azure');
    expect(result.reviews).toHaveLength(7);
    expect(new Set(seen.map(p=>p.id)).size).toBe(7);
    expect(result.reviews.filter(p=>p.file==='ops/api.yaml')).toHaveLength(2);
    expect(result.reviews.filter(p=>p.file==='ops/data.yaml')).toHaveLength(3);
    expect(seen.map(p=>p.content).join('')).toBe(g.relatedDeploymentContext.map(f=>f.content).join(''));
  });
});

describe('architecture-based capacity and pricing', () => {
  it('parses Kubernetes quantities without conflating decimal GB and binary GiB', () => {
    expect(cpuCores('250m')).toBe(.25);expect(memoryGiB('1024Mi')).toBe(1);expect(memoryGiB('1G')).toBeCloseTo(.93132257);expect(cpuCores('unknown')).toBeNull();
  });
  it('counts multi-container pods and init requirements correctly without double-billing pods', () => {
    const w=workload(3);w.containers.push({...w.containers[0],name:'sidecar',requests:{cpu:'250m',memory:'256Mi'}},{...w.containers[0],name:'init',role:'init',requests:{cpu:'1',memory:'2Gi'}});
    const e=estimateArchitectureCost(topology([w]),'azure');
    expect(e.requestedCpu).toBe(3);expect(e.requestedMemoryGiB).toBe(6);expect(e.lines.filter(l=>l.monthly!==null)).toHaveLength(1);expect(e.lines.find(l=>l.id==='api')?.basis).toBe('included');
  });
  it('respects per-pod placement instead of only dividing summed requests', () => {
    const w=workload(4);w.containers[0].requests={cpu:'100m',memory:'6Gi'};
    const e=estimateArchitectureCost(topology([w]),'azure');expect(e.computeNodes).toBe(5);expect(e.pricedSubtotal).toBe(700.8);
  });
  it('recalculates after replicas change and uses cloud-specific verified rates', () => {
    const w=workload(2), before=estimateArchitectureCost(topology([w]),'aws');w.replicas=20;
    const after=estimateArchitectureCost(topology([w]),'aws');expect(after.pricedSubtotal!).toBeGreaterThan(before.pricedSubtotal!);expect(after.sku).toBe('m5a.xlarge');
    expect(estimateArchitectureCost(topology([w]),'gcp').sku).toBe('e2-standard-4');
  });
  it('never substitutes another region or reports missing capacity/services as free', () => {
    const w=workload(null), t=topology([w]);t.nodes.push({id:'db',name:'Database',kind:'database',technology:'PostgreSQL',layer:'data',owner:'Cortex',basis:'repository',details:[],resourceIds:[],evidenceIds:[]});
    const e=estimateArchitectureCost(t,'azure',{region:'uaenorth'});expect(e.pricedSubtotal).toBeNull();expect(e.unknownReplicas).toBe(1);expect(e.lines.find(l=>l.id==='db')?.monthly).toBeNull();
    expect(estimateArchitectureCost(topology([workload()]),'azure',{region:'unsupported-region'}).pricedSubtotal).toBeNull();
  });
  it('identifies proposed defaults and refuses undersized nodes for an oversized pod', () => {
    const w=workload();w.containers[0].requests={};expect(estimateArchitectureCost(topology([w])).missingRequestContainers).toBe(1);
    w.containers[0].requests={cpu:'8',memory:'64Gi'};const e=estimateArchitectureCost(topology([w]));expect(e.computeNodes).toBeNull();expect(e.pricedSubtotal).toBeNull();expect(e.excluded[0]).toContain('exceeds');
  });
  it('prices fixed monthly edge fees without double-counting capability connection secrets', () => {
    const t=topology([workload()]);
    t.nodes.push({id:'target-edge-waf',name:'Front Door',kind:'network',technology:'Azure Front Door Premium + WAF',basis:'recommendation',layer:'edge',owner:'Terraform',details:[],resourceIds:[],evidenceIds:[]},{id:'secret',name:'Database credentials',kind:'secret',technology:'Cortex capability connection Secret',basis:'repository',layer:'operations',owner:'Cortex',details:[],resourceIds:[],evidenceIds:[]});
    const e=estimateArchitectureCost(t,'azure',{hours:365,usageMode:'rates-only'});
    expect(e.lines.find(l=>l.id==='target-edge-waf')?.monthly).toBe(330);
    expect(e.lines.some(l=>l.id==='secret')).toBe(false);
    expect(e.pricedSubtotal).toBe(470.16);
    const stopped=estimateArchitectureCost(topology([workload(0)]));expect(stopped.computeNodes).toBe(0);expect(stopped.pricedSubtotal).toBe(0);
  });
});
