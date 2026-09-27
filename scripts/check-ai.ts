import { createLLMProvider, resolveProviderConfig } from '@launchpilot/core';

// Synthetic prompts only. Run with environment variables or node --env-file=.env.
try {
  const config = resolveProviderConfig();
  const client = createLLMProvider(config);
  const { result } = await client.analyzeStructured<{ status: string }>(
    'Return a JSON object with exactly one field: status.', 'Set status to ready.',
  );
  if (result.status !== 'ready') throw new Error('Structured-response check failed');
  const { summary } = await client.generateChunkSummary('function add(a, b) { return a + b; }');
  if (!summary) throw new Error('Summary check failed');
  const { text } = await client.analyze('Reply with exactly LAUNCHPILOT_READY.', 'Health check');
  if (text !== 'LAUNCHPILOT_READY') throw new Error('Text-response check failed');
  console.log(JSON.stringify({
    provider: client.providerName, model: config.analysisModel,
    summaryModel: config.embeddingModel ?? config.analysisModel,
    structured: 'passed', summary: 'passed', text: 'passed', usage: client.getTotalUsage(),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'AI check failed');
  process.exitCode = 1;
}
