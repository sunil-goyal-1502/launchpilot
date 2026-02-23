import {
  PipelineContext,
  IngestionAgent,
  InfraPlannerAgent,
  SecurityAgent,
  DeployAgent,
  extractRepoName,
  generateMigrationOptions,
  calculateCost,
} from '@launchpilot/core';
import type {
  CloudProvider,
  StrategyTier,
  BaaSMigrationChoice,
  ApplicationBlueprint,
  ScalingStrategy,
  SecurityPolicy,
} from '@launchpilot/core';
import { updateDeploymentStatus } from './db';
import { createStream, pushEvent, pushPhase, pushLog } from './store';

export interface DeployParams {
  repoUrl: string;
  provider: CloudProvider;
  strategyTier: StrategyTier;
  migrationChoice?: BaaSMigrationChoice;
  live: boolean;
}

/**
 * Runs the full deployment pipeline asynchronously.
 * Fire-and-forget from the POST /api/deploy route.
 * Streams progress via the event store.
 */
export async function runDeployment(deploymentId: string, params: DeployParams): Promise<void> {
  createStream(deploymentId);
  const context = new PipelineContext({ nonInteractive: true });
  const repoName = extractRepoName(params.repoUrl);

  try {
    // Phase 1: Ingestion
    pushPhase(deploymentId, 'analyzing');
    updateDeploymentStatus(deploymentId, 'analyzing');
    pushLog(deploymentId, `Analyzing repository: ${params.repoUrl}`);

    const ingestionAgent = new IngestionAgent();
    const blueprint: ApplicationBlueprint = await ingestionAgent.execute(
      { repoUrl: params.repoUrl },
      context,
    );

    pushEvent(deploymentId, {
      type: 'blueprint',
      timestamp: new Date().toISOString(),
      data: { blueprint },
    });
    updateDeploymentStatus(deploymentId, 'analyzing', {
      blueprint_json: JSON.stringify(blueprint),
    });
    pushLog(deploymentId, `Detected: ${blueprint.runtime} / ${blueprint.appType}`);

    // Phase 1.5: BaaS migration (auto-detect)
    let migrationChoice = params.migrationChoice;
    if (!migrationChoice && blueprint.baas?.isBaaSApp) {
      const options = generateMigrationOptions(blueprint);
      migrationChoice = { strategy: 'self-hosted', handledFeatures: [] };
      pushLog(deploymentId, `BaaS detected — defaulting to self-hosted migration`);
      pushEvent(deploymentId, {
        type: 'log',
        timestamp: new Date().toISOString(),
        data: { message: `BaaS providers: ${options.map(o => o.strategy).join(', ')}` },
      });
    }

    // Phase 2: Infra Planning
    pushPhase(deploymentId, 'planning');
    updateDeploymentStatus(deploymentId, 'planning');
    pushLog(deploymentId, `Generating ${params.provider.toUpperCase()} infrastructure plans...`);

    const infraAgent = new InfraPlannerAgent();
    const { strategies } = await infraAgent.execute(
      { blueprint, provider: params.provider, migrationChoice },
      context,
    );

    const selectedStrategy = strategies.find(s => s.tier === params.strategyTier) ?? strategies[1]!;
    const costBreakdown = calculateCost(selectedStrategy);

    pushEvent(deploymentId, {
      type: 'strategy',
      timestamp: new Date().toISOString(),
      data: { strategies, selectedStrategy, costBreakdown },
    });
    updateDeploymentStatus(deploymentId, 'planning', {
      strategy_json: JSON.stringify(selectedStrategy),
      cost_total: costBreakdown.total,
    });
    pushLog(deploymentId, `Selected: ${selectedStrategy.name} (${selectedStrategy.tier}) — $${costBreakdown.total.toFixed(0)}/mo`);

    // Phase 3: Security
    pushLog(deploymentId, 'Generating security policies...');

    const securityAgent = new SecurityAgent();
    const security: SecurityPolicy = await securityAgent.execute(
      { blueprint, strategy: selectedStrategy, provider: params.provider },
      context,
    );

    pushEvent(deploymentId, {
      type: 'security',
      timestamp: new Date().toISOString(),
      data: { security },
    });
    updateDeploymentStatus(deploymentId, 'planning', {
      security_json: JSON.stringify(security),
    });
    pushLog(deploymentId, `Security tier: ${security.tier}`);

    // Phase 4: Deploy
    pushPhase(deploymentId, 'deploying');
    updateDeploymentStatus(deploymentId, 'deploying');
    pushLog(deploymentId, params.live ? 'Starting live deployment...' : 'Starting simulated deployment...');

    const deployAgent = new DeployAgent();

    // Wire checkpoint callbacks to SSE stream
    deployAgent.setCheckpointCallback((checkpoint, index, total) => {
      pushEvent(deploymentId, {
        type: 'checkpoint',
        timestamp: new Date().toISOString(),
        data: { checkpoint, index, total },
      });
      if (checkpoint.status === 'completed') {
        pushLog(deploymentId, `[${index + 1}/${total}] ${checkpoint.name} — done`);
      } else if (checkpoint.status === 'in_progress') {
        pushLog(deploymentId, `[${index + 1}/${total}] ${checkpoint.name}...`);
      }
    });

    const deployResult = await deployAgent.execute(
      {
        repoName,
        provider: params.provider,
        strategy: selectedStrategy,
        security,
        live: params.live,
      },
      context,
    );

    // Phase 5: Complete
    pushPhase(deploymentId, 'completed');
    updateDeploymentStatus(deploymentId, 'completed', {
      result_json: JSON.stringify(deployResult),
    });

    pushEvent(deploymentId, {
      type: 'complete',
      timestamp: new Date().toISOString(),
      data: { result: deployResult },
    });
    pushLog(deploymentId, `Deployment complete: ${deployResult.url}`);

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    pushPhase(deploymentId, 'failed');
    updateDeploymentStatus(deploymentId, 'failed', { error: msg });
    pushEvent(deploymentId, {
      type: 'error',
      timestamp: new Date().toISOString(),
      data: { error: msg },
    });
    pushLog(deploymentId, `ERROR: ${msg}`);
  }
}
