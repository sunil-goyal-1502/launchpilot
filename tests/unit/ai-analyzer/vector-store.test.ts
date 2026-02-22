import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorStore, cosineSimilarity } from '../../../src/agents/ai-analyzer/vector-store.js';
import { CodeChunk, ChunkEmbedding } from '../../../src/types/ai-analysis.js';

describe('VectorStore', () => {
  let store: VectorStore;

  beforeEach(async () => {
    store = new VectorStore(':memory:');
    await store.initialize();
  });

  afterEach(() => {
    store.close();
  });

  describe('repo index', () => {
    it('should return null for unindexed repo', () => {
      const result = store.getIndexedRepo('https://github.com/test/repo');
      expect(result).toBeNull();
    });

    it('should upsert and retrieve repo index', () => {
      store.upsertRepoIndex({
        repoUrl: 'https://github.com/test/repo',
        commitHash: 'abc123',
        indexedAt: new Date('2024-01-01'),
        totalChunks: 42,
        totalFiles: 5,
      });

      const result = store.getIndexedRepo('https://github.com/test/repo');
      expect(result).not.toBeNull();
      expect(result!.commitHash).toBe('abc123');
      expect(result!.totalChunks).toBe(42);
      expect(result!.totalFiles).toBe(5);
    });

    it('should detect stale repos', () => {
      store.upsertRepoIndex({
        repoUrl: 'https://github.com/test/repo',
        commitHash: 'abc123',
        indexedAt: new Date(),
        totalChunks: 10,
        totalFiles: 3,
      });

      expect(store.isRepoStale('https://github.com/test/repo', 'abc123')).toBe(false);
      expect(store.isRepoStale('https://github.com/test/repo', 'def456')).toBe(true);
      expect(store.isRepoStale('https://github.com/unknown', 'abc123')).toBe(true);
    });
  });

  describe('chunks', () => {
    const sampleChunks: CodeChunk[] = [
      {
        id: 'chunk1',
        filePath: 'src/app.ts',
        startLine: 1,
        endLine: 10,
        content: 'export function main() { return "hello"; }',
        chunkType: 'function',
        symbolName: 'main',
        language: 'typescript',
      },
      {
        id: 'chunk2',
        filePath: 'src/utils.ts',
        startLine: 1,
        endLine: 5,
        content: 'export const add = (a: number, b: number) => a + b;',
        chunkType: 'function',
        symbolName: 'add',
        language: 'typescript',
      },
    ];

    it('should store and count chunks', () => {
      store.storeChunks('repo1', sampleChunks);
      expect(store.getChunkCount('repo1')).toBe(2);
    });

    it('should replace chunks on re-store', () => {
      store.storeChunks('repo1', sampleChunks);
      store.storeChunks('repo1', [sampleChunks[0]!]);
      expect(store.getChunkCount('repo1')).toBe(1);
    });
  });

  describe('analysis cache', () => {
    it('should return null for uncached analysis', () => {
      const result = store.getCachedAnalysis('repo1', 'abc123');
      expect(result).toBeNull();
    });

    it('should store and retrieve cached analysis', () => {
      const json = JSON.stringify({ appPurpose: 'test app' });
      store.storeAnalysis('repo1', 'abc123', json);

      const result = store.getCachedAnalysis('repo1', 'abc123');
      expect(result).toBe(json);
    });

    it('should not return analysis for different commit hash', () => {
      store.storeAnalysis('repo1', 'abc123', '{}');
      const result = store.getCachedAnalysis('repo1', 'def456');
      expect(result).toBeNull();
    });
  });

  describe('similarity search', () => {
    it('should find similar embeddings', () => {
      const chunks: CodeChunk[] = [
        { id: 'c1', filePath: 'a.ts', startLine: 1, endLine: 5, content: 'code1', chunkType: 'function', symbolName: 'fn1', language: 'typescript' },
        { id: 'c2', filePath: 'b.ts', startLine: 1, endLine: 5, content: 'code2', chunkType: 'function', symbolName: 'fn2', language: 'typescript' },
      ];
      store.storeChunks('repo1', chunks);

      const embeddings: ChunkEmbedding[] = [
        { chunkId: 'c1', embedding: [1, 0, 0, 0], summary: 'function that handles requests' },
        { chunkId: 'c2', embedding: [0, 1, 0, 0], summary: 'utility for parsing data' },
      ];
      store.storeEmbeddings('repo1', embeddings);

      // Query close to c1
      const results = store.searchSimilar('repo1', [0.9, 0.1, 0, 0], 2);
      expect(results.length).toBe(2);
      expect(results[0]!.chunk.id).toBe('c1'); // Should be most similar
      expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
    });

    it('should respect topK limit', () => {
      const chunks: CodeChunk[] = Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        filePath: `f${i}.ts`,
        startLine: 1,
        endLine: 5,
        content: `code${i}`,
        chunkType: 'function' as const,
        symbolName: `fn${i}`,
        language: 'typescript',
      }));
      store.storeChunks('repo1', chunks);

      const embeddings: ChunkEmbedding[] = chunks.map((c, i) => ({
        chunkId: c.id,
        embedding: Array.from({ length: 4 }, (_, d) => d === i % 4 ? 1 : 0),
        summary: `summary ${i}`,
      }));
      store.storeEmbeddings('repo1', embeddings);

      const results = store.searchSimilar('repo1', [1, 0, 0, 0], 2);
      expect(results.length).toBe(2);
    });

    it('should return empty for non-indexed repo', () => {
      const results = store.searchSimilar('unknown-repo', [1, 0, 0], 5);
      expect(results.length).toBe(0);
    });
  });

  describe('deleteRepo', () => {
    it('should delete all data for a repo', () => {
      store.upsertRepoIndex({
        repoUrl: 'repo1',
        commitHash: 'abc',
        indexedAt: new Date(),
        totalChunks: 1,
        totalFiles: 1,
      });
      store.storeChunks('repo1', [{
        id: 'c1', filePath: 'a.ts', startLine: 1, endLine: 5,
        content: 'code', chunkType: 'function', symbolName: 'fn', language: 'typescript',
      }]);
      store.storeAnalysis('repo1', 'abc', '{}');

      store.deleteRepo('repo1');

      expect(store.getIndexedRepo('repo1')).toBeNull();
      expect(store.getChunkCount('repo1')).toBe(0);
      expect(store.getCachedAnalysis('repo1', 'abc')).toBeNull();
    });
  });
});

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it('should return -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it('should handle zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 0, 0])).toBe(0);
  });

  it('should handle different-length vectors', () => {
    expect(cosineSimilarity([1], [1, 2])).toBe(0);
  });
});
