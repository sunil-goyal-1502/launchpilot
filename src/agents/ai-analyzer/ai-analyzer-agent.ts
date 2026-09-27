import { createHash } from 'node:crypto';
import { BaseAgent } from '../base-agent.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { ApplicationBlueprint } from '../../types/index.js';
import { AIAnalysis, EnhancedBlueprint, DEFAULT_AI_CONFIG, DEFAULT_OLLAMA_CONFIG } from '../../types/ai-analysis.js';
import { LLMProvider, ProviderConfig, createLLMProvider } from './llm-provider.js';
import { resolveProviderConfig } from './provider-config.js';
import { selectFiles } from './file-selector.js';
import { chunkFiles } from './code-chunker.js';
import { EmbeddingService } from './embedding-service.js';
import { VectorStore } from './vector-store.js';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisUserMessage, analysisSchema } from './prompts/analysis-prompt.js';
import type { AnalysisSchema } from './prompts/analysis-prompt.js';
import { logger } from '../../utils/logger.js';

export interface AIAnalyzerInput {
  repoUrl: string;
  repoPath: string;
  blueprint: ApplicationBlueprint;
  commitHash?: string;
  providerConfig?: ProviderConfig;
  forceReindex?: boolean;
  dbPath?: string;
}

export class AIAnalyzerAgent extends BaseAgent<AIAnalyzerInput, EnhancedBlueprint> {
  readonly name = 'AIAnalyzerAgent';
  readonly description = 'Deep AI-powered code analysis with persistent vector indexing';

  /**
   * Check configuration only; availability does not imply network connectivity.
   */
  static isAvailable(providerConfig?: ProviderConfig): boolean {
    try {
      createLLMProvider(providerConfig ?? resolveProviderConfig());
      return true;
    } catch { return false; }
  }

  async execute(input: AIAnalyzerInput, context: PipelineContext): Promise<EnhancedBlueprint> {
    const commitHash = input.commitHash ?? 'unknown';
    const store = new VectorStore(input.dbPath);

    try {
      const providerConfig = input.providerConfig ?? resolveProviderConfig();
      const client = createLLMProvider(providerConfig);
      await store.initialize();

      // Select before checking the cache: callers may omit a commit or use local files.
      const files = await this.timed(context, 'file-selection', async () => {
        return selectFiles(input.repoPath, input.blueprint);
      });
      this.log(context, `Selected ${files.length} files for analysis`);
      const userMessage = buildAnalysisUserMessage(input.blueprint, files);
      const defaults = providerConfig.provider === 'ollama' ? DEFAULT_OLLAMA_CONFIG : DEFAULT_AI_CONFIG;
      const cacheKey = createHash('sha256').update(JSON.stringify({
        version: 2, commitHash, system: ANALYSIS_SYSTEM_PROMPT, userMessage,
        provider: providerConfig.provider,
        analysisModel: providerConfig.analysisModel ?? defaults.analysisModel,
        summaryModel: providerConfig.embeddingModel ?? (providerConfig.provider === 'catalyst' ? providerConfig.analysisModel : defaults.embeddingModel),
        endpoint: providerConfig.gatewayUrl ?? providerConfig.ollamaHost,
        reasoningEffort: providerConfig.reasoningEffort,
      })).digest('hex');
      const cached = input.forceReindex || store.getIndexedRepo(input.repoUrl)?.analysisFingerprint !== cacheKey
        ? null : store.getCachedAnalysis(input.repoUrl, cacheKey);
      if (cached) {
        this.log(context, 'Using cached AI analysis');
        logger.info('Using cached AI analysis');
        const aiAnalysis: AIAnalysis = JSON.parse(cached);
        aiAnalysis.analyzedAt = new Date(aiAnalysis.analyzedAt);
        return { blueprint: input.blueprint, aiAnalysis };
      }

      // Step 3: Token estimate
      const totalChars = files.reduce((sum, f) => sum + f.content.length, 0);
      const estimatedTokens = client.estimateTokens(files.map(f => f.content).join('\n'));
      this.log(context, `Estimated input: ${estimatedTokens} tokens (~${totalChars} chars)`);

      // Step 4: Deep analysis using the selected provider and model.
      const { result, usage: analysisUsage } = await this.timed(context, 'deep-analysis', async () => {
        return client.analyzeStructured<AnalysisSchema>(ANALYSIS_SYSTEM_PROMPT, userMessage);
      });
      const parsed = analysisSchema.safeParse(result);
      if (!parsed.success) throw new Error('AI analysis did not match the required blueprint schema');
      const analysisResult = parsed.data;
      this.log(context, `Analysis complete (${analysisUsage.inputTokens} in / ${analysisUsage.outputTokens} out tokens)`);

      // Step 5: Chunking
      const chunks = await this.timed(context, 'chunking', async () => {
        return chunkFiles(files.map(f => ({ path: f.path, content: f.content })));
      });
      this.log(context, `Created ${chunks.length} semantic chunks`);

      // Step 6: Summaries via the configured model, vectors generated locally.
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
          analysisFingerprint: cacheKey,
          indexedAt: new Date(),
          totalChunks: chunks.length,
          totalFiles: uniqueFiles.size,
        });
      });

      // Build final AIAnalysis
      const embUsage = embeddingService.getTokenUsage();
      const embeddingCost = embeddingService.getEstimatedCostUSD();
      const totalTokenUsage = {
        inputTokens: analysisUsage.inputTokens + embUsage.inputTokens,
        outputTokens: analysisUsage.outputTokens + embUsage.outputTokens,
        model: analysisUsage.model,
        estimatedCostUSD: analysisUsage.estimatedCostUSD === null || embeddingCost === null
          ? null : analysisUsage.estimatedCostUSD + embeddingCost,
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
      store.storeAnalysis(input.repoUrl, cacheKey, JSON.stringify(aiAnalysis));
      this.log(context, 'AI analysis cached successfully');

      return { blueprint: input.blueprint, aiAnalysis };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log(context, `AI analysis failed: ${errMsg}`);
      logger.warn(`AI analysis failed: ${errMsg}. Returning basic blueprint.`);
      return { blueprint: input.blueprint, aiAnalysis: null, aiError: errMsg };
    } finally {
      store.close();
    }
  }
}
