import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { loadArchitecture } = require('../packages/web/src/lib/architecture-store.ts');
const { prepareArchitectureReview, retryArchitectureReview, runArchitectureReview, readArchitectureReview } = require('../packages/web/src/lib/architecture-review.ts');

const [snapshotId, unit] = process.argv.slice(2);
if (!snapshotId || !unit) throw new Error('Usage: run-architecture-review.ts SNAPSHOT_ID UNIT_ID');
process.chdir(resolve('packages/web'));
const prepared = await prepareArchitectureReview(await loadArchitecture(snapshotId), [unit]);
console.log(JSON.stringify({ designId: prepared.design.id, status: prepared.job.status }));
await retryArchitectureReview(prepared.design.id);
await runArchitectureReview(prepared.design.id);
const result = await readArchitectureReview(prepared.design.id);
console.log(JSON.stringify({ status: result.job.status, step: result.job.step, error: result.job.error, completedCalls: result.job.completedCalls, reusedCalls: result.job.reusedCalls, coverage: result.plan?.evidenceCoverage }));
if (result.job.status === 'failed') process.exitCode = 1;
