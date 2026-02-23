import { Command } from 'commander';
import {
  validateRepoUrl, PipelineContext, IngestionAgent, AIAnalyzerAgent,
  cleanupDir, logger,
} from '@launchpilot/core';
import type { ProviderConfig, ProviderType } from '@launchpilot/core';
import { showBanner, showBlueprint, showAIAnalysis } from '../display.js';
import { createSpinner } from '../progress.js';

export function createAnalyzeCommand(): Command {
  return new Command('analyze')
    .description('Analyze a repository and show its technology blueprint')
    .argument('<url>', 'GitHub repository URL or local://path')
    .option('--ai', 'Enable AI-powered deep analysis (requires ANTHROPIC_API_KEY or Ollama)')
    .option('--provider <provider>', 'AI provider: anthropic or ollama (default: anthropic)')
    .option('--model <model>', 'Model name override (e.g. qwen2.5-coder:14b for ollama)')
    .action(async (url: string, options: { ai?: boolean; provider?: string; model?: string }) => {
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
            const enhanced = await aiAgent.execute(
              { repoUrl: url, repoPath, blueprint, providerConfig },
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
