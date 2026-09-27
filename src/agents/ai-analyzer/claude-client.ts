import Anthropic from '@anthropic-ai/sdk';
import { TokenUsage, DEFAULT_AI_CONFIG } from '../../types/ai-analysis.js';
import { LLMProvider, extractJson } from './llm-provider.js';

/**
 * Anthropic SDK wrapper with retry logic, token tracking, and cost estimation.
 * Uses Sonnet for deep analysis and Haiku for bulk chunk summaries.
 */

// Cost per million tokens (USD)
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4 },
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export class ClaudeClient implements LLMProvider {
  readonly providerName = 'anthropic';
  private client: Anthropic;
  private totalUsage: { inputTokens: number; outputTokens: number } = { inputTokens: 0, outputTokens: 0 };

  constructor(apiKey: string, private analysisModel = DEFAULT_AI_CONFIG.analysisModel,
    private summaryModel = DEFAULT_AI_CONFIG.embeddingModel) {
    this.client = new Anthropic({ apiKey });
  }

  // ── Connection / API key validation ──

  async validateConnection(): Promise<boolean> {
    return this.validateApiKey();
  }

  async validateApiKey(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.summaryModel,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }

  // ── Plain text analysis (for RAG synthesis) ──

  async analyze(
    systemPrompt: string,
    userMessage: string,
    model?: string,
  ): Promise<{ text: string; usage: TokenUsage }> {
    const selectedModel = model ?? this.analysisModel;

    const response = await this.withRetry(() =>
      this.client.messages.create({
        model: selectedModel,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    const usage = this.trackUsage(selectedModel, response.usage.input_tokens, response.usage.output_tokens);

    return { text, usage };
  }

  // ── Structured JSON analysis (for deep code analysis) ──

  async analyzeStructured<T>(
    systemPrompt: string,
    userMessage: string,
    model?: string,
    options?: { maxOutputTokens?: number },
  ): Promise<{ result: T; usage: TokenUsage }> {
    const selectedModel = model ?? this.analysisModel;

    const response = await this.withRetry(() =>
      this.client.messages.create({
        model: selectedModel,
        max_tokens: options?.maxOutputTokens ?? 8192,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    );

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Parse JSON from the response, handling possible markdown wrapping
    const jsonStr = extractJson(text);
    const result = JSON.parse(jsonStr) as T;

    const usage = this.trackUsage(selectedModel, response.usage.input_tokens, response.usage.output_tokens);

    return { result, usage };
  }

  // ── Chunk summary generation (uses Haiku for cost efficiency) ──

  async generateChunkSummary(prompt: string): Promise<{ summary: string; usage: TokenUsage }> {
    const model = this.summaryModel;

    const response = await this.withRetry(() =>
      this.client.messages.create({
        model,
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    );

    const summary = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('')
      .trim();

    const usage = this.trackUsage(model, response.usage.input_tokens, response.usage.output_tokens);

    return { summary, usage };
  }

  // ── Token estimation ──

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // ── Usage tracking ──

  getTotalUsage(): { inputTokens: number; outputTokens: number } {
    return { ...this.totalUsage };
  }

  private trackUsage(model: string, inputTokens: number, outputTokens: number): TokenUsage {
    this.totalUsage.inputTokens += inputTokens;
    this.totalUsage.outputTokens += outputTokens;

    const pricing = PRICING[model];
    const estimatedCostUSD = pricing ?
      (inputTokens / 1_000_000) * pricing.input +
      (outputTokens / 1_000_000) * pricing.output : null;

    return { inputTokens, outputTokens, model, estimatedCostUSD };
  }

  // ── Retry with exponential backoff ──

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (error: unknown) {
        lastError = error;
        const status = (error as { status?: number }).status;

        // Only retry on rate limit (429) or server errors (500+)
        if (status === 429 || (status !== undefined && status >= 500)) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Don't retry other errors (auth, bad request, etc.)
        throw error;
      }
    }

    throw lastError;
  }
}
