import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { PipelineContext } from '../../../src/orchestrator/context.js';
import { ApplicationBlueprint } from '../../../src/types/index.js';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  const mockCreate = vi.fn();
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor() {}
    },
    __mockCreate: mockCreate,
  };
});

import { AIAnalyzerAgent } from '../../../src/agents/ai-analyzer/ai-analyzer-agent.js';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');

function createMockBlueprint(): ApplicationBlueprint {
  return {
    repoUrl: 'local://test',
    repoName: 'sample-nextjs-app',
    runtime: 'node',
    appType: 'fullstack',
    frameworks: [{ name: 'Next.js', version: '14.0.0', confidence: 0.95 }],
    databases: [{ type: 'postgresql', name: 'PostgreSQL (Prisma)', confidence: 0.9 }],
    services: [],
    hasDockerfile: false,
    hasDockerCompose: false,
    envVars: ['DATABASE_URL'],
    ports: [3000],
    buildCommand: 'next build',
    startCommand: 'next start',
    complexity: 'medium',
    detectedAt: new Date(),
  };
}

describe('AIAnalyzerAgent', () => {
  const originalEnv = process.env['ANTHROPIC_API_KEY'];

  afterEach(() => {
    if (originalEnv) {
      process.env['ANTHROPIC_API_KEY'] = originalEnv;
    } else {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  describe('isAvailable', () => {
    it('should return true when API key is set', () => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key';
      expect(AIAnalyzerAgent.isAvailable()).toBe(true);
    });

    it('should return false when API key is not set', () => {
      delete process.env['ANTHROPIC_API_KEY'];
      expect(AIAnalyzerAgent.isAvailable()).toBe(false);
    });
  });

  describe('execute', () => {
    it('should return blueprint with null aiAnalysis when no API key', async () => {
      delete process.env['ANTHROPIC_API_KEY'];

      const agent = new AIAnalyzerAgent();
      const context = new PipelineContext();
      const blueprint = createMockBlueprint();

      const result = await agent.execute(
        { repoUrl: 'local://test', repoPath: fixturesDir, blueprint },
        context,
      );

      expect(result.blueprint).toBe(blueprint);
      expect(result.aiAnalysis).toBeNull();
    });

    it('should gracefully handle API errors', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key';

      // Make the mock throw an error
      const { __mockCreate } = await import('@anthropic-ai/sdk') as any;
      __mockCreate.mockRejectedValue(new Error('API connection failed'));

      const agent = new AIAnalyzerAgent();
      const context = new PipelineContext();
      const blueprint = createMockBlueprint();

      const result = await agent.execute(
        { repoUrl: 'local://test', repoPath: join(fixturesDir, 'sample-nextjs-app'), blueprint },
        context,
      );

      // Should not throw, should return null aiAnalysis
      expect(result.blueprint).toBe(blueprint);
      expect(result.aiAnalysis).toBeNull();
    });

    it('should analyze fixture repo with mocked API', async () => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key';

      const analysisResult = {
        appPurpose: 'A Next.js web application with user management',
        architecturePattern: 'mvc',
        apiRoutes: [{ method: 'GET', path: '/api/users', handler: 'src/app/api/users/route.ts' }],
        dataFlow: [{ from: 'client', to: 'API route', description: 'HTTP request' }],
        securityConcerns: [],
        deploymentRecommendations: ['Use Vercel for Next.js hosting'],
      };

      const { __mockCreate } = await import('@anthropic-ai/sdk') as any;
      // First call: deep analysis (Sonnet)
      // Subsequent calls: chunk summaries (Haiku)
      let callCount = 0;
      __mockCreate.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            content: [{ type: 'text', text: JSON.stringify(analysisResult) }],
            usage: { input_tokens: 5000, output_tokens: 500 },
          });
        }
        return Promise.resolve({
          content: [{ type: 'text', text: `Summary of chunk ${callCount}` }],
          usage: { input_tokens: 50, output_tokens: 20 },
        });
      });

      const agent = new AIAnalyzerAgent();
      const context = new PipelineContext();
      const blueprint = createMockBlueprint();

      const result = await agent.execute(
        { repoUrl: 'local://test-analysis', repoPath: join(fixturesDir, 'sample-nextjs-app'), blueprint },
        context,
      );

      expect(result.blueprint).toBe(blueprint);
      expect(result.aiAnalysis).not.toBeNull();
      expect(result.aiAnalysis!.appPurpose).toBe('A Next.js web application with user management');
      expect(result.aiAnalysis!.architecturePattern).toBe('mvc');
      expect(result.aiAnalysis!.apiRoutes.length).toBe(1);
      expect(result.aiAnalysis!.analyzedFiles).toBeGreaterThan(0);
      expect(result.aiAnalysis!.totalChunks).toBeGreaterThan(0);
      expect(result.aiAnalysis!.tokenUsage.inputTokens).toBeGreaterThan(0);
    });
  });
});
