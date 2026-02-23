import { BaseAgent } from '../base-agent.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { ApplicationBlueprint } from '../../types/index.js';
import { AIAnalysis, EnhancedBlueprint, DEFAULT_AI_CONFIG } from '../../types/ai-analysis.js';
import { LLMProvider, ProviderConfig, createLLMProvider } from './llm-provider.js';
import { selectFiles } from './file-selector.js';
import { chunkFiles } from './code-chunker.js';
import { EmbeddingService } from './embedding-service.js';
import { VectorStore } from './vector-store.js';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserMessage } from './prompts/analysis-prompt.js';
import type { AnalysisSchema } from './prompts/analysis-prompt.js';
import { logger } from '../../utils/logger.js';

export interface AIAnalyzerInput {
  repoUrl: string;
  repoPath: string;
  blueprint: ApplicationBlueprint;
  commitHash?: string;
  providerConfig?: ProviderConfig;
}

export class AIAnalyzerAgent extends BaseAgent<AIAnalyzerInput, EnhancedBlueprint> {
  readonly name = 'AIAnalyzerAgent';
  readonly description = 'Deep AI-powered code analysis with persistent vector indexing';

  /**
   * Check if the AI analyzer can run (API key or Ollama available).
   */
  static isAvailable(providerConfig?: ProviderConfig): boolean {
    if (providerConfig?.provider === 'ollama') return true;
    return !!process.env['ANTHROPIC_API_KEY'];
  }

  async execute(input: AIAnalyzerInput, context: PipelineContext): Promise<EnhancedBlueprint> {
    const providerConfig = input.providerConfig ?? {
      provider: 'anthropic' as const,
      apiKey: process.env['ANTHROPIC_API_KEY'],
    };

    if (providerConfig.provider === 'anthropic' && !providerConfig.apiKey) {
      this.log(context, 'No ANTHROPIC_API_KEY — returning blueprint without AI analysis');
      return { blueprint: input.blueprint, aiAnalysis: null };
    }

    const commitHash = input.commitHash ?? 'unknown';
    const store = new VectorStore();

    try {
      await store.initialize();

      // Step 1: Cache check
      const cached = store.getCachedAnalysis(input.repoUrl, commitHash);
      if (cached) {
        this.log(context, 'Using cached AI analysis');
        logger.info('Using cached AI analysis');
        const aiAnalysis: AIAnalysis = JSON.parse(cached);
        aiAnalysis.analyzedAt = new Date(aiAnalysis.analyzedAt);
        return { blueprint: input.blueprint, aiAnalysis };
      }

      const client = createLLMProvider(providerConfig);

      // Step 2: File selection
      const files = await this.timed(context, 'file-selection', async () => {
        return selectFiles(input.repoPath, input.blueprint);
      });
      this.log(context, `Selected ${files.length} files for analysis`);

      // Step 3: Token estimate
      const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
      const estimatedTokens = client.estimateTokens(files.map(f => f.content).join('\n'));
      this.log(context, `Estimated input: ${estimatedTokens} tokens (~${totalChars} chars)`);

      // Step 4: Deep analysis with Sonnet
      const userMessage = buildAnalysisUserMessage(input.blueprint, files);
      const { result: analysisResult, usage: analysisUsage } = await this.timed(context, 'deep-analysis', async () => {
        return client.analyzeStructured<AnalysisSchema>(ANALYSIS_SYSTEM_PROMPT, userMessage);
      });
      this.log(context, `Analysis complete (${analysisUsage.inputTokens} in / ${analysisUsage.outputTokens} out tokens)`);

      // Step 5: Chunking
      const chunks = await this.timed(context, 'chunking', async () => {
        return chunkFiles(files.map(f => ({ path: f.path, content: f.content })));
      });
      this.log(context, `Created ${chunks.length} semantic chunks`);

      // Step 6: Embedding with Haiku
      const embeddingService = new EmbeddingService(client);
      const embeddings = await this.timed(context, 'embedding', async () => {
        return embeddingService.embedChunks(chunks, (done, total) => {
          if (done % 10 === 0 || done === total) {
            this.log(context, `Embedded ${done}/${total} chunks`);
          }
        });
      });

      // Step 7: Store everything in SQLite
      await this.timed(context, 'storage', async () => {
        store.storeChunks(input.repoUrl, chunks);
        store.storeEmbeddings(input.repoUrl, embeddings);

        const uniqueFiles = new Set(chunks.map(c => c.filePath));
        store.upsertRepoIndex({
          repoUrl: input.repoUrl,
          commitHash,
          indexedAt: new Date(),
          totalChunks: chunks.length,
          totalFiles: uniqueFiles.size,
        });
      });

      // Build final AIAnalysis
      const embUsage = embeddingService.getTokenUsage();
      const isLocal = client.providerName === 'ollama';
      const embeddingCost = isLocal ? 0 :
        (embUsage.inputTokens / 1_000_000) * 0.80 +
        (embUsage.outputTokens / 1_000_000) * 4;
      const totalTokenUsage = {
        inputTokens: analysisUsage.inputTokens + embUsage.inputTokens,
        outputTokens: analysisUsage.outputTokens + embUsage.outputTokens,
        model: analysisUsage.model,
        estimatedCostUSD: analysisUsage.estimatedCostUSD + embeddingCost,
      };

      const aiAnalysis: AIAnalysis = {
        appPurpose: analysisResult.appPurpose,
        architecturePattern: analysisResult.architecturePattern as AIAnalysis['architecturePattern'],
        apiRoutes: analysisResult.apiRoutes,
        dataFlow: analysisResult.dataFlow,
        securityConcerns: analysisResult.securityConcerns.map(sc => ({
          ...sc,
          severity: sc.severity as AIAnalysis['securityConcerns'][number]['severity'],
        })),
        deploymentRecommendations: analysisResult.deploymentRecommendations,
        analyzedFiles: files.length,
        totalChunks: chunks.length,
        tokenUsage: totalTokenUsage,
        analyzedAt: new Date(),
      };

      // Cache the analysis
      store.storeAnalysis(input.repoUrl, commitHash, JSON.stringify(aiAnalysis));
      this.log(context, 'AI analysis cached successfully');

      return { blueprint: input.blueprint, aiAnalysis };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log(context, `AI analysis failed: ${errMsg}`);
      logger.warn(`AI analysis failed: ${errMsg}. Returning basic blueprint.`);
      return { blueprint: input.blueprint, aiAnalysis: null };
    } finally {
      store.close();
    }
  }
}
