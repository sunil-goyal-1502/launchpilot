import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanRepositoryArchitecture } from '../../../packages/core/src/architecture/scanner';
import { buildDeploymentTopology } from '../../../packages/core/src/architecture/deployment-topology';
import { assessArchitecture } from '../../../packages/core/src/architecture/architect-review';
import { reviewDeploymentControls } from '../../../packages/core/src/architecture/experience';
import { requiredValidationCheckIds, type ArchitectureValidationJob } from '../../../packages/core/src/architecture/validation-types';
import { validateArchitectTopicCoverage, type ArchitecturePlanBody, type GroundedArchitecturePlan } from '../../../packages/core/src/architecture/planner';
import { materializeArchitectureDesign } from '../../../packages/core/src/architecture/design';

const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const probe={httpGet:{path:'/health',port:8080}};
const definition={apiVersion:'cortex.cortex.ai/v1alpha1',kind:'ApplicationDefinition',metadata:{name:'sample'},spec:{capabilities:[{id:'db',name:'cortex-postgresql'},{id:'search',name:'azure-search',config:{defaultParams:{sku:'standard',replicaCount:'1',partitionCount:'1',location:'uaenorth'}}}],components:[
  {name:'api',image:'api:v1',replicas:2,containerPort:8080,resources:{requests:{cpu:'100m',memory:'256Mi'}},readinessProbe:probe,livenessProbe:probe,uses:['db'],initContainers:[{name:'migrate',image:'api:v1',command:['alembic','upgrade','head']}]},
  {name:'worker',image:'worker:v1',replicas:2,resources:{requests:{cpu:'200m',memory:'512Mi'}},uses:['search']},
]}};
const instance={apiVersion:definition.apiVersion,kind:'CortexApp',metadata:{name:'demo',namespace:'tenant'},spec:{definitionRef:{name:'sample'},domain:'example.test'}};
async function fixture(extra:Record<string,unknown>={}) {
  const root=await mkdtemp(join(tmpdir(),'lp-architect-'));roots.push(root);
  for(const [file,value] of Object.entries({'deploy/prod/definition.yaml':definition,'deploy/prod/app.yaml':instance,...extra})) {await mkdir(dirname(join(root,file)),{recursive:true});await writeFile(join(root,file),typeof value==='string'?value:JSON.stringify(value));}
  const graph=await scanRepositoryArchitecture(root,'local://architect-fixture');
  const unitIds=graph.deploymentUnits.filter(u=>u.root==='deploy/prod').map(u=>u.id);
  const topology=buildDeploymentTopology(graph,unitIds);
  return {graph,topology};
}
function passedJob(architectureId:string,revision=7):ArchitectureValidationJob {
  return {id:'job',designId:'design',revision,planId:'plan',deployTest:true,status:'passed',step:'Complete',createdAt:'',updatedAt:'',report:{version:1,bundleHash:'bundle',architectureId,designRevision:revision,targetId:'qa-target',targetFingerprint:'target-hash',status:'passed',startedAt:'',updatedAt:'',checks:requiredValidationCheckIds.map(id=>({id,name:id,status:'passed',message:'Verified'})),cloudValidated:true,deploymentAttempted:true,deployed:true,deploymentTestMethod:'terraform',providerLockHash:'lock',toolVersions:{}}};
}

