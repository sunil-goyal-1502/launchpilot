import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CatalystClient } from '../../../packages/core/src/agents/ai-analyzer/catalyst-client';
import { CatalystClient as LegacyClient } from '../../../src/agents/ai-analyzer/catalyst-client.js';
import type { ProviderConfig } from '../../../packages/core/src/agents/ai-analyzer/llm-provider';

const config: ProviderConfig = {
  provider: 'catalyst', gatewayUrl: 'https://gateway.example/ai/v1/', analysisModel: 'gpt-5.5',
  gatewayToken: 'gateway-test-token',
};
const mockFetch = vi.fn();
const completion = (text = 'Ready', finish = 'stop', usage: unknown = { prompt_tokens: 21, completion_tokens: 9 }) =>
  new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: finish }], usage }));

beforeEach(() => { vi.stubGlobal('fetch', mockFetch); mockFetch.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe.each([['workspace', CatalystClient], ['legacy', LegacyClient]] as const)('%s Catalyst provider', (_name, Client) => {
  it.each(['https://gateway.example/ai', 'https://gateway.example/ai/v1', 'https://gateway.example/ai/v1/'])('normalizes %s and sends routing, authentication and usage', async gatewayUrl => {
    mockFetch.mockResolvedValue(completion());
    const client = new Client({ ...config, gatewayUrl });
    const { text, usage } = await client.analyze('system', 'user');
    const [url, request] = mockFetch.mock.calls[0];
    expect(url).toBe('https://gateway.example/ai/v1/chat/completions');
    expect(request.headers).toMatchObject({ Authorization: 'Bearer gateway-test-token', 'x-model-id': 'gpt-5.5' });
    expect(request.redirect).toBe('manual');
    expect(JSON.parse(request.body)).toEqual({
      model: 'gpt-5.5', messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'user' }],
      max_completion_tokens: 4096, stream: false, store: false,
    });
    expect(text).toBe('Ready');
    expect(usage).toMatchObject({ inputTokens: 21, outputTokens: 9, estimatedCostUSD: null, model: 'gpt-5.5' });
    expect(client.getTotalUsage()).toEqual({ inputTokens: 21, outputTokens: 9 });
  });

  it('routes summary and per-call models consistently in both body and header', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(completion()));
    const client = new Client({ ...config, embeddingModel: 'gpt-4.1-mini', reasoningEffort: 'low' });
    await client.generateChunkSummary('code');
    await client.analyze('s', 'u', 'gpt-5.4');
    expect(mockFetch.mock.calls.map(([, request]) => [request.headers['x-model-id'], JSON.parse(request.body).model]))
      .toEqual([['gpt-4.1-mini', 'gpt-4.1-mini'], ['gpt-5.4', 'gpt-5.4']]);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body).reasoning_effort).toBe('low');
  });

  it('supports structured JSON and omits Catalyst routing for explicit Compass', async () => {
    mockFetch.mockResolvedValue(completion('```json\n{"status":"ready"}\n```'));
    const client = new Client({ ...config, gatewayUrl: 'https://api.core42.ai/v1' });
    const { result } = await client.analyzeStructured('schema', 'data');
    expect(result).toEqual({ status: 'ready' });
    const request = mockFetch.mock.calls[0][1];
    expect(request.headers['x-model-id']).toBeUndefined();
    expect(JSON.parse(request.body).response_format).toEqual({ type: 'json_object' });
  });

  it('allows a Catalyst deployment without client bearer credentials', async () => {
    mockFetch.mockResolvedValue(completion());
    await new Client({ ...config, gatewayToken: undefined }).analyze('s', 'u');
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it.each([
    { gatewayUrl: 'ftp://gateway.example' }, { gatewayUrl: 'https://user:password@gateway.example' },
    { gatewayUrl: 'https://gateway.example?secret=value' }, { gatewayUrl: 'https://gateway.example/#x' },
    { gatewayUrl: 'http://api.core42.ai/v1' }, { gatewayUrl: '' }, { analysisModel: '' },
    { analysisModel: 'bad\nmodel' }, { requestTimeoutMs: Number.NaN }, { reasoningEffort: 'invalid' },
    { gatewayToken: 'bad\nheader' }, { gatewayUrl: 'https://api.core42.ai/v1', gatewayToken: '' },
  ])('rejects invalid configuration before sending requests: %j', overrides => {
    expect(() => new Client({ ...config, ...overrides })).toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([['length', 'partial'], ['content_filter', 'blocked'], ['stop', ''], ['tool_calls', 'unhandled']])('rejects incomplete output (%s)', async (finish, text) => {
    mockFetch.mockResolvedValue(completion(text, finish));
    await expect(new Client(config).analyze('s', 'u')).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not expose invalid JSON text or provider error bodies', async () => {
    mockFetch.mockResolvedValueOnce(completion('secret source code'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'gateway-test-token secret source code' } }), { status: 401 }));
    const client = new Client(config);
    await expect(client.analyzeStructured('s', 'u')).rejects.toThrow('Catalyst returned invalid JSON');
    await expect(client.analyze('s', 'u')).rejects.toThrow(/^Catalyst returned HTTP 401;/);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('explains model entitlement failures without falling back', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'You may not have a quota or access to use this model' } }), { status: 400 }));
    await expect(new Client(config).analyze('s', 'u')).rejects.toThrow('not enabled');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects redirects and does not forward credentials elsewhere', async () => {
    mockFetch.mockResolvedValue(new Response('', { status: 302, headers: { Location: 'https://other.example' } }));
    await expect(new Client(config).analyze('s', 'u')).rejects.toThrow('redirects');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries transient errors on the same model and stops after three attempts', async () => {
    vi.useFakeTimers();
    mockFetch.mockImplementation(() => Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '1' } })));
    const assertion = expect(new Client(config).analyze('s', 'u')).rejects.toThrow('HTTP 429');
    await vi.runAllTimersAsync();
    await assertion;
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(new Set(mockFetch.mock.calls.map(([url]) => url)).size).toBe(1);
  });

  it('recovers from a transient network error without changing provider', async () => {
    vi.useFakeTimers();
    mockFetch.mockRejectedValueOnce(new TypeError('secret transport detail')).mockResolvedValueOnce(completion());
    const request = new Client(config).analyze('s', 'u');
    await vi.advanceTimersByTimeAsync(500);
    expect((await request).text).toBe('Ready');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('bounds a stalled request by its timeout', async () => {
    mockFetch.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    await expect(new Client({ ...config, requestTimeoutMs: 10 }).analyze('s', 'u')).rejects.toThrow('timed out');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reads only a literal local Compass key and gives an explicit token precedence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'launchpilot-key-'));
    const gatewayKeyFile = join(dir, '.env');
    try {
      writeFileSync(gatewayKeyFile, 'UNRELATED=ignored\nexport AI_GATEWAY_API_KEY="file-test-token"\n');
      mockFetch.mockImplementation(() => Promise.resolve(completion()));
      const compass = { ...config, gatewayUrl: 'https://api.core42.ai/v1', gatewayKeyFile };
      await new Client({ ...compass, gatewayToken: undefined }).analyze('s', 'u');
      await new Client({ ...compass, gatewayKeyFile: '/not/a/file' }).analyze('s', 'u');
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer file-test-token');
      expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer gateway-test-token');
      writeFileSync(gatewayKeyFile, 'AI_GATEWAY_API_KEY=$(do-not-execute)');
      expect(() => new Client({ ...compass, gatewayToken: undefined })).toThrow('literal');
      expect(() => new Client({ ...config, gatewayToken: undefined, gatewayKeyFile })).toThrow('direct Compass');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
