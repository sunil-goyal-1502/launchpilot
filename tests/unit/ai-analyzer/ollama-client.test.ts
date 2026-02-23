import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaClient } from '../../../src/agents/ai-analyzer/ollama-client.js';

// ── Mock fetch globally ──

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Helpers ──

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
  } as Response;
}

function chatResponse(content: string, promptTokens = 100, completionTokens = 50) {
  return jsonResponse({
    message: { content },
    prompt_eval_count: promptTokens,
    eval_count: completionTokens,
  });
}

describe('OllamaClient', () => {
  describe('constructor', () => {
    it('should use default host and models', () => {
      const client = new OllamaClient();
      expect(client.providerName).toBe('ollama');
    });

    it('should accept custom host and models', () => {
      const client = new OllamaClient('http://custom:1234', 'llama3.2', 'mistral');
      expect(client.providerName).toBe('ollama');
    });

    it('should read OLLAMA_HOST from environment', () => {
      const original = process.env['OLLAMA_HOST'];
      process.env['OLLAMA_HOST'] = 'http://env-host:5555';

      const client = new OllamaClient();
      // Verify it uses env host by checking validateConnection calls the right URL
      mockFetch.mockResolvedValue(jsonResponse({ models: [{ name: 'test' }] }));
      client.validateConnection();

      expect(mockFetch).toHaveBeenCalledWith('http://env-host:5555/api/tags');

      if (original) {
        process.env['OLLAMA_HOST'] = original;
      } else {
        delete process.env['OLLAMA_HOST'];
      }
    });
  });

  describe('validateConnection', () => {
    it('should return true when Ollama is running with models', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ models: [{ name: 'qwen2.5-coder:14b' }] }));

      const client = new OllamaClient();
      const result = await client.validateConnection();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/api/tags');
    });

    it('should return false when Ollama is not running', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const client = new OllamaClient();
      const result = await client.validateConnection();

      expect(result).toBe(false);
    });

    it('should return false when no models are available', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ models: [] }));

      const client = new OllamaClient();
      const result = await client.validateConnection();

      expect(result).toBe(false);
    });

    it('should return false on HTTP error', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 500));

      const client = new OllamaClient();
      const result = await client.validateConnection();

      expect(result).toBe(false);
    });
  });

  describe('analyze', () => {
    it('should send correct request and return text with usage', async () => {
      mockFetch.mockResolvedValue(chatResponse('The app is a REST API'));

      const client = new OllamaClient();
      const result = await client.analyze('system prompt', 'user message');

      expect(result.text).toBe('The app is a REST API');
      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.estimatedCostUSD).toBe(0);

      // Verify request body
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('http://localhost:11434/api/chat');
      const body = JSON.parse(options.body);
      expect(body.model).toBe('qwen2.5-coder:14b');
      expect(body.stream).toBe(false);
      expect(body.messages).toEqual([
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user message' },
      ]);
    });

    it('should use custom model when specified', async () => {
      mockFetch.mockResolvedValue(chatResponse('response'));

      const client = new OllamaClient();
      await client.analyze('system', 'user', 'mistral:latest');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.model).toBe('mistral:latest');
    });

    it('should track cumulative token usage', async () => {
      mockFetch.mockResolvedValue(chatResponse('response', 100, 50));

      const client = new OllamaClient();
      await client.analyze('s', 'u');
      await client.analyze('s', 'u');

      const total = client.getTotalUsage();
      expect(total.inputTokens).toBe(200);
      expect(total.outputTokens).toBe(100);
    });
  });

  describe('analyzeStructured', () => {
    it('should parse JSON from response', async () => {
      const jsonResult = { appPurpose: 'test app', architecturePattern: 'mvc' };
      mockFetch.mockResolvedValue(chatResponse(JSON.stringify(jsonResult)));

      const client = new OllamaClient();
      const result = await client.analyzeStructured<typeof jsonResult>('system', 'message');

      expect(result.result.appPurpose).toBe('test app');
      expect(result.result.architecturePattern).toBe('mvc');
    });

    it('should handle JSON wrapped in markdown code blocks', async () => {
      const jsonResult = { key: 'value' };
      mockFetch.mockResolvedValue(
        chatResponse('```json\n' + JSON.stringify(jsonResult) + '\n```'),
      );

      const client = new OllamaClient();
      const result = await client.analyzeStructured<typeof jsonResult>('system', 'message');

      expect(result.result.key).toBe('value');
    });
  });

  describe('generateChunkSummary', () => {
    it('should use embedding model and return trimmed summary', async () => {
      mockFetch.mockResolvedValue(chatResponse('  This function handles login.  ', 30, 15));

      const client = new OllamaClient();
      const result = await client.generateChunkSummary('Summarize this code');

      expect(result.summary).toBe('This function handles login.');
      expect(result.usage.inputTokens).toBe(30);

      // Verify it uses the embedding model (7b), not analysis model (14b)
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.model).toBe('qwen2.5-coder:7b');
    });

    it('should not include system prompt', async () => {
      mockFetch.mockResolvedValue(chatResponse('summary'));

      const client = new OllamaClient();
      await client.generateChunkSummary('prompt');

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.messages).toEqual([{ role: 'user', content: 'prompt' }]);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate ~4 chars per token', () => {
      const client = new OllamaClient();
      expect(client.estimateTokens('hello world')).toBe(3); // 11 / 4 = 2.75 → 3
      expect(client.estimateTokens('')).toBe(0);
    });
  });

  describe('cost tracking', () => {
    it('should always report $0.00 cost', async () => {
      mockFetch.mockResolvedValue(chatResponse('response', 5000, 1000));

      const client = new OllamaClient();
      const result = await client.analyze('system', 'message');

      expect(result.usage.estimatedCostUSD).toBe(0);
    });
  });

  describe('retry logic', () => {
    it('should retry on 503 (model loading)', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({}, 503))
        .mockResolvedValue(chatResponse('recovered'));

      const client = new OllamaClient();
      const result = await client.analyze('system', 'message');

      expect(result.text).toBe('recovered');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should retry on network error (TypeError)', async () => {
      mockFetch
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValue(chatResponse('recovered'));

      const client = new OllamaClient();
      const result = await client.analyze('system', 'message');

      expect(result.text).toBe('recovered');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10000);

    it('should throw on non-retryable errors (4xx)', async () => {
      mockFetch.mockResolvedValue(jsonResponse({}, 404));

      const client = new OllamaClient();
      await expect(client.analyze('system', 'message')).rejects.toThrow('Ollama API error: 404');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('missing response fields', () => {
    it('should handle missing token counts gracefully', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        message: { content: 'response' },
        // No prompt_eval_count or eval_count
      }));

      const client = new OllamaClient();
      const result = await client.analyze('system', 'message');

      expect(result.text).toBe('response');
      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });

    it('should handle missing message content gracefully', async () => {
      mockFetch.mockResolvedValue(jsonResponse({
        prompt_eval_count: 10,
        eval_count: 5,
      }));

      const client = new OllamaClient();
      const result = await client.analyze('system', 'message');

      expect(result.text).toBe('');
    });
  });
});
