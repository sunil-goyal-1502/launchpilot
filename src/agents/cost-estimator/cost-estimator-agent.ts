import { BaseAgent } from '../base-agent.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { ScalingStrategy, CostEstimate, CloudProvider } from '../../types/index.js';
import { calculateCost } from './calculator.js';
import { simulateWork } from '../../utils/timer.js';
import { DEFAULT_REGIONS } from '../../types/cloud-provider.types.js';

export interface CostEstimatorInput {
  strategies: ScalingStrategy[];
  provider: CloudProvider;
}

export class CostEstimatorAgent extends BaseAgent<CostEstimatorInput, CostEstimate> {
  readonly name = 'CostEstimatorAgent';
  readonly description = 'Calculates detailed cost estimates for each scaling strategy';

  async execute(input: CostEstimatorInput, context: PipelineContext): Promise<CostEstimate> {
    const estimate = await this.timed(context, 'calculateCosts', async () => {
      await simulateWork(600, 300);

      const low = input.strategies.find((s) => s.tier === 'low');
      const medium = input.strategies.find((s) => s.tier === 'medium');
      const high = input.strategies.find((s) => s.tier === 'high');

      return {
        provider: input.provider,
        region: DEFAULT_REGIONS[input.provider],
        strategies: {
          low: low?.costBreakdown ?? calculateCost(low ?? input.strategies[0]!),
          medium: medium?.costBreakdown ?? calculateCost(medium ?? input.strategies[1]!),
          high: high?.costBreakdown ?? calculateCost(high ?? input.strategies[2]!),
        },
        generatedAt: new Date(),
      };
    });

    context.set('costEstimate', estimate);

    return estimate;
  }
}
