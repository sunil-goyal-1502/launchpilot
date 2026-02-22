import { Command } from 'commander';
import { validateRepoUrl } from '../../utils/validator.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { IngestionAgent } from '../../agents/ingestion/ingestion-agent.js';
import { AIAnalyzerAgent } from '../../agents/ai-analyzer/ai-analyzer-agent.js';
import { showBanner, showBlueprint, showAIAnalysis } from '../display.js';
import { createSpinner } from '../progress.js';
import { logger } from '../../utils/logger.js';
import { cleanupDir } from '../../utils/fs-helpers.js';

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze a repository and show its technology blueprint')
    .argument('<url>', 'GitHub repository URL or local://path')
    .option('--ai', 'Enable AI-powered deep analysis (requires ANTHROPIC_API_KEY)')
    .action(async (url: string, options: { ai?: boolean }) => {
      showBanner();

      const validation = validateRepoUrl(url);
      if (!validation.valid) {
        logger.error(`Invalid repository URL: ${validation.error}`);
        process.exit(1);
      }

      const context = new PipelineContext();
      const useAI = options.ai ?? false;
      const spinner = createSpinner('Analyzing repository...');
      spinner.start();

      const agent = new IngestionAgent();
      const blueprint = await agent.execute(
        { repoUrl: url, deferCleanup: useAI },
        context,
      );

      spinner.succeed('Analysis complete');
      showBlueprint(blueprint);

      // AI analysis (opt-in)
      if (useAI) {
        if (!AIAnalyzerAgent.isAvailable()) {
          logger.warn('ANTHROPIC_API_KEY not set — skipping AI analysis. Set the env var and retry with --ai.');
        } else {
          const aiSpinner = createSpinner('Running AI deep analysis...');
          aiSpinner.start();

          try {
            const repoPath = context.get<string>('repoPath')!;
            const aiAgent = new AIAnalyzerAgent();
            const enhanced = await aiAgent.execute(
              { repoUrl: url, repoPath, blueprint },
              context,
            );

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

        // Cleanup deferred repo clone
        const repoPath = context.get<string>('repoPath');
        const repoIsTemp = context.get<boolean>('repoIsTemp');
        if (repoPath && repoIsTemp) {
          await cleanupDir(repoPath);
        }
      }
    });
}
