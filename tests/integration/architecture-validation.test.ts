import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { unzipSync, strFromU8 } from 'fflate';
import { buildArchitectureBundle, generateArchitectureArtifact, prepareValidationBundle, validateGeneratedBundle, validationTargetSchema, requiredValidationCheckIds, type RepositoryArchitecture, type GroundedArchitecturePlan, type ValidationReport } from '@launchpilot/core';
import { prepareArchitectureValidation, runArchitectureValidation, validationTargetFingerprint } from '../../packages/web/src/lib/architecture-validation';
import { prepareArchitectureReview, editArchitectureReview } from '../../packages/web/src/lib/architecture-review';
import { saveArchitecture, saveArchitecturePlan, loadValidationJob, loadValidationBundle, saveValidationJob, loadArchitectureDesign, saveArchitectureDesign, loadArchitectureJob, saveArchitectureJob } from '../../packages/web/src/lib/architecture-store';
import { GET, POST } from '../../packages/web/src/app/api/architecture/export/route';

vi.mock('@launchpilot/core', async original => ({ ...await original<typeof import('@launchpilot/core')>(), generateArchitectureArtifact: vi.fn(), createLLMProvider: vi.fn(), resolveProviderConfig: vi.fn(() => ({ provider: 'catalyst' })), buildArchitectureBundle: vi.fn(), prepareValidationBundle: vi.fn(), validateGeneratedBundle: vi.fn() }));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: vi.fn() }));
let directory: string, designId: string;
const graph: RepositoryArchitecture = { version: 1, id: 'a'.repeat(64), repoUrl: 'local://validation', scannedAt: '', deploymentContext: [], resources: [], evidence: [], connections: [], bindings: [], gaps: [], recommendations: [], deploymentUnits: [], coverage: { filesScanned: 1, deploymentFiles: 0, files: [], excluded: [], limits: { maxFiles: 10, maxFileBytes: 1000, maxTotalBytes: 10000 }, truncated: false, runtimeVerified: false } };
const plan: GroundedArchitecturePlan = { id: 'b'.repeat(64), architectureId: graph.id, unitIds: [], provider: 'azure', model: 'test', createdAt: '', evidenceCoverage: { resources: 0, bindings: 0, decisions: 0 }, summary: 'Reviewed fixture', components: [], connections: [], configuration: [], resourceDecisions: [], decisions: [], inputs: [], operations: (['availability', 'backup', 'observability', 'security', 'delivery', 'cost'] as const).map(concern => ({ concern, recommendation: 'Review target', rationale: 'Not declared', evidenceIds: [], componentIds: [] })) };
const report: ValidationReport = { version: 1, bundleHash: 'c'.repeat(64), architectureId: graph.id, designRevision: 1, targetId: null, targetFingerprint: null, status: 'blocked', startedAt: '', updatedAt: '', completedAt: '', checks: [{ id: 'target-inputs', name: 'Target inputs', status: 'blocked', message: 'Select a target' }], cloudValidated: false, deploymentAttempted: false, deployed: false, deploymentTestMethod: null, providerLockHash: null, toolVersions: {} };
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lp-web-validation-'));
  vi.stubEnv('LAUNCHPILOT_ARCHITECTURE_DIR', directory); vi.stubEnv('LAUNCHPILOT_VALIDATION_TARGETS_FILE', '');
  await saveArchitecture(graph); await saveArchitecturePlan(plan);
  designId = (await prepareArchitectureReview(graph, [], plan.id)).design.id;
  vi.mocked(generateArchitectureArtifact).mockResolvedValue({ id: 'd'.repeat(64), planId: plan.id } as never);
  vi.mocked(buildArchitectureBundle).mockReturnValue({ 'main.tf.json': '{}' });
  vi.mocked(prepareValidationBundle).mockImplementation(files => ({ ...files, 'validate.mjs': '// fixed runner', 'validation-spec.json': JSON.stringify({ bundleHash: report.bundleHash }) }));
  vi.mocked(validateGeneratedBundle).mockImplementation(async (files, options) => { await options?.onProgress?.(report); return { files: { ...files, 'validation-report.json': JSON.stringify(report) }, report }; });
});
afterEach(async () => { vi.clearAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const get = (query: string) => GET(new Request('http://localhost/api/architecture/export?' + query));
async function configuredTarget() {
  const target = validationTargetSchema.parse({ id: 'qa', name: 'QA', environment: 'qa', architectureId: graph.id, unitIds: [], subscriptionId: '12345678-1234-4234-8234-123456789abc', resourceGroupName: 'new-qa-rg', location: 'uaenorth', parameters: { privateCredential: { reference: { keyVault: { id: '/subscriptions/private/vault' }, secretName: 'private-key' } } }, allowTestDeployment: true });
  const path = join(directory, 'targets.json'); await writeFile(path, JSON.stringify([target])); vi.stubEnv('LAUNCHPILOT_VALIDATION_TARGETS_FILE', path); return { target, path };
}
describe('generation validation jobs and export gates', () => {
  it('queues generation and returns JSON rather than an unchecked ZIP', async () => {
    const response = await POST(new Request('http://localhost/api/architecture/export', { method: 'POST', body: JSON.stringify({ designId, revision: 1 }) }));
    expect(response.status).toBe(202);
    const { job } = await response.json(); expect(job.status).toBe('queued');
    expect(job.targetId).toBeUndefined(); expect(job.deployTest).toBe(false);
    expect(generateArchitectureArtifact).not.toHaveBeenCalled();
    expect((await (await get(`designId=${designId}`)).json()).job.id).toBe(job.id);
  });
  it('reports the saved review failure instead of implying that a cloud target is required',async()=>{
    await saveArchitectureDesign({...await loadArchitectureDesign(designId),basePlanId:undefined});
    await saveArchitectureJob({...await loadArchitectureJob(designId),status:'failed',error:'Related deployment review failed coverage validation'});
    const response=await POST(new Request('http://localhost/api/architecture/export',{method:'POST',body:JSON.stringify({designId,revision:1})}));
    expect(response.status).toBe(422);
    const {error}=await response.json();
    expect(error).toContain('Architecture review needs attention');
    expect(error).toContain('Related deployment review failed coverage validation');
    expect(error).toContain('selecting a validation target will not resolve');
    expect(generateArchitectureArtifact).not.toHaveBeenCalled();
  });
  it('stores per-revision validation, deduplicates worker calls and blocks a validated download on incomplete checks', async () => {
    const job = await prepareArchitectureValidation({ designId, revision: 1 });
    await Promise.all([runArchitectureValidation(job.id), runArchitectureValidation(job.id)]);
    expect(validateGeneratedBundle).toHaveBeenCalledTimes(1);
    expect((await loadValidationJob(job.id)).status).toBe('blocked');
    expect((await loadValidationBundle(job.id))['validation-report.json']).toBeTruthy();
    expect((await get(`id=${job.id}&download=validated`)).status).toBe(409);
    const download = await get(`id=${job.id}&download=review`);
    expect(download.headers.get('content-disposition')).toContain('VALIDATION-INCOMPLETE');
    const files = unzipSync(new Uint8Array(await download.arrayBuffer()));
    expect(JSON.parse(strFromU8(files['validation-report.json'])).status).toBe('blocked');
    expect(files['validate.mjs']).toBeTruthy();
  });
  it('invalidates old exports and reports after a design edit without rescanning the repository', async () => {
    const job = await prepareArchitectureValidation({ designId, revision: 1 }); await runArchitectureValidation(job.id);
    await editArchitectureReview(designId, 1, 'undo');
    await expect(prepareArchitectureValidation({ designId, revision: 1 })).rejects.toThrow('REVISION_CONFLICT');
    expect((await get(`id=${job.id}&download=review`)).status).toBe(409);
    expect((await (await get(`designId=${designId}`)).json()).job).toBeNull();
  });
  it('pins target configuration and omits private parameter inputs from the UI', async () => {
    const { target, path } = await configuredTarget();
    const body = await (await get('targets=1')).text(); expect(body).not.toContain('privateCredential'); expect(body).not.toContain('private-key');
    const job = await prepareArchitectureValidation({ designId, revision: 1, targetId: target.id });
    await writeFile(path, JSON.stringify([{ ...target, resourceGroupName: 'different-rg' }]));
    await runArchitectureValidation(job.id);
    expect((await loadValidationJob(job.id)).error).toContain('configuration changed');
    expect(validateGeneratedBundle).not.toHaveBeenCalled();
  });
  it('requires explicit current-target authorization and prevents concurrent test deployments into one target', async () => {
    const { target } = await configuredTarget();
    await expect(prepareArchitectureValidation({ designId, revision: 1, targetId: target.id, deployTest: true })).rejects.toThrow('explicit authorization');
    const input = { designId, revision: 1, targetId: target.id, targetFingerprint: validationTargetFingerprint(target), deployTest: true };
    await prepareArchitectureValidation(input);
    await expect(prepareArchitectureValidation(input)).rejects.toThrow('already using');
  });
  it('does not replay an interrupted deployment that might already have changed resources', async () => {
    const job = await prepareArchitectureValidation({ designId, revision: 1 });
    await saveValidationJob({ ...job, deployTest: true, status: 'running', updatedAt: new Date(Date.now() - 60000).toISOString() });
    await runArchitectureValidation(job.id);
    expect((await loadValidationJob(job.id))).toMatchObject({ status: 'blocked', step: 'Deployment test interrupted' });
    expect(validateGeneratedBundle).not.toHaveBeenCalled();
  });
  it('checks the individual gates before offering a validated download', async () => {
    const job = await prepareArchitectureValidation({ designId, revision: 1 }); await runArchitectureValidation(job.id);
    await saveValidationJob({ ...await loadValidationJob(job.id), status: 'passed', report: { ...report, status: 'passed' } });
    expect((await get(`id=${job.id}&download=validated`)).status).toBe(409);
    const passed: ValidationReport = { ...report, status: 'passed', cloudValidated: true, deploymentAttempted: true, deployed: true, targetId: 'qa', targetFingerprint: 'f'.repeat(64), checks: requiredValidationCheckIds.map(id => ({ id, name: id, status: 'passed', message: 'Verified fixture' })) };
    await saveValidationJob({ ...await loadValidationJob(job.id), status: 'passed', report: passed });
    const response = await get(`id=${job.id}&download=validated`);
    expect(response.status).toBe(200);
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(JSON.parse(strFromU8(files['validation-report.json'])).status).toBe('passed');
  });
});
