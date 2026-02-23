import { PipelineContext } from './context.js';
import { CloudProvider, ApplicationBlueprint, ScalingStrategy, SecurityPolicy, DeployResult, StrategyTier } from '../types/index.js';
import { IngestionAgent } from '../agents/ingestion/ingestion-agent.js';
import { InfraPlannerAgent } from '../agents/infra-planner/infra-planner-agent.js';
import { SecurityAgent } from '../agents/security/security-agent.js';
import { DeployAgent } from '../agents/deploy/deploy-agent.js';
import { extractRepoName } from '../utils/validator.js';

export interface PipelineOptions {
  repoUrl: string;
  provider: CloudProvider;
  strategyTier: StrategyTier;
  nonInteractive?: boolean;
  live?: boolean;
}

export interface PipelineResult {
  blueprint: ApplicationBlueprint;
  strategies: ScalingStrategy[];
  selectedStrategy: ScalingStrategy;
  security: SecurityPolicy;
  deployResult: DeployResult;
  context: PipelineContext;
}

export class DeploymentPipeline {
  async execute(options: PipelineOptions): Promise<PipelineResult> {
    const context = new PipelineContext({ nonInteractive: options.nonInteractive });

    // 1. Ingestion — clone + detect
    const ingestionAgent = new IngestionAgent();
    const blueprint = await ingestionAgent.execute(
      { repoUrl: options.repoUrl },
      context,
    );

    // 2. Infra Planning — generate strategies
    const infraAgent = new InfraPlannerAgent();
    const { strategies } = await infraAgent.execute(
      { blueprint, provider: options.provider },
      context,
    );

    // 3. Select strategy
    const selectedStrategy = strategies.find(s => s.tier === options.strategyTier) ?? strategies[1]!;

    // 4. Security — generate policies
    const securityAgent = new SecurityAgent();
    const security = await securityAgent.execute(
      { blueprint, strategy: selectedStrategy, provider: options.provider },
      context,
    );

    // 5. Deploy
    const deployAgent = new DeployAgent();
    const repoName = extractRepoName(options.repoUrl);
    const deployResult = await deployAgent.execute(
      { repoName, provider: options.provider, strategy: selectedStrategy, security, live: options.live },
      context,
    );

    return {
      blueprint,
      strategies,
      selectedStrategy,
      security,
      deployResult,
      context,
    };
  }
}
