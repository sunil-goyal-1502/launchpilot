import { mkdir, readFile, writeFile, rename, stat, rmdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { RepositoryArchitecture, GroundedArchitecturePlan, ArchitectureArtifact, ArchitectureDesign, ArchitectureReviewJob, ArchitectureValidationJob } from '@launchpilot/core';

const directory = () => process.env.LAUNCHPILOT_ARCHITECTURE_DIR || join(process.cwd(), 'data', 'architectures');
const validId = (id: string) => /^[a-f0-9]{64}$/.test(id);
async function put(kind: string, value: { id: string }) {
  if (!validId(value.id)) throw new Error('Invalid architecture identifier');
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  const path = join(directory(), `${kind}-${value.id}.json`), temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}
async function get<T>(kind: string, id: string): Promise<T> {
  if (!validId(id)) throw new Error('Invalid architecture identifier');
  try { return JSON.parse(await readFile(join(directory(), `${kind}-${id}.json`), 'utf8')); }
  catch { throw new Error('The saved architecture record is unavailable. Reopen its saved review; a new repository scan is not required for an existing snapshot.'); }
}
export const saveArchitecture = (value: RepositoryArchitecture) => put('evidence', value);
export const loadArchitecture = (id: string) => get<RepositoryArchitecture>('evidence', id);
export const saveArchitecturePlan = (value: GroundedArchitecturePlan) => put('plan', value);
export const loadArchitecturePlan = (id: string) => get<GroundedArchitecturePlan>('plan', id);
export const saveArchitectureDesign = (value: ArchitectureDesign) => put('design', value);
export const loadArchitectureDesign = (id: string) => get<ArchitectureDesign>('design', id);
export const saveArchitectureJob = (value: ArchitectureReviewJob) => put('review-job', value);
export const loadArchitectureJob = (id: string) => get<ArchitectureReviewJob>('review-job', id);
export const saveValidationJob = (value: ArchitectureValidationJob) => put('validation-job', value);
export const loadValidationJob = (id: string) => get<ArchitectureValidationJob>('validation-job', id);
export const saveValidationBundle = (id: string, files: Record<string, string>) => put('validation-bundle', { id, files } as { id: string });
export const loadValidationBundle = async (id: string) => (await get<{ files: Record<string, string> }>('validation-bundle', id)).files;
export const saveLatestValidation = (id: string, jobId: string) => put('latest-validation', { id, jobId } as { id: string });
export const loadLatestValidation = async (id: string) => loadValidationJob((await get<{ jobId: string }>('latest-validation', id)).jobId);
export const saveArchitectureCheckpoint = (id: string, response: unknown) => put('review-checkpoint', { id, response } as { id: string });
export const invalidateArchitectureCheckpoint = async (id: string) => {
  // Keep a private diagnostic copy, but never replay a rejected response as a checkpoint.
  const response = await loadArchitectureCheckpoint(id);
  if (response) await put('rejected-review', { id, response } as { id: string });
  await saveArchitectureCheckpoint(id, null);
};
export const loadArchitectureCheckpoint = async (id: string): Promise<unknown | null> => { try { return (await get<{ response: unknown }>('review-checkpoint', id)).response; } catch { return null; } };
export function architecturePlanCacheKey(architectureId: string, unitIds: string[], model: string | undefined, provider: string, gateway?: string, cloudProvider = 'azure', environment?: string) {
  return createHash('sha256').update(JSON.stringify({ version: 'grounded-architect-review-v3', architectureId, units: [...unitIds].sort(), model, provider, gateway, cloudProvider, environment })).digest('hex');
}
export const cacheArchitecturePlan = async (key: string, plan: GroundedArchitecturePlan) => {
  await saveArchitecturePlan(plan);
  await put('recommended', { id: key, planId: plan.id } as { id: string });
};
export const cachedArchitecturePlan = async (key: string): Promise<GroundedArchitecturePlan | null> => {
  try { const pointer = await get<{ planId: string }>('recommended', key); return await loadArchitecturePlan(pointer.planId); } catch { return null; }
};
export const saveArchitectureArtifact = (value: ArchitectureArtifact) => put('artifact', value);
export const loadArchitectureArtifact = (id: string) => get<ArchitectureArtifact>('artifact', id);
export const cachedArchitectureArtifact = async (planId: string): Promise<ArchitectureArtifact | null> => {
  try { const pointer = await get<{ artifactId: string }>('generated', planId); return loadArchitectureArtifact(pointer.artifactId); } catch { return null; }
};
export const cacheArchitectureArtifact = async (value: ArchitectureArtifact) => {
  await saveArchitectureArtifact(value);
  await put('generated', { id: value.planId, artifactId: value.id } as { id: string });
};

// Deduplicate repeated clicks without switching snapshots during a request.
const inflight = new Map<string, Promise<unknown>>();
export async function once<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>;
  const job = action(); inflight.set(key, job);
  try { return await job; } finally { inflight.delete(key); }
}

// Writes are queued, not deduplicated: a second editor must receive a revision conflict.
const writers = new Map<string, Promise<unknown>>();
export async function serializeArchitectureWrite<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = writers.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await mkdir(directory(), { recursive: true, mode: 0o700 });
    const lock = join(directory(), `.lock-${createHash('sha256').update(key).digest('hex')}`), deadline = Date.now() + 5000;
    for (;;) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try { if (Date.now() - (await stat(lock)).mtimeMs > 30000) await rmdir(lock); } catch { /* Another worker released the lease. */ }
        if (Date.now() > deadline) throw new Error('The saved architecture is busy. Retry this change; the current draft is preserved.');
        await delay(25);
      }
    }
    try { return await action(); } finally { await rmdir(lock).catch(() => undefined); }
  }); writers.set(key, next);
  try { return await next; } finally { if (writers.get(key) === next) writers.delete(key); }
}
