import { SearchResponse, TokenUsage, DEFAULT_AI_CONFIG } from '../../types/ai-analysis';
import { LLMProvider, ProviderConfig, createLLMProvider } from './llm-provider';
import { EmbeddingService } from './embedding-service';
import { VectorStore } from './vector-store';
import { SEARCH_SYSTEM_PROMPT, buildSearchUserMessage } from './prompts/search-prompt';

/**
 * RAG (Retrieval-Augmented Generation) pipeline for semantic code search.
 * Requires the repo to be pre-indexed via AIAnalyzerAgent.
 */

export class SemanticSearch {
  private store: VectorStore;
  private client: LLMProvider;
  private embeddingService: EmbeddingService;

  constructor(providerConfig: ProviderConfig, dbPath?: string) {
    this.store = new VectorStore(dbPath);
    this.client = createLLMProvider(providerConfig);
    this.embeddingService = new EmbeddingService(this.client);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  /**
   * Search indexed codebase with a natural language query.
   */
  async search(repoUrl: string, query: string, topK?: number): Promise<SearchResponse> {
    const k = topK ?? DEFAULT_AI_CONFIG.topK;

    // Verify repo is indexed
    const indexed = this.store.getIndexedRepo(repoUrl);
    if (!indexed) {
      throw new Error(
        `Repository "${repoUrl}" is not indexed. Run \`launchpilot index ${repoUrl}\` first.`,
      );
    }

    // Generate query embedding
    const queryEmbedding = this.embeddingService.embedQuery(query);

    // Find top-K similar chunks
    const results = this.store.searchSimilar(repoUrl, queryEmbedding, k);

    if (results.length === 0) {
      return {
        query,
        answer: 'No relevant code chunks found for this query.',
        results: [],
        tokenUsage: { inputTokens: 0, outputTokens: 0, model: '', estimatedCostUSD: 0 },
      };
    }

    // Synthesize answer via LLM
    const userMessage = buildSearchUserMessage(query, results);
    const { text: answer, usage } = await this.client.analyze(
      SEARCH_SYSTEM_PROMPT,
      userMessage,
    );

    return {
      query,
      answer,
      results,
      tokenUsage: usage,
    };
  }

  isRepoIndexed(repoUrl: string): boolean {
    return this.store.getIndexedRepo(repoUrl) !== null;
  }

  close(): void {
    this.store.close();
  }
}
