/** Fixed validator: no repository workflow, hook, shell or deploy code is executed. */
export const nativeCortexValidationRuntime = String.raw`#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, lstat, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(await readFile(join(root,'validation-spec.json'),'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const names = [['integrity','Pinned bundle integrity'],['native-contract','Cortex output and workload contract'],['terraform-init','Terraform initialization (all state roots)'],['terraform-validate','Terraform validation (all state roots)'],['helm-render','Helm lint, rendering and saved replica edits'],['bicep-build','Bicep compilation'],['target-inputs','Live tenant and release inputs'],['azure-account','Azure target access'],['terraform-plan','Plan against the existing tenant state'],['azure-validate','Azure provider validation'],['azure-what-if','Azure what-if'],['kubernetes-dry-run','Cluster admission and CRD validation'],['secret-sync-dry-run','Secret and identity delivery'],['test-deployment','Non-production deployment'],['rollout','Workload rollout'],['health','Runtime health'],['platform-acceptance','Platform acceptance']];
const report = {version:1,bundleHash:spec.bundleHash,architectureId:spec.architectureId,designRevision:spec.designRevision,targetId:null,targetFingerprint:null,status:'running',startedAt:stamp(),updatedAt:stamp(),checks:names.map(([id,name])=>({id,name,status:'pending',message:'Waiting'})),cloudValidated:false,deploymentAttempted:false,deployed:false,deploymentTestMethod:null,providerLockHash:null,toolVersions:{}};
const output = join(root,'validation-report.json');
const tools = {terraform:process.env.LAUNCHPILOT_TERRAFORM_BIN || 'terraform',helm:process.env.LAUNCHPILOT_HELM_BIN || 'helm'};
const check = id => report.checks.find(c=>c.id===id);
async function persist(){report.updatedAt=stamp();await writeFile(output+'.tmp',JSON.stringify(report,null,2),{mode:0o600});await rename(output+'.tmp',output);}
async function stage(id,action,deps=['integrity']){
 const current=check(id),missing=deps.filter(d=>check(d).status!=='passed');
 if(missing.length){Object.assign(current,{status:'blocked',message:'Requires: '+missing.join(', '),completedAt:stamp()});await persist();return;}
 Object.assign(current,{status:'running',message:'Running',startedAt:stamp()});await persist();
 try{const details=await action();Object.assign(current,{status:'passed',message:'Passed',details,completedAt:stamp()});}
 catch(e){Object.assign(current,{status:e.code==='ENOENT'?'blocked':'failed',message:e.code==='ENOENT'?'Install the required validation tool on the worker':String(e.message).slice(0,4000),completedAt:stamp()});}
 await persist();
}
async function command(tool,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(tools[tool],args,{cwd:root,shell:false,env:{...process.env,TF_IN_AUTOMATION:'1',TF_INPUT:'0'}});let stdout='',stderr='',done=false;
  const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1500).unref();finish(new Error(tool+' timed out'));},300000);
  child.stdout.on('data',v=>{stdout+=v;if(stdout.length>16000000){child.kill('SIGTERM');finish(new Error(tool+' output limit exceeded'));}});
  child.stderr.on('data',v=>{stderr=(stderr+v).slice(-10000);});child.on('error',e=>finish(e));
  child.on('close',code=>finish(code===0?null:new Error(tool+' failed: '+(stderr||stdout).split(root+'/').join('').replace(/(Bearer\s+)\S+/gi,'$1[REDACTED]').slice(-4000)),stdout));
 });
}
await persist();
await stage('integrity',async()=>{
 if(spec.contract!=='cortex-native'||hash(JSON.stringify(spec.files))!==spec.bundleHash)throw new Error('Invalid native bundle fingerprint');
 for(const [path,expected] of Object.entries(spec.files)){
  if(isAbsolute(path)||path.split('/').includes('..')||path.includes('\\')||!(await lstat(join(root,path))).isFile())throw new Error('Unsafe bundle file');
  if(hash(await readFile(join(root,path)))!==expected)throw new Error('Bundle changed: '+path+'. Regenerate and validate the saved design.');
 }
 for(const path of spec.terraformRoots)if(!path.startsWith('cortex/infra/')||path.split('/').includes('..'))throw new Error('Unsafe Terraform root');
 const approvedProviders=new Set(['hashicorp/azurerm','azure/azapi','hashicorp/azuread','hashicorp/random','hashicorp/time','hashicorp/null']);
 async function inspect(directory){
  for(const entry of await readdir(join(root,directory),{withFileTypes:true})){
   if(entry.name==='.terraform')continue;
   const path=directory+'/'+entry.name;
   if(entry.isSymbolicLink())throw new Error('Unexpected symbolic link in Terraform inputs');
   if(entry.isDirectory()){await inspect(path);continue;}
   if(!/\.tf(?:\.json)?$/.test(path))continue;
   if(!spec.files[path])throw new Error('Unreviewed Terraform input: '+path);
   const content=await readFile(join(root,path),'utf8');
   for(const match of content.matchAll(/\bsource\s*=\s*"([^"\n]+)"/g))if(!match[1].startsWith('.')&&!approvedProviders.has(match[1].toLowerCase()))throw new Error('Review the external Terraform provider/module before executing it: '+match[1]);
  }
 }
 await inspect('cortex/infra');
 return ['Every exported input matches the saved Cortex commit and compiled design.'];
},[]);
await stage('native-contract',async()=>{
 const selection=JSON.parse(await readFile(join(root,'cortex-selection.json'),'utf8'));
 if(!/^[a-f0-9]{40}$/.test(selection.revision)||selection.designRevision!==spec.designRevision)throw new Error('Missing pinned source or design revision');
 if(!spec.files['cortex/.github/workflows/tenant-infra.yml']||!spec.files['cortex/infra/tenant/apps.tf'])throw new Error('Missing tenant output delivery contract');
 for(const app of selection.applications){const path='deployment/'+app+'.template.json';if(!spec.files[path])throw new Error('Missing selected ApplicationDeployment: '+app);const doc=JSON.parse(await readFile(join(root,path),'utf8'));if(doc.spec.type!=='Helm'||doc.spec.helm.requiresPerAppInfra!==true||doc.spec.applicationId!==app)throw new Error('Changed Cortex deployment ownership');}
 return ['Dependency applications, output projection and native deployment ownership are included. No preview manifest is a deployment entry point.'];
});
await stage('terraform-init',async()=>{
 const version=JSON.parse(await command('terraform',['version','-json']));report.toolVersions.terraform=version.terraform_version;
 const details=[];
 for(const path of spec.terraformRoots){await command('terraform',['-chdir='+path,'init','-backend=false','-input=false','-no-color']);details.push(path+': initialized without a state backend');}
 const locks=[];for(const path of spec.terraformRoots)try{locks.push([path,hash(await readFile(join(root,path,'.terraform.lock.hcl')))]);}catch{}
 report.providerLockHash=hash(JSON.stringify(locks));return details;
});
await stage('terraform-validate',async()=>{
 const details=[];for(const path of spec.terraformRoots){const result=JSON.parse(await command('terraform',['-chdir='+path,'validate','-json']));if(!result.valid)throw new Error(path+': Terraform validation failed');details.push(path+': valid'+(result.warning_count?' ('+result.warning_count+' warnings)':''));}return details;
},['terraform-init']);
await stage('helm-render',async()=>{
 report.toolVersions.helm=(await command('helm',['version','--short'])).trim();const details=[];
 for(const chart of spec.charts){const values=[...chart.values,chart.inline].flatMap(v=>['-f',v]);await command('helm',['lint',chart.path,...values]);const rendered=await command('helm',['template',chart.applicationId,chart.path,'--namespace','launchpilot-preview',...values]);if(hash(rendered)!==chart.renderedHash)throw new Error('Rendered deployment changed: '+chart.applicationId);details.push(chart.applicationId+': lint/render matches the compiled workload and replica checks');}return details;
});
for(const [id,message] of [['bicep-build','Not applicable: this selected Cortex contract is Terraform-owned.'],['azure-validate','Not applicable to the native Terraform path; Azure checks require a plan against the real tenant state.'],['azure-what-if','Not applicable: no ARM/Bicep entry point is used.']])Object.assign(check(id),{status:'not-applicable',message,completedAt:stamp()});
for(const current of report.checks.filter(c=>c.status==='pending'))Object.assign(current,{status:'blocked',message:'Requires the actual Cortex tenant, existing state backend and platform release. Use the original Cortex workflow and cluster validation process; local checks do not establish deployment readiness.',completedAt:stamp()});
report.status=report.checks.some(c=>c.status==='failed')?'failed':'blocked';report.completedAt=stamp();await persist();
process.exitCode=report.status==='failed'?1:2;
`;
