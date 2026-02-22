import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Anthropic SDK before importing ClaudeClient
const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor() {}
    },
  };
});

import { ClaudeClient } from '../../../src/agents/ai-analyzer/claude-client.js';

describe('ClaudeClient', () => {
  let client: ClaudeClient;

  beforeEach(() => {
    client = new ClaudeClient('test-api-key');
    mockCreate.mockReset();
  });

  describe('analyze', () => {
    it('should return text and token usage', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'The app is a REST API' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const result = await client.analyze('system prompt', 'user message');

      expect(result.text).toBe('The app is a REST API');
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.estimatedCostUSD).toBeGreaterThan(0);
    });

    it('should track cumulative token usage', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      await client.analyze('system', 'message1');
      await client.analyze('system', 'message2');

      const total = client.getTotalUsage();
      expect(total.inputTokens).toBe(200);
      expect(total.outputTokens).toBe(100);
    });
  });

  describe('analyzeStructured', () => {
    it('should parse JSON response', async () => {
      const jsonResult = { appPurpose: 'test', architecturePattern: 'mvc' };
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(jsonResult) }],
        usage: { input_tokens: 200, output_tokens: 100 },
      });

      const result = await client.analyzeStructured<typeof jsonResult>('system', 'message');
      expect(result.result.appPurpose).toBe('test');
      expect(result.result.architecturePattern).toBe('mvc');
    });

    it('should handle JSON wrapped in markdown code blocks', async () => {
      const jsonResult = { key: 'value' };
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(jsonResult) + '\n```' }],
        usage: { input_tokens: 50, output_tokens: 20 },
      });

      const result = await client.analyzeStructured<typeof jsonResult>('system', 'message');
      expect(result.result.key).toBe('value');
    });
  });

  describe('generateChunkSummary', () => {
    it('should return trimmed summary', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '  This function handles user login.  ' }],
        usage: { input_tokens: 30, output_tokens: 15 },
      });

      const result = await client.generateChunkSummary('Summarize this code');
      expect(result.summary).toBe('This function handles user login.');
    });
  });

  describe('estimateTokens', () => {
    it('should estimate ~4 chars per token', () => {
      expect(client.estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 → 3
      expect(client.estimateTokens('')).toBe(0);
    });
  });

  describe('retry logic', () => {
    it('should retry on 429 rate limit', async () => {
      mockCreate
        .mockRejectedValueOnce({ status: 429, message: 'Rate limited' })
        .mockResolvedValue({
          content: [{ type: 'text', text: 'ok' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        });

      const result = await client.analyze('system', 'message');
      expect(result.text).toBe('ok');
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 server error', async () => {
      mockCreate
        .mockRejectedValueOnce({ status: 500, message: 'Server error' })
        .mockResolvedValue({
          content: [{ type: 'text', text: 'recovered' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        });

      const result = await client.analyze('system', 'message');
      expect(result.text).toBe('recovered');
    });

    it('should not retry on 401 auth error', async () => {
      mockCreate.mockRejectedValue({ status: 401, message: 'Unauthorized' });

      await expect(client.analyze('system', 'message')).rejects.toMatchObject({ status: 401 });
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
