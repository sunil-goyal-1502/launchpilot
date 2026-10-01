import { createHash } from 'node:crypto';
import { createLLMProvider, recommendArchitecture, resolveProviderConfig, selectArchitectureScope, validateArchitecturePlan, inspectArchitectureDesign, materializeArchitectureDesign, designEditSchema, selectedEnvironment, deploymentEnvironments, environmentName } from '@launchpilot/core';
import type { ArchitectureDesign, ArchitectureReviewJob, ArchitectureCloud, DesignEdit, GroundedArchitecturePlan, RepositoryArchitecture } from '@launchpilot/core';
import { architecturePlanCacheKey, cacheArchitecturePlan, cachedArchitecturePlan, loadArchitecture, loadArchitectureCheckpoint, invalidateArchitectureCheckpoint, loadArchitectureDesign, loadArchitectureJob, loadArchitecturePlan, saveArchitectureCheckpoint, saveArchitectureDesign, saveArchitectureJob, serializeArchitectureWrite } from './architecture-store';

export const architectureDesignId = (architectureId: string, unitIds: string[], cloudProvider: ArchitectureCloud = 'azure', environment?: string) => createHash('sha256').update(JSON.stringify({ version: 1, architectureId, unitIds: [...unitIds].sort(), ...(cloudProvider !== 'azure' ? { cloudProvider } : {}), ...(environment ? { environment } : {}) })).digest('hex');
const now = () => new Date().toISOString();
const active = new Map<string, Promise<void>>();

export async function prepareArchitectureReview(graph: RepositoryArchitecture, unitIds: string[], existingPlanId?: string, cloudProvider: ArchitectureCloud = 'azure', environment?: string) {
  if (environment) {
    environment = environmentName(environment);
    const target = deploymentEnvironments(graph).find(e => e.id === environment);
    if (!target || JSON.stringify([...target.unitIds].sort()) !== JSON.stringify([...unitIds].sort())) throw new Error('The selected deployment definitions do not belong to this environment');
  }
  environment ??= selectedEnvironment(graph, unitIds)?.id;
  const sharedOverlay = deploymentEnvironments(graph).filter(e => JSON.stringify([...e.unitIds].sort()) === JSON.stringify([...unitIds].sort())).length > 1;
  selectArchitectureScope(graph, unitIds, environment); // Validate the explicit scope before persisting anything.
  const id = architectureDesignId(graph.id, unitIds, cloudProvider, sharedOverlay ? environment : undefined);
  return serializeArchitectureWrite(id, async () => {
    let design: ArchitectureDesign;
    try { design = await loadArchitectureDesign(id); } catch { design = { version: 1, id, architectureId: graph.id, unitIds, cloudProvider, environment, proposalVersion: 2, revision: 0, edits: [], createdAt: now(), updatedAt: now() }; }
    design = { ...design, cloudProvider, environment, proposalVersion: 2, revision: design.revision + (design.proposalVersion === 2 ? 0 : 1), updatedAt: design.proposalVersion === 2 ? design.updatedAt : now() };
    let plan: GroundedArchitecturePlan | null = null;
    if (design.basePlanId || existingPlanId) {
      plan = await loadArchitecturePlan(design.basePlanId ?? existingPlanId!);
      if (plan.architectureId !== graph.id || (plan.provider ?? 'azure') !== cloudProvider || plan.environment && environment && plan.environment !== environment || JSON.stringify([...plan.unitIds].sort()) !== JSON.stringify([...unitIds].sort())) throw new Error('The saved recommendation belongs to a different deployment scope');
      validateArchitecturePlan(plan, selectArchitectureScope(graph, unitIds, environment));
    }
    let configError: string | undefined;
    if (!plan) try {
      const config = resolveProviderConfig();
      plan = await cachedArchitecturePlan(architecturePlanCacheKey(graph.id, unitIds, config.analysisModel, config.provider, config.gatewayUrl, cloudProvider, environment));
      if (plan) validateArchitecturePlan(plan, selectArchitectureScope(graph, unitIds, environment));
    } catch (error) { configError = error instanceof Error ? error.message : 'AI review configuration is unavailable'; }
    if (plan && design.basePlanId !== plan.id) design = { ...design, basePlanId: plan.id, revision: design.revision + 1, updatedAt: now() };
    await saveArchitectureDesign(design);
    const job = await serializeArchitectureWrite(`job:${id}`, async () => {
      let job: ArchitectureReviewJob;
      try { job = await loadArchitectureJob(id); } catch { job = { id, designId: id, architectureId: graph.id, unitIds, cloudProvider, environment, status: 'queued', step: 'Preparing the saved repository evidence', completedCalls: 0, reusedCalls: 0, attempt: 0, updatedAt: now() }; }
      job = { ...job, cloudProvider, environment };
      if (plan) job = { ...job, status: 'complete', step: 'Architecture and configuration review complete', planId: plan.id, error: undefined, updatedAt: now() };
      else if (configError && job.status !== 'running') job = { ...job, status: 'failed', step: 'The proposal is available; AI review needs its provider configuration', error: configError, updatedAt: now() };
      await saveArchitectureJob(job);
      return job;
    });
    return { design, job, plan, topology: materializeArchitectureDesign(graph, design, plan ?? undefined), issues: inspectArchitectureDesign(graph, design, plan ?? undefined) };
  });
}

