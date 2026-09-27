import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { scanRepositoryArchitecture, recommendArchitecture, createLLMProvider, resolveProviderConfig, generateArchitectureArtifact, buildArchitectureBundle, zipArchitectureBundle } from '../packages/core/src/index';

const repo = resolve(process.argv[2] ?? 'tests/fixtures/evidence-app');
const output = resolve(process.argv[3] ?? '/private/tmp/launchpilot-architecture-check');
const resume = process.argv.includes('--resume');
const graph = resume ? JSON.parse(await readFile(join(output, 'evidence.json'), 'utf8')) : await scanRepositoryArchitecture(repo, `local://${repo}`);
await mkdir(output, { recursive: true });
await writeFile(join(output, 'evidence.json'), JSON.stringify(graph, null, 2));
console.log(JSON.stringify({ output, snapshot: graph.id, files: graph.coverage.filesScanned, resources: graph.resources.length, connections: graph.connections.length, bindings: graph.bindings.length, deploymentUnits: graph.deploymentUnits.map(u => u.id) }));
if (process.argv.includes('--recommend')) {
  const config = resolveProviderConfig();
  const client = createLLMProvider({ ...config, requestTimeoutMs: 240000 });
  const structured = client.analyzeStructured.bind(client);
  let responseCount = 0;
  client.analyzeStructured = async (...args) => {
    const response = await structured(...args);
    await writeFile(join(output, `model-response-${++responseCount}.json`), JSON.stringify(response.result, null, 2), { mode: 0o600 });
    return response as never;
  };
  const unit = process.argv.find(a => a.startsWith('--unit='))?.slice(7);
  const plan = resume ? JSON.parse(await readFile(join(output, 'plan.json'), 'utf8')) : await recommendArchitecture(graph, unit ? [unit] : graph.deploymentUnits.length === 1 ? [graph.deploymentUnits[0].id] : [], client);
  await writeFile(join(output, 'plan.json'), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ planId: plan.id, components: plan.components.length, configuration: plan.configuration.length, coverage: plan.evidenceCoverage }));
  if (process.argv.includes('--generate')) {
    const artifact = await generateArchitectureArtifact(graph, plan, client);
    await writeFile(join(output, 'artifact.json'), JSON.stringify(artifact, null, 2));
    const files = buildArchitectureBundle(graph, plan, artifact);
    for (const [path, content] of Object.entries(files)) { await mkdir(dirname(join(output, path)), { recursive: true }); await writeFile(join(output, path), content); }
    await writeFile(join(output, 'architecture.zip'), zipArchitectureBundle(files));
    console.log(JSON.stringify({ artifact: artifact.id, resources: artifact.template.resources.length, validation: artifact.validation, files: Object.keys(files) }));
  }
}
