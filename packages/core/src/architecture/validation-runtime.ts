/** Fixed, portable validator included in every bundle. Generated repository/model code is never executed. */
export const validationRuntimeSource = String.raw`#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile, rename, mkdir, mkdtemp, rm, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const value = flag => argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
const configPath = value('--config');
const executeTest = argv.includes('--deploy-test');
let target = null, configError;
try { target = configPath ? JSON.parse(await readFile(resolve(configPath), 'utf8')) : null; } catch(error) { configError = error; }
const spec = JSON.parse(await readFile(join(root, 'validation-spec.json'), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const stamp = () => new Date().toISOString();
const definitions = [
 ['integrity','Bundle integrity and execution policy'], ['terraform-init','Terraform initialization'], ['terraform-validate','Terraform validation'], ['bicep-build','Bicep compilation and lint'],
 ['target-inputs','Target and deployment parameters'], ['azure-account','Azure target access'], ['terraform-plan','Terraform plan'], ['azure-validate','Azure provider validation'], ['azure-what-if','Azure what-if'],
 ['kubernetes-dry-run','Cortex / Kubernetes server-side dry run'], ['secret-sync-dry-run','Secret-controller manifest dry run'],
 ['test-deployment','Non-production test deployment'], ['rollout','Workload rollout and configuration'], ['health','Application health and dependency readiness'], ['platform-acceptance','Platform acceptance requirements']
];
const report = {version:1, bundleHash:spec.bundleHash, architectureId:spec.architectureId, ...(spec.designRevision === undefined ? {} : {designRevision:spec.designRevision}), targetId:target?.id ?? null, targetFingerprint:target ? hash(JSON.stringify(target)) : null, status:'running', startedAt:stamp(), updatedAt:stamp(), checks:definitions.map(([id,name])=>({id,name,status:'pending',message:'Waiting for validation'})), cloudValidated:false, deploymentAttempted:false, deployed:false, deploymentTestMethod:null, providerLockHash:null, toolVersions:{}};
const reportPath = join(root, 'validation-report.json');
const privateDir = await mkdtemp(join(tmpdir(), 'launchpilot-check-'));
const tools = {terraform: process.env.LAUNCHPILOT_TERRAFORM_BIN || 'terraform', bicep: process.env.LAUNCHPILOT_BICEP_BIN || 'bicep', az: process.env.LAUNCHPILOT_AZ_BIN || 'az', kubectl: process.env.LAUNCHPILOT_KUBECTL_BIN || 'kubectl'};
const secretValues = Object.entries(target?.parameters ?? {}).filter(([name]) => /secret|password|token|credential|connectionstring|accountkey/i.test(name)).flatMap(([,entry])=>typeof entry.value==='string' && entry.value ? [entry.value] : []);
const redact = text => secretValues.reduce((s,v)=>s.split(v).join('[REDACTED]'), String(text)).replace(/(Bearer\s+)[^\s"']+/gi,'$1[REDACTED]').split(root+'/').join('').split(privateDir+'/').join('[private]/').slice(0,10000);
const check = id => report.checks.find(c=>c.id===id);
const ok = id => ['passed','not-applicable'].includes(check(id).status);
async function persist() { report.updatedAt=stamp(); await writeFile(reportPath+'.tmp',JSON.stringify(report,null,2),{mode:0o600}); await rename(reportPath+'.tmp',reportPath); }
async function blocked(id,message) { Object.assign(check(id),{status:'blocked',message,completedAt:stamp()}); await persist(); }
async function skip(id,message) { Object.assign(check(id),{status:'not-applicable',message,completedAt:stamp()}); await persist(); }
async function stage(id,action,dependencies=[]) {
 const missing=dependencies.filter(d=>!ok(d));
 if(missing.length) return blocked(id,'Waiting for successful checks: '+missing.map(d=>check(d).name).join(', '));
 Object.assign(check(id),{status:'running',message:'Running',startedAt:stamp()}); await persist();
 try { const result=await action(); Object.assign(check(id),{status:'passed',message:result?.message || 'Passed',...(result?.details ? {details:result.details} : {}),completedAt:stamp()}); }
 catch(error) { Object.assign(check(id),{status:error.blocked ? 'blocked':'failed',message:redact(error.message),completedAt:stamp()}); }
 await persist();
}
function missing(message) { const e=new Error(message);e.blocked=true;throw e; }
async function command(tool,args,accept=[0],timeout=300000) {
 return new Promise((resolve,reject)=>{
  const child=spawn(tools[tool],args,{cwd:root,shell:false,env:{...process.env,TF_IN_AUTOMATION:'1',TF_INPUT:'0',AZURE_CORE_COLLECT_TELEMETRY:'false'}});
  let stdout='',stderr='',ended=false;
  const timer=setTimeout(()=>{child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),1500).unref();finish(new Error(tool+' timed out'));},timeout);
  const finish=(error,result)=>{if(ended)return;ended=true;clearTimeout(timer);error?reject(error):resolve(result);};
  child.stdout.on('data',data=>{stdout+=data;if(stdout.length>12000000){child.kill('SIGTERM');finish(new Error(tool+' output exceeded the validation limit'));}});
  child.stderr.on('data',data=>{stderr+=data;if(stderr.length>1000000)stderr=stderr.slice(-1000000);});
  child.on('error',error=>finish(Object.assign(new Error(error.code==='ENOENT' ? 'Install/configure '+tool+' on the validation worker' : error.message),{blocked:error.code==='ENOENT'})));
  child.on('close',code=>finish(accept.includes(code)?null:new Error(tool+' exited '+code+': '+redact(stderr || stdout)),{stdout,stderr,code}));
 });
}
async function jsonCommand(tool,args,accept=[0],timeout) {const result=await command(tool,args,accept,timeout);try{return {data:JSON.parse(result.stdout),...result};}catch{throw new Error(tool+' returned invalid JSON');}}
async function eventually(action) {
 const duration=Math.min(900000,Math.max(1,Number(process.env.LAUNCHPILOT_ROLLOUT_TIMEOUT_MS)||300000)),deadline=Date.now()+duration;
 for(;;)try{return await action();}catch(error){if(error.blocked||Date.now()>=deadline)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(3000,duration)));}
}
const azureArgs = () => ['--subscription',target.subscriptionId,'--location',target.location,'--name','launchpilot-check-'+spec.bundleHash.slice(0,12),'--template-file',join(privateDir,'compiled.json'),'--parameters','@'+join(privateDir,'azure-parameters.json'),'--validation-level','Provider','--only-show-errors','--output','json'];
const kubeArgs = () => ['--context',target.kubernetes.context,'--namespace',target.kubernetes.namespace,'--request-timeout=60s'];
let effectiveParameters={}, syncFile, deploymentResult;
const manifestFiles = spec.manifests.map(name=>join(root,name));
async function dryRun(files) { for(const path of files) await command('kubectl',[...kubeArgs(),'apply','--server-side','--dry-run=server','--validate=strict','--field-manager=launchpilot-validation','-f',path,'-o','name']); }
async function renderSync(values) {
 const required=['identityClientId','tenantId','vaultUri','serviceAccountName','namespace'];
 if(required.some(k=>typeof values?.[k]!=='string'||!values[k])) missing('Supply secretSyncValues or complete a test deployment that produces the required vault/identity outputs.');
 if(values.namespace!==target.kubernetes.namespace || spec.namespaces.length!==1 || values.namespace!==spec.namespaces[0]) throw new Error('Secret synchronization namespace must match the selected architecture and target');
 if(values.serviceAccountName!==effectiveParameters.secretSyncServiceAccount?.value)throw new Error('Secret-controller service account must match the generated federated identity subject');
 const replacements={'__IDENTITY_CLIENT_ID__':values.identityClientId,'__TENANT_ID__':values.tenantId,'__VAULT_URI__':values.vaultUri};
 const transform=v=>Array.isArray(v)?v.map(transform):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,val])=>[k,transform(val)])):replacements[v]??v;
 const manifest=transform(JSON.parse(await readFile(join(root,'support/secret-sync.template.json'),'utf8')));
 manifest.items[0].metadata.name=values.serviceAccountName;
 manifest.items[1].spec.provider.azurekv.serviceAccountRef.name=values.serviceAccountName;
 syncFile=join(privateDir,'secret-sync.json');await writeFile(syncFile,JSON.stringify(manifest),{mode:0o600});
}
try {
 await persist();
 await stage('integrity',async()=>{
  if(hash(JSON.stringify(spec.files))!==spec.bundleHash || ['main.tf.json','main.bicep','workload.bicep','architecture.arm.json','validate.mjs','deployment-topology.json'].some(name=>!spec.files[name]))throw new Error('Invalid validation manifest or bundle fingerprint');
  for(const [name,expected] of Object.entries(spec.files)) {
   if(isAbsolute(name)||name.split('/').includes('..')||!(await lstat(join(root,name))).isFile())throw new Error('Unsafe bundle file: '+name);
   if(hash(await readFile(join(root,name)))!==expected)throw new Error('Bundle changed after generation: '+name+'. Regenerate and validate this revision.');
  }
  const tf=JSON.parse(await readFile(join(root,'main.tf.json'),'utf8'));
  if(tf.module||tf.data||Object.keys(tf.provider??{}).some(k=>k!=='azapi')||Object.keys(tf.resource??{}).some(k=>k!=='azapi_resource')||tf.terraform?.required_providers?.azapi?.source!=='Azure/azapi'||JSON.stringify(tf).includes('provisioner'))throw new Error('The validation runner only executes the generated AzAPI deployment wrapper');
  if(Object.keys(spec.files).some(name=>!name.includes('/') && /\.tf(?:\.json)?$/.test(name) && name!=='main.tf.json'))throw new Error('Additional Terraform entry points require review');
  const arm=JSON.parse(await readFile(join(root,'architecture.arm.json'),'utf8'));
  if((arm.resources??[]).some(r=>/deploymentScripts|virtualMachines\/extensions/i.test(r.type)))throw new Error('Executable Azure resources are not permitted in generated bundles');
  return {message:'Artifact hashes and generated-provider policy passed'};
 });
 await stage('terraform-init',async()=>{
  const version=await jsonCommand('terraform',['version','-json']);report.toolVersions.terraform=version.data.terraform_version;
  const result=await command('terraform',['init','-backend=false','-input=false','-no-color'],[0],300000);
  report.providerLockHash=hash(await readFile(join(root,'.terraform.lock.hcl')));
  return {message:'Provider initialized without a remote backend',details:result.stderr?[redact(result.stderr)]:[]};
 },['integrity']);
 await stage('terraform-validate',async()=>{
  const result=await jsonCommand('terraform',['validate','-json']);
  if(!result.data.valid)throw new Error(JSON.stringify(result.data.diagnostics));
  return {message:'Terraform configuration valid',details:(result.data.diagnostics??[]).map(d=>redact(d.summary+': '+d.detail))};
 },['terraform-init']);
 await stage('bicep-build',async()=>{
  report.toolVersions.bicep=(await command('bicep',['--version'])).stdout.trim();
  const result=await command('bicep',['build',join(root,'main.bicep'),'--outfile',join(privateDir,'compiled.json')]);
  return {message:'Bicep compiled successfully',details:result.stderr?[redact(result.stderr)]:[]};
 },['integrity']);
 await stage('target-inputs',async()=>{
  if(configError)throw new Error('Validation target file could not be parsed: '+configError.message);
  if(!target)missing('Select a configured non-production validation target. Azure subscription, resource group, region, parameters and cluster context are required.');
  if(!['development','qa','preprod'].includes(target.environment)||target.architectureId!==spec.architectureId||JSON.stringify([...target.unitIds].sort())!==JSON.stringify([...spec.unitIds].sort()))throw new Error('Target environment/snapshot/scope does not match this architecture');
  if(!/^[a-f0-9-]{36}$/i.test(target.subscriptionId)||!target.resourceGroupName||!target.location)missing('Supply a subscription ID, resource group and region');
  const arm=JSON.parse(await readFile(join(root,'architecture.arm.json'),'utf8')), absent=[];
  for(const [name,parameter] of Object.entries(arm.parameters??{})) {
   const entry=target.parameters?.[name]??('defaultValue' in parameter?{value:parameter.defaultValue}:undefined);
   if(!entry || !entry.reference && (entry.value===undefined||entry.value===null||entry.value===''))absent.push(name);
   else { if(/^secure/i.test(parameter.type)&&!entry.reference)throw new Error('Use a Key Vault parameter reference for '+name+'; literal credentials are not accepted by the validation service');effectiveParameters[name]=entry; }
  }
  if(absent.length)missing('Supply deployment parameters: '+absent.join(', '));
  if(Object.keys(target.parameters??{}).some(k=>!arm.parameters[k]))throw new Error('Target includes unknown deployment parameters');
  if(manifestFiles.length && (!target.kubernetes?.context || spec.namespaces.length!==1 || !spec.namespaces.includes(target.kubernetes.namespace)))missing('Select one actual Kubernetes context and declared namespace for this scope: '+spec.namespaces.join(', '));
  if(effectiveParameters.tenantNamespace?.value && effectiveParameters.tenantNamespace.value!==target.kubernetes?.namespace)throw new Error('The identity parameter tenantNamespace differs from the actual workload namespace');
  const tfvars={subscription_id:target.subscriptionId,resource_group_name:target.resourceGroupName,location:target.location,deployment_parameters:effectiveParameters};
  const azure={resourceGroupName:{value:target.resourceGroupName},location:{value:target.location},deploymentParameters:{value:effectiveParameters}};
  await writeFile(join(privateDir,'terraform.tfvars.json'),JSON.stringify(tfvars),{mode:0o600});
  await writeFile(join(privateDir,'azure-parameters.json'),JSON.stringify(azure),{mode:0o600});
  return {message:'Explicit target and all required deployment parameters supplied'};
 },['integrity']);
 await stage('azure-account',async()=>{
  const result=await jsonCommand('az',['account','show','--subscription',target.subscriptionId,'--query','{id:id,tenantId:tenantId}','--output','json']);
  if(result.data.id?.toLowerCase()!==target.subscriptionId.toLowerCase())throw new Error('Azure account does not match the selected subscription');
  return {message:'Selected Azure subscription is accessible'};
 },['target-inputs']);
 await stage('terraform-plan',async()=>{
  const result=await command('terraform',['plan','-input=false','-no-color','-detailed-exitcode','-var-file='+join(privateDir,'terraform.tfvars.json'),'-out='+join(privateDir,'terraform.plan')],[0,2],600000);
  return {message:result.code===2?'Terraform plan succeeded with proposed changes':'Terraform plan succeeded without changes'};
 },['terraform-validate','azure-account']);
 await stage('azure-validate',async()=>{
  const {data}=await jsonCommand('az',['deployment','sub','validate',...azureArgs()], [0],600000);
  if(data.error)throw new Error(JSON.stringify(data.error));report.cloudValidated=true;
  return {message:'Azure Provider validation passed, including deployment permission checks'};
 },['bicep-build','azure-account']);
 await stage('azure-what-if',async()=>{
  const {data}=await jsonCommand('az',['deployment','sub','what-if',...azureArgs(),'--no-pretty-print','--result-format','FullResourcePayloads'],[0],600000);
  if(data.error||data.status && data.status!=='Succeeded')throw new Error(JSON.stringify(data.error??data.status));
  const changes=data.changes??data.properties?.changes;
  if(!Array.isArray(changes))throw new Error('Azure what-if did not return a complete change list');
  if(changes.some(c=>['Unsupported','Ignore','Deploy'].includes(c.changeType)))missing('Azure what-if could not evaluate every nested resource. Review unresolved/ignored resources before deployment.');
  return {message:'Azure what-if completed',details:changes.map(c=>c.changeType+' '+c.resourceId)};
 },['azure-validate']);
 if(manifestFiles.length) await stage('kubernetes-dry-run',async()=>{await dryRun(manifestFiles);return {message:'Server-side schema, admission and ownership checks passed for '+manifestFiles.length+' manifests'};},['target-inputs']);
 else await skip('kubernetes-dry-run','No Kubernetes manifests are part of this architecture');
 if(spec.secretSync)await stage('secret-sync-dry-run',async()=>{await renderSync(target.secretSyncValues);await dryRun([syncFile]);return {message:'Rendered secret delivery passed Kubernetes server-side validation'};},['kubernetes-dry-run','target-inputs']);
 else await skip('secret-sync-dry-run','No secret-controller manifest in this architecture');
 await stage('test-deployment',async()=>{
  if(!executeTest)missing('Test deployment has not been authorized for this run. Use --deploy-test with an explicitly enabled non-production target.');
  if(!target.allowTestDeployment||spec.unitIds.some(id=>/(?:^|[/:])(?:prod|production)(?:[/:]|$)/.test(id)))missing('Test deployment requires an enabled non-production scope and target');
  if(check('secret-sync-dry-run').status==='failed')missing('Resolve the failed secret-controller validation before creating any test resources');
  if(target.testDeploymentMethod==='terraform' && process.env.LAUNCHPILOT_VALIDATION_WORKER==='1' && process.env.LAUNCHPILOT_VALIDATION_DURABLE_STATE!=='1')missing('Configure LAUNCHPILOT_VALIDATION_STATE_DIR on persistent private storage before a Terraform test deployment; state must survive the validation job');
  // Never adopt an existing resource group during an automated deployment test.
  const existing=await jsonCommand('az',['group','exists','--name',target.resourceGroupName,'--subscription',target.subscriptionId,'--output','json']);
  if(existing.data!==false)missing('The test resource group already exists. Select a fresh dedicated test group; no resources were changed.');
  report.deploymentTestMethod=target.testDeploymentMethod??'bicep';
  if(!['bicep','terraform'].includes(report.deploymentTestMethod))throw new Error('Unsupported deployment entry point');
  report.deploymentAttempted=true;await persist();
  if(report.deploymentTestMethod==='terraform') {
   await command('terraform',['apply','-input=false','-no-color',join(privateDir,'terraform.plan')],[0],1800000);
   const outputs=(await jsonCommand('terraform',['output','-json'])).data;deploymentResult=outputs.azure_outputs?.value??{};
  } else {
   const {data}=await jsonCommand('az',['deployment','sub','create',...azureArgs()],[0],1800000);
   if(data.properties?.provisioningState!=='Succeeded')throw new Error('Azure deployment did not reach Succeeded');
   deploymentResult=data.properties.outputs?.azureOutputs?.value??{};
  }
  report.deployed=true;await persist();
  if(spec.secretSync) {
   const unwrap=key=>deploymentResult[key]?.value;
   await stage('secret-sync-dry-run',async()=>{await renderSync({identityClientId:unwrap('identityClientId'),tenantId:unwrap('tenantId'),vaultUri:unwrap('vaultUri'),namespace:target.kubernetes.namespace,serviceAccountName:effectiveParameters.secretSyncServiceAccount?.value});await dryRun([syncFile]);return {message:'Actual deployed outputs rendered and server-validated'};});
   if(!ok('secret-sync-dry-run'))throw new Error('Azure test resources were created, but secret synchronization validation failed. See the report before applying workloads.');
  }
  for(const path of [...(syncFile?[syncFile]:[]),...manifestFiles])await command('kubectl',[...kubeArgs(),'apply','--server-side','--field-manager=launchpilot-validation','-f',path,'-o','name']);
  return {message:'Test deployment completed using '+report.deploymentTestMethod+'. Resources remain in the explicit test target for review.'};
 },['terraform-plan','azure-what-if','kubernetes-dry-run']);
 await stage('rollout',async()=>{
  for(const w of spec.workloads) {
   if(!target.kubernetes || w.namespace!==target.kubernetes.namespace)missing('Workload namespace is not covered by the selected cluster target: '+w.name);
   if(!['Deployment','StatefulSet','DaemonSet','Pod','Job'].includes(w.controller))missing('Supply a runtime verification adapter for '+w.controller+' '+w.name);
   await eventually(async()=>{
   const {data}=await jsonCommand('kubectl',[...kubeArgs(),'get',w.controller,w.name,'-o','json']);
   if(w.minReplicas!==undefined ? data.spec?.replicas<w.minReplicas || data.spec?.replicas>w.maxReplicas : w.replicas!==null && w.controller!=='Pod' && data.spec?.replicas!==w.replicas)throw new Error('Replica count does not match the selected design for '+w.name);
   const pod=w.controller==='Pod'?data.spec:data.spec?.template?.spec;
   const quantity=value=>{const m=String(value).match(/^([+-]?[\d.]+)([numkKMGTEP]i?|[eE][+-]?\d+)?$/);if(!m)return String(value);const suffix=m[2]??'';const multiplier={n:1e-9,u:1e-6,m:1e-3,k:1e3,K:1e3,M:1e6,G:1e9,T:1e12,P:1e15,E:1e18,Ki:1024,Mi:1024**2,Gi:1024**3,Ti:1024**4,Pi:1024**5,Ei:1024**6}[suffix]??(suffix?10**Number(suffix.slice(1)):1);return Number(m[1])*multiplier;};
   for(const c of w.containers) {
    const actual=(c.role==='init'?pod?.initContainers:pod?.containers)?.find(v=>v.name===c.name);
    if(!actual)throw new Error('Missing '+c.role+' container '+w.name+'/'+c.name);
    if(c.image && c.image!=='Image supplied by deployment owner' && actual.image!==c.image)throw new Error('Image differs from the generated design for '+w.name+'/'+c.name);
    for(const mode of ['requests','limits'])for(const [key,amount] of Object.entries(c[mode]??{}))if(quantity(actual.resources?.[mode]?.[key])!==quantity(amount))throw new Error('Resource '+mode+' differs for '+w.name+'/'+c.name+': '+key);
   }
   const actualEnv=pod?.containers?.find(c=>c.name===w.applicationContainer)?.env??[];
   for(const expected of w.environment??[]) {
    const actual=actualEnv.find(e=>e.name===expected.name);
    if(!actual || 'value' in expected && actual.value!==expected.value)throw new Error('Environment binding differs for '+w.name+': '+expected.name);
    if(expected.secretKeyRef && (actual.valueFrom?.secretKeyRef?.name!==expected.secretKeyRef.name || actual.valueFrom?.secretKeyRef?.key!==expected.secretKeyRef.key))throw new Error('Secret delivery differs for '+w.name+': '+expected.name);
   }
   });
   if(['Deployment','StatefulSet','DaemonSet'].includes(w.controller))await command('kubectl',[...kubeArgs(),'rollout','status',w.controller.toLowerCase()+'/'+w.name,'--timeout=300s'],[0],330000);
   else await command('kubectl',[...kubeArgs(),'wait','--for=condition='+(w.controller==='Job'?'Complete':'Ready'),w.controller.toLowerCase()+'/'+w.name,'--timeout=300s'],[0],330000);
  }
  for(const secret of spec.requiredSecrets) {
   await eventually(async()=>{
   const {stdout}=await command('kubectl',[...kubeArgs(),'get','secret',secret.name,'-o','go-template={{range $key, $value := .data}}{{$key}}{{"\\n"}}{{end}}']);
   const keys=stdout.split(/\s+/);if(secret.keys.some(k=>!keys.includes(k)))throw new Error('Required configuration keys are missing from '+secret.name);
   });
  }
  return {message:'Expected containers, images, resources and replicas are ready; required Secret keys exist. Secret values were not read.'};
 },['test-deployment','secret-sync-dry-run']);
 await stage('health',async()=>{
  if(!target.healthChecks?.length)missing('Configure application health checks for this target. Deployment success alone is not a runtime test.');
  const required=[...spec.requiredHealthComponents,...spec.requiredReadinessComponents.map(c=>c.id)];
  const covered=new Set([...(target.healthChecks??[]),...(target.resourceChecks??[])].flatMap(c=>c.componentIds??[]));
  const uncovered=required.filter(id=>!covered.has(id));
  if(uncovered.length)missing('Runtime checks do not cover these selected components: '+uncovered.join(', '));
  if([...covered].some(id=>!spec.componentIds.includes(id)))throw new Error('Runtime checks reference components outside the selected architecture');
  for(const test of target.healthChecks) {
   await eventually(async()=>{
   const url=new URL(test.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Health checks require credential-free HTTP(S) URLs');
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
   if(response.status!==(test.expectedStatus??200))throw new Error(test.name+' returned HTTP '+response.status);
   if(test.bodyIncludes && !(await response.text()).includes(test.bodyIncludes))throw new Error(test.name+' did not return the expected response');
   });
  }
  for(const test of target.resourceChecks??[]) {
   if(test.namespace!==target.kubernetes?.namespace)throw new Error('Readiness check points outside the selected namespace');
   if(!/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9.-]+$/.test(test.resource))throw new Error('Readiness checks require a resource-kind/resource-name pair');
   await eventually(async()=>{
    const {data}=await jsonCommand('kubectl',[...kubeArgs(),'get',test.resource,'-o','json']);
    if(data.status?.observedGeneration!==undefined && data.status.observedGeneration<data.metadata.generation)throw new Error(test.name+' has not reconciled its current generation');
    if(!data.status?.conditions?.some(c=>c.type===test.condition&&c.status===(test.expected??'True')))throw new Error(test.name+' is not ready');
   });
  }
  return {message:'Configured application health and dependency readiness checks passed'};
 },['rollout']);
 if(!spec.platformRequirements.length)await skip('platform-acceptance','No additional platform acceptance requirements in the generated architecture');
 else await stage('platform-acceptance',async()=>{
  const covered=new Set((target.platformChecks??[]).flatMap(c=>c.requirementIds??[]));
  const absent=spec.platformRequirements.filter(r=>!covered.has(r.id));
  if(absent.length)missing('Supply platform acceptance evidence for: '+absent.map(r=>r.name).join(', '));
  if([...covered].some(id=>!spec.platformRequirements.some(r=>r.id===id)))throw new Error('Platform checks reference unknown architecture requirements');
  for(const test of target.platformChecks) {
   if(!test.assertions?.length)throw new Error('Platform acceptance requires explicit JSON assertions: '+test.name);
   await eventually(async()=>{
    let data;
    if(test.source.type==='http') {
     const url=new URL(test.source.url);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Platform evidence requires a credential-free HTTP(S) URL');
     const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
     if(!response.ok)throw new Error(test.name+' returned HTTP '+response.status);data=await response.json();
    } else if(test.source.type==='kubernetes') {
     if(test.source.namespace!==target.kubernetes?.namespace||!test.source.resource.match(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9.-]+$/))throw new Error('Platform evidence must use the selected namespace and an explicit resource');
     data=(await jsonCommand('kubectl',[...kubeArgs(),'get',test.source.resource,'-o','json'])).data;
    } else throw new Error('Unknown platform acceptance source');
    for(const assertion of test.assertions) {
     if(!assertion.pointer.startsWith('/')||assertion.equals===undefined)throw new Error('Supply a concrete platform assertion for '+test.name);
     const observed=assertion.pointer.slice(1).split('/').map(key=>key.replaceAll('~1','/').replaceAll('~0','~')).reduce((value,key)=>value!==null&&typeof value==='object'&&Object.hasOwn(value,key)?value[key]:undefined,data);
     if(JSON.stringify(observed)!==JSON.stringify(assertion.equals))throw new Error(test.name+' failed its acceptance assertion at '+assertion.pointer);
    }
   });
  }
  return {message:'All '+spec.platformRequirements.length+' architecture-specific platform requirements have passing configured acceptance evidence'};
 },['health']);
} catch(error) {
 for(const c of report.checks)if(['pending','running'].includes(c.status))Object.assign(c,{status:'failed',message:redact(error.message),completedAt:stamp()});
} finally {
 for(const c of report.checks)if(c.status==='pending')Object.assign(c,{status:'blocked',message:'A prerequisite did not complete'});
 report.status=report.checks.some(c=>c.status==='failed')?'failed':report.checks.some(c=>c.status==='blocked')?'blocked':'passed';
 report.completedAt=stamp();await persist();
 await rm(privateDir,{recursive:true,force:true});
 console.log(JSON.stringify({status:report.status,bundleHash:report.bundleHash,report:'validation-report.json',deployed:report.deployed}));
 process.exitCode=report.status==='passed'?0:report.status==='blocked'?2:1;
}
`;
