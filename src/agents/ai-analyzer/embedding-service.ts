import { createHash } from 'node:crypto';
import { CodeChunk, ChunkEmbedding, DEFAULT_AI_CONFIG } from '../../types/ai-analysis.js';
import { LLMProvider } from './llm-provider.js';
import { buildEmbeddingPrompt } from './prompts/embedding-prompt.js';

/**
 * Two-step embedding without a dedicated embedding API:
 * 1. Claude Haiku generates 1-2 sentence summary per chunk
 * 2. Random projection converts summary text to a 256-dim float vector
 *
 * Same text always produces the same vector. Semantically similar summaries
 * (shared words) naturally have higher cosine similarity.
 */

const DIMENSIONS = DEFAULT_AI_CONFIG.embeddingDimensions;

// ── Random projection: text → vector ──

export function textToVector(text: string, dimensions: number = DIMENSIONS): number[] {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  const vector = new Array<number>(dimensions).fill(0);

  for (const word of words) {
    // Seeded hash per word → deterministic contribution to each dimension
    const hash = createHash('sha256').update(word).digest();
    for (let d = 0; d < dimensions; d++) {
      // Use pairs of bytes from the hash (cycling through the 32-byte digest)
      const byteIndex = (d * 2) % 32;
      const value = (hash[byteIndex]! * 256 + hash[(byteIndex + 1) % 32]!) / 65535; // 0-1
      // Center around 0 → -0.5 to 0.5
      vector[d]! += value - 0.5;
    }
  }

  // L2 normalize
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] = vector[i]! / norm;
    }
  }

  return vector;
}

// ── Embedding service ──

export class EmbeddingService {
  private client: LLMProvider;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;

  constructor(client: LLMProvider) {
    this.client = client;
  }

  /**
   * Embed a single chunk: summarize with Haiku, then project to vector.
   */
  async embedChunk(chunk: CodeChunk): Promise<ChunkEmbedding> {
    const prompt = buildEmbeddingPrompt(chunk.language, chunk.filePath, chunk.content);
    const { summary, usage } = await this.client.generateChunkSummary(prompt);

    this.totalInputTokens += usage.inputTokens;
    this.totalOutputTokens += usage.outputTokens;

    const embedding = textToVector(summary);

    return {
      chunkId: chunk.id,
      embedding,
      summary,
    };
  }

  /**
   * Embed multiple chunks with optional progress callback.
   */
  async embedChunks(
    chunks: CodeChunk[],
    onProgress?: (completed: number, total: number) => void,
  ): Promise<ChunkEmbedding[]> {
    const embeddings: ChunkEmbedding[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const emb = await this.embedChunk(chunks[i]!);
      embeddings.push(emb);
      onProgress?.(i + 1, chunks.length);
    }

    return embeddings;
  }

  /**
   * Embed a search query (summary = query itself, then project to vector).
   */
  embedQuery(query: string): number[] {
    return textToVector(query);
  }

  getTokenUsage(): { inputTokens: number; outputTokens: number } {
    return { inputTokens: this.totalInputTokens, outputTokens: this.totalOutputTokens };
  }
}
