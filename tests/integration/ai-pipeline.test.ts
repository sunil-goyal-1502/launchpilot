import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { PipelineContext } from '../../src/orchestrator/context.js';
import { IngestionAgent } from '../../src/agents/ingestion/ingestion-agent.js';
import { selectFiles } from '../../src/agents/ai-analyzer/file-selector.js';
import { chunkFiles } from '../../src/agents/ai-analyzer/code-chunker.js';
import { textToVector } from '../../src/agents/ai-analyzer/embedding-service.js';
import { VectorStore, cosineSimilarity } from '../../src/agents/ai-analyzer/vector-store.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

describe('AI Pipeline Integration', () => {
  it('should select, chunk, and index a fixture repo end-to-end', async () => {
    const repoPath = join(fixturesDir, 'sample-nextjs-app');

    // Step 1: Run ingestion
    const context = new PipelineContext({ nonInteractive: true });
    const ingestionAgent = new IngestionAgent();
    const blueprint = await ingestionAgent.execute(
      { repoUrl: `local://${repoPath}` },
      context,
    );
    expect(blueprint.runtime).toBe('node');

    // Step 2: Select files
    const files = selectFiles(repoPath, blueprint);
    expect(files.length).toBeGreaterThan(0);

    // Should find the source files we added
    const filePaths = files.map(f => f.path);
    expect(filePaths.some(p => p.includes('package.json'))).toBe(true);

    // Step 3: Chunk files
    const chunks = chunkFiles(files.map(f => ({ path: f.path, content: f.content })));
    expect(chunks.length).toBeGreaterThan(0);

    // Verify chunks have required fields
    for (const chunk of chunks) {
      expect(chunk.id).toMatch(/^[a-f0-9]{16}$/);
      expect(chunk.filePath).toBeTruthy();
      expect(chunk.content).toBeTruthy();
      expect(chunk.language).toBeTruthy();
    }

    // Step 4: Store in vector store
    const store = new VectorStore(':memory:');
    await store.initialize();

    const repoUrl = `local://${repoPath}`;
    store.storeChunks(repoUrl, chunks);
    expect(store.getChunkCount(repoUrl)).toBe(chunks.length);

    // Step 5: Create mock embeddings and store
    const embeddings = chunks.map(chunk => ({
      chunkId: chunk.id,
      embedding: textToVector(`${chunk.symbolName} ${chunk.chunkType} in ${chunk.filePath}`),
      summary: `${chunk.chunkType} ${chunk.symbolName} from ${chunk.filePath}`,
    }));
    store.storeEmbeddings(repoUrl, embeddings);

    // Step 6: Update repo index
    const uniqueFiles = new Set(chunks.map(c => c.filePath));
    store.upsertRepoIndex({
      repoUrl,
      commitHash: 'test-commit',
      indexedAt: new Date(),
      totalChunks: chunks.length,
      totalFiles: uniqueFiles.size,
    });

    // Step 7: Search
    const queryVector = textToVector('API route users');
    const results = store.searchSimilar(repoUrl, queryVector, 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.similarity).toBeGreaterThan(0);

    // Step 8: Verify cache
    const analysis = JSON.stringify({ appPurpose: 'test app' });
    store.storeAnalysis(repoUrl, 'test-commit', analysis);
    expect(store.getCachedAnalysis(repoUrl, 'test-commit')).toBe(analysis);
    expect(store.getCachedAnalysis(repoUrl, 'different-commit')).toBeNull();

    // Step 9: Verify stale detection
    expect(store.isRepoStale(repoUrl, 'test-commit')).toBe(false);
    expect(store.isRepoStale(repoUrl, 'new-commit')).toBe(true);

    store.close();
  });

  it('should handle express API fixture', async () => {
    const repoPath = join(fixturesDir, 'sample-express-api');
    const files = selectFiles(repoPath);
    expect(files.length).toBeGreaterThan(0);

    const chunks = chunkFiles(files.map(f => ({ path: f.path, content: f.content })));
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('embedding vectors should have meaningful similarity', () => {
    // Verify that the embedding approach produces useful similarity scores
    const authSummary = textToVector('authenticates users and validates tokens');
    const loginSummary = textToVector('handles user login and session creation');
    const dbSummary = textToVector('connects to PostgreSQL database pool');

    const authLoginSim = cosineSimilarity(authSummary, loginSummary);
    const authDbSim = cosineSimilarity(authSummary, dbSummary);

    // Auth and login should be more similar than auth and database
    expect(authLoginSim).toBeGreaterThan(authDbSim);
  });
});
