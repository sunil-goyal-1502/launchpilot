import chalk from 'chalk';
import { Command } from 'commander';
import { validateRepoUrl } from '../../utils/validator.js';
import { SemanticSearch } from '../../agents/ai-analyzer/semantic-search.js';
import { resolveProviderConfig } from '../../agents/ai-analyzer/provider-config.js';
import { formatAICost } from '../../types/ai-analysis.js';
import { showBanner } from '../display.js';
import { createSpinner } from '../progress.js';
import { logger } from '../../utils/logger.js';

export function createSearchCommand(): Command {
  return new Command('search')
    .description('Search an indexed repository with natural language')
    .argument('<url>', 'GitHub repository URL or local://path')
    .argument('<query>', 'Natural language search query')
    .option('--top-k <number>', 'Number of results to return', '10')
    .option('--provider <provider>', 'AI provider: catalyst, anthropic or ollama (auto-detected from environment)')
    .option('--model <model>', 'Analysis and search model route')
    .option('--summary-model <model>', 'Chat model for code chunk summaries (Catalyst defaults to --model)')
    .action(async (url: string, query: string, options: { topK?: string; provider?: string; model?: string; summaryModel?: string }) => {
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

      const topK = parseInt(options.topK ?? '10', 10);
      const spinner = createSpinner('Searching codebase...');
      spinner.start();

      const search = new SemanticSearch(providerConfig);
      try {
        await search.initialize();
        const response = await search.search(url, query, topK);
        spinner.succeed('Search complete');

        // Display synthesized answer
        console.log('');
        console.log(chalk.bold.white('  Answer'));
        console.log(chalk.dim(`  ${'─'.repeat(60)}`));
        console.log('');
        console.log(`  ${response.answer.split('\n').join('\n  ')}`);
        console.log('');

        // Display relevant chunks
        if (response.results.length > 0) {
          console.log(chalk.bold.white('  Relevant Code'));
          console.log(chalk.dim(`  ${'─'.repeat(60)}`));

          for (const result of response.results.slice(0, 5)) {
            const sim = (result.similarity * 100).toFixed(1);
            console.log(
              `  ${chalk.cyan(result.chunk.filePath)}:${chalk.yellow(String(result.chunk.startLine))}-${chalk.yellow(String(result.chunk.endLine))} ` +
              chalk.dim(`(${sim}% match)`),
            );
            console.log(chalk.dim(`  ${result.summary}`));
            console.log('');
          }
        }

        // Token usage
        if (response.tokenUsage.inputTokens > 0) {
          console.log(chalk.dim(`  Tokens: ${response.tokenUsage.inputTokens} in / ${response.tokenUsage.outputTokens} out (${formatAICost(response.tokenUsage.estimatedCostUSD)})`));
          console.log('');
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        spinner.fail(msg);
        process.exit(1);
      } finally {
        search.close();
      }
    });
}
