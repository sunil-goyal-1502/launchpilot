import chalk from 'chalk';
import { Command } from 'commander';
import { validateRepoUrl } from '../../utils/validator.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { IngestionAgent } from '../../agents/ingestion/ingestion-agent.js';
import { AIAnalyzerAgent } from '../../agents/ai-analyzer/ai-analyzer-agent.js';
import { showBanner } from '../display.js';
import { createSpinner } from '../progress.js';
import { logger } from '../../utils/logger.js';
import { cleanupDir } from '../../utils/fs-helpers.js';

export function createIndexCommand(): Command {
  return new Command('index')
    .description('Index a repository for semantic search (force re-index)')
    .argument('<url>', 'GitHub repository URL or local://path')
    .action(async (url: string) => {
      showBanner();

      const validation = validateRepoUrl(url);
      if (!validation.valid) {
        logger.error(`Invalid repository URL: ${validation.error}`);
        process.exit(1);
      }

      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        logger.error('ANTHROPIC_API_KEY environment variable is required for indexing.');
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
          { repoUrl: url, repoPath, blueprint },
          context,
        );

        if (enhanced.aiAnalysis) {
          aiSpinner.succeed('Repository indexed successfully');
          console.log('');
          console.log(chalk.dim(`  Files analyzed: ${enhanced.aiAnalysis.analyzedFiles}`));
          console.log(chalk.dim(`  Chunks indexed: ${enhanced.aiAnalysis.totalChunks}`));
          console.log(chalk.dim(`  Architecture:   ${enhanced.aiAnalysis.architecturePattern}`));
          console.log(chalk.dim(`  Cost:           ~$${enhanced.aiAnalysis.tokenUsage.estimatedCostUSD.toFixed(4)}`));
          console.log('');
          console.log(chalk.green(`  Ready for search: launchpilot search ${url} "<query>"`));
          console.log('');
        } else {
          aiSpinner.fail('Indexing failed — no AI analysis returned');
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
