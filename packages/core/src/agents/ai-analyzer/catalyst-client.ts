import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { TokenUsage } from '../../types/ai-analysis';
import { extractJson, type LLMProvider, type ProviderConfig } from './llm-provider';

const COMPASS_URL = 'https://api.core42.ai/v1';

/** Catalyst's OpenAI-compatible chat contract, also supporting explicit Compass mode. */
export class CatalystClient implements LLMProvider {
  readonly providerName = 'catalyst';
  private readonly baseUrl: string;
  private readonly compass: boolean;
  private readonly token?: string;
  private readonly analysisModel: string;
  private readonly summaryModel: string;
  private readonly timeoutMs: number;
  private readonly reasoningEffort?: string;
  private totalUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(config: ProviderConfig) {
    const base = config.gatewayUrl?.trim().replace(/\/+$/, '');
    if (!base) throw new Error('CATALYST_AI_GATEWAY_URL is required for the Catalyst provider');
    let url: URL;
    try { url = new URL(base); } catch { throw new Error('CATALYST_AI_GATEWAY_URL must be an HTTP(S) base URL'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('CATALYST_AI_GATEWAY_URL must be an HTTP(S) base URL without credentials, query or fragment');
    }
    this.compass = base === COMPASS_URL;
    if (url.hostname === 'api.core42.ai' && !this.compass) {
      throw new Error(`Direct Compass access requires ${COMPASS_URL}`);
    }
    this.baseUrl = base.replace(/\/v1$/, '') + '/v1';
    this.analysisModel = this.validateModel(config.analysisModel);
    this.summaryModel = this.validateModel(config.embeddingModel ?? this.analysisModel);
    this.timeoutMs = config.requestTimeoutMs ?? 120_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 600_000) {
      throw new Error('CATALYST_AI_TIMEOUT_MS must be an integer between 1 and 600000');
    }
    if (config.reasoningEffort && !['none', 'low', 'medium', 'high'].includes(config.reasoningEffort)) {
      throw new Error('CATALYST_AI_REASONING_EFFORT must be none, low, medium or high');
    }
    this.reasoningEffort = config.reasoningEffort;
    this.token = config.gatewayToken?.trim() || undefined;
    if (!this.token && config.gatewayKeyFile) {
      if (!this.compass) throw new Error('CATALYST_AI_KEY_FILE is for direct Compass access; use CATALYST_AI_GATEWAY_TOKEN for gateway authentication');
      // Read one literal assignment as data. Never source a shell file.
      let contents: string;
      try { contents = readFileSync(config.gatewayKeyFile, 'utf8'); }
      catch { throw new Error('Cannot read CATALYST_AI_KEY_FILE'); }
      const assignment = contents.match(/^\s*(?:export\s+)?AI_GATEWAY_API_KEY\s*=\s*(.+?)\s*$/m)?.[1];
      const token = assignment?.match(/^(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s#'"`]+))(?:\s+#.*)?$/);
      this.token = (token?.[1] ?? token?.[2] ?? token?.[3])?.trim();
      if (!this.token || /\$|`/.test(this.token)) throw new Error('CATALYST_AI_KEY_FILE must contain a literal AI_GATEWAY_API_KEY assignment');
    }
    if (this.compass && !this.token) throw new Error('Compass requires CATALYST_AI_GATEWAY_TOKEN or CATALYST_AI_KEY_FILE');
    if (this.token && /[^\x21-\x7e]/.test(this.token)) throw new Error('The gateway token contains invalid header characters');
  }

  private validateModel(model?: string): string {
    const value = model?.trim();
    if (!value || /[^\x21-\x7e]/.test(value)) throw new Error('Set CATALYST_AI_MODEL (or --model) to an enabled chat model route');
    return value;
  }

  async validateConnection(): Promise<boolean> {
    try {
      const { text } = await this.complete(this.analysisModel, 'Reply with exactly LAUNCHPILOT_READY.', 'Health check', 256);
      return text === 'LAUNCHPILOT_READY';
    } catch { return false; }
  }

  analyze(systemPrompt: string, userMessage: string, model?: string): Promise<{ text: string; usage: TokenUsage }> {
    return this.complete(model ?? this.analysisModel, systemPrompt, userMessage, 4096);
  }

  async analyzeStructured<T>(systemPrompt: string, userMessage: string, model?: string, options?: { maxOutputTokens?: number }): Promise<{ result: T; usage: TokenUsage }> {
    const maxOutputTokens = options?.maxOutputTokens ?? 8192;
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 32768) throw new Error('Structured output token limit must be between 1 and 32768');
    const { text, usage } = await this.complete(model ?? this.analysisModel,
      `${systemPrompt}\nReturn a valid JSON object.`, userMessage, maxOutputTokens, true);
    try { return { result: JSON.parse(extractJson(text)) as T, usage }; }
    catch { throw new Error('Catalyst returned invalid JSON for structured analysis'); }
  }

  async generateChunkSummary(prompt: string): Promise<{ summary: string; usage: TokenUsage }> {
    const { text, usage } = await this.complete(this.summaryModel,
      'Summarize the supplied code in one or two concise sentences.', prompt, 2048);
    return { summary: text, usage };
  }

  estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
  getTotalUsage(): { inputTokens: number; outputTokens: number } { return { ...this.totalUsage }; }

  private async complete(model: string, system: string, user: string, maxTokens: number, json = false): Promise<{ text: string; usage: TokenUsage }> {
    model = this.validateModel(model);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!this.compass) headers['x-model-id'] = model;
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const signal = AbortSignal.timeout(this.timeoutMs);
    const body = JSON.stringify({
      model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_completion_tokens: maxTokens, stream: false, store: false,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
      ...(this.reasoningEffort ? { reasoning_effort: this.reasoningEffort } : {}),
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST', headers, body, signal, redirect: 'manual',
        });
      } catch {
        if (signal.aborted) throw new Error('Catalyst request timed out');
        if (attempt === 2) throw new Error('Catalyst could not be reached; check gateway URL and network access');
        await this.retryDelay(attempt, signal);
        continue;
      }
      if (!response.ok) {
        // Never echo provider bodies: they may contain source code or credentials.
        const diagnostic = await response.json().catch(() => null);
        const message = diagnostic?.error?.message;
        if (response.status === 400 && typeof message === 'string' && /quota or access|subscription|not.*access.*model/i.test(message)) {
          throw new Error('The selected model is not enabled for this Compass credential or has no quota; choose an accessible model or enable access');
        }
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          const retryAfter = Number(response.headers.get('retry-after'));
          await this.retryDelay(attempt, signal, Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined);
          continue;
        }
        if (response.status >= 300 && response.status < 400) throw new Error('Catalyst redirects are not permitted');
        throw new Error(`Catalyst returned HTTP ${response.status}; check model route, gateway authentication and quota`);
      }
      let data;
      try { data = await response.json(); }
      catch { throw new Error(signal.aborted ? 'Catalyst request timed out' : 'Catalyst returned an invalid response'); }
      const choice = data?.choices?.[0];
      if (choice?.finish_reason === 'length') throw new Error('Catalyst truncated the response at the token limit');
      if (choice?.finish_reason !== 'stop' || choice?.message?.refusal) throw new Error('Catalyst did not return a complete answer');
      const text = choice?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('Catalyst returned no completion text');
      const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
      const inputTokens = count(data?.usage?.prompt_tokens);
      const outputTokens = count(data?.usage?.completion_tokens);
      this.totalUsage.inputTokens += inputTokens;
      this.totalUsage.outputTokens += outputTokens;
      // Gateway routes have deployment-specific prices; unknown is not zero/free.
      return { text: text.trim(), usage: { inputTokens, outputTokens, model, estimatedCostUSD: null } };
    }
    throw new Error('Catalyst request failed');
  }

  private async retryDelay(attempt: number, signal: AbortSignal, retryAfter?: number): Promise<void> {
    try { await delay(Math.min(10_000, Math.max(500 * 2 ** attempt, retryAfter ?? 0)), undefined, { signal }); }
    catch { throw new Error('Catalyst request timed out'); }
  }
}
