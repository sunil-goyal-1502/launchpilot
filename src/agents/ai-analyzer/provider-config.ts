import type { ProviderConfig, ProviderType } from './llm-provider.js';

/** One resolver for CLI, server and programmatic consumers. Explicit selection wins. */
export function resolveProviderConfig(
  options: { provider?: string; model?: string; summaryModel?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): ProviderConfig {
  const provider = options.provider ?? (env['LAUNCHPILOT_AI_PROVIDER']?.trim() || undefined) ??
    (env['CATALYST_AI_GATEWAY_URL']?.trim() || env['CATALYST_AI_MODEL']?.trim() ? 'catalyst' :
      env['OLLAMA_HOST'] && !env['ANTHROPIC_API_KEY'] ? 'ollama' : 'anthropic');
  if (!['catalyst', 'anthropic', 'ollama'].includes(provider)) {
    throw new Error('AI provider must be catalyst, anthropic or ollama');
  }
  if (provider === 'catalyst') {
    return {
      provider, gatewayUrl: env['CATALYST_AI_GATEWAY_URL'],
      gatewayToken: env['CATALYST_AI_GATEWAY_TOKEN'], gatewayKeyFile: env['CATALYST_AI_KEY_FILE'],
      analysisModel: options.model ?? env['CATALYST_AI_MODEL'],
      embeddingModel: options.summaryModel ?? (env['CATALYST_AI_SUMMARY_MODEL']?.trim() || undefined) ?? options.model ?? env['CATALYST_AI_MODEL'],
      requestTimeoutMs: env['CATALYST_AI_TIMEOUT_MS'] ? Number(env['CATALYST_AI_TIMEOUT_MS']) : undefined,
      reasoningEffort: env['CATALYST_AI_REASONING_EFFORT']?.trim() || undefined,
    };
  }
  return {
    provider: provider as ProviderType, apiKey: env['ANTHROPIC_API_KEY'], ollamaHost: env['OLLAMA_HOST'],
    analysisModel: options.model, embeddingModel: options.summaryModel,
  };
}
