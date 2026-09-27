import { TokenUsage, DEFAULT_OLLAMA_CONFIG } from '../../types/ai-analysis';
import { LLMProvider, extractJson } from './llm-provider';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Ollama LLM client using the local /api/chat endpoint.
 * No npm dependency needed — uses native fetch (Node 18+).
 * Cost is always $0.00 (local inference).
 */
export class OllamaClient implements LLMProvider {
  readonly providerName = 'ollama';
  private host: string;
  private analysisModel: string;
  private embeddingModel: string;
  private totalUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(host?: string, analysisModel?: string, embeddingModel?: string) {
    this.host = host ?? process.env['OLLAMA_HOST'] ?? DEFAULT_OLLAMA_CONFIG.host;
    this.analysisModel = analysisModel ?? DEFAULT_OLLAMA_CONFIG.analysisModel;
    this.embeddingModel = embeddingModel ?? DEFAULT_OLLAMA_CONFIG.embeddingModel;
  }

  // ── Connection validation ──

  async validateConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.host}/api/tags`);
      if (!response.ok) return false;
      const data = await response.json() as { models?: unknown[] };
      return Array.isArray(data.models) && data.models.length > 0;
    } catch {
      return false;
    }
  }

  // ── Plain text analysis ──

  async analyze(
    systemPrompt: string,
    userMessage: string,
    model?: string,
  ): Promise<{ text: string; usage: TokenUsage }> {
    const selectedModel = model ?? this.analysisModel;

    const result = await this.chat(selectedModel, systemPrompt, userMessage, 4096);
    const usage = this.trackUsage(selectedModel, result.promptTokens, result.completionTokens);

    return { text: result.text, usage };
  }

  // ── Structured JSON analysis ──

  async analyzeStructured<T>(
    systemPrompt: string,
    userMessage: string,
    model?: string,
    options?: { maxOutputTokens?: number },
  ): Promise<{ result: T; usage: TokenUsage }> {
    const selectedModel = model ?? this.analysisModel;

    const result = await this.chat(selectedModel, systemPrompt, userMessage, options?.maxOutputTokens ?? 8192);
    const jsonStr = extractJson(result.text);
    const parsed = JSON.parse(jsonStr) as T;
    const usage = this.trackUsage(selectedModel, result.promptTokens, result.completionTokens);

    return { result: parsed, usage };
  }

  // ── Chunk summary generation (uses lighter model) ──

  async generateChunkSummary(prompt: string): Promise<{ summary: string; usage: TokenUsage }> {
    const result = await this.chat(this.embeddingModel, undefined, prompt, 200);
    const usage = this.trackUsage(this.embeddingModel, result.promptTokens, result.completionTokens);

    return { summary: result.text.trim(), usage };
  }

  // ── Token estimation ──

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // ── Usage tracking ──

  getTotalUsage(): { inputTokens: number; outputTokens: number } {
    return { ...this.totalUsage };
  }

  // ── Private: Ollama /api/chat call with retry ──

  private async chat(
    model: string,
    systemPrompt: string | undefined,
    userMessage: string,
    maxTokens: number,
  ): Promise<{ text: string; promptTokens: number; completionTokens: number }> {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userMessage });

    const body = {
      model,
      messages,
      stream: false,
      options: { num_predict: maxTokens },
    };

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.host}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const status = response.status;
          // Retry on 503 (model loading) or 500+ server errors
          if (status === 503 || status >= 500) {
            lastError = new Error(`Ollama API error: ${status} ${response.statusText}`);
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw new Error(`Ollama API error: ${status} ${response.statusText}`);
        }

        const data = await response.json() as {
          message?: { content?: string };
          prompt_eval_count?: number;
          eval_count?: number;
        };

        return {
          text: data.message?.content ?? '',
          promptTokens: data.prompt_eval_count ?? 0,
          completionTokens: data.eval_count ?? 0,
        };
      } catch (error: unknown) {
        lastError = error;

        // Retry on network errors (fetch throws TypeError for connection failures)
        if (error instanceof TypeError) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Don't retry other errors (e.g., 4xx status thrown above)
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.startsWith('Ollama API error:') && !msg.includes('503') && !msg.includes('500')) {
          throw error;
        }

        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private trackUsage(model: string, inputTokens: number, outputTokens: number): TokenUsage {
    this.totalUsage.inputTokens += inputTokens;
    this.totalUsage.outputTokens += outputTokens;

    // Local inference — zero cost
    return { inputTokens, outputTokens, model, estimatedCostUSD: 0 };
  }
}
