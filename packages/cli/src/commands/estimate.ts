import chalk from 'chalk';
import { Command } from 'commander';
import {
  validateRepoUrl, PipelineContext, IngestionAgent, InfraPlannerAgent,
  CloudProvider, logger,
} from '@launchpilot/core';
import { showBanner, showBlueprint, showStrategyComparison } from '../display.js';
import { createSpinner } from '../progress.js';
import { selectCloud, parseCloudFlag } from '../prompts.js';

export function createEstimateCommand(): Command {
  return new Command('estimate')
    .description('Analyze a repository and estimate deployment costs')
    .argument('<url>', 'GitHub repository URL or local://path')
    .option('-c, --cloud <provider>', 'Cloud provider (aws, gcp, azure)')
    .option('--all-clouds', 'Show estimates for all cloud providers')
    .action(async (url: string, options: { cloud?: string; allClouds?: boolean }) => {
      showBanner();

      const validation = validateRepoUrl(url);
      if (!validation.valid) {
        logger.error(`Invalid repository URL: ${validation.error}`);
        process.exit(1);
      }

      const context = new PipelineContext();

      // Analyze repo
      const spinner = createSpinner('Analyzing repository...');
      spinner.start();

      const agent = new IngestionAgent();
      const blueprint = await agent.execute({ repoUrl: url }, context);

      spinner.succeed('Analysis complete');
      showBlueprint(blueprint);

      // Determine which clouds to estimate
      let providers: CloudProvider[];
      if (options.allClouds) {
        providers = [CloudProvider.AWS, CloudProvider.GCP, CloudProvider.Azure];
      } else if (options.cloud) {
        const parsed = parseCloudFlag(options.cloud);
        if (!parsed) {
          logger.error(`Invalid cloud provider: ${options.cloud}`);
          process.exit(1);
        }
        providers = [parsed];
      } else {
        providers = [await selectCloud()];
      }

      // Generate estimates for each provider
      for (const provider of providers) {
        console.log(chalk.bold.cyan(`\n  ${provider.toUpperCase()} Cost Estimate`));

        const planSpinner = createSpinner(`Estimating ${provider.toUpperCase()} costs...`);
        planSpinner.start();

        const infraAgent = new InfraPlannerAgent();
        const { strategies } = await infraAgent.execute({ blueprint, provider }, context);

        planSpinner.succeed(`${provider.toUpperCase()} estimates ready`);
        showStrategyComparison(strategies);
      }
    });
}
