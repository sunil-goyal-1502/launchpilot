import { TokenUsage } from '../../types/ai-analysis';
import { ClaudeClient } from './claude-client';
import { OllamaClient } from './ollama-client';

/**
 * Provider-agnostic interface for LLM operations.
 * Implemented by ClaudeClient (Anthropic) and OllamaClient (local Ollama).
 */
export interface LLMProvider {
  readonly providerName: string;

  /** Validate that the provider is reachable and configured. */
  validateConnection(): Promise<boolean>;

  /** Run analysis with system + user messages. Returns plain text. */
  analyze(systemPrompt: string, userMessage: string, model?: string): Promise<{ text: string; usage: TokenUsage }>;

  /** Run analysis expecting JSON output. */
  analyzeStructured<T>(systemPrompt: string, userMessage: string, model?: string): Promise<{ result: T; usage: TokenUsage }>;

  /** Generate a short summary for embedding. */
  generateChunkSummary(prompt: string): Promise<{ summary: string; usage: TokenUsage }>;

  /** Estimate token count for a string. */
  estimateTokens(text: string): number;

  /** Get cumulative token usage. */
  getTotalUsage(): { inputTokens: number; outputTokens: number };
}

// ── Provider configuration ──

export type ProviderType = 'anthropic' | 'ollama';

export interface ProviderConfig {
  provider: ProviderType;
  apiKey?: string;          // Required for anthropic
  ollamaHost?: string;      // Default: http://localhost:11434
  analysisModel?: string;   // Override default model
  embeddingModel?: string;  // Override default model
}

// ── Factory ──

export function createLLMProvider(config: ProviderConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      if (!config.apiKey) throw new Error('ANTHROPIC_API_KEY is required for Anthropic provider');
      return new ClaudeClient(config.apiKey);
    case 'ollama':
      return new OllamaClient(config.ollamaHost, config.analysisModel, config.embeddingModel);
    default:
      throw new Error(`Unknown LLM provider: ${String(config.provider)}`);
  }
}

// ── Shared JSON extraction helper ──

export function extractJson(text: string): string {
  // Try direct parse first
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed;

  // Try extracting from markdown code block
  const match = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (match?.[1]) return match[1].trim();

  // Last resort: find first { to last }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return trimmed;
}
