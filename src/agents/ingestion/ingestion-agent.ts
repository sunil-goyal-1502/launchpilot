import { BaseAgent } from '../base-agent.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { ApplicationBlueprint } from '../../types/index.js';
import { cloneRepo } from './cloner.js';
import { detectStack } from './detector.js';
import { cleanupDir } from '../../utils/fs-helpers.js';
import { extractRepoName } from '../../utils/validator.js';
import { simulateWork } from '../../utils/timer.js';

export interface IngestionInput {
  repoUrl: string;
  deferCleanup?: boolean; // If true, caller is responsible for cleanup (for AI analysis)
}

export class IngestionAgent extends BaseAgent<IngestionInput, ApplicationBlueprint> {
  readonly name = 'IngestionAgent';
  readonly description = 'Clones repository and detects technology stack';

  async execute(input: IngestionInput, context: PipelineContext): Promise<ApplicationBlueprint> {
    const repoName = extractRepoName(input.repoUrl);

    // Clone the repository
    const cloneResult = await this.timed(context, 'clone', async () => {
      await simulateWork(800, 400);
      return cloneRepo(input.repoUrl);
    });

    // Store repoPath in context for downstream agents (e.g., AI analyzer)
    context.set('repoPath', cloneResult.localPath);
    context.set('repoIsTemp', cloneResult.isTemp);

    try {
      // Detect the technology stack
      const blueprint = await this.timed(context, 'detect', async () => {
        await simulateWork(600, 300);
        return detectStack(cloneResult.localPath, input.repoUrl, repoName);
      });

      // Store in context for downstream agents
      context.set('blueprint', blueprint);
      context.set('repoName', repoName);

      return blueprint;
    } finally {
      // Cleanup temp directory unless caller defers cleanup (e.g., for AI analysis)
      if (cloneResult.isTemp && !input.deferCleanup) {
        await cleanupDir(cloneResult.localPath);
      }
    }
  }
}
