import { describe, expect, it } from 'vitest';
import { resolveProviderConfig } from '../../../packages/core/src/agents/ai-analyzer/provider-config';
import { AIAnalyzerAgent } from '../../../packages/core/src/agents/ai-analyzer/ai-analyzer-agent';

describe('shared AI configuration', () => {
  const env = { CATALYST_AI_GATEWAY_URL: 'https://gateway.example/v1', CATALYST_AI_MODEL: 'gpt-5.5', ANTHROPIC_API_KEY: 'test-anthropic' };

  it('prefers configured Catalyst and never reuses the Anthropic key', () => {
    const config = resolveProviderConfig({}, env);
    expect(config).toMatchObject({ provider: 'catalyst', analysisModel: 'gpt-5.5', embeddingModel: 'gpt-5.5' });
    expect(config.apiKey).toBeUndefined();
    expect(config.gatewayToken).toBeUndefined();
    expect(AIAnalyzerAgent.isAvailable(config)).toBe(true);
  });

  it('gives explicit flags priority over environment and honors summary overrides', () => {
    expect(resolveProviderConfig({ provider: 'ollama', model: 'local-model' }, env)).toMatchObject({ provider: 'ollama', analysisModel: 'local-model' });
    expect(resolveProviderConfig({ model: 'gpt-5.4', summaryModel: 'gpt-4.1-mini' }, env)).toMatchObject({ analysisModel: 'gpt-5.4', embeddingModel: 'gpt-4.1-mini' });
    expect(resolveProviderConfig({ model: 'gpt-5.4' }, { ...env, CATALYST_AI_SUMMARY_MODEL: '' }).embeddingModel).toBe('gpt-5.4');
  });

  it('preserves explicit and existing legacy provider selection', () => {
    expect(resolveProviderConfig({}, { LAUNCHPILOT_AI_PROVIDER: 'anthropic', ...env }).provider).toBe('anthropic');
    expect(resolveProviderConfig({}, { OLLAMA_HOST: 'http://localhost:11434' }).provider).toBe('ollama');
    expect(resolveProviderConfig({}, {}).provider).toBe('anthropic');
    expect(AIAnalyzerAgent.isAvailable({ provider: 'anthropic', apiKey: 'programmatic-key' })).toBe(true);
  });

  it('fails closed for partial Catalyst configuration and unknown providers', () => {
    const config = resolveProviderConfig({}, { CATALYST_AI_MODEL: 'gpt-5.5', ANTHROPIC_API_KEY: 'other-key' });
    expect(config.provider).toBe('catalyst');
    expect(AIAnalyzerAgent.isAvailable(config)).toBe(false);
    expect(() => resolveProviderConfig({ provider: 'typo' }, env)).toThrow('AI provider');
  });
});
