import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLLMProvider, recommendArchitecture, resolveProviderConfig, type GroundedArchitecturePlan, type RepositoryArchitecture } from '@launchpilot/core';
import { reviewRelatedDeploymentFiles } from '../../packages/core/src/architecture/planner';
import { saveArchitecture, saveArchitectureJob, loadArchitectureDesign, saveArchitectureDesign } from '../../packages/web/src/lib/architecture-store';
import { prepareArchitectureReview, readArchitectureReview, editArchitectureReview, runArchitectureReview, retryArchitectureReview } from '../../packages/web/src/lib/architecture-review';

vi.mock('@launchpilot/core', async original => ({ ...await original<typeof import('@launchpilot/core')>(), createLLMProvider: vi.fn(), recommendArchitecture: vi.fn(), resolveProviderConfig: vi.fn() }));
let directory: string;
const graph: RepositoryArchitecture = { version: 1, id: 'a'.repeat(64), repoUrl: 'local://review', revision: 'fixture', scannedAt: '', deploymentContext: [], resources: [], evidence: [], connections: [], bindings: [], gaps: [], recommendations: [], deploymentUnits: [], coverage: { filesScanned: 1, deploymentFiles: 0, files: [], excluded: [], limits: { maxFiles: 10, maxFileBytes: 1000, maxTotalBytes: 10000 }, truncated: false, runtimeVerified: false } };
const plan: GroundedArchitecturePlan = { id: 'b'.repeat(64), architectureId: graph.id, unitIds: [], provider: 'azure', model: 'test', createdAt: '', evidenceCoverage: { resources: 0, bindings: 0, decisions: 0 }, summary: 'Reviewed fixture', components: [], connections: [], configuration: [], resourceDecisions: [], decisions: [], inputs: [], operations: (['availability', 'backup', 'observability', 'security', 'delivery', 'cost'] as const).map(concern => ({ concern, recommendation: 'Review platform input', rationale: 'Not declared', evidenceIds: [], componentIds: [] })) };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lp-review-'));
  vi.stubEnv('LAUNCHPILOT_ARCHITECTURE_DIR', directory);
  vi.mocked(resolveProviderConfig).mockReturnValue({ provider: 'catalyst', analysisModel: 'test', gatewayUrl: 'https://example.test/v1' });
  await saveArchitecture(graph);
});
afterEach(async () => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('saved proactive architecture review', () => {
  it('upgrades an older proposal once without losing edits or accepting a stale revision', async () => {
    const prepared=await prepareArchitectureReview(graph,[]);
    const {proposalVersion,...legacy}=prepared.design;
    await saveArchitectureDesign(legacy);
    const upgraded=await readArchitectureReview(legacy.id);
    expect(upgraded.design.revision).toBe(legacy.revision+1);
    expect(upgraded.design.edits).toEqual(legacy.edits);
    expect((await readArchitectureReview(legacy.id)).design.revision).toBe(upgraded.design.revision);
    await expect(editArchitectureReview(legacy.id,legacy.revision,'reset')).rejects.toThrow('REVISION_CONFLICT');
  });
  it('isolates saved designs and review work by deployment cloud', async () => {
    const azure = await prepareArchitectureReview(graph, [], undefined, 'azure');
    const aws = await prepareArchitectureReview(graph, [], undefined, 'aws');
    const gcp = await prepareArchitectureReview(graph, [], undefined, 'gcp');
    expect(new Set([azure.design.id, aws.design.id, gcp.design.id]).size).toBe(3);
    expect(aws.design.cloudProvider).toBe('aws');
    vi.mocked(createLLMProvider).mockReturnValue({ analyzeStructured: vi.fn() } as never);
    vi.mocked(recommendArchitecture).mockResolvedValue({ ...plan, id: 'c'.repeat(64), provider: 'aws' });
    await runArchitectureReview(aws.design.id);
    expect(vi.mocked(recommendArchitecture).mock.calls[0][3]).toBe('aws');
    expect((await readArchitectureReview(aws.design.id)).plan?.provider).toBe('aws');
    expect((await readArchitectureReview(azure.design.id)).plan).toBeNull();
    expect((await readArchitectureReview(gcp.design.id)).plan).toBeNull();
    expect((await readArchitectureReview(aws.design.id)).issues.some(i => i.id === 'cloud-export')).toBe(true);
  });
  it('returns a saved proposal before model work, resumes completed checkpoints after failure, and preserves edits', async () => {
    const prepared = await prepareArchitectureReview(graph, []);
    expect(prepared.job.status).toBe('queued');
    expect(recommendArchitecture).not.toHaveBeenCalled();
    let failSecond = true;
    const model = vi.fn(async (system: string) => {
      if (system === 'second' && failSecond) throw new Error('Simulated gateway interruption');
      return { result: { step: system }, usage: { model: 'test' } };
    });
    vi.mocked(createLLMProvider).mockImplementation(() => ({ analyzeStructured: model }) as never);
    vi.mocked(recommendArchitecture).mockImplementation(async (_graph, _units, client) => {
      await client.analyzeStructured('first', 'saved topology');
      await client.analyzeStructured('second', 'configuration');
      return plan;
    });
    await runArchitectureReview(prepared.design.id);
    expect((await readArchitectureReview(prepared.design.id)).job).toMatchObject({ status: 'failed', completedCalls: 1 });
    const edited = await editArchitectureReview(prepared.design.id, 0, { type: 'add-component', id: 'external-api', fields: { name: 'External API', kind: 'service', technology: 'HTTPS API', owner: 'External / existing platform', layer: 'integration', description: 'User-selected integration' } });
    failSecond = false;
    await retryArchitectureReview(prepared.design.id);
    await runArchitectureReview(prepared.design.id);
    const completed = await readArchitectureReview(prepared.design.id);
    expect(model.mock.calls.filter(([system]) => system === 'first')).toHaveLength(1);
    expect(completed.job).toMatchObject({ status: 'complete', completedCalls: 2, reusedCalls: 1, attempt: 2 });
    expect(completed.design.edits).toEqual(edited.design.edits);
    expect(completed.design.revision).toBe(2);
    expect(completed.topology.nodes.some(n => n.id === 'external-api')).toBe(true);
    expect((await prepareArchitectureReview(graph, [])).job.status).toBe('complete');
    expect(recommendArchitecture).toHaveBeenCalledTimes(2);
  });
  it('detects concurrent edits, supports undo, and rejects dangling endpoints without overwriting the draft', async () => {
    const { design } = await prepareArchitectureReview(graph, []);
    const edit = { type: 'add-component' as const, id: 'external', fields: { name: 'External', kind: 'service' as const, technology: 'HTTPS', owner: 'External', layer: 'integration' as const, description: '' } };
    const results = await Promise.allSettled([editArchitectureReview(design.id, 0, edit), editArchitectureReview(design.id, 0, { ...edit, id: 'another' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason)).toContain('REVISION_CONFLICT');
    const current = await loadArchitectureDesign(design.id);
    await expect(editArchitectureReview(design.id, current.revision, { type: 'put-connection', connection: { id: 'broken', from: 'external', to: 'missing', purpose: 'Broken link', binding: { type: 'design' } } })).rejects.toThrow('distinct components');
    expect((await loadArchitectureDesign(design.id)).revision).toBe(1);
    expect((await editArchitectureReview(design.id, 1, 'undo')).topology.nodes).toEqual([]);
  });
  it('retries rejected checkpoint responses while retaining successfully reviewed file batches', async () => {
    const prepared=await prepareArchitectureReview(graph,[]);
    let invalid=true;
    const model=vi.fn(async (_system:string,input:string)=>{
      const {files}=JSON.parse(input.split('\nRegenerate')[0]);
      return {result:{reviews:files.map((f:{id:string;file:string})=>({id:invalid && f.file==='second.yaml'?'unknown-document':f.id,findings:'Preserve existing deployment implementation.'}))},usage:{model:'test'}};
    });
    vi.mocked(createLLMProvider).mockImplementation(()=>({analyzeStructured:model}) as never);
    vi.mocked(recommendArchitecture).mockImplementation(async (_graph,_units,client)=>{
      await reviewRelatedDeploymentFiles({...graph,relatedDeploymentContext:[{file:'first.yaml',content:'x'.repeat(50000),redacted:true},{file:'second.yaml',content:'y'.repeat(50000),redacted:true}]},client,'azure');
      return plan;
    });
    await runArchitectureReview(prepared.design.id);
    expect((await readArchitectureReview(prepared.design.id)).job.status).toBe('failed');
    invalid=false;
    await retryArchitectureReview(prepared.design.id);
    await runArchitectureReview(prepared.design.id);
    const resumed=await readArchitectureReview(prepared.design.id);
    expect(resumed.job.error).toBeUndefined();
    expect(resumed.job.status).toBe('complete');
    expect(model.mock.calls.filter(([,input])=>input.includes('first.yaml'))).toHaveLength(1);
    expect(model.mock.calls.filter(([,input])=>input.includes('second.yaml'))).toHaveLength(3);
  });
  it('resumes a stale worker lease while keeping a live worker lease untouched', async () => {
    const prepared = await prepareArchitectureReview(graph, []);
    vi.mocked(createLLMProvider).mockReturnValue({ analyzeStructured: vi.fn() } as never);
    vi.mocked(recommendArchitecture).mockResolvedValue(plan);
    await saveArchitectureJob({ ...prepared.job, status: 'running', updatedAt: new Date().toISOString() });
    await runArchitectureReview(prepared.design.id);
    expect(recommendArchitecture).not.toHaveBeenCalled();
    await saveArchitectureJob({ ...prepared.job, status: 'running', updatedAt: new Date(Date.now() - 60000).toISOString() });
    await runArchitectureReview(prepared.design.id);
    expect((await readArchitectureReview(prepared.design.id)).job.status).toBe('complete');
    expect(recommendArchitecture).toHaveBeenCalledTimes(1);
  });
});
