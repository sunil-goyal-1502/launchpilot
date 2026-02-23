import chalk from 'chalk';
import { Command } from 'commander';
import { validateRepoUrl, extractRepoName } from '../../utils/validator.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { IngestionAgent } from '../../agents/ingestion/ingestion-agent.js';
import { InfraPlannerAgent } from '../../agents/infra-planner/infra-planner-agent.js';
import { SecurityAgent } from '../../agents/security/security-agent.js';
import { DeployAgent } from '../../agents/deploy/deploy-agent.js';
import { AIAnalyzerAgent } from '../../agents/ai-analyzer/ai-analyzer-agent.js';
import { ProviderConfig, ProviderType } from '../../agents/ai-analyzer/llm-provider.js';
import { showBanner, showBlueprint, showAIAnalysis, showStrategyComparison, showSecuritySummary, showDeploymentResult, showBaaSMigrationInfo, showSubscriptionSteps } from '../display.js';
import { cleanupDir } from '../../utils/fs-helpers.js';
import { showArchitectureDiagram } from '../diagram.js';
import { createSpinner, createProgressBar } from '../progress.js';
import { selectCloud, selectStrategy, confirmDeployment, parseCloudFlag, parseStrategyFlag, selectBaaSStrategy, parseBackendFlag } from '../prompts.js';
import { CloudProvider, StrategyTier, BaaSMigrationChoice } from '../../types/index.js';
import { generateMigrationOptions } from '../../agents/infra-planner/baas-migration.js';
import { logger } from '../../utils/logger.js';

