import { Command } from 'commander';
import { mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { IngestionAgent, PipelineContext, createLLMProvider, resolveProviderConfig, recommendArchitecture, generateArchitectureArtifact, buildArchitectureBundle, buildCortexDeploymentBundle, zipArchitectureBundle, validateRepoUrl, prepareValidationBundle, validateGeneratedBundle, validationTargetSchema } from '@launchpilot/core';

export function createArchitectureCommand(): Command {
  return new Command('architecture')
    .description('Inspect repository resources and configuration; recommend a grounded Azure architecture and export Terraform/Bicep')
    .argument('<url>', 'Repository URL or local://path')
    .requiredOption('--out <directory>', 'New or empty output directory for evidence and generated files')
    .option('--unit <ids...>', 'Deployment unit IDs from evidence.json; select definitions for one intended environment')
    .option('--recommend', 'Generate a complete Azure target design through the configured AI gateway')
    .option('--generate', 'Generate both Terraform and Bicep from that selected design (implies --recommend)')
    .option('--validation-target <file>', 'Private JSON target configuration for Azure, cluster and health validation')
    .option('--test-deploy', 'Run a real deployment test in the explicitly enabled non-production validation target')
    .option('--provider <provider>', 'AI provider: catalyst, anthropic or ollama')
    .option('--model <model>', 'AI model route')
    .action(async (url: string, options: { out: string; unit?: string[]; recommend?: boolean; generate?: boolean; provider?: string; model?: string; validationTarget?: string; testDeploy?: boolean }) => {
      if (!validateRepoUrl(url).valid) throw new Error('Invalid repository URL');
      if (options.testDeploy && (!options.generate || !options.validationTarget)) throw new Error('--test-deploy requires --generate and an explicitly enabled --validation-target');
      const target = options.validationTarget ? validationTargetSchema.parse(JSON.parse(await readFile(resolve(options.validationTarget), 'utf8'))) : undefined;
      if (options.testDeploy && !target?.allowTestDeployment) throw new Error('The supplied validation target does not permit test deployments');
      const output = resolve(options.out);
      try { if ((await readdir(output)).length) throw new Error('Choose an empty output directory to preserve existing files'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const blueprint = await new IngestionAgent().execute({ repoUrl: url }, new PipelineContext({ nonInteractive: true }));
      const graph = blueprint.architecture!;
      await mkdir(output, { recursive: true, mode: 0o700 });
      await writeFile(join(output, 'evidence.json'), JSON.stringify(graph, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(`${graph.coverage.filesScanned} files scanned; ${graph.resources.length} resource observations; ${graph.bindings.length} configuration bindings.`);
      console.log(`Evidence: ${join(output, 'evidence.json')}`);
      for (const unit of graph.deploymentUnits) console.log(`Deployment unit: ${unit.id}`);
      if (!options.recommend && !options.generate) return;
      const unitIds = options.unit ?? (graph.deploymentUnits.length === 1 ? [graph.deploymentUnits[0].id] : []);
      const client = createLLMProvider(resolveProviderConfig(options));
      const plan = await recommendArchitecture(graph, unitIds, client);
      await writeFile(join(output, 'plan.json'), JSON.stringify(plan, null, 2), { flag: 'wx', mode: 0o600 });
      console.log(`Grounded target design: ${plan.components.length} components, ${plan.configuration.length} configuration paths.`);
      if (!options.generate) return;
      const units = graph.deploymentUnits.filter(unit => unitIds.includes(unit.id));
      const generated = units.length && units.every(unit => unit.format === 'cortex')
        ? buildCortexDeploymentBundle(graph, plan)
        : buildArchitectureBundle(graph, plan, await generateArchitectureArtifact(graph, plan, client));
      console.log('Validating the generated revision. No target-dependent check can pass without its required inputs.');
      let lastStep = '';
      const { files, report } = await validateGeneratedBundle(prepareValidationBundle(generated), { target, deployTest: options.testDeploy, onProgress: async result => {
        const step = result.checks.find(check => check.status === 'running')?.name;
        if (step && step !== lastStep) { console.log(step); lastStep = step; }
      } });
      for (const [name, content] of Object.entries(files)) if (!['evidence.json', 'plan.json'].includes(name)) { await mkdir(dirname(join(output, name)), { recursive: true, mode: 0o700 }); await writeFile(join(output, name), content, { flag: 'wx', mode: 0o600 }); }
      const archive = report.status === 'passed' ? 'architecture-validated.zip' : 'architecture-VALIDATION-INCOMPLETE.zip';
      await writeFile(join(output, archive), zipArchitectureBundle(files), { flag: 'wx', mode: 0o600 });
      for (const check of report.checks) console.log(`${check.status}: ${check.name} — ${check.message}`);
      console.log(`Generated Terraform + Bicep: ${join(output, archive)}. Report: ${join(output, 'validation-report.json')}`);
      process.exitCode = report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
    });
}
