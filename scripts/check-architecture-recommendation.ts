import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createLLMProvider, recommendArchitecture, resolveProviderConfig } from '../packages/core/src/index';

const [snapshot, unit, output] = process.argv.slice(2);
if (!snapshot || !unit || !output) throw new Error('Usage: check-architecture-recommendation.ts SNAPSHOT_FILE UNIT_ID OUTPUT_DIRECTORY [--resume]');
const graph = JSON.parse(await readFile(snapshot, 'utf8'));
await mkdir(output, { recursive: true, mode: 0o700 });
const config = resolveProviderConfig();
const client = createLLMProvider({ ...config, requestTimeoutMs: 240000 });
const original = client.analyzeStructured.bind(client);
let calls = 0;
let candidateUsed = false;
const candidate = process.argv.find(arg => arg.startsWith('--candidate='))?.slice(12);
client.analyzeStructured = async (...args) => {
  if (candidate && !candidateUsed && args[0].includes('SHARED-DESIGN pass')) {
    candidateUsed = true; console.log(JSON.stringify({ event: 'validate-existing-model-candidate' })); return JSON.parse(await readFile(candidate, 'utf8'));
  }
  const id = createHash('sha256').update(JSON.stringify(args)).digest('hex');
  const path = join(output, `response-${id}.json`);
  if (process.argv.includes('--resume')) {
    try { const result = JSON.parse(await readFile(path, 'utf8')); console.log(JSON.stringify({ event: 'resume-response', id: id.slice(0, 12) })); return result; } catch { /* request is not cached */ }
  }
  const call = ++calls;
  console.log(JSON.stringify({ event: 'request', call, inputChars: args[0].length + args[1].length, maxOutputTokens: args[3]?.maxOutputTokens }));
  const result = await original(...args);
  await writeFile(path, JSON.stringify(result), { mode: 0o600 });
  console.log(JSON.stringify({ event: 'response', call, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }));
  return result as never;
};
const plan = await recommendArchitecture(graph, [unit], client);
await writeFile(join(output, 'plan.json'), JSON.stringify(plan, null, 2), { mode: 0o600 });
await writeFile(`packages/web/data/architectures/plan-${plan.id}.json`, JSON.stringify(plan), { mode: 0o600 });
console.log(JSON.stringify({ event: 'complete', id: plan.id, passes: plan.reviewPasses, coverage: plan.evidenceCoverage, components: plan.components.length, configuration: plan.configuration.length, usage: client.getTotalUsage() }));
