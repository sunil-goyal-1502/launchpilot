import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareValidationBundle, validateGeneratedBundle } from '../../../packages/core/src/architecture/validation';
import { validationTargetSchema, type ValidationTarget } from '../../../packages/core/src/architecture/validation-types';

let directory: string, environment: NodeJS.ProcessEnv;
const subscriptionId = '12345678-1234-4234-8234-123456789abc';
const workload = { id: 'api', name: 'api', controller: 'Deployment', replicas: 2, namespace: 'qa', resourceIds: ['api'], containers: [{ name: 'api', image: 'registry.test/api:v2', role: 'application', requests: { cpu: '1000m' }, limits: {} }], exposed: true };
function bundle(extra: Record<string, string> = {}) {
  return prepareValidationBundle({
    'evidence.json': JSON.stringify({ id: 'a'.repeat(64), resources: [], bindings: [] }),
    'plan.json': JSON.stringify({ unitIds: ['kubernetes:deploy/qa'] }),
    'architecture-design.json': JSON.stringify({ revision: 7 }),
    'deployment-topology.json': JSON.stringify({ namespaces: ['qa'], workloads: [workload], nodes: [{ id: 'api' }, { id: 'db', name: 'Database', technology: 'postgresql (Cortex capability)' }, { id: 'cache', name: 'Cache', technology: 'redis (Cortex capability)' }] }),
    'architecture.arm.json': JSON.stringify({ parameters: { appName: { type: 'string' } }, resources: [] }),
    'main.tf.json': JSON.stringify({ terraform: { required_providers: { azapi: { source: 'Azure/azapi' } } }, provider: { azapi: {} }, resource: { azapi_resource: {} } }),
    'main.bicep': "targetScope = 'subscription'\n", 'workload.bicep': "targetScope = 'resourceGroup'\n",
    'support/deployment.json': JSON.stringify({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', namespace: 'qa' }, spec: { template: { spec: { containers: [{ name: 'api', env: [{ name: 'TOKEN', valueFrom: { secretKeyRef: { name: 'api-secret', key: 'token' } } }] }] } } } }),
    ...extra,
  });
}
function target(overrides: Partial<ValidationTarget> = {}): ValidationTarget {
  return validationTargetSchema.parse({ id: 'qa', name: 'Explicit QA target', environment: 'qa', architectureId: 'a'.repeat(64), unitIds: ['kubernetes:deploy/qa'], subscriptionId, resourceGroupName: 'fresh-qa-test', location: 'uaenorth', parameters: { appName: { value: 'qa-api' } }, kubernetes: { context: 'explicit-qa-context', namespace: 'qa' }, allowTestDeployment: true, healthChecks: [{ name: 'API', componentIds: ['api'], url: 'https://api.example.test/health' }], resourceChecks: [{ name: 'Data services', componentIds: ['db', 'cache'], resource: 'platformapps/data', namespace: 'qa', condition: 'Ready' }], ...overrides });
}
const fakeTool = `#!NODE
const {appendFileSync,writeFileSync}=require('node:fs');
const {basename}=require('node:path');
const tool=basename(process.argv[1]),args=process.argv.slice(2),mode=process.env.TEST_MODE;
appendFileSync(process.env.TEST_LOG,JSON.stringify({tool,args})+'\\n');
const emit=value=>console.log(JSON.stringify(value));
if(tool==='terraform') {
 if(args[0]==='version')emit({terraform_version:'1.9.0'});
 if(args[0]==='init')writeFileSync('.terraform.lock.hcl','# provider lock checked in fixture');
 if(args[0]==='validate')emit({valid:mode!=='invalid-tf',diagnostics:mode==='invalid-tf'?[{summary:'Invalid resource',detail:'provider rejected configuration'}]:[]});
 if(args[0]==='plan')process.exitCode=2;
 if(args[0]==='apply')writeFileSync('terraform.tfstate','private-test-state');
 if(args[0]==='output')emit({});
}
if(tool==='bicep') {
 if(args[0]==='--version')console.log('Bicep fixture');
 if(args[0]==='build')writeFileSync(args[args.indexOf('--outfile')+1],'{}');
}
if(tool==='az') {
 if(args[0]==='account')emit({id:'${subscriptionId}',tenantId:'tenant'});
 if(args[0]==='group')emit(mode==='existing-group');
 if(args[2]==='validate')emit({});
 if(args[2]==='what-if')emit({status:'Succeeded',changes:[{changeType:mode==='unresolved-preview'?'Deploy':'Create',resourceId:'/subscriptions/test/resourceGroups/fresh-qa-test'}]});
 if(args[2]==='create')emit({properties:{provisioningState:'Succeeded',outputs:{}}});
}
if(tool==='kubectl') {
 if(args.includes('apply')&&mode==='bad-cluster'){console.error('The required CRD is unavailable');process.exitCode=1;}
 if(args.includes('get')) {
  if(args.includes('Deployment'))emit({spec:{replicas:mode==='wrong-replicas'?1:2,template:{spec:{containers:[{name:'api',image:mode==='wrong-image'?'registry.test/api:old':'registry.test/api:v2',resources:{requests:{cpu:'1'}}}]}}}});
  else if(args.includes('secret'))console.log(mode==='missing-secret'?'other-key':'token');
  else emit({status:{conditions:[{type:'Ready',status:mode==='unready-dependency'?'False':'True'}]}});
 }
}
`;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lp-validation-test-'));
  for (const tool of ['terraform', 'bicep', 'az', 'kubectl']) await writeFile(join(directory, tool), fakeTool.replace('NODE', process.execPath), { mode: 0o700 });
  await writeFile(join(directory, 'http.mjs'), 'globalThis.fetch = async () => new Response("healthy", {status: 200});');
  environment = { LAUNCHPILOT_ROLLOUT_TIMEOUT_MS: '1', LAUNCHPILOT_TERRAFORM_BIN: join(directory, 'terraform'), LAUNCHPILOT_BICEP_BIN: join(directory, 'bicep'), LAUNCHPILOT_AZ_BIN: join(directory, 'az'), LAUNCHPILOT_KUBECTL_BIN: join(directory, 'kubectl'), TEST_LOG: join(directory, 'calls.jsonl'), NODE_OPTIONS: '--import=' + join(directory, 'http.mjs') };
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
async function calls() { try { return (await readFile(join(directory, 'calls.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)); } catch { return []; } }
const check = (result: Awaited<ReturnType<typeof validateGeneratedBundle>>, id: string) => result.report.checks.find(c => c.id === id)!;

describe('mandatory generated-artifact validation', () => {
  it('always runs both local validators and records unavailable target checks as incomplete', async () => {
    const result = await validateGeneratedBundle(bundle(), { environment });
    expect(result.report).toMatchObject({ status: 'blocked', designRevision: 7, deployed: false, deploymentAttempted: false, targetId: null });
    expect(check(result, 'terraform-validate').status).toBe('passed');
    expect(check(result, 'bicep-build').status).toBe('passed');
    expect(check(result, 'target-inputs').message).toContain('Select a configured');
    expect(result.files['validation-report.json']).toContain(result.report.bundleHash);
    expect(result.files['.terraform.lock.hcl']).toContain('provider lock');
    expect((await calls()).every(c => ['terraform', 'bicep'].includes(c.tool))).toBe(true);
  });
  it('detects tampering before executing any tool and rejects unsafe paths', async () => {
    const files = bundle(); files['main.tf.json'] += '\n';
    const result = await validateGeneratedBundle(files, { environment });
    expect(check(result, 'integrity').status).toBe('failed');
    expect(await calls()).toEqual([]);
    expect(() => prepareValidationBundle({ '../outside': 'x' })).toThrow('Unsafe');
  });
  it('performs target checks with an explicit subscription/context but never applies by default', async () => {
    const result = await validateGeneratedBundle(bundle(), { target: target(), environment });
    expect(check(result, 'terraform-plan').status).toBe('passed');
    expect(check(result, 'azure-what-if').status).toBe('passed');
    expect(check(result, 'kubernetes-dry-run').status).toBe('passed');
    expect(result.report.status).toBe('blocked');
    const log = await calls();
    expect(log.filter(c => c.tool === 'az').every(c => c.args.includes(subscriptionId))).toBe(true);
    expect(log.filter(c => c.tool === 'kubectl').every(c => c.args.includes('explicit-qa-context') && c.args.includes('--dry-run=server'))).toBe(true);
    expect(log.some(c => c.args.includes('create') || c.tool === 'terraform' && c.args[0] === 'apply')).toBe(false);
  });
  it.each(['invalid-tf', 'unresolved-preview', 'bad-cluster', 'existing-group'])('blocks deployment after %s', async mode => {
    const result = await validateGeneratedBundle(bundle(), { target: target(), deployTest: true, environment: { ...environment, TEST_MODE: mode } });
    expect(result.report.status).not.toBe('passed');
    expect(result.report.deploymentAttempted).toBe(false);
    expect((await calls()).some(c => c.args.includes('create') || c.tool === 'terraform' && c.args[0] === 'apply')).toBe(false);
  });
  it('requires coverage of every capability, not one successful dependency check', async () => {
    const config = target(); config.resourceChecks[0].componentIds = ['db'];
    const result = await validateGeneratedBundle(bundle(), { target: config, deployTest: true, environment });
    expect(check(result, 'health')).toMatchObject({ status: 'blocked' });
    expect(check(result, 'health').message).toContain('cache');
    expect(result.report.status).toBe('blocked');
  });
  it.each(['wrong-replicas', 'wrong-image', 'missing-secret', 'unready-dependency'])('does not pass runtime validation with %s', async mode => {
    const result = await validateGeneratedBundle(bundle(), { target: target(), deployTest: true, environment: { ...environment, TEST_MODE: mode } });
    expect(result.report).toMatchObject({ status: 'failed', deploymentAttempted: true, deployed: true });
    expect(result.report.checks.some(c => c.status === 'failed')).toBe(true);
  });
  it('only passes after all configured checks including deployment, rollout and health succeed', async () => {
    const result = await validateGeneratedBundle(bundle(), { target: target(), deployTest: true, environment });
    expect(result.report).toMatchObject({ status: 'passed', cloudValidated: true, deployed: true, deploymentAttempted: true, deploymentTestMethod: 'bicep' });
    expect(result.report.checks.every(c => ['passed', 'not-applicable'].includes(c.status))).toBe(true);
    expect(Object.keys(result.files).some(f => /tfstate|private-validation|tfvars/.test(f))).toBe(false);
  });
  it('keeps Terraform state in private persistent storage and refuses to apply without it', async () => {
    const config = target({ testDeploymentMethod: 'terraform' });
    const blocked = await validateGeneratedBundle(bundle(), { target: config, deployTest: true, environment });
    expect(check(blocked, 'test-deployment').message).toContain('LAUNCHPILOT_VALIDATION_STATE_DIR');
    expect(blocked.report.deploymentAttempted).toBe(false);
    const stateRoot = join(directory, 'private-state');
    const result = await validateGeneratedBundle(bundle(), { target: config, deployTest: true, environment: { ...environment, LAUNCHPILOT_VALIDATION_STATE_DIR: stateRoot } });
    expect(result.report.status).toBe('passed');
    const [worker] = await readdir(stateRoot);
    expect(await readFile(join(stateRoot, worker, 'terraform.tfstate'), 'utf8')).toBe('private-test-state');
    expect(Object.keys(result.files).some(f => f.endsWith('.tfstate'))).toBe(false);
  });
  it('reports missing tools as blocked rather than silently passing', async () => {
    const result = await validateGeneratedBundle(bundle(), { environment: { ...environment, LAUNCHPILOT_TERRAFORM_BIN: join(directory, 'missing') } });
    expect(check(result, 'terraform-init')).toMatchObject({ status: 'blocked' });
    expect(check(result, 'bicep-build').status).toBe('passed');
    expect(result.report.status).toBe('blocked');
  });
  it('keeps platform requirements incomplete until their real acceptance assertions pass', async () => {
    const files = bundle({ 'deployment-readiness.json': JSON.stringify({ requiredChecks: [{ name: 'Database HA and recovery', action: 'Verify the provider HA and restore acceptance contract' }] }) });
    const missing = await validateGeneratedBundle(files, { target: target(), deployTest: true, environment });
    expect(check(missing, 'platform-acceptance')).toMatchObject({ status: 'blocked' });
    expect(check(missing, 'platform-acceptance').message).toContain('Database HA');
    const [requirement] = JSON.parse(files['validation-spec.json']).platformRequirements;
    const config = target({ platformChecks: [{ name: 'Database acceptance', requirementIds: [requirement.id], source: { type: 'kubernetes', resource: 'acceptancereports/database', namespace: 'qa' }, assertions: [{ pointer: '/status/conditions/0/status', equals: 'True' }] }] });
    const passing = await validateGeneratedBundle(files, { target: config, deployTest: true, environment });
    expect(check(passing, 'platform-acceptance').status).toBe('passed');
    expect(passing.report.status).toBe('passed');
    config.platformChecks[0].assertions[0].equals = 'NotReady';
    const failing = await validateGeneratedBundle(files, { target: config, deployTest: true, environment });
    expect(check(failing, 'platform-acceptance').status).toBe('failed');
  });
});
