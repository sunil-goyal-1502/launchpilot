import { SearchResult } from '../../../types/ai-analysis';

/**
 * RAG synthesis prompt — answers based ONLY on provided code chunks.
 */

export const SEARCH_SYSTEM_PROMPT = `You are a code analysis assistant. Answer questions about a codebase based ONLY on the provided code chunks.
Cite specific file paths and line numbers in your answer.
If the provided chunks don't contain enough information to fully answer the question, say so.
Be concise and technical.`;

export function buildSearchUserMessage(query: string, results: SearchResult[]): string {
  const lines = [
    `## Question: ${query}`,
    '',
    '## Relevant Code Chunks',
    '',
  ];

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    lines.push(`### [${i + 1}] ${r.chunk.filePath}:${r.chunk.startLine}-${r.chunk.endLine} (${r.chunk.symbolName}, similarity: ${r.similarity.toFixed(3)})`);
    lines.push(`Summary: ${r.summary}`);
    lines.push('```' + r.chunk.language);
    lines.push(r.chunk.content);
    lines.push('```');
    lines.push('');
  }

  lines.push('Based on these code chunks, answer the question. Cite file paths and line numbers.');

  return lines.join('\n');
}
