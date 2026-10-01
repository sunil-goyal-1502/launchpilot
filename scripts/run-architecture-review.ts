/** Resume a saved review, with progress only (never print provider inputs). */
const id = process.argv[2];
if (!/^[a-f0-9]{64}$/.test(id ?? '')) throw new Error('Supply a saved architecture design ID.');
const module = await import('../packages/web/src/lib/architecture-review');
const { runArchitectureReview, readArchitectureReview, retryArchitectureReview } = (module as any).default ?? module;
const progress = setInterval(async () => {
  try { const { job } = await readArchitectureReview(id); console.log(JSON.stringify({ status: job.status, step: job.step, completed: job.completedCalls, reused: job.reusedCalls })); }
  catch { /* The final read reports a persistent error. */ }
}, 20000);
try {
  await retryArchitectureReview(id);
  await runArchitectureReview(id);
  const { job, design } = await readArchitectureReview(id);
  console.log(JSON.stringify({ status: job.status, designId: design.id, planId: design.basePlanId, error: job.error }));
  if (job.status === 'failed') process.exitCode = 1;
} finally { clearInterval(progress); }
export {};
