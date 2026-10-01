import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createLLMProvider, generateArchitectureArtifact, resolveProviderConfig, buildArchitectureBundle, buildCortexDeploymentBundle, prepareValidationBundle, validateGeneratedBundle, validationTargetSchema } from '@launchpilot/core';
import type { ArchitectureValidationJob, ValidationTarget } from '@launchpilot/core';
import { readArchitectureReview } from './architecture-review';
import { scriptGenerationBlocker } from './script-generation';
import { loadArchitecture, loadArchitecturePlan, cachedArchitectureArtifact, cacheArchitectureArtifact, loadArchitectureDesign, loadValidationJob, saveValidationJob, saveValidationBundle, loadValidationBundle, saveLatestValidation, loadLatestValidation, serializeArchitectureWrite } from './architecture-store';

const now = () => new Date().toISOString();
function interruptedReport(job: ArchitectureValidationJob, message: string) {
  if (!job.report) return undefined;
  return { ...job.report, status: 'blocked' as const, completedAt: now(), updatedAt: now(), checks: job.report.checks.map(c => ['running', 'pending'].includes(c.status) ? { ...c, status: 'blocked' as const, message, completedAt: now() } : c) };
}
export const validationTargetFingerprint = (target: ValidationTarget) => createHash('sha256').update(JSON.stringify(target)).digest('hex');
export async function validationTargets(): Promise<ValidationTarget[]> {
  const path = process.env.LAUNCHPILOT_VALIDATION_TARGETS_FILE;
  if (!path) return [];
  const targets = z.array(validationTargetSchema).parse(JSON.parse(await readFile(path, 'utf8')));
  if (new Set(targets.map(t => t.id)).size !== targets.length) throw new Error('Validation target IDs must be unique');
  return targets;
}
export async function prepareArchitectureValidation(input: { designId?: string; revision?: number; planId?: string; targetId?: string; targetFingerprint?: string; deployTest?: boolean }) {
  const review = input.designId ? await readArchitectureReview(input.designId) : undefined;
  if (review && review.design.revision !== input.revision) throw new Error('REVISION_CONFLICT: Review the current architecture revision before generating scripts.');
  const blocker = review ? scriptGenerationBlocker({hasPlan:!!review.plan,reviewJob:review.job,issues:review.issues,environment:review.design.environment}) : null;
  if (blocker) throw new Error([blocker.title,blocker.message,...blocker.details].join('\n'));
  const plan = review?.plan ?? await loadArchitecturePlan(input.planId ?? '');
  if (plan.provider !== 'azure') throw new Error('Validated infrastructure export currently supports Azure only. This proposal needs a native cloud Terraform implementation; Bicep cannot deploy AWS or GCP.');
  const target = input.targetId ? (await validationTargets()).find(t => t.id === input.targetId) : undefined;
  if (input.targetId && !target) throw new Error('The selected validation target is unavailable.');
  if (target && (target.architectureId !== plan.architectureId || JSON.stringify([...target.unitIds].sort()) !== JSON.stringify([...plan.unitIds].sort()))) throw new Error('The validation target belongs to a different repository snapshot or deployment scope.');
  if (input.deployTest && (!target?.allowTestDeployment || input.targetFingerprint !== validationTargetFingerprint(target))) throw new Error('A test deployment requires explicit authorization for the currently displayed non-production target.');
  const job: ArchitectureValidationJob = {
    id: createHash('sha256').update(randomUUID()).digest('hex'), designId: review?.design.id, revision: review?.design.revision, planId: plan.id,
    targetId: target?.id, targetFingerprint: target ? validationTargetFingerprint(target) : undefined, deployTest: input.deployTest ?? false,
    status: 'queued', step: 'Generating scripts from the saved architecture revision', createdAt: now(), updatedAt: now(),
  };
  await serializeArchitectureWrite('validation-enqueue', async () => {
    const reservations = input.deployTest && target ? [
      ['azure', target.subscriptionId, target.resourceGroupName],
      ...(target.kubernetes ? [['cluster', target.kubernetes.context, target.kubernetes.namespace]] : []),
    ].map(parts => createHash('sha256').update(JSON.stringify(parts)).digest('hex')) : [];
    for (const key of reservations) {
      let previous;
      try { previous = await loadLatestValidation(key); } catch { /* No earlier deployment job for this target. */ }
      if (previous && ['queued', 'running'].includes(previous.status)) throw new Error('Another deployment validation job is already using this Azure resource group or cluster namespace. Wait for its result.');
    }
    await saveValidationJob(job);
    for (const key of reservations) await saveLatestValidation(key, job.id);
    await saveLatestValidation(job.designId ?? job.planId, job.id);
  });
  return job;
}

