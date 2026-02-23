import { BaseAgent } from '../base-agent.js';
import { PipelineContext } from '../../orchestrator/context.js';
import { ApplicationBlueprint, CloudProvider, ScalingStrategy, BaaSMigrationChoice } from '../../types/index.js';
import { buildStrategies } from './strategy-builder.js';
import { simulateWork } from '../../utils/timer.js';

export interface InfraPlannerInput {
  blueprint: ApplicationBlueprint;
  provider: CloudProvider;
  migrationChoice?: BaaSMigrationChoice;
}

export interface InfraPlannerOutput {
  strategies: ScalingStrategy[];
}

export class InfraPlannerAgent extends BaseAgent<InfraPlannerInput, InfraPlannerOutput> {
  readonly name = 'InfraPlannerAgent';
  readonly description = 'Plans infrastructure and generates scaling strategies with cost estimates';

  async execute(input: InfraPlannerInput, context: PipelineContext): Promise<InfraPlannerOutput> {
    const strategies = await this.timed(context, 'buildStrategies', async () => {
      await simulateWork(1000, 500);
      return buildStrategies(input.blueprint, input.provider, input.migrationChoice);
    });

    context.set('strategies', strategies);

    return { strategies };
  }
}
