import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AIAnalyzerAgent, SemanticSearch, PipelineContext, type ProviderConfig } from '@launchpilot/core';
import { detectStack } from '../../packages/core/src/agents/ingestion/detector';
import { VectorStore } from '../../packages/core/src/agents/ai-analyzer/vector-store';

const config: ProviderConfig = { provider: 'catalyst', gatewayUrl: 'https://gateway.example/v1', analysisModel: 'gpt-5.5', embeddingModel: 'gpt-5.4' };
const analysis = {
  appPurpose: 'Express API with user routes', architecturePattern: 'mvc', apiRoutes: [], dataFlow: [],
  securityConcerns: [], deploymentRecommendations: ['Use the detected start command'],
};
let dir: string;
let repoPath: string;
let dbPath: string;
const mockFetch = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'launchpilot-catalyst-'));
  repoPath = join(dir, 'repo');
  dbPath = join(dir, 'index.db');
  cpSync(resolve('tests/fixtures/sample-express-api'), repoPath, { recursive: true });
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (_url, request) => {
    const body = JSON.parse(request.body);
    const text = body.response_format ? JSON.stringify(analysis) : 'Express user route handles an HTTP request.';
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
  });
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => { vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); });

async function run(providerConfig = config, forceReindex = false) {
  const blueprint = await detectStack(repoPath, 'local://catalyst-fixture', 'fixture');
  return new AIAnalyzerAgent().execute({ repoUrl: blueprint.repoUrl, repoPath, blueprint, providerConfig, dbPath, forceReindex }, new PipelineContext());
}

describe('Catalyst analysis, indexing and retrieval', () => {
  it('runs the real pipeline and synthesizes a search answer through the gateway', async () => {
    const result = await run();
    expect(result.aiError).toBeUndefined();
    expect(result.aiAnalysis).toMatchObject({ appPurpose: analysis.appPurpose, tokenUsage: { model: 'gpt-5.5', estimatedCostUSD: null } });
    expect(result.aiAnalysis!.totalChunks).toBeGreaterThan(0);
    expect(mockFetch.mock.calls.map(([, request]) => JSON.parse(request.body).model)).toContain('gpt-5.4');
    const search = new SemanticSearch(config, dbPath);
    try {
      await search.initialize();
      const response = await search.search('local://catalyst-fixture', 'HTTP user routes');
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.answer).toContain('HTTP request');
      expect(response.tokenUsage.model).toBe('gpt-5.5');
    } finally { search.close(); }
    for (const [, request] of mockFetch.mock.calls) expect(request.headers['x-model-id']).toBe(JSON.parse(request.body).model);
  });

  it('invalidates cached analysis for changed models, source and explicit reindex', async () => {
    await run();
    mockFetch.mockClear();
    await run();
    expect(mockFetch).not.toHaveBeenCalled();
    await run({ ...config, analysisModel: 'gpt-5.4' });
    expect(mockFetch).toHaveBeenCalled();
    mockFetch.mockClear();
    // Switching back must also restore the corresponding indexed summaries.
    await run();
    expect(mockFetch).toHaveBeenCalled();
    mockFetch.mockClear();
    writeFileSync(join(repoPath, 'server.ts'), 'export const changedSource = true;');
    await run();
    expect(mockFetch).toHaveBeenCalled();
    mockFetch.mockClear();
    await run(config, true);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('rejects JSON with an invalid analysis schema before writing an index', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"appPurpose":"incomplete"}' }, finish_reason: 'stop' }] })));
    const result = await run();
    expect(result.aiAnalysis).toBeNull();
    expect(result.aiError).toContain('required blueprint schema');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const store = new VectorStore(dbPath);
    await store.initialize();
    expect(store.getIndexedRepo('local://catalyst-fixture')).toBeNull();
    store.close();
  });
});