const active = new Map<string, Promise<void>>();
export async function runArchitectureValidation(id: string): Promise<void> {
  if (active.has(id)) return active.get(id);
  const action = async () => {
    const claimed = await serializeArchitectureWrite(`validation:${id}`, async () => {
      const previous = await loadValidationJob(id);
      if (!['queued', 'running'].includes(previous.status) || previous.status === 'running' && Date.now() - Date.parse(previous.updatedAt) < 45000) return null;
      // Never repeat an interrupted operation that may already have created resources.
      if (previous.status === 'running' && previous.deployTest) {
        const message = 'Inspect the selected target before starting a new deployment test. Interrupted deployment jobs are not replayed automatically.';
        await saveValidationJob({ ...previous, report: interruptedReport(previous, message), status: 'blocked', step: 'Deployment test interrupted', error: message, updatedAt: now() });
        return null;
      }
      const job: ArchitectureValidationJob = { ...previous, status: 'running', updatedAt: now() };
      await saveValidationJob(job); return job;
    });
    if (!claimed) return;
    let job = claimed;
    const persist = () => serializeArchitectureWrite(`validation:${id}`, async () => { job.updatedAt = now(); await saveValidationJob(job); });
    const heartbeat = setInterval(() => { void persist().catch(() => undefined); }, 15000);
    try {
      const plan = await loadArchitecturePlan(job.planId), graph = await loadArchitecture(plan.architectureId);
      const design = job.designId ? await loadArchitectureDesign(job.designId) : undefined;
      if (design && design.revision !== job.revision) throw new Error('The architecture changed before validation started. Generate scripts for the current revision.');
      const target = job.targetId ? (await validationTargets()).find(t => t.id === job.targetId) : undefined;
      if (job.targetId && (!target || validationTargetFingerprint(target) !== job.targetFingerprint)) throw new Error('Validation target configuration changed. Review the new target before starting another run.');
      let files: Record<string, string>;
      try { files = await loadValidationBundle(id); }
      catch {
        const units = graph.deploymentUnits.filter(unit => plan.unitIds.includes(unit.id));
        if (units.length && units.every(unit => unit.format === 'cortex')) files = buildCortexDeploymentBundle(graph, plan, design);
        else {
          if (design?.edits.length) throw new Error('Infrastructure export requires an edit compiler for this deployment owner. Export the architecture design for review.');
          const artifact = await cachedArchitectureArtifact(plan.id) ?? await generateArchitectureArtifact(graph, plan, createLLMProvider(resolveProviderConfig()));
          await cacheArchitectureArtifact(artifact);
          files = buildArchitectureBundle(graph, plan, artifact);
          if (design) files['architecture-design.json'] = JSON.stringify(design, null, 2);
        }
        files = prepareValidationBundle(files);
        await saveValidationBundle(id, files);
      }
      const result = await validateGeneratedBundle(files, { target, deployTest: job.deployTest, onProgress: async report => {
        job = { ...job, report, bundleHash: report.bundleHash, step: report.checks.find(c => c.status === 'running')?.name ?? 'Saving validation results' };
        await persist();
      } });
      await saveValidationBundle(id, result.files);
      job = { ...job, status: result.report.status as 'passed' | 'failed' | 'blocked', report: result.report, bundleHash: result.report.bundleHash, step: result.report.status === 'passed' ? 'All required validation checks passed' : 'Validation completed with outstanding checks' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Validation failed';
      job = { ...job, report: interruptedReport(job, message), status: 'failed', step: 'Infrastructure validation could not finish', error: message };
    } finally { clearInterval(heartbeat); await persist(); }
  };
  const pending = action(); active.set(id, pending);
  try { await pending; } finally { active.delete(id); }
}
