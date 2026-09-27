import chalk from 'chalk';
import { Command } from 'commander';
import {
  validateRepoUrl, PipelineContext, IngestionAgent, AIAnalyzerAgent,
  cleanupDir, logger,
} from '@launchpilot/core';
import { resolveProviderConfig, formatAICost } from '@launchpilot/core';
import { showBanner } from '../display.js';
import { createSpinner } from '../progress.js';

export function createIndexCommand(): Command {
  return new Command('index')
    .description('Index a repository for semantic search (force re-index)')
    .argument('<url>', 'GitHub repository URL or local://path')
    .option('--provider <provider>', 'AI provider: catalyst, anthropic or ollama (auto-detected from environment)')
    .option('--model <model>', 'Analysis and search model route')
    .option('--summary-model <model>', 'Chat model for code chunk summaries (Catalyst defaults to --model)')
    .action(async (url: string, options: { provider?: string; model?: string; summaryModel?: string }) => {
      showBanner();

      const validation = validateRepoUrl(url);
      if (!validation.valid) {
        logger.error(`Invalid repository URL: ${validation.error}`);
        process.exit(1);
      }

      const providerConfig = resolveProviderConfig(options);

      if (providerConfig.provider === 'anthropic' && !providerConfig.apiKey) {
        logger.error('ANTHROPIC_API_KEY is required for Anthropic. Configure Catalyst or use --provider ollama for local models.');
        process.exit(1);
      }

      const context = new PipelineContext();

      // Step 1: Clone and detect
      const cloneSpinner = createSpinner('Cloning and analyzing repository...');
      cloneSpinner.start();

      const ingestionAgent = new IngestionAgent();
      const blueprint = await ingestionAgent.execute(
        { repoUrl: url, deferCleanup: true },
        context,
      );

      cloneSpinner.succeed(`Detected: ${blueprint.runtime} / ${blueprint.appType}`);

      // Step 2: AI analysis + indexing
      const aiSpinner = createSpinner('Indexing with AI analysis...');
      aiSpinner.start();

      try {
        const repoPath = context.get<string>('repoPath')!;
        const aiAgent = new AIAnalyzerAgent();
        const enhanced = await aiAgent.execute(
          { repoUrl: url, repoPath, blueprint, providerConfig, forceReindex: true },
          context,
        );

        if (enhanced.aiAnalysis) {
          aiSpinner.succeed('Repository indexed successfully');
          console.log('');
          console.log(chalk.dim(`  Files analyzed: ${enhanced.aiAnalysis.analyzedFiles}`));
          console.log(chalk.dim(`  Chunks indexed: ${enhanced.aiAnalysis.totalChunks}`));
          console.log(chalk.dim(`  Architecture:   ${enhanced.aiAnalysis.architecturePattern}`));
          console.log(chalk.dim(`  Cost:           ${formatAICost(enhanced.aiAnalysis.tokenUsage.estimatedCostUSD)}`));
          console.log('');
          console.log(chalk.green(`  Ready for search: launchpilot search ${url} "<query>"`));
          console.log('');
        } else {
          aiSpinner.fail(enhanced.aiError ?? 'Indexing failed — no AI analysis returned');
          process.exitCode = 1;
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        aiSpinner.fail(`Indexing failed: ${msg}`);
        process.exit(1);
      } finally {
        // Cleanup cloned repo
        const repoPath = context.get<string>('repoPath');
        const repoIsTemp = context.get<boolean>('repoIsTemp');
        if (repoPath && repoIsTemp) {
          await cleanupDir(repoPath);
        }
      }
    });
}