export function createDeployCommand(): Command {
  return new Command('deploy')
    .description('Analyze a repository and deploy to cloud infrastructure')
    .argument('<url>', 'GitHub repository URL or local://path')
    .option('-c, --cloud <provider>', 'Cloud provider (aws, gcp, azure)')
    .option('-s, --strategy <tier>', 'Scaling strategy (low, medium, high)')
    .option('-y, --yes', 'Skip confirmation prompts')
    .option('--non-interactive', 'Run in non-interactive mode (requires --cloud and --strategy)')
    .option('--ai', 'Enable AI-powered deep analysis (requires ANTHROPIC_API_KEY or Ollama)')
    .option('--provider <provider>', 'AI provider: anthropic or ollama (default: anthropic)')
    .option('--model <model>', 'Model name override (e.g. qwen2.5-coder:14b for ollama)')
    .option('--backend <strategy>', 'BaaS backend: self-hosted, keep-vendor, or migrate-vendor')
    .action(async (url: string, options: { cloud?: string; strategy?: string; yes?: boolean; nonInteractive?: boolean; ai?: boolean; provider?: string; model?: string; backend?: string }) => {
      showBanner();

      // Validate URL
      const validation = validateRepoUrl(url);
      if (!validation.valid) {
        logger.error(`Invalid repository URL: ${validation.error}`);
        process.exit(1);
      }

      const nonInteractive = options.nonInteractive ?? false;
      const context = new PipelineContext({ nonInteractive });

      // Step 1: Ingestion
      const spinner = createSpinner('Analyzing repository...');
      spinner.start();

      const useAI = options.ai ?? false;
      const ingestionAgent = new IngestionAgent();
      const blueprint = await ingestionAgent.execute({ repoUrl: url, deferCleanup: useAI }, context);

      spinner.succeed('Repository analyzed');
      showBlueprint(blueprint);

      // Optional AI analysis
      if (useAI) {
        const providerType = (options.provider ??
          (process.env['OLLAMA_HOST'] && !process.env['ANTHROPIC_API_KEY'] ? 'ollama' : 'anthropic')) as ProviderType;

        const providerConfig: ProviderConfig = {
          provider: providerType,
          apiKey: process.env['ANTHROPIC_API_KEY'],
          ollamaHost: process.env['OLLAMA_HOST'],
          analysisModel: options.model,
        };

        if (!AIAnalyzerAgent.isAvailable(providerConfig)) {
          logger.warn('No AI provider available. Set ANTHROPIC_API_KEY or ensure Ollama is running.');
        } else {
          const aiSpinner = createSpinner('Running AI deep analysis...');
          aiSpinner.start();
          try {
            const repoPath = context.get<string>('repoPath')!;
            const aiAgent = new AIAnalyzerAgent();
            const enhanced = await aiAgent.execute({ repoUrl: url, repoPath, blueprint, providerConfig }, context);
            if (enhanced.aiAnalysis) {
              aiSpinner.succeed('AI analysis complete');
              showAIAnalysis(enhanced.aiAnalysis);
            } else {
              aiSpinner.warn('AI analysis returned no results');
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            aiSpinner.fail(`AI analysis failed: ${msg}`);
          }
        }
        const repoPath = context.get<string>('repoPath');
        const repoIsTemp = context.get<boolean>('repoIsTemp');
        if (repoPath && repoIsTemp) {
          await cleanupDir(repoPath);
        }
      }

      // Step 1.5: BaaS migration decision
      let migrationChoice: BaaSMigrationChoice | undefined;

      if (blueprint.baas?.isBaaSApp) {
        const migrationOptions = generateMigrationOptions(blueprint);
        showBaaSMigrationInfo(blueprint, migrationOptions);

        if (options.backend) {
          const parsed = parseBackendFlag(options.backend);
          if (!parsed) {
            logger.error(`Invalid backend: ${options.backend}. Use self-hosted, keep-vendor, or migrate-vendor.`);
            process.exit(1);
          }
          const match = migrationOptions.find(o => o.strategy === parsed);
          migrationChoice = match
            ? { strategy: match.strategy, vendor: match.vendor, handledFeatures: match.handledFeatures }
            : { strategy: 'self-hosted', handledFeatures: [] };
        } else if (nonInteractive) {
          migrationChoice = { strategy: 'self-hosted', handledFeatures: [] };
        } else {
          migrationChoice = await selectBaaSStrategy(migrationOptions);
        }

        if (migrationChoice.vendor) {
          showSubscriptionSteps(migrationChoice.vendor);
        }
      }

      // Step 2: Select cloud provider
      let provider: CloudProvider;
      if (options.cloud) {
        const parsed = parseCloudFlag(options.cloud);
        if (!parsed) {
          logger.error(`Invalid cloud provider: ${options.cloud}. Use aws, gcp, or azure.`);
          process.exit(1);
        }
        provider = parsed;
      } else if (nonInteractive) {
        logger.error('--cloud is required in non-interactive mode');
        process.exit(1);
      } else {
        provider = await selectCloud();
      }

      console.log(chalk.dim(`  Cloud: ${provider.toUpperCase()}`));

      // Step 3: Generate strategies
      const planSpinner = createSpinner('Generating infrastructure plans...');
      planSpinner.start();

      const infraAgent = new InfraPlannerAgent();
      const { strategies } = await infraAgent.execute({ blueprint, provider, migrationChoice }, context);

      planSpinner.succeed('Infrastructure plans ready');
      showStrategyComparison(strategies);

      // Step 4: Select strategy
      let selectedStrategy;
      if (options.strategy) {
        const tier = parseStrategyFlag(options.strategy);
        if (!tier) {
          logger.error(`Invalid strategy: ${options.strategy}. Use low, medium, or high.`);
          process.exit(1);
        }
        selectedStrategy = strategies.find(s => s.tier === tier) ?? strategies[1]!;
      } else if (nonInteractive) {
        selectedStrategy = strategies[1]!; // Default to medium
      } else {
        selectedStrategy = await selectStrategy(strategies);
      }

      console.log(chalk.dim(`  Strategy: ${selectedStrategy.name} (${selectedStrategy.tier})`));

      // Step 5: Security analysis
      const secSpinner = createSpinner('Generating security policies...');
      secSpinner.start();

      const securityAgent = new SecurityAgent();
      const security = await securityAgent.execute(
        { blueprint, strategy: selectedStrategy, provider },
        context,
      );

      secSpinner.succeed('Security policies ready');
      showSecuritySummary(security);
      showArchitectureDiagram(selectedStrategy, security);

      // Step 6: Confirm deployment
      if (!options.yes && !nonInteractive) {
        const confirmed = await confirmDeployment();
        if (!confirmed) {
          logger.info('Deployment cancelled.');
          return;
        }
      }

      // Step 7: Deploy
      console.log('');
      const repoName = extractRepoName(url);
      const deployAgent = new DeployAgent();

      // Set up progress bar
      const totalCheckpoints = getCheckpointCount(provider, selectedStrategy);
      const bar = createProgressBar(totalCheckpoints, 'Deploying');

      let completedCount = 0;
      deployAgent.setCheckpointCallback((checkpoint, index, total) => {
        if (checkpoint.status === 'completed') {
          completedCount++;
          bar.update(completedCount, { task: checkpoint.name });
        } else if (checkpoint.status === 'in_progress') {
          bar.update(completedCount, { task: checkpoint.name });
        }
      });

      const result = await deployAgent.execute(
        { repoName, provider, strategy: selectedStrategy, security },
        context,
      );

      bar.stop();

      // Step 8: Show results
      showDeploymentResult(result);

      // Show timing summary
      const elapsed = context.elapsed();
      console.log(chalk.dim(`  Total pipeline time: ${(elapsed / 1000).toFixed(1)}s`));
      console.log('');
    });
}

function getCheckpointCount(_provider: CloudProvider, strategy: import('../../types/index.js').ScalingStrategy): number {
  // Base checkpoints + optional ones
  let count = 6; // VPC + SG + Compute + Deploy App + Health Check + DNS
  if (strategy.database) count++;
  if (strategy.network.loadBalancer) count++;
  if (strategy.network.cdn) count++;
  if (strategy.network.waf) count++;
  if (strategy.cache) count++;
  if (strategy.queue) count++;
  if (strategy.streaming) count++;
  return count;
}