describe('risk-ranked architectural review',()=>{
  it('detects per-workload gaps even when global presence checks found probes and resource requests',async()=>{
    const {graph,topology}=await fixture();const controls=reviewDeploymentControls(graph,topology.unitIds,'prod');
    expect(controls.find(c=>c.id==='health')?.status).toBe('declared');expect(controls.find(c=>c.id==='requests')?.status).toBe('declared');
    const review=assessArchitecture(graph,topology,{environment:'prod'});
    expect(review.findings.find(f=>f.id==='health')?.limitation).toContain('1 of 2');
    expect(review.findings.find(f=>f.id==='capacity')?.limitation).toContain('1 application/init');
    expect(review.declared.some(c=>c.id==='health')).toBe(false);expect(review.declared.some(c=>c.id==='requests')).toBe(false);
    expect(review.findings.find(f=>f.id==='migration-safety')?.componentIds).toEqual([topology.workloads.find(w=>w.name==='demo-api')!.id]);
    expect(review.findings.slice(0,3).map(f=>f.id)).toEqual(['deployment-validation','migration-safety','recovery']);
  });
  it('reuses existing controls while keeping restore and provider behavior unverified',async()=>{
    const {graph,topology}=await fixture({'deploy/prod/backup.yaml':{apiVersion:'v1',kind:'Backup',metadata:{name:'database-backup'}},'helm/app/Chart.yaml':{name:'app',version:'1.0.0'},'helm/app/templates/network.yaml':'kind: NetworkPolicy\nmetadata:\n  name: {{ .Release.Name }}'});
    const review=assessArchitecture(graph,topology,{environment:'prod'});
    expect(review.declared.find(c=>c.id==='backups')?.detail).toContain('restore results');
    expect(review.findings.find(f=>f.id==='recovery')?.recommendation).toContain('Retain the declared implementation');
    expect(review.findings.find(f=>f.id==='security-boundaries')?.limitation).toContain('existing implementation needs activation');
    expect(review.findings.find(f=>f.id==='recovery')?.verification).toContain('measured recovery');
  });
  it('does not treat proposed protections or completed model review as verified',async()=>{
    const {graph,topology}=await fixture();
    const review=assessArchitecture(graph,topology);
    expect(topology.nodes.some(n=>n.id==='target-edge-waf')).toBe(true);
    expect(review.findings.find(f=>f.id==='security-boundaries')?.state).toBe('proposed');
    expect(review.validationCurrent).toBe(false);
    expect(review.domains.map(d=>d.id)).toEqual(['reliability','security','performance','operations','delivery','cost']);
    for(const f of review.findings){expect(f.impact).toBeTruthy();expect(f.recommendation).toBeTruthy();expect(f.tradeoff).toBeTruthy();expect(f.verification).toBeTruthy();expect(f.evidenceIds.every(id=>graph.evidence.some(e=>e.id===id))).toBe(true);}
    expect(new Set(review.findings.map(f=>f.id)).size).toBe(review.findings.length);
  });
  it('recalculates after a saved replica edit without changing repository evidence',async()=>{
    const {graph,topology}=await fixture();const before=JSON.stringify(graph),api=topology.workloads.find(w=>w.name==='demo-api')!;
    const edited=materializeArchitectureDesign(graph,{version:1,id:'design',architectureId:graph.id,unitIds:topology.unitIds,revision:1,createdAt:'',updatedAt:'',edits:[{type:'update-component',id:api.id,fields:{},replicas:1}]});
    const review=assessArchitecture(graph,edited);
    expect(review.findings.some(f=>f.id==='migration-safety')).toBe(false);
    expect(review.findings.find(f=>f.id==='failure-tolerance')?.limitation).toContain('1 workloads have one replica');
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('does not reuse successful validation from another revision or scope',async()=>{
    const {graph,topology}=await fixture(),job=passedJob(graph.id);
    const options={designId:'design',revision:7,validationJob:job};
    expect(assessArchitecture(graph,topology,options).validationCurrent).toBe(true);
    expect(assessArchitecture(graph,topology,options).findings.some(f=>f.id==='deployment-validation')).toBe(false);
    expect(assessArchitecture(graph,topology,{...options,revision:8}).validationCurrent).toBe(false);
    expect(assessArchitecture(graph,topology,{...options,designId:'another'}).validationCurrent).toBe(false);
    job.report!.checks=job.report!.checks.filter(c=>c.id==='terraform-validate');
    expect(assessArchitecture(graph,topology,options).validationCurrent).toBe(false);
  });
  it('respects intentional lower redundancy in QA and exposes unsupported cloud export',async()=>{
    const {graph,topology}=await fixture();
    expect(assessArchitecture(graph,topology,{environment:'qa'}).findings.find(f=>f.id==='failure-tolerance')?.recommendation).toContain('Lower non-production redundancy can be intentional');
    const aws=assessArchitecture(graph,topology,{cloudProvider:'aws'});
    expect(aws.findings[0].recommendation).toContain('native Terraform');expect(aws.standardUrl).toContain('docs.aws.amazon.com');
    expect(assessArchitecture(graph,topology,{cloudProvider:'gcp'}).standardUrl).toContain('cloud.google.com');
  });
  it('extracts probe, privilege and placement metadata from the actual pod template',async()=>{
    const {graph}=await fixture({'deploy/prod/native.yaml':{apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'native'},spec:{replicas:2,template:{metadata:{labels:{app:'native'}},spec:{securityContext:{runAsNonRoot:true},topologySpreadConstraints:[{maxSkew:1,topologyKey:'kubernetes.io/hostname',whenUnsatisfiable:'DoNotSchedule'}],containers:[{name:'native',image:'native:v1',readinessProbe:probe,livenessProbe:{...probe,initialDelaySeconds:300},securityContext:{allowPrivilegeEscalation:false}}]}}}}});
    const t=buildDeploymentTopology(graph,graph.deploymentUnits.map(u=>u.id));const w=t.workloads.find(w=>w.name==='native')!;
    expect(w.placement?.topologySpread).toBe(true);expect(w.containers[0].security).toMatchObject({runAsNonRoot:true,allowPrivilegeEscalation:false});
    expect(w.containers[0].probes).toMatchObject({readiness:true,liveness:true,startup:false,slowStartup:true});
  });
  it('keeps analysis truncation visible and ahead of normal improvement advice',async()=>{
    const {graph,topology}=await fixture();graph.coverage.truncated=true;
    expect(assessArchitecture(graph,topology).findings[0].id).toBe('analysis-coverage');
  });
  it('requires explicit coverage of each engineering topic in newly generated plans',()=>{
    const body={architectReviewVersion:1,operations:[{topicIds:['recovery','migration-safety']}]} as ArchitecturePlanBody;
    expect(()=>validateArchitectTopicCoverage(body,['recovery','migration-safety'])).not.toThrow();
    expect(()=>validateArchitectTopicCoverage(body,['recovery','migration-safety','capacity'])).toThrow('Every identified');
    expect(()=>validateArchitectTopicCoverage(body,['recovery'])).toThrow('unknown architecture topic');
    expect(()=>validateArchitectTopicCoverage({...body,architectReviewVersion:undefined},[])).toThrow('structured architecture review');
  });
  it('attaches topic-specific plan advice across concern categories without adding a duplicate finding',async()=>{
    const {graph,topology}=await fixture();
    const plan={architectReviewVersion:1,components:[],operations:[{concern:'availability',topicIds:['load-and-scaling'],componentIds:[],evidenceIds:[],recommendation:'Verify the provider quota and connection pool under load.',rationale:'The existing capacity contract is shared.',limitation:'Allocated downstream throughput is unverified.',impact:'Backlog can grow before CPU saturates.',priority:'before-production',owner:'Platform owner',tradeoff:'Reserve quota increases spend.',verification:'Record queue age and throttled requests during a soak test.'}]} as unknown as GroundedArchitecturePlan;
    const review=assessArchitecture(graph,topology,{plan});
    const finding=review.findings.find(f=>f.id==='load-and-scaling')!;
    expect(finding.planRecommendations).toHaveLength(1);
    expect(finding.planRecommendations[0].verification).toContain('queue age');
    expect(finding.priority).toBe('before-production');
    expect(review.findings.some(f=>f.id.startsWith('plan-operation-'))).toBe(false);
  });
});