export async function readArchitectureReview(id: string) {
  let design = await loadArchitectureDesign(id);
  const graph = await loadArchitecture(design.architectureId);
  if (design.proposalVersion !== 2) design = await serializeArchitectureWrite(id, async () => {
    const current = await loadArchitectureDesign(id);
    if (current.proposalVersion === 2) return current;
    const upgraded = { ...current, proposalVersion: 2 as const, revision: current.revision + 1, updatedAt: now() };
    await saveArchitectureDesign(upgraded);
    return upgraded;
  });
  const job = await loadArchitectureJob(id);
  const plan = design.basePlanId ? await loadArchitecturePlan(design.basePlanId) : null;
  return { design, job, plan, topology: materializeArchitectureDesign(graph, design, plan ?? undefined), issues: inspectArchitectureDesign(graph, design, plan ?? undefined) };
}

export async function editArchitectureReview(id: string, expectedRevision: number, edit: DesignEdit | 'undo' | 'reset') {
  return serializeArchitectureWrite(id, async () => {
    const current = await loadArchitectureDesign(id);
    if (current.revision !== expectedRevision) throw new Error('REVISION_CONFLICT: This design changed in another tab or the background review finished. Reload the current revision before saving.');
    const graph = await loadArchitecture(current.architectureId), plan = current.basePlanId ? await loadArchitecturePlan(current.basePlanId) : undefined;
    const edits = edit === 'undo' ? current.edits.slice(0, -1) : edit === 'reset' ? [] : [...current.edits, designEditSchema.parse(edit)];
    const design = { ...current, edits, revision: current.revision + 1, updatedAt: now() };
    materializeArchitectureDesign(graph, design, plan); // No dangling edges or fabricated evidence.
    await saveArchitectureDesign(design);
    return { design, job: await loadArchitectureJob(id), plan: plan ?? null, topology: materializeArchitectureDesign(graph, design, plan), issues: inspectArchitectureDesign(graph, design, plan) };
  });
}

export async function retryArchitectureReview(id: string) {
  return serializeArchitectureWrite(`job:${id}`, async () => {
    const job = await loadArchitectureJob(id);
    if (job.status === 'failed') await saveArchitectureJob({ ...job, status: 'queued', error: undefined, step: 'Resuming from saved review checkpoints', updatedAt: now() });
  });
}

/** Runs after the HTTP response. Results and per-request checkpoints survive browser disconnects/restarts. */
export async function runArchitectureReview(id: string): Promise<void> {
  if (active.has(id)) return active.get(id);
  const action = async () => {
    const claimed = await serializeArchitectureWrite(`job:${id}`, async () => {
      const previous = await loadArchitectureJob(id);
      if (previous.status === 'complete' || previous.status === 'failed' || previous.status === 'running' && Date.now() - Date.parse(previous.updatedAt) < 45000) return null;
      const running: ArchitectureReviewJob = { ...previous, status: 'running', attempt: previous.attempt + 1, startedAt: previous.startedAt ?? now(), updatedAt: now(), error: undefined, step: 'Reviewing topology from the saved snapshot' };
      await saveArchitectureJob(running); return running;
    });
    if (!claimed) return;
    let job = claimed;
    const persist = () => serializeArchitectureWrite(`job:${id}`, async () => { job.updatedAt = now(); await saveArchitectureJob(job); });
    const heartbeat = setInterval(() => { void persist().catch(() => undefined); }, 15000);
    try {
      const graph = await loadArchitecture(job.architectureId);
      const config = resolveProviderConfig();
      const client = createLLMProvider({ ...config, requestTimeoutMs: Math.max(config.requestTimeoutMs ?? 0, 240000) });
      const original = client.analyzeStructured.bind(client);
      const checkpointId = (args: Parameters<typeof original>) => createHash('sha256').update(JSON.stringify({ version: 1, provider: config.provider, gateway: config.gatewayUrl, model: config.analysisModel, args })).digest('hex');
      client.invalidateStructuredResponse = (...args) => invalidateArchitectureCheckpoint(checkpointId(args));
      client.analyzeStructured = async (...args) => {
        const checkpoint = checkpointId(args);
        const cached = await loadArchitectureCheckpoint(checkpoint);
        if (cached) { job.reusedCalls++; job.step = `Reusing saved review checkpoints (${job.reusedCalls})`; await persist(); return cached as never; }
        job.step = args[0].includes('SHARED-DESIGN') ? 'Reviewing the complete component architecture' : args[0].includes('configuration') ? `Reviewing configuration delivery · ${job.completedCalls} completed model requests` : 'Validating architecture recommendations';
        await persist();
        const response = await original(...args);
        await saveArchitectureCheckpoint(checkpoint, response);
        job.completedCalls++; await persist();
        return response as never;
      };
      const plan = await recommendArchitecture(graph, job.unitIds, client, job.cloudProvider ?? 'azure', job.environment);
      await cacheArchitecturePlan(architecturePlanCacheKey(graph.id, job.unitIds, config.analysisModel, config.provider, config.gatewayUrl, job.cloudProvider ?? 'azure', job.environment), plan);
      await serializeArchitectureWrite(id, async () => {
        const design = await loadArchitectureDesign(id);
        const updated = { ...design, basePlanId: plan.id, revision: design.revision + 1, updatedAt: now() };
        // Every saved edit is replayed; completing a review cannot overwrite user changes.
        materializeArchitectureDesign(graph, updated, plan);
        await saveArchitectureDesign(updated);
      });
      job = { ...job, status: 'complete', planId: plan.id, completedAt: now(), step: 'Architecture and configuration review complete' };
    } catch (error) {
      job = { ...job, status: 'failed', step: 'The proposal and your edits are saved. The remaining AI review can be resumed.', error: (error instanceof Error ? error.message : String(error)).slice(0, 3000) };
    } finally { clearInterval(heartbeat); await persist(); }
  };
  const promise = action(); active.set(id, promise);
  try { await promise; } finally { active.delete(id); }
}
