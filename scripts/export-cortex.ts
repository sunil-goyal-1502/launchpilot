const validation = await import('../packages/web/src/lib/architecture-validation');
const store = await import('../packages/web/src/lib/architecture-store');
const { prepareArchitectureValidation, runArchitectureValidation } = (validation as any).default ?? validation;
const { loadArchitectureDesign, loadValidationJob } = (store as any).default ?? store;

const design = await loadArchitectureDesign(process.argv[2]);
const job = await prepareArchitectureValidation({ designId: design.id, revision: design.revision });
console.log(JSON.stringify({ jobId: job.id, designId: design.id, revision: design.revision }));
await runArchitectureValidation(job.id);
const result = await loadValidationJob(job.id);
console.log(JSON.stringify({ status: result.status, error: result.error, checks: result.report?.checks.map((c: any) => ({ name: c.name, status: c.status, message: c.message })) }, null, 2));
export {};
