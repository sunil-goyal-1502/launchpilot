import { ApplicationBlueprint } from '../../../types/index';
import { SelectedFile } from '../file-selector';

/**
 * Builds the structured analysis prompt for deep code understanding.
 * Uses Claude Sonnet for reasoning quality.
 */

export const ANALYSIS_SYSTEM_PROMPT = `You are an expert software architect analyzing a codebase.
Analyze the provided source code and context to produce a structured JSON assessment.
Be specific and cite actual file paths and function names from the code you see.
If information is not available from the provided code, say "unknown" rather than guessing.

Respond with ONLY valid JSON matching the exact schema below — no markdown, no explanation.`;

export interface AnalysisSchema {
  appPurpose: string;
  architecturePattern: string;
  apiRoutes: Array<{ method: string; path: string; handler: string; description?: string }>;
  dataFlow: Array<{ from: string; to: string; description: string }>;
  securityConcerns: Array<{ severity: string; category: string; description: string; file?: string; recommendation: string }>;
  deploymentRecommendations: string[];
}

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object' as const,
  properties: {
    appPurpose: { type: 'string' as const, description: 'One-paragraph description of what this application does' },
    architecturePattern: {
      type: 'string' as const,
      enum: ['monolith', 'microservice', 'mvc', 'serverless', 'event-driven', 'layered', 'hexagonal', 'cqrs', 'unknown'],
    },
    apiRoutes: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          method: { type: 'string' as const },
          path: { type: 'string' as const },
          handler: { type: 'string' as const },
          description: { type: 'string' as const },
        },
        required: ['method', 'path', 'handler'],
      },
    },
    dataFlow: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          from: { type: 'string' as const },
          to: { type: 'string' as const },
          description: { type: 'string' as const },
        },
        required: ['from', 'to', 'description'],
      },
    },
    securityConcerns: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          severity: { type: 'string' as const, enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' as const },
          description: { type: 'string' as const },
          file: { type: 'string' as const },
          recommendation: { type: 'string' as const },
        },
        required: ['severity', 'category', 'description', 'recommendation'],
      },
    },
    deploymentRecommendations: {
      type: 'array' as const,
      items: { type: 'string' as const },
    },
  },
  required: ['appPurpose', 'architecturePattern', 'apiRoutes', 'dataFlow', 'securityConcerns', 'deploymentRecommendations'],
};

export function buildAnalysisUserMessage(blueprint: ApplicationBlueprint, files: SelectedFile[]): string {
  const contextLines = [
    '## Repository Context (from pattern-matching)',
    `- **Name**: ${blueprint.repoName}`,
    `- **Runtime**: ${blueprint.runtime}`,
    `- **App Type**: ${blueprint.appType}`,
    `- **Frameworks**: ${blueprint.frameworks.map(f => f.name).join(', ') || 'none'}`,
    `- **Databases**: ${blueprint.databases.map(d => d.name).join(', ') || 'none'}`,
    `- **Services**: ${blueprint.services.map(s => s.name).join(', ') || 'none'}`,
    `- **Docker**: ${blueprint.hasDockerfile ? 'Yes' : 'No'}`,
    `- **Complexity**: ${blueprint.complexity}`,
    '',
    '## Source Files',
    '',
  ];

  for (const file of files) {
    contextLines.push(`### ${file.path} (priority: ${file.priority})`);
    contextLines.push('```');
    contextLines.push(file.content);
    contextLines.push('```');
    contextLines.push('');
  }

  contextLines.push('Analyze these files and produce the structured JSON output.');

  return contextLines.join('\n');
}
