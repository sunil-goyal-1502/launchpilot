/**
 * Prompt for generating chunk summaries (used by Claude Haiku for embeddings).
 */

export function buildEmbeddingPrompt(language: string, filePath: string, content: string): string {
  return `Summarize this ${language} code chunk from ${filePath} in 1-2 sentences. Focus on WHAT it does, not HOW. Be specific about names and operations.

\`\`\`${language}
${content}
\`\`\`

Summary:`;
}
